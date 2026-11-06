/**
 * ============================================================================
 * YouTube 智能字幕断句翻译器 - IndexedDB 本地持久化缓存核心
 * 版本: v0.2.5
 *
 * 功能特性：
 * 1. 毫秒级持久化缓存，跨页面、跨会话有效；
 * 2. 二次观看相同视频实现 0 API 消耗、0 秒瞬时显示完整双语字幕；
 * 3. 内存 Map 一级缓存 + IndexedDB 二级持久化缓存双层架构；
 * 4. 异常自动降级（无痕模式或禁用存储时静默回退纯内存缓存）；
 * 5. 30 天 TTL 自动清理，避免长期使用后数据库无限膨胀。
 * ============================================================================
 */

const DB_NAME = 'yt_sub_translator_v2_cache';
const DB_VERSION = 2;
const STORE_SENTENCES = 'sentence_cache';
const STORE_VIDEOS = 'video_track_cache'; // 兼容旧库，保留但不写入

// 内存一级缓存（带简单容量上限，防止长会话无限增长）
const memorySentenceCache = new Map<string, string>();
const MEMORY_CACHE_LIMIT = 8000;

// 句子缓存保留时长
const CACHE_TTL_MS = 30 * 24 * 60 * 60 * 1000;

let dbPromise: Promise<IDBDatabase | null> | null = null;
let pruneScheduled = false;

function memorySet(key: string, value: string) {
  if (!memorySentenceCache.has(key) && memorySentenceCache.size >= MEMORY_CACHE_LIMIT) {
    const oldest = memorySentenceCache.keys().next().value;
    if (oldest) memorySentenceCache.delete(oldest);
  }
  memorySentenceCache.set(key, value);
}

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
            const store = db.createObjectStore(STORE_SENTENCES, { keyPath: 'key' });
            store.createIndex('updatedAt', 'updatedAt');
          } else {
            // 老库升级：补建 updatedAt 索引，供 TTL 清理使用
            const tx = (e.target as IDBOpenDBRequest).transaction;
            const store = tx?.objectStore(STORE_SENTENCES);
            if (store && !store.indexNames.contains('updatedAt')) {
              store.createIndex('updatedAt', 'updatedAt');
            }
          }
          if (!db.objectStoreNames.contains(STORE_VIDEOS)) {
            db.createObjectStore(STORE_VIDEOS, { keyPath: 'videoKey' });
          }
        };
        req.onsuccess = () => {
          schedulePrune(req.result);
          resolve(req.result);
        };
        req.onerror = () => {
          console.warn('[DBCache] IndexedDB open error, fallback to memory cache');
          resolve(null);
        };
        // 其他标签页仍持有旧版本连接时，不让调用方无限等待
        req.onblocked = () => {
          console.warn('[DBCache] IndexedDB upgrade blocked by another tab, fallback to memory cache');
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

/**
 * 延迟执行一次过期缓存清理（每个上下文只跑一次）
 */
function schedulePrune(db: IDBDatabase) {
  if (pruneScheduled) return;
  pruneScheduled = true;
  setTimeout(() => {
    try {
      const cutoff = Date.now() - CACHE_TTL_MS;
      const tx = db.transaction(STORE_SENTENCES, 'readwrite');
      const index = tx.objectStore(STORE_SENTENCES).index('updatedAt');
      const req = index.openCursor(IDBKeyRange.upperBound(cutoff));
      let removed = 0;
      req.onsuccess = () => {
        const cursor = req.result;
        if (!cursor) {
          if (removed > 0) console.log(`[DBCache] 已清理 ${removed} 条过期句子缓存`);
          return;
        }
        cursor.delete();
        removed++;
        cursor.continue();
      };
      req.onerror = () => {
        console.warn('[DBCache] 过期缓存清理失败');
      };
    } catch (e) {
      console.warn('[DBCache] 过期缓存清理异常:', e);
    }
  }, 5000);
}

export function buildSentenceCacheKey(
  targetLang: string,
  text: string,
  scenario = 'general',
  reasoning = 'low',
  service = 'google',
  modelName = '',
  glossaryTag = ''
): string {
  // 注意：不能 toLowerCase，否则仅大小写不同的句子会共用译文；
  // modelName 必须参与 key，避免切换模型后复用旧模型译文。
  // glossaryTag（v0.2.8）：术语库版本/状态参与 key，术语变更后旧译文自动失效。
  const model = (modelName || '').trim().toLowerCase();
  const glossary = glossaryTag ? `:${glossaryTag}` : '';
  return `${service}:${model}:${scenario}:${reasoning}:${targetLang}:${text.trim()}${glossary}`;
}

/**
 * 批量读取句子缓存（分块事务，避免一次性发起数千个 IDB 请求）
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

    const CHUNK_SIZE = 200;
    for (let offset = 0; offset < missingKeys.length; offset += CHUNK_SIZE) {
      const chunk = missingKeys.slice(offset, offset + CHUNK_SIZE);
      await new Promise<void>((resolve) => {
        try {
          const tx = db.transaction(STORE_SENTENCES, 'readonly');
          const store = tx.objectStore(STORE_SENTENCES);
          let remaining = chunk.length;

          for (const k of chunk) {
            const req = store.get(k);
            req.onsuccess = () => {
              if (req.result && req.result.translation) {
                memorySet(k, req.result.translation);
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
        } catch (e) {
          resolve();
        }
      });
    }
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
    memorySet(key, translation);
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
 * 清空句子翻译缓存（高级设置页使用）。
 * 直接删除整个 IndexedDB，避免逐条遍历；页面上下文独立，不会影响内容脚本已有句柄。
 */
export async function clearSentenceCache(): Promise<boolean> {
  try {
    const existing = await new Promise<IDBDatabase | null>((resolve) => {
      const req = indexedDB.open(DB_NAME);
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => resolve(null);
    });
    if (!existing) {
      return true;
    }
    existing.close();
    await new Promise<void>((resolve) => {
      const req = indexedDB.deleteDatabase(DB_NAME);
      req.onsuccess = () => resolve();
      req.onerror = () => resolve();
      req.onblocked = () => resolve();
    });
    return true;
  } catch {
    return false;
  }
}
