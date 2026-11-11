/**
 * 字幕浮层样式表（从 overlay.ts 外置，降低单文件复杂度）
 * 注意：仅存放 CSS，不含任何运行时逻辑。
 *
 * ⚠️ VSR 兼容红线：本文件禁止使用 backdrop-filter / -webkit-backdrop-filter。
 * 页面中任意元素带 backdrop-filter 都会强制 Chromium 将视频与页面内容合成，
 * 导致 NVIDIA RTX Video Super Resolution 无法走视频叠加层而失效（窗口化必现）。
 * 如需“毛玻璃”观感，请用高不透明度 rgba 背景 + 边框/阴影模拟。
 */
export const OVERLAY_STYLES = String.raw`
:host {
          all: initial;
          font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, 'Helvetica Neue', Arial, sans-serif;
          user-select: text;
          --ease-elastic: cubic-bezier(0.34, 0.96, 0.6, 0.99);
          /* 浮层短过渡时长令牌（v0.5.2）：新增规则用它，不散落硬编码时长 */
          --dur-fast: 0.2s;
          /* 快捷面板定位令牌（v0.5.5）。四条各自只管一件事，别再让它们互相换算：
             --qp-bottom-gap：面板底边到播放器底边的距离 = 贴住控制栏上沿。全屏 / 非全屏 /
                              剧场三种状态下这个数是同一个（面板随宿主一起缩放，不按屏幕高算），
                              这正是「全屏前后布局对齐」的来源。
             --qp-top-gap   ：顶部保留区，**只**参与 max-height。它不是定位值，别拿它定 top。
             --qp-height    ：面板高度。auto = 按内容自适应；JS 会按设置写具体 px（0 = 自适应）。
             --qp-max-h     ：高度上限，口径同 v0.5.1 发版值 calc(100% - 68px)，
                              所以面板顶边最靠上也就是距播放器顶边 10px（= 68 - 58）。 */
          --qp-bottom-gap: 58px;
          --qp-top-gap: 68px;
          --qp-height: auto;
          --qp-max-h: max(160px, calc(100% - var(--qp-top-gap)));
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

        /* 透明背景（bgColor = #00000000）：摘掉卡片的柔和外扩阴影与描边。
         * 那条 box-shadow（0 16px 38px rgba(0,0,0,.55)）是给半透明底色「收边」用的，
         * 底色透明后它只剩一圈悬空的黑色雾影 —— 即用户要去的「字幕模糊」。
         * 文字自身的 text-shadow 保留（亮画面上的可读性靠它）。
         * 只用 box-shadow / border，不动 filter，避免把视频拉进合成层影响 VSR。 */
        .subtitle-box.bg-transparent {
          box-shadow: none;
          border-color: transparent;
        }

        /* 透明背景下的可读性兜底：没有底色压暗，字完全靠自身阴影从画面里「浮」出来。
         * 三层叠加 = 近距描边（0 1px 2px，压住笔画边缘）+ 中距扩散（0 0 4px，分离背景）
         * + 远距柔散（0 2px 10px，制造纵深）。深色/亮色/花色背景都能压住。
         * 依旧只用 text-shadow —— filter / drop-shadow 会把视频拉进合成层，影响 N 卡 VSR。 */
        .subtitle-box.bg-transparent .original-text {
          text-shadow:
            0 1px 2px rgba(0, 0, 0, 0.95),
            0 0 4px rgba(0, 0, 0, 0.9),
            0 2px 10px rgba(0, 0, 0, 0.75);
        }

        .subtitle-box.bg-transparent .translated-text {
          text-shadow:
            0 1px 2px rgba(0, 0, 0, 0.95),
            0 0 4px rgba(0, 0, 0, 0.92),
            0 2px 10px rgba(0, 0, 0, 0.8);
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

        /* ==========================================================================
           歌词轨卡拉OK逐字点亮（v0.5.0）
           --------------------------------------------------------------------------
           只允许三样东西：color / opacity / text-shadow。
           • 三态语义：**未到 = 半透明白，已到 = 用户选的原文字色，当前 = 同色 + 发光**；
             具体颜色由浮层按用户配色注入这三个变量，这里只给兜底默认值；
           • **「未到」的柔和靠颜色 alpha，不靠 opacity**：opacity 会把同一 span 上的
             text-shadow（当前字的光晕）一起压淡，且与 k-done 的过渡不好控；
             alpha 只影响字形本身，语义更精确，也不碰任何合成层开关。
           • 官方笔色走 span 的内联 color（优先级高于下面三条 class 规则），
             所以 k-done / k-cur 无须再为「有笔色」另写覆盖规则；
           • k-pend 带 !important 是必要的：内联色会让整行一上来就全亮，
             必须让「未到」态压回半透明白，进度推进后才由内联笔色接管；
           • 颜色切换靠 class + CSS 变量，渲染层每帧只切「边界那两个 span」的 class；
           • 过渡只作用于 color / opacity，都是合成层属性；
           • 「当前字」的发光用 text-shadow（绘制效果，不会把视频拉进合成层），
             本文件仍然不得出现任何滤镜类声明 —— VSR 红线要求其声明数恒为 0。
           ========================================================================== */
        .k-char {
          white-space: pre-wrap;
          transition: color 120ms linear, opacity 120ms linear;
        }

        .k-char.k-pend {
          /* 未到：半透明白（alpha 0.5）。亮度只压字形、不压光晕；
             对比度依据见 overlay.ts 的 KARAOKE_PEND_COLOR 注释里的实测数字。 */
          color: var(--k-pend, rgba(255, 255, 255, 0.5)) !important;
        }

        .k-char.k-done {
          /* 已到：用户选的原文字色（有笔色时被内联色接管） */
          color: var(--k-done, #e2e8f0);
        }

        .k-char.k-cur {
          /* 当前字：同「已到」色 + 光晕（有笔色时 currentColor 自动取官方色） */
          color: var(--k-cur, #e2e8f0);
          text-shadow: 0 0 10px currentColor, 0 2px 5px rgba(0, 0, 0, 0.9);
        }

        /* ==========================================================================
           逐词高亮（仅 ASR 词级时间戳的句子会加 .k-word）
           --------------------------------------------------------------------------
           适用范围：**只有**「自动字幕（ASR）+ 官方词级时间戳」的句子才会带
           .k-word（判定在 overlay.ts：sentence.wordLevel === true）。手动上传字幕、
           逐字（character-level）字幕、歌词轨、不支持逐词的 ASR 句**都不带**，
           它们继续走上面三条既有规则 —— 本组规则不改动既有三条的语义。

           • **按词推进**：同一个词的字符共享同一个 startMs ⇒ 整词在同一帧一起
             变 k-done（见 overlay.ts 的 indexAtTimings 二分取「最后一个
             startMs<=now」的下标 = 该词的最后一个字符）。
           • **未播放到的词 = 灰色半透明**：用 rgba(255,255,255,0.35) 实现，
             **不用 opacity** —— opacity 会把**整行**（含已播放的词）一起压暗，
             违反「已播放的词保持正常高亮」这条要求。
           • **已播放 / 当前词 = --k-word-hi**：用户可配的 wordHighlightColor
             （原文侧；默认**跟随**用户的原文色 settings.origColor），由浮层注入。
           • **官方笔色优先**：带官方笔色（内联 color）的 span **不加** .k-word
             （见 overlay.ts 建 span 的那一处），所以这里的 !important 压不到
             官方笔色上 —— 内联笔色永远赢。
           • k-cur 的光晕用 currentColor ⇒ 自动跟随 --k-word-hi 的颜色。
           • **译文侧另有一条**（.k-word-t → --k-word-hi-trans，默认**跟随**译文色
             settings.transColor）—— 见下面「逐词高亮 · 译文侧」那一组。
           ========================================================================== */
        .k-char.k-word.k-pend {
          /* 未播放到的词：灰色 + 半透明（半透明靠 alpha，不靠 opacity） */
          color: var(--k-word-pend, rgba(255, 255, 255, 0.35)) !important;
        }

        .k-char.k-word.k-done {
          /* 已播放的词：用户选的逐词高亮色（原文侧） */
          color: var(--k-word-hi, #ffffff);
        }

        .k-char.k-word.k-cur {
          /* 当前词：同「已播放」色 + 光晕（光晕跟随 --k-word-hi） */
          color: var(--k-word-hi, #ffffff);
          text-shadow: 0 0 10px currentColor, 0 2px 5px rgba(0, 0, 0, 0.9);
        }

        /* ==========================================================================
           逐词高亮 · **译文侧**（v0.5.0 双路）
           --------------------------------------------------------------------------
           译文侧的 span 额外挂 .k-word-t（见 overlay.ts 的 buildKaraokeClass），
           于是已播放 / 当前词用**另一条**颜色：--k-word-hi-trans
           （默认跟随用户的译文色 settings.transColor），与原文侧的 --k-word-hi
           （默认跟随 settings.origColor）**各设各的**。

           • 两条规则的特异度相同（三个 class）⇒ **必须排在上面三条之后**，
             靠源码顺序取胜（.k-word-t 的 span 同时带 .k-word）。
           • **未播放词的灰色半透明两路一致**（--k-word-pend，同一条 !important
             规则），所以这里不需要、也不应该再写一条 .k-word-t.k-pend。
           • k-cur 的光晕仍用 currentColor ⇒ 自动跟随译文侧高亮色。
           ========================================================================== */
        .k-char.k-word-t.k-done {
          /* 已播放的词：译文侧的逐词高亮色 */
          color: var(--k-word-hi-trans, #ffffff);
        }

        .k-char.k-word-t.k-cur {
          /* 当前词：同「已播放」色 + 光晕（光晕跟随 --k-word-hi-trans） */
          color: var(--k-word-hi-trans, #ffffff);
          text-shadow: 0 0 10px currentColor, 0 2px 5px rgba(0, 0, 0, 0.9);
        }

        /* 译文缺失/失败：占位保高，避免上下布局跳动；容器内不含任何字符（含零宽） */
        .k-placeholder {
          display: block;
          min-height: 1.35em;
        }

        /* 译文远短于原文：整句淡入（时长由内联 animation-duration 给出，句末留 200ms 停留） */
        .k-whole {
          display: inline-block;
          opacity: 0;
          animation-name: k-fade-in;
          animation-duration: 520ms;
          animation-timing-function: linear;
          animation-fill-mode: forwards;
        }

        @keyframes k-fade-in {
          from {
            opacity: 0;
          }
          to {
            opacity: 1;
          }
        }

        /* 无障碍：用户要求减少动态效果时，颜色跳变与淡入一律归零 */
        @media (prefers-reduced-motion: reduce) {
          .k-char {
            transition: none;
          }
          .k-whole {
            animation: none;
            opacity: 1;
          }
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
          /* v0.5.5：恢复 bottom 贴底定位。
             曾经写成「top: 68px 钉死顶边、向下生长」，那是相对**宿主容器**的固定距离：
             全屏时宿主变成整屏，68px 就跑到画面上方，面板整体上移 + 下方大片空白；
             非全屏时又不贴底（1700×1080 窗口、播放器高 662 时下方悬空 175px）。现在顶边让给内容，
             底边钉在控制栏上沿 58px 处 —— 全屏 / 非全屏 / 剧场三种状态的下边距完全一致。
             「展开时触发元素不动」不再靠钉顶边，而是靠高度固定（见 --qp-height）：
             高度不变 ⇒ 底边不动 ⇒ 顶边自然不动。 */
          top: auto;
          bottom: var(--qp-bottom-gap);
          right: 18px;
          width: 320px;
          /* 高度是「确定值」：要么 auto（按内容自适应），要么由 JS 按设置写 px。
             不再每帧量内容高再回写 —— 那条路一旦量少 1px，视图就滚、底部按钮就被切。 */
          height: var(--qp-height);
          max-height: var(--qp-max-h);
          box-sizing: border-box;
          background: rgba(18, 18, 22, 0.9);
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
          /* height 不进过渡：高度是配置值，不该自己「动画」到目标值 */
          transition: opacity 0.25s cubic-bezier(0.16, 1, 0.3, 1), transform 0.35s var(--ease-elastic), visibility 0.25s;
          z-index: 120;
          /* 圆角裁切靠它；滚动条在 .qp-view 内部，面板本身不滚 */
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

        /* v0.5.5：视图是 column flex，子项默认 flex-shrink:1 —— 内容一超出面板高度，
           子项会被**压扁**而不是让视图滚动：实测展开一个手风琴后状态行 30→28px、
           两条分隔线 1→0px，于是被点的那一行 header 反而上移了 2px（用户看到的
           「选项往上跳」的最后一截就是这么来的）。这里一律禁止压缩，
           超出就老老实实交给 overflow-y:auto 滚。 */
        .qp-view > * {
          flex-shrink: 0;
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

        /* v0.5.3：目标语言下拉（.qp-select）与翻译场景卡片（.qp-scene-*）随
           「删除两个折叠块」一并移除 —— 面板里只留一行只读指示，
           改这两项请去扩展弹窗（那边有自己的控件与样式，不走本文件）。 */

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

        /* ==========================================================================
           无障碍：用户要求减少动态效果时，快捷面板的「横滑 + 手风琴展开」
           一律降级为瞬时切换（放在文件末尾，才能盖住前面同特异性的 transition 声明）。
           面板高度 v0.5.5 起是配置值、本来就没有过渡，不在此列。
           ========================================================================== */
        @media (prefers-reduced-motion: reduce) {
          .quick-panel,
          .qp-views-slider,
          .qp-accordion-body,
          .qp-accordion-arrow {
            transition: none;
          }
        }
`;
