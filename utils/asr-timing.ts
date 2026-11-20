/**
 * ============================================================================
 * ASR（自动字幕）逐词/逐字时间 —— 纯逻辑层
 * ----------------------------------------------------------------------------
 * json3 里实测有 **A / B 两套互不相同** 的机制。旧版注释把歌词轨的结论
 * （「同一句反复下发加长帧」「tOffsetMs 实测全为 0」）泛化到了所有轨，是错的：
 *
 *   A 歌词轨（Mfcj1AdnzhQ，卡拉OK）：
 *     - 1238 个 event 是**同一句的重复帧**，文本逐帧加长；
 *     - tOffsetMs 全 0（14288 个 seg），拿不到官方字级时间；
 *     - pens 231 支带 fcForeColor → 已唱前缀**逐字上色**（v1 已落地，本文件不碰笔色分支）；
 *     - 逐字真实时间靠笔色帧推（见 utils/lyric-track.ts#extractLineColors）。
 *     对 A 本文件只保留「帧前缀推断」作为兜底。
 *
 *   B 普通 ASR 轨（XGxIE1hr0w4，BBC / roll-up）：
 *     - **一次给全片**：130 event = 1 个窗口定义 + 65 个文本行 + 64 个 aAppend:1
 *       的纯 "\n" 换行标记，**没有**「同一句反复下发加长帧」；
 *     - 378 个词 seg，313 个带正数 tOffsetMs，65 个是每行首词（隐含 0、不带该字段）；
 *       同 event 内偏移严格递增，反序 0 行；词间隔 79 / 320(中位) / 1121 ms；
 *     - pens = [{}] 无颜色；wsWinStyles.sdScrollDir=3、wpWinPositions.rcRows=2（roll-up）；
 *     - DOM 实测：.ytp-caption-segment 每行一个 span，词到点就把整行 textContent
 *       换成更长快照 —— 所谓「一个字蹦出来」其实是**一个词 / ASR token**，不是逐字符；
 *     - ⇒ 真实词时间**直接可读**，无需帧推断：逐字符展开 seg，**同一个词的字符共享
 *       同一个 startMs**（= 词起点），该词字符的 endMs = **下一个词的起点**
 *       （时间轴末词 = 句子 endMs）—— 渲染出来是「**整词一起亮**」，
 *       与 YouTube 的逐词高亮一致（**不是**逐字跳转）。
 *
 *   C 日文普通 ASR 轨（VyV7nxzYEqA，唯一 ja/asr 轨）—— **仅本样本实测，
 *     不外推到所有日文轨**：
 *     - 76 event = 1 个窗口定义 + 38 个文本行 + 37 个 aAppend:1 换行；
 *       275 个词 seg，237 个带正数 tOffsetMs、38 个首词隐含 0，同 event 内反序 0；
 *       词间隔 19 / 中位 360 / 最长 1480 ms；
 *     - 按文节 / 形态素切分（"夜" "の" "始まり" "さ" "、" "場" "に"），
 *       seg **无前导空格**；"[音楽]" 这类非词汇标记本身也带偏移；
 *     - pens = [{}]、roll-up 字段与英文逐字段相同 ⇒ 与 B 是同一套 tOffsetMs 机制，
 *       只是词边界与空白习惯不同（B 每段带一个前导空格，C 不带）。
 *
 * 路由优先级（buildAsrCharTimings）：
 *   1. 'offset'    —— 按句子时间范围收集**所有**相关 event，拼成一整条词时间轴，
 *      再与句子文本做半全局对齐。断句层会把多行 roll-up 文本合并成一句，
 *      只找单个 event 只能对齐前半句（BBC 样本实测 30 句仅 3 句命中，26 句退回均分）。
 *   2. 'inferred'  —— 否则退回帧前缀推断；单锚点 / 跨度 <200ms 时 coverage 强制 0（防假绿）；
 *   3. 'estimated' —— 连一个锚点都没有 → 均分兜底，coverage=0、全部 estimated=true。
 *
 * 设计约束：
 *   1. 只用于**展示**：不参与翻译、不改断句、不影响缓存键。
 *   2. 推断失败（帧不是前缀、对不上）就返回全 null，调用方退回均分估算。
 *   3. 纯函数、零 IO、零依赖，可直接单测。
 *   4. offset 分支里，词序列首尾（相邻句子被时间范围多圈进来的词）可免费跳过；
 *      句中字符一律按官方词时间，对不上的补标点标 estimated=true —— 不冒充真实时间。
 *   5. **词级口径（不再细分到字级）**：官方词只给**词起点**，本文件**原样保留**，
 *      不再把词窗口按字符数均分。同一个词的字符**共享同一个 startMs**（= 词起点），
 *      该词字符的 endMs = **下一个词的起点**（时间轴末词 = 句子 endMs）——
 *      渲染出来是「整词一起亮」，与 YouTube 的逐词高亮一致。
 *      细分**不改变时间来源**：时间仍来自官方词级数据，estimated 仍为 false。
 *   6. 收口：整句 startMs **不倒序**；**词与词之间严格递增**（同词内相等是允许的 ——
 *      那是词级共享的正常形态）。官方词时间是真值 ⇒ 收口**只微调 estimated 字**，
 *      真实字（官方词时间）**一字不改**。
 *   7. 字符口径统一为 **Array.from(text)（Unicode 码点）**：buildAsrCharTimings /
 *      inferAsrCharTimes / buildOffsetVerdict 三处一致，timings.length 恒等于
 *      Array.from(text).length（emoji 不劈成半个代理项）。
 */

