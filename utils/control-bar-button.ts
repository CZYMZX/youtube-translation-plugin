/**
 * YouTube 播放器控制栏快捷按钮注入器
 * 采用全天候自愈（Self-Healing）多层级看门狗与选择器级存在性校验，
 * 采用 ByteDance IconPark 官方矢量标准与黑白极简毛玻璃（Monochrome Glassmorphism）质感。
 */

import { BRAND_PATH_D } from './icons';
export interface ControlButtonCallbacks {
  onClick: () => void;
}

// 品牌标识（双气泡无限符号）—— 纯透明背景，只保留 logo 本身（不放磨砂卡片）
export const MONOCHROME_ICONPARK_BTN_SVG = `
<svg viewBox="43 128 426 256" style="width: 34px !important; height: 34px !important; min-width: 34px !important; min-height: 34px !important; display: block !important; flex-shrink: 0 !important; pointer-events: none !important;" fill="none" xmlns="http://www.w3.org/2000/svg">
  <!-- 白色双气泡无限符号（视窗已收紧到墨迹包围盒，无卡片底、无描边） -->
  <path fill="#FFFFFF" fill-rule="evenodd" d="${BRAND_PATH_D}"/>
</svg>
`;

export class ControlBarButtonManager {
  private buttonEl: HTMLElement | null = null;
  private isEnabled: boolean = true;
  private callbacks: ControlButtonCallbacks;
  private checkTimer: ReturnType<typeof setInterval> | null = null;
  private observer: MutationObserver | null = null;
  private observedControlsEl: HTMLElement | null = null;
  private burstTimers = new Set<ReturnType<typeof setTimeout>>();
  private resizeDebounceTimer: ReturnType<typeof setTimeout> | null = null;
  private boundBurstHandler: (() => void) | null = null;
  private boundVisibilityHandler: (() => void) | null = null;
  private boundResizeHandler: (() => void) | null = null;
  private destroyed = false;

  constructor(callbacks: ControlButtonCallbacks, initialEnabled = true) {
    this.callbacks = callbacks;
    this.isEnabled = initialEnabled;
  }

  public init() {
    this.startWatchdog();
  }

  public setEnabled(enabled: boolean) {
    this.isEnabled = enabled;
    this.updateStyle();
  }

  public updateStyle() {
    const target = this.buttonEl || (document.querySelector('.yt-sub-translator-cbar-btn') as HTMLElement);
    if (!target) return;

    const inner = target.querySelector('.yt-sub-btn-inner') as HTMLElement;
    if (inner) {
      // 无卡片底：启用/停用只切透明度，不画发光描边
      inner.style.opacity = this.isEnabled ? '1' : '0.38';
      inner.style.boxShadow = 'none';
    }
  }

  /**
   * 严谨多级获取当前主播放器正在使用的右下角控制栏容器
   */
  private getActiveRightControls(): HTMLElement | null {
    const watchFlexy = document.querySelector('ytd-watch-flexy');
    if (watchFlexy) {
      const flexyControls = watchFlexy.querySelector('#movie_player .ytp-right-controls, .html5-video-player .ytp-right-controls') as HTMLElement;
      if (flexyControls) return flexyControls;
    }

    const mainPlayer = document.getElementById('movie_player');
    if (mainPlayer) {
      const controls = mainPlayer.querySelector('.ytp-right-controls') as HTMLElement;
      if (controls) return controls;
    }

    const nonPreviewPlayer = document.querySelector('.html5-video-player:not(.ytp-preview)');
    if (nonPreviewPlayer) {
      const controls = nonPreviewPlayer.querySelector('.ytp-right-controls') as HTMLElement;
      if (controls) return controls;
    }

    const all = document.querySelectorAll('.ytp-right-controls');
    for (let i = all.length - 1; i >= 0; i--) {
      const el = all[i] as HTMLElement;
      if (el.closest('.ytp-preview')) continue;
      if (el.offsetParent !== null || el.offsetWidth > 0) return el;
    }

    return (all[0] as HTMLElement) || null;
  }

