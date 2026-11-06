import type { SubtitleSentence, ExtensionSettings } from '../types';

export interface TranslationQueueOptions {
  batchSize?: number;
  onSentenceUpdated?: () => void;
  /** 单批请求超时时间，超时后自动释放并发并允许重试 */
  requestTimeoutMs?: number;
}

/**
 * 沉浸式滑动窗口翻译调度器
 * 核心特性：
 * 1. 播放点优先（Seek Preemption）：快进/跳转时立即优先抢占翻译当前视野内的句子
 * 2. 避免重复与阻塞：智能合并，避免对正在翻译的区间重复请求
 * 3. 适度并行：维持至多 2 个并发批次，前后台互不卡死
 * 4. 超时自愈：消息丢失时不会让句子永久卡在 translating
 */
export class TranslationQueue {
  private sentences: SubtitleSentence[] = [];
  private settings: ExtensionSettings;
  private activeRequests: number = 0;
  private maxConcurrency: number = 2;
  private batchSize: number = 8;
  private onSentenceUpdated?: () => void;
  private requestTimeoutMs: number = 20000;
  /** 每次 setSentences 自增，用于丢弃旧数组的在途回调结果 */
  private generation = 0;
  /** 每句的超时次数，避免无限重试 */
  private attempts = new Map<number, number>();

  constructor(settings: ExtensionSettings, options: TranslationQueueOptions = {}) {
    this.settings = settings;
    if (options.batchSize) this.batchSize = options.batchSize;
    if (options.onSentenceUpdated) this.onSentenceUpdated = options.onSentenceUpdated;
    if (options.requestTimeoutMs) this.requestTimeoutMs = options.requestTimeoutMs;
  }

  public updateSettings(settings: ExtensionSettings) {
    this.settings = settings;
  }

  public setSentences(sentences: SubtitleSentence[]) {
    this.sentences = sentences;
    this.generation++;
    this.attempts.clear();
  }

  /**
   * 二分查找当前时间对应的句子下标，避免每帧 O(n) 全量扫描
   */
  private findIndexAt(time: number): number {
    const arr = this.sentences;
    if (arr.length === 0) return -1;

    let lo = 0;
    let hi = arr.length - 1;
    let lastStarted = 0;
    while (lo <= hi) {
      const mid = (lo + hi) >> 1;
      if (arr[mid].start <= time) {
        lastStarted = mid;
        lo = mid + 1;
      } else {
        hi = mid - 1;
      }
    }

    // 合成句尾可能被延长，回看/前看少量邻居确认命中
    // v0.2.6：重叠窗口内优先选择"最近开始"的句子，与浮层显示判定保持一致
    const from = Math.max(0, lastStarted - 2);
    const to = Math.min(arr.length - 1, lastStarted + 2);
    for (let i = to; i >= from; i--) {
      if (time >= arr[i].start && time <= arr[i].end + 2000) return i;
    }
    return lastStarted;
  }

  /**
   * 触发就近预取（根据当前播放时间毫秒数）
   * 优先抢占当前播放点前后 10 句
   */
  public triggerForTime(currentTimeMs: number, syncOffsetMs = 0) {
    if (this.sentences.length === 0) return;

    const actualTime = currentTimeMs - syncOffsetMs;
    const currentIdx = this.findIndexAt(actualTime);
    if (currentIdx < 0) return;

    // 2. 划定最高优先级窗口：从当前句前 1 句到后 12 句
    const highPriStart = Math.max(0, currentIdx - 1);
    const highPriEnd = Math.min(this.sentences.length, currentIdx + 12);

    // 检查高优先级区间内是否有未翻译的句子
    const highPriTargets = this.sentences
      .slice(highPriStart, highPriEnd)
      .filter((s) => !s.translation && s.status === 'idle');

    if (highPriTargets.length > 0) {
      // 立即抢占发起高优先级翻译
      this.dispatchBatch(highPriTargets.slice(0, this.batchSize));
      return;
    }

    // 3. 次级优先级：若最高优先级都已完成或在路上，且并发未满，向后预取未来 30 秒的句子
    if (this.activeRequests < this.maxConcurrency) {
      const lookaheadEnd = Math.min(this.sentences.length, currentIdx + 30);
      const lookaheadTargets = this.sentences
        .slice(highPriEnd, lookaheadEnd)
        .filter((s) => !s.translation && s.status === 'idle');

      if (lookaheadTargets.length > 0) {
        this.dispatchBatch(lookaheadTargets.slice(0, this.batchSize));
      }
    }
  }

  /**
   * 发起一批翻译（带超时与代际校验）
   */
  private dispatchBatch(targets: SubtitleSentence[]) {
    if (targets.length === 0) return;
    if (this.activeRequests >= this.maxConcurrency) return;

    for (const t of targets) {
      t.status = 'translating';
    }

    this.activeRequests++;
    const texts = targets.map((t) => t.text);
    const gen = this.generation;
    let settled = false;

    const finish = () => {
      if (settled) return false;
      settled = true;
      this.activeRequests = Math.max(0, this.activeRequests - 1);
      clearTimeout(timer);
      return true;
    };

    const timer = setTimeout(() => {
      if (!finish()) return;
      console.warn('[TranslationQueue] 翻译请求超时，释放并发并安排重试');
      for (const t of targets) {
        const count = (this.attempts.get(t.id) || 0) + 1;
        this.attempts.set(t.id, count);
        if (count >= 2) {
          t.status = 'error';
          t.translation = '[翻译超时，请点击重试]';
        } else {
          t.status = 'idle';
        }
      }
      if (gen === this.generation && this.onSentenceUpdated) {
        this.onSentenceUpdated();
      }
    }, this.requestTimeoutMs);

    chrome.runtime.sendMessage(
      {
        type: 'TRANSLATE_BATCH',
        payload: {
          texts,
          targetLang: this.settings.targetLang,
          settings: this.settings
        }
      },
      (res) => {
        // 读取 lastError，避免控制台出现未处理的 runtime 警告
        void chrome.runtime.lastError;
        if (!finish()) return;
        // 数组已被替换（切视频/重新断句），旧结果直接丢弃
        if (gen !== this.generation) return;

        if (res && res.success && Array.isArray(res.translations)) {
          for (let i = 0; i < targets.length; i++) {
            targets[i].translation = res.translations[i] || targets[i].text;
            targets[i].status = 'done';
            this.attempts.delete(targets[i].id);
          }
        } else {
          console.warn('[TranslationQueue] Batch failed:', res?.error);
          for (const t of targets) {
            t.status = 'error';
            t.translation = `[翻译失败: ${res?.error || '网络连接异常'}]`;
          }
        }

        if (this.onSentenceUpdated) {
          this.onSentenceUpdated();
        }
      }
    );
  }
}