import type { CharTiming } from './lyric-track';
import type { Json3CaptionData, Json3Event } from '../types';
import { removeInvisible, stripInvisible } from './invisible-text';
import { stripRuby } from './lyric-track';

/** 判定某个时间点是否是「这一句的帧 / event」允许的前后容差（ms） */
const FRAME_PAD_MS = 250;
/** 有效帧序列：至少 2 个不同锚点，且时间跨度 >= 200ms。否则不许报 coverage=1.00 假绿 */
const MIN_DISTINCT_ANCHORS = 2;
const MIN_ANCHOR_SPAN_MS = 200;
/**
 * 收集整句词时间轴时，event 的词区间与句子 [startMs, endMs] 求交的额外容差（ms）。
 * 与 FRAME_PAD_MS 一致：roll-up 轨断句层给的 s.start 可能落在句中某个词上
 * （segmentCaptionTokens 会把多行 roll-up 文本合并成一句），250ms 足以吸收首词偏移
 * 与分句取整误差；再放宽就会把相邻句子的整行词卷进候选（那部分由半全局对齐的
 * 首尾免费跳过处理，不计入 wordCount，也不冒充真实时间）。
 */
const SENTENCE_PAD_MS = 250;
/** 半全局对齐的失配代价：比「跳过词字符 + text 多出字符」(=2) 更贵，逼 DP 优先跳过而非硬凑。 */
const ALIGN_MISMATCH_COST = 3;

export interface AsrTimingResult {
  /** 与文本逐字符对齐；从未被任何帧覆盖到的位置为 null */
  firstSeenMs: (number | null)[];
  /** 命中率：有多少比例的字符拿到了真实时间（0..1）；单锚点 / 短跨度时强制 0 */
  coverage: number;
  /** 用了多少帧来推断 */
  frames: number;
  /** 不同锚点时间的个数。< 2 说明整句被压在同一时刻，上面 coverage 已强制 0 */
  distinctAnchors: number;
}

/**
 * buildAsrCharTimings 的返回值。
 * timings / coverage / frames 是既有字段（语义不变），后面几个是阶段 B 新增：
 * distinctAnchors 用来识别「coverage=1.00 假绿」，source 标明时间来自哪条路由，
 * wordCount 是命中的官方词数（offset 分支才有，其余为 0）。
 *
 * charLevel（粒度标记）：timings 的时间粒度。
 *   - true  = **字级**：每个字符有独立时间点（inferred / estimated 分支）；
 *   - false = **词级**：同一个词的字符共享同一个时间点（offset 分支）。
 * 字段名沿用 v0.5.0 初版（当时三个路由都为 true），**语义已随「字级 → 词级」回退改写**。
 *
 * wordLevel（能力标记）：时间表是否真的来自**官方词级时间戳**（ASR 轨的 seg.tOffsetMs）。
 *   - true  = source === 'offset'，确实读到了官方词级时间 → 可做「逐词」高亮；
 *   - false = inferred / estimated（帧前缀推断 / 均分兜底），没有官方词级数据。
 * 渲染层用它决定要不要走逐词高亮配色；**不要**用 charLevel 代替它
 * （charLevel=false 恰好意味着「不是字级」，而词级能力要看 wordLevel）。
 */
export interface AsrTimingVerdict {
  timings: CharTiming[];
  coverage: number;
  frames: number;
  distinctAnchors: number;
  source: 'offset' | 'inferred' | 'estimated';
  wordCount: number;
  /**
   * timings 的时间粒度：true = 字级（每字独立时间点）；false = 词级（同词字符共享时间点）。
   */
  charLevel: boolean;
  /**
   * 时间表是否来自官方词级时间戳（seg.tOffsetMs）：true = 可逐词高亮；
   * false = 帧前缀推断 / 均分兜底，没有官方词级数据。
   */
  wordLevel: boolean;
}

