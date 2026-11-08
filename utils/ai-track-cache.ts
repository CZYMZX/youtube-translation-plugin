/**
 * ============================================================================
 * AI 深度精翻字幕 · 整轨持久化缓存（IndexedDB，独立库）
 * ----------------------------------------------------------------------------
 * 为什么单独开一个库：db-cache.ts 的 `yt_sub_translator_v2_cache` 存的是「逐句
 * 译文」，库版本已经升到 2、带 30 天 TTL；往里加 store 就要动版本号，升级过程中
 * 可能被用户其他标签页的旧连接阻塞，一旦失败会连带毁掉已有 30 天句子缓存。
 * 这里用独立的 `yt_sub_ai_tracks`（版本 1），互不影响。
 *
 * 三层职责：
 *   1. 纯函数：buildAiTrackKey / hashSource / planResume / buildResumeBatches
 *      —— 不碰 IO，可单测（test/test-ai-track.js）。
 *   2. 持久化：loadAiTrack / saveAiTrack / clearAiTrack / pruneAiTracks / getAiTrackStats
 *      —— 打不开库、无痕、配额超限一律静默降级为内存 Map，绝不把异常抛到界面。
 *   3. 索引：主键 `key`（videoId::lang::scenario），索引 `updatedAt` 供 TTL 清理用。
 * ============================================================================
 */

import type { SubtitleSentence } from '../types';

const DB_NAME = 'yt_sub_ai_tracks';
const DB_VERSION = 1;
const STORE_TRACKS = 'tracks';
const INDEX_UPDATED_AT = 'updatedAt';

/** 每批送多少句给模型（与 content 脚本一致；抽出来是为了让测试与实现同源） */
export const AI_TRACK_BATCH_SIZE = 12;
/** 续翻时向上取几「句」原文+已有译文作语境参考 */
export const AI_TRACK_CONTEXT_WINDOW = 2;
/**
 * 对齐率下限：源指纹不一致时按 id+原文逐条对齐，能对上的比例低于这个值就判为
 * 「换了一条字幕轨」，整条记录不可复用。
 *
 * 分母用的是**缓存里本来有多少条译文**（而不是当前总句数）：
 *   - 用总句数当分母时，一条只翻了 5/12 的记录只要用户改了一句，比例就掉到
 *     0.33，把 4 条本来还能用的译文一起丢掉 —— 正好毁掉「续翻」的价值；
 *   - 用「缓存里可复用的译文条数」当分母，问的就是真问题：手头这些译文还有
 *     多少能对上？全变（0/N）或大部分对不上（< 50%）才判换轨。
 *
 * 阈值取 0.5 的理由：译文只在**原文完全一致**时才会灌回，所以复用本身不会写错
 * 字；阈值只决定「要不要告诉用户轨道变了 / 要不要从零重翻」。同一条 ASR 轨道
 * 因 YouTube 重新生成而微调时，绝大多数句子仍逐字相同（比例接近 1）；换成官方
 * 字幕轨或另一种语言时几乎一句都对不上（比例接近 0）。0.5 落在这两个簇中间。
 */
export const AI_TRACK_ALIGN_MIN_RATIO = 0.5;
/** 允许的保留时长（小时）；0 = 永久 */
export const ALLOWED_AI_CACHE_TTL_HOURS = [24, 168, 720, 0] as const;
/** 默认 30 天 */
export const DEFAULT_AI_CACHE_TTL_HOURS = 720;

export type AiCacheTtlHours = (typeof ALLOWED_AI_CACHE_TTL_HOURS)[number];

/* ══════════════════════════ 数据结构 ══════════════════════════ */

export interface AiTrackMeta {
  videoId: string;
  targetLang: string;
  scenario: string;
}

/** 落盘时的句子形态：只留渲染与续翻需要的字段，不带 rawTokens（体积能省一半） */
export interface AiTrackSentence {
  id: number;
  start: number;
  end: number;
  text: string;
  translation?: string;
  status: 'idle' | 'translating' | 'done' | 'error';
  isAi?: boolean;
}

