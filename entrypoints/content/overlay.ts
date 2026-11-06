/**
 * ============================================================================
 * YouTube 智能字幕断句翻译器 - 播放器覆盖层与交互核心 (SubtitleOverlay)
 * 当前版本: v0.2.3 (字幕检索致命崩溃修复与极速秒开稳定版)
 *
 * 【v0.1.0 架构与设计规范统一守则（跨会话协作必读）】：
 * 1. 纯净黑白毛玻璃视觉体系：除字幕框和译文颜色允许用户自由调色外，所有控制面板、
 *    快捷面板（QuickPanel）、剧本抽屉（Drawer）以及弹窗均严格保持黑白深邃毛玻璃风格，
 *    严禁在后续迭代中引入彩色渐变底色或高饱和度色块。
 * 2. 矢量图标规范：所有图标必须统一从 ByteDance IconPark 官方矢量库选用（纯净 SVG 48x48
 *    线性描边），严禁随意插入系统原生彩色 Emoji（如 ⏱️、⚙️、📖 等）。
 * 3. 剧本抽屉联动机制：
 *    - 当前播放句的高亮选择框（边框与微光）必须通过 CSS 变量与用户设定的译文颜色 (transColor) 实时动态同步。
 *    - 用户翻阅抽屉时，弹出「5s回到当前句」极简黑白胶囊药丸弹窗，倒计时为 5 秒平滑回溯。
 * 4. 样式隔离与盒模型：Shadow DOM 内严格遵守 `box-sizing: border-box`，防止边框溢出。
 * ============================================================================
 */

import {
  ICON_SPARKLES,
  ICON_TRANSLATE,
  ICON_TIME,
  ICON_SETTING,
  ICON_ALIGN,
  ICON_THEATER,
  ICON_BRAIN,
  ICON_LEFT,
  ICON_RIGHT,
  ICON_CLOSE,
  ICON_INFO,
  ICON_LOCK,
  ICON_DOWNLOAD,
  ICON_COPY,
  ICON_REFRESH,
  ICON_FILE_TEXT,
  ICON_PREVIEW_OPEN,
  ICON_PREVIEW_CLOSE,
  ICON_PALETTE,
  ICON_DRAG,
  ICON_STOPWATCH,
  ICON_HOURGLASS,
  ICON_CHECK,
  ICON_ALERT,
  ICON_AI_HEXASTAR
} from '../../utils/icons';
import type { SubtitleSentence, ExtensionSettings } from '../../types';

function hexToRgba(hex: string, opacity: number): string {
  if (!hex || hex === 'transparent' || hex === '#00000000') {
    return 'transparent';
  }
  let c = hex.replace('#', '');
  if (c.length === 3) {
    c = c.split('').map((x) => x + x).join('');
  }
  const num = parseInt(c, 16);
  if (isNaN(num)) return `rgba(15, 23, 42, ${opacity / 100})`;
  const r = (num >> 16) & 255;
  const g = (num >> 8) & 255;
  const b = num & 255;
  return `rgba(${r}, ${g}, ${b}, ${opacity / 100})`;
}

export class SubtitleOverlay {
  private host: HTMLElement | null = null;
  private shadow: ShadowRoot | null = null;
  private containerEl: HTMLElement | null = null;
  private origEl: HTMLElement | null = null;
  private transEl: HTMLElement | null = null;
  private statusBadgeEl: HTMLElement | null = null;
  private drawerEl: HTMLElement | null = null;
  private drawerListEl: HTMLElement | null = null;
  private searchInputEl: HTMLInputElement | null = null;
  private quickPanelEl: HTMLElement | null = null;
  private qpViewMainEl: HTMLElement | null = null;
  private qpViewStyleEl: HTMLElement | null = null;
  private aiBtnEl: HTMLElement | null = null;
  private aiClearBtnEl: HTMLElement | null = null;
  private aiProgressWrapEl: HTMLElement | null = null;
  private aiProgressFillEl: HTMLElement | null = null;
  private aiProgressTextEl: HTMLElement | null = null;
  private aiProgressPercentEl: HTMLElement | null = null;
  private aiBtnTextEl: HTMLElement | null = null;
  private sentenceAiBadgeEl: HTMLElement | null = null;
  private drawerSyncBtnEl: HTMLElement | null = null;
  private drawerUserScrollTimer: any = null;
  private drawerCountdownInterval: any = null;
  private isUserInteractingDrawer: boolean = false;
  private isProgrammaticScrolling: boolean = false;

  private currentSentence: SubtitleSentence | null = null;
  private allSentences: SubtitleSentence[] = [];
  private settings: ExtensionSettings;
  private isVisible: boolean = true;
  private isDrawerOpen: boolean = false;
  private isQuickPanelOpen: boolean = false;
  private isTrackEmpty: boolean = false;
  private isFullscreen: boolean = false;
  private hasShownReadyBadge: boolean = false;
  private targetPlayerEl: HTMLElement | null = null;
  private playerResizeObserver: ResizeObserver | null = null;
  private playerControlsObserver: MutationObserver | null = null;
  private isControlBarShowing: boolean = false;
  private currentScaleFactor: number = 1.0;

  private onSeekCallback?: (seconds: number) => void;
  private onSettingsChangeCallback?: (newSettings: Partial<ExtensionSettings>) => void;
  private onRetryTranslationCallback?: (sentenceId?: number) => void;
  onRequestAiSubtitlesCallback?: () => void;
  private onClearAiSubtitlesCallback?: () => void;
  private onRequestDetectCaptionsCallback?: () => void;

  constructor(
    settings: ExtensionSettings,
    callbacks?: {
      onSeek?: (seconds: number) => void;
      onSettingsChange?: (newSettings: Partial<ExtensionSettings>) => void;
      onRetryTranslation?: (sentenceId?: number) => void;
      onRequestAiSubtitles?: () => void;
      onClearAiSubtitles?: () => void;
      onRequestDetectCaptions?: () => void;
    }
  ) {
    this.settings = settings;
    this.onSeekCallback = callbacks?.onSeek;
    this.onSettingsChangeCallback = callbacks?.onSettingsChange;
    this.onRetryTranslationCallback = callbacks?.onRetryTranslation;
    this.onRequestAiSubtitlesCallback = callbacks?.onRequestAiSubtitles;
    this.onClearAiSubtitlesCallback = callbacks?.onClearAiSubtitles;
    this.onRequestDetectCaptionsCallback = callbacks?.onRequestDetectCaptions;
  }

  /**
   * 挂载到 YouTube 播放器容器
   */
  public mount(playerContainer: HTMLElement) {
    this.targetPlayerEl = playerContainer;
    this.destroy();

    this.host = document.createElement('div');
    this.host.id = 'yt-sub-translator-host';
    this.host.style.position = 'absolute';
    this.host.style.top = '0';
    this.host.style.left = '0';
    this.host.style.width = '100%';
    this.host.style.height = '100%';
    this.host.style.pointerEvents = 'none';
    this.host.style.zIndex = '85';
    // 关键防抖：严格设置 overflow: hidden，防止未完全进入视口的抽屉等子元素造成播放器外部产生水平滚动溢出
    this.host.style.overflow = 'hidden';

    this.shadow = this.host.attachShadow({ mode: 'open' });
    this.shadow.innerHTML = this.renderTemplate();

    this.containerEl = this.shadow.querySelector('.subtitle-box');
    this.origEl = this.shadow.querySelector('.original-text');
    this.transEl = this.shadow.querySelector('.translated-text');
    this.statusBadgeEl = this.shadow.querySelector('.status-indicator');
    this.drawerEl = this.shadow.querySelector('.transcript-drawer');
    this.drawerListEl = this.shadow.querySelector('.drawer-sentences-list');
    this.searchInputEl = this.shadow.querySelector('.drawer-search-input');
    this.quickPanelEl = this.shadow.querySelector('.quick-panel');
    this.qpViewMainEl = this.shadow.querySelector('.qp-view-main');
    this.qpViewStyleEl = this.shadow.querySelector('.qp-view-style');
    this.aiBtnEl = this.shadow.querySelector('#qp-btn-request-ai');
    this.aiClearBtnEl = this.shadow.querySelector('#qp-btn-clear-ai');
    this.aiProgressWrapEl = this.shadow.querySelector('#qp-ai-progress-wrap');
    this.aiProgressFillEl = this.shadow.querySelector('#qp-ai-progress-fill');
    this.aiProgressTextEl = this.shadow.querySelector('#qp-ai-progress-text');
    this.aiProgressPercentEl = this.shadow.querySelector('#qp-ai-progress-percent');
    this.aiBtnTextEl = this.shadow.querySelector('#qp-ai-btn-text');
    this.sentenceAiBadgeEl = this.shadow.querySelector('#sentence-ai-badge');
    this.drawerSyncBtnEl = this.shadow.querySelector('#drawer-sync-btn');

    this.bindEvents();
    this.bindQuickPanelEvents();

    const onFullscreenChange = () => {
      this.isFullscreen = !!(document.fullscreenElement || (document as any).webkitFullscreenElement);
      this.applyStyles();
    };
    document.removeEventListener('fullscreenchange', onFullscreenChange);
    document.addEventListener('fullscreenchange', onFullscreenChange);
    document.addEventListener('webkitfullscreenchange', onFullscreenChange);

    // 监听播放器容器尺寸自适应缩放字幕
    if (typeof ResizeObserver !== 'undefined') {
      if (this.playerResizeObserver) {
        this.playerResizeObserver.disconnect();
      }
      this.playerResizeObserver = new ResizeObserver(() => {
        this.applyStyles();
      });
      this.playerResizeObserver.observe(playerContainer);
    }

    // 监听播放器控制栏状态变化，实现仿沉浸式翻译的进度条平滑避让
    const updateControlBarState = () => {
      // YouTube 播放器在控制栏隐藏时带有 .ytp-autohide
      // 当鼠标悬浮或操作时移除 .ytp-autohide，控制栏滑出
      const isShowing = !playerContainer.classList.contains('ytp-autohide');
      if (this.isControlBarShowing !== isShowing) {
        this.isControlBarShowing = isShowing;
        this.applyStyles();
      }
    };
    if (typeof MutationObserver !== 'undefined') {
      if (this.playerControlsObserver) {
        this.playerControlsObserver.disconnect();
      }
      this.playerControlsObserver = new MutationObserver((mutations) => {
        for (const m of mutations) {
          if (m.type === 'attributes' && m.attributeName === 'class') {
            updateControlBarState();
            break;
          }
        }
      });
      this.playerControlsObserver.observe(playerContainer, {
        attributes: true,
        attributeFilter: ['class']
      });
    }
    updateControlBarState();

    this.applyStyles();

    playerContainer.appendChild(this.host);
  }

  public destroy() {
    if (this.playerResizeObserver) {
      this.playerResizeObserver.disconnect();
      this.playerResizeObserver = null;
    }
    if (this.playerControlsObserver) {
      this.playerControlsObserver.disconnect();
      this.playerControlsObserver = null;
    }
    if (this.drawerUserScrollTimer) {
      clearTimeout(this.drawerUserScrollTimer);
      this.drawerUserScrollTimer = null;
    }
    if (this.drawerCountdownInterval) {
      clearInterval(this.drawerCountdownInterval);
      this.drawerCountdownInterval = null;
    }
    if (this.host && this.host.parentElement) {
      this.host.parentElement.removeChild(this.host);
    }
    this.host = null;
    this.shadow = null;
    this.currentSentence = null;
  }

  public ensureMounted(playerContainer: HTMLElement) {
    if (!this.host || !this.host.parentElement || this.host.parentElement !== playerContainer) {
      this.mount(playerContainer);
    }
  }

  public updateSettings(newSettings: ExtensionSettings) {
    this.settings = newSettings;
    this.applyStyles();
    this.syncQuickPanelValues();
    if (this.currentSentence) {
      this.renderCurrentSentence(this.currentSentence);
    }
    this.renderDrawerList();
  }

  public showStatusBadge(htmlOrText: string, durationMs = 3000) {
    if (!this.statusBadgeEl) return;
    this.statusBadgeEl.innerHTML = htmlOrText;
    this.statusBadgeEl.classList.add('visible');
    if (durationMs > 0) {
      setTimeout(() => {
        this.statusBadgeEl?.classList.remove('visible');
      }, durationMs);
    }
  }

  public resetReadyBadgeState() {
    this.hasShownReadyBadge = false;
  }

  public setSentences(sentences: SubtitleSentence[], notifyReady: boolean = false) {
    this.allSentences = sentences;
    if (sentences.length > 0) {
      this.isTrackEmpty = false;
      // 仅在首次全量就绪且指定 notifyReady 时显示右上角徽章，避免翻译推进时反复弹跳
      if (notifyReady && !this.hasShownReadyBadge) {
        this.hasShownReadyBadge = true;
        const mode = this.settings.scenario === 'vtuber' ? 'VTuber直播' : '通用';
        this.showStatusBadge(`<span style="display:inline-flex;width:12px;height:12px;margin-right:5px;vertical-align:-1px;color:#ffffff;">${ICON_CHECK}</span>${mode}字幕已就绪 (${sentences.length} 句)`);
      }
    }
    this.syncQuickPanelValues();
    this.renderDrawerList();
  }

  public setTrackEmpty(empty: boolean, _reason?: string) {
    this.isTrackEmpty = empty;
    if (empty) {
      this.showStatusBadge(`<span style="display:inline-flex;width:12px;height:12px;margin-right:5px;vertical-align:-1px;color:#ffffff;">${ICON_ALERT}</span>暂未检测到字幕轨道 (可尝试开启CC字幕)`, 3500);
    }
    this.syncQuickPanelValues();
  }

  public onTimeUpdate(currentTimeMs: number) {
    if (this.targetPlayerEl) {
      this.ensureMounted(this.targetPlayerEl);
    }

    if (!this.isVisible || !this.settings.enabled || this.allSentences.length === 0) {
      this.clearCurrentDisplay();
      return;
    }

    // 默认内置 200ms 的声学前瞻补偿（彻底消除原 ASR 字幕通常约 0.2 秒的延迟迟滞），并叠加用户微调
    const ACOUSTIC_LEAD_IN_MS = 200;
    const effectiveTime = currentTimeMs + ACOUSTIC_LEAD_IN_MS + (this.settings.syncOffsetMs || 0);

    // 智能平滑保留窗口：如果处于两句之间的微小停顿，平滑保持上一句显示，避免闪烁消失
    const matched = this.allSentences.find(
      (s) => effectiveTime >= s.start && effectiveTime <= (s.end + 1500)
    );

    if (matched) {
      this.currentSentence = matched;
      this.renderCurrentSentence(matched);
      this.highlightDrawerItem(matched.id);
    } else {
      if (this.currentSentence && effectiveTime - this.currentSentence.end > 1800) {
        this.clearCurrentDisplay();
      }
    }
  }

