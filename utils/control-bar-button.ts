/**
 * YouTube 播放器控制栏快捷按钮注入器
 * 采用全天候自愈（Self-Healing）多层级看门狗与选择器级存在性校验，
 * 采用 ByteDance IconPark 官方矢量标准与黑白极简毛玻璃（Monochrome Glassmorphism）质感。
 */

export interface ControlButtonCallbacks {
  onClick: () => void;
}

// ByteDance IconPark 风格单色黑白矢量对译图标
export const MONOCHROME_ICONPARK_BTN_SVG = `
<svg viewBox="0 0 48 48" style="width: 24px !important; height: 24px !important; min-width: 24px !important; min-height: 24px !important; display: block !important; flex-shrink: 0 !important; pointer-events: none !important;" fill="none" xmlns="http://www.w3.org/2000/svg">
  <!-- 外围极简微磨砂卡片 -->
  <rect x="3" y="3" width="42" height="42" rx="10" fill="rgba(255, 255, 255, 0.08)" stroke="rgba(255, 255, 255, 0.22)" stroke-width="2.5"/>
  <!-- ByteDance IconPark 经典中英翻译对译路径 (白色细线) -->
  <path d="M28.3 35H38.7M41 40L38.7 35L41 40ZM26 40L28.3 35L26 40ZM28.3 35L33.5 23L38.7 35H28.3Z" stroke="#FFFFFF" stroke-width="3" stroke-linecap="round" stroke-linejoin="round"/>
  <path d="M16 8L17 11" stroke="#FFFFFF" stroke-width="3" stroke-linecap="round" stroke-linejoin="round"/>
  <path d="M7 13H27" stroke="#FFFFFF" stroke-width="3" stroke-linecap="round" stroke-linejoin="round"/>
  <path d="M11 17C11 17 12.6 22.6 16.6 25.7C20.6 28.8 27 31.2 27 31.2" stroke="#FFFFFF" stroke-width="3" stroke-linecap="round" stroke-linejoin="round"/>
  <path d="M23 13C23 13 21.4 20.3 17.4 24.4C13.4 28.5 7 31.8 7 31.8" stroke="#FFFFFF" stroke-width="3" stroke-linecap="round" stroke-linejoin="round"/>
</svg>
`;

export class ControlBarButtonManager {
  private buttonEl: HTMLElement | null = null;
  private isEnabled: boolean = true;
  private callbacks: ControlButtonCallbacks;
  private checkTimer: any = null;
  private observer: MutationObserver | null = null;
  private observedControlsEl: HTMLElement | null = null;

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
      if (this.isEnabled) {
        inner.style.opacity = '1';
        inner.style.boxShadow = '0 0 6px rgba(255, 255, 255, 0.45)';
      } else {
        inner.style.opacity = '0.38';
        inner.style.boxShadow = 'none';
      }
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

    const stateStyle = this.isEnabled
      ? 'opacity: 1; box-shadow: 0 0 6px rgba(255, 255, 255, 0.45);'
      : 'opacity: 0.38;';

    btn.innerHTML = `
      <div class="yt-sub-btn-inner" style="
        width: 28px !important; height: 28px !important; min-width: 28px !important; min-height: 28px !important; max-width: 28px !important; max-height: 28px !important;
        display: flex !important;
        align-items: center !important;
        justify-content: center !important;
        box-sizing: border-box !important;
        flex-shrink: 0 !important;
        border-radius: 8px !important;
        overflow: hidden !important;
        ${stateStyle}
        transition: transform 0.25s cubic-bezier(0.34, 0.96, 0.6, 0.99), filter 0.2s ease, opacity 0.2s ease;
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
      (rightControls.firstChild as HTMLElement).insertAdjacentElement('beforebegin', btn);
    } else {
      rightControls.appendChild(btn);
    }

    this.buttonEl = btn;
  }

  private startWatchdog() {
    this.checkAndMount();

    this.checkTimer = setInterval(() => {
      this.checkAndMount();
    }, 350);

    const triggerBurstCheck = () => {
      this.checkAndMount();
      setTimeout(() => this.checkAndMount(), 80);
      setTimeout(() => this.checkAndMount(), 200);
      setTimeout(() => this.checkAndMount(), 500);
      setTimeout(() => this.checkAndMount(), 1000);
      setTimeout(() => this.checkAndMount(), 2000);
      setTimeout(() => this.checkAndMount(), 3500);
    };

    window.addEventListener('yt-navigate-start', triggerBurstCheck);
    window.addEventListener('yt-navigate-finish', triggerBurstCheck);
    window.addEventListener('yt-page-data-updated', triggerBurstCheck);
    window.addEventListener('yt-player-updated' as any, triggerBurstCheck);
    window.addEventListener('spfdone', triggerBurstCheck);
    window.addEventListener('popstate', triggerBurstCheck);
    document.addEventListener('fullscreenchange', triggerBurstCheck);
    document.addEventListener('webkitfullscreenchange', triggerBurstCheck);
    document.addEventListener('visibilitychange', () => {
      if (document.visibilityState === 'visible') {
        triggerBurstCheck();
      }
    });
    window.addEventListener('resize', triggerBurstCheck);
  }

  public destroy() {
    if (this.checkTimer) clearInterval(this.checkTimer);
    if (this.observer) this.observer.disconnect();
    if (this.buttonEl) {
      try {
        this.buttonEl.remove();
      } catch (e) {}
      this.buttonEl = null;
    }
  }
}