export interface AiTrackRecord {
  /** 主键：buildAiTrackKey() */
  key: string;
  videoId: string;
  targetLang: string;
  scenario: string;
  /** 源字幕指纹：换了 CC 轨道就别复用（hashSource） */
  sourceHash: string;
  sentences: AiTrackSentence[];
  total: number;
  done: number;
  createdAt: number;
  updatedAt: number;
  service: string;
  modelName: string;
}

export interface AiTrackStats {
  count: number;
  /** 大致字节数：按 JSON 文本长度 × 2（UTF-16）估算，只用于给用户一个量级 */
  bytes: number;
}

export type AiResumeReason =
  | 'no_cache'
  | 'meta_mismatch'
  | 'exact'
  | 'aligned'
  | 'no_text_match'
  | 'low_overlap';

export interface AiResumePlan {
  reusable: boolean;
  reason: AiResumeReason;
  /** 已灌回译文的句数 */
  restored: number;
  /** 仍缺译文的句数（= sentences.length - restored） */
  pending: number;
  /** 与 currentSentences 等长、可直接交给浮层渲染的句子数组 */
  sentences: SubtitleSentence[];
}

/** 续翻批次：只含缺译文的句子，并带紧邻上文作为语境参考 */
export interface AiResumeBatch {
  /** 本批句子在整轨中的下标（升序） */
  indices: number[];
  texts: string[];
  /** 紧邻上文（最多 AI_TRACK_CONTEXT_WINDOW 句），只用于理解指代与语气 */
  contextBefore: Array<{ text: string; translation: string }>;
}

/* ══════════════════════════ 纯函数 ══════════════════════════ */

/**
 * 主键 = `videoId::targetLang::scenario`。
 *
 * 刻意**不把源指纹放进 key**：
 *   - 指纹放进 key，换轨后 load 直接 miss，「检测到字幕轨道变了」就无从判断，
 *     也没法覆盖掉旧记录（会留下一条永远读不到的垃圾）；
 *   - 指纹留在记录里，planResume 就能比较并给出 reason。
 */
export function buildAiTrackKey(meta: AiTrackMeta): string {
  const videoId = String(meta?.videoId ?? '').trim();
  const targetLang = String(meta?.targetLang ?? '').trim() || 'zh-CN';
  const scenario = String(meta?.scenario ?? '').trim() || 'general';
  return `${videoId}::${targetLang}::${scenario}`;
}

/** 指纹归一化：折叠空白，忽略「空格多一个/少一个」这种无意义差异 */
function normalizeForHash(text: unknown): string {
  return String(text ?? '')
    .replace(/\s+/g, ' ')
    .trim();
}

/**
 * 源字幕指纹（FNV-1a 32bit，带句数前缀）。
 * 同一份句子序列必须得到同一个值；任何一句原文变了都必须变。
 */
export function hashSource(sentences: Array<{ text?: string }> | null | undefined): string {
  const list = Array.isArray(sentences) ? sentences : [];
  let h = 0x811c9dc5;
  const feed = (s: string) => {
    for (let i = 0; i < s.length; i++) {
      h ^= s.charCodeAt(i);
      h = Math.imul(h, 0x01000193) >>> 0;
    }
  };
  feed(String(list.length));
  feed('\u0000');
  for (const item of list) {
    feed(normalizeForHash(item?.text));
    feed('\u0001');
  }
  return `v1-${h.toString(16).padStart(8, '0')}`;
}

function cloneIdle(sentence: SubtitleSentence): SubtitleSentence {
  return {
    id: sentence.id,
    start: sentence.start,
    end: sentence.end,
    text: sentence.text,
    rawTokens: sentence.rawTokens,
    translation: undefined,
    status: 'idle',
    isAi: false
  };
}

function resetAll(base: SubtitleSentence[]): SubtitleSentence[] {
  return base.map(cloneIdle);
}

/**
 * 续翻判定（纯函数，无 IO）—— 这是「刷新后不用重翻」的核心。
 *
 * 规则：
 *   1. 没有记录 → 不可复用（no_cache）；
 *   2. 目标语言 / 场景不一致 → 不可复用（meta_mismatch），换语言必须重翻；
 *   3. 源指纹一致 → 直接按 id 灌回已有译文（exact）；
 *   4. 源指纹不一致（句子数或原文变了）→ 按 id + 原文逐条对齐：
 *      - 一句都对不上 → 不可复用（no_text_match，通常是换了 CC 轨）；
 *      - 对上的比例 < AI_TRACK_ALIGN_MIN_RATIO → 不可复用（low_overlap）；
 *      - 否则复用对得上的那些（aligned），对不上的留空等续翻。
 */
