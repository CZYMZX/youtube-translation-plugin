/**
 * ============================================================================
 * 不可见字符清洗 —— 歌词轨 / 逐词字幕的前置处理器（纯逻辑，无 IO）
 * ----------------------------------------------------------------------------
 * 为什么单独一个文件：YouTube 的歌词轨（music track）每个 event 的 segs 里塞了
 * 大量零宽字符，实测（v0.4.3 样本 `Mfcj1AdnzhQ` 的 asr 轨，1238 event / 14288 seg）：
 *
 *   - 零宽空格 U+200B 恒定在 7–13 个/event，**不随播放进度增长**，
 *     所以它不是「逐字进度标记」，不能拿来做字级时间；
 *   - 全轨不可见字符占比 8966 / 39208 ≈ 0.229，是「歌词轨」最强的静态指纹之一。
 *
 * 这些字符肉眼不可见，却会污染：
 *   1. 文本比较键（同一句因零宽数量不同被判成不同句）；
 *   2. 翻译请求（把 U+200B 原样送给大模型，模型会「看不见但算 token」）；
 *   3. 字数统计与断句阈值（CJK 字数上限、2 倍安全阀全部失真）。
 *
 * **职责边界**：这里只做「剥不可见字符 + 压缩空白 + 去首尾空白」。
 * 标点修补、句末逗号转句号、`，。` 伪影清理属于断句层（utils/segmenter.ts），
 * 本文件一律不碰 —— 否则两个层会互相抵消，指标无法归因。
 */

/**
 * 要剥掉的不可见字符（与任务书一致，**不要**顺手扩充）：
 *   U+200B ZERO WIDTH SPACE        —— 歌词轨主力，7–13 个/event
 *   U+200C ZERO WIDTH NON-JOINER
 *   U+200D ZERO WIDTH JOINER
 *   U+200E LEFT-TO-RIGHT MARK
 *   U+200F RIGHT-TO-LEFT MARK
 *   U+FEFF ZERO WIDTH NO-BREAK SPACE (BOM)
 *   U+2060 WORD JOINER
 *
 * 刻意**不处理**：U+00AD SOFT HYPHEN、U+2028/2029 行段分隔符、U+3164 HANGUL
 * FILLER —— 前两个不属于本任务口径，后一个在韩语字幕里可能承载语义（本版韩语
 * 不做专项，见 docs）。
 */
const INVISIBLE_PATTERN = '\\u200B-\\u200F\\uFEFF\\u2060';

/** 全局版：用于 replace。 */
const INVISIBLE_RE_G = new RegExp(`[${INVISIBLE_PATTERN}]`, 'g');

/** 判定版：用于 test（不带 g，避免 lastIndex 状态泄漏）。 */
const INVISIBLE_RE_TEST = new RegExp(`[${INVISIBLE_PATTERN}]`);

/** 连续空白（含全角空格 U+3000、NBSP U+00A0 —— 都在 \s 里）压成一个半角空格。 */
const WHITESPACE_RUN_RE = /\s+/g;

/** 单个字符是否属于「要剥掉的不可见字符」。 */
export function isInvisibleChar(ch: string): boolean {
  return ch.length > 0 && INVISIBLE_RE_TEST.test(ch);
}

/** 文本里是否含有任何不可见字符（零宽 / BOM / word joiner）。 */
export function hasInvisible(text: string): boolean {
  if (!text) return false;
  return INVISIBLE_RE_TEST.test(text);
}

/**
 * 不可见字符的数量。
 * 单独导出是因为 `detectLyricTrack` 要算「不可见字符占比」（invisibleRatio），
 * 用 `hasInvisible` 只能得到布尔、用 `stripInvisible(...).length` 差值在含空白
 * 压缩时会失真，所以必须有一个精确计数入口。
 */
export function countInvisible(text: string): number {
  if (!text) return 0;
  const m = text.match(INVISIBLE_RE_G);
  return m ? m.length : 0;
}

/**
 * 剥掉不可见字符 → 压缩连续空白为一个空格 → 去首尾空白。
 *
 * - 保留正常的英文空格与 CJK 空格（含全角空格，只是统一成半角、并且不重复）；
 * - 不做任何标点改动（不做 `，。` 清理、不补句号、不做繁简/全半角转换）。
 *
 * 例：
 *   stripInvisible('​ ​O​kay,  be there​ ​')  →  'Okay, be there'
 *   stripInvisible('\uFEFF   \u200B  ')                  →  ''
 */
export function stripInvisible(text: string): string {
  if (!text) return '';
  return text.replace(INVISIBLE_RE_G, '').replace(WHITESPACE_RUN_RE, ' ').trim();
}

/**
 * 只剥不可见字符，**不动空白**（不压缩、不 trim）。
 *
 * 存在的理由：`estimateCharTimings` 的真实偏移分支里，字符下标必须与
 * `seg.tOffsetMs` 严格对齐，一旦压缩空白下标就错位了。字符清单仍然只有这一份，
 * 避免两个文件各写一遍零宽列表后慢慢漂移。
 */
export function removeInvisible(text: string): string {
  if (!text) return '';
  return text.replace(INVISIBLE_RE_G, '');
}