/** 收集到的一个官方词：携带绝对时间与所属 event 编号，供整句词时间轴排序 / 统计。 */
interface OffsetWord {
  /** 该词的原始文本（只剥零宽，保留英文 seg 的前导空格以便逐字符对齐） */
  text: string;
  /** 绝对时间 = event.tStartMs + (tOffsetMs ?? 0) */
  startMs: number;
  /** 来自第几个参与 event（用于统计 frames） */
  evId: number;
}

/** 整句词时间轴：跨 event 收集、按绝对时间升序后的官方词序列。 */
interface OffsetTimeline {
  words: OffsetWord[];
  /** 参与拼接的 event 数 */
  frames: number;
}

/**
 * 按句子时间范围收集**所有**相关 event 的官方词，拼成一整条词时间轴。
 *
 * 为什么不能只找「一个」event：segmentCaptionTokens 会把多行 roll-up 文本合并成一句，
 * s.text 长于任何单个 event、s.start 还可能落在句中某个词上；单 event 前缀匹配只能
 * 对齐前半句，其余句子全部退回均分（BBC 样本实测 30 句只有 3 句命中 offset）。
 *
 * 跳过四类「不是词 / 不贡献真实时间」的 event：
 *   - 无 segs（窗口定义 event，dDurationMs 覆盖全片）；
 *   - aAppend:1 的 roll-up 换行标记；
 *   - 纯 "\n" / 全零宽 / 空白行；
 *   - 没有任何正数 tOffsetMs 的行（首词隐含 0 不算，必须至少有一个正数偏移）。
 *
 * 区间求交：event 词区间 [tStartMs, tStartMs + max(maxOffset, dDurationMs)] 与
 * 句子 [startMs - PAD, endMs + PAD] 有交集即纳入。maxOffset 是真实词跨度，
 * dDurationMs 只作兜底 —— s.start 落在句中时，前半行靠 dur 仍能被圈进来。
 * 多圈进来的相邻句子词由后面的半全局对齐「首尾免费跳过」处理，不计入命中。
 */
const MAX_ALIGN_CELLS = 200_000;

interface PreparedOffsetEvent {
  t: number;
  evEnd: number;
  words: Array<{ text: string; startMs: number }>;
}

const offsetEventCache = new WeakMap<Json3CaptionData, PreparedOffsetEvent[]>();
const frameEventCache = new WeakMap<Json3CaptionData, Array<{ t: number; text: string }>>();

function getPreparedOffsetEvents(data: Json3CaptionData): PreparedOffsetEvent[] {
  const cached = offsetEventCache.get(data);
  if (cached) return cached;

  const events = Array.isArray(data?.events) ? (data.events as Json3Event[]) : [];
  const list: PreparedOffsetEvent[] = [];

  for (const ev of events) {
    // 窗口定义 event（无 segs / dDurationMs 覆盖全片）与滚动换行 event 在此被跳过
    if (!Array.isArray(ev?.segs) || ev.segs.length === 0) continue;
    if (ev.aAppend === 1) continue;

    // 至少有一个 seg 带正数 tOffsetMs，否则这条 event 不贡献真实时间（先判偏移，避免白做字符串拼接与正则）
    let maxOff = 0;
    for (const seg of ev.segs) {
      const off = seg?.tOffsetMs;
      if (typeof off === 'number' && Number.isFinite(off) && off > 0 && off > maxOff) {
        maxOff = off;
      }
    }
    if (maxOff <= 0) continue;

    const raw = ev.segs.map((s) => s.utf8 ?? '').join('');
    if (!stripRuby(stripInvisible(raw)).trim()) continue;

    const t = Number.isFinite(ev.tStartMs) ? ev.tStartMs : 0;
    const dur = Number.isFinite(ev.dDurationMs) ? Math.max(0, ev.dDurationMs) : 0;
    const evEnd = t + Math.max(maxOff, dur);

    const words: Array<{ text: string; startMs: number }> = [];
    for (const seg of ev.segs) {
      const w = removeInvisible(seg.utf8 ?? '');
      if (!w.trim() || /^[\r\n]+$/.test(w)) continue;
      const off =
        typeof seg.tOffsetMs === 'number' && Number.isFinite(seg.tOffsetMs) && seg.tOffsetMs >= 0
          ? seg.tOffsetMs
          : 0;
      words.push({ text: w, startMs: t + off });
    }
    if (words.length > 0) {
      list.push({ t, evEnd, words });
    }
  }

  list.sort((a, b) => a.t - b.t);
  if (data && typeof data === 'object') {
    offsetEventCache.set(data, list);
  }
  return list;
}