export function planResume(
  cached: AiTrackRecord | null | undefined,
  currentSentences: SubtitleSentence[] | null | undefined,
  meta?: { targetLang?: string; scenario?: string }
): AiResumePlan {
  const current = Array.isArray(currentSentences) ? currentSentences : [];
  const base = resetAll(current);

  if (!cached || !Array.isArray(cached.sentences) || cached.sentences.length === 0) {
    return { reusable: false, reason: 'no_cache', restored: 0, pending: current.length, sentences: base };
  }
  if (
    meta &&
    ((meta.targetLang && cached.targetLang !== meta.targetLang) ||
      (meta.scenario && cached.scenario !== meta.scenario))
  ) {
    return { reusable: false, reason: 'meta_mismatch', restored: 0, pending: current.length, sentences: base };
  }

  const byId = new Map<number, AiTrackSentence>();
  const byText = new Map<string, AiTrackSentence>();
  for (const s of cached.sentences) {
    if (!s) continue;
    if (typeof s.id === 'number') byId.set(s.id, s);
    const key = normalizeForHash(s.text);
    if (key && !byText.has(key)) byText.set(key, s);
  }

  let restored = 0;
  for (let i = 0; i < base.length; i++) {
    const want = base[i];
    const wantText = normalizeForHash(want.text);
    const sameId = byId.get(want.id);
    // **原文不完全一致就不复用**：只按 id 灌回会把上一版断句的译文贴到新句子上。
    // 同 id 且原文一致优先，其次按原文在全表里找唯一命中（应对外部多删/多插一句）。
    const hit = sameId && normalizeForHash(sameId.text) === wantText ? sameId : byText.get(wantText) || null;
    if (!hit) continue;
    const translation = typeof hit.translation === 'string' ? hit.translation : '';
    if (!translation.trim()) continue;
    base[i].translation = translation;
    base[i].status = 'done';
    base[i].isAi = true;
    restored++;
  }

  const exact = cached.sourceHash === hashSource(current);
  const pending = base.length - restored;

  if (exact) {
    return { reusable: true, reason: 'exact', restored, pending, sentences: base };
  }
  if (restored === 0) {
    return { reusable: false, reason: 'no_text_match', restored: 0, pending: current.length, sentences: resetAll(current) };
  }
  const cachedDone = cached.sentences.filter(
    (s) => typeof s?.translation === 'string' && s.translation.trim()
  ).length;
  const denominator = Math.max(1, Math.min(base.length, cachedDone));
  if (restored / denominator < AI_TRACK_ALIGN_MIN_RATIO) {
    return { reusable: false, reason: 'low_overlap', restored: 0, pending: current.length, sentences: resetAll(current) };
  }
  return { reusable: true, reason: 'aligned', restored, pending, sentences: base };
}

/**
 * 续翻批次规划（纯函数）—— 只挑「还没 AI 精翻过」的句子，按句序切批、附紧邻上文。
 *
 * 为什么「完成」以 `isAi` 为准、而不是「有没有译文」：页内机器翻译管线会先把
 * 缺口填上（几十毫秒就铺满当前窗口），若把机翻也算完成，用户点「AI 深度精翻」
 * 就会看到「已完成 12/12」却一句都没翻 —— 续翻按钮直接变成空转。
 * 机翻译文仍照常显示，只是 AI 精翻会把它覆盖成更好的版本。
 *
 * 「上文」取的是整轨里本批第一句之前的 AI_TRACK_CONTEXT_WINDOW 句（不取本批内的），
 * 因为批内句子本来就在同一次请求里，模型能自己看到前后关系。
 */
