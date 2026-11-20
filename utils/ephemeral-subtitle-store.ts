import type { SubtitleSentence } from '../types';
import {
  buildAiTrackKey,
  buildAiTrackRecord,
  clearAiTrack,
  clearAllAiTracks,
  getAiTrackStats,
  loadAiTrack,
  pruneAiTracks,
  saveAiTrack,
  type AiTrackMeta,
  type AiTrackRecord,
  type AiTrackStats
} from './ai-track-cache';
import { isExtensionAlive, safeSendMessage } from './runtime-safe';

/**
 * AI 精翻字幕存储器（页内内存 + 扩展源 IndexedDB 整轨持久化）
 * ----------------------------------------------------------------------------
 * 架构要点（v0.6.1）：
 *   1. 内存镜像按 `buildAiTrackKey(meta)`（videoId::targetLang::scenario）隔离，
 *      同视频切语言或场景不再串用旧译文；写入时浅拷贝句子，消除共享数组突变污染；
 *   2. 持久化通过 Background Service Worker 代理读写 `yt_sub_ai_tracks`（扩展源 IDB），
 *      使内容脚本（youtube.com）与高级设置页（chrome-extension://）共享同一份缓存，
 *      彻底解决同源隔离导致的统计为 0 / 清空失效 / TTL 清理失效；
 *   3. 单元测试或无后台监听环境下自动平滑回退本地 `ai-track-cache.ts` 直连。
 */

type TrackMeta = AiTrackMeta & { service?: string; modelName?: string };

interface BgProxyResponse<T> {
  success?: boolean;
  data?: T;
  error?: string;
}

/**
 * 尝试通过 Background Service Worker 代理执行 AI 轨道缓存读写。
 * 若当前环境无扩展运行时或后台未注册对应监听（例如独立 Node 单测），返回 `{ proxied: false }` 回退本地。
 */
function proxyToBackground<T>(msg: unknown): Promise<{ proxied: true; data: T } | { proxied: false }> {
  if (!isExtensionAlive()) {
    return Promise.resolve({ proxied: false });
  }
  return new Promise((resolve) => {
    let settled = false;
    const timer = setTimeout(() => {
      if (settled) return;
      settled = true;
      resolve({ proxied: false });
    }, 4000);
    safeSendMessage<BgProxyResponse<T>>(msg, (r) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      if (r.ok && r.response && r.response.success === true) {
        resolve({ proxied: true, data: r.response.data as T });
        return;
      }
      resolve({ proxied: false });
    });
  });
}

function defaultMetaOf(videoId: string): TrackMeta {
  return { videoId, targetLang: 'zh-CN', scenario: 'general' };
}

function cloneSentences(sentences: SubtitleSentence[]): SubtitleSentence[] {
  return sentences.map((s) => ({ ...s }));
}

export class EphemeralSubtitleStore {
  /** key = buildAiTrackKey(meta) */
  private static memoryCache: Map<string, SubtitleSentence[]> = new Map();
  private static metaByKey: Map<string, TrackMeta> = new Map();
  /** 记录每个 videoId 最近一次使用的 meta，兼容只传 videoId 的旧调用点 */
  private static latestMetaByVideo: Map<string, TrackMeta> = new Map();
  private static createdAtByKey: Map<string, number> = new Map();
  private static flushTimers: Map<string, any> = new Map();
  private static currentBoundVideoId = '';
  private static initialized = false;

  /** 防抖窗口：长视频每批都全量序列化是 O(n²)，2s 足够又不至于丢太多进度 */
  private static readonly FLUSH_DELAY_MS = 2000;

  private static resolveMeta(videoId: string, meta?: TrackMeta): TrackMeta {
    if (meta) {
      return {
        videoId,
        targetLang: meta.targetLang || 'zh-CN',
        scenario: meta.scenario || 'general',
        service: meta.service,
        modelName: meta.modelName
      };
    }
    return this.latestMetaByVideo.get(videoId) || defaultMetaOf(videoId);
  }

  private static keysOfVideo(videoId: string): string[] {
    const prefix = `${videoId}::`;
    return Array.from(this.memoryCache.keys()).filter((k) => k.startsWith(prefix));
  }