function getPreparedFrameEvents(data: Json3CaptionData): Array<{ t: number; text: string }> {
  const cached = frameEventCache.get(data);
  if (cached) return cached;

  const events = Array.isArray(data?.events) ? (data.events as Json3Event[]) : [];
  const byT = new Map<number, string>();
  for (const ev of events) {
    if (!Array.isArray(ev?.segs) || ev.segs.length === 0) continue;
    if (ev.aAppend === 1) continue;
    const raw = ev.segs.map((s) => s.utf8 || '').join('');
    const frameText = stripRuby(stripInvisible(raw));
    if (!frameText) continue;
    const t = Number.isFinite(ev.tStartMs) ? ev.tStartMs : 0;
    const prev = byT.get(t);
    // 同毫秒多条 event 保留更长的正文帧，避免被空/换行帧挤掉
    if (!prev || frameText.length > prev.length) {
      byT.set(t, frameText);
    }
  }

  const list = Array.from(byT.entries())
    .sort((a, b) => a[0] - b[0])
    .map(([t, text]) => ({ t, text }));
  if (data && typeof data === 'object') {
    frameEventCache.set(data, list);
  }
  return list;
}

function collectOffsetWords(
  data: Json3CaptionData,
  startMs: number,
  endMs: number
): OffsetTimeline | null {
  const prepared = getPreparedOffsetEvents(data);
  if (!prepared.length) return null;

  const lo = startMs - SENTENCE_PAD_MS;
  const hi = endMs + SENTENCE_PAD_MS;
  const words: OffsetWord[] = [];
  let frames = 0;

  for (const ev of prepared) {
    if (ev.t > hi) break; // prepared 按 t 升序，超出右边界直接中止
    if (ev.evEnd < lo) continue;

    const evId = frames++;
    for (const w of ev.words) {
      words.push({ text: w.text, startMs: w.startMs, evId });
    }
  }

  if (!words.length || frames === 0) return null;
  words.sort((a, b) => a.startMs - b.startMs);
  return { words, frames };
}

/**
 * 字符可比：大小写不敏感（断句层 autoPunctuation 会把英文句首字母大写）。
 * 只做这一项宽容，不做标点 / 空白折叠 —— 日文「、」本身是带偏移的官方词，
 * 折叠掉会把真实词时间误判成伪影。
 */
function eqChar(a: string, b: string): boolean {
  return a === b || a.toLowerCase() === b.toLowerCase();
}

/**
 * 官方词的**时间窗** `[wStart, wEnd]`。
 *
 *   wStart = 该词起点（event.tStartMs + seg.tOffsetMs）
 *   wEnd   = **下一个词的起点**（时间轴末词 = 句子 endMs）
 *
 * 词与词首尾相接 ⇒ 整句时间轴连续、**词与词之间严格递增**、不倒序。
 * 「下一个词」取的是**整条时间轴**上的下一个词（可能属于相邻句子，被 DP 首尾免费跳过），
 * 因此末词的窗会自然延伸到下一句首词 —— 那正是官方数据里「这个词说到什么时候」的真值。
 *
 * 词级口径下，**该词的全部字符共用这一只窗**：startMs = wStart、endMs = wEnd。
 */
interface OffsetWindow {
  start: number;
  end: number;
}

/** 由整句词时间轴算出每个词的窗口表。 */
function buildWordWindows(timeline: OffsetTimeline, endMs: number): OffsetWindow[] {
  const n = timeline.words.length;
  const out: OffsetWindow[] = new Array(n);
  for (let i = 0; i < n; i++) {
    const start = timeline.words[i].startMs;
    const end = i + 1 < n ? timeline.words[i + 1].startMs : endMs;
    out[i] = { start, end };
  }
  return out;
}

/**
 * 给 estimated（没对上任何官方词）的字符填时间。
 *
 * 这些字（断句层补的句末标点、跨 event 合并时插入的空格等）没有官方时间，
 * 但**不能**打乱整句的不倒序：
 *   - 夹在两个真实字之间 → 在 (prev, next) 区间内线性插值；
 *   - 句首一段 → 在 [句子起点, 第一个真实字] 区间内插值；
 *   - 句尾一段 → 紧跟最后一个真实字（1ms 步进，标点就该紧贴着上一个词）。
 *
 * 词级口径下的关键点：真实字的 startMs 是**它所属词的起点**，所以 prev / next
 * 天然就是「前一个词的起点 / 后一个词的起点」—— estimated 字只能落在两个词之间。
 * 区间不够分时**贴着 prev 排且绝不越过 next**（官方词时间是真值，不能被推后），
 * 随后由调用方的收口统一顺推。
 */