export function buildResumeBatches(
  sentences: SubtitleSentence[] | null | undefined,
  options?: { batchSize?: number; contextWindow?: number }
): AiResumeBatch[] {
  const list = Array.isArray(sentences) ? sentences : [];
  const batchSize = Math.max(1, Math.floor(options?.batchSize ?? AI_TRACK_BATCH_SIZE));
  const contextWindow = Math.max(0, Math.floor(options?.contextWindow ?? AI_TRACK_CONTEXT_WINDOW));

  const isAiDone = (s: SubtitleSentence): boolean =>
    s.isAi === true && typeof s.translation === 'string' && !!s.translation.trim();

  const pendingIdx: number[] = [];
  for (let i = 0; i < list.length; i++) {
    const s = list[i];
    if (!s) continue;
    if (isAiDone(s)) continue;
    pendingIdx.push(i);
  }

  const batches: AiResumeBatch[] = [];
  for (let start = 0; start < pendingIdx.length; start += batchSize) {
    const group = pendingIdx.slice(start, start + batchSize);
    const first = group[0];
    const contextBefore: Array<{ text: string; translation: string }> = [];
    if (contextWindow > 0 && first > 0) {
      const from = Math.max(0, first - contextWindow);
      for (let i = from; i < first; i++) {
        const s = list[i];
        if (!s || !String(s.text ?? '').trim()) continue;
        contextBefore.push({
          text: s.text,
          translation: typeof s.translation === 'string' ? s.translation : ''
        });
      }
    }
    batches.push({
      indices: group,
      texts: group.map((i) => list[i].text),
      contextBefore
    });
  }
  return batches;
}

/** 把运行中的句子数组压成落盘形态并统计进度 */
export function buildAiTrackRecord(
  meta: AiTrackMeta & { service?: string; modelName?: string },
  sentences: SubtitleSentence[],
  now = Date.now(),
  createdAt?: number
): AiTrackRecord {
  const rows: AiTrackSentence[] = (Array.isArray(sentences) ? sentences : []).map((s) => ({
    id: s.id,
    start: s.start,
    end: s.end,
    text: s.text,
    translation: s.translation,
    status: s.status,
    isAi: s.isAi
  }));
  const done = rows.filter((s) => typeof s.translation === 'string' && s.translation.trim()).length;
  return {
    key: buildAiTrackKey(meta),
    videoId: String(meta.videoId ?? ''),
    targetLang: String(meta.targetLang ?? '') || 'zh-CN',
    scenario: String(meta.scenario ?? '') || 'general',
    sourceHash: hashSource(rows),
    sentences: rows,
    total: rows.length,
    done,
    createdAt: typeof createdAt === 'number' && createdAt > 0 ? createdAt : now,
    updatedAt: now,
    service: String(meta.service ?? ''),
    modelName: String(meta.modelName ?? '')
  };
}

/**
 * 打开视频 / 点「AI 深度精翻」时该干什么（纯函数）。
 * - restore_only：本地已全篇完整，只要铺出来，**零请求**；
 * - prompt_resume：只翻了一半且是 manual 模式 → 恢复已翻部分 + 提示用户，
 *   等他自己再点一次（不擅自烧 token）；
 * - run：真去发请求（只翻缺译文的句子）。
 */
export type AiRunAction = 'restore_only' | 'prompt_resume' | 'run';

export function decideAiRunAction(
  plan: AiResumePlan | null | undefined,
  mode: 'auto' | 'manual' | undefined
): AiRunAction {
  if (plan && plan.pending === 0 && plan.restored > 0) return 'restore_only';
  if (plan && plan.pending > 0 && plan.restored > 0 && mode !== 'auto') return 'prompt_resume';
  return 'run';
}

/** TTL 判定（纯函数，供 prune 与单测共用）：0 = 永久，永不判定为过期 */
export function isAiTrackExpired(updatedAt: number, ttlHours: number, now = Date.now()): boolean {
  if (!ttlHours || ttlHours <= 0) return false;
  if (!Number.isFinite(updatedAt) || updatedAt <= 0) return false;
  return now - updatedAt > ttlHours * 3600 * 1000;
}

/* ══════════════════════════ 持久化（静默降级） ══════════════════════════ */

/** 内存镜像：库打不开时的唯一载体，同时也是读缓存 */
const memoryTracks = new Map<string, AiTrackRecord>();
let dbPromise: Promise<IDBDatabase | null> | null = null;
let degradedWarned = false;