  /**
   * 实时渲染来自 DOM 捕获器的即时字幕
   */
  public renderLiveCaption(origText: string, transText: string) {
    if (!this.containerEl || !this.origEl || !this.transEl) return;
    if (!this.isVisible || !this.settings.enabled) return;

    if (this.isTrackEmpty) {
      this.isTrackEmpty = false;
      this.syncQuickPanelValues();
    }

    this.origEl.textContent = origText;
    this.transEl.textContent = transText;
    this.containerEl.classList.add('active');
  }

  /**
   * 实时更新 AI 深度精翻进度
   */
  public updateAiProgress(percent: number, text: string) {
    if (this.aiProgressWrapEl) this.aiProgressWrapEl.classList.remove('hidden');
    if (this.aiProgressFillEl) this.aiProgressFillEl.style.width = `${percent}%`;
    if (this.aiProgressPercentEl) this.aiProgressPercentEl.textContent = `${percent}%`;
    if (this.aiProgressTextEl) this.aiProgressTextEl.textContent = text;
    if (this.aiBtnTextEl) this.aiBtnTextEl.textContent = `AI 精翻中 (${percent}%)...`;
    if (this.aiBtnEl) {
      (this.aiBtnEl as HTMLButtonElement).disabled = true;
      this.aiBtnEl.classList.remove('done');
    }
  }

  /**
   * 标记 AI 深度精翻完成
   */
  public setAiComplete(totalCount: number) {
    if (this.aiProgressWrapEl) this.aiProgressWrapEl.classList.add('hidden');
    if (this.aiBtnTextEl) {
      this.aiBtnTextEl.innerHTML = `<span style="display:inline-flex;width:12px;height:12px;margin-right:4px;vertical-align:-1px;color:#ffffff;">${ICON_CHECK}</span>全篇 AI 字幕已就绪 (${totalCount} 句)`;
    }
    if (this.aiBtnEl) {
      (this.aiBtnEl as HTMLButtonElement).disabled = false;
      this.aiBtnEl.classList.add('done');
    }
    if (this.aiClearBtnEl) this.aiClearBtnEl.classList.remove('hidden');
  }

  /**
   * 重置 AI 精翻按钮为默认状态
   */
  public resetAiProgress() {
    if (this.aiProgressWrapEl) this.aiProgressWrapEl.classList.add('hidden');
    if (this.aiProgressFillEl) this.aiProgressFillEl.style.width = '0%';
    if (this.aiBtnTextEl) this.aiBtnTextEl.textContent = '请求 AI 深度字幕 (Beta)';
    if (this.aiBtnEl) {
      (this.aiBtnEl as HTMLButtonElement).disabled = false;
      this.aiBtnEl.classList.remove('done');
    }
    if (this.aiClearBtnEl) this.aiClearBtnEl.classList.add('hidden');
  }

  private renderCurrentSentence(sentence: SubtitleSentence) {
    if (!this.containerEl || !this.origEl || !this.transEl) return;

    const { displayMode, layoutOrder } = this.settings;

    this.origEl.textContent = sentence.text;

    if (sentence.translation) {
      this.transEl.textContent = sentence.translation;
      this.transEl.classList.remove('loading', 'error');
      if (sentence.translation.startsWith('[翻译失败') || sentence.translation.startsWith('[翻译异常')) {
        this.transEl.classList.add('error');
      }
    } else if (sentence.status === 'translating') {
      this.transEl.textContent = '翻译中...';
      this.transEl.classList.add('loading');
      this.transEl.classList.remove('error');
    } else {
      this.transEl.textContent = '等待翻译...';
      this.transEl.classList.add('loading');
      this.transEl.classList.remove('error');
    }

    if (displayMode === 'translation_only') {
      this.origEl.style.display = 'none';
      this.transEl.style.display = 'block';
    } else if (displayMode === 'original_only') {
      this.origEl.style.display = 'block';
      this.transEl.style.display = 'none';
    } else {
      this.origEl.style.display = 'block';
      this.transEl.style.display = 'block';
    }

    if (layoutOrder === 'translation_top') {
      this.containerEl.style.flexDirection = 'column-reverse';
    } else {
      this.containerEl.style.flexDirection = 'column';
    }

    if (this.sentenceAiBadgeEl) {
      if (sentence.isAi) {
        this.sentenceAiBadgeEl.classList.remove('hidden');
      } else {
        this.sentenceAiBadgeEl.classList.add('hidden');
      }
    }

    this.containerEl.classList.add('active');
  }

  private clearCurrentDisplay() {
    this.currentSentence = null;
    if (this.sentenceAiBadgeEl) {
      this.sentenceAiBadgeEl.classList.add('hidden');
    }
    if (this.containerEl) {
      this.containerEl.classList.remove('active');
    }
  }

  public toggleVisibility() {
    this.isVisible = !this.isVisible;
    if (this.containerEl) {
      this.containerEl.style.display = this.isVisible ? 'flex' : 'none';
    }
  }

  public toggleDrawer(force?: boolean) {
    this.isDrawerOpen = typeof force === 'boolean' ? force : !this.isDrawerOpen;
    if (this.drawerEl) {
      if (this.isDrawerOpen) {
        this.resetDrawerSyncState(false);
        this.drawerEl.style.display = 'flex';
        this.drawerEl.classList.add('open');
        this.renderDrawerList();
        if (this.currentSentence) {
          setTimeout(() => {
            if (this.currentSentence && this.isDrawerOpen) {
              this.highlightDrawerItem(this.currentSentence.id, true);
            }
          }, 80);
        }
      } else {
        this.resetDrawerSyncState(false);
        this.drawerEl.classList.remove('open');
        this.drawerEl.style.display = 'none';
      }
    }
  }

  /**
   * 打开/关闭播放器右下角快捷设置面板 (类似沉浸式翻译)
   */
  public toggleQuickPanel(force?: boolean) {
    this.isQuickPanelOpen = typeof force === 'boolean' ? force : !this.isQuickPanelOpen;
    if (this.quickPanelEl) {
      if (this.isQuickPanelOpen) {
        this.syncQuickPanelValues();
        this.quickPanelEl.classList.remove('subview-style-open');
        this.quickPanelEl.style.display = 'flex';
        this.quickPanelEl.classList.add('open');
        this.quickPanelEl.style.opacity = '1';
        this.quickPanelEl.style.visibility = 'visible';
        this.quickPanelEl.style.pointerEvents = 'auto';
        this.syncMicroPreview();
      } else {
        this.quickPanelEl.classList.remove('open');
        this.quickPanelEl.classList.remove('subview-style-open');
        this.quickPanelEl.style.display = 'none';
        this.quickPanelEl.style.opacity = '0';
        this.quickPanelEl.style.visibility = 'hidden';
        this.quickPanelEl.style.pointerEvents = 'none';
      }
    }
  }

  private renderDrawerList() {
    if (!this.drawerListEl) return;

    const filterText = (this.searchInputEl?.value || '').trim().toLowerCase();
    const filtered = this.allSentences.filter((s) => {
      if (!filterText) return true;
      return (
        s.text.toLowerCase().includes(filterText) ||
        (s.translation && s.translation.toLowerCase().includes(filterText))
      );
    });

    if (filtered.length === 0) {
      this.drawerListEl.innerHTML = `
        <div class="empty-state">
          ${this.allSentences.length === 0 ? '正在检测与加载字幕轨道...' : '未找到匹配的字幕'}
        </div>
      `;
      return;
    }

    this.drawerListEl.innerHTML = '';
    const fragment = document.createDocumentFragment();

    for (const s of filtered) {
      const itemEl = document.createElement('div');
      itemEl.className = `drawer-item ${this.currentSentence?.id === s.id ? 'current' : ''}`;
      itemEl.dataset.id = String(s.id);
      itemEl.dataset.start = String(s.start / 1000);

      const timeStr = this.formatTime(s.start);

      const aiTag = s.isAi
        ? `<span class="drawer-ai-badge" title="大模型 AI 深度精翻"><span style="display:inline-flex;width:10px;height:10px;align-items:center;margin-right:2px;vertical-align:-0.5px;">${ICON_AI_HEXASTAR}</span>AI</span> `
        : '';

      itemEl.innerHTML = `
        <div class="item-time">${timeStr}</div>
        <div class="item-content">
          <div class="item-original">${this.escapeHtml(s.text)}</div>
          <div class="item-translation">${aiTag}${this.escapeHtml(s.translation || '（待翻译）')}</div>
        </div>
      `;

      itemEl.addEventListener('click', () => {
        if (this.onSeekCallback) {
          this.onSeekCallback(s.start / 1000);
        }
        // 用户主动点击跳转时间轴：立即恢复自动跟随并聚焦
        this.resetDrawerSyncState(false);
        this.highlightDrawerItem(s.id, true);
      });

      fragment.appendChild(itemEl);
    }

    this.drawerListEl.appendChild(fragment);
  }

  /**
   * 捕获用户在剧本列表的手动上下滚动或拖拽动作：
   * 停止自动强制归位，并在停止移动 5 秒后自动平滑回到正在说的那句话
   */
  private handleDrawerUserScroll() {
    this.isUserInteractingDrawer = true;

    if (this.drawerUserScrollTimer) {
      clearTimeout(this.drawerUserScrollTimer);
    }
    if (this.drawerCountdownInterval) {
      clearInterval(this.drawerCountdownInterval);
    }

    let remainingSec = 5;
    if (this.drawerSyncBtnEl) {
      this.drawerSyncBtnEl.classList.remove('hidden');
      const textSpan = this.drawerSyncBtnEl.querySelector('.sync-text');
      if (textSpan) textSpan.textContent = `${remainingSec}s 后回到当前句`;
    }

    this.drawerCountdownInterval = setInterval(() => {
      remainingSec--;
      if (remainingSec > 0 && this.drawerSyncBtnEl) {
        const textSpan = this.drawerSyncBtnEl.querySelector('.sync-text');
        if (textSpan) textSpan.textContent = `${remainingSec}s 后回到当前句`;
      }
    }, 1000);

    this.drawerUserScrollTimer = setTimeout(() => {
      this.resetDrawerSyncState(true);
    }, 5000);
  }

  /**
   * 重置抽屉滚动锁定状态
   */
  private resetDrawerSyncState(autoScrollToCurrent = false) {
    if (this.drawerUserScrollTimer) {
      clearTimeout(this.drawerUserScrollTimer);
      this.drawerUserScrollTimer = null;
    }
    if (this.drawerCountdownInterval) {
      clearInterval(this.drawerCountdownInterval);
      this.drawerCountdownInterval = null;
    }
    this.isUserInteractingDrawer = false;
    if (this.drawerSyncBtnEl) {
      this.drawerSyncBtnEl.classList.add('hidden');
    }
    if (autoScrollToCurrent && this.currentSentence && this.isDrawerOpen) {
      this.highlightDrawerItem(this.currentSentence.id, true);
    }
  }

  private highlightDrawerItem(sentenceId: number, autoScroll = false) {
    if (!this.drawerListEl) return;

    const prev = this.drawerListEl.querySelector('.drawer-item.current, .drawer-item.active');
    if (prev) {
      prev.classList.remove('current', 'active');
    }

    const curr = this.drawerListEl.querySelector(`[data-id="${sentenceId}"]`) as HTMLElement;
    if (curr) {
      curr.classList.add('current', 'active');
      
      // 只有在满足强制滚动 (autoScroll = true，如倒计时归位或点击跳转)，
      // 或者当前用户未在主动上下拖拽翻阅 (isUserInteractingDrawer = false) 时才自动移动视口！
      if (autoScroll || (this.isDrawerOpen && !this.isUserInteractingDrawer)) {
        this.isProgrammaticScrolling = true;
        // 关键防抖：纯内部滚动计算，绝对禁用原生 scrollIntoView（原生 API 会冒泡滚动祖先节点导致整个 YouTube 视频向左弹动）
        const list = this.drawerListEl;
        const itemTop = curr.offsetTop;
        const itemHeight = curr.offsetHeight;
        const listHeight = list.clientHeight;
        const targetScrollTop = Math.max(0, itemTop - (listHeight - itemHeight) / 2);

        list.scrollTo({
          top: targetScrollTop,
          behavior: 'smooth'
        });

        setTimeout(() => {
          this.isProgrammaticScrolling = false;
        }, 400);
      }
    }
  }

  /**
   * 应用颜色、字号、背景透明度与基于底部的自适应定位样式
   * 仿沉浸式翻译核心算法：字号随画面等比缩放、全屏/小窗自适应安全底距、进度条动态平滑避让
   */
  private applyStyles() {
    if (!this.containerEl || !this.origEl || !this.transEl) return;

    const {
      fontSize,
      bgOpacity,
      offsetY = 82,
      layoutOrder,
      bgColor = '#0f172a',
      origColor = '#e2e8f0',
      transColor = '#38bdf8',
      aiIconColor = '#fbbf24'
    } = this.settings;

    // 1. 获取播放器实际渲染尺寸
    const playerWidth = this.targetPlayerEl ? this.targetPlayerEl.clientWidth : 854;
    const playerHeight = this.targetPlayerEl ? this.targetPlayerEl.clientHeight : 480;

    // 2. 字号随画面等比平滑缩放 (以 854px 为 1.0 标准基准，开方因子防止两极分化)
    const scale = Math.max(0.75, Math.min(2.1, Math.sqrt(playerWidth / 854)));
    this.currentScaleFactor = scale;
    const baseSize = Math.round(fontSize * scale);

    // 3. 仿沉浸式翻译：全屏与小屏自适应安全底距 (彻底解决“小屏正好全屏靠上、全屏正好小屏靠下”的痛点)
    // 无论是 360p 小窗口还是 1080p/4K 全屏，人类视觉焦点都停留在距离画面底部的舒适安全区
    // 基础底距在小屏为 20px，全屏 1080p 仅温和延伸至 36px~40px，绝不随高度百分比暴涨到数百像素
    const baseBottomMargin = Math.round(20 + Math.min(18, Math.max(0, playerHeight - 360) * 0.025));

    // 用户拖拽偏置映射 (默认 82 时 offsetPx 为 0；向上拖增大底距，向下拖贴近底边)
    const userOffsetPx = Math.round((82 - offsetY) * 3.2 * scale);

    // 4. 仿沉浸式翻译：播放器进度条与控制栏智能平滑避让
    // 当检测到进度条可见时，字幕向上平滑浮起 48px~60px；进度条消失时平滑回落
    const controlLiftPx = this.isControlBarShowing ? Math.round(50 * Math.min(1.2, scale)) : 0;

    // 计算最终底距并进行安全下限保护 (至少保留 8px 距底，绝不溢出可视画面)
    const finalBottomPx = Math.max(8, baseBottomMargin + userOffsetPx + controlLiftPx);

    this.containerEl.style.top = ''; // 清除原有的 top 绝对像素/百分比
    this.containerEl.style.bottom = `${finalBottomPx}px`;
    this.containerEl.style.padding = `${Math.round(8 * scale)}px ${Math.round(18 * scale)}px`;
    this.containerEl.style.borderRadius = `${Math.round(12 * scale)}px`;
    this.containerEl.style.backgroundColor = hexToRgba(bgColor, bgOpacity);
    this.containerEl.style.setProperty('--ai-icon-color', aiIconColor);

    if (this.sentenceAiBadgeEl) {
      this.sentenceAiBadgeEl.style.color = aiIconColor;
    }

    if (layoutOrder === 'translation_top') {
      // 沉浸式翻译核心推荐：译文在上方，主视觉字号更饱满醒目
      this.transEl.style.color = transColor;
      this.transEl.style.fontSize = `${baseSize}px`;
      this.transEl.style.fontWeight = '600';
      this.transEl.style.lineHeight = '1.35';

      this.origEl.style.color = origColor;
      this.origEl.style.fontSize = `${Math.round(baseSize * 0.8)}px`;
      this.origEl.style.fontWeight = '500';
      this.origEl.style.lineHeight = '1.3';
      this.origEl.style.opacity = '0.92';
    } else {
      // 原文在上
      this.origEl.style.color = origColor;
      this.origEl.style.fontSize = `${baseSize}px`;
      this.origEl.style.fontWeight = '600';
      this.origEl.style.lineHeight = '1.35';
      this.origEl.style.opacity = '1';

      this.transEl.style.color = transColor;
      this.transEl.style.fontSize = `${Math.round(baseSize * 0.88)}px`;
      this.transEl.style.fontWeight = '500';
      this.transEl.style.lineHeight = '1.3';
    }

    /**
     * 【v0.1.0 改动注释：剧本抽屉当前句选择框颜色动态同步】
     * 响应用户需求：当前播放句的高亮选中边框、微光背景与呼吸发光效果，必须实时与
     * 用户配置的当前译文颜色 (transColor) 保持一致。
     * 通过 CSS 自定义变量注入到 Shadow DOM 内的 .transcript-drawer 容器上，
     * 避免写死单一颜色，实现与取色器/预设色板的无缝毫秒级联动。
     */
    if (this.drawerEl) {
      this.drawerEl.style.setProperty('--drawer-current-border', transColor);
      this.drawerEl.style.setProperty('--drawer-current-bg', hexToRgba(transColor, 15));
      this.drawerEl.style.setProperty('--drawer-current-glow', hexToRgba(transColor, 25));
    }
  }