  /**
   * 绑定当前视频。只在 pagehide / beforeunload 时把内存里还没落盘的进度 flush 一次。
   */
  public static init(currentVideoId: string) {
    if (this.currentBoundVideoId && this.currentBoundVideoId !== currentVideoId) {
      // 视频切换：释放上一部视频的内存镜像，但**保留**它的 IDB 记录
      this.release(this.currentBoundVideoId);
    }
    this.currentBoundVideoId = currentVideoId;

    if (!this.initialized) {
      this.initialized = true;
      let unloadFlushed = false;
      const flushAll = () => {
        if (unloadFlushed) return;
        unloadFlushed = true;
        for (const key of Array.from(this.memoryCache.keys())) {
          const meta = this.metaByKey.get(key);
          this.flushNow(meta?.videoId || key.split('::')[0], meta);
        }
        setTimeout(() => {
          unloadFlushed = false;
        }, 1000);
      };
      // 只 flush，不删除
      window.addEventListener('pagehide', () => flushAll());
      window.addEventListener('beforeunload', () => flushAll());
    }
  }

  /** 记录当前视频的目标语言 / 场景 / 服务，供落盘时写进记录 */
  public static setMeta(videoId: string, meta: TrackMeta) {
    if (!videoId || !meta) return;
    const normalized = this.resolveMeta(videoId, meta);
    const key = buildAiTrackKey(normalized);
    this.metaByKey.set(key, normalized);
    this.latestMetaByVideo.set(videoId, normalized);
  }

  /**
   * 保存当前视频的 AI 字幕（内存立即生效并浅拷贝快照，IndexedDB 防抖落盘）
   */
  public static save(videoId: string, sentences: SubtitleSentence[], meta?: TrackMeta) {
    if (!videoId) return;
    this.currentBoundVideoId = videoId;
    const resolved = this.resolveMeta(videoId, meta);
    const key = buildAiTrackKey(resolved);
    this.metaByKey.set(key, resolved);
    this.latestMetaByVideo.set(videoId, resolved);
    this.memoryCache.set(key, cloneSentences(sentences));

    const existing = this.flushTimers.get(key);
    if (existing) clearTimeout(existing);
    const timer = setTimeout(() => {
      this.flushTimers.delete(key);
      void this.flushByKey(key);
    }, this.FLUSH_DELAY_MS);
    this.flushTimers.set(key, timer);
  }

  /** 立即落盘（每批翻译结束 / pagehide / 清空前调用） */
  public static flushNow(videoId: string, meta?: TrackMeta) {
    if (!videoId) return;
    if (meta) {
      const key = buildAiTrackKey(this.resolveMeta(videoId, meta));
      const timer = this.flushTimers.get(key);
      if (timer) clearTimeout(timer);
      this.flushTimers.delete(key);
      void this.flushByKey(key);
      return;
    }
    const keys = this.keysOfVideo(videoId);
    for (const key of keys) {
      const timer = this.flushTimers.get(key);
      if (timer) clearTimeout(timer);
      this.flushTimers.delete(key);
      void this.flushByKey(key);
    }
  }

  private static async flushByKey(key: string, snapshot?: { sentences: SubtitleSentence[]; meta: TrackMeta }): Promise<void> {
    const sentences = snapshot?.sentences ?? this.memoryCache.get(key);
    if (!sentences || sentences.length === 0) return;
    const meta = snapshot?.meta ?? this.metaByKey.get(key) ?? defaultMetaOf(key.split('::')[0]);
    const now = Date.now();
    const createdAt = this.createdAtByKey.get(key);
    if (!createdAt) this.createdAtByKey.set(key, now);
    const record = buildAiTrackRecord(
      { ...meta, videoId: meta.videoId },
      sentences,
      now,
      createdAt || now
    );
    const proxied = await proxyToBackground<boolean>({
      type: 'AI_TRACK_SAVE',
      payload: { record }
    });
    if (!proxied.proxied) {
      await saveAiTrack(record);
    }
  }

  /**
   * 仅读内存（按 videoId + targetLang + scenario 隔离；不传 meta 时读取该视频最近一次 meta）
   */
  public static load(videoId: string, meta?: TrackMeta): SubtitleSentence[] | null {
    if (!videoId) return null;
    const resolved = this.resolveMeta(videoId, meta);
    const key = buildAiTrackKey(resolved);
    return this.memoryCache.get(key) || null;
  }