function fillEstimatedStarts(
  starts: number[],
  real: boolean[],
  n: number,
  sentenceStartMs: number
): void {
  let k = 0;
  while (k < n) {
    if (real[k]) {
      k++;
      continue;
    }
    // 找本段 estimated 的右边界
    let b = k;
    while (b < n && !real[b]) b++;
    const count = b - k; // 本段字数
    const prev = k > 0 ? starts[k - 1] : null; // 前一个真实字（k>0 时必然是真实字）
    const next = b < n ? starts[b] : null; // 后一个真实字（b<n 时必然是真实字）

    if (prev === null) {
      // 句首一段：落在 [min(句子起点, 第一个真实字), 第一个真实字] 之间，绝不大于 hi
      const hi = next as number;
      const lo = Math.min(sentenceStartMs, hi);
      const gap = hi - lo;
      for (let j = k; j < b; j++) {
        const r = j - k + 1;
        starts[j] =
          gap > count
            ? lo + Math.floor((gap * r) / (count + 1))
            : Math.min(hi, Math.max(lo, hi - 1 - (count - r)));
      }
    } else if (next === null) {
      // 句尾一段：紧跟最后一个真实字
      for (let j = k; j < b; j++) starts[j] = prev + (j - k + 1);
    } else {
      // 中间一段：在 (prev, next) 之间插值
      const gap = next - prev;
      for (let j = k; j < b; j++) {
        const r = j - k + 1;
        starts[j] =
          gap > count
            ? prev + Math.floor((gap * r) / (count + 1))
            : prev + Math.min(r, Math.max(0, gap - 1)); // 兜底：1ms 步进，但不越过 next
      }
    }
    k = b;
  }
}

/**
 * 由整句词时间轴生成**词级**时间表。
 *
 * 对齐 = 半全局（glocal）序列对齐：词序列 J 的**首尾可免费跳过**（相邻句子被时间范围
 * 多圈进来的词、断句层剔掉的 "[音楽]" 等），句子文本 T 的每个字符必须要么对上某个
 * 官方词字符（estimated=false），要么当作插入（estimated=true，补标点 / 跨 event 空格）。
 * DP 保序 ⇒ 映射到的官方词时间天然非递减。
 *
 * **词级口径（不做字级细分）**：官方数据只给词起点（seg.tOffsetMs 挂在词上）。同一个词的
 * 字符**共享同一个 startMs**（= 词起点 wStart），该词字符的 endMs = **下一个词的起点**
 * （wEnd；时间轴末词 = 句子 endMs）—— 渲染出来是「整词一起亮」，与 YouTube 的逐词
 * 高亮一致（**不是**逐字跳转）。
 *
 * 契约：timings.length === Array.from(text).length；整句 startMs **不倒序**；
 * **词与词之间严格递增**（同词内相等是允许的 —— 那是词级共享的正常形态）。
 * estimated 字符仍是 estimated（不冒充官方时间），但插在相邻两个词之间时落在
 * [前一词起点, 后一词起点) 里，保持不倒序。
 * CharTiming.source 沿用既有语义（'pen' = 官方真实时间，'estimated' = 兜底），
 * 「来源是 tOffsetMs」这件事由 AsrTimingVerdict.source='offset' 表达。
 */
