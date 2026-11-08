/**
 * ============================================================================
 * YouTube 智能字幕断句翻译器 - 矢量图标库 (IconPark Monochromatic Suite)
 * 当前版本: v0.4.3 (独立高级设置页)
 *
 * 【跨会话设计统一规范】：
 * 1. 严格使用 ByteDance IconPark 官方高保真矢量线性单色图标；
 * 2. 统一属性：viewBox="0 0 48 48", fill="none", stroke="currentColor",
 *    stroke-width="4", stroke-linecap="round", stroke-linejoin="round"；
 * 3. 严禁在代码中直接插入系统原生彩色 Emoji（例如 ⏱️、⚙️、💡、📑 等），
 *    所有状态、按钮与功能点一律使用本模块导出的矢量 SVG，保持纯黑白毛玻璃视觉质感。
 * ============================================================================
 */

// 1. AI 闪烁星光 (Sparkles / Magic)
export const ICON_SPARKLES = `
<svg viewBox="0 0 48 48" fill="none" stroke="currentColor" stroke-width="4" stroke-linecap="round" stroke-linejoin="round">
  <path d="M20.1 8.1L24.34 12.34M30 4V10M39.9 8.1L35.66 12.34M44 18H38M39.9 27.9L35.66 23.66M30 32V26M20.1 27.9L24.34 23.66M16 18H22"/>
  <path d="M29.59 18.41L5.54 42.46"/>
</svg>
`;

// 2. 翻译 / 语言对译 (Translate - 官方标准中英对译)
export const ICON_TRANSLATE = `
<svg viewBox="0 0 48 48" fill="none" stroke="currentColor" stroke-width="4" stroke-linecap="round" stroke-linejoin="round">
  <path d="M28.29 37H39.71M42 42L39.71 37M26 42L28.29 37M28.29 37L34 24L39.71 37H28.29Z"/>
  <path d="M16 6L17 9"/>
  <path d="M6 11H28"/>
  <path d="M10 16C10 16 11.79 22.26 16.26 25.74C20.74 29.22 28 32 28 32"/>
  <path d="M24 11C24 11 22.21 19.22 17.74 23.78C13.26 28.35 6 32 6 32"/>
</svg>
`;

// 3. 时间轴 / 历史时钟 (Time)
export const ICON_TIME = `
<svg viewBox="0 0 48 48" fill="none" stroke="currentColor" stroke-width="4" stroke-linecap="round" stroke-linejoin="round">
  <circle cx="24" cy="24" r="18"/>
  <path d="M24 14V24L32 28"/>
</svg>
`;

// 4. 机械设置花瓣齿轮 (SettingTwo)
export const ICON_SETTING = `
<svg viewBox="0 0 48 48" fill="none" stroke="currentColor" stroke-width="4" stroke-linejoin="round">
  <path d="M18.28 43.17C14.93 42.17 11.95 40.32 9.59 37.87C10.47 36.82 11 35.47 11 34C11 30.69 8.31 28 5 28C4.8 28 4.6 28.01 4.41 28.03C4.14 26.73 4 25.38 4 24C4 21.91 4.32 19.89 4.92 18C4.94 18 4.97 18 5 18C8.31 18 11 15.31 11 12C11 11.05 10.78 10.15 10.38 9.35C12.7 7.2 15.52 5.59 18.65 4.72C19.64 6.67 21.67 8 24 8C26.33 8 28.36 6.67 29.35 4.72C32.48 5.59 35.3 7.2 37.62 9.35C37.22 10.15 37 11.05 37 12C37 15.31 39.69 18 43 18C43.03 18 43.06 18 43.08 18C43.68 19.89 44 21.91 44 24C44 25.38 43.86 26.73 43.59 28.03C43.4 28.01 43.2 28 43 28C39.69 28 37 30.69 37 34C37 35.47 37.53 36.82 38.41 37.87C36.05 40.32 33.07 42.17 29.72 43.17C28.94 40.75 26.68 39 24 39C21.32 39 19.06 40.75 18.28 43.17Z"/>
  <circle cx="24" cy="24" r="7"/>
</svg>
`;

// 5. 排版模式 (AlignTextBoth)
export const ICON_ALIGN = `
<svg viewBox="0 0 48 48" fill="none" stroke="currentColor" stroke-width="4" stroke-linecap="round" stroke-linejoin="round">
  <path d="M42 19H6"/>
  <path d="M42 9H6"/>
  <path d="M42 29H6"/>
  <path d="M42 39H6"/>
</svg>
`;

// 6. 场景 / 剧场 (Theater)
export const ICON_THEATER = `
<svg viewBox="0 0 48 48" fill="none" stroke="currentColor" stroke-width="4" stroke-linecap="round" stroke-linejoin="round">
  <path fill-rule="evenodd" clip-rule="evenodd" d="M8 6H40C41.1 6 42 6.9 42 8V36L32 22C29.33 23.59 26.67 24.38 24 24.38C21.33 24.38 18.67 23.59 16 22L6 36V8C6 6.9 6.9 6 8 6Z"/>
  <path d="M6 42H42"/>
</svg>
`;

