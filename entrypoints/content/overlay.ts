/**
 * ============================================================================
 * YouTube 智能字幕断句翻译器 - 播放器覆盖层与交互核心 (SubtitleOverlay)
 * 当前版本: v0.5.1 (VSR 红线约束下的浮层实现)
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
  ICON_TIME,
  ICON_SETTING,
  ICON_ALIGN,
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
  ICON_AI_HEXASTAR,
  ICON_BRAND
} from '../../utils/icons';
import type { SubtitleSentence, ExtensionSettings, KaraokeWindow } from '../../types';
/* v0.5.2：浮层「翻译场景」只读复用扩展弹窗那一套数据源（同一个 getAllScenes /
   loadCustomPacks），不另建场景表、不硬编码场景 id 与名称。 */
import { getAllScenes, loadCustomPacks, type ScenePack } from '../../utils/packs';
import { estimateCharTimings, type CharTiming } from '../../utils/lyric-track';
import { stripInvisible } from '../../utils/invisible-text';
/* v0.5.6 字幕字体：内置字体查表、自定义字体 FontFace 注册（按 id 去重）都收在 utils/fonts.ts */
import { ensureCustomFontRegistered, resolveSubtitleFont } from '../../utils/fonts';
import { OVERLAY_STYLES } from './overlay-styles';

/**
 * 目标语言显示名（v0.5.3）：浮层删掉了「目标语言」下拉，但状态指示行仍要显示
 * 当前译文语言。settings.targetLang 是 BCP-47 短码，这里映射成中文名。
 * 只服务于展示，不参与任何翻译逻辑；未命中的短码原样回显（不吞值、不猜）。
 */
const TARGET_LANG_LABELS: Record<string, string> = {
  'zh-CN': '简体中文',
  'zh-TW': '繁体中文',
  en: '英语',
  ja: '日语',
  ko: '韩语',
  fr: '法语',
  de: '德语',
  es: '西班牙语',
  ru: '俄语'
};

/**
 * 卡拉OK渲染的**三态逐字路径**（v0.5.0 渲染层，见 `buildKaraokeSpans`）：
 *
 *   1. **没有译文**（空串 / 翻译失败标记）→ 译文位 `k-placeholder` 占位、不写字符，
 *      只画原文进度。
 *   2. **未翻译、保持原样**（译文归一化后 == 原文归一化）→ 译文位显示**原文文本**，
 *      时间表**直接复用原文那份 `win.charTimings`**（同一份数组引用，不是另算一份），
 *      于是两侧走**完全同一条逐字路径**：同一时刻 `k-done` / `k-cur` 数量一致、
 *      推进节奏一致、笔色也一致。
 *   3. **已翻译** → 译文位显示译文，时间表按轨分流：ASR 轨走 token 表
 *      （CJK 每字 / 拉丁空格词，按进度百分比均匀分配），歌词轨保持原样
 *      （`KARAOKE_WHOLE_LINE_RATIO` 整句淡入分支 + 按译文自身字符均分）。
 *
 * 原文侧**始终**用它自己的 `win.charTimings`：数据层（`utils/asr-timing.ts`
 * 的 `buildAsrCharTimings`）在拿到**官方词级时间戳**时保留词级口径
 * （同一个词的字符共享同一个 `startMs`）⇒ 原文行是**逐词点亮**（整词一起亮，
 * 与 YouTube 一致）；只有帧推断 / 均分兜底那种**字级**表才逐字跳。
 * 译文被翻译过时**不会**再去套原文那份表（那会让两侧节奏打架）。
 */

/**
 * 「未到」态：**半透明白 rgba(255,255,255,0.5)**，不是纯白。
 * ---------------------------------------------------------------------------
 * 语义仍是「没到那个字就是白色，到了才变成用户选的颜色」，只是把「白色」换成
 * 带 alpha 的白：未唱部分不再是一整行刺眼的纯白，唱过才实心亮起来 —— 与译文侧
 * 已有的「未唱灰半透明」观感对齐。
 * 有官方笔色的轨用 span 内联色（优先级更高），与这个兜底互不干扰；
 * 但「未到」态由 CSS 的 `!important` 压回本值，所以笔色轨未唱部分也走半透明白。
 *
 * 为什么用**颜色 alpha** 而不是 `opacity`：opacity 作用于整个 span，会把
 * 「当前字」的 text-shadow 光晕一起压淡，且与 k-done 的过渡不好控；
 * alpha 只压字形自身，`text-shadow` 照旧生效。
 *
 * 取值 0.5 是算出来的（WCAG 相对亮度比，背景 = 字幕卡片 rgba(15,23,42,0.75)
 * 叠在视频画面上；取暗/中灰/亮三种画面）：
 *   alpha  未高亮 vs 背景          已高亮(#e2e8f0) vs 未高亮
 *   0.35   3.20 / 2.98 / 2.63      4.67 / 3.53 / 2.96   ← 逐词态现状
 *   0.50   5.32 / 4.50 / 3.75      2.80 / 2.34 / 2.07   ← 本值（两条阈值都过）
 *   0.55   6.15 / 5.10 / 4.18      2.43 / 2.07 / 1.86   ← 亮画面下已分不清
 *   0.60   7.12 / 5.78 / 4.67      2.10 / 1.82 / 1.67   ← 同上，更糊
 * 阈值：未高亮 vs 背景 ≥ 3:1（仍可读）、已高亮 vs 未高亮 ≥ 2:1（一眼分出唱到哪）。
 * 于是 0.5 是**上限**而不是下限：再亮就牺牲「唱到哪」的可辨性。
 */
const KARAOKE_PEND_COLOR = 'rgba(255, 255, 255, 0.5)';

/*
 * 歌词轨专用（v0.5.0 原样保留）：译文远短于原文时退化为「整句淡入 + 句末停留」。
 * 这套参数**只服务于歌词轨**；自动字幕（ASR）轨走 token 化逐词进度，不用它们。
 */
const KARAOKE_HOLD_TAIL_MS = 200;
const KARAOKE_FADE_MIN_MS = 120;
const KARAOKE_FADE_MAX_MS = 700;
const KARAOKE_WHOLE_LINE_RATIO = 0.4;

type KaraokeState = 'done' | 'cur' | 'pend';

/**
 * 逐字 span 的状态切换：只动 class。颜色正常由 CSS 变量决定，不逐帧写内联色；
 * 唯一的例外是**建 span 时**写入的官方笔色（静态写一次，不属于每帧写入）。
 */
function setKaraokeState(el: HTMLElement, state: KaraokeState) {
  el.classList.toggle('k-done', state === 'done');
  el.classList.toggle('k-cur', state === 'cur');
  el.classList.toggle('k-pend', state === 'pend');
}

/**
 * 逐词高亮 span 的初始 class（v0.5.0 任务·渲染层）
 * ---------------------------------------------------------------------------
 * 只有「**官方词级时间戳**」的句子（`sentence.wordLevel === true`）才带 `.k-word`：
 *   - 词级 ⇒ 同一个词的字符共享同一个 `startMs` ⇒ **整词在同一帧一起点亮**；
 *   - 未播放到的词 = 灰色半透明（`--k-word-pend`），已播放 = 用户配色（`--k-word-hi`）。
 * 手动上传字幕 / 逐字字幕 / 歌词轨 / 无词级时间戳的 ASR 句**都不带**它，
 * 继续走既有 `.k-char.k-pend / .k-done / .k-cur` 三条规则（语义一行未改）。
 *
 * ⚠️ **官方笔色优先**（这条决定了 `!important` 放在哪）：
 *   CSS 里 `.k-char.k-word.k-pend` 带 `!important`（要把未播放的词压回半透明灰）。
 *   如果给**带内联笔色**（官方 `t.color`）的 span 也加 `.k-word`，这条 `!important`
 *   会**直接盖掉官方笔色**（`!important` 的样式表声明压过内联非 important 声明）。
 *   所以规则是：**有笔色就不加 `.k-word`** —— 该 span 走既有 k-pend / k-done / k-cur
 *   语义，内联笔色优先级高于 class 规则，官方颜色永远赢。
 *   （实测：ASR 轨的 pens 为空、歌词轨才带笔色，而歌词轨根本不是词级 —— 这条
 *   互斥是"结构上不可能撞车"，这里再加一道保险防止将来数据层变化。）
 *
 * ── 原文侧 / 译文侧分开（v0.5.0 双路）────────────────────────────────────
 * 译文侧的 span 额外挂 `.k-word-t`，让 CSS 用**另一条**颜色
 * （`--k-word-hi-trans`，默认跟随用户的译文色）而不是原文侧那条（`--k-word-hi`）。
 * 未播放词的灰色半透明（`--k-word-pend`）**两路一致**，不区分。
 */