function buildOffsetVerdict(
  timeline: OffsetTimeline,
  startMs: number,
  endMs: number,
  text: string
): AsrTimingVerdict | null {
  const chars = Array.from(text); // 码点口径（与 buildAsrCharTimings / inferAsrCharTimes 一致）
  const n = chars.length;
  if (n === 0) return null;

  // 展开词序列：每个字符携带所属词（wordId）。**不再细分到字级** —— 词内序号/字数用不上了。
  const J: Array<{ ch: string; wordId: number }> = [];
  for (let wordId = 0; wordId < timeline.words.length; wordId++) {
    const wchars = Array.from(timeline.words[wordId].text);
    for (let wi = 0; wi < wchars.length; wi++) {
      J.push({ ch: wchars[wi], wordId });
    }
  }
  const m = J.length;
  if (m === 0) return null;
  if (m * n > MAX_ALIGN_CELLS) return null; // 异常超长片段放弃 DP 对齐，回落估算避免主线程卡死

  const W = n + 1;
  const dp = new Float64Array((m + 1) * W);
  const dir = new Uint8Array((m + 1) * W);
  const at = (i: number, j: number) => i * W + j;

  for (let i = 0; i <= m; i++) dp[at(i, 0)] = 0; // 词序列前缀免费跳过
  for (let j = 1; j <= n; j++) dp[at(0, j)] = j; // 词序列耗尽 → 剩余字符全 insert
  for (let i = 1; i <= m; i++) {
    for (let j = 1; j <= n; j++) {
      const c = eqChar(J[i - 1].ch, chars[j - 1]) ? 0 : ALIGN_MISMATCH_COST;
      let best = dp[at(i - 1, j - 1)] + c;
      let d = 1; // 1 = 对角（对上 / 失配）
      const del = dp[at(i - 1, j)] + 1; // 跳过词字符（词有、text 无）
      if (del < best) { best = del; d = 2; }
      const ins = dp[at(i, j - 1)] + 1; // text 多出字符（text 有、词无）
      if (ins < best) { best = ins; d = 3; }
      dp[at(i, j)] = best;
      dir[at(i, j)] = d;
    }
  }

  // 词序列后缀免费跳过 → 终点取 min_i dp[i][n]
  let bestI = 0;
  let bestCost = dp[at(0, n)];
  for (let i = 1; i <= m; i++) {
    if (dp[at(i, n)] < bestCost) { bestCost = dp[at(i, n)]; bestI = i; }
  }

  // 回溯：mapJ[j] = T[j] 对上的 J 下标；-1 = text 多出的字符（estimated）
  const mapJ = new Array<number>(n).fill(-1);
  let i = bestI;
  let j = n;
  while (j > 0 && i > 0) {
    const d = dir[at(i, j)];
    if (d === 1) {
      if (eqChar(J[i - 1].ch, chars[j - 1])) {
        mapJ[j - 1] = i - 1;
      }
      i--;
      j--;
    } else if (d === 2) {
      i--;
    } else {
      j--;
    }
  }

  let realCount = 0;
  for (let k = 0; k < n; k++) if (mapJ[k] >= 0) realCount++;
  if (realCount === 0) return null; // 一个官方词都没对上 → 回落 inferred / estimated，不冒充 offset

  const matchedWordStarts = new Set<number>();
  for (let k = 0; k < n; k++) {
    if (mapJ[k] >= 0) matchedWordStarts.add(timeline.words[J[mapJ[k]].wordId].startMs);
  }
  // 准入门槛：仅碰巧撞上单个字/空格（覆盖率低且不足两个时间锚点）时不冒充官方词级时间
  if (matchedWordStarts.size < MIN_DISTINCT_ANCHORS && realCount / n < 0.5) {
    return null;
  }

  // 每个官方词的时间窗
  const win = buildWordWindows(timeline, endMs);

  // 词级：同一词的字符共享 startMs（= 词起点）；endMs = 该词窗口末尾（下一词起点）
  const starts = new Array<number>(n).fill(0);
  const wordEnds = new Array<number>(n).fill(0);
  const real = new Array<boolean>(n).fill(false);
  const usedWordIds = new Set<number>();
  for (let k = 0; k < n; k++) {
    const jIdx = mapJ[k];
    if (jIdx < 0) continue; // estimated → 稍后插值
    const e = J[jIdx];
    const w = win[e.wordId];
    starts[k] = w.start;   // ★ 词级：同词字符共享同一个 startMs
    wordEnds[k] = w.end;    // ★ 该词字符的 endMs = 下一个词的起点（末词 = 句子 endMs）
    real[k] = true;
    usedWordIds.add(e.wordId);
  }

  // estimated 字（补的标点 / 跨 event 空格）→ 在相邻两个词之间插值，保持整句不倒序
  fillEstimatedStarts(starts, real, n, startMs);

  // 收口：整句 startMs 不倒序。
  // 官方词时间是真值 ⇒ **真实字一字不改**（它们的 startMs 必须等于官方词起点）；
  // 只微调 estimated 字（我们自己补的），保证不倒序。
  for (let k = 1; k < n; k++) {
    if (real[k]) continue;
    if (starts[k] < starts[k - 1]) starts[k] = starts[k - 1];
  }

  const timings: CharTiming[] = [];
  for (let k = 0; k < n; k++) {
    // 真实字：endMs = 该词窗口末尾（下一词起点；时间轴末词 = 句子 endMs）
    // estimated 字：endMs = 下一字 startMs（末字 = 句子 endMs）
    let e: number;
    if (real[k]) {
      e = wordEnds[k];
    } else if (k + 1 < n) {
      e = starts[k + 1];
    } else {
      e = endMs;
    }
    timings.push({
      char: chars[k],
      startMs: starts[k],
      endMs: Math.max(starts[k] + 1, e),
      estimated: !real[k],
      source: real[k] ? 'pen' : 'estimated'
    });
  }

  const anchorSet = new Set<number>();
  for (const wordId of usedWordIds) anchorSet.add(timeline.words[wordId].startMs);
  const distinctAnchors = anchorSet.size;
  return {
    timings,
    coverage: distinctAnchors >= MIN_DISTINCT_ANCHORS ? realCount / n : 0,
    frames: timeline.frames,
    distinctAnchors,
    source: 'offset',
    wordCount: usedWordIds.size,
    charLevel: false,  // 词级：同词字符共享时间点（不是字级）
    wordLevel: true   // 来源是官方词级时间戳（seg.tOffsetMs）
  };
}

