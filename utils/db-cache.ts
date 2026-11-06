/**
 * ============================================================================
 * YouTube 智能字幕断句翻译器 - IndexedDB 本地持久化缓存核心
 * 版本: v1.2.0
 * 
 * 功能特性：
 * 1. 毫秒级持久化缓存，跨页面、跨会话有效；
 * 2. 二次观看相同视频实现 0 API 消耗、0 秒瞬时显示完整双语字幕；
 * 3. 内存 Map 一级缓存 + IndexedDB 二级持久化缓存双层架构；
 * 4. 异常自动降级（无痕模式或禁用存储时静默回退纯内存缓存）。
 * ============================================================================
 */

const DB_NAME = 'yt_sub_translator_v2_cache';
const DB_VERSION = 1;
const STORE_SENTENCES = 'sentence_cache';
const STORE_VIDEOS = 'video_track_cache';

// 内存一级缓存
const memorySentenceCache = new Map<string, string>();

let dbPromise: Promise<IDBDatabase | null> | null = null;

function getDB(): Promise<IDBDatabase | null> {
  if (typeof indexedDB === 'undefined') {
    return Promise.resolve(null);
  }
  if (!dbPromise) {
    dbPromise = new Promise((resolve) => {
      try {
        const req = indexedDB.open(DB_NAME, DB_VERSION);
        req.onupgradeneeded = (e) => {
          const db = (e.target as IDBOpenDBRequest).result;
          if (!db.objectStoreNames.contains(STORE_SENTENCES)) {
            db.createObjectStore(STORE_SENTENCES, { keyPath: 'key' });
          }
          if (!db.objectStoreNames.contains(STORE_VIDEOS)) {
            db.createObjectStore(STORE_VIDEOS, { keyPath: 'videoKey' });
          }
        };
        req.onsuccess = () => resolve(req.result);
        req.onerror = () => {
          console.warn('[DBCache] IndexedDB open error, fallback to memory cache');
          resolve(null);
        };
      } catch (err) {
        console.warn('[DBCache] IndexedDB not available, fallback to memory:', err);
        resolve(null);
      }
    });
  }
  return dbPromise;
}

export function buildSentenceCacheKey(
  targetLang: string,
  text: string,
  scenario = 'general',
  reasoning = 'low',
  service = 'google'
): string {
  return `${service}:${scenario}:${reasoning}:${targetLang}:${text.trim().toLowerCase()}`;
}

export function buildVideoCacheKey(
  videoId: string,
  trackLang: string,
  targetLang: string,
  scenario = 'general',
  service = 'google'
): string {
  return `${videoId}:${trackLang}:${targetLang}:${scenario}:${service}`;
}

/**
 * 读单句缓存（先读内存，再读 IndexedDB）
 */
export async function getCachedSentence(key: string): Promise<string | null> {
  if (memorySentenceCache.has(key)) {
    return memorySentenceCache.get(key)!;
  }
  try {
    const db = await getDB();
    if (!db) return null;
    return new Promise((resolve) => {
      const tx = db.transaction(STORE_SENTENCES, 'readonly');
      const store = tx.objectStore(STORE_SENTENCES);
      const req = store.get(key);
      req.onsuccess = () => {
        if (req.result && req.result.translation) {
          memorySentenceCache.set(key, req.result.translation);
          resolve(req.result.translation);
        } else {
          resolve(null);
        }
      };
      req.onerror = () => resolve(null);
    });
  } catch {
    return null;
  }
}

/**
 * 批量读取句子缓存
 */
export async function getCachedSentencesBatch(keys: string[]): Promise<Map<string, string>> {
  const result = new Map<string, string>();
  const missingKeys: string[] = [];

  for (const k of keys) {
    if (memorySentenceCache.has(k)) {
      result.set(k, memorySentenceCache.get(k)!);
    } else {
      missingKeys.push(k);
    }
  }

  if (missingKeys.length === 0) {
    return result;
  }

  try {
    const db = await getDB();
    if (!db) return result;

    await new Promise<void>((resolve) => {
      const tx = db.transaction(STORE_SENTENCES, 'readonly');
      const store = tx.objectStore(STORE_SENTENCES);
      let remaining = missingKeys.length;

      for (const k of missingKeys) {
        const req = store.get(k);
        req.onsuccess = () => {
          if (req.result && req.result.translation) {
            memorySentenceCache.set(k, req.result.translation);
            result.set(k, req.result.translation);
          }
          remaining--;
          if (remaining === 0) resolve();
        };
        req.onerror = () => {
          remaining--;
          if (remaining === 0) resolve();
        };
      }
    });
  } catch {
    // 忽略异常，返回已有
  }

  return result;
}

/**
 * 批量写入句子缓存（同步写入内存与 IndexedDB）
 */
export async function setCachedSentencesBatch(
  entries: Array<{ key: string; translation: string }>
): Promise<void> {
  if (entries.length === 0) return;

  for (const { key, translation } of entries) {
    memorySentenceCache.set(key, translation);
  }

  try {
    const db = await getDB();
    if (!db) return;
    const tx = db.transaction(STORE_SENTENCES, 'readwrite');
    const store = tx.objectStore(STORE_SENTENCES);
    const now = Date.now();
    for (const { key, translation } of entries) {
      store.put({ key, translation, updatedAt: now });
    }
  } catch (e) {
    console.warn('[DBCache] setCachedSentencesBatch error:', e);
  }
}

/**
 * 读取整部视频的全部已翻译字幕
 */
export async function getCachedVideoSentences(
  videoKey: string
): Promise<Array<{ text: string; translation: string }> | null> {
  try {
    const db = await getDB();
    if (!db) return null;
    return new Promise((resolve) => {
      const tx = db.transaction(STORE_VIDEOS, 'readonly');
      const store = tx.objectStore(STORE_VIDEOS);
      const req = store.get(videoKey);
      req.onsuccess = () => {
        if (req.result && Array.isArray(req.result.sentences)) {
          resolve(req.result.sentences);
        } else {
          resolve(null);
        }
      };
      req.onerror = () => resolve(null);
    });
  } catch {
    return null;
  }
}

/**
 * 保存整部视频的全部已翻译字幕
 */
export async function saveCachedVideoSentences(
  videoKey: string,
  sentences: Array<{ text: string; translation: string }>
): Promise<void> {
  if (!videoKey || !sentences || sentences.length === 0) return;
  try {
    const db = await getDB();
    if (!db) return;
    const tx = db.transaction(STORE_VIDEOS, 'readwrite');
    const store = tx.objectStore(STORE_VIDEOS);
    store.put({
      videoKey,
      sentences,
      updatedAt: Date.now()
    });
  } catch (e) {
    console.warn('[DBCache] saveCachedVideoSentences error:', e);
  }
}
