import type { SubtitleSentence } from '../types';

/**
 * 针对当前视频的临时 AI 字幕存储器 (Ephemeral Subtitle Store)
 * 严格生命周期管理：
 * 1. 仅在当前视频播放期间临时保留在本地 (内存 + 标签页会话 sessionStorage)
 * 2. 视频切换 (SPA 跳转) 或页面关闭/刷新时，自动从本地彻底销毁清空
 * 3. 避免任何冗余磁盘残留，播放期间快进快退零延迟秒级复用
 */
export class EphemeralSubtitleStore {
  private static memoryCache: Map<string, SubtitleSentence[]> = new Map();
  private static initialized = false;
  private static currentBoundVideoId: string = '';

  private static getStorageKey(videoId: string): string {
    return `yt_sub_ai_temp_${videoId}`;
  }

  public static init(currentVideoId: string) {
    if (this.currentBoundVideoId && this.currentBoundVideoId !== currentVideoId) {
      // 视频已切换，自动清除上一部视频的临时 AI 字幕
      this.clear(this.currentBoundVideoId);
    }
    this.currentBoundVideoId = currentVideoId;

    if (!this.initialized) {
      this.initialized = true;

      // 监听窗口关闭/刷新/离开，自动彻底销毁所有临时 AI 字幕
      const cleanupAll = () => {
        try {
          // 清理当前视频的 session 存储
          if (this.currentBoundVideoId) {
            sessionStorage.removeItem(this.getStorageKey(this.currentBoundVideoId));
          }
          // 扫描清理任何以 yt_sub_ai_temp_ 开头的历史残留
          const keysToRemove: string[] = [];
          for (let i = 0; i < sessionStorage.length; i++) {
            const key = sessionStorage.key(i);
            if (key && key.startsWith('yt_sub_ai_temp_')) {
              keysToRemove.push(key);
            }
          }
          keysToRemove.forEach((k) => sessionStorage.removeItem(k));
        } catch (e) {
          // 忽略受限环境
        }
        this.memoryCache.clear();
        console.log('[EphemeralSubtitleStore] 页面关闭，已彻底销毁所有临时 AI 字幕。');
      };

      window.addEventListener('beforeunload', cleanupAll);
      window.addEventListener('pagehide', cleanupAll);
    }
  }

  /**
   * 保存当前视频的临时 AI 字幕
   */
  public static save(videoId: string, sentences: SubtitleSentence[]) {
    if (!videoId) return;
    this.currentBoundVideoId = videoId;
    this.memoryCache.set(videoId, sentences);

    try {
      const serialized = JSON.stringify(
        sentences.map((s) => ({
          id: s.id,
          start: s.start,
          end: s.end,
          text: s.text,
          translation: s.translation,
          status: s.status,
          isAi: s.isAi
        }))
      );
      sessionStorage.setItem(this.getStorageKey(videoId), serialized);
    } catch (e) {
      // 容错处理超额异常
    }
  }

  /**
   * 读取当前视频的临时 AI 字幕（快进/快退/重新打开时秒出）
   */
  public static load(videoId: string): SubtitleSentence[] | null {
    if (!videoId) return null;

    // 优先内存读取
    if (this.memoryCache.has(videoId)) {
      return this.memoryCache.get(videoId)!;
    }

    // 次级 sessionStorage 读取
    try {
      const raw = sessionStorage.getItem(this.getStorageKey(videoId));
      if (raw) {
        const parsed = JSON.parse(raw);
        if (Array.isArray(parsed) && parsed.length > 0) {
          this.memoryCache.set(videoId, parsed);
          return parsed;
        }
      }
    } catch (e) {
      // 忽略解析异常
    }

    return null;
  }

  /**
   * 彻底删除某个视频或全部的临时字幕
   */
  public static clear(videoId?: string) {
    if (videoId) {
      this.memoryCache.delete(videoId);
      try {
        sessionStorage.removeItem(this.getStorageKey(videoId));
      } catch (e) {}
      console.log(`[EphemeralSubtitleStore] 视频 ${videoId} 已切换或关闭，已安全释放并清除临时 AI 字幕。`);
    } else {
      this.memoryCache.clear();
      try {
        const keysToRemove: string[] = [];
        for (let i = 0; i < sessionStorage.length; i++) {
          const key = sessionStorage.key(i);
          if (key && key.startsWith('yt_sub_ai_temp_')) {
            keysToRemove.push(key);
          }
        }
        keysToRemove.forEach((k) => sessionStorage.removeItem(k));
      } catch (e) {}
    }
  }
}