/**
 * 从一组 event 里推断「每个字符第一次出现的时间」。
 *
 * 字符口径：**Array.from(text)（Unicode 码点）** —— 与 buildAsrCharTimings /
 * buildOffsetVerdict 一致，firstSeenMs 的下标与字级时间表一一对应。
 *
 * @param data    原始 json3（含 events）
 * @param startMs 句子起始
 * @param endMs   句子结束
 * @param text    句子的最终文本（已剥零宽/ruby，与渲染用的字符串一致）
 */
export function inferAsrCharTimes(
  data: Json3CaptionData,
  startMs: number,
  endMs: number,
  text: string
): AsrTimingResult {
  const chars = Array.from(text); // 码点口径
  const nChars = chars.length;
  const empty: AsrTimingResult = {
    firstSeenMs: new Array(nChars).fill(null),
    coverage: 0,
    frames: 0,
    distinctAnchors: 0
  };
  if (!text || !Array.isArray(data?.events)) return empty;

  // 1. 从预索引中二分定位该句时间范围内的帧（跳过 aAppend 换行帧，避免同毫秒丢正文）
  const prepared = getPreparedFrameEvents(data);
  if (prepared.length === 0) return empty;
  const lo = startMs - FRAME_PAD_MS;
  const hi = endMs + FRAME_PAD_MS;
  let left = 0;
  let right = prepared.length;
  while (left < right) {
    const mid = (left + right) >> 1;
    if (prepared[mid].t < lo) left = mid + 1;
    else right = mid;
  }
  const inRange: Array<{ t: number; text: string }> = [];
  for (let idx = left; idx < prepared.length; idx++) {
    if (prepared[idx].t > hi) break;
    inRange.push(prepared[idx]);
  }
  if (inRange.length === 0) return empty;

  // 2. 逐帧比对：该帧文本若是「最终文本」的前缀，则它覆盖到的位置都记上首次时间
  const firstSeen: (number | null)[] = new Array(nChars).fill(null);
  let touched = 0;
  for (const ev of inRange) {
    // 只认「前缀」关系：ASR 会在句尾追加，不会改写句中（码点口径、大小写不敏感逐字比对）
    const frameChars = Array.from(ev.text);
    if (frameChars.length > nChars) continue;
    let isPrefix = true;
    for (let i = 0; i < frameChars.length; i++) {
      if (frameChars[i] !== chars[i]) { isPrefix = false; break; }
    }
    if (!isPrefix) continue;
    for (let i = 0; i < frameChars.length && i < firstSeen.length; i++) {
      if (firstSeen[i] === null) {
        firstSeen[i] = ev.t;
        touched++;
      }
    }
  }

  // 3. 保险：distinctAnchors < 2 或时间跨度 < 200ms → 判为无有效帧序列，coverage 强制 0。
  //    B 轨一次给全片时，6 帧覆盖整句却全锚在同一个 tStartMs，旧版会报 coverage=1.00
  //    的「假绿」。firstSeenMs 仍原样返回（调用方还能据此插值），只是不许谎报命中率。
  const anchored = firstSeen.filter((x): x is number => x !== null);
  const distinctAnchors = new Set(anchored).size;
  let minA = Number.POSITIVE_INFINITY;
  let maxA = Number.NEGATIVE_INFINITY;
  for (const a of anchored) {
    if (a < minA) minA = a;
    if (a > maxA) maxA = a;
  }
  const spanMs = anchored.length > 1 ? maxA - minA : 0;
  const validSequence = distinctAnchors >= MIN_DISTINCT_ANCHORS && spanMs >= MIN_ANCHOR_SPAN_MS;

  return {
    firstSeenMs: firstSeen,
    coverage: validSequence && nChars > 0 ? touched / nChars : 0,
    frames: inRange.length,
    distinctAnchors
  };
}

/**
 * 把推断结果转成 `CharTiming[]`（与官方歌词轨同一结构，渲染层不用分叉）。
 *
 * 落点规则：
 *   - 拿到真实时间的字：按它自己的 startMs
 *   - 没拿到的字：在「前一个有时间的字」与「后一个有时间的字」之间均分（插值）
 *   - 首尾缺时间的：贴到句子边界
 * 保证严格递增、无重叠、首尾对齐 —— 与 `estimateCharTimings` 的契约一致。
 *
 * 字符口径：**Array.from(text)（Unicode 码点）** —— 与 buildOffsetVerdict /
 * inferAsrCharTimes 一致；timings.length 恒等于 Array.from(text).length。
 */