  /**
   * 检查并确保按钮可靠挂载到活跃控制栏中
   */
  public checkAndMount() {
    const rightControls = this.getActiveRightControls();
    if (!rightControls) return;

    if (this.observedControlsEl !== rightControls) {
      this.attachControlsObserver(rightControls);
    }

    const existing = rightControls.querySelector('.yt-sub-translator-cbar-btn') as HTMLElement;
    if (existing && existing.isConnected) {
      if (this.buttonEl !== existing) {
        this.buttonEl = existing;
      }
      this.updateStyle();
      return;
    }

    this.createAndInjectButton(rightControls);
  }

  private attachControlsObserver(controlsEl: HTMLElement) {
    if (this.observer) {
      this.observer.disconnect();
    }
    this.observedControlsEl = controlsEl;
    this.observer = new MutationObserver(() => {
      const existing = controlsEl.querySelector('.yt-sub-translator-cbar-btn') as HTMLElement;
      if (!existing || !existing.isConnected) {
        this.checkAndMount();
      }
    });
    this.observer.observe(controlsEl, { childList: true });
  }

  private createAndInjectButton(rightControls: HTMLElement) {
    if (this.buttonEl) {
      try {
        this.buttonEl.remove();
      } catch (e) {}
      this.buttonEl = null;
    }

    const btn = document.createElement('button');
    btn.className = 'ytp-button yt-sub-translator-cbar-btn';
    btn.setAttribute('aria-label', '智能字幕断句与翻译设置');
    btn.setAttribute('title', '智能字幕断句与翻译 (点击打开快捷控制与调色面板)');
    btn.setAttribute('data-yt-sub-translator-btn', 'true');
    btn.style.cssText = `
      display: inline-flex !important;
      align-items: center !important;
      justify-content: center !important;
      vertical-align: top !important;
      width: 40px !important; min-width: 36px !important; max-width: 42px !important;
      height: 100% !important;
      min-height: 36px !important;
      cursor: pointer !important;
      background: transparent !important;
      border: none !important;
      outline: none !important;
      padding: 0 !important;
      margin: 0 !important;
      position: relative !important;
      visibility: visible !important;
      opacity: 1 !important;
      z-index: 60 !important;
      box-sizing: border-box !important;
      flex-shrink: 0 !important;
    `;

    // 去除磨砂卡片后，启用态不再有发光描边，只用透明度区分开/关
    const stateStyle = this.isEnabled ? 'opacity: 1;' : 'opacity: 0.38;';

    btn.innerHTML = `
      <div class="yt-sub-btn-inner" style="
        width: 36px !important; height: 36px !important; min-width: 36px !important; min-height: 36px !important; max-width: 36px !important; max-height: 36px !important;
        display: flex !important;
        align-items: center !important;
        justify-content: center !important;
        box-sizing: border-box !important;
        flex-shrink: 0 !important;
        overflow: visible !important;
        ${stateStyle}
        transition: transform 0.25s cubic-bezier(0.34, 0.96, 0.6, 0.99), opacity 0.2s ease;
      ">
        ${MONOCHROME_ICONPARK_BTN_SVG}
      </div>
    `;

    btn.addEventListener('mouseenter', () => {
      const inner = btn.querySelector('.yt-sub-btn-inner') as HTMLElement;
      if (inner) inner.style.transform = 'translateY(-1px) scale(1.1)';
    });
    btn.addEventListener('mouseleave', () => {
      const inner = btn.querySelector('.yt-sub-btn-inner') as HTMLElement;
      if (inner) inner.style.transform = 'translateY(0) scale(1)';
    });
    btn.addEventListener('mousedown', (e) => {
      e.stopPropagation();
      const inner = btn.querySelector('.yt-sub-btn-inner') as HTMLElement;
      if (inner) inner.style.transform = 'scale(0.92)';
    });
    btn.addEventListener('mouseup', () => {
      const inner = btn.querySelector('.yt-sub-btn-inner') as HTMLElement;
      if (inner) inner.style.transform = 'translateY(-1px) scale(1.1)';
    });

    btn.addEventListener('click', (e) => {
      e.stopPropagation();
      e.preventDefault();
      this.callbacks.onClick();
    });

    const refEl =
      rightControls.querySelector('.ytp-subtitles-button') ||
      rightControls.querySelector('.ytp-settings-button') ||
      rightControls.querySelector('.ytp-autonav-toggle-button');

    if (refEl) {
      refEl.insertAdjacentElement('beforebegin', btn);
    } else if (rightControls.firstChild) {
      rightControls.insertBefore(btn, rightControls.firstChild);
    } else {
      rightControls.appendChild(btn);
    }

    this.buttonEl = btn;
  }