  /**
   * 从 IndexedDB（优先经后台扩展源代理）取整轨记录并镜像进内存
   */
  public static async hydrate(videoId: string, meta?: TrackMeta): Promise<AiTrackRecord | null> {
    if (!videoId) return null;
    if (meta) this.setMeta(videoId, meta);
    const resolved = this.resolveMeta(videoId, meta);
    const key = buildAiTrackKey(resolved);

    const proxied = await proxyToBackground<AiTrackRecord | null>({
      type: 'AI_TRACK_LOAD',
      payload: {
        videoId,
        targetLang: resolved.targetLang,
        scenario: resolved.scenario
      }
    });
    const record = proxied.proxied
      ? proxied.data
      : await loadAiTrack({
          videoId,
          targetLang: resolved.targetLang,
          scenario: resolved.scenario
        });

    if (!record) return null;
    if (record.createdAt) this.createdAtByKey.set(key, record.createdAt);
    if (
      record.sentences.length > 0 &&
      record.done > 0 &&
      !this.memoryCache.has(key)
    ) {
      this.memoryCache.set(
        key,
        record.sentences.map((s) => ({
          id: s.id,
          start: s.start,
          end: s.end,
          text: s.text,
          translation: s.translation,
          status: s.status,
          isAi: s.isAi
        }))
      );
      this.metaByKey.set(key, resolved);
    }
    return record;
  }

  /**
   * 只释放内存（切视频用）。**不动磁盘记录**——这正是「重看还能续翻」的关键。
   */
  public static release(videoId: string) {
    if (!videoId) return;
    const keys = this.keysOfVideo(videoId);
    for (const key of keys) {
      const timer = this.flushTimers.get(key);
      if (timer) clearTimeout(timer);
      this.flushTimers.delete(key);
      const sentences = this.memoryCache.get(key);
      const meta = this.metaByKey.get(key) || defaultMetaOf(videoId);
      if (sentences && sentences.length > 0) {
        void this.flushByKey(key, { sentences, meta });
      }
      this.memoryCache.delete(key);
      this.metaByKey.delete(key);
      this.createdAtByKey.delete(key);
    }
    this.latestMetaByVideo.delete(videoId);
  }

  /**
   * 彻底删除：内存 + IndexedDB（「清空 AI 字幕缓存」按钮用）
   */
  public static async clear(videoId?: string): Promise<number> {
    if (videoId) {
      for (const key of this.keysOfVideo(videoId)) {
        const timer = this.flushTimers.get(key);
        if (timer) clearTimeout(timer);
        this.flushTimers.delete(key);
        this.memoryCache.delete(key);
        this.metaByKey.delete(key);
        this.createdAtByKey.delete(key);
      }
      this.latestMetaByVideo.delete(videoId);
      const proxied = await proxyToBackground<number>({
        type: 'AI_TRACK_CLEAR',
        payload: { videoId }
      });
      const removed = proxied.proxied ? proxied.data : await clearAiTrack(videoId);
      console.log(`[AiTrack] 已清空 videoId=${videoId} 的 AI 精翻缓存（${removed} 条）`);
      return removed;
    }

    for (const timer of this.flushTimers.values()) clearTimeout(timer);
    this.flushTimers.clear();
    this.memoryCache.clear();
    this.metaByKey.clear();
    this.latestMetaByVideo.clear();
    this.createdAtByKey.clear();
    const proxied = await proxyToBackground<number>({ type: 'AI_TRACK_CLEAR_ALL' });
    return proxied.proxied ? proxied.data : await clearAllAiTracks();
  }

  /** 设置页统计 */
  public static async stats(): Promise<AiTrackStats> {
    const proxied = await proxyToBackground<AiTrackStats>({ type: 'AI_TRACK_STATS' });
    return proxied.proxied ? proxied.data : await getAiTrackStats();
  }

  /** 按保留时长清理（0 = 永久，不清理） */
  public static async prune(ttlHours: number): Promise<number> {
    const proxied = await proxyToBackground<number>({
      type: 'AI_TRACK_PRUNE',
      payload: { ttlHours }
    });
    return proxied.proxied ? proxied.data : await pruneAiTracks(ttlHours);
  }
}