// 7. 推理思考 / 大脑 (Brain)
export const ICON_BRAIN = `
<svg viewBox="0 0 48 48" fill="none" stroke="currentColor" stroke-width="4" stroke-linecap="round" stroke-linejoin="round">
  <path d="M14 19C9.5 19 6 22.5 6 27C6 31 9 34.3 13 34.9C13.5 38.9 17 42 21 42C23 42 24.5 41 26 39.5"/>
  <path d="M34 19C38.5 19 42 22.5 42 27C42 31 39 34.3 35 34.9C34.5 38.9 31 42 27 42C25 42 23.5 41 22 39.5"/>
  <path d="M14 19C14 13.5 18.5 9 24 9C29.5 9 34 13.5 34 19"/>
  <path d="M24 9V42"/>
</svg>
`;

// 8. 返回箭头 (Left)
export const ICON_LEFT = `
<svg viewBox="0 0 48 48" fill="none" stroke="currentColor" stroke-width="4" stroke-linecap="round" stroke-linejoin="round">
  <path d="M31 36L19 24L31 12"/>
</svg>
`;

// 9. 前进箭头 (Right)
export const ICON_RIGHT = `
<svg viewBox="0 0 48 48" fill="none" stroke="currentColor" stroke-width="4" stroke-linecap="round" stroke-linejoin="round">
  <path d="M17 12L29 24L17 36"/>
</svg>
`;

// 10. 关闭 (Close)
export const ICON_CLOSE = `
<svg viewBox="0 0 48 48" fill="none" stroke="currentColor" stroke-width="4" stroke-linecap="round" stroke-linejoin="round">
  <path d="M14 14L34 34"/>
  <path d="M14 34L34 14"/>
</svg>
`;

// 11. 提示说明 (Info)
export const ICON_INFO = `
<svg viewBox="0 0 48 48" fill="none" stroke="currentColor" stroke-width="4" stroke-linecap="round" stroke-linejoin="round">
  <circle cx="24" cy="24" r="18"/>
  <path d="M24 22V34"/>
  <circle cx="24" cy="15" r="2" fill="currentColor"/>
</svg>
`;

// 12. 本地存储安全锁 (Lock)
export const ICON_LOCK = `
<svg viewBox="0 0 48 48" fill="none" stroke="currentColor" stroke-width="4" stroke-linecap="round" stroke-linejoin="round">
  <rect x="10" y="20" width="28" height="22" rx="4"/>
  <path d="M16 20V14C16 9.6 19.6 6 24 6C28.4 6 32 9.6 32 14V20"/>
  <circle cx="24" cy="30" r="2.5" fill="currentColor"/>
</svg>
`;

// 13. 下载字幕 (DownloadOne)
export const ICON_DOWNLOAD = `
<svg viewBox="0 0 48 48" fill="none" stroke="currentColor" stroke-width="4" stroke-linecap="round" stroke-linejoin="round">
  <path d="M6 24.0083V42H42V24"/>
  <path d="M24 6V33.5"/>
  <path d="M33 24.5L24 33.5L15 24.5"/>
</svg>
`;

// 14. 复制文本 (Copy)
export const ICON_COPY = `
<svg viewBox="0 0 48 48" fill="none" stroke="currentColor" stroke-width="4" stroke-linecap="round" stroke-linejoin="round">
  <rect x="14" y="14" width="26" height="26" rx="4"/>
  <path d="M34 14V8C34 6.9 33.1 6 32 6H10C8.9 6 8 6.9 8 8V30C8 31.1 8.9 32 10 32H14"/>
</svg>
`;

// 15. 刷新 / 重译 (Refresh)
export const ICON_REFRESH = `
<svg viewBox="0 0 48 48" fill="none" stroke="currentColor" stroke-width="4" stroke-linecap="round" stroke-linejoin="round">
  <path d="M42 24C42 33.94 33.94 42 24 42C16.8 42 10.6 37.8 7.8 31.7"/>
  <path d="M6 24C6 14.06 14.06 6 24 6C31.2 6 37.4 10.2 40.2 16.3"/>
  <path d="M42 8V18H32"/>
  <path d="M6 40V30H16"/>
</svg>
`;

// 16. 剧本全文 (FileText)
export const ICON_FILE_TEXT = `
<svg viewBox="0 0 48 48" fill="none" stroke="currentColor" stroke-width="4" stroke-linecap="round" stroke-linejoin="round">
  <path d="M10 6C10 4.9 10.9 4 12 4H30L40 14V42C40 43.1 39.1 44 38 44H12C10.9 44 10 43.1 10 42V6Z"/>
  <path d="M30 4V14H40"/>
  <path d="M18 22H30"/>
  <path d="M18 30H30"/>
</svg>
`;