function buildKaraokeClass(
  wordLevel: boolean,
  hasPenColor: boolean,
  side: 'orig' | 'trans' = 'orig'
): string {
  if (!wordLevel || hasPenColor) return 'k-char k-pend';
  return side === 'trans' ? 'k-char k-pend k-word k-word-t' : 'k-char k-pend k-word';
}

/** 文本按码点计长（emoji 不会被算成两个） */
function charLenOf(text: string): number {
  return Array.from(text).length;
}

/* ============================================================================
 * 译文 token 化（v0.5.0 修复「中文译文整句同现」）
 * ==========================================================================*/

/** 假名 / 汉字（含扩展A）/ 谚文 / CJK 部首与兼容区（口径与 utils/lyric-track 的 CJK_CHAR_RE 一致；U+3000 归空白） */
const KARAOKE_CJK_CHAR_RE =
  /[\u2E80-\u2EFF\u3040-\u30FF\u31F0-\u31FF\u3400-\u4DBF\u4E00-\u9FFF\uF900-\uFAFF\uAC00-\uD7AF]/;
const KARAOKE_WS_CHAR_RE = /[\s\u3000]/;
/** \p{P} 标点 + \p{S} 符号（含全角标点与货币/数学符号） */
const KARAOKE_PUNCT_CHAR_RE = /[\p{P}\p{S}]/u;
/** 归一化用：全局版空白 / 标点正则（判定「未翻译、保持原样」时要把它们全去掉） */
const KARAOKE_WS_G_RE = /[\s\u3000]/g;
const KARAOKE_PUNCT_G_RE = /[\p{P}\p{S}]/gu;

/**
 * 「未翻译、保持原样」判定用的**归一化口径**（纯函数）：
 *   1. 去零宽字符（`stripInvisible`：U+200B–U+200F / U+FEFF / U+2060）；
 *   2. 去**全部**空白（含全角空格 U+3000、NBSP）；
 *   3. 去标点与符号（\p{P} + \p{S}，与 `tokenizeTransText` 同一口径）；
 *   4. 转小写。
 * 于是「同语言没翻译」「只差标点 / 大小写 / 空白」都会归到**同一条逐字路径**。
 */
function normalizeKaraokeText(text: string): string {
  if (!text) return '';
  return stripInvisible(text)
    .replace(KARAOKE_WS_G_RE, '')
    .replace(KARAOKE_PUNCT_G_RE, '')
    .toLowerCase();
}

/**
 * 「译文 == 原文（归一化后）」= 未翻译、保持原样。
 * 这是**三态判定**的第二态：译文位不再另算一份 token 表，而是与原文共用
 * `win.charTimings`（见 `buildKaraokeSpans`）。
 */
function isUntranslatedKaraoke(transText: string, origText: string): boolean {
  if (!transText) return false;
  const t = normalizeKaraokeText(transText);
  if (!t) return false;
  return t === normalizeKaraokeText(origText);
}

/**
 * 译文某个字符位置对应的原文颜色（按**字符比例**映射，与时间表无关）。
 * 歌词轨与自动字幕轨共用；原文没有笔色时返回 null（走用户配色）。
 */
function transColorAt(
  srcTimings: CharTiming[],
  srcLen: number,
  transLen: number,
  charOffset: number
): string | null {
  if (srcLen <= 0 || transLen <= 0) return null;
  const j = Math.min(srcLen - 1, Math.floor((charOffset * srcLen) / transLen));
  return srcTimings[j]?.color ?? null;
}

/** 原文已唱字符里出现最多的颜色 —— 歌词轨整句淡入分支用它给译文上色 */
function pickMainColor(timings: CharTiming[]): string | null {
  const cnt = new Map<string, number>();
  for (const t of timings) {
    if (!t.color) continue;
    cnt.set(t.color, (cnt.get(t.color) || 0) + 1);
  }
  let best: string | null = null;
  let bestN = 0;
  for (const [c, n] of cnt) {
    if (n > bestN) {
      best = c;
      bestN = n;
    }
  }
  return best;
}

/** 一个译文 token：`text` 是渲染文本（含贴上的空白/标点），`offset` 是首字符在整句里的码点下标（供颜色按字符比例映射） */
interface TransToken {
  text: string;
  offset: number;
}

/**
 * 译文切 token（纯函数，无副作用）：
 *   - **CJK（汉字/假名/谚文）每字一个 token**；
 *   - 拉丁字母/数字/其它文字按**空格词**聚合为一个 token（词内连续字符一起亮，
 *     词内字符共享同一 `startMs`；这是**译文自己的口径**——原文 ASR 已是字级，
 *     不再是整词显现）；
 *   - **标点/符号贴在前 token 末尾**（前 token 存在、中间没有空白、且前 token
 *     末字符不是标点，如「了。」的「。」跟「了」一起亮）；不满足任一条件
 *     （行首、空白后、前 token 已以标点结尾）就**独立成一个小 token**；
 *   - **空白贴在前 token 末尾**（渲染需要词间距；行首空白挂到下一个 token 开头），
 *     保证 tokens 依序拼接 = 原文整句，显示不丢字不加字。
 */
function tokenizeTransText(text: string): TransToken[] {
  const chars = Array.from(text);
  const tokens: TransToken[] = [];
  let buf = ''; // 正在攒的拉丁词（含贴后的标点与尾随空白）
  let bufOffset = -1;
  let leadSpace = false; // 词首空白：前面还没有 token 可贴
  let spaceAfterLast = true; // 上个 token 之后是否隔了空白（决定标点贴不贴前词）
  const flush = () => {
    if (buf) {
      tokens.push({ text: (leadSpace ? ' ' : '') + buf, offset: bufOffset });
      buf = '';
      bufOffset = -1;
      leadSpace = false;
    }
  };
  for (let i = 0; i < chars.length; i++) {
    const ch = chars[i];
    if (KARAOKE_WS_CHAR_RE.test(ch)) {
      if (buf) {
        /**
         * 拉丁词遇到空白 → **词结束，落成一个独立 token**。
         * （v0.5.0 渲染层修复：原来这里把空白直接拼进 `buf`，于是
         *  「Tonight we begin together right now」整句只攒出 **1 个 token** ——
         *  译文整句一次跳变，「译文逐字生效」完全失效。）
         * 空白仍贴在这个词的末尾（渲染需要词间距），保证 tokens 依序拼接 = 原文整句。
         */
        flush();
        if (tokens.length > 0) tokens[tokens.length - 1].text += ch;
        spaceAfterLast = true;
      } else if (tokens.length > 0) {
        tokens[tokens.length - 1].text += ch;
        spaceAfterLast = true;
      } else {
        leadSpace = true;
      }
      continue;
    }
    if (KARAOKE_CJK_CHAR_RE.test(ch)) {
      flush();
      tokens.push({ text: (leadSpace ? ' ' : '') + ch, offset: i });
      leadSpace = false;
      spaceAfterLast = false;
      continue;
    }
    if (KARAOKE_PUNCT_CHAR_RE.test(ch)) {
      if (buf) {
        buf += ch; // 词内/词尾标点：跟拉丁词一起亮（"word," 一个 token）
        continue;
      }
      const last = tokens[tokens.length - 1];
      const lastChar = last ? Array.from(last.text).pop() ?? '' : '';
      if (last && !spaceAfterLast && lastChar && !KARAOKE_PUNCT_CHAR_RE.test(lastChar)) {
        last.text += ch; // 贴前词：CJK 或拉丁词后的标点（"了。"）
      } else {
        tokens.push({ text: (leadSpace ? ' ' : '') + ch, offset: i });
        leadSpace = false;
      }
      spaceAfterLast = false;
      continue;
    }
    // 普通字符（拉丁/数字/其它文字）：攒进当前词
    if (!buf) bufOffset = i;
    buf += ch;
    spaceAfterLast = false;
  }
  flush();
  // 病态兜底：非空文本却一个 token 都没攒出来（如纯空白），整句一个 token，不空渲染
  if (tokens.length === 0 && chars.length > 0) {
    tokens.push({ text, offset: 0 });
  }
  return tokens;
}