  /**
   * 将当前 settings 同步至快捷面板控件
   */
  private syncMicroPreview() {
    if (!this.shadow) return;
    const card = this.shadow.querySelector('#qp-micro-preview-card') as HTMLElement;
    const orig = this.shadow.querySelector('#qp-micro-preview-orig') as HTMLElement;
    const trans = this.shadow.querySelector('#qp-micro-preview-trans') as HTMLElement;
    if (!card || !orig || !trans) return;

    orig.style.color = this.settings.origColor || '#e2e8f0';
    trans.style.color = this.settings.transColor || '#38bdf8';
    
    const aiPreview = this.shadow.querySelector('#qp-micro-preview-ai') as HTMLElement;
    if (aiPreview) {
      aiPreview.style.color = this.settings.aiIconColor || '#fbbf24';
    }
    card.style.setProperty('--ai-icon-color', this.settings.aiIconColor || '#fbbf24');
    
    // 微缩按比例映射字号
    const scaleFactor = Math.max(0.65, (this.settings.fontSize || 20) / 24);
    trans.style.fontSize = `${Math.round(14 * scaleFactor)}px`;
    orig.style.fontSize = `${Math.max(10, Math.round(12 * scaleFactor))}px`;
    
    card.style.backgroundColor = hexToRgba(this.settings.bgColor || '#0f172a', this.settings.bgOpacity ?? 75);

    // 颜色预设圆点激活态同步
    const dots = this.shadow.querySelectorAll('.color-dot');
    dots.forEach((dot) => {
      const targetType = dot.parentElement?.getAttribute('data-target');
      const color = dot.getAttribute('data-color')?.toLowerCase();
      if (!targetType || !color) return;

      let current = '';
      if (targetType === 'transColor') current = (this.settings.transColor || '').toLowerCase();
      else if (targetType === 'origColor') current = (this.settings.origColor || '').toLowerCase();
      else if (targetType === 'bgColor') current = (this.settings.bgColor || '').toLowerCase();
      else if (targetType === 'aiIconColor') current = (this.settings.aiIconColor || '').toLowerCase();

      dot.classList.toggle('active', current === color);
    });
  }

  private syncQuickPanelValues() {
    if (!this.shadow) return;
    this.syncMicroPreview();

    const toggle = this.shadow.querySelector('#qp-enabled-toggle') as HTMLInputElement;
    if (toggle) toggle.checked = this.settings.enabled;

    const statusEl = this.shadow.querySelector('#qp-track-status') as HTMLElement;
    if (statusEl) {
      if (this.allSentences.length > 0) {
        const mode = this.settings.scenario === 'vtuber' ? 'VTuber直播' : '通用模式';
        statusEl.innerHTML = `<span class="qp-status-icon-wrap" style="color:#ffffff;">${ICON_CHECK}</span><span>已就绪 (${mode} · ${this.allSentences.length} 句)</span>`;
        statusEl.style.color = '#ffffff';
        statusEl.style.cursor = 'default';
        statusEl.title = '';
      } else if (this.isTrackEmpty) {
        statusEl.innerHTML = `<span class="qp-status-icon-wrap" style="color:#ffffff;">${ICON_ALERT}</span><span>暂未检测到字幕</span> <span class="qp-retry-link">[点击重试]</span>`;
        statusEl.style.color = '#e4e4e7';
        statusEl.style.cursor = 'pointer';
        statusEl.title = '点击重新多通道扫描字幕';
      } else {
        statusEl.innerHTML = `<span class="qp-status-icon-wrap hourglass-flip-anim" style="color:#ffffff;">${ICON_HOURGLASS}</span><span>正在多通道检测字幕...</span>`;
        statusEl.style.color = '#e4e4e7';
        statusEl.style.cursor = 'default';
        statusEl.title = '';
      }
    }

    // 1. 同步双语排版模式 (Smooth Option Switcher + Badge)
    const { displayMode, layoutOrder, syncOffsetMs = 0 } = this.settings;
    let activeMode = 'bilingual-trans-top';
    let modeText = '译上原下';
    if (displayMode === 'translation_only') {
      activeMode = 'trans-only';
      modeText = '纯译文';
    } else if (displayMode === 'original_only') {
      activeMode = 'orig-only';
      modeText = '纯原文';
    } else if (layoutOrder === 'original_top') {
      activeMode = 'bilingual-orig-top';
      modeText = '原上译下';
    }

    const modeBadge = this.shadow.querySelector('#qp-badge-mode') as HTMLElement;
    if (modeBadge) modeBadge.textContent = modeText;

    const modeSwitcher = this.shadow.querySelector('.qp-smooth-switcher[data-switcher="mode"]') as HTMLElement;
    if (modeSwitcher) {
      const items = Array.from(modeSwitcher.querySelectorAll('.switcher-item'));
      items.forEach((item, idx) => {
        const isTarget = item.getAttribute('data-mode') === activeMode;
        item.classList.toggle('active', isTarget);
        if (isTarget) {
          modeSwitcher.style.setProperty('--active-index', String(idx));
        }
      });
    }

    // 2. 同步时间轴微调 Badge
    const offsetVal = this.shadow.querySelector('#qp-offset-val') as HTMLElement;
    if (offsetVal) {
      offsetVal.textContent = syncOffsetMs > 0 ? `+${syncOffsetMs}ms` : `${syncOffsetMs}ms`;
    }

    // 3. 同步翻译场景 (Smooth Option Switcher + Badge)
    const curScenario = this.settings.scenario || 'vtuber';
    const scenarioBadge = this.shadow.querySelector('#qp-badge-scenario') as HTMLElement;
    if (scenarioBadge) {
      scenarioBadge.textContent = curScenario === 'vtuber' ? 'VTuber直播' : '通用日常';
    }
    const scenSwitcher = this.shadow.querySelector('.qp-smooth-switcher[data-switcher="scenario"]') as HTMLElement;
    if (scenSwitcher) {
      const items = Array.from(scenSwitcher.querySelectorAll('.switcher-item'));
      items.forEach((item, idx) => {
        const isTarget = item.getAttribute('data-scenario') === curScenario;
        item.classList.toggle('active', isTarget);
        if (isTarget) {
          scenSwitcher.style.setProperty('--active-index', String(idx));
        }
      });
    }

    // 4. 同步推理思考深度 (Smooth Option Switcher + Badge)
    const curReasoning = this.settings.reasoningEffort || 'low';
    const reasoningBadge = this.shadow.querySelector('#qp-badge-reasoning') as HTMLElement;
    if (reasoningBadge) {
      let rText = '轻度';
      if (curReasoning === 'none') rText = '极速';
      else if (curReasoning === 'high') rText = '深度';
      reasoningBadge.textContent = rText;
    }
    const resSwitcher = this.shadow.querySelector('.qp-smooth-switcher[data-switcher="reasoning"]') as HTMLElement;
    if (resSwitcher) {
      const items = Array.from(resSwitcher.querySelectorAll('.switcher-item'));
      items.forEach((item, idx) => {
        const isTarget = item.getAttribute('data-reasoning') === curReasoning;
        item.classList.toggle('active', isTarget);
        if (isTarget) {
          resSwitcher.style.setProperty('--active-index', String(idx));
        }
      });
    }

    // 颜色和滑块
    const transPicker = this.shadow.querySelector('#qp-trans-color-picker') as HTMLInputElement;
    if (transPicker) transPicker.value = this.settings.transColor || '#38bdf8';

    const origPicker = this.shadow.querySelector('#qp-orig-color-picker') as HTMLInputElement;
    if (origPicker) origPicker.value = this.settings.origColor || '#e2e8f0';

    const bgPicker = this.shadow.querySelector('#qp-bg-color-picker') as HTMLInputElement;
    if (bgPicker) bgPicker.value = this.settings.bgColor || '#0f172a';

    const aiPicker = this.shadow.querySelector('#qp-ai-color-picker') as HTMLInputElement;
    if (aiPicker) aiPicker.value = this.settings.aiIconColor || '#fbbf24';

    const opacityRange = this.shadow.querySelector('#qp-opacity-range') as HTMLInputElement;
    const opacityVal = this.shadow.querySelector('#qp-opacity-val') as HTMLElement;
    if (opacityRange && opacityVal) {
      opacityRange.value = String(this.settings.bgOpacity);
      opacityVal.textContent = `${this.settings.bgOpacity}%`;
    }

    const fontRange = this.shadow.querySelector('#qp-font-size-range') as HTMLInputElement;
    const fontVal = this.shadow.querySelector('#qp-font-size-val') as HTMLElement;
    if (fontRange && fontVal) {
      fontRange.value = String(this.settings.fontSize);
      fontVal.textContent = `${this.settings.fontSize}px`;
    }
  }