function warnDegraded(reason: string, detail?: unknown) {
  if (degradedWarned) return;
  degradedWarned = true;
  console.warn(`[AiTrack] IndexedDB 不可用（${reason}），AI 精翻缓存降级为内存（刷新后不再保留）`, detail ?? '');
}

function getDB(): Promise<IDBDatabase | null> {
  if (typeof indexedDB === 'undefined') {
    warnDegraded('no indexedDB');
    return Promise.resolve(null);
  }
  if (!dbPromise) {
    dbPromise = new Promise((resolve) => {
      try {
        const req = indexedDB.open(DB_NAME, DB_VERSION);
        req.onupgradeneeded = (e) => {
          const db = (e.target as IDBOpenDBRequest).result;
          if (!db.objectStoreNames.contains(STORE_TRACKS)) {
            const store = db.createObjectStore(STORE_TRACKS, { keyPath: 'key' });
            store.createIndex(INDEX_UPDATED_AT, 'updatedAt');
          } else {
            const tx = (e.target as IDBOpenDBRequest).transaction;
            const store = tx?.objectStore(STORE_TRACKS);
            if (store && !store.indexNames.contains(INDEX_UPDATED_AT)) {
              store.createIndex(INDEX_UPDATED_AT, 'updatedAt');
            }
          }
        };
        req.onsuccess = () => resolve(req.result);
        req.onerror = () => {
          warnDegraded('open error', req.error);
          resolve(null);
        };
        // 其他标签页仍持有旧连接时不让调用方无限等待
        req.onblocked = () => {
          warnDegraded('open blocked');
          resolve(null);
        };
      } catch (err) {
        warnDegraded('open throw', err);
        resolve(null);
      }
    });
  }
  return dbPromise;
}

function storeOf(db: IDBDatabase, mode: IDBTransactionMode): IDBObjectStore {
  return db.transaction(STORE_TRACKS, mode).objectStore(STORE_TRACKS);
}

export async function loadAiTrack(meta: AiTrackMeta): Promise<AiTrackRecord | null> {
  const key = buildAiTrackKey(meta);
  if (!key || key.startsWith('::')) return null;
  const mem = memoryTracks.get(key);
  if (mem) return mem;

  const db = await getDB();
  if (!db) return null;
  try {
    const record = await new Promise<AiTrackRecord | null>((resolve) => {
      const req = storeOf(db, 'readonly').get(key);
      req.onsuccess = () => resolve((req.result as AiTrackRecord) || null);
      req.onerror = () => resolve(null);
    });
    if (record) memoryTracks.set(key, record);
    return record;
  } catch {
    return null;
  }
}

/**
 * 写入整轨记录。失败（配额 / 事务中止）只记录一次告警，内存里那条仍在，
 * 本页继续可用；绝不 throw 到调用方（翻译循环不能被存储问题打断）。
 */
export async function saveAiTrack(record: AiTrackRecord): Promise<boolean> {
  if (!record || !record.key) return false;
  memoryTracks.set(record.key, record);

  const db = await getDB();
  if (!db) return false;
  try {
    await new Promise<void>((resolve, reject) => {
      const tx = db.transaction(STORE_TRACKS, 'readwrite');
      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error);
      tx.onabort = () => reject(tx.error);
      try {
        tx.objectStore(STORE_TRACKS).put(record);
      } catch (e) {
        reject(e);
      }
    });
    return true;
  } catch (e) {
    warnDegraded('write failed', e);
    return false;
  }
}

/** 删除某个视频的全部记录（所有语言 / 场景），返回删除条数 */
export async function clearAiTrack(videoId: string): Promise<number> {
  const vid = String(videoId ?? '').trim();
  if (!vid) return 0;
  const prefix = `${vid}::`;

  let removed = 0;
  for (const key of Array.from(memoryTracks.keys())) {
    if (key.startsWith(prefix)) {
      memoryTracks.delete(key);
      removed++;
    }
  }

  const db = await getDB();
  if (!db) return removed;
  try {
    const dbRemoved = await new Promise<number>((resolve) => {
      let n = 0;
      const tx = db.transaction(STORE_TRACKS, 'readwrite');
      const req = tx.objectStore(STORE_TRACKS).openCursor();
      req.onsuccess = () => {
        const cursor = req.result;
        if (!cursor) return;
        const key = String((cursor.value as AiTrackRecord)?.key ?? cursor.key ?? '');
        if (key.startsWith(prefix)) {
          cursor.delete();
          n++;
        }
        cursor.continue();
      };
      req.onerror = () => resolve(n);
      tx.oncomplete = () => resolve(n);
      tx.onerror = () => resolve(n);
      tx.onabort = () => resolve(n);
    });
    return Math.max(removed, dbRemoved);
  } catch {
    return removed;
  }
}

