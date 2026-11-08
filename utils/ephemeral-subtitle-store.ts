import type { SubtitleSentence } from '../types';
import {
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

/**
 * AI 精翻字幕存储器（页内内存 + IndexedDB 整轨持久化）
 * ----------------------------------------------------------------------------
 * v0.4.1 及之前：内存 + sessionStorage，并在 beforeunload / pagehide / 切视频时
 * **主动删除**——这就是「刷新或重看，AI 精翻字幕消失、必须重翻」的直接原因。
 *
 * 现在两层职责分开：
 *   1. 内存镜像：页内快进快退零延迟，切换视频时只释放内存（**不删盘**）；
 *   2. IndexedDB：整轨落盘（见 utils/ai-track-cache.ts），防抖 2s 写一次，
 *      pagehide 时再 flush 一次就放行，绝不删除。
 *
 * `clear()` 是唯一会动盘的入口，只由「清空当前视频 AI 字幕缓存」按钮调用。
 */

type TrackMeta = AiTrackMeta & { service?: string; modelName?: string };

export class EphemeralSubtitleStore {
  private static memoryCache: Map<string, SubtitleSentence[]> = new Map();
  private static metaByVideo: Map<string, TrackMeta> = new Map();
  private static createdAtByVideo: Map<string, number> = new Map();
  private static flushTimers: Map<string, any> = new Map();
  private static currentBoundVideoId = '';
  private static initialized = false;

  /** 防抖窗口：长视频每批都全量序列化是 O(n²)，2s 足够又不至于丢太多进度 */
  private static readonly FLUSH_DELAY_MS = 2000;

  /**
   * 绑定当前视频。**不再注册任何销毁逻辑**；只在 pagehide / beforeunload
   * 时把内存里还没落盘的进度 flush 一次，然后照常离开页面。
   */
  public static init(currentVideoId: string) {
    if (this.currentBoundVideoId && this.currentBoundVideoId !== currentVideoId) {
      // 视频切换：释放上一部视频的内存镜像，但**保留**它的 IDB 记录
      this.release(this.currentBoundVideoId);
    }
    this.currentBoundVideoId = currentVideoId;

    if (!this.initialized) {
      this.initialized = true;
      const flushAll = () => {
        for (const videoId of Array.from(this.memoryCache.keys())) {
          this.flushNow(videoId);
        }
      };
      // 只 flush，不删除
      window.addEventListener('pagehide', flushAll);
      window.addEventListener('beforeunload', flushAll);
    }
  }

  /** 记录当前视频的目标语言 / 场景 / 服务，供落盘时写进记录 */
  public static setMeta(videoId: string, meta: TrackMeta) {
    if (!videoId || !meta) return;
    this.metaByVideo.set(videoId, {
      videoId,
      targetLang: meta.targetLang,
      scenario: meta.scenario,
      service: meta.service,
      modelName: meta.modelName
    });
  }

  /**
   * 保存当前视频的 AI 字幕（内存立即生效，IndexedDB 防抖落盘）
   */
  public static save(videoId: string, sentences: SubtitleSentence[], meta?: TrackMeta) {
    if (!videoId) return;
    this.currentBoundVideoId = videoId;
    this.memoryCache.set(videoId, sentences);
    if (meta) this.setMeta(videoId, meta);

    const existing = this.flushTimers.get(videoId);
    if (existing) clearTimeout(existing);
    const timer = setTimeout(() => {
      this.flushTimers.delete(videoId);
      void this.flush(videoId);
    }, this.FLUSH_DELAY_MS);
    this.flushTimers.set(videoId, timer);
  }

  /** 立即落盘（每批翻译结束 / pagehide / 清空前调用） */
  public static flushNow(videoId: string) {
    const timer = this.flushTimers.get(videoId);
    if (timer) clearTimeout(timer);
    this.flushTimers.delete(videoId);
    void this.flush(videoId);
  }

  private static async flush(videoId: string): Promise<void> {
    const sentences = this.memoryCache.get(videoId);
    if (!sentences || sentences.length === 0) return;
    const meta = this.metaByVideo.get(videoId) || {
      videoId,
      targetLang: 'zh-CN',
      scenario: 'general'
    };
    const now = Date.now();
    const createdAt = this.createdAtByVideo.get(videoId);
    if (!createdAt) this.createdAtByVideo.set(videoId, now);
    const record = buildAiTrackRecord(
      { ...meta, videoId },
      sentences,
      now,
      createdAt || now
    );
    await saveAiTrack(record);
  }

  /**
   * 仅读内存（快进/快退/同一页内重渲染）。IDB 读取请用 hydrate()。
   */
  public static load(videoId: string): SubtitleSentence[] | null {
    if (!videoId) return null;
    return this.memoryCache.get(videoId) || null;
  }

  /**
   * 从 IndexedDB 取整轨记录并镜像进内存（刷新 / 重新打开视频后的第一次读）。
   * 返回 null = 本地没有这条视频的记录。
   */
  public static async hydrate(videoId: string, meta?: TrackMeta): Promise<AiTrackRecord | null> {
    if (!videoId) return null;
    if (meta) this.setMeta(videoId, meta);
    const resolved = this.metaByVideo.get(videoId) || {
      videoId,
      targetLang: meta?.targetLang || 'zh-CN',
      scenario: meta?.scenario || 'general'
    };
    const record = await loadAiTrack({
      videoId,
      targetLang: resolved.targetLang,
      scenario: resolved.scenario
    });
    if (!record) return null;
    if (record.createdAt) this.createdAtByVideo.set(videoId, record.createdAt);
    // 镜像到内存：与整轨等长且至少有一句译文时才镜像，避免污染当前渲染
    if (
      record.sentences.length > 0 &&
      record.done > 0 &&
      !this.memoryCache.has(videoId)
    ) {
      this.memoryCache.set(
        videoId,
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
    }
    return record;
  }

  /**
   * 只释放内存（切视频用）。**不动磁盘记录**——这正是「重看还能续翻」的关键。
   */
  public static release(videoId: string) {
    if (!videoId) return;
    const timer = this.flushTimers.get(videoId);
    if (timer) clearTimeout(timer);
    this.flushTimers.delete(videoId);
    // 先落盘再丢内存，避免切走时最后一批还没写
    if (this.memoryCache.has(videoId)) this.flushNow(videoId);
    this.memoryCache.delete(videoId);
    this.createdAtByVideo.delete(videoId);
  }

  /**
   * 彻底删除：内存 + IndexedDB（「清空 AI 字幕缓存」按钮 & 需要强制执行时用）
   */
  public static async clear(videoId?: string): Promise<number> {
    if (videoId) {
      const timer = this.flushTimers.get(videoId);
      if (timer) clearTimeout(timer);
      this.flushTimers.delete(videoId);
      this.memoryCache.delete(videoId);
      this.createdAtByVideo.delete(videoId);
      const removed = await clearAiTrack(videoId);
      console.log(`[AiTrack] 已清空 videoId=${videoId} 的 AI 精翻缓存（${removed} 条）`);
      return removed;
    }

    for (const timer of this.flushTimers.values()) clearTimeout(timer);
    this.flushTimers.clear();
    this.memoryCache.clear();
    this.createdAtByVideo.clear();
    return await clearAllAiTracks();
  }

  /** 设置页统计 */
  public static async stats(): Promise<AiTrackStats> {
    return getAiTrackStats();
  }

  /** 按保留时长清理（0 = 永久，不清理） */
  public static async prune(ttlHours: number): Promise<number> {
    return pruneAiTracks(ttlHours);
  }
}
