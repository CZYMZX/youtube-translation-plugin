import type { SubtitleSentence, ExtensionSettings } from '../types';

export interface TranslationQueueOptions {
  batchSize?: number;
  lookaheadCount?: number;
  onSentenceUpdated?: () => void;
}

/**
 * 沉浸式滑动窗口翻译调度器
 * 核心特性：
 * 1. 播放点优先（Seek Preemption）：快进/跳转时立即优先抢占翻译当前视野内的句子
 * 2. 避免重复与阻塞：智能合并，避免对正在翻译的区间重复请求
 * 3. 适度并行：维持至多 2 个并发批次，前后台互不卡死
 */
export class TranslationQueue {
  private sentences: SubtitleSentence[] = [];
  private settings: ExtensionSettings;
  private activeRequests: number = 0;
  private maxConcurrency: number = 2;
  private batchSize: number = 8;
  private onSentenceUpdated?: () => void;

  constructor(settings: ExtensionSettings, options: TranslationQueueOptions = {}) {
    this.settings = settings;
    if (options.batchSize) this.batchSize = options.batchSize;
    if (options.onSentenceUpdated) this.onSentenceUpdated = options.onSentenceUpdated;
  }

  public updateSettings(settings: ExtensionSettings) {
    this.settings = settings;
  }

  public setSentences(sentences: SubtitleSentence[]) {
    this.sentences = sentences;
  }

  /**
   * 触发就近预取（根据当前播放时间毫秒数）
   * 优先抢占当前播放点前后 10 句
   */
  public triggerForTime(currentTimeMs: number, syncOffsetMs = 0) {
    if (this.sentences.length === 0) return;

    const actualTime = currentTimeMs - syncOffsetMs;

    // 1. 寻找当前时间点所在或最近的句子下标
    let currentIdx = -1;
    for (let i = 0; i < this.sentences.length; i++) {
      if (actualTime >= this.sentences[i].start && actualTime <= this.sentences[i].end + 2000) {
        currentIdx = i;
        break;
      }
    }
    if (currentIdx === -1) {
      for (let i = 0; i < this.sentences.length; i++) {
        if (this.sentences[i].start > actualTime) {
          currentIdx = Math.max(0, i - 1);
          break;
        }
      }
    }
    if (currentIdx === -1) currentIdx = 0;

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
   * 发起一批翻译
   */
  private dispatchBatch(targets: SubtitleSentence[]) {
    if (targets.length === 0) return;
    if (this.activeRequests >= this.maxConcurrency) return;

    for (const t of targets) {
      t.status = 'translating';
    }

    this.activeRequests++;
    const texts = targets.map((t) => t.text);

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
        this.activeRequests = Math.max(0, this.activeRequests - 1);

        if (res && res.success && Array.isArray(res.translations)) {
          for (let i = 0; i < targets.length; i++) {
            targets[i].translation = res.translations[i] || targets[i].text;
            targets[i].status = 'done';
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
