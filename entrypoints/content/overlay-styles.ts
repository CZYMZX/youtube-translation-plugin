/**
 * 字幕浮层样式表（从 overlay.ts 外置，降低单文件复杂度）
 * 注意：仅存放 CSS，不含任何运行时逻辑。
 */
export const OVERLAY_STYLES = String.raw`
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
`;