  private clearBurstTimers() {
    for (const t of this.burstTimers) clearTimeout(t);
    this.burstTimers.clear();
  }

  private startWatchdog() {
    this.destroyed = false;
    this.checkAndMount();

    this.checkTimer = setInterval(() => {
      if (this.destroyed) return;
      this.checkAndMount();
    }, 350);

    const triggerBurstCheck = () => {
      if (this.destroyed) return;
      this.clearBurstTimers();
      this.checkAndMount();
      for (const delay of [80, 200, 500, 1000, 2000, 3500]) {
        const t = setTimeout(() => {
          this.burstTimers.delete(t);
          if (!this.destroyed) this.checkAndMount();
        }, delay);
        this.burstTimers.add(t);
      }
    };

    const onVisibility = () => {
      if (document.visibilityState === 'visible') {
        triggerBurstCheck();
      }
    };

    const onResize = () => {
      if (this.destroyed) return;
      if (this.resizeDebounceTimer) clearTimeout(this.resizeDebounceTimer);
      this.resizeDebounceTimer = setTimeout(() => {
        this.resizeDebounceTimer = null;
        if (!this.destroyed) this.checkAndMount();
      }, 150);
    };

    this.boundBurstHandler = triggerBurstCheck;
    this.boundVisibilityHandler = onVisibility;
    this.boundResizeHandler = onResize;

    window.addEventListener('yt-navigate-start', triggerBurstCheck);
    window.addEventListener('yt-navigate-finish', triggerBurstCheck);
    window.addEventListener('yt-page-data-updated', triggerBurstCheck);
    window.addEventListener('yt-player-updated' as any, triggerBurstCheck);
    window.addEventListener('spfdone', triggerBurstCheck);
    window.addEventListener('popstate', triggerBurstCheck);
    document.addEventListener('fullscreenchange', triggerBurstCheck);
    document.addEventListener('webkitfullscreenchange', triggerBurstCheck);
    document.addEventListener('visibilitychange', onVisibility);
    window.addEventListener('resize', onResize);
  }

  public destroy() {
    this.destroyed = true;
    if (this.checkTimer) {
      clearInterval(this.checkTimer);
      this.checkTimer = null;
    }
    if (this.resizeDebounceTimer) {
      clearTimeout(this.resizeDebounceTimer);
      this.resizeDebounceTimer = null;
    }
    this.clearBurstTimers();
    if (this.boundBurstHandler) {
      window.removeEventListener('yt-navigate-start', this.boundBurstHandler);
      window.removeEventListener('yt-navigate-finish', this.boundBurstHandler);
      window.removeEventListener('yt-page-data-updated', this.boundBurstHandler);
      window.removeEventListener('yt-player-updated' as any, this.boundBurstHandler);
      window.removeEventListener('spfdone', this.boundBurstHandler);
      window.removeEventListener('popstate', this.boundBurstHandler);
      document.removeEventListener('fullscreenchange', this.boundBurstHandler);
      document.removeEventListener('webkitfullscreenchange', this.boundBurstHandler);
      this.boundBurstHandler = null;
    }
    if (this.boundVisibilityHandler) {
      document.removeEventListener('visibilitychange', this.boundVisibilityHandler);
      this.boundVisibilityHandler = null;
    }
    if (this.boundResizeHandler) {
      window.removeEventListener('resize', this.boundResizeHandler);
      this.boundResizeHandler = null;
    }
    if (this.observer) {
      this.observer.disconnect();
      this.observer = null;
    }
    this.observedControlsEl = null;
    if (this.buttonEl) {
      try {
        this.buttonEl.remove();
      } catch (e) {}
      this.buttonEl = null;
    }
  }
}