  /**
   * 绑定快速设置面板交互事件
   */
  private bindQuickPanelEvents() {
    if (!this.shadow) return;

    // 0. 请求 AI 深度字幕与清除按钮
    this.aiBtnEl?.addEventListener('click', () => {
      if (this.onRequestAiSubtitlesCallback) {
        this.onRequestAiSubtitlesCallback();
      }
    });

    this.aiClearBtnEl?.addEventListener('click', () => {
      if (this.onClearAiSubtitlesCallback) {
        this.onClearAiSubtitlesCallback();
      }
    });

    // 0.1 字幕状态行点击手动重新检测
    const statusEl = this.shadow.querySelector('#qp-track-status') as HTMLElement;
    statusEl?.addEventListener('click', () => {
      if (this.allSentences.length === 0 && this.onRequestDetectCaptionsCallback) {
        this.showToast('正在重新扫描视频字幕轨道...');
        this.setTrackEmpty(false);
        this.onRequestDetectCaptionsCallback();
      }
    });

    // 1. 主开关
    const toggle = this.shadow.querySelector('#qp-enabled-toggle') as HTMLInputElement;
    toggle?.addEventListener('change', () => {
      this.updateAndNotify({ enabled: toggle.checked });
      this.showToast(toggle.checked ? '已开启智能字幕' : '已暂停智能字幕');
    });

    // 1. 手风琴折叠展开联动 (向下展开，外框保持稳定)
    const accordionHeaders = this.shadow.querySelectorAll('.qp-accordion-header');
    accordionHeaders.forEach((header) => {
      header.addEventListener('click', (e) => {
        e.stopPropagation();
        const item = header.closest('.qp-accordion-item') as HTMLElement | null;
        if (!item) return;
        const isExpanded = item.classList.contains('expanded');
        item.classList.toggle('expanded', !isExpanded);

        if (!isExpanded) {
          // 向下展开后，如果子内容超出当前可视区底部，则轻微平滑滚动使其完整展现
          setTimeout(() => {
            const view = item.closest('.qp-view') as HTMLElement | null;
            if (view) {
              const itemBottom = item.offsetTop + item.offsetHeight;
              const viewBottom = view.scrollTop + view.clientHeight;
              if (itemBottom > viewBottom) {
                view.scrollTo({
                  top: view.scrollTop + (itemBottom - viewBottom) + 8,
                  behavior: 'smooth'
                });
              }
            }
          }, 180);
        }
      });
    });

    // 1.1 双语排版模式 (Smooth Option Switcher 物理弹性横滑)
    const modeSwitcher = this.shadow.querySelector('.qp-smooth-switcher[data-switcher="mode"]');
    if (modeSwitcher) {
      const modeItems = modeSwitcher.querySelectorAll('.switcher-item');
      modeItems.forEach((btn, index) => {
        btn.addEventListener('click', (e) => {
          e.stopPropagation();
          modeItems.forEach((b) => b.classList.remove('active'));
          btn.classList.add('active');
          (modeSwitcher as HTMLElement).style.setProperty('--active-index', String(index));

          const mode = btn.getAttribute('data-mode');
          let modeText = '译上原下';
          if (mode === 'bilingual-trans-top') {
            this.updateAndNotify({ displayMode: 'bilingual', layoutOrder: 'translation_top' });
            modeText = '译上原下';
            this.showToast('排版：译上原下 (沉浸式)');
          } else if (mode === 'bilingual-orig-top') {
            this.updateAndNotify({ displayMode: 'bilingual', layoutOrder: 'original_top' });
            modeText = '原上译下';
            this.showToast('排版：原上译下');
          } else if (mode === 'trans-only') {
            this.updateAndNotify({ displayMode: 'translation_only' });
            modeText = '纯译文';
            this.showToast('排版：纯译文');
          } else if (mode === 'orig-only') {
            this.updateAndNotify({ displayMode: 'original_only' });
            modeText = '纯原文';
            this.showToast('排版：纯原文');
          }

          const badge = this.shadow?.querySelector('#qp-badge-mode');
          if (badge) badge.textContent = modeText;

          if (this.currentSentence) {
            this.renderCurrentSentence(this.currentSentence);
          }
        });
      });
    }

    // 1.2 时间轴同步微调
    const offsetVal = this.shadow.querySelector('#qp-offset-val') as HTMLElement;
    const updateOffset = (delta: number, isReset = false) => {
      let cur = this.settings.syncOffsetMs || 0;
      cur = isReset ? 0 : Math.max(-2000, Math.min(2000, cur + delta));
      this.updateAndNotify({ syncOffsetMs: cur });
      if (offsetVal) offsetVal.textContent = cur > 0 ? `+${cur}ms` : `${cur}ms`;
      this.showToast(`时间轴微调：${cur > 0 ? '+' : ''}${cur}ms`);
    };

    this.shadow.querySelector('#qp-offset-minus')?.addEventListener('click', (e) => {
      e.stopPropagation();
      updateOffset(-200);
    });
    this.shadow.querySelector('#qp-offset-reset')?.addEventListener('click', (e) => {
      e.stopPropagation();
      updateOffset(0, true);
    });
    this.shadow.querySelector('#qp-offset-plus')?.addEventListener('click', (e) => {
      e.stopPropagation();
      updateOffset(200);
    });

    // 1.3 翻译场景 (Smooth Option Switcher 物理弹性横滑)
    const scenSwitcher = this.shadow.querySelector('.qp-smooth-switcher[data-switcher="scenario"]');
    if (scenSwitcher) {
      const scenItems = scenSwitcher.querySelectorAll('.switcher-item');
      scenItems.forEach((btn, index) => {
        btn.addEventListener('click', (e) => {
          e.stopPropagation();
          scenItems.forEach((b) => b.classList.remove('active'));
          btn.classList.add('active');
          (scenSwitcher as HTMLElement).style.setProperty('--active-index', String(index));

          const scenario = btn.getAttribute('data-scenario') as any;
          this.updateAndNotify({ scenario });
          const text = scenario === 'vtuber' ? 'VTuber直播' : '通用日常';
          this.showToast(`切换场景：${text}`);

          const badge = this.shadow?.querySelector('#qp-badge-scenario');
          if (badge) badge.textContent = text;
        });
      });
    }

    // 1.4 推理思考深度 (Smooth Option Switcher 物理弹性横滑)
    const resSwitcher = this.shadow.querySelector('.qp-smooth-switcher[data-switcher="reasoning"]');
    if (resSwitcher) {
      const resItems = resSwitcher.querySelectorAll('.switcher-item');
      resItems.forEach((btn, index) => {
        btn.addEventListener('click', (e) => {
          e.stopPropagation();
          resItems.forEach((b) => b.classList.remove('active'));
          btn.classList.add('active');
          (resSwitcher as HTMLElement).style.setProperty('--active-index', String(index));

          const reasoningEffort = btn.getAttribute('data-reasoning') as any;
          this.updateAndNotify({ reasoningEffort });
          let text = '轻度';
          if (reasoningEffort === 'none') text = '极速';
          else if (reasoningEffort === 'high') text = '深度';
          this.showToast(`推理深度：${text}`);

          const badge = this.shadow?.querySelector('#qp-badge-reasoning');
          if (badge) badge.textContent = text;
        });
      });
    }

    // 4. 颜色与色块预设 (译文颜色)
    const transPicker = this.shadow.querySelector('#qp-trans-color-picker') as HTMLInputElement;
    transPicker?.addEventListener('input', () => {
      this.updateAndNotify({ transColor: transPicker.value });
    });

    // 5. 原文颜色
    const origPicker = this.shadow.querySelector('#qp-orig-color-picker') as HTMLInputElement;
    origPicker?.addEventListener('input', () => {
      this.updateAndNotify({ origColor: origPicker.value });
    });

    // 6. 背景颜色
    const bgPicker = this.shadow.querySelector('#qp-bg-color-picker') as HTMLInputElement;
    bgPicker?.addEventListener('input', () => {
      this.updateAndNotify({ bgColor: bgPicker.value });
    });

    // 6.5 AI 深度标识颜色
    const aiPicker = this.shadow.querySelector('#qp-ai-color-picker') as HTMLInputElement;
    aiPicker?.addEventListener('input', () => {
      this.updateAndNotify({ aiIconColor: aiPicker.value });
    });

    // 7. 色彩快捷色点点击
    const colorDots = this.shadow.querySelectorAll('.color-dot');
    colorDots.forEach((dot) => {
      dot.addEventListener('click', () => {
        const targetType = dot.parentElement?.getAttribute('data-target');
        const color = dot.getAttribute('data-color');
        if (!targetType || !color) return;

        if (targetType === 'transColor') {
          if (transPicker) transPicker.value = color;
          this.updateAndNotify({ transColor: color });
        } else if (targetType === 'origColor') {
          if (origPicker) origPicker.value = color;
          this.updateAndNotify({ origColor: color });
        } else if (targetType === 'bgColor') {
          if (bgPicker && color !== '#00000000') bgPicker.value = color;
          this.updateAndNotify({ bgColor: color });
        } else if (targetType === 'aiIconColor') {
          if (aiPicker) aiPicker.value = color;
          this.updateAndNotify({ aiIconColor: color });
        }
      });
    });

    // 8. 背景不透明度滑块
    const opacityRange = this.shadow.querySelector('#qp-opacity-range') as HTMLInputElement;
    const opacityVal = this.shadow.querySelector('#qp-opacity-val') as HTMLElement;
    opacityRange?.addEventListener('input', () => {
      const val = parseInt(opacityRange.value, 10);
      opacityVal.textContent = `${val}%`;
      this.updateAndNotify({ bgOpacity: val });
    });

    // 9. 字体大小滑块
    const fontRange = this.shadow.querySelector('#qp-font-size-range') as HTMLInputElement;
    const fontVal = this.shadow.querySelector('#qp-font-size-val') as HTMLElement;
    fontRange?.addEventListener('input', () => {
      const val = parseInt(fontRange.value, 10);
      fontVal.textContent = `${val}px`;
      this.updateAndNotify({ fontSize: val });
    });

    // 9.5 进入与返回二级子界面（类似沉浸式翻译）
    const panelEl = this.quickPanelEl || (this.shadow.querySelector('.quick-panel') as HTMLElement);
    const btnToStyle = this.shadow.querySelector('#qp-btn-to-style');
    const btnBackMain = this.shadow.querySelector('#qp-btn-back-main');

    btnToStyle?.addEventListener('click', (e) => {
      e.stopPropagation();
      panelEl?.classList.add('subview-style-open');
      this.syncMicroPreview();
    });

    btnBackMain?.addEventListener('click', (e) => {
      e.stopPropagation();
      panelEl?.classList.remove('subview-style-open');
    });

    // 10. 展开剧本与重译
    this.shadow.querySelector('#qp-btn-open-drawer')?.addEventListener('click', () => {
      this.toggleQuickPanel(false);
      this.toggleDrawer();
    });

    this.shadow.querySelector('#qp-btn-retranslate')?.addEventListener('click', () => {
      if (this.onRetryTranslationCallback) {
        this.onRetryTranslationCallback();
        this.showToast('正在重新翻译整段视频...');
      }
    });

    this.shadow.querySelectorAll('.qp-close').forEach((btn) => {
      btn.addEventListener('click', () => {
        this.toggleQuickPanel(false);
      });
    });
  }

  private updateAndNotify(partial: Partial<ExtensionSettings>) {
    this.settings = { ...this.settings, ...partial };
    this.applyStyles();
    this.syncMicroPreview();
    if (this.currentSentence) {
      this.renderCurrentSentence(this.currentSentence);
    }
    if (this.onSettingsChangeCallback) {
      this.onSettingsChangeCallback(partial);
    }
  }

  private bindEvents() {
    if (!this.shadow || !this.containerEl) return;

    // 拖拽调整垂直位置
    const handleEl = this.shadow.querySelector('.drag-handle') as HTMLElement;
    let isDragging = false;
    let startY = 0;
    let startOffsetY = this.settings.offsetY;

    if (handleEl) {
      handleEl.addEventListener('mousedown', (e) => {
        isDragging = true;
        startY = e.clientY;
        startOffsetY = this.settings.offsetY;
        document.body.style.userSelect = 'none';
        e.preventDefault();
        e.stopPropagation();
      });

      window.addEventListener('mousemove', (e) => {
        if (!isDragging || !this.host) return;
        const rect = this.host.getBoundingClientRect();
        if (rect.height <= 0) return;

        const deltaY = e.clientY - startY;
        const deltaPercent = (deltaY / rect.height) * 100;
        let newOffsetY = Math.round(startOffsetY + deltaPercent);
        newOffsetY = Math.max(30, Math.min(94, newOffsetY));

        this.settings.offsetY = newOffsetY;
        this.applyStyles();
      });

      window.addEventListener('mouseup', () => {
        if (isDragging) {
          isDragging = false;
          document.body.style.userSelect = '';
          if (this.onSettingsChangeCallback) {
            this.onSettingsChangeCallback({ offsetY: this.settings.offsetY });
          }
        }
      });
    }

    this.shadow.querySelector('.btn-drawer')?.addEventListener('click', (e) => {
      e.stopPropagation();
      this.toggleDrawer();
    });

    this.shadow.querySelector('.drawer-close')?.addEventListener('click', (e) => {
      e.stopPropagation();
      this.toggleDrawer();
    });

    this.shadow.querySelector('.btn-copy')?.addEventListener('click', (e) => {
      e.stopPropagation();
      if (this.currentSentence) {
        const textToCopy = `${this.currentSentence.text}\n${this.currentSentence.translation || ''}`.trim();
        navigator.clipboard.writeText(textToCopy).then(() => {
          this.showToast('已复制当前句子');
        });
      }
    });

    this.shadow.querySelector('.btn-retry')?.addEventListener('click', (e) => {
      e.stopPropagation();
      if (this.currentSentence && this.onRetryTranslationCallback) {
        this.onRetryTranslationCallback(this.currentSentence.id);
        this.showToast('正在重新翻译...');
      }
    });

    this.shadow.querySelector('.btn-hide')?.addEventListener('click', (e) => {
      e.stopPropagation();
      this.toggleVisibility();
    });

    this.searchInputEl?.addEventListener('input', () => {
      this.renderDrawerList();
    });

    this.shadow.querySelector('.btn-export-srt')?.addEventListener('click', (e) => {
      e.stopPropagation();
      this.exportSRT();
    });

    this.shadow.querySelector('.btn-export-txt')?.addEventListener('click', (e) => {
      e.stopPropagation();
      this.exportTXT();
    });

    // 1. 鼠标移向控制栏的防闪退保护 (彻底解决鼠标一移上去选项就没了的问题)
    const controlsBar = this.shadow.querySelector('.controls-bar') as HTMLElement;
    let hoverLeaveTimer: any = null;
    const enterHover = () => {
      if (hoverLeaveTimer) {
        clearTimeout(hoverLeaveTimer);
        hoverLeaveTimer = null;
      }
      this.containerEl?.classList.add('hover-active');
    };
    const leaveHover = () => {
      hoverLeaveTimer = setTimeout(() => {
        this.containerEl?.classList.remove('hover-active');
      }, 250);
    };

    this.containerEl?.addEventListener('mouseenter', enterHover);
    this.containerEl?.addEventListener('mouseleave', leaveHover);
    controlsBar?.addEventListener('mouseenter', enterHover);
    controlsBar?.addEventListener('mouseleave', leaveHover);

    // 2. 剧本抽屉手动上下滚动/拖拽侦测：滚动时5秒内暂停自动强制归位
    if (this.drawerListEl) {
      const onUserScroll = () => {
        if (this.isProgrammaticScrolling) return;
        this.handleDrawerUserScroll();
      };
      this.drawerListEl.addEventListener('wheel', onUserScroll, { passive: true });
      this.drawerListEl.addEventListener('scroll', onUserScroll, { passive: true });
      this.drawerListEl.addEventListener('pointerdown', onUserScroll, { passive: true });
      this.drawerListEl.addEventListener('touchstart', onUserScroll, { passive: true });
    }

    // 抽屉回位快捷按钮 (点击立即平滑回到当前正在说的句子)
    this.drawerSyncBtnEl = this.shadow.querySelector('#drawer-sync-btn');
    this.drawerSyncBtnEl?.addEventListener('click', (e) => {
      e.stopPropagation();
      this.resetDrawerSyncState(true);
    });

    // 彻底隔离剧本抽屉与快速面板的滚轮穿透，防止把 YouTube 推荐视频/评论滑上来
    if (this.drawerEl) {
      this.preventScrollChaining(this.drawerEl, () => this.drawerListEl);
    }
    if (this.quickPanelEl) {
      this.preventScrollChaining(this.quickPanelEl, () => {
        if (!this.quickPanelEl) return null;
        return this.quickPanelEl.classList.contains('subview-style-open')
          ? (this.qpViewStyleEl || (this.quickPanelEl.querySelector('.qp-view-style') as HTMLElement))
          : (this.qpViewMainEl || (this.quickPanelEl.querySelector('.qp-view-main') as HTMLElement));
      });
    }

    // 3. 全局外部点击自愈守护：用户点击 YouTube 播放器、控制条、原生悬浮弹窗或页面时，自动收起插件面板/抽屉，确保原生交互零干扰
    window.addEventListener('pointerdown', (e) => {
      const path = (e.composedPath && e.composedPath()) || [];
      if (this.isQuickPanelOpen && this.quickPanelEl) {
        const isClickInsidePanel = path.includes(this.quickPanelEl);
        const isClickOnCbarBtn = path.some((el: any) => el?.classList?.contains?.('yt-sub-translator-cbar-btn'));
        if (!isClickInsidePanel && !isClickOnCbarBtn) {
          this.toggleQuickPanel(false);
        }
      }

      if (this.isDrawerOpen && this.drawerEl) {
        const isClickInsideDrawer = path.includes(this.drawerEl);
        const isClickOnOpenBtn = path.some(
          (el: any) => el?.classList?.contains?.('btn-drawer') || el?.id === 'qp-btn-open-drawer'
        );
        if (!isClickInsideDrawer && !isClickOnOpenBtn) {
          this.toggleDrawer(false);
        }
      }
    });
  }