/**
 * **译文 token** 时间表：在 `[startMs, endMs]` 上按 token 数量**均匀分配**——第 k 个
 * token 的点亮时刻 ≈ `startMs + span × k / N`（「按进度百分比」）；同一 token 内所有
 * 字符共享同一 `startMs`（一个词 / 一个汉字一起跳变，`indexAtTimings` 取
 * 「最后一个 startMs<=now」即可命中）；token 的 `endMs` = 下一 token 起点，末 token
 * 对齐 `win.endMs`。`span >= N` 时起点严格递增（相邻 floor 差 ≥1）；极短窗口
 * （span < N）按 1ms 密排并钳到 endMs，个别 token 同刻跳变，只发生在病态输入。
 *
 * 适用范围：**只有「已翻译」分支走这张表**。
 * 「未翻译、保持原样」分支**不复用它**（改用原文那份 `win.charTimings`），
 * 原文侧也**从不**用它（原文走自己的字级表）。
 */
function buildTransTokenTimings(win: KaraokeWindow, tokens: TransToken[]): CharTiming[] {
  const n = tokens.length;
  if (n === 0) return [];
  const span = Math.max(0, win.endMs - win.startMs);
  const starts = new Array<number>(n);
  for (let k = 0; k < n; k++) {
    starts[k] =
      span >= n
        ? win.startMs + Math.floor((span * k) / n)
        : Math.min(win.startMs + k, win.endMs);
  }
  const out: CharTiming[] = new Array(n);
  for (let k = 0; k < n; k++) {
    const endMs = k + 1 < n ? Math.max(starts[k], starts[k + 1]) : Math.max(starts[k], win.endMs);
    out[k] = { char: tokens[k].text, startMs: starts[k], endMs, estimated: true };
  }
  return out;
}

/**
 * 当前时刻在逐字时间表里的位置：
 *   -1 = 还没开始（全部未点亮）；n = 已经唱完（全部点亮，**不回退、不循环**）；
 *   其余 = 当前正在唱的字符下标。
 */
function indexAtTimings(timings: CharTiming[], nowMs: number): number {
  const n = timings.length;
  if (n === 0) return -1;
  if (nowMs < timings[0].startMs) return -1;
  if (nowMs >= timings[n - 1].endMs) return n;
  let lo = 0;
  let hi = n - 1;
  let found = 0;
  while (lo <= hi) {
    const mid = (lo + hi) >> 1;
    if (timings[mid].startMs <= nowMs) {
      found = mid;
      lo = mid + 1;
    } else {
      hi = mid - 1;
    }
  }
  return found;
}

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

/**
 * 逐词高亮色白名单（v0.5.0 任务·渲染层）
 * ---------------------------------------------------------------------------
 * `settings.wordHighlightColor` / `settings.wordHighlightTransColor` 会被拼进
 * `style` 的 CSS 变量值 ⇒ **只允许 hex**：`#rgb` / `#rgba` / `#rrggbb` / `#rrggbbaa`。
 * 其它任何字符串（`red; background:url(...)` 这类）一律**返回空串**。
 *
 * ⚠️ **语义已改（v0.5.0 双路）**：本函数**不再**自己回退到某个默认色，而是
 * 「空串或非法值 → 返回空串」。空串代表「**跟随**」，由调用方决定回退到
 * `settings.origColor`（原文侧）/ `settings.transColor`（译文侧）。
 * 与 `utils/storage.ts` 的 `sanitizeColor` 同族口径，但渲染层再兜一次底 ——
 * 设置值可能来自旧版本 / 手改过的 local storage。
 */