/** 清空所有视频 / 所有语言 / 所有场景的记录 */
export async function clearAllAiTracks(): Promise<number> {
  const n = memoryTracks.size;
  memoryTracks.clear();
  const db = await getDB();
  if (!db) return n;
  try {
    return await new Promise<number>((resolve) => {
      const tx = db.transaction(STORE_TRACKS, 'readwrite');
      const req = tx.objectStore(STORE_TRACKS).count();
      let total = n;
      req.onsuccess = () => {
        total = Math.max(total, Number(req.result) || 0);
      };
      req.onerror = () => {};
      tx.objectStore(STORE_TRACKS).clear();
      tx.oncomplete = () => resolve(total);
      tx.onerror = () => resolve(n);
      tx.onabort = () => resolve(n);
    });
  } catch {
    return n;
  }
}

/**
 * 按保留时长清理。ttlHours = 0 表示永久，直接返回 0（不删任何东西）。
 * 返回删除条数，便于设置页在改短 TTL 后给出确切反馈。
 */
export async function pruneAiTracks(ttlHours: number, now = Date.now()): Promise<number> {
  const ttl = Number(ttlHours);
  if (!Number.isFinite(ttl) || ttl <= 0) return 0;
  const cutoff = now - ttl * 3600 * 1000;

  let removed = 0;
  for (const [key, record] of Array.from(memoryTracks.entries())) {
    if (isAiTrackExpired(record.updatedAt, ttl, now)) {
      memoryTracks.delete(key);
      removed++;
    }
  }

  const db = await getDB();
  if (!db) return removed;
  try {
    const dbRemoved = await new Promise<number>((resolve) => {
      let n = 0;
      const tx = db.transaction(STORE_TRACKS, 'readwrite');
      const index = tx.objectStore(STORE_TRACKS).index(INDEX_UPDATED_AT);
      const req = index.openCursor(IDBKeyRange.upperBound(cutoff));
      req.onsuccess = () => {
        const cursor = req.result;
        if (!cursor) return;
        cursor.delete();
        n++;
        cursor.continue();
      };
      req.onerror = () => resolve(n);
      tx.oncomplete = () => resolve(n);
      tx.onerror = () => resolve(n);
      tx.onabort = () => resolve(n);
    });
    return Math.max(removed, dbRemoved);
  } catch {
    return removed;
  }
}

/** 设置页统计：条数 + 大致字节数 */
export async function getAiTrackStats(): Promise<AiTrackStats> {
  let count = memoryTracks.size;
  let bytes = 0;
  for (const record of memoryTracks.values()) {
    try {
      bytes += JSON.stringify(record).length * 2;
    } catch {
      /* 循环引用不可能出现，兜底忽略 */
    }
  }

  const db = await getDB();
  if (!db) return { count, bytes };
  try {
    const fromDb = await new Promise<AiTrackStats>((resolve) => {
      let n = 0;
      let size = 0;
      const tx = db.transaction(STORE_TRACKS, 'readonly');
      const req = tx.objectStore(STORE_TRACKS).openCursor();
      req.onsuccess = () => {
        const cursor = req.result;
        if (!cursor) return;
        n++;
        try {
          size += JSON.stringify(cursor.value).length * 2;
        } catch {
          /* 单条序列化失败不影响整体统计 */
        }
        cursor.continue();
      };
      req.onerror = () => resolve({ count: n, bytes: size });
      tx.oncomplete = () => resolve({ count: n, bytes: size });
      tx.onerror = () => resolve({ count: n, bytes: size });
      tx.onabort = () => resolve({ count: n, bytes: size });
    });
    return { count: Math.max(count, fromDb.count), bytes: Math.max(bytes, fromDb.bytes) };
  } catch {
    return { count, bytes };
  }
}