  /**
   * 阻止容器内部滚轮事件传递冒泡给外部页面（彻底防止外层 YouTube 页面滚动、推荐视频滑出），
   * 同时保障内部可滚动视图在各种复杂子节点、全屏模式与操作系统下 100% 顺畅响应滚轮
   */
  private preventScrollChaining(
    containerEl: HTMLElement,
    scrollTarget: HTMLElement | null | (() => HTMLElement | null)
  ) {
    containerEl.addEventListener(
      'wheel',
      (e: WheelEvent) => {
        // 彻底阻止向 YouTube 播放器及宿主页面冒泡
        e.stopPropagation();

        const scrollEl = typeof scrollTarget === 'function' ? scrollTarget() : scrollTarget;
        if (!scrollEl) {
          e.preventDefault();
          return;
        }

        // 若是剧本列表滚动，触发 5 秒锁定
        if (scrollEl === this.drawerListEl && !this.isProgrammaticScrolling) {
          this.handleDrawerUserScroll();
        }

        const deltaY = e.deltaY;
        if (Math.abs(deltaY) < 0.5) return;

        const scrollTop = scrollEl.scrollTop;
        const scrollHeight = scrollEl.scrollHeight;
        const clientHeight = scrollEl.clientHeight;
        const maxScroll = scrollHeight - clientHeight;

        // 内容未超出无需滚动时，直接阻止默认，防止滚轮冲量外溢到 YouTube 页面
        if (maxScroll <= 0) {
          e.preventDefault();
          return;
        }

        const isAtTop = scrollTop <= 0;
        const isAtBottom = scrollTop >= maxScroll - 1;

        // 到达顶部继续往上滚，或到达底部继续往下滚，阻止默认冲量外溢到 YouTube
        if ((deltaY < 0 && isAtTop) || (deltaY > 0 && isAtBottom)) {
          e.preventDefault();
          return;
        }

        // 精准驱动容器即时平滑滚动，并 preventDefault 杜绝外层页面连锁滚动与事件穿透
        scrollEl.scrollBy({ top: deltaY, behavior: 'auto' });
        e.preventDefault();
      },
      { passive: false }
    );
  }

  private exportSRT() {
    if (this.allSentences.length === 0) {
      this.showToast('暂无字幕可导出');
      return;
    }

    let srt = '';
    this.allSentences.forEach((s, idx) => {
      srt += `${idx + 1}\n`;
      srt += `${this.formatSrtTime(s.start)} --> ${this.formatSrtTime(s.end)}\n`;
      srt += `${s.text}\n`;
      if (s.translation) {
        srt += `${s.translation}\n`;
      }
      srt += '\n';
    });

    this.downloadFile(srt, 'youtube-subtitles.srt', 'text/plain;charset=utf-8');
  }

  private exportTXT() {
    if (this.allSentences.length === 0) {
      this.showToast('暂无字幕可导出');
      return;
    }

    let txt = '';
    this.allSentences.forEach((s) => {
      const timeStr = this.formatTime(s.start);
      txt += `[${timeStr}] ${s.text}\n`;
      if (s.translation) {
        txt += `       ${s.translation}\n`;
      }
      txt += '\n';
    });

    this.downloadFile(txt, 'youtube-subtitles.txt', 'text/plain;charset=utf-8');
  }

  private downloadFile(content: string, filename: string, mime: string) {
    const blob = new Blob([content], { type: mime });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
    this.showToast(`已导出 ${filename}`);
  }

  public showToast(msg: string) {
    if (!this.shadow) return;
    const toast = document.createElement('div');
    toast.className = 'toast-notification';
    toast.textContent = msg;
    this.shadow.appendChild(toast);
    setTimeout(() => {
      toast.classList.add('fade-out');
      setTimeout(() => toast.remove(), 400);
    }, 1800);
  }

  private formatTime(ms: number): string {
    const totalSec = Math.floor(ms / 1000);
    const m = Math.floor(totalSec / 60);
    const s = totalSec % 60;
    return `${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`;
  }

  private formatSrtTime(ms: number): string {
    const totalSec = Math.floor(ms / 1000);
    const h = Math.floor(totalSec / 3600);
    const m = Math.floor((totalSec % 3600) / 60);
    const s = totalSec % 60;
    const millis = ms % 1000;
    return `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')},${String(
      millis
    ).padStart(3, '0')}`;
  }

  private escapeHtml(str: string): string {
    return str
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#039;');
  }