function sanitizeWordHighlightColor(raw: unknown): string {
  if (typeof raw !== 'string') return '';
  const v = raw.trim();
  if (!v) return '';
  if (/^#(?:[0-9a-f]{3}|[0-9a-f]{4}|[0-9a-f]{6}|[0-9a-f]{8})$/i.test(v)) return v;
  return '';
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

  /* ══════════ v0.5.3 场景名解析（只读，仅服务于状态指示行） ══════════
   * 「目标语言 / 翻译场景」两个折叠块已删掉，浮层不再让用户改这两项；
   * 但指示行仍要显示**当前**场景的真实名称，所以还得读一次自定义场景包：
   * customScenes 只是 storage.local[CUSTOM_SCENE_KEY] 的镜像，读失败/为空当空数组，
   * 由 getAllScenes() 退化出内置 5 个场景（用户选了已上传场景时名字不会错成「通用」）。
   */
  private customScenes: ScenePack[] = [];
  private scenesLoadStarted: boolean = false;
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

  /* ══════════ v0.5.0 歌词轨卡拉OK渲染状态（开关关闭时全部为空，不参与任何分支） ══════════ */
  /** 摊平后的「句子 × 显示窗口」索引，按窗口 startMs 升序；空数组 = 当前不是歌词轨 */
  private karaokeIndex: Array<{ s: SubtitleSentence; w: KaraokeWindow; key: string }> = [];
  /** 建索引时绑定的句子数组引用：引用没变就不重建（翻译推进不会改引用） */
  private karaokeIndexSource: SubtitleSentence[] | null = null;
  /** 已建好 span 结构的窗口键；变了才重建 DOM（**绝不每帧重建**） */
  private karaokeBuiltKey = '';
  private karaokeOrigSpans: HTMLElement[] = [];
  private karaokeTransSpans: HTMLElement[] = [];
  /** 上一次涂到的字符下标，用于「只切边界那两个 span」 */
  private karaokeOrigPainted = -1;
  private karaokeTransPainted = -1;
  private karaokeTransTimings: CharTiming[] = [];
  /**
   * 歌词轨整句淡入分支标记：true = 译文是一个 `.k-whole` 整句 span（靠 CSS 动画），
   * 不再逐帧涂。**仅歌词轨**会用；自动字幕（ASR）轨恒为 false。
   */
  private karaokeTransWhole = false;
  /** 当前显示窗口的结束时间，用于句间停顿的清除判定 */
  private lastKaraokeEndMs = 0;
  /** 最近一次渲染用的有效时间：设置变更（改颜色/字号）时按它重画，不跳回句首 */
  private lastEffectiveTimeMs = 0;
  /** 译文逐字时间记忆化（键 = 窗口区间 + 译文） */
  private karaokeTransCache = new Map<string, CharTiming[]>();

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

    /* v0.5.3：shadow 是新建的，场景包读取状态必须重置（否则新 shadow 里指示行拿不到
       自定义场景名）；挂载后先补读一次，让右上角就绪徽章也能显示真实场景名。 */
    this.scenesLoadStarted = false;
    this.customScenes = [];
    this.loadScenePacks();

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
        /* v0.5.5：面板高度不再跟着播放器尺寸算（高度是配置值），尺寸变化只影响 CSS 的
           max-height，浏览器自己夹。这里不需要重定高度。 */
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
    this.teardownKaraoke();
    this.karaokeIndex = [];
    this.karaokeIndexSource = null;
    this.lastEffectiveTimeMs = 0;
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
    /* v0.5.0：关掉卡拉OK时把 span 残留清干净，普通渲染路径才能拿到纯净容器 */
    const karaokeOff = newSettings.lyricKaraoke !== true;
    this.settings = newSettings;
    if (karaokeOff) {
      this.teardownKaraoke();
      this.karaokeIndex = [];
      this.karaokeIndexSource = null;
    }

    this.applyStyles();
    this.syncQuickPanelValues();
    if (this.currentSentence) {
      /* 卡拉OK句：按「最近一次有效时间」重画（不跳回句首），结构按新配色/字号重建 */
      const hit = karaokeOff ? null : this.findKaraokeWindowAt(this.lastEffectiveTimeMs);
      if (hit) {
        this.karaokeBuiltKey = '';
        this.renderKaraoke(hit.s, hit.w, this.lastEffectiveTimeMs);
      } else {
        this.renderCurrentSentence(this.currentSentence);
      }
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
        /* v0.5.3：与面板指示行同一口径（目标语言 · 场景名 · 句数），两处不漂移 */
        this.showStatusBadge(`字幕已就绪（${this.getStatusLineText(sentences.length)}）`, 3000, 'check');
      }
    }
    this.syncQuickPanelValues();
    this.updateDrawerTranslations();

    /**
     * v0.5.0：译文是异步回来的，而逐字推进只在 timeupdate（约 4Hz）里发生。
     * 视频暂停时没有 timeupdate —— 若不在这里补一次重画，用户暂停后改设置/等译文
     * 会看到「译文位一直空着」直到下次播放。这里按最近一次有效时间重画一次，
     * 结构未变时 buildKey 命中缓存，只是不重建 DOM。
     * 仅在开关打开时执行，普通字幕路径不受影响。
     */
    if (this.settings.lyricKaraoke === true && this.lastEffectiveTimeMs > 0) {
      this.ensureKaraokeIndex();
      const hit = this.findKaraokeWindowAt(this.lastEffectiveTimeMs);
      if (hit) {
        this.currentSentence = hit.s;
        this.renderKaraoke(hit.s, hit.w, this.lastEffectiveTimeMs);
      }
    }
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

    /**
     * v0.5.0 歌词轨卡拉OK分支。
     * 只有「用户开了开关」且「数据里确实有歌词显示窗口」才进来；
     * 否则走下面 0.4.3 的原逻辑（一行未改）。
     * 驱动频率仍是 timeupdate（约 4Hz），不新增 rAF 循环 —— 暂停时没有 timeupdate，
     * 逐字进度自然停住，也不需要额外监听 play/pause。
     */
    if (this.isKaraokeActive()) {
      const hit = this.findKaraokeWindowAt(effectiveTime);
      if (hit) {
        this.currentSentence = hit.s;
        this.lastKaraokeEndMs = hit.w.endMs;
        this.renderKaraoke(hit.s, hit.w, effectiveTime);
        if (this.isDrawerOpen) {
          this.highlightDrawerItem(hit.s.id);
        }
      } else if (this.currentSentence && effectiveTime - this.lastKaraokeEndMs > 1800) {
        this.clearCurrentDisplay();
      }
      return;
    }

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

  /* ══════════════════════════════════════════════════════════════════════════
   * v0.5.0 歌词轨卡拉OK渲染
   * ----------------------------------------------------------------------------
   * 性能约定（任务五性能红线）：
   *   - span 结构**每个显示窗口只建一次**，之后每帧只切边界 span 的 class；
   *   - 不改 fontSize / 布局属性，只改 class（color / opacity / text-shadow 由 CSS 管）；
   *   - 驱动沿用 timeupdate（约 4Hz），不新增 rAF 循环，暂停即停；
   *   - 过渡只有 120ms 的 color/opacity，`prefers-reduced-motion` 下归零。
   * ========================================================================== */

  /**
   * 是否走逐字渲染：按**句子类型**分流，两个开关各管各的（v0.5.0 阶段 B 解耦）。
   *
   * - 歌词句（`lyricTrack === true && asrTimed !== true`）→ 需要 `lyricKaraoke === true`；
   * - ASR 句（`asrTimed === true`）→ 需要 `asrWordReveal !== false`（缺省视为默认 true）。
   *
   * 只要存在「对应开关已开」的那一类句子就允许逐字渲染；两类句子都没有（普通 VOD）
   * 返回 false，保持 0.4.3 的整句渲染行为。这样关掉「歌词逐字点亮」不会连带关掉
   * 「自动字幕逐词显现」，反之亦然。
   *
   * ⚠️ 保留既有守卫：至少一句带 `lyricTrack`；`ensureKaraokeIndex()` 之后还要求
   * 索引非空 —— 否则「部分句子挂窗口」会让没窗口的句子在索引里查不到、整条不显示。
   */
  private isKaraokeActive(): boolean {
    // 没有一句带 lyricTrack → 普通 VOD，绝不走逐字渲染（0.4.3 行为）
    if (!this.allSentences.some((s) => s.lyricTrack === true)) return false;

    const lyricOn = this.settings.lyricKaraoke === true;
    const asrOn = this.settings.asrWordReveal !== false; // 缺省 = 默认 true
    const anyEnabled = this.allSentences.some((s) =>
      s.asrTimed === true ? asrOn : (s.lyricTrack === true && lyricOn)
    );
    if (!anyEnabled) return false;

    this.ensureKaraokeIndex();
    return this.karaokeIndex.length > 0;
  }

  /**
   * 建「句子 × 显示窗口」的摊平索引（一次遍历，之后按引用复用）。
   * 副歌重复出现 → 同一句有多个窗口 → 每次出现都能命中，但翻译只做一次。
   */
  private ensureKaraokeIndex() {
    if (this.karaokeIndexSource === this.allSentences) return;
    this.karaokeIndexSource = this.allSentences;
    const index: Array<{ s: SubtitleSentence; w: KaraokeWindow; key: string }> = [];
    for (const s of this.allSentences) {
      const wins = s.karaokeWindows;
      if (!wins || wins.length === 0) continue;
      for (let i = 0; i < wins.length; i++) {
        index.push({ s, w: wins[i], key: `${s.id}:${i}:${wins[i].startMs}` });
      }
    }
    index.sort((a, b) => a.w.startMs - b.w.startMs);
    this.karaokeIndex = index;
  }

  /** 二分查找当前时间命中的显示窗口（命中较晚开始的一段优先，避免上一句抢占） */
  private findKaraokeWindowAt(time: number) {
    const arr = this.karaokeIndex;
    if (arr.length === 0) return null;

    let lo = 0;
    let hi = arr.length - 1;
    let found = -1;
    while (lo <= hi) {
      const mid = (lo + hi) >> 1;
      if (arr[mid].w.startMs <= time) {
        found = mid;
        lo = mid + 1;
      } else {
        hi = mid - 1;
      }
    }
    if (found < 0) return null;

    // 回看 2 段：重叠裁剪会在窗口之间留下 ≤80ms 的缝，容差内不闪没
    const from = Math.max(0, found - 2);
    for (let i = found; i >= from; i--) {
      const it = arr[i];
      if (time >= it.w.startMs && time <= it.w.endMs + 120) return it;
    }
    return null;
  }

  /**
   * 译文 token 时间表：token 化（CJK 每字 / 拉丁空格词）后在窗口上**均匀分配**
   * （按进度百分比点亮），与译文自身长短无关——ASR 轨不再用「按字符数与原文
   * 比较、短了就整句淡入」那套（中文 10 个字对着英文 35 个字符必然误判，
   * 导致整句同现）。
   * 缓存键机制保留（键 = 窗口区间 + 译文）。
   *
   * 适用范围：**只有「已翻译」分支**会调它；「未翻译、保持原样」分支走的是
   * 原文那份 `win.charTimings`（同一份表），不经过这里。
   */
  private getKaraokeTransTimings(
    win: KaraokeWindow,
    text: string,
    tokenized: boolean
  ): CharTiming[] {
    const key = `${tokenized ? 'tk' : 'ch'}-${win.startMs}-${win.endMs}|${text}`;
    const cached = this.karaokeTransCache.get(key);
    if (cached) return cached;
    /**
     * tokenized = true  → 自动字幕（ASR）轨：CJK 每字 / 拉丁空格词，按进度百分比均匀分配；
     * tokenized = false → 歌词轨（v0.5.0 原样）：按译文自身字符均分。
     */
    const timings = tokenized
      ? buildTransTokenTimings(win, tokenizeTransText(text))
      : estimateCharTimings({ text, startMs: win.startMs, endMs: win.endMs });
    if (this.karaokeTransCache.size > 64) this.karaokeTransCache.clear();
    this.karaokeTransCache.set(key, timings);
    return timings;
  }

  /** 取译文（失败/空一律当作「没有译文」，只画原文进度） */
  private resolveKaraokeTranslation(sentence: SubtitleSentence): string {
    const t = sentence.translation;
    if (!t) return '';
    if (t.startsWith('[翻译失败') || t.startsWith('[翻译异常') || t.startsWith('[AI精翻')) return '';
    return t;
  }

  /**
   * 建/复用 span 结构。只有窗口、句子或译文变化时才重建。
   * 原文 span 数与 `charTimings.length` 严格 1:1 —— 注意 `timing.char` 可能是**整句**
   * （短句走整片分支），所以进展按 span 下标推进，不假设每个 span 只有一个字符。
   *
   * v0.5.0 渲染层：**译文与「未翻译、保持原样的原文」走同一条逐字路径**。
   * 三态（判定见文件头的说明）：
   *   1. `transText === ''`（没有译文 / 翻译失败标记）→ 译文位 `k-placeholder` 占位、
   *      不写任何字符，只画原文进度；
   *   2. `untranslated`（译文归一化后 == 原文归一化）→ 译文位显示**原文文本**，
   *      时间表**直接复用原文那份 `win.charTimings`**（同一份数组引用），
   *      两侧同步逐字推进；
   *   3. 已翻译 → 译文位显示译文，ASR 轨走 token 表、歌词轨保持原样。
   *
   * 原文侧**始终**用它自己的 `win.charTimings`（数据层给什么粒度就按什么粒度点亮：
   * 官方词级时间戳 ⇒ **整词一起亮**；帧推断 / 均分 ⇒ 逐字），不会因为译文被翻译过
   * 就重复处理。
   */
  private buildKaraokeSpans(sentence: SubtitleSentence, win: KaraokeWindow, transText: string) {
    const origEl = this.origEl;
    const transEl = this.transEl;
    if (!origEl || !transEl) return;

    origEl.textContent = '';
    transEl.textContent = '';
    transEl.classList.remove('loading', 'error');
    this.karaokeOrigSpans = [];
    this.karaokeTransSpans = [];
    this.karaokeTransTimings = [];
    this.karaokeOrigPainted = -1;
    this.karaokeTransPainted = -1;
    this.karaokeTransWhole = false;

    /**
     * v0.5.0 任务·渲染层：这条句子是不是「**官方词级时间戳**」的句子。
     * 数据层在 `buildAsrCharTimings` 命中 `source === 'offset'` 时打 true
     * （`content/index.ts` 的 `attachAsrWordTimings` 写进 `sentence.wordLevel`）。
     * 只有 true 的句子才带 `.k-word`（逐词高亮配色）；
     * 歌词轨 / 手动字幕 / 帧推断 / 均分兜底 一律 false。
     */
    const wordLevel = sentence.wordLevel === true;

    const origFrag = document.createDocumentFragment();
    for (const t of win.charTimings) {
      const span = document.createElement('span');
      /* v0.5.0 任务·渲染层：词级句（官方词级时间戳）才带 .k-word；
         有官方笔色的 span 不带（笔色优先，见 buildKaraokeClass 的注释）。 */
      span.className = buildKaraokeClass(wordLevel, !!t.color);
      // 零宽字符已在数据层（invisible-text.ts）剥掉，这里不做任何字符替换，只用 textContent
      span.textContent = t.char;
      /**
       * 官方笔色透传（v0.5.0 渲染层）：只在**建 span 时**写一次内联色，之后每帧
       * 只切 class。内联色优先级高于 `k-done` / `k-cur` 的 color 规则，所以有笔色
       * 的字不会被用户配色覆盖；「未到」态由 CSS 里 `k-pend` 的半透明白压回去
       * （该规则带 !important，否则内联色会让整行一上来就全亮）。
       */
      if (t.color) span.style.color = t.color;
      origFrag.appendChild(span);
      this.karaokeOrigSpans.push(span);
    }
    origEl.appendChild(origFrag);

    if (!transText) {
      // 译文缺失/失败：占位保高，避免布局跳动；**不写任何字符**（含零宽）
      transEl.classList.add('k-placeholder');
      return;
    }
    transEl.classList.remove('k-placeholder');

    const srcTimings = win.charTimings;
    const srcLen = srcTimings.length;
    const transLen = charLenOf(transText);

    /* ══════════════════════════════════════════════════════════════════════
     * 三态判定：译文 / 未翻译（保持原样） / 没有译文
     * ---------------------------------------------------------------------
     * 第二态「未翻译、保持原样」：插件没翻译（或翻译服务回落到原文）时，
     * 译文内容与原文相同 —— 这时**不再另算一份 token 表**（那正是以前两侧
     * 不对称的根源：原文按字级表逐字、译文按 token 表整段跳）。
     * 改为**直接复用原文那份 `win.charTimings`**：
     *   - 时间表是**同一个数组引用**（不是拷贝），`indexAtTimings` 在两侧
     *     必然算出同一个下标 → 同一时刻 `k-done` / `k-cur` 数量一致；
     *   - span 也照抄原文那份（字符、笔色一比一）→ 两行内容与配色完全相同；
     *   - 颜色映射（`transColorAt`）在这里不需要再跑一遍：同一份表 → 颜色一致。
     * ══════════════════════════════════════════════════════════════════ */
    if (isUntranslatedKaraoke(transText, sentence.text)) {
      this.karaokeTransTimings = win.charTimings;
      const transFrag = document.createDocumentFragment();
      for (const t of win.charTimings) {
        const span = document.createElement('span');
        /* 译文侧：加 .k-word-t ⇒ 已播放时取译文侧那条颜色（--k-word-hi-trans） */
        span.className = buildKaraokeClass(wordLevel, !!t.color, 'trans');
        span.textContent = t.char;
        if (t.color) span.style.color = t.color;
        transFrag.appendChild(span);
        this.karaokeTransSpans.push(span);
      }
      transEl.appendChild(transFrag);
      return;
    }

    /* ══════════════════════════════════════════════════════════════════════
     * 分流：歌词轨 vs 自动字幕（ASR）轨（**已翻译**才走这里）
     * ---------------------------------------------------------------------
     * 歌词轨（v0.5.0 已交付、已调好的效果）——**保持原样，一行不改**：
     *   译文远短于原文 → 整句淡入（`.k-whole`）；否则按译文自身字符均分逐字点亮。
     * 自动字幕（ASR）轨（v0.5.x 新增）——token 化 + 按进度百分比逐词点亮：
     *   CJK 每字一个 token、拉丁按空格词；句内按 token 数均匀分配时间。
     *   这样中文译文不会再因为「比英文原文短」而整句同现。
     *
     * 注：未翻译时译文 == 原文，长度相同 → 歌词轨的「整句淡入」分支
     * **不会**触发，天然走上面的逐字路径。
     * ══════════════════════════════════════════════════════════════════ */
    if (sentence.asrTimed !== true) {
      const origLen = srcTimings.reduce((acc, t) => acc + charLenOf(t.char), 0);
      if (origLen > 0 && transLen < origLen * KARAOKE_WHOLE_LINE_RATIO) {
        // 译文远短于原文：逐字会「一闪一闪」，退化为整句淡入 + 句末 200ms 停留
        this.karaokeTransWhole = true;
        const span = document.createElement('span');
        span.className = 'k-char k-whole';
        span.textContent = transText;
        const spanMs = Math.max(0, win.endMs - win.startMs);
        const fadeMs = Math.min(
          KARAOKE_FADE_MAX_MS,
          Math.max(KARAOKE_FADE_MIN_MS, spanMs - KARAOKE_HOLD_TAIL_MS)
        );
        span.style.animationDuration = `${fadeMs}ms`;
        const wholeColor = pickMainColor(srcTimings);
        if (wholeColor) span.style.color = wholeColor;
        transEl.appendChild(span);
        this.karaokeTransSpans = [span];
        return;
      }

      this.karaokeTransTimings = this.getKaraokeTransTimings(win, transText, false);
      const frag = document.createDocumentFragment();
      let charOffset = 0;
      for (const t of this.karaokeTransTimings) {
        const span = document.createElement('span');
        span.textContent = t.char;
        const c = transColorAt(srcTimings, srcLen, transLen, charOffset);
        if (c) span.style.color = c;
        /* 有官方笔色 ⇒ 不带 .k-word（笔色优先）；无笔色 ⇒ 词级句才带 */
        span.className = buildKaraokeClass(wordLevel, !!c, 'trans');
        charOffset += charLenOf(t.char);
        frag.appendChild(span);
        this.karaokeTransSpans.push(span);
      }
      transEl.appendChild(frag);
      return;
    }

    // ── 自动字幕（ASR）轨 · 已翻译：译文走 token 表（token 内字符共享 startMs） ──
    //    注意这是**译文自己**的表：原文侧始终用 `win.charTimings`（字级），
    //    两侧**不共用**时间表 —— 共用会让两侧节奏打架。
    this.karaokeTransTimings = this.getKaraokeTransTimings(win, transText, true);
    const tokens = tokenizeTransText(transText);
    const transFrag = document.createDocumentFragment();
    /**
     * v0.5.0：译文跟随原文配色。
     * 按**字符比例**做位置映射（不是按时间）—— 译文 token 首字符在第 `offset`
     * 个字符处，取原文第 `floor(offset * 原文长度 / 译文长度)` 个字符的颜色。
     * 这样彩虹行的译文也能拿到完整渐变，单色行译文整行同色；原文未唱位置是
     * null，译文对应位置就不写内联色，仍由 `k-pend` 的半透明白兜底。
     * 注意：颜色与点亮时间是两回事，token 化只改时间，不碰这个映射。
     */
    for (let i = 0; i < tokens.length; i++) {
      const span = document.createElement('span');
      span.textContent = tokens[i].text;
      const c = transColorAt(srcTimings, srcLen, transLen, tokens[i].offset);
      if (c) span.style.color = c;
      /* 有官方笔色 ⇒ 不带 .k-word（笔色优先）；无笔色 ⇒ 词级句才带 */
      span.className = buildKaraokeClass(wordLevel, !!c, 'trans');
      transFrag.appendChild(span);
      this.karaokeTransSpans.push(span);
    }
    transEl.appendChild(transFrag);
  }

  /**
   * 每帧只做这件事：把「上一个当前字」降级为已完成、新当前字升级为高亮。
   * 前进时写入量与位移成正比（4Hz 下通常 1–2 个 span），
   * 后退（用户拖动进度条）或跳跃较大时才整段重涂 —— 一行最多几十个 span，代价可忽略。
   *
   * 下标**每次都由 `indexAtTimings(timings, nowMs)` 从时间表反算**，不依赖上一帧
   * 积累的状态，所以拖动回退时「已完成」会按 startMs 正确退回「未到」，
   * 官方笔色 span 也跟着退回半透明白（不会残留全亮）。
   */
  private paintKaraoke(
    spans: HTMLElement[],
    timings: CharTiming[],
    nowMs: number,
    painted: number
  ): number {
    if (spans.length === 0 || timings.length === 0) return painted;
    const idx = indexAtTimings(timings, nowMs);
    if (idx === painted) return painted;

    if (idx > painted) {
      const from = Math.max(0, painted);
      for (let i = from; i < idx && i < spans.length; i++) setKaraokeState(spans[i], 'done');
      if (idx < spans.length) setKaraokeState(spans[idx], 'cur');
      return idx;
    }

    for (let i = 0; i < spans.length; i++) {
      setKaraokeState(spans[i], i < idx ? 'done' : i === idx ? 'cur' : 'pend');
    }
    return idx;
  }

  /**
   * 卡拉OK渲染入口。
   * 视觉参数（字号/位置/描边/阴影）全部复用 `.original-text` / `.translated-text`
   * 现有样式令牌，这里只负责三态与排版开关。
   */
  private renderKaraoke(sentence: SubtitleSentence, win: KaraokeWindow, nowMs: number) {
    if (!this.containerEl || !this.origEl || !this.transEl) return;
    this.lastEffectiveTimeMs = nowMs;

    const { displayMode, layoutOrder } = this.settings;

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

    this.containerEl.style.flexDirection =
      layoutOrder === 'translation_top' ? 'column-reverse' : 'column';

    if (this.sentenceAiBadgeEl) {
      this.sentenceAiBadgeEl.classList.toggle('hidden', !sentence.isAi);
    }
    this.containerEl.classList.add('active');

    const transText = this.resolveKaraokeTranslation(sentence);
    const buildKey = `${win.startMs}:${win.endMs}:${sentence.id}:${transText}`;
    if (buildKey !== this.karaokeBuiltKey) {
      this.buildKaraokeSpans(sentence, win, transText);
      this.karaokeBuiltKey = buildKey;
    }

    /* 原文逐字：按 span 下标推进（char 可能是整句，不看长度） */
    this.karaokeOrigPainted = this.paintKaraoke(
      this.karaokeOrigSpans,
      win.charTimings,
      nowMs,
      this.karaokeOrigPainted
    );

    /* 译文：歌词轨的整句淡入分支由 CSS 动画负责，只有逐字/逐词分支才逐帧涂 */
    if (!this.karaokeTransWhole && this.karaokeTransSpans.length > 0) {
      this.karaokeTransPainted = this.paintKaraoke(
        this.karaokeTransSpans,
        this.karaokeTransTimings,
        nowMs,
        this.karaokeTransPainted
      );
    }
  }

  /** 清掉卡拉OK残留（关掉开关或重建时调用），保证回到普通渲染后 DOM 干净 */
  private teardownKaraoke() {
    this.karaokeBuiltKey = '';
    this.karaokeOrigSpans = [];
    this.karaokeTransSpans = [];
    this.karaokeOrigPainted = -1;
    this.karaokeTransPainted = -1;
    this.karaokeTransWhole = false;
    this.karaokeTransTimings = [];
    this.karaokeTransCache.clear();
    if (this.transEl) this.transEl.classList.remove('k-placeholder', 'k-whole');
    if (this.origEl) this.origEl.textContent = '';
    if (this.transEl) this.transEl.textContent = '';
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
        // 每次打开重读一次自定义场景包，指示行的场景名随 storage 变化（只读，无卡片）
        this.loadScenePacks(true);
        this.quickPanelEl.classList.remove('subview-style-open');
        this.quickPanelEl.style.display = 'flex';
        this.quickPanelEl.classList.add('open');
        this.quickPanelEl.style.opacity = '1';
        this.quickPanelEl.style.visibility = 'visible';
        this.quickPanelEl.style.pointerEvents = 'auto';
        this.syncMicroPreview();
        /* v0.5.5：开面板前把高度变量按设置落好（高度是配置值，不用等首帧量内容） */
        this.applyQpHeight();
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
    /* 无底色时同步摘掉卡片的柔和外扩阴影：那条 box-shadow 原本是给半透明底色「收边」的，
       底色一旦透明，它就变成一圈悬空的黑色雾影（用户说的「字幕模糊效果」）。
       用 box-shadow 而不是 filter —— 后者会把视频拉进合成层，影响 N 卡 VSR。 */
    this.containerEl.classList.toggle(
      'bg-transparent',
      (bgColor || '').toLowerCase() === '#00000000' || bgColor === 'transparent',
    );
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
     * 【v0.5.0 歌词轨卡拉OK三态色】
     * 语义（用户拍板）：**未到 = 半透明白，已到 = 用户自己选的原文色**；
     * 「当前」与「已过」的可辨识差异由 CSS 的 text-shadow 发光给出
     * （text-shadow 不是滤镜类效果，不会把视频拉进合成层，VSR 红线安全）。
     *
     * 这条链只服务**无笔色**的轨（兜底）。有官方笔色的轨走 span 内联色，
     * 优先级高于这三档，两条链互不覆盖。
     * 译文轨不上官方色，保持 v0.5.0 现状（已过/当前=译文色，未到=同色 42%）。
     */
    this.origEl.style.setProperty('--k-pend', KARAOKE_PEND_COLOR);
    this.origEl.style.setProperty('--k-done', origColor);
    this.origEl.style.setProperty('--k-cur', origColor);
    this.transEl.style.setProperty('--k-done', transColor);
    this.transEl.style.setProperty('--k-cur', transColor);
    this.transEl.style.setProperty('--k-pend', hexToRgba(transColor, 42));

    /**
     * 【v0.5.0 任务·渲染层】逐词高亮色 —— **双路**（原文侧 / 译文侧各一个）。
     *
     * 语义（用户拍板）：逐词高亮的颜色**默认跟随用户在「字幕样式」里选的颜色** ——
     * 选了「蓝色译文 + 白色原文」，逐词就应当是「译文亮蓝、原文亮白」；
     * 只有用户**单独改过**逐词颜色时才用那个自定义值。
     *
     * 落实方式：两个设置项的取值口径都是「**空串 = 跟随**」
     * （`wordHighlightColor` 跟 `origColor`、`wordHighlightTransColor` 跟 `transColor`），
     * 所以这里用「自定义值 || 跟随色 || 兜底白」三段式取值：
     *
     *   hiOrig  = 自定义(wordHighlightColor)      || 跟随(origColor)      || '#ffffff'
     *   hiTrans = 自定义(wordHighlightTransColor)  || 跟随(transColor)     || '#ffffff'
     *
     * 只被 `.k-char.k-word.k-done / .k-cur`（原文侧）与
     * `.k-char.k-word-t.k-done / .k-cur`（译文侧）消费 —— 而 `.k-word` **只有**带官方
     * 词级时间戳的句子才会有（`sentence.wordLevel === true`），所以这条变量对
     * 手动字幕 / 逐字字幕 / 歌词轨**完全不生效**。
     *
     * 值走 hex 白名单（`sanitizeWordHighlightColor`：空串或非法值 → 空串）：
     * **绝不把任意字符串拼进 style**。
     */
    const hiOrig =
      sanitizeWordHighlightColor(this.settings.wordHighlightColor) ||
      sanitizeWordHighlightColor(this.settings.origColor) ||
      '#ffffff';
    const hiTrans =
      sanitizeWordHighlightColor(this.settings.wordHighlightTransColor) ||
      sanitizeWordHighlightColor(this.settings.transColor) ||
      '#ffffff';
    /* 两个变量都注入到两个容器上：CSS 变量沿 DOM 继承，
       这样 `.original-text` / `.translated-text` 各自都拿得到两套值。 */
    this.origEl.style.setProperty('--k-word-hi', hiOrig);
    this.origEl.style.setProperty('--k-word-hi-trans', hiTrans);
    this.transEl.style.setProperty('--k-word-hi', hiOrig);
    this.transEl.style.setProperty('--k-word-hi-trans', hiTrans);

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

    /* v0.5.6：字幕字体放在最后统一落一次（颜色/字号都写完再应用，避免中途覆盖） */
    this.applySubtitleFont();
  }

  /**
   * 字幕字体（v0.5.6）—— **只**作用于 `.original-text` / `.translated-text`。
   *
   * 三条口径：
   *   1. `system` / 未知 id → 清掉内联 `font-family`，回到继承（= YouTube 自带字体）；
   *   2. 内置字体 → 直接写它那条 CSS 栈（纯系统字体名，不打包文件，命中就生效）；
   *   3. 自定义字体 → 写 `"YTSF-<id>", <同语言兜底栈>`，并确保 FontFace 已注册。
   *      注册失败**不抛给界面**：控制台留一条 warning，原地退回系统默认。
   *
   * 为什么用 style.setProperty 而不是往 CSS 里加规则：字体是用户级状态，
   * 写内联属性既不用动 overlay-styles.ts（VSR 红线文件），也不会波及卡片与按钮。
   */
  private applySubtitleFont(): void {
    if (!this.origEl || !this.transEl) return;
    const resolved = resolveSubtitleFont(this.settings.fontFamily, this.settings.customFonts);
    this.writeSubtitleFontStack(resolved.stack);
    if (!resolved.custom) return;

    const pack = resolved.custom;
    void ensureCustomFontRegistered(pack).then((ok) => {
      if (ok) return;
      /* 只在这条设置仍指向那个字体时才回退，避免把用户刚切走的新字体覆盖掉 */
      const current = resolveSubtitleFont(this.settings.fontFamily, this.settings.customFonts);
      if (current.custom?.id === pack.id) this.writeSubtitleFontStack('');
    });
  }

  /** 把字体栈写到两行字幕上；空串 = 摘掉内联属性（继承 = YouTube 默认字体） */
  private writeSubtitleFontStack(stack: string): void {
    for (const el of [this.origEl, this.transEl]) {
      if (!el) continue;
      if (stack) el.style.setProperty('font-family', stack);
      else el.style.removeProperty('font-family');
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

  /* ═════════════ 状态指示行文案（v0.5.3：三项口径，只读一行） ═════════════
   * 浮层删掉了「目标语言」「翻译场景」两个折叠块，改成一行只读指示：
   *     已就绪（简体中文 · 音乐视频 · 59 句）
   * 三项依次是 目标语言显示名 · 场景名 · 句数，分隔符固定 ` · `；
   * 不可点击、无箭头、无 hover 态（要改这两项请去扩展弹窗）。
   */

  /** 目标语言显示名：短码 → 中文名；未收录的短码原样回显，不猜也不吞值 */
  private getTargetLangLabel(): string {
    const code = this.settings.targetLang || 'zh-CN';
    return TARGET_LANG_LABELS[code] || code;
  }

  /** 当前场景的真实名称（取不到回退「通用」，不再按 vtuber/通用 二元判断） */
  private getSceneName(): string {
    const activeId = this.settings.scenario;
    const hit = getAllScenes({ glossaries: [], scenes: this.customScenes }).find((s) => s.id === activeId);
    return hit?.name || '通用';
  }

  /** 三项文案的唯一出口：面板状态行与右上角就绪徽章共用，防止两处口径漂移 */
  private getStatusLineText(sentenceCount: number): string {
    return `${this.getTargetLangLabel()} · ${this.getSceneName()} · ${sentenceCount} 句`;
  }

  /**
   * 补读自定义场景包（storage.local[CUSTOM_SCENE_KEY]，键名由 packs.ts 的
   * loadCustomPacks 内部持有，浮层不写死字符串）。
   * 与 v0.5.2 不同：这里只服务指示行的场景名，不渲染卡片、不解锁选中态；
   * force=true 用于每次打开面板时重读（弹窗刚上传的场景不必重开页面）。
   */
  private loadScenePacks(force: boolean = false): void {
    if (this.scenesLoadStarted && !force) return;
    this.scenesLoadStarted = true;
    loadCustomPacks()
      .then((custom) => {
        this.customScenes = Array.isArray(custom?.scenes) ? custom.scenes : [];
        if (this.isQuickPanelOpen) this.syncQuickPanelValues();
      })
      .catch(() => {
        /* storage 不可用 / 读取失败：退化为内置场景名，指示行照常显示 */
        this.customScenes = [];
      });
  }

  /* ═════════════ 面板高度（v0.5.5）：配置值优先，CSS 负责夹上限 ═════════════
   * 为什么不再「每次量内容高再回写」：
   *   视图是 height:100% 的滚动容器，容器比内容矮时 scrollHeight 会退化成 clientHeight，
   *   量少 1px 就回写 1px 矮的高度 ⇒ 底部按钮被切一条缝、并多出一根 5px 滚动条，
   *   而且它永远不会自我纠正（视图越矮，量出来的越矮）。1700×1080 下旧实现量出 417
   *   恰好够用，换个窗口就露馅：宿主播放器 526px 高时上限只有 398，折叠态直接少 19px。
   *
   * 现在只有两档，全部由 CSS 落地，JS 只写一个变量：
   *   quickPanelHeight = 0 → --qp-height: auto，高度跟内容走；
   *   quickPanelHeight > 0 → --qp-height: <n>px，高度固定，超过 --qp-max-h 由 CSS 卡住。
   * 高度固定 ⇒ 展开手风琴时面板高度不变 ⇒ 底边不动、顶边也不动，
   * 因此 v0.5.4 那套「钉顶边 + rAF 逐帧咬合内容高」可以整套删掉（已删）。
   * 内容超出固定高度时只允许**面板内**滚动，绝不自动 scrollTop / scrollIntoView ——
   * 一自动滚，展开项上方的内容就整体上移，就是用户反馈过的「选项往上跳」。
   *
   * 口径：设置里的 quickPanelHeight 是**可视内容高**（= panel.clientHeight），
   * 而 CSS 的 height 是 border-box（上下各 1px 边框），所以要补 borderY。
   * 于是「设 429」= 内容 417 + 12px 余量；「设 520」量出来 clientHeight 就是 520。
   * 手写 CSS 覆盖 --qp-height 时给的是**盒高**（想 clientHeight = n 就写 n + 2）。
   */
  private applyQpHeight(): void {
    const panel = this.quickPanelEl;
    if (!panel) return;
    const configured = Math.round(Number(this.settings?.quickPanelHeight) || 0);
    if (!(configured > 0)) {
      panel.style.setProperty('--qp-height', 'auto');
      return;
    }
    const cs = getComputedStyle(panel);
    const borderY = (parseFloat(cs.borderTopWidth) || 0) + (parseFloat(cs.borderBottomWidth) || 0);
    panel.style.setProperty('--qp-height', `${configured + borderY}px`);
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
        /* v0.5.3：三项只读指示行（目标语言 · 场景名 · 句数）。原来这里分「目标语言」
           折叠块 + 「翻译场景」折叠块两处展示，现已合并成这一行。 */
        renderQpStatus(ICON_CHECK, `已就绪（${this.getStatusLineText(this.allSentences.length)}）`);
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

    // 0. 目标语言 / 翻译场景：v0.5.3 起面板不再有这两处控件（改为上面的只读指示行），
    //    这里无需再同步 select 与 badge。

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

    // 3. 同步推理思考深度 (Smooth Option Switcher + Badge)
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
    // 透明预设（#00000000）存不进 input，用 #000000 占位；实际值由色块直写 settings
    if (bgPicker) bgPicker.value = this.settings.bgColor === '#00000000'
      ? '#000000'
      : (this.settings.bgColor || '#0f172a');

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

    /* 4. v0.5.5：高度是配置值，内容变长（17 句 → 59 句）不再需要回写高度；
       这里重落一次变量，保证设置页刚改的 quickPanelHeight 立即生效。 */
    this.applyQpHeight();
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

    // 1. 手风琴折叠展开联动（v0.5.5：只翻状态，不再动面板高度）
    const accordionHeaders = this.shadow.querySelectorAll('.qp-accordion-header');
    accordionHeaders.forEach((header) => {
      header.addEventListener('click', (e) => {
        e.stopPropagation();
        const item = header.closest('.qp-accordion-item') as HTMLElement | null;
        if (!item) return;
        const willExpand = !item.classList.contains('expanded');

        /* v0.5.5：高度固定（quickPanelHeight）⇒ 展开时面板底边/顶边都不动，
           展开项上方元素自然不动，不再需要「抓基准 → 逐帧跟随 → 收尾校平」那一整套。
           也**不做**任何自动滚动（不 scrollTop、不 scrollIntoView）：内容超出面板高度时
           由 .qp-view 自己的 overflow-y:auto 滚动，但绝不替用户滚 —— 一自动滚，
           展开项上方的元素就整体上移，正是老问题。 */
        item.classList.toggle('expanded', willExpand);
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

    // 1.3 推理思考深度 (Smooth Option Switcher 物理弹性横滑)
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
      /* v0.5.4：切子页**不改面板高度**、也不重量 —— 高度只由主视图决定，
         这样主视图与子页的 clientHeight 恒等（用户要求「两者展开时对齐」）。
         子页内容比主视图高就让它内部 overflow-y:auto 滚，面板本身不长不缩。 */
      const styleView = this.qpViewStyleEl || (panelEl?.querySelector('.qp-view-style') as HTMLElement | null);
      /* 每次进入子页都回到顶部：第一屏必须完整看到「译文字体颜色 / 原文字体颜色」两张卡 */
      if (styleView) styleView.scrollTop = 0;
    });

    btnBackMain?.addEventListener('click', (e) => {
      e.stopPropagation();
      /* 返回主视图同样不动高度（主视图内容若有手风琴展开，高度在那边已经算好了） */
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

    /* v0.5.3：「目标语言」下拉与「翻译场景」卡片列表已从浮层移除（改为只读指示行），
       对应的 change / 事件委托 / 展开重读绑定一并不存在了。 */

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
                <!-- 品牌图标：双气泡无限符号（白色版）。20px 画布下墨迹正好 16.0×9.3，
                     与右侧 13.5px 标题、右侧 20px 收起按钮同高，不撑高 .qp-header -->
                <span class="qp-logo" style="display:inline-flex;width:24px;height:24px;align-items:center;color:#ffffff;">${ICON_BRAND}</span><span>智能字幕与翻译</span>
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

            <!-- v0.5.3：这里原本是「目标语言」「翻译场景」两个折叠块。
                 用户要求两项都删掉，只保留上面那一行只读指示（已就绪（目标语言 · 场景 · N 句））。
                 指示行不是 accordion：不可点击、无箭头、无 hover 态；
                 要改这两项请去扩展弹窗，改完 SETTINGS_UPDATED 会带着指示行一起刷新。 -->

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

            <!-- 折叠模块 3：推理思考深度 (3段平滑滑块) -->
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