// 17. 眼睛 / 显示字幕 (PreviewOpen)
export const ICON_PREVIEW_OPEN = `
<svg viewBox="0 0 48 48" fill="none" stroke="currentColor" stroke-width="4" stroke-linejoin="round">
  <path d="M24 36C35.05 36 44 24 44 24C44 24 35.05 12 24 12C12.95 12 4 24 4 24C4 24 12.95 36 24 36Z"/>
  <circle cx="24" cy="24" r="6"/>
</svg>
`;

// 18. 眼睛 / 隐藏字幕 (PreviewClose)
export const ICON_PREVIEW_CLOSE = `
<svg viewBox="0 0 48 48" fill="none" stroke="currentColor" stroke-width="4" stroke-linecap="round" stroke-linejoin="round">
  <path d="M6 16C6.63 17.22 7.6 18.35 8.82 19.36C12.26 22.17 17.78 24 24 24C30.22 24 35.74 22.17 39.18 19.36C40.4 18.35 41.37 17.22 42 16"/>
  <path d="M28.98 24L31.05 31.73"/>
  <path d="M37.35 21.35L43.01 27.01"/>
  <path d="M5 27.01L10.66 21.35"/>
  <path d="M16.93 31.73L19 24"/>
</svg>
`;

// 19. 调色盘 / 样式外观 (Palette)
export const ICON_PALETTE = `
<svg viewBox="0 0 48 48" fill="none" stroke="currentColor" stroke-width="4" stroke-linecap="round" stroke-linejoin="round">
  <path d="M24 6C14 6 6 14 6 24C6 34 13.5 42 23 42C24.7 42 26 40.7 26 39C26 38.2 25.7 37.5 25.1 37C24.6 36.4 24.3 35.7 24.3 35C24.3 33.3 25.7 32 27.3 32H31C37.1 32 42 27.1 42 21C42 12.7 33.9 6 24 6Z"/>
  <circle cx="15" cy="18" r="2" fill="currentColor"/>
  <circle cx="24" cy="14" r="2" fill="currentColor"/>
  <circle cx="33" cy="18" r="2" fill="currentColor"/>
  <circle cx="17" cy="27" r="2" fill="currentColor"/>
</svg>
`;

// 20. 拖拽调节 (Move / Drag)
export const ICON_DRAG = `
<svg viewBox="0 0 48 48" fill="none" stroke="currentColor" stroke-width="4" stroke-linecap="round" stroke-linejoin="round">
  <path d="M24 6V42"/>
  <path d="M6 24H42"/>
  <path d="M19 11L24 6L29 11"/>
  <path d="M19 37L24 42L29 37"/>
  <path d="M11 19L6 24L11 29"/>
  <path d="M37 19L42 24L37 29"/>
</svg>
`;

// 21. 秒表 / 倒计时定位 (Stopwatch - ByteDance IconPark)
export const ICON_STOPWATCH = `
<svg viewBox="0 0 48 48" fill="none" stroke="currentColor" stroke-width="4" stroke-linecap="round" stroke-linejoin="round">
  <path d="M24 8V4"/>
  <path d="M19 4H29"/>
  <circle cx="24" cy="26" r="18"/>
  <path d="M24 18V26L30 30"/>
  <path d="M36 14L39 11"/>
</svg>
`;

// 22. 沙漏 / 检测中计时 (Hourglass - 极简纯外轮廓，无沙砾)
export const ICON_HOURGLASS = `
<svg viewBox="0 0 48 48" fill="none" stroke="currentColor" stroke-width="4" stroke-linecap="round" stroke-linejoin="round">
  <path d="M8 4H40"/>
  <path d="M8 44H40"/>
  <path d="M12 4V16L21 26"/>
  <path d="M36 44V29.5L27 21"/>
  <path d="M12 44V30L18.5 23.5"/>
  <path d="M36 4V16L29.5 23.5"/>
</svg>
`;

// 23. 成功 / 已就绪对勾 (Check - ByteDance IconPark)
export const ICON_CHECK = `
<svg viewBox="0 0 48 48" fill="none" stroke="currentColor" stroke-width="4" stroke-linecap="round" stroke-linejoin="round">
  <path d="M10 24L20 34L38 16"/>
</svg>
`;

// 24. 警告 / 注意提示 (Attention - ByteDance IconPark)
export const ICON_ALERT = `
<svg viewBox="0 0 48 48" fill="none" stroke="currentColor" stroke-width="4" stroke-linecap="round" stroke-linejoin="round">
  <path d="M24 5L42 39H6L24 5Z"/>
  <path d="M24 18V26"/>
  <path d="M24 32V34"/>
</svg>
`;

// 25. AI 深度翻译双三角交叉六角星标识 (Hexagram / Double Triangle)
export const ICON_AI_HEXASTAR = `
<svg viewBox="0 0 48 48" fill="none" stroke="currentColor" stroke-width="4" stroke-linecap="round" stroke-linejoin="round">
  <path d="M24.0002 4L41.3207 34H6.67969L24.0002 4Z"/>
  <path d="M24.0002 44L41.3207 14H6.67969L24.0002 44Z"/>
</svg>
`;