  private renderTemplate(): string {
    return `
            <style>
        :host {
          all: initial;
          font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, 'Helvetica Neue', Arial, sans-serif;
          user-select: text;
          --ease-elastic: cubic-bezier(0.34, 0.96, 0.6, 0.99);
        }

        *, *::before, *::after {
          box-sizing: border-box;
        }

        /* 状态提示药丸 (Neon Glass Pill) */
        .status-indicator {
          position: absolute;
          top: 16px;
          right: 20px;
          background: rgba(18, 18, 20, 0.88);
          color: #ffffff;
          border: 1px solid rgba(255, 255, 255, 0.2);
          padding: 6px 14px;
          border-radius: 999px;
          font-size: 11.5px;
          font-weight: 500;
          backdrop-filter: blur(16px);
          -webkit-backdrop-filter: blur(16px);
          opacity: 0;
          pointer-events: none;
          transform: translateY(-4px) scale(0.96);
          transition: opacity 0.25s ease, transform 0.3s var(--ease-elastic);
          z-index: 90;
          box-shadow: 0 8px 24px rgba(0, 0, 0, 0.5), inset 0 1px 0 rgba(255, 255, 255, 0.2);
        }

        .status-indicator.visible {
          opacity: 1;
          transform: translateY(0) scale(1);
        }

        /* 字幕卡片主体 (Uiverse ugly-lion-23 风格毛玻璃) */
        .subtitle-box {
          position: absolute;
          left: 50%;
          transform: translateX(-50%) translateY(4px) scale(0.98);
          display: flex;
          flex-direction: column;
          align-items: center;
          text-align: center;
          max-width: 84%;
          min-width: 240px;
          padding: 10px 22px;
          border-radius: 14px;
          color: #ffffff;
          border: 1px solid rgba(255, 255, 255, 0.16);
          border-top: 1px solid rgba(255, 255, 255, 0.3);
          box-shadow: 0 16px 38px rgba(0, 0, 0, 0.55), inset 0 1px 0 rgba(255, 255, 255, 0.22);
          backdrop-filter: blur(16px) saturate(180%);
          -webkit-backdrop-filter: blur(16px) saturate(180%);
          transition: background-color 0.15s ease, opacity 0.25s cubic-bezier(0.16, 1, 0.3, 1), bottom 0.28s cubic-bezier(0.16, 1, 0.3, 1), transform 0.3s var(--ease-elastic);
          pointer-events: auto;
          opacity: 0;
          pointer-events: none;
        }

        .subtitle-box.active {
          opacity: 1;
          transform: translateX(-50%) translateY(0) scale(1);
          pointer-events: auto;
        }

        .subtitle-box:hover .controls-bar,
        .subtitle-box.hover-active .controls-bar,
        .controls-bar:hover {
          opacity: 1;
          transform: translateX(-50%) translateY(0) scale(1);
          pointer-events: auto;
          transition-delay: 0s;
        }

        /* 悬浮工具坞 (Apple Glass Dock 风格) */
        .controls-bar {
          position: absolute;
          bottom: 100%;
          left: 50%;
          transform: translateX(-50%) translateY(4px) scale(0.96);
          margin-bottom: 6px;
          background: rgba(18, 18, 20, 0.85);
          backdrop-filter: blur(20px) saturate(160%);
          -webkit-backdrop-filter: blur(20px) saturate(160%);
          border: 1px solid rgba(255, 255, 255, 0.14);
          border-top: 1px solid rgba(255, 255, 255, 0.25);
          border-radius: 999px;
          padding: 3px 6px;
          display: flex;
          align-items: center;
          gap: 4px;
          opacity: 0;
          pointer-events: none;
          box-shadow: 0 12px 32px rgba(0, 0, 0, 0.5), inset 0 1px 0 rgba(255, 255, 255, 0.2);
          transition: opacity 0.2s cubic-bezier(0.16, 1, 0.3, 1), transform 0.2s cubic-bezier(0.16, 1, 0.3, 1);
          transition-delay: 0.18s;
          z-index: 20;
          white-space: nowrap;
        }

        /* 隐形连通桥梁：彻底消除 controls-bar 与 subtitle-box 之间的空隙，鼠标移上去绝不闪退 */
        .controls-bar::after {
          content: '';
          position: absolute;
          left: -14px;
          right: -14px;
          top: 100%;
          height: 16px;
          background: transparent;
          pointer-events: none;
        }

        .subtitle-box:hover .controls-bar::after,
        .subtitle-box.hover-active .controls-bar::after,
        .controls-bar:hover::after {
          pointer-events: auto;
        }

        .ctrl-btn {
          background: transparent;
          border: none;
          color: #a1a1aa;
          font-size: 11px;
          padding: 4px 8px;
          border-radius: 999px;
          cursor: pointer;
          display: flex;
          align-items: center;
          gap: 4px;
          transition: all 0.2s ease;
        }

        .ctrl-btn:hover {
          color: #ffffff;
          background: rgba(255, 255, 255, 0.12);
        }

        .ctrl-btn.drag-handle {
          cursor: grab;
        }

        .ctrl-btn.drag-handle:active {
          cursor: grabbing;
        }

        .original-text {
          font-weight: 500;
          line-height: 1.35;
          margin-bottom: 3px;
          text-shadow: 0 2px 5px rgba(0, 0, 0, 0.9);
        }

        .translated-text {
          font-weight: 600;
          line-height: 1.35;
          text-shadow: 0 2px 6px rgba(0, 0, 0, 0.95);
        }

        .sentence-ai-badge {
          position: absolute;
          top: 7px;
          right: 9px;
          width: 16px;
          height: 16px;
          display: flex;
          align-items: center;
          justify-content: center;
          color: var(--ai-icon-color, #fbbf24);
          pointer-events: none;
          filter: drop-shadow(0 2px 4px rgba(0, 0, 0, 0.7));
          transition: color 0.2s ease, opacity 0.2s ease;
          z-index: 10;
        }

        .sentence-ai-badge svg {
          width: 100%;
          height: 100%;
          display: block;
        }

        /* ==========================================================================
           播放器内嵌快捷面板 (In-Player Quick Panel - 多级子视图滑动架构)
           ========================================================================== */
        .quick-panel {
          position: absolute;
          bottom: 58px;
          right: 18px;
          width: 320px;
          height: min(470px, calc(100% - 68px));
          max-height: calc(100% - 68px);
          box-sizing: border-box;
          background: rgba(18, 18, 22, 0.9);
          backdrop-filter: blur(24px) saturate(180%);
          -webkit-backdrop-filter: blur(24px) saturate(180%);
          border: 1px solid rgba(255, 255, 255, 0.16);
          border-top: 1px solid rgba(255, 255, 255, 0.28);
          border-radius: 14px;
          box-shadow: 0 20px 50px rgba(0, 0, 0, 0.7), inset 0 1px 0 rgba(255, 255, 255, 0.2);
          padding: 0;
          color: #ffffff;
          display: flex;
          flex-direction: column;
          pointer-events: none;
          opacity: 0;
          visibility: hidden;
          transform: translateY(12px) scale(0.96);
          transition: opacity 0.25s cubic-bezier(0.16, 1, 0.3, 1), transform 0.35s var(--ease-elastic), visibility 0.25s;
          z-index: 120;
          overflow: hidden;
          overscroll-behavior: contain;
          overscroll-behavior-y: contain;
        }

        /* 关键防御：未处于 open 状态时彻底从渲染树中隐藏并禁用事件，杜绝隐形拦截 YouTube 原生按键 */
        .quick-panel:not(.open) {
          display: none !important;
          opacity: 0 !important;
          visibility: hidden !important;
          pointer-events: none !important;
        }

        .quick-panel:not(.open) * {
          pointer-events: none !important;
          visibility: hidden !important;
        }

        .quick-panel::-webkit-scrollbar {
          width: 5px;
        }

        .quick-panel::-webkit-scrollbar-track {
          background: transparent;
        }

        .quick-panel::-webkit-scrollbar-thumb {
          background: rgba(255, 255, 255, 0.18);
          border-radius: 999px;
        }

        .quick-panel::-webkit-scrollbar-thumb:hover {
          background: rgba(255, 255, 255, 0.3);
        }

        .quick-panel.open {
          display: flex !important;
          opacity: 1 !important;
          visibility: visible !important;
          transform: translateY(0) scale(1) !important;
          pointer-events: auto !important;
        }

        /* 多级视图滑动视口与跑道 */
        .qp-views-slider {
          display: flex;
          width: 200%;
          height: 100%;
          align-items: stretch;
          transition: transform 0.36s var(--ease-elastic);
        }

        .quick-panel.subview-style-open .qp-views-slider {
          transform: translateX(-50%);
        }

        .qp-view {
          width: 50%;
          height: 100%;
          flex-shrink: 0;
          display: flex;
          flex-direction: column;
          gap: 8px;
          box-sizing: border-box;
          padding: 12px 14px;
          overflow-y: auto;
          overflow-x: hidden;
          scrollbar-gutter: stable;
          overscroll-behavior: contain;
          transition: opacity 0.25s ease, visibility 0.25s;
        }

        .qp-view::-webkit-scrollbar {
          width: 5px;
        }

        .qp-view::-webkit-scrollbar-track {
          background: transparent;
        }

        .qp-view::-webkit-scrollbar-thumb {
          background: rgba(255, 255, 255, 0.16);
          border-radius: 999px;
        }

        .qp-view::-webkit-scrollbar-thumb:hover {
          background: rgba(255, 255, 255, 0.32);
        }

        /* 视口状态驱动的彻底隔离：仅在 .quick-panel.open 打开时才允许响应交互 */
        .quick-panel.open:not(.subview-style-open) .qp-view-main {
          opacity: 1;
          visibility: visible;
          pointer-events: auto;
        }

        .quick-panel.open:not(.subview-style-open) .qp-view-style {
          opacity: 0;
          visibility: hidden;
          pointer-events: none;
        }

        .quick-panel.open.subview-style-open .qp-view-main {
          opacity: 0;
          visibility: hidden;
          pointer-events: none;
        }

        .quick-panel.open.subview-style-open .qp-view-style {
          opacity: 1;
          visibility: visible;
          pointer-events: auto;
        }

        .qp-header {
          display: flex;
          align-items: center;
          justify-content: space-between;
          padding-bottom: 6px;
          border-bottom: 1px solid rgba(255, 255, 255, 0.1);
        }

        .qp-title {
          font-size: 13.5px;
          font-weight: 600;
          color: #ffffff;
          display: flex;
          align-items: center;
          gap: 7px;
          letter-spacing: 0.2px;
        }

        .qp-header-right {
          display: flex;
          align-items: center;
          gap: 8px;
        }

        .qp-close {
          background: transparent;
          border: none;
          color: #a1a1aa;
          cursor: pointer;
          padding: 2px;
          border-radius: 4px;
          transition: all 0.2s ease;
        }

        .qp-close:hover {
          color: #ffffff;
          background: rgba(255, 255, 255, 0.1);
        }

        /* 磨砂开关 Toggle */
        .qp-switch {
          position: relative;
          display: inline-block;
          width: 38px;
          height: 20px;
        }

        .qp-switch input {
          opacity: 0;
          width: 0;
          height: 0;
        }

        .qp-slider {
          position: absolute;
          cursor: pointer;
          top: 0; left: 0; right: 0; bottom: 0;
          background: rgba(255, 255, 255, 0.12);
          border: 1px solid rgba(255, 255, 255, 0.18);
          border-radius: 999px;
          transition: 0.25s ease;
        }

        .qp-slider:before {
          position: absolute;
          content: "";
          height: 14px;
          width: 14px;
          left: 2px;
          bottom: 2px;
          background: #ffffff;
          border-radius: 50%;
          transition: transform 0.3s var(--ease-elastic);
          box-shadow: 0 1px 3px rgba(0, 0, 0, 0.4);
        }

        .qp-switch input:checked + .qp-slider {
          background: #ffffff;
          border-color: #ffffff;
          box-shadow: 0 0 10px rgba(255, 255, 255, 0.35);
        }

        .qp-switch input:checked + .qp-slider:before {
          transform: translateX(18px);
          background: #121214;
        }

        /* AI Banner */
        .qp-ai-banner {
          background: rgba(255, 255, 255, 0.04);
          border: 1px solid rgba(255, 255, 255, 0.1);
          box-shadow: 0 4px 16px rgba(0, 0, 0, 0.25), inset 0 1px 0 rgba(255, 255, 255, 0.1);
          border-radius: 10px;
          padding: 8px 10px;
          display: flex;
          flex-direction: column;
          gap: 6px;
          backdrop-filter: blur(14px);
        }

        .qp-ai-top {
          display: flex;
          align-items: center;
          gap: 6px;
        }

        .qp-ai-btn {
          flex: 1;
          background: rgba(255, 255, 255, 0.08);
          color: #ffffff;
          border: 1px solid rgba(255, 255, 255, 0.18);
          padding: 7px 12px;
          border-radius: 7px;
          font-size: 11.5px;
          font-weight: 500;
          cursor: pointer;
          display: flex;
          align-items: center;
          justify-content: center;
          gap: 6px;
          box-shadow: 0 2px 8px rgba(0, 0, 0, 0.2), inset 0 1px 0 rgba(255, 255, 255, 0.2);
          transition: all 0.2s var(--ease-elastic);
        }

        .qp-ai-btn:hover {
          background: rgba(255, 255, 255, 0.16);
          border-color: rgba(255, 255, 255, 0.3);
          transform: translateY(-1px);
        }

        .qp-ai-btn.done {
          background: rgba(255, 255, 255, 0.18);
          border-color: rgba(255, 255, 255, 0.35);
        }

        .qp-ai-clear-btn {
          background: rgba(255, 255, 255, 0.08);
          border: 1px solid rgba(255, 255, 255, 0.14);
          color: #a1a1aa;
          padding: 6px;
          border-radius: 7px;
          cursor: pointer;
          transition: all 0.2s ease;
        }

        .qp-ai-clear-btn:hover {
          background: rgba(255, 255, 255, 0.15);
          color: #ffffff;
        }

        .qp-ai-progress-wrap {
          display: flex;
          flex-direction: column;
          gap: 4px;
        }

        .qp-ai-progress-info {
          display: flex;
          justify-content: space-between;
          font-size: 10.5px;
          color: #a1a1aa;
        }

        .qp-ai-progress-bar {
          height: 4px;
          background: rgba(255, 255, 255, 0.1);
          border-radius: 999px;
          overflow: hidden;
        }

        .qp-ai-progress-fill {
          height: 100%;
          background: #ffffff;
          border-radius: 999px;
          transition: width 0.25s var(--ease-elastic);
        }

        .qp-ai-tip {
          font-size: 10px;
          color: #71717a;
          display: flex;
          align-items: center;
          gap: 4px;
        }

        /* 【v0.1.0 改动注释：矢量沙漏专属物理旋转动画（转180°停一会再转180°，无缝循环）】 */
        @keyframes hourglassFlip {
          0% {
            transform: rotate(0deg);
          }
          25% {
            transform: rotate(180deg);
          }
          50% {
            transform: rotate(180deg);
          }
          75% {
            transform: rotate(360deg);
          }
          100% {
            transform: rotate(360deg);
          }
        }

        .hourglass-flip-anim {
          display: inline-flex !important;
          align-items: center;
          justify-content: center;
          animation: hourglassFlip 2.4s cubic-bezier(0.4, 0, 0.2, 1) infinite;
          transform-origin: center center;
          will-change: transform;
        }

        .qp-status-bar {
          display: flex;
          align-items: center;
          gap: 6px;
          font-size: 11px;
          color: #e4e4e7;
          background: rgba(255, 255, 255, 0.04);
          padding: 6px 10px;
          border-radius: 8px;
          border: 1px solid rgba(255, 255, 255, 0.08);
          min-height: 28px;
        }

        #qp-track-status {
          display: inline-flex;
          align-items: center;
          gap: 6px;
          width: 100%;
          color: #e4e4e7;
          font-size: 11px;
          font-weight: 500;
          letter-spacing: 0.1px;
        }

        .qp-status-icon-wrap {
          display: inline-flex;
          align-items: center;
          justify-content: center;
          width: 13px;
          height: 13px;
          flex-shrink: 0;
          color: #ffffff;
        }

        .qp-status-icon-wrap svg {
          width: 100%;
          height: 100%;
        }

        .qp-retry-link {
          text-decoration: underline;
          text-underline-offset: 2px;
          color: #ffffff;
          opacity: 0.85;
          cursor: pointer;
          transition: opacity 0.2s ease;
          margin-left: 2px;
        }

        .qp-retry-link:hover {
          opacity: 1;
          text-decoration: underline;
        }

        .drawer-ai-badge {
          display: inline-flex;
          align-items: center;
          font-size: 10px;
          font-weight: 600;
          padding: 1px 5px;
          border-radius: 4px;
          background: rgba(255, 255, 255, 0.1);
          border: 1px solid rgba(255, 255, 255, 0.16);
          color: #ffffff;
          margin-right: 4px;
          line-height: 1.2;
        }

        /* 折叠手风琴项 (向下平滑展开，固定项不位移) */
        .qp-accordion-item {
          background: rgba(255, 255, 255, 0.035);
          border: 1px solid rgba(255, 255, 255, 0.09);
          border-radius: 8px;
          overflow: hidden;
          transition: border-color 0.25s var(--ease-elastic), background 0.25s var(--ease-elastic);
          flex-shrink: 0;
        }

        .qp-accordion-item.expanded {
          background: rgba(255, 255, 255, 0.06);
          border-color: rgba(255, 255, 255, 0.22);
        }

        .qp-accordion-header {
          width: 100%;
          background: transparent;
          border: none;
          padding: 7px 9px;
          display: flex;
          align-items: center;
          justify-content: space-between;
          cursor: pointer;
          color: #d4d4d8;
          font-size: 11.5px;
          text-align: left;
        }

        .qp-accordion-header:hover {
          color: #ffffff;
        }

        .qp-accordion-title {
          font-size: 11.5px;
          font-weight: 500;
          color: #ffffff;
        }

        .qp-accordion-header-left {
          display: flex;
          align-items: center;
          gap: 6px;
        }

        .qp-accordion-header-right {
          display: flex;
          align-items: center;
          gap: 6px;
        }

        .qp-accordion-badge {
          font-size: 10.5px;
          color: #e4e4e7;
          background: rgba(255, 255, 255, 0.08);
          padding: 1px 6px;
          border-radius: 4px;
          border: 1px solid rgba(255, 255, 255, 0.14);
          font-family: inherit;
        }

        .qp-accordion-arrow {
          font-size: 11px;
          color: #71717a;
          transition: transform 0.28s var(--ease-elastic), color 0.2s ease;
          display: inline-block;
        }

        .qp-accordion-item.expanded .qp-accordion-arrow {
          transform: rotate(90deg);
          color: #ffffff;
        }

        /* 手风琴向下平滑物理展开动效 (CSS Grid 0fr -> 1fr) */
        .qp-accordion-body {
          display: grid;
          grid-template-rows: 0fr;
          transition: grid-template-rows 0.3s var(--ease-elastic), opacity 0.25s ease, padding 0.3s var(--ease-elastic);
          opacity: 0;
          padding: 0 8px;
        }

        .qp-accordion-body-inner {
          min-height: 0;
          overflow: hidden;
        }

        .qp-accordion-item.expanded .qp-accordion-body {
          grid-template-rows: 1fr;
          opacity: 1;
          padding: 0 8px 8px 8px;
        }

        /* 平滑滑动选项切换器 (Smooth Option Switcher) */
        .qp-smooth-switcher {
          position: relative;
          display: flex;
          background: rgba(0, 0, 0, 0.45);
          border: 1px solid rgba(255, 255, 255, 0.1);
          border-radius: 7px;
          padding: 2px;
          user-select: none;
          overflow: hidden;
          box-sizing: border-box;
          width: 100%;
        }

        .qp-smooth-switcher .switcher-glider {
          position: absolute;
          top: 2px;
          bottom: 2px;
          left: 2px;
          width: calc((100% - 4px) / var(--count, 2));
          box-sizing: border-box;
          background: rgba(255, 255, 255, 0.14);
          border: 1px solid rgba(255, 255, 255, 0.28);
          border-radius: 5px;
          box-shadow: 0 2px 6px rgba(0, 0, 0, 0.4), inset 0 1px 0 rgba(255, 255, 255, 0.25);
          transform: translateX(calc(var(--active-index, 0) * 100%));
          transition: transform 0.36s var(--ease-elastic);
          pointer-events: none;
          z-index: 1;
        }

        .qp-smooth-switcher .switcher-item {
          flex: 1 1 0;
          min-width: 0;
          box-sizing: border-box;
          position: relative;
          z-index: 2;
          background: transparent;
          border: none;
          color: #a1a1aa;
          padding: 5px 2px;
          font-size: 11px;
          font-weight: 500;
          cursor: pointer;
          display: inline-flex;
          align-items: center;
          justify-content: center;
          transition: color 0.2s ease;
          white-space: nowrap;
          text-align: center;
        }

        .qp-smooth-switcher .switcher-item:hover {
          color: #ffffff;
        }

        .qp-smooth-switcher .switcher-item.active {
          color: #ffffff;
          font-weight: 600;
          text-shadow: 0 1px 2px rgba(0, 0, 0, 0.6);
        }

        /* 时间轴微调按键 */
        .qp-btn-group {
          display: flex;
          gap: 6px;
        }

        .qp-btn-item {
          flex: 1;
          background: rgba(255, 255, 255, 0.06);
          border: 1px solid rgba(255, 255, 255, 0.12);
          color: #d4d4d8;
          padding: 5px 2px;
          border-radius: 6px;
          font-size: 11px;
          cursor: pointer;
          transition: all 0.2s ease;
          text-align: center;
        }

        .qp-btn-item:hover {
          background: rgba(255, 255, 255, 0.15);
          border-color: rgba(255, 255, 255, 0.28);
          color: #ffffff;
          transform: translateY(-1px);
        }

        .qp-divider {
          height: 1px;
          background: rgba(255, 255, 255, 0.08);
          margin: 1px 0;
        }

        /* 二级导航卡片 (沉浸式同款“字幕设置 >”) */
        .qp-nav-card {
          width: 100%;
          background: rgba(255, 255, 255, 0.05);
          border: 1px solid rgba(255, 255, 255, 0.12);
          border-radius: 9px;
          padding: 8px 10px;
          display: flex;
          align-items: center;
          justify-content: space-between;
          cursor: pointer;
          color: #ffffff;
          transition: all 0.2s ease;
          text-align: left;
        }

        .qp-nav-card:hover {
          background: rgba(255, 255, 255, 0.1);
          border-color: rgba(255, 255, 255, 0.25);
          transform: translateY(-1px);
        }

        .qp-nav-card-left {
          display: flex;
          align-items: center;
          gap: 8px;
        }

        .qp-nav-card-text {
          display: flex;
          flex-direction: column;
          gap: 1px;
        }

        .qp-nav-card-title {
          font-size: 12px;
          font-weight: 500;
          color: #ffffff;
        }

        .qp-nav-card-desc {
          font-size: 10px;
          color: #71717a;
        }

        .qp-nav-card-arrow {
          color: #a1a1aa;
          display: inline-flex;
          align-items: center;
          transition: transform 0.2s ease;
        }

        .qp-nav-card:hover .qp-nav-card-arrow {
          transform: translateX(2px);
          color: #ffffff;
        }

        /* 底部操作区 */
        .qp-actions {
          display: flex;
          gap: 6px;
        }

        .qp-action-btn {
          flex: 1;
          background: rgba(255, 255, 255, 0.06);
          border: 1px solid rgba(255, 255, 255, 0.12);
          color: #d4d4d8;
          padding: 6px 8px;
          border-radius: 7px;
          font-size: 11px;
          cursor: pointer;
          display: inline-flex;
          align-items: center;
          justify-content: center;
          gap: 5px;
          transition: all 0.2s ease;
        }

        .qp-action-btn:hover {
          background: rgba(255, 255, 255, 0.15);
          border-color: rgba(255, 255, 255, 0.25);
          color: #ffffff;
          transform: translateY(-1px);
        }

        /* 二级子视图 (Sub-view) */
        .qp-sub-header {
          display: flex;
          align-items: center;
          justify-content: space-between;
          padding-bottom: 6px;
          border-bottom: 1px solid rgba(255, 255, 255, 0.1);
        }

        .qp-sub-header-left {
          display: flex;
          align-items: center;
          gap: 6px;
        }

        .qp-back-btn {
          background: rgba(255, 255, 255, 0.08);
          border: 1px solid rgba(255, 255, 255, 0.14);
          color: #ffffff;
          width: 22px;
          height: 22px;
          border-radius: 5px;
          cursor: pointer;
          display: flex;
          align-items: center;
          justify-content: center;
          padding: 0;
          transition: all 0.2s ease;
        }

        .qp-back-btn:hover {
          background: rgba(255, 255, 255, 0.16);
          border-color: rgba(255, 255, 255, 0.28);
        }

        .qp-sub-title {
          font-size: 13px;
          font-weight: 600;
          color: #ffffff;
        }

        .qp-sub-body {
          display: flex;
          flex-direction: column;
          gap: 7px;
          padding-top: 2px;
        }

        .qp-section {
          background: rgba(255, 255, 255, 0.035);
          border: 1px solid rgba(255, 255, 255, 0.08);
          border-radius: 8px;
          padding: 6px 8px;
          display: flex;
          flex-direction: column;
          gap: 5px;
        }

        .qp-row-between {
          display: flex;
          align-items: center;
          justify-content: space-between;
        }

        .qp-label {
          font-size: 11px;
          color: #d4d4d8;
          font-weight: 500;
        }

        .qp-val-badge {
          font-size: 10.5px;
          color: #ffffff;
          background: rgba(255, 255, 255, 0.1);
          border: 1px solid rgba(255, 255, 255, 0.16);
          padding: 1px 6px;
          border-radius: 4px;
        }

        .qp-color-input {
          -webkit-appearance: none;
          appearance: none;
          border: none;
          width: 20px;
          height: 20px;
          border-radius: 50%;
          cursor: pointer;
          background: transparent;
        }

        .qp-color-input::-webkit-color-swatch-wrapper {
          padding: 0;
        }

        .qp-color-input::-webkit-color-swatch {
          border: 1px solid rgba(255, 255, 255, 0.3);
          border-radius: 50%;
        }

        .qp-color-presets {
          display: flex;
          align-items: center;
          gap: 6px;
        }

        .color-dot {
          width: 17px;
          height: 17px;
          border-radius: 50%;
          cursor: pointer;
          border: 1px solid rgba(255, 255, 255, 0.25);
          transition: transform 0.2s ease, border-color 0.2s ease;
        }

        .color-dot:hover {
          transform: scale(1.18);
          border-color: #ffffff;
        }

        .color-dot.active {
          transform: scale(1.2);
          border: 2px solid #ffffff;
          box-shadow: 0 0 6px rgba(255, 255, 255, 0.5);
        }

        .color-dot.checkerboard {
          background-image: linear-gradient(45deg, #444 25%, transparent 25%), 
                            linear-gradient(-45deg, #444 25%, transparent 25%), 
                            linear-gradient(45deg, transparent 75%, #444 75%), 
                            linear-gradient(-45deg, transparent 75%, #444 75%);
          background-size: 4px 4px;
          background-position: 0 0, 0 2px, 2px -2px, -2px 0px;
          background-color: #222;
        }

        .qp-range {
          -webkit-appearance: none;
          appearance: none;
          width: 100%;
          height: 4px;
          border-radius: 999px;
          background: rgba(255, 255, 255, 0.12);
          outline: none;
        }

        .qp-range::-webkit-slider-thumb {
          -webkit-appearance: none;
          appearance: none;
          width: 14px;
          height: 14px;
          border-radius: 50%;
          background: #ffffff;
          cursor: pointer;
          box-shadow: 0 1px 4px rgba(0, 0, 0, 0.4);
          border: 2px solid #18181b;
        }

        .qp-preview-micro-card {
          position: relative;
          background: rgba(0, 0, 0, 0.5);
          border: 1px solid rgba(255, 255, 255, 0.14);
          border-radius: 8px;
          padding: 6px 14px 6px 10px;
          text-align: center;
          display: flex;
          flex-direction: column;
          gap: 2px;
          backdrop-filter: blur(10px);
        }

        .qp-preview-micro-ai {
          position: absolute;
          top: 6px;
          right: 7px;
          width: 11px;
          height: 11px;
          display: flex;
          align-items: center;
          justify-content: center;
          color: var(--ai-icon-color, #fbbf24);
          pointer-events: none;
        }

        .qp-preview-micro-ai svg {
          width: 100%;
          height: 100%;
          display: block;
        }

        .qp-preview-micro-orig {
          font-size: 10px;
          color: #cbd5e1;
        }

        .qp-preview-micro-trans {
          font-size: 11px;
          color: #ffffff;
          font-weight: 500;
        }

        /* 侧边剧本抽屉 */
        .transcript-drawer {
          position: absolute;
          top: 0;
          right: 0;
          width: 320px;
          height: 100%;
          background: rgba(18, 18, 20, 0.92);
          backdrop-filter: blur(24px) saturate(180%);
          -webkit-backdrop-filter: blur(24px) saturate(180%);
          border-left: 1px solid rgba(255, 255, 255, 0.14);
          box-shadow: -10px 0 35px rgba(0, 0, 0, 0.6);
          color: #ffffff;
          display: flex;
          flex-direction: column;
          z-index: 130;
          transform: translateX(100%);
          transition: transform 0.35s var(--ease-elastic);
          pointer-events: none;
        }

        /* 关键防御：未处于 open 状态时彻底从渲染树中隐藏并禁用事件 */
        .transcript-drawer:not(.open) {
          display: none !important;
          visibility: hidden !important;
          pointer-events: none !important;
        }

        .transcript-drawer:not(.open) * {
          visibility: hidden !important;
          pointer-events: none !important;
        }

        .transcript-drawer.open {
          display: flex !important;
          visibility: visible !important;
          transform: translateX(0);
          pointer-events: auto;
        }

        .drawer-header {
          padding: 12px 14px;
          display: flex;
          align-items: center;
          justify-content: space-between;
          border-bottom: 1px solid rgba(255, 255, 255, 0.1);
        }

        .drawer-title {
          font-size: 13px;
          font-weight: 600;
          color: #ffffff;
        }

        .drawer-actions {
          display: flex;
          align-items: center;
          gap: 6px;
        }

        .action-icon-btn {
          background: rgba(255, 255, 255, 0.08);
          border: 1px solid rgba(255, 255, 255, 0.14);
          color: #ffffff;
          font-size: 10.5px;
          padding: 3px 7px;
          border-radius: 5px;
          cursor: pointer;
          transition: all 0.2s ease;
        }

        .action-icon-btn:hover {
          background: rgba(255, 255, 255, 0.16);
          border-color: rgba(255, 255, 255, 0.28);
        }

        .drawer-search-box {
          padding: 8px 12px;
          border-bottom: 1px solid rgba(255, 255, 255, 0.08);
        }

        .drawer-search-input {
          width: 100%;
          background: rgba(255, 255, 255, 0.05);
          border: 1px solid rgba(255, 255, 255, 0.12);
          border-radius: 6px;
          padding: 6px 9px;
          color: #ffffff;
          font-size: 11.5px;
          outline: none;
          box-sizing: border-box;
        }

        .drawer-search-input:focus {
          border-color: rgba(255, 255, 255, 0.35);
        }

        .drawer-sentences-list {
          flex: 1;
          overflow-y: auto;
          scrollbar-gutter: stable;
          padding: 8px 10px;
          display: flex;
          flex-direction: column;
          gap: 6px;
        }

        /* 【v0.1.0 改动注释：剧本抽屉极简 5px 毛玻璃细滚动条】
           替代原生粗宽滚动条，保证在全屏或窗口缩放时槽位恒定美观，滑块半透明白 */
        .drawer-sentences-list::-webkit-scrollbar {
          width: 5px;
        }

        .drawer-sentences-list::-webkit-scrollbar-track {
          background: transparent;
        }

        .drawer-sentences-list::-webkit-scrollbar-thumb {
          background: rgba(255, 255, 255, 0.16);
          border-radius: 999px;
        }

        .drawer-sentences-list::-webkit-scrollbar-thumb:hover {
          background: rgba(255, 255, 255, 0.32);
        }

        .drawer-item {
          background: rgba(255, 255, 255, 0.035);
          border: 1px solid rgba(255, 255, 255, 0.08);
          border-radius: 7px;
          padding: 6px 8px;
          display: flex;
          flex-direction: column;
          gap: 2px;
          font-size: 11px;
          cursor: pointer;
          transition: all 0.2s ease;
        }

        .drawer-item:hover {
          background: rgba(255, 255, 255, 0.08);
          border-color: rgba(255, 255, 255, 0.18);
        }

        /* 【v0.1.0 改动注释：当前句选择框颜色与当前译文颜色动态同步】
           通过 CSS 变量 --drawer-current-border / --drawer-current-bg / --drawer-current-glow 联动，
           严禁写死固定蓝色，跟随用户在样式设置中指定的译文颜色实时换色 */
        .drawer-item.active,
        .drawer-item.current {
          background: var(--drawer-current-bg, rgba(56, 189, 248, 0.15));
          border-color: var(--drawer-current-border, #38bdf8);
          box-shadow: 0 0 12px var(--drawer-current-glow, rgba(56, 189, 248, 0.25));
        }

        /* 【v0.1.0 改动注释：「5s回到当前句」浮动胶囊弹窗】
           与全局黑白毛玻璃视觉体系统一：纯净深色磨砂底色 + 白色微光描边 + 顶部 1px 立体微高光，
           结合 ByteDance IconPark 官方 Stopwatch 矢量秒表图标，彻底去除彩色 emoji 与过时蓝色边框 */
        .drawer-sync-btn {
          position: absolute;
          bottom: 12px;
          left: 50%;
          transform: translateX(-50%);
          background: rgba(18, 18, 22, 0.88);
          backdrop-filter: blur(16px);
          -webkit-backdrop-filter: blur(16px);
          border: 1px solid rgba(255, 255, 255, 0.16);
          color: #ffffff;
          padding: 6px 14px;
          border-radius: 999px;
          font-size: 11px;
          font-weight: 500;
          font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif;
          letter-spacing: 0.2px;
          cursor: pointer;
          display: inline-flex;
          align-items: center;
          gap: 6px;
          box-shadow: 0 4px 18px rgba(0, 0, 0, 0.45), inset 0 1px 0 rgba(255, 255, 255, 0.14);
          transition: all 0.25s cubic-bezier(0.16, 1, 0.3, 1);
          z-index: 20;
          white-space: nowrap;
          user-select: none;
        }

        .drawer-sync-btn .sync-icon {
          display: inline-flex;
          align-items: center;
          justify-content: center;
          width: 13px;
          height: 13px;
          color: #ffffff;
          flex-shrink: 0;
        }

        .drawer-sync-btn .sync-icon svg {
          width: 100%;
          height: 100%;
          display: block;
        }

        .drawer-sync-btn:hover {
          background: rgba(255, 255, 255, 0.14);
          border-color: rgba(255, 255, 255, 0.32);
          box-shadow: 0 6px 22px rgba(0, 0, 0, 0.55), inset 0 1px 0 rgba(255, 255, 255, 0.25);
          transform: translateX(-50%) translateY(-1px) scale(1.02);
        }

        .drawer-sync-btn:active {
          transform: translateX(-50%) translateY(0) scale(0.97);
        }

        .drawer-sync-btn.hidden {
          opacity: 0;
          pointer-events: none;
          transform: translateX(-50%) translateY(14px) scale(0.95);
        }

        .item-time {
          font-size: 9.5px;
          color: #71717a;
        }

        .item-original {
          color: #cbd5e1;
        }

        .item-translated {
          color: #ffffff;
          font-weight: 500;
        }

        .empty-state {
          padding: 30px 10px;
          text-align: center;
          color: #71717a;
          font-size: 12px;
        }

        .toast-notification {
          position: absolute;
          bottom: 24px;
          left: 50%;
          transform: translateX(-50%);
          background: rgba(24, 24, 27, 0.92);
          color: #ffffff;
          border: 1px solid rgba(255, 255, 255, 0.18);
          padding: 7px 16px;
          border-radius: 999px;
          font-size: 12px;
          box-shadow: 0 6px 24px rgba(0, 0, 0, 0.55), inset 0 1px 0 rgba(255, 255, 255, 0.2);
          backdrop-filter: blur(16px);
          pointer-events: none;
          z-index: 200;
        }

        .toast-notification.fade-out {
          opacity: 0;
          transition: opacity 0.35s ease-out;
        }

        .hidden {
          display: none !important;
        }
      </style>

      <div class="status-indicator"></div>

      <div class="subtitle-box">
        <div class="sentence-ai-badge hidden" id="sentence-ai-badge" title="当前字幕由大模型 AI 深度精翻生成">
          ${ICON_AI_HEXASTAR}
        </div>
        <div class="controls-bar">
          <button class="ctrl-btn drag-handle" title="按住拖拽调节字幕垂直位置">
            <span class="icon-svg" style="display:inline-flex;width:14px;height:14px;margin-right:4px;">${ICON_DRAG}</span>
            <span>拖动</span>
          </button>
          <button class="ctrl-btn btn-copy" title="复制当前句子">
            <span class="icon-svg" style="display:inline-flex;width:14px;height:14px;margin-right:4px;">${ICON_COPY}</span>
            <span>复制</span>
          </button>
          <button class="ctrl-btn btn-retry" title="重新翻译当前句">
            <span class="icon-svg" style="display:inline-flex;width:14px;height:14px;margin-right:4px;">${ICON_REFRESH}</span>
            <span>重试</span>
          </button>
          <button class="ctrl-btn btn-drawer" title="查看完整断句转写文稿">
            <span class="icon-svg" style="display:inline-flex;width:14px;height:14px;margin-right:4px;">${ICON_FILE_TEXT}</span>
            <span>剧本</span>
          </button>
          <button class="ctrl-btn btn-hide" title="临时隐藏/显示字幕">
            <span class="icon-svg" style="display:inline-flex;width:14px;height:14px;margin-right:4px;">${ICON_PREVIEW_CLOSE}</span>
            <span>隐藏</span>
          </button>
        </div>
        <div class="original-text"></div>
        <div class="translated-text"></div>
      </div>

      <!-- 类似沉浸式翻译的播放器内置快速控制面板 (多级视图架构) -->
      <div class="quick-panel" style="opacity:0;visibility:hidden;pointer-events:none;">
        <div class="qp-views-slider">
          <!-- 主界面视图 (Main View - 类似用户图2) -->
          <div class="qp-view qp-view-main">
            <div class="qp-header">
              <div class="qp-title">
                <span class="qp-logo" style="display:inline-flex;width:17px;height:17px;align-items:center;color:#ffffff;">${ICON_TRANSLATE}</span><span>智能字幕与翻译</span>
              </div>
              <div class="qp-header-right">
                <label class="qp-switch" title="开启/关闭字幕翻译">
                  <input type="checkbox" id="qp-enabled-toggle">
                  <span class="qp-slider"></span>
                </label>
                <button class="qp-close" title="收起面板" style="display:inline-flex;width:20px;height:20px;align-items:center;justify-content:center;">${ICON_CLOSE}</button>
              </div>
            </div>

            <!-- 沉浸式同款：请求 AI 深度字幕 (Beta) -->
            <div class="qp-ai-banner">
              <div class="qp-ai-top">
                <button class="qp-ai-btn" id="qp-btn-request-ai" title="使用当前大模型(DeepSeek/Gemini/OpenAI)进行整篇深度智能断句与母语级意译">
                  <span class="qp-ai-star" style="display:inline-flex;width:15px;height:15px;align-items:center;">${ICON_SPARKLES}</span>
                  <span id="qp-ai-btn-text">请求 AI 深度字幕 (Beta)</span>
                </button>
                <button class="qp-ai-clear-btn hidden" id="qp-btn-clear-ai" title="释放并删除当前视频的临时 AI 字幕" style="display:inline-flex;width:16px;height:16px;align-items:center;justify-content:center;">${ICON_CLOSE}</button>
              </div>
              <div class="qp-ai-progress-wrap hidden" id="qp-ai-progress-wrap">
                <div class="qp-ai-progress-info">
                  <span id="qp-ai-progress-text">正在 AI 深度精翻...</span>
                  <span id="qp-ai-progress-percent">0%</span>
                </div>
                <div class="qp-ai-progress-bar">
                  <div class="qp-ai-progress-fill" id="qp-ai-progress-fill" style="width: 0%;"></div>
                </div>
              </div>
              <div class="qp-ai-tip">
                <span style="display:inline-flex;width:12px;height:12px;align-items:center;color:#a1a1aa;">${ICON_LOCK}</span>
                <span>临时存储于本地 · 切换/关闭视频后自动销毁</span>
              </div>
            </div>

            <div class="qp-status-bar">
              <span id="qp-track-status">
                <span class="qp-status-icon-wrap hourglass-flip-anim" style="color:#ffffff;">${ICON_HOURGLASS}</span>
                <span>正在多通道检测字幕...</span>
              </span>
            </div>

            <!-- 折叠模块 1：双语排版模式 (纯中文无图标 · 4段平滑滑块) -->
            <div class="qp-accordion-item" data-accordion="mode">
              <button type="button" class="qp-accordion-header" title="点击展开/收起排版设置">
                <div class="qp-accordion-header-left">
                  <span class="qp-accordion-icon" style="display:inline-flex;width:14px;height:14px;align-items:center;color:#d4d4d8;">${ICON_ALIGN}</span>
                  <span class="qp-accordion-title">双语排版模式</span>
                </div>
                <div class="qp-accordion-header-right">
                  <span class="qp-accordion-badge" id="qp-badge-mode">译上原下</span>
                  <span class="qp-accordion-arrow">▸</span>
                </div>
              </button>
              <div class="qp-accordion-body">
                <div class="qp-accordion-body-inner">
                  <div class="smooth-switcher qp-smooth-switcher" data-switcher="mode" data-count="4" style="--count: 4; --active-index: 0;">
                    <div class="switcher-glider" aria-hidden="true"></div>
                    <button type="button" class="switcher-item active" data-mode="bilingual-trans-top" title="中文译文在上，外文原文在下 (沉浸式推荐)">译上原下</button>
                    <button type="button" class="switcher-item" data-mode="bilingual-orig-top" title="外文原文在上，中文译文在下 (跟读对照)">原上译下</button>
                    <button type="button" class="switcher-item" data-mode="trans-only" title="仅显示中文译文">纯译文</button>
                    <button type="button" class="switcher-item" data-mode="orig-only" title="仅显示外文原文">纯原文</button>
                  </div>
                </div>
              </div>
            </div>

            <!-- 折叠模块 2：时间轴同步微调 -->
            <div class="qp-accordion-item" data-accordion="offset">
              <button type="button" class="qp-accordion-header" title="点击展开/收起时间轴微调">
                <div class="qp-accordion-header-left">
                  <span class="qp-accordion-icon" style="display:inline-flex;width:14px;height:14px;align-items:center;color:#d4d4d8;">${ICON_TIME}</span>
                  <span class="qp-accordion-title">时间轴同步微调</span>
                </div>
                <div class="qp-accordion-header-right">
                  <span class="qp-accordion-badge" id="qp-offset-val">0ms</span>
                  <span class="qp-accordion-arrow">▸</span>
                </div>
              </button>
              <div class="qp-accordion-body">
                <div class="qp-accordion-body-inner">
                  <div class="qp-btn-group">
                    <button type="button" class="qp-btn-item" id="qp-offset-minus" title="字幕提前 200ms (快于声音)">-0.2s</button>
                    <button type="button" class="qp-btn-item" id="qp-offset-reset" title="重置时间偏移为 0">重置 (0s)</button>
                    <button type="button" class="qp-btn-item" id="qp-offset-plus" title="字幕延后 200ms (慢于声音)">+0.2s</button>
                  </div>
                </div>
              </div>
            </div>

            <!-- 折叠模块 3：翻译场景 (2段平滑滑块) -->
            <div class="qp-accordion-item" data-accordion="scenario">
              <button type="button" class="qp-accordion-header" title="点击展开/收起翻译场景">
                <div class="qp-accordion-header-left">
                  <span class="qp-accordion-icon" style="display:inline-flex;width:14px;height:14px;align-items:center;color:#d4d4d8;">${ICON_THEATER}</span>
                  <span class="qp-accordion-title">翻译场景</span>
                </div>
                <div class="qp-accordion-header-right">
                  <span class="qp-accordion-badge" id="qp-badge-scenario">VTuber直播</span>
                  <span class="qp-accordion-arrow">▸</span>
                </div>
              </button>
              <div class="qp-accordion-body">
                <div class="qp-accordion-body-inner">
                  <div class="smooth-switcher qp-smooth-switcher" data-switcher="scenario" data-count="2" style="--count: 2; --active-index: 0;">
                    <div class="switcher-glider" aria-hidden="true"></div>
                    <button type="button" class="switcher-item active" data-scenario="vtuber">VTuber 直播</button>
                    <button type="button" class="switcher-item" data-scenario="general">通用日常</button>
                  </div>
                </div>
              </div>
            </div>

            <!-- 折叠模块 4：推理思考深度 (3段平滑滑块) -->
            <div class="qp-accordion-item" data-accordion="reasoning">
              <button type="button" class="qp-accordion-header" title="点击展开/收起推理深度">
                <div class="qp-accordion-header-left">
                  <span class="qp-accordion-icon" style="display:inline-flex;width:14px;height:14px;align-items:center;color:#d4d4d8;">${ICON_BRAIN}</span>
                  <span class="qp-accordion-title">推理思考深度</span>
                </div>
                <div class="qp-accordion-header-right">
                  <span class="qp-accordion-badge" id="qp-badge-reasoning">轻度</span>
                  <span class="qp-accordion-arrow">▸</span>
                </div>
              </button>
              <div class="qp-accordion-body">
                <div class="qp-accordion-body-inner">
                  <div class="smooth-switcher qp-smooth-switcher" data-switcher="reasoning" data-count="3" style="--count: 3; --active-index: 1;">
                    <div class="switcher-glider" aria-hidden="true"></div>
                    <button type="button" class="switcher-item" data-reasoning="none">极速</button>
                    <button type="button" class="switcher-item active" data-reasoning="low">轻度</button>
                    <button type="button" class="switcher-item" data-reasoning="high">深度</button>
                  </div>
                </div>
              </div>
            </div>

            <div class="qp-divider"></div>

            <!-- 二级子菜单导航入口卡片 (类似沉浸式翻译“字幕设置 >”) -->
            <button class="qp-nav-card" id="qp-btn-to-style" type="button" title="点击进入字幕外观、字体颜色与透明度设置">
              <div class="qp-nav-card-left">
                <span class="qp-nav-card-icon" style="display:inline-flex;width:16px;height:16px;align-items:center;color:#ffffff;">${ICON_SETTING}</span>
                <div class="qp-nav-card-text">
                  <span class="qp-nav-card-title">字幕外观与样式设置</span>
                  <span class="qp-nav-card-desc">颜色 · 字体大小 · 背景透明度</span>
                </div>
              </div>
              <span class="qp-nav-card-arrow" style="display:inline-flex;width:16px;height:16px;align-items:center;">${ICON_RIGHT}</span>
            </button>

            <div class="qp-divider"></div>

            <div class="qp-actions">
              <button class="qp-action-btn" id="qp-btn-open-drawer" style="display:inline-flex;align-items:center;justify-content:center;gap:5px;">
                <span style="display:inline-flex;width:13px;height:13px;">${ICON_FILE_TEXT}</span>
                <span>剧本全文</span>
              </button>
              <button class="qp-action-btn" id="qp-btn-retranslate" style="display:inline-flex;align-items:center;justify-content:center;gap:5px;">
                <span style="display:inline-flex;width:13px;height:13px;">${ICON_REFRESH}</span>
                <span>重新翻译</span>
              </button>
            </div>
          </div>

          <!-- 外观与样式二级子视图 (Sub-view - 类似用户图3) -->
          <div class="qp-view qp-view-style">
            <div class="qp-sub-header">
              <div class="qp-sub-header-left">
                <button class="qp-back-btn" id="qp-btn-back-main" type="button" title="返回主菜单">
                  <span class="qp-back-arrow" style="display:inline-flex;width:16px;height:16px;align-items:center;">${ICON_LEFT}</span>
                </button>
                <span class="qp-sub-title">字幕外观与样式</span>
              </div>
              <button class="qp-close" title="收起面板" style="display:inline-flex;width:20px;height:20px;align-items:center;justify-content:center;">${ICON_CLOSE}</button>
            </div>

            <div class="qp-sub-body">
              <div class="qp-section">
                <div class="qp-row-between">
                  <span class="qp-label">译文字体颜色</span>
                  <input type="color" id="qp-trans-color-picker" class="qp-color-input" value="#38bdf8">
                </div>
                <div class="qp-color-presets" data-target="transColor">
                  <span class="color-dot" style="background:#fb7185" data-color="#fb7185" title="樱花粉 (VTuber推荐)"></span>
                  <span class="color-dot" style="background:#38bdf8" data-color="#38bdf8" title="天蓝色"></span>
                  <span class="color-dot" style="background:#facc15" data-color="#facc15" title="明艳黄"></span>
                  <span class="color-dot" style="background:#4ade80" data-color="#4ade80" title="青草绿"></span>
                  <span class="color-dot" style="background:#ffffff" data-color="#ffffff" title="纯白"></span>
                </div>
              </div>

              <div class="qp-section">
                <div class="qp-row-between">
                  <span class="qp-label">原文字体颜色</span>
                  <input type="color" id="qp-orig-color-picker" class="qp-color-input" value="#e2e8f0">
                </div>
                <div class="qp-color-presets" data-target="origColor">
                  <span class="color-dot" style="background:#e2e8f0" data-color="#e2e8f0" title="柔和白"></span>
                  <span class="color-dot" style="background:#fef08a" data-color="#fef08a" title="淡浅黄"></span>
                  <span class="color-dot" style="background:#a5f3fc" data-color="#a5f3fc" title="浅天蓝"></span>
                  <span class="color-dot" style="background:#94a3b8" data-color="#94a3b8" title="素雅灰"></span>
                </div>
              </div>

              <div class="qp-section">
                <div class="qp-row-between">
                  <span class="qp-label">AI 深度标识颜色</span>
                  <input type="color" id="qp-ai-color-picker" class="qp-color-input" value="#fbbf24">
                </div>
                <div class="qp-color-presets" data-target="aiIconColor">
                  <span class="color-dot" style="background:#fbbf24" data-color="#fbbf24" title="琥珀金 (默认)"></span>
                  <span class="color-dot" style="background:#38bdf8" data-color="#38bdf8" title="天蓝色"></span>
                  <span class="color-dot" style="background:#fb7185" data-color="#fb7185" title="樱花粉"></span>
                  <span class="color-dot" style="background:#4ade80" data-color="#4ade80" title="青草绿"></span>
                  <span class="color-dot" style="background:#c084fc" data-color="#c084fc" title="梦幻紫"></span>
                  <span class="color-dot" style="background:#ffffff" data-color="#ffffff" title="纯白"></span>
                </div>
              </div>

              <div class="qp-section">
                <div class="qp-row-between">
                  <span class="qp-label">字幕背景颜色</span>
                  <input type="color" id="qp-bg-color-picker" class="qp-color-input" value="#0f172a">
                </div>
                <div class="qp-color-presets" data-target="bgColor">
                  <span class="color-dot" style="background:#0f172a" data-color="#0f172a" title="深空蓝黑"></span>
                  <span class="color-dot" style="background:#000000" data-color="#000000" title="纯黑"></span>
                  <span class="color-dot" style="background:#1e1b4b" data-color="#1e1b4b" title="暗夜紫"></span>
                  <span class="color-dot" style="background:#4c0519" data-color="#4c0519" title="暗酒红"></span>
                  <span class="color-dot checkerboard" data-color="#00000000" title="纯透明无底色"></span>
                </div>
              </div>

              <div class="qp-section">
                <div class="qp-row-between">
                  <span class="qp-label">背景不透明度</span>
                  <span id="qp-opacity-val" class="qp-val-badge">75%</span>
                </div>
                <input type="range" id="qp-opacity-range" min="0" max="100" step="5" value="75" class="qp-range">
              </div>

              <div class="qp-section">
                <div class="qp-row-between">
                  <span class="qp-label">字体大小</span>
                  <span id="qp-font-size-val" class="qp-val-badge">20px</span>
                </div>
                <input type="range" id="qp-font-size-range" min="14" max="36" step="1" value="20" class="qp-range">
              </div>

              <!-- 实时微缩效果预览卡片 -->
              <div class="qp-preview-micro-card" id="qp-micro-preview-card">
                <div class="qp-preview-micro-ai" id="qp-micro-preview-ai" title="AI 深度精翻标识预览">
                  ${ICON_AI_HEXASTAR}
                </div>
                <div class="qp-preview-micro-orig" id="qp-micro-preview-orig">So let's build something awesome today.</div>
                <div class="qp-preview-micro-trans" id="qp-micro-preview-trans">所以让我们今天一起打造惊艳之作。</div>
              </div>
            </div>
          </div>
        </div>
      </div>

      <!-- 侧边剧本抽屉 -->
      <div class="transcript-drawer">
        <div class="drawer-header">
          <div class="drawer-title">
            <span style="display:inline-flex;align-items:center;gap:6px;"><span style="display:inline-flex;width:15px;height:15px;">${ICON_FILE_TEXT}</span><span>视频断句与翻译文稿</span></span>
          </div>
          <div class="drawer-actions">
            <button class="action-icon-btn btn-export-srt" title="导出为双语 SRT 字幕文件">SRT</button>
            <button class="action-icon-btn btn-export-txt" title="导出为 TXT 文本">TXT</button>
            <button class="action-icon-btn drawer-close" title="关闭抽屉" style="display:inline-flex;align-items:center;justify-content:center;">${ICON_CLOSE}</button>
          </div>
        </div>
        <div class="drawer-search-box">
          <input type="text" class="drawer-search-input" placeholder="搜索原文字幕或译文..." />
        </div>
        <div class="drawer-sentences-list">
          <div class="empty-state">正在检测与加载字幕轨道...</div>
        </div>
        <button class="drawer-sync-btn hidden" id="drawer-sync-btn" title="点击立即平滑回到当前正在说的句子">
          <span class="sync-icon" aria-hidden="true">${ICON_STOPWATCH}</span>
          <span class="sync-text">5s 后回到当前句</span>
        </button>
      </div>
    `;
  }
}
