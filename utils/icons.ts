/**
 * ============================================================================
 * YouTube 智能字幕断句翻译器 - 矢量图标库 (IconPark Monochromatic Suite)
 * 当前版本: v0.5.1 (独立高级设置页)
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

// 26. 品牌标识 —— 双气泡「无限符号」（新扩展图标矢量版，512 画布）
//     资产来源：dual-browser-extension-icon/icons/icon.svg，path 原样引用，未做缩放或重绘；
//     viewBox **收紧到墨迹包围盒**（43 128 426 256，原 512 画布墨迹只占 80.1%×46.9% 宽/高，
//     留白会让图标在 16px / 24px 容器里显得偏小）；收紧后墨迹占 96.2%×93.8%，视觉放大约 20%。
//     几何中心仍在 50%/50%，不会偏心。
//     颜色一律走 currentColor —— 深色页面下由容器 color 给白，将来加浅色主题自动变黑，
//     因此不需要「白版 / 黑版」两个常量。尺寸见各处容器的 width/height 注释。
// 品牌标识的 path 数据（512 画布坐标系）—— ICON_BRAND 与控制栏按钮共用，避免各存一份 4.7KB
export const BRAND_PATH_D = `M 89.05 375.30 C 101.05 369.20, 111.74 359.04, 125.05 357.00 C 136.84 355.20, 148.46 361.95, 160.36 362.92 C 164.80 363.28, 169.30 363.37, 173.73 362.88 C 183.73 361.78, 193.61 359.45, 203.21 356.43 C 206.75 355.31, 210.19 353.84, 213.49 352.14 C 217.80 349.91, 223.65 348.77, 225.84 344.44 C 226.57 343.01, 225.83 341.21, 225.49 339.65 C 223.91 332.49, 221.78 325.20, 217.75 319.08 C 215.54 315.71, 212.40 312.92, 209.04 310.69 C 204.37 307.59, 199.16 304.73, 193.61 304.07 C 184.98 303.04, 176.57 309.02, 167.90 308.45 C 161.81 308.04, 156.02 305.42, 150.41 303.03 C 146.81 301.48, 143.30 299.62, 140.13 297.31 C 137.36 295.28, 134.81 292.91, 132.62 290.27 C 127.98 284.65, 123.50 278.60, 120.95 271.77 C 118.84 266.14, 118.51 259.95, 118.23 253.94 C 118.04 249.94, 118.34 245.91, 118.91 241.94 C 119.29 239.27, 119.80 236.59, 120.73 234.06 C 122.07 230.43, 123.98 227.02, 126.08 223.78 C 128.38 220.23, 130.96 216.82, 133.96 213.85 C 136.84 211.01, 140.16 208.62, 143.56 206.43 C 147.25 204.04, 151.02 201.57, 155.21 200.24 C 158.95 199.05, 162.95 198.79, 166.87 198.75 C 173.77 198.69, 180.87 198.91, 187.44 201.00 C 193.91 203.06, 199.86 206.78, 205.26 210.90 C 210.17 214.64, 214.47 219.21, 218.20 224.12 C 222.51 229.80, 226.37 235.97, 228.90 242.63 C 232.68 252.55, 232.20 263.68, 235.33 273.83 C 238.14 282.94, 241.97 291.76, 246.37 300.22 C 249.86 306.93, 253.73 313.52, 258.48 319.41 C 265.19 327.73, 272.76 335.55, 281.37 341.89 C 289.93 348.19, 299.54 353.20, 309.48 356.99 C 317.82 360.17, 326.67 362.11, 335.53 363.22 C 344.04 364.29, 352.71 364.42, 361.24 363.61 C 371.47 362.63, 381.16 356.79, 391.41 357.35 C 393.33 357.45, 395.14 358.33, 396.89 359.13 C 406.47 363.47, 414.95 369.91, 423.98 375.30 L 423.98 375.30 C 424.99 374.82, 426.26 374.70, 427.02 373.88 C 427.69 373.18, 427.97 372.14, 428.08 371.18 C 429.37 360.78, 423.86 350.47, 424.01 339.99 C 424.03 338.60, 424.13 337.15, 424.67 335.87 C 429.62 324.28, 441.32 316.70, 447.48 305.71 C 452.52 296.71, 456.44 286.95, 458.80 276.91 C 460.72 268.76, 460.97 260.26, 461.00 251.89 C 461.04 241.00, 460.84 229.92, 458.36 219.32 C 456.04 209.38, 452.06 199.75, 447.04 190.87 C 442.46 182.74, 436.55 175.33, 430.11 168.58 C 426.01 164.28, 421.30 160.56, 416.43 157.15 C 410.05 152.67, 403.26 148.71, 396.21 145.38 C 392.46 143.61, 388.58 142.04, 384.55 141.06 C 373.14 138.27, 361.33 136.65, 349.59 136.70 C 341.52 136.74, 333.45 138.10, 325.59 139.93 C 319.84 141.26, 314.07 142.90, 308.79 145.54 C 298.98 150.43, 290.27 157.36, 281.71 164.21 C 278.32 166.92, 274.68 169.52, 272.15 173.04 C 271.49 173.96, 270.80 175.00, 270.77 176.13 C 270.48 185.40, 275.91 194.17, 280.59 202.18 C 282.23 204.98, 284.39 207.53, 286.85 209.64 C 289.39 211.82, 292.24 213.83, 295.42 214.85 C 300.01 216.32, 305.14 217.03, 309.82 215.93 C 319.66 213.61, 326.25 203.50, 335.87 200.40 C 341.99 198.44, 348.65 198.56, 355.07 198.76 C 359.23 198.90, 363.51 199.19, 367.41 200.63 C 374.47 203.22, 381.19 207.27, 386.60 212.50 C 392.02 217.74, 396.19 224.39, 399.15 231.32 C 400.86 235.30, 401.40 239.71, 402.00 244.00 C 402.56 247.97, 403.02 252.01, 402.69 256.00 C 402.21 261.72, 400.96 267.45, 398.85 272.80 C 397.16 277.10, 394.64 281.08, 391.88 284.80 C 388.35 289.54, 384.50 294.21, 379.75 297.73 C 376.48 300.17, 372.58 301.67, 368.78 303.17 C 363.57 305.24, 358.23 307.30, 352.67 308.07 C 349.73 308.48, 346.68 308.41, 343.76 307.89 C 337.93 306.85, 332.36 304.53, 326.96 302.09 C 323.85 300.68, 320.80 299.04, 318.05 297.00 C 313.03 293.27, 308.40 288.92, 304.41 284.11 C 298.86 277.42, 293.90 270.09, 290.32 262.17 C 284.05 248.31, 283.56 232.37, 277.80 218.29 C 273.62 208.05, 268.22 198.25, 261.94 189.15 C 256.23 180.87, 249.52 173.25, 242.29 166.26 C 238.71 162.80, 234.73 159.76, 230.63 156.94 C 224.74 152.88, 218.59 149.12, 212.12 146.06 C 207.39 143.81, 202.48 141.80, 197.38 140.61 C 190.55 139.03, 183.47 138.82, 176.47 138.45 C 170.88 138.16, 165.26 138.12, 159.67 138.43 C 153.24 138.78, 146.76 139.18, 140.47 140.55 C 135.06 141.73, 129.81 143.62, 124.70 145.76 C 120.68 147.45, 116.80 149.52, 113.05 151.75 C 104.84 156.64, 96.78 161.87, 89.39 167.94 C 84.99 171.55, 80.89 175.56, 77.19 179.90 C 72.56 185.33, 68.32 191.16, 64.82 197.38 C 60.67 204.76, 57.03 212.54, 54.73 220.69 C 52.32 229.24, 51.18 238.20, 51.00 247.09 C 50.79 257.77, 51.67 268.60, 54.23 278.97 C 56.53 288.30, 60.27 297.35, 65.01 305.71 C 68.40 311.69, 73.00 316.93, 77.47 322.15 C 81.93 327.34, 88.97 330.65, 91.74 336.90 C 92.39 338.37, 92.24 340.11, 92.06 341.70 C 91.47 347.03, 88.58 351.88, 87.48 357.13 C 86.51 361.75, 85.38 366.48, 85.73 371.18 C 85.80 372.13, 85.91 373.18, 86.50 373.91 C 87.10 374.67, 88.20 374.84, 89.05 375.30 Z`;

export const ICON_BRAND = `
<svg viewBox="43 128 426 256" xmlns="http://www.w3.org/2000/svg">
  <path fill="currentColor" fill-rule="evenodd" d="${BRAND_PATH_D}" />
</svg>
`;

/**
 * 把静态页里的 `<span data-icon="brand">` 占位符填成品牌图标。
 *
 * 为什么需要这一层：`popup/index.html` / `options/index.html` 是 WXT 直接拷贝的
 * 静态 HTML，取不到 TS 常量，所以页面里留空壳 + 本函数在脚本首帧补齐。
 * 颜色仍由容器 `color` 决定（弹窗绑定 `--text-main`，浮层绑 `#ffffff`），
 * 这样图标跟的是「页面主题」而不是「系统外观」—— 两个页面都是固定深色底，
 * 若按 `prefers-color-scheme` 切黑白图，系统浅色时会在深底上糊成黑块。
 *
 * 幂等：已有 svg 就跳过，避免重复注入；调用点见 popup/main.ts、options/main.ts。
 */
export function mountBrandIcons(root: ParentNode = document): void {
  root.querySelectorAll<HTMLElement>('[data-icon="brand"]').forEach((el) => {
    if (!el.querySelector('svg')) el.innerHTML = ICON_BRAND;
  });
}