export function buildAsrCharTimings(
  data: Json3CaptionData,
  startMs: number,
  endMs: number,
  text: string
): AsrTimingVerdict {
  const chars = Array.from(text); // 码点口径
  const n = chars.length;
  // 入口时间规范化：防 NaN / 负跨度向下游传播
  const safeStartMs = Number.isFinite(startMs) ? Math.max(0, startMs) : 0;
  const safeEndMs = Number.isFinite(endMs) ? Math.max(safeStartMs + 1, endMs) : safeStartMs + 1;
  startMs = safeStartMs;
  endMs = safeEndMs;

  if (n === 0) {
    return {
      timings: [],
      coverage: 0,
      frames: 0,
      distinctAnchors: 0,
      source: 'estimated',
      wordCount: 0,
      charLevel: true,  // 兜底分支本来就是字级
      wordLevel: false  // 没有官方词级时间戳
    };
  }

  // 路由 1：官方词级时间（B / C 轨）——按句子时间范围收集所有相关 event 拼成整句词时间轴，
  // 再把官方词起点原样落到字符上（**词级**：同词字符共享 startMs，见 buildOffsetVerdict）。
  // 命中即返回：offset 分支自己保证不倒序，不再走下面的插值/收口。
  const timeline = collectOffsetWords(data, startMs, endMs);
  if (timeline) {
    const offsetVerdict = buildOffsetVerdict(timeline, startMs, endMs, text);
    if (offsetVerdict) return offsetVerdict;
  }

  // 路由 2 / 3：帧前缀推断，或全无锚点时的均分兜底
  const { firstSeenMs, coverage, frames, distinctAnchors } = inferAsrCharTimes(
    data,
    startMs,
    endMs,
    text
  );

  // 已知锚点下标
  const anchors: number[] = [];
  for (let i = 0; i < n; i++) if (firstSeenMs[i] !== null) anchors.push(i);

  const starts = new Array<number>(n).fill(startMs);

  if (anchors.length === 0) {
    // 完全没推断到 → 均分（调用方可据此判 estimated）
    const step = n > 0 ? Math.max(1, Math.floor((endMs - startMs) / n)) : 0;
    for (let i = 0; i < n; i++) starts[i] = startMs + i * step;
  } else {
    // 锚点之前：从 startMs 到锚点均分
    const a0 = anchors[0];
    for (let i = 0; i < a0; i++) {
      starts[i] = a0 > 0 ? startMs + Math.floor(((firstSeenMs[a0]! - startMs) * i) / a0) : startMs;
    }
    // 锚点本身用真实值
    for (const i of anchors) starts[i] = firstSeenMs[i]!;
    // 锚点之间：线性插值
    for (let k = 0; k < anchors.length - 1; k++) {
      const a = anchors[k];
      const b = anchors[k + 1];
      const ta = firstSeenMs[a]!;
      const tb = firstSeenMs[b]!;
      const gap = b - a;
      for (let i = a + 1; i < b; i++) {
        starts[i] = ta + Math.floor(((tb - ta) * (i - a)) / gap);
      }
    }
    // 最后一个锚点之后：从锚点到 endMs 均分
    const last = anchors[anchors.length - 1];
    const rest = n - 1 - last;
    if (rest > 0) {
      const tLast = firstSeenMs[last]!;
      for (let i = last + 1; i < n; i++) {
        starts[i] = tLast + Math.floor(((endMs - tLast) * (i - last)) / (rest + 1));
      }
    }
  }

  // 收口：先夹入 [startMs, endMs]，再双向单调收口，绝不产出倒序时间轴
  const effectiveEnd = Math.max(endMs, startMs + n);
  for (let i = 0; i < n; i++) {
    if (starts[i] < startMs) starts[i] = startMs;
    if (starts[i] > effectiveEnd - (n - i)) starts[i] = effectiveEnd - (n - i);
  }
  for (let i = 1; i < n; i++) {
    if (starts[i] <= starts[i - 1]) starts[i] = starts[i - 1] + 1;
  }
  // 反向压缩：若末端越过 effectiveEnd，整体向前压紧并保持严格递增
  if (n > 0 && starts[n - 1] > effectiveEnd - 1) {
    starts[n - 1] = effectiveEnd - 1;
    for (let i = n - 2; i >= 0; i--) {
      if (starts[i] >= starts[i + 1]) starts[i] = starts[i + 1] - 1;
    }
  }

  const timings: CharTiming[] = [];
  for (let i = 0; i < n; i++) {
    const s = starts[i];
    const e = i + 1 < n ? starts[i + 1] : Math.max(s + 1, endMs);
    timings.push({
      char: chars[i],
      startMs: s,
      endMs: Math.max(s + 1, e),
      estimated: firstSeenMs[i] === null,
      source: firstSeenMs[i] === null ? 'estimated' : 'pen'
    });
  }

  const hasAnyAnchor = anchors.length > 0;
  return {
    timings,
    coverage: hasAnyAnchor ? coverage : 0,
    frames,
    distinctAnchors,
    source: hasAnyAnchor ? 'inferred' : 'estimated',
    wordCount: 0,
    charLevel: true,  // inferred / estimated 本来就是字级（每字独立时间点）
    wordLevel: false  // 没有官方词级时间戳 → 不能做逐词高亮
  };
}
