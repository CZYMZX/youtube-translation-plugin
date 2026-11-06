/**
 * ============================================================================
 * YouTube 智能字幕断句翻译器 - 播放器覆盖层与交互核心 (SubtitleOverlay)
 * 当前版本: v0.4.0 (VSR 红线约束下的浮层实现)
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
import { OVERLAY_STYLES } from './overlay-styles';

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

  // 抽屉增量渲染：避免每批翻译都重建最多数千个 DOM 节点
  private drawerNodes: Map<number, HTMLElement> = new Map();
  private drawerRenderedTranslations: Map<number, string> = new Map();
  private drawerDirty: boolean = true;
  private drawerCurrentId: number | null = null;
  private drawerRenderedFilter: string = '';
  private drawerRenderedTotal: number = 0;
  private drawerSearchTimer: any = null;

  // 全局监听器只注册一次，避免每次 mount 泄漏
  private globalListenersAttached: boolean = false;
  private boundFullscreenHandler: (() => void) | null = null;
  private boundPointerDownHandler: ((e: PointerEvent) => void) | null = null;
  private boundMouseMoveHandler: ((e: MouseEvent) => void) | null = null;
  private boundMouseUpHandler: (() => void) | null = null;
  private dragState = { active: false, startY: 0, startOffsetY: 82 };

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
    this.attachGlobalListeners();

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
    if (this.drawerSearchTimer) {
      clearTimeout(this.drawerSearchTimer);
      this.drawerSearchTimer = null;
    }
    if (this.host && this.host.parentElement) {
      this.host.parentElement.removeChild(this.host);
    }
    this.detachGlobalListeners();
    this.host = null;
    this.shadow = null;
    this.currentSentence = null;
    this.drawerNodes.clear();
    this.drawerRenderedTranslations.clear();
    this.drawerDirty = true;
    this.drawerCurrentId = null;
    // 重挂载后 DOM 是全新的，状态位必须同步复位，否则首次点击方向会反
    this.isDrawerOpen = false;
    this.isQuickPanelOpen = false;
  }

  public ensureMounted(playerContainer: HTMLElement) {
    if (!this.host || !this.host.parentElement || this.host.parentElement !== playerContainer) {
      this.mount(playerContainer);
    }
  }

  /**
   * 全局监听器只注册一次，destroy 时统一移除，避免 SPA 多次挂载造成监听器叠加
   */
  private attachGlobalListeners() {
    if (this.globalListenersAttached) return;
    this.globalListenersAttached = true;

    this.boundFullscreenHandler = () => {
      this.isFullscreen = !!(document.fullscreenElement || (document as any).webkitFullscreenElement);
      this.applyStyles();
    };
    document.addEventListener('fullscreenchange', this.boundFullscreenHandler);
    document.addEventListener('webkitfullscreenchange', this.boundFullscreenHandler);

    this.boundMouseMoveHandler = (e: MouseEvent) => {
      if (!this.dragState.active || !this.host) return;
      const rect = this.host.getBoundingClientRect();
      if (rect.height <= 0) return;

      const deltaPercent = ((e.clientY - this.dragState.startY) / rect.height) * 100;
      let newOffsetY = Math.round(this.dragState.startOffsetY + deltaPercent);
      newOffsetY = Math.max(30, Math.min(94, newOffsetY));

      this.settings.offsetY = newOffsetY;
      this.applyStyles();
    };
    this.boundMouseUpHandler = () => {
      if (!this.dragState.active) return;
      this.dragState.active = false;
      document.body.style.userSelect = '';
      this.onSettingsChangeCallback?.({ offsetY: this.settings.offsetY });
    };
    window.addEventListener('mousemove', this.boundMouseMoveHandler);
    window.addEventListener('mouseup', this.boundMouseUpHandler);

    // 全局外部点击自愈守护：点击播放器/页面空白处时自动收起面板与抽屉
    this.boundPointerDownHandler = (e: PointerEvent) => {
      const path = (e.composedPath && e.composedPath()) || [];
      if (this.isQuickPanelOpen && this.quickPanelEl) {
        const isClickInsidePanel = path.includes(this.quickPanelEl);
        const isClickOnCbarBtn = path.some((el: any) =>
          el?.classList?.contains?.('yt-sub-translator-cbar-btn')
        );
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
    };
    window.addEventListener('pointerdown', this.boundPointerDownHandler);
  }

  private detachGlobalListeners() {
    if (!this.globalListenersAttached) return;
    this.globalListenersAttached = false;

    if (this.boundFullscreenHandler) {
      document.removeEventListener('fullscreenchange', this.boundFullscreenHandler);
      document.removeEventListener('webkitfullscreenchange', this.boundFullscreenHandler);
      this.boundFullscreenHandler = null;
    }
    if (this.boundMouseMoveHandler) {
      window.removeEventListener('mousemove', this.boundMouseMoveHandler);
      this.boundMouseMoveHandler = null;
    }
    if (this.boundMouseUpHandler) {
      window.removeEventListener('mouseup', this.boundMouseUpHandler);
      this.boundMouseUpHandler = null;
    }
    if (this.boundPointerDownHandler) {
      window.removeEventListener('pointerdown', this.boundPointerDownHandler);
      this.boundPointerDownHandler = null;
    }
    this.dragState.active = false;
    document.body.style.userSelect = '';
  }

  public updateSettings(newSettings: ExtensionSettings) {
    this.settings = newSettings;
    this.applyStyles();
    this.syncQuickPanelValues();
    if (this.currentSentence) {
      this.renderCurrentSentence(this.currentSentence);
    }
    // 设置变更（含颜色滑块拖动）不再重建整份剧本列表，只刷新已有行的译文
    this.updateDrawerTranslations();
  }

  /**
   * 状态徽章只接受纯文本，图标由固定常量注入，杜绝 innerHTML 注入
   */
  public showStatusBadge(
    text: string,
    durationMs = 3000,
    icon: 'check' | 'alert' | 'none' = 'check'
  ) {
    if (!this.statusBadgeEl) return;
    this.statusBadgeEl.textContent = '';

    if (icon !== 'none') {
      const iconWrap = document.createElement('span');
      iconWrap.style.cssText =
        'display:inline-flex;width:12px;height:12px;margin-right:5px;vertical-align:-1px;color:#ffffff;';
      iconWrap.innerHTML = icon === 'alert' ? ICON_ALERT : ICON_CHECK;
      this.statusBadgeEl.appendChild(iconWrap);
    }

    this.statusBadgeEl.appendChild(document.createTextNode(text));
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
        this.showStatusBadge(`${mode}字幕已就绪 (${sentences.length} 句)`, 3000, 'check');
      }
    }
    this.syncQuickPanelValues();
    this.updateDrawerTranslations();
  }

  public setTrackEmpty(empty: boolean, _reason?: string) {
    this.isTrackEmpty = empty;
    if (empty) {
      this.showStatusBadge('暂未检测到字幕轨道 (可尝试开启CC字幕)', 3500, 'alert');
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
    const matched = this.findSentenceAt(effectiveTime);

    if (matched) {
      this.currentSentence = matched;
      this.renderCurrentSentence(matched);
      if (this.isDrawerOpen) {
        this.highlightDrawerItem(matched.id);
      }
    } else {
      if (this.currentSentence && effectiveTime - this.currentSentence.end > 1800) {
        this.clearCurrentDisplay();
      }
    }
  }

  /**
   * 二分查找当前时间对应句子（allSentences 按 start 升序），避免每帧 O(n) 扫描
   */
  private findSentenceAt(time: number): SubtitleSentence | null {
    const arr = this.allSentences;
    if (arr.length === 0) return null;

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

    const from = Math.max(0, lastStarted - 1);
    const to = Math.min(arr.length - 1, lastStarted + 2);
    // v0.2.6：重叠/宽限窗口内优先选择"最近开始"的句子，避免上一句在下一句开始后仍抢占显示
    for (let i = to; i >= from; i--) {
      const s = arr[i];
      if (time >= s.start && time <= s.end + 1500) return s;
    }
    return null;
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

  private renderDrawerList(force = false) {
    if (!this.drawerListEl) return;

    // 抽屉关闭时不构建 DOM，只标记脏数据，等打开时一次性渲染
    if (!this.isDrawerOpen) {
      this.drawerDirty = true;
      return;
    }

    const filterText = (this.searchInputEl?.value || '').trim().toLowerCase();
    const structureChanged =
      force ||
      this.drawerDirty ||
      filterText !== this.drawerRenderedFilter ||
      this.drawerRenderedTotal !== this.allSentences.length;

    if (!structureChanged) {
      this.updateDrawerTranslations();
      return;
    }

    const filtered = this.allSentences.filter((s) => {
      if (!filterText) return true;
      return (
        s.text.toLowerCase().includes(filterText) ||
        (s.translation && s.translation.toLowerCase().includes(filterText))
      );
    });

    this.drawerListEl.innerHTML = '';
    this.drawerNodes.clear();
    this.drawerRenderedTranslations.clear();
    this.drawerCurrentId = null;

    if (filtered.length === 0) {
      const empty = document.createElement('div');
      empty.className = 'empty-state';
      empty.textContent =
        this.allSentences.length === 0 ? '正在检测与加载字幕轨道...' : '未找到匹配的字幕';
      this.drawerListEl.appendChild(empty);
      this.drawerDirty = false;
      this.drawerRenderedFilter = filterText;
      this.drawerRenderedTotal = this.allSentences.length;
      return;
    }

    const fragment = document.createDocumentFragment();

    for (const s of filtered) {
      const itemEl = document.createElement('div');
      itemEl.className = 'drawer-item';
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

      this.drawerNodes.set(s.id, itemEl);
      this.drawerRenderedTranslations.set(s.id, `${s.translation || ''}|${s.isAi ? 1 : 0}`);
      fragment.appendChild(itemEl);
    }

    this.drawerListEl.appendChild(fragment);
    this.drawerDirty = false;
    this.drawerRenderedFilter = filterText;
    this.drawerRenderedTotal = this.allSentences.length;

    if (this.currentSentence) {
      this.highlightDrawerItem(this.currentSentence.id, false);
    }
  }

  /**
   * 增量刷新译文：只改动发生变化的那几行，避免每次翻译回调重建整份列表
   */
  private updateDrawerTranslations() {
    if (!this.drawerListEl) return;
    if (!this.isDrawerOpen) {
      this.drawerDirty = true;
      return;
    }
    if (this.drawerRenderedTotal !== this.allSentences.length) {
      this.drawerDirty = true;
      this.renderDrawerList();
      return;
    }

    for (const s of this.allSentences) {
      const node = this.drawerNodes.get(s.id);
      if (!node) {
        this.drawerDirty = true;
        this.renderDrawerList();
        return;
      }
      const signature = `${s.translation || ''}|${s.isAi ? 1 : 0}`;
      if (this.drawerRenderedTranslations.get(s.id) === signature) continue;

      const transEl = node.querySelector('.item-translation') as HTMLElement | null;
      if (!transEl) continue;

      transEl.textContent = '';
      if (s.isAi) {
        const badge = document.createElement('span');
        badge.className = 'drawer-ai-badge';
        badge.title = '大模型 AI 深度精翻';
        const icon = document.createElement('span');
        icon.style.cssText =
          'display:inline-flex;width:10px;height:10px;align-items:center;margin-right:2px;vertical-align:-0.5px;';
        icon.innerHTML = ICON_AI_HEXASTAR;
        badge.appendChild(icon);
        badge.appendChild(document.createTextNode('AI'));
        transEl.appendChild(badge);
        transEl.appendChild(document.createTextNode(' '));
      }
      transEl.appendChild(document.createTextNode(s.translation || '（待翻译）'));
      this.drawerRenderedTranslations.set(s.id, signature);
    }
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
    if (!this.drawerListEl || !this.isDrawerOpen) return;

    const curr = this.drawerNodes.get(sentenceId);
    if (!curr) return;

    if (this.drawerCurrentId !== null && this.drawerCurrentId !== sentenceId) {
      this.drawerNodes.get(this.drawerCurrentId)?.classList.remove('current', 'active');
    }
    curr.classList.add('current', 'active');
    this.drawerCurrentId = sentenceId;

    // 只有在满足强制滚动 (autoScroll = true，如倒计时归位或点击跳转)，
    // 或者当前用户未在主动上下拖拽翻阅 (isUserInteractingDrawer = false) 时才自动移动视口！
    if (autoScroll || !this.isUserInteractingDrawer) {
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
      const renderQpStatus = (
        icon: string,
        text: string,
        extra?: { text: string; className: string }
      ) => {
        statusEl.textContent = '';
        const iconWrap = document.createElement('span');
        iconWrap.className =
          icon === ICON_HOURGLASS ? 'qp-status-icon-wrap hourglass-flip-anim' : 'qp-status-icon-wrap';
        iconWrap.style.color = '#ffffff';
        iconWrap.innerHTML = icon;
        statusEl.appendChild(iconWrap);

        const textEl = document.createElement('span');
        textEl.textContent = text;
        statusEl.appendChild(textEl);

        if (extra) {
          const extraEl = document.createElement('span');
          extraEl.className = extra.className;
          extraEl.textContent = extra.text;
          statusEl.appendChild(extraEl);
        }
      };

      if (this.allSentences.length > 0) {
        const mode = this.settings.scenario === 'vtuber' ? 'VTuber直播' : '通用模式';
        renderQpStatus(ICON_CHECK, `已就绪 (${mode} · ${this.allSentences.length} 句)`);
        statusEl.style.color = '#ffffff';
        statusEl.style.cursor = 'default';
        statusEl.title = '';
      } else if (this.isTrackEmpty) {
        renderQpStatus(ICON_ALERT, '暂未检测到字幕', {
          text: ' [点击重试]',
          className: 'qp-retry-link'
        });
        statusEl.style.color = '#e4e4e7';
        statusEl.style.cursor = 'pointer';
        statusEl.title = '点击重新多通道扫描字幕';
      } else {
        renderQpStatus(ICON_HOURGLASS, '正在多通道检测字幕...');
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

    // 拖拽调整垂直位置（window 级 move/up 在全局监听器中统一注册，避免每次 mount 泄漏）
    const handleEl = this.shadow.querySelector('.drag-handle') as HTMLElement;
    if (handleEl) {
      handleEl.addEventListener('mousedown', (e) => {
        this.dragState = {
          active: true,
          startY: e.clientY,
          startOffsetY: this.settings.offsetY
        };
        document.body.style.userSelect = 'none';
        e.preventDefault();
        e.stopPropagation();
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
      // 输入防抖：最多 4114 行时，每个按键都全量过滤会明显卡顿
      if (this.drawerSearchTimer) clearTimeout(this.drawerSearchTimer);
      this.drawerSearchTimer = setTimeout(() => {
        this.drawerSearchTimer = null;
        this.renderDrawerList();
      }, 180);
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

    // 3. 全局外部点击守护已移至 attachGlobalListeners()，避免每次 mount 重复注册
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
            <style>${OVERLAY_STYLES}</style>

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
