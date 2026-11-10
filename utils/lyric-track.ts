/**
 * ============================================================================
 * 歌词轨（逐词字幕）识别 + 去重合并 + 字符级时间估算 —— 纯逻辑层
 * ----------------------------------------------------------------------------
 * 背景（v0.4.3 实测事实，已复核，不要再推翻）：
 *
 *   1. 只能拿到 `/api/timedtext?…&fmt=json3`。带 `pot` 的 URL 一换 `fmt` 就
 *      返回 200 + 0 字节，**srv3 / vtt 拿不到**；
 *   2. ~~json3 里没有颜色字段（pens 只给字体/描边，颜色是播放器端渲染的）~~
 *      **v0.5.0 数据层纠正：颜色一直在 `pens[i].fcForeColor`（24 位整数）里**，
 *      而且同一 event 内**逐字**分层 —— 已唱前缀每个字符各占一支笔（颜色各异），
 *      未唱后缀整段一支 `#FEFEFE` 笔。详见第四节 readPenColor / extractLineColors；
 *   3. 该样本的 asr 轨 14288 个 seg **tOffsetMs 全为 0**，没有 seg 级字级时间
 *      （但第 2 条的笔色分层可以推出**帧级**逐字真实时间）；
 *   4. 零宽空格 U+200B 恒定 7–13 个/event，**不是逐字进度标记**；同一句在
 *      1238 个 event 里 88.5% 文本重复 → 项目按 event 切出 1166 句，实际只有
 *      62 句歌词。
 *
 * 于是本文件只做四件「诚实」的事：
 *   - `detectLyricTrack`：**加权**判定这条轨是不是歌词轨（不用单条硬阈值）；
 *   - `dedupeLyricEvents`：把 1238 event 折叠回 62 句，同时保留「哪几段时间
 *     在屏幕上显示过」——副歌会重复出现，不能把它们合成一个 130 秒的长句；
 *   - `estimateCharTimings`：没有可读锚点就**按权重估算并标记 estimated**，
 *     绝不假装拿到了字级时间；
 *   - `extractLineColors` / `attachCharColors`：读笔色得到「逐字颜色 + 真实字级
 *     时间」，有颜色才覆盖时间，没有就原样保留估算值。
 *
 * 不碰的地方：标点修补（segmenter.ts）、翻译（translator.ts）、渲染（entrypoints/）。
 * 本文件零 IO、零网络、零运行时依赖，可直接在 Node 里单测。
 */

import type { Json3CaptionData, Json3Event, Json3Pen, Json3Seg } from '../types';
import {
  countInvisible,
  hasInvisible,
  isInvisibleChar,
  removeInvisible,
  stripInvisible
} from './invisible-text';

/* ============================================================================
 * 一、歌词轨识别
 * ==========================================================================*/

export interface LyricTrackStats {
  /** event 总数（原始，未去重） */
  events: number;
  /** 去零宽后的唯一文本比 = 唯一句数 / event 数。歌词轨实测 0.05，普通 CC ≈ 1.0 */
  uniqueRatio: number;
  /** 平均 event 时长（ms）。只统计 dDurationMs > 0 的 event */
  avgEventMs: number;
  /** 不可见字符占比（原始字符口径，含被剥掉的零宽） */
  invisibleRatio: number;
  /** event 密度 = event 数 / 轨道时间跨度（秒） */
  eventsPerSec: number;
  /** 平均每个 event 的 seg 数；「看起来像逐词轨」的判据之一 */
  segsPerEvent: number;
  /** 带正数 tOffsetMs 的 seg 数；0 表示没有可用的字级时间 */
  segsWithOffset: number;
}

export interface LyricTrackSignal {
  key:
    | 'time-density'
    | 'repeat-ratio'
    | 'invisible-density'
    | 'short-event'
    | 'asr-kind'
    | 'no-char-time';
  value: number;
  hit: boolean;
  weight: number;
  /** 人话，便于日志与设置页展示 */
  detail: string;
}

export interface LyricTrackVerdict {
  isLyric: boolean;
  /** 0..1 = 命中信号权重和 / 总权重 */
  confidence: number;
  signals: LyricTrackSignal[];
  stats: LyricTrackStats;
}

/** 轨元信息。detectLyricTrack 只读不写，缺省时 asr-kind 信号恒为 false。 */
export interface LyricTrackHint {
  /** YouTubeCaptionTrack.kind：'asr' 表示自动生成 */
  kind?: string;
  /** YouTubeCaptionTrack.vssId：手动轨 `.ja`，自动轨 `a.ja` */
  vssId?: string;
}

/**
 * 权重表（总权重 13）。
 *
 * 为什么是加权而不是「任一命中即判」：
 *   - `no-char-time`（tOffsetMs 全 0）在**很多正常 CC 轨**上也成立，单独用它判
 *     会把普通字幕误判成歌词轨；
 *   - `asr-kind` 同理，自动生成的字幕到处都是。
 *   所以这两个低价值信号只给 1–2 分，只有「文本高度重复 + 密 + 短 + 满屏零宽」
 *   这类**组合**才能把 confidence 推过 0.6。
 */
const SIGNAL_WEIGHTS = {
  'time-density': 3,
  'repeat-ratio': 3,
  'invisible-density': 2,
  'short-event': 2,
  'asr-kind': 1,
  'no-char-time': 2
} as const;

const TOTAL_WEIGHT = Object.values(SIGNAL_WEIGHTS).reduce((a, b) => a + b, 0);

/** 阈值（写在此处集中管理，便于日后调参时一处改、指标可复算） */
const THRESHOLDS = {
  eventsPerSec: 3,
  uniqueRatio: 0.35,
  invisibleRatio: 0.03,
  avgEventMs: 900,
  /** 「看起来是逐词轨」的最低 seg/event 密度 */
  segsPerEvent: 3,
  /** 判定通过线 */
  confidence: 0.6,
  minHits: 3
} as const;

/** 把 json3 的一个 event 拼成原始文本（未清洗）。 */
function eventRawText(ev: Json3Event): string {
  const segs = ev.segs;
  if (!segs || segs.length === 0) return '';
  let out = '';
  for (const seg of segs) out += seg?.utf8 ?? '';
  return out;
}

/**
 * vssId 是否指向自动生成（asr）轨。
 *
 * 实测口径修正：YouTube 的 vssId 是**前缀**形式 —— 手动轨 `.ja`、自动轨 `a.ja`
 * （见 docs 里的 info.json 探针结果）。任务书写的「以 `.a` 结尾」在真实数据里
 * 不成立，所以这里两种形态都兼容：`^a\.` 与 `\.a$`。
 */
function isAsrVssId(vssId?: string): boolean {
  if (!vssId) return false;
  return /^a\./.test(vssId.trim()) || /\.a$/.test(vssId.trim());
}

/**
 * 判定一条 json3 轨是不是歌词轨（逐词/卡拉OK 轨）。
 *
 * 设计取舍：
 *   - 空轨 → isLyric=false、confidence=0，不抛错（上游可能拿到 0 字节响应）；
 *   - 全程不做 IO，也不依赖「视频时长」这类外部信息（直播/切片拿不到）；
 *   - `eventsPerSec` 的分母是**轨道自身时间跨度**（maxEnd − minStart），
 *     不是视频总长。实测样本：跨度 214.0s → 5.79 events/s（任务书按视频
 *     241s 算得 5.14，两者都远大于阈值 3，结论一致）。
 */
export function detectLyricTrack(
  data: Json3CaptionData,
  hint: LyricTrackHint = {}
): LyricTrackVerdict {
  const events = Array.isArray(data?.events) ? data.events : [];
  const n = events.length;

  if (n === 0) {
    const stats: LyricTrackStats = {
      events: 0,
      uniqueRatio: 0,
      avgEventMs: 0,
      invisibleRatio: 0,
      eventsPerSec: 0,
      segsPerEvent: 0,
      segsWithOffset: 0
    };
    return {
      isLyric: false,
      confidence: 0,
      signals: buildSignals(stats, hint, false),
      stats
    };
  }

  const uniqueTexts = new Set<string>();
  let rawChars = 0;
  let invisibleChars = 0;
  let segCount = 0;
  let segsWithOffset = 0;
  let durSum = 0;
  let durCount = 0;
  let minStart = Number.POSITIVE_INFINITY;
  let maxEnd = 0;

  for (const ev of events) {
    const raw = eventRawText(ev);
    rawChars += raw.length;
    invisibleChars += countInvisible(raw);
    uniqueTexts.add(stripInvisible(raw));

    const segs = ev.segs ?? [];
    segCount += segs.length;
    for (const seg of segs) {
      const off = seg?.tOffsetMs;
      if (typeof off === 'number' && Number.isFinite(off) && off > 0) segsWithOffset++;
    }

    const start = Number.isFinite(ev.tStartMs) ? ev.tStartMs : 0;
    const dur = Number.isFinite(ev.dDurationMs) ? ev.dDurationMs : 0;
    if (dur > 0) {
      durSum += dur;
      durCount++;
    }
    if (start < minStart) minStart = start;
    if (start + dur > maxEnd) maxEnd = start + dur;
  }

  const spanSec = (maxEnd - minStart) / 1000;
  const stats: LyricTrackStats = {
    events: n,
    uniqueRatio: uniqueTexts.size / n,
    avgEventMs: durCount > 0 ? durSum / durCount : 0,
    invisibleRatio: rawChars > 0 ? invisibleChars / rawChars : 0,
    eventsPerSec: spanSec > 0 ? n / spanSec : 0,
    segsPerEvent: segCount / n,
    segsWithOffset
  };

  const signals = buildSignals(stats, hint, true);
  const hitWeight = signals.reduce((acc, s) => acc + (s.hit ? s.weight : 0), 0);
  const hits = signals.filter((s) => s.hit).length;
  const confidence = hitWeight / TOTAL_WEIGHT;

  return {
    isLyric: confidence >= THRESHOLDS.confidence && hits >= THRESHOLDS.minHits,
    confidence,
    signals,
    stats
  };
}

function buildSignals(
  stats: LyricTrackStats,
  hint: LyricTrackHint,
  hasData: boolean
): LyricTrackSignal[] {
  const asrKind = hint.kind === 'asr' || isAsrVssId(hint.vssId);
  const noCharTime =
    hasData && stats.segsPerEvent >= THRESHOLDS.segsPerEvent && stats.segsWithOffset === 0;

  return [
    {
      key: 'time-density',
      value: stats.eventsPerSec,
      hit: stats.eventsPerSec > THRESHOLDS.eventsPerSec,
      weight: SIGNAL_WEIGHTS['time-density'],
      detail: `event 密度 ${stats.eventsPerSec.toFixed(2)} 个/秒（阈值 >${THRESHOLDS.eventsPerSec}；歌词轨实测 5–6，普通 CC 约 0.5–1.2）`
    },
    {
      key: 'repeat-ratio',
      value: stats.uniqueRatio,
      hit: stats.uniqueRatio < THRESHOLDS.uniqueRatio,
      weight: SIGNAL_WEIGHTS['repeat-ratio'],
      detail: `去零宽后唯一句占比 ${(stats.uniqueRatio * 100).toFixed(1)}%（阈值 <${THRESHOLDS.uniqueRatio * 100}%；歌词轨实测 5.0%）`
    },
    {
      key: 'invisible-density',
      value: stats.invisibleRatio,
      hit: stats.invisibleRatio > THRESHOLDS.invisibleRatio,
      weight: SIGNAL_WEIGHTS['invisible-density'],
      detail: `不可见字符占比 ${(stats.invisibleRatio * 100).toFixed(1)}%（阈值 >${THRESHOLDS.invisibleRatio * 100}%；歌词轨实测 22.9%）`
    },
    {
      key: 'short-event',
      value: stats.avgEventMs,
      hit: stats.avgEventMs > 0 && stats.avgEventMs < THRESHOLDS.avgEventMs,
      weight: SIGNAL_WEIGHTS['short-event'],
      detail: `平均 event 时长 ${Math.round(stats.avgEventMs)}ms（阈值 <${THRESHOLDS.avgEventMs}ms；歌词轨实测 370ms，普通 CC 2000ms 以上）`
    },
    {
      key: 'asr-kind',
      value: asrKind ? 1 : 0,
      hit: asrKind,
      weight: SIGNAL_WEIGHTS['asr-kind'],
      detail: asrKind
        ? `轨类型为自动生成（kind=${hint.kind ?? '-'} / vssId=${hint.vssId ?? '-'}）`
        : `轨类型不是自动生成（kind=${hint.kind ?? '-'} / vssId=${hint.vssId ?? '-'}）`
    },
    {
      key: 'no-char-time',
      value: stats.segsWithOffset,
      hit: noCharTime,
      weight: SIGNAL_WEIGHTS['no-char-time'],
      detail: noCharTime
        ? `平均 ${stats.segsPerEvent.toFixed(1)} seg/event 却没有任何正数 tOffsetMs —— 看着像逐词轨、实际没有字级时间`
        : `字级偏移可用或 seg 密度不足（${stats.segsWithOffset} 个 seg 带正数 tOffsetMs，平均 ${stats.segsPerEvent.toFixed(1)} seg/event）`
    }
  ];
}

/* ============================================================================
 * 一之二、「当前字高亮」检测（v0.5.0 新增）
 * ==========================================================================*/

/**
 * 是否存在「当前字高亮」（卡拉OK 逐字/逐词变色）。
 *
 * 判定依据是 **pPenId 着色笔分组**，不是零宽空格 —— 这一点是实测纠正过的：
 * 同一句的几十帧里，零宽空格的**位置完全不变**（如 `[0,0,0,1,32,33,33]`），
 * 它只是句首/句尾的装饰标记，不携带任何进度信息。
 *
 * 真正的进度在笔上：同一个 `tStartMs` 会下发**两条文本相同、笔组不同**的 event
 * （实测 `(3,4)` 与 `(5,6)` 成对出现），一条画"已唱"、一条画"未唱"，
 * 已唱部分随帧变长（`O` → `Oka` → `Oka be`），播放器据此逐字着色。
 *
 * 判据：「成对的同文本 event + 笔组不同」。
 *   - 该样本：612 个时间点全部成对、着色笔 20+ 种 → `true`；
 *   - 普通 CC：每个 tStartMs 只有一条 event，或不带 pPenId → `false`。
 */
/**
 * 是否存在「当前字高亮」（卡拉OK 逐字/逐词变色）。
 *
 * ⚠️ v0.5.0 修正记录：第一版判据是**错的**，留在这里免得再走一遍。
 *
 * 第一版把「同一 tStartMs 下发两条同文本、`pPenId` 不同的 event」当成已唱/未唱。
 * 实际拆开看：文本**完全相同**、seg 切分也完全相同，只有笔号整体 +2（`(3,4)` 与 `(5,6)`）
 * —— 那是「正文 / 次要样式」两套渲染，不是逐字进度。
 * 真正说明笔号含义的是 ruby 行：`反` 用 99、`(` 用 100、`はん` 用 101 ——
 * **笔号区分的是字符角色（正文 / 注音括号 / 假名），不是时间**。
 *
 * 能证明「当前字高亮」的只有一种形态：同一时刻两条 event **文本互补**
 * （一条是另一条的前缀，合起来才是一整句）且笔组不同 —— 那才代表
 * 「已唱部分 / 未唱部分」被拆开下发，播放器据此逐字着色。
 *
 * 实测该样本：同文本双套 606 个（排除），文本互补只有 6 个、占比 1% → **判定关闭**。
 * 也就是说这条轨**没有**逐字高亮，之前自动开启是误判。
 */
export interface KaraokeHighlightVerdict {
  hasHighlight: boolean;
  /** 同一 tStartMs 上「文本互补且笔组不同」的成对数（= 已唱/未唱被拆开下发） */
  complementaryEvents: number;
  /** 同一 tStartMs 上「文本相同但笔组不同」的成对数（= 双套样式，不算高亮） */
  sameTextPairs: number;
  /** 该轨出现过的不同 pPenId 数量 */
  distinctPens: number;
  detail: string;
}

export function detectKaraokeHighlight(data: Json3CaptionData): KaraokeHighlightVerdict {
  const events: Json3Event[] = (data?.events || []).filter(
    (e: Json3Event) => Array.isArray(e?.segs) && (e.segs as Json3Seg[]).length > 0
  );
  if (events.length === 0) {
    return {
      hasHighlight: false,
      complementaryEvents: 0,
      sameTextPairs: 0,
      distinctPens: 0,
      detail: '无有效 event'
    };
  }

  const pens = new Set<number>();
  const byTime = new Map<number, Array<{ text: string; pen: string }>>();

  for (const e of events) {
    const segs = (e.segs || []) as Json3Seg[];
    // 与去重同一口径：先剥零宽与 ruby 再比较，否则注音会让"互补"永远判不成立
    const text = stripRuby(stripInvisible(segs.map((s) => s.utf8 || '').join('')));
    const penSet = new Set<number>();
    for (const s of segs) {
      const p = (s as Json3Seg & { pPenId?: number }).pPenId;
      if (typeof p === 'number') {
        penSet.add(p);
        pens.add(p);
      }
    }
    const key = [...penSet].sort((a, b) => a - b).join(',');
    const t = e.tStartMs ?? 0;
    const list = byTime.get(t);
    if (list) list.push({ text, pen: key });
    else byTime.set(t, [{ text, pen: key }]);
  }

  let complementary = 0;
  let sameText = 0;
  for (const list of byTime.values()) {
    if (list.length < 2) continue;
    const texts = [...new Set(list.map((x) => x.text))].filter(Boolean);
    const penKeys = new Set(list.map((x) => x.pen));
    if (penKeys.size < 2) continue;
    if (texts.length === 1) {
      sameText++;
      continue;
    }
    // 互为前缀 → 已唱 / 未唱分区
    let isComplementary = false;
    for (let a = 0; a < texts.length && !isComplementary; a++) {
      for (let b = a + 1; b < texts.length; b++) {
        if (texts[a].startsWith(texts[b]) || texts[b].startsWith(texts[a])) {
          isComplementary = true;
          break;
        }
      }
    }
    if (isComplementary) complementary++;
  }

  const ratio = complementary / Math.max(1, byTime.size);
  const hasHighlight = complementary >= 5 && ratio >= 0.2 && pens.size >= 2;
  return {
    hasHighlight,
    complementaryEvents: complementary,
    sameTextPairs: sameText,
    distinctPens: pens.size,
    detail: `互补成对 ${complementary}/${byTime.size}（${(ratio * 100).toFixed(0)}%）、同文本双套 ${sameText}、着色笔 ${pens.size} 种`
  };
}

/* ============================================================================
 * 二、去重与合并
 * ==========================================================================*/

/** 屏幕上的一段连续显示（副歌重复出现时会有多段）。 */
export interface LyricDisplay {
  startMs: number;
  endMs: number;
  /** 这一段里有多少个 karaoke 帧（同一句的不同着色状态） */
  frameCount: number;
}

export interface LyricLine {
  /** 比较键：去零宽 + 压缩空白 + 去尾标点 */
  key: string;
  /** 该键下最长的文本（保留标点，标点修补归断句层） */
  text: string;
  /** 最早出现时间 */
  startMs: number;
  /** **第一段显示**的结束时间（不是所有出现的并集，否则副歌会变成 130 秒长句） */
  endMs: number;
  /** 所有出现的 tStartMs（含同一毫秒的重复帧），升序 */
  occurrences: number[];
  /** 所有连续显示段，升序；供「重复行折叠」与调试 */
  displays: LyricDisplay[];
  /** 归入本行的 event 数 */
  eventCount: number;
}

export interface LyricDedupeStats {
  inputEvents: number;
  /** 文本被剥成空串而丢弃的 event 数（纯零宽帧） */
  skippedEmpty: number;
  lines: number;
  displays: number;
  /** 折叠率 = 1 − lines / inputEvents */
  collapsedRatio: number;
}

export interface LyricDedupeResult {
  lines: LyricLine[];
  stats: LyricDedupeStats;
}

/**
 * 相邻显示窗口之间留的间隙（ms）。
 * 前一段在下一段开始前这么多毫秒收尾，避免两行同时高亮、也避免"上一句还挂着"。
 */
export const DISPLAY_TAIL_GAP_MS = 80;

/**
 * 比较键用的「尾标点」集合。只去**尾部**，不动句中标点 ——
 * 句中标点参与断句，动它会越界到断句层。
 */
const TRAILING_PUNCT_RE =
  /[\s。、，,.!！?？…‥·・~〜～\-—–_=+*#@:：;；'"“”‘’「」『』【】()（）\[\]{}〈〉《》<>]+$/u;

/** 文本 → 比较键。跨行去重的唯一依据。 */
export function lyricKeyOf(text: string): string {
  return stripRuby(stripInvisible(text)).replace(TRAILING_PUNCT_RE, '');
}

/**
 * 剥离振假名（ruby）注音。
 *
 * YouTube 的日语歌词轨把假名注音**内联**在正文里：`反(はん)射(しゃ)るface`。
 * 在数据层面它是真实文本片段（`pPenId` 99=正文、100/103=括号、101/104=假名），
 * 不剥离就会把「はん」「しゃ」当正文送进翻译 —— 这是"字幕对不上内容"的主因之一：
 * 译文里混着读音，语义被稀释，长句尤其明显。
 *
 * 只剥「一个汉字 + 括号内全是假名（1~6 字）」这一种形态：
 *   - `反(はん)射(しゃ)るface` → `反射するface`
 *   - `もっと上(うえ) pop star` → `もっと上 pop star`
 *   - `(Yeah)` / `(20)` / `東京(とうきょう)タワー` 里括号非纯假名的**一律不动**
 *   - 必须紧跟汉字，避免误伤英文句尾的普通括号
 */
const RUBY_RE = /([\u4e00-\u9fff])[（(][\u3040-\u30ff\u30fc]{1,6}[）)]/gu;

export function stripRuby(text: string): string {
  return text.replace(RUBY_RE, '$1');
}

/**
 * 把 karaoke 轨折叠成「逻辑句」。
 *
 * 规则：
 *   1. 比较键 = 去零宽 + 压缩空白 + 去尾标点（`lyricKeyOf`）；
 *   2. 同键取**最长文本** + **最早 tStartMs**；
 *   3. 所有出现时间点收进 `occurrences`；
 *   4. **连续**同键帧算「一段显示」（`displays`）。副歌在 20s 和 200s 各出现
 *      一次时是同键但不连续 → 两段。这样 `endMs` 不会被撑成整首歌那么长。
 *
 * 实测：1238 event → 62 行 / 143 段显示。
 */
export function dedupeLyricEvents(data: Json3CaptionData): LyricDedupeResult {
  const events = Array.isArray(data?.events) ? data.events : [];
  const byKey = new Map<string, LyricLine>();
  let skippedEmpty = 0;
  /** 上一帧的键与所属行，用于「连续段」判定（只认紧邻） */
  let prevKey: string | null = null;
  let prevLine: LyricLine | null = null;

  for (const ev of events) {
    // 先去零宽、再剥 ruby 注音 —— 顺序不能反：注音括号之间可能夹着零宽
    const text = stripRuby(stripInvisible(eventRawText(ev)));
    const key = lyricKeyOf(text);

    if (!key) {
      // 纯零宽帧没有文本，不建行；同时打断连续段（它确实占据了一段时间）
      skippedEmpty++;
      prevKey = null;
      prevLine = null;
      continue;
    }

    const start = Number.isFinite(ev.tStartMs) ? ev.tStartMs : 0;
    const dur = Number.isFinite(ev.dDurationMs) && ev.dDurationMs > 0 ? ev.dDurationMs : 0;
    const end = start + dur;

    let line = byKey.get(key);
    if (!line) {
      line = { key, text, startMs: start, endMs: end, occurrences: [], displays: [], eventCount: 0 };
      byKey.set(key, line);
    } else if (text.length > line.text.length) {
      line.text = text;
    }

    line.occurrences.push(start);
    line.eventCount++;

    if (prevKey === key && prevLine === line && line.displays.length > 0) {
      const d = line.displays[line.displays.length - 1];
      if (end > d.endMs) d.endMs = end;
      d.frameCount++;
    } else {
      line.displays.push({ startMs: start, endMs: end, frameCount: 1 });
    }

    prevKey = key;
    prevLine = line;
  }

  for (const line of byKey.values()) {
    line.occurrences.sort((a, b) => a - b);
    line.displays.sort((a, b) => a.startMs - b.startMs);
    line.startMs = line.occurrences[0];
    line.endMs = line.displays[0].endMs;
  }

  const lines = [...byKey.values()].sort(
    (a, b) => a.startMs - b.startMs || a.key.localeCompare(b.key)
  );

  // ── 后处理：相邻显示窗口不许重叠 ──
  // ASR 轨的 endMs 来自滚动窗口的存活时间，会与下一句的开头撞上（实测 45/142 段重叠）。
  // 重叠时两行同时高亮、且前一句停在屏幕上过久（实测最长 8008ms，实际只唱 2~3 秒），
  // 这正是"字幕对不上内容"的观感来源。统一「前一段在下一段开始前 80ms 收尾」。
  const allDisplays: LyricDisplay[] = [];
  for (const l of lines) allDisplays.push(...l.displays);
  allDisplays.sort((a, b) => a.startMs - b.startMs);
  for (let i = 0; i < allDisplays.length - 1; i++) {
    const cur = allDisplays[i];
    const next = allDisplays[i + 1];
    const maxEnd = next.startMs - DISPLAY_TAIL_GAP_MS;
    if (cur.endMs > maxEnd) cur.endMs = Math.max(cur.startMs + 1, maxEnd);
  }

  return {
    lines,
    stats: {
      inputEvents: events.length,
      skippedEmpty,
      lines: lines.length,
      displays: lines.reduce((acc, l) => acc + l.displays.length, 0),
      collapsedRatio: events.length > 0 ? 1 - lines.length / events.length : 0
    }
  };
}

/**
 * 把折叠结果还原成下游认识的 `Json3CaptionData`（下游一行都不用改）。
 *
 * **一段显示 = 一个 event**，所以副歌重复出现会产出多个同文本 event
 * （实测 62 行 → 143 个 event），而不是每行一个。
 * 若需要「每行只留第一条」，传 `perLine: true`。
 */
export function toCaptionData(
  lines: LyricLine[],
  options: { perLine?: boolean } = {}
): Json3CaptionData {
  const events: Json3Event[] = [];
  for (const line of lines) {
    const displays = options.perLine ? line.displays.slice(0, 1) : line.displays;
    for (const d of displays) {
      events.push({
        tStartMs: d.startMs,
        dDurationMs: Math.max(0, d.endMs - d.startMs),
        segs: [{ utf8: line.text }]
      });
    }
  }
  events.sort((a, b) => a.tStartMs - b.tStartMs);
  return { wireMagic: 'pb3', events };
}

/* ============================================================================
 * 三、字符级时间估算
 * ==========================================================================*/

export interface CharTiming {
  /** 一个字符；真实偏移不足以逐字切分时可能是整段文本（见 estimated 说明） */
  char: string;
  startMs: number;
  endMs: number;
  /** true = 估算值（没有真实字级时间）；false = 来自 seg.tOffsetMs 或着色帧 */
  estimated: boolean;
  /**
   * 该字的颜色（`#RRGGBB`）。只有 `attachCharColors` 会写，缺省 = 没有笔色
   * （普通 CC，或该字从未被着色）。
   */
  color?: string;
  /**
   * 颜色/时间的来源：
   *   - `'pen'` = 从 json3 `pens[].fcForeColor` 读到（真实数据）；
   *   - `'estimated'` = 没有颜色，时间仍是 `estimateCharTimings` 的估算值。
   * 缺省 = 这个轴不参与颜色逻辑（例如带真实 tOffsetMs 的普通 ASR 轨）。
   */
  source?: 'pen' | 'estimated';
}

export interface CharTimingInput {
  /** 已清洗过的整句文本 */
  text: string;
  startMs: number;
  endMs: number;
  /** 可选：带真实 tOffsetMs 的 segs。首词可缺省（隐含 0），但需存在正数偏移才走真实分支 */
  segs?: Json3Seg[];
}

/**
 * 相对权重：CJK 1.0 / 拉丁字母 0.55 / 数字 0.6 / 空格 0.25 / 标点 0.15。
 *
 * 依据：歌词里一个汉字占的时值约等于两个拉丁字母；标点与空格只占据留、
 * 不占据发声时长，所以给最低权重。这组数字只影响「同一句内如何切分」，
 * 不影响句子边界 —— 句子边界始终来自 event 的 tStartMs/dDurationMs。
 */
export const CHAR_WEIGHTS = {
  cjk: 1.0,
  latin: 0.55,
  digit: 0.6,
  space: 0.25,
  punct: 0.15
} as const;

/** 过短句：不逐字（否则「字闪一下」），整句一个时间片 */
const MIN_SPAN_FOR_CHARS_MS = 400;
const MIN_CHARS_FOR_SPLIT = 3;

const WHITESPACE_CHAR_RE = /[\s\u3000]/;
const DIGIT_CHAR_RE = /[0-9０-９]/;
/** \p{P} 标点 + \p{S} 符号（含全角 ～ 与货币/数学符号） */
const PUNCT_CHAR_RE = /[\p{P}\p{S}]/u;
/** 假名 / 汉字 / 谚文 / CJK 符号与兼容区（不含 U+3000，它归空格） */
const CJK_CHAR_RE =
  /[\u2E80-\u2EFF\u3040-\u30FF\u31F0-\u31FF\u3400-\u4DBF\u4E00-\u9FFF\uF900-\uFAFF\uAC00-\uD7AF]/;

/**
 * 单个字符的权重。判定顺序很关键：先空格 → 再数字 → 再标点 → 再 CJK → 其余按拉丁。
 * 顺序错会让 `。`（U+3002，落在 CJK 符号区）拿到 1.0。
 */
export function charWeight(ch: string): number {
  if (!ch) return 0;
  if (WHITESPACE_CHAR_RE.test(ch)) return CHAR_WEIGHTS.space;
  if (DIGIT_CHAR_RE.test(ch)) return CHAR_WEIGHTS.digit;
  if (PUNCT_CHAR_RE.test(ch)) return CHAR_WEIGHTS.punct;
  if (CJK_CHAR_RE.test(ch)) return CHAR_WEIGHTS.cjk;
  return CHAR_WEIGHTS.latin;
}

/** 按码点切分（emoji 不会被劈成两个半字符）。 */
function splitChars(text: string): string[] {
  return Array.from(text);
}

/**
 * 权重分配器：把 `span` 毫秒按权重分给 `n` 个字符。
 *
 * 约束（全部为硬约束，测试逐条断言）：
 *   - 每片 ≥ 1ms（因此边界**严格**递增）；
 *   - 总和**精确**等于 span（不留缝隙、不越界）；
 *   - 首片 start = startMs，末片 end = endMs。
 *
 * 做法：每片先给 1ms，剩余 `span − n` 按最大余数法分配。这样既不会出现
 * 0ms 的空片（那会让渲染层在同一个 tick 里连续写两次），也不用浮点累加。
 */
function allocateByWeight(weights: number[], span: number): number[] {
  const n = weights.length;
  const durs = new Array<number>(n).fill(1);
  let remaining = span - n;
  if (remaining <= 0) return durs;

  const totalW = weights.reduce((a, b) => a + b, 0) || n;
  const quotas = weights.map((w) => (remaining * w) / totalW);
  const fracs: Array<{ i: number; frac: number }> = [];
  let used = 0;
  for (let i = 0; i < n; i++) {
    const base = Math.floor(quotas[i]);
    durs[i] += base;
    used += base;
    fracs.push({ i, frac: quotas[i] - base });
  }

  let leftover = remaining - used;
  if (leftover > 0) {
    fracs.sort((a, b) => b.frac - a.frac || a.i - b.i);
    for (let k = 0; k < leftover; k++) durs[fracs[k % n].i]++;
  }
  return durs;
}

/** 由各片时长生成连续的 CharTiming 列表。 */
function buildTimings(
  chars: string[],
  durs: number[],
  startMs: number,
  estimated: boolean
): CharTiming[] {
  const out: CharTiming[] = [];
  let cursor = startMs;
  for (let i = 0; i < chars.length; i++) {
    const end = cursor + durs[i];
    out.push({ char: chars[i], startMs: cursor, endMs: end, estimated });
    cursor = end;
  }
  return out;
}

/**
 * 真实字级偏移分支：仅在**存在官方词级时间**时启用。
 *
 * v0.5.0 阶段 B 修正（普通 ASR 轨 `XGxIE1hr0w4` 实测）：
 *   - 每行**首词不带 `tOffsetMs`**（隐含 0），旧版对每个 seg 都要求
 *     `typeof tOffsetMs === 'number'`，于是 313 个官方词时间被整条丢弃 →
 *     明明有真实词时间却整句 `estimated=true`。
 *   - 现在缺失字段按 0 处理；**显式给出但 < 0 / 非有限数 / 非 number 仍整条拒绝**。
 *
 * 补 0 后的两道自洽保险（否则会引入另一种假绿或倒序）：
 *   1. 至少有一个**正数**偏移 —— 全 0 / 全缺失的轨（歌词轨 A 就是全 0）
 *      不冒充「有真实词时间」，仍走估算；
 *   2. 偏移序列必须**非递减** —— `gEnd` 取下一个 seg 的偏移，若补 0 落在
 *      中间位置造成倒序，宁可整条退回估算，也不产出重叠/倒序的时间片。
 *
 * 诚实边界：tOffsetMs 只给出「这一段 seg 从哪一刻开始」，seg 内含多个字符时
 * 段内仍是估算。段内可切则按权重切；段内切不动（span < 字符数）**不伪造字边界**，
 * 直接把整段文本当作一个 CharTiming 返回（char 是多个字符的字符串）。
 */
function timingsFromRealSegs(
  segs: Json3Seg[],
  startMs: number,
  endMs: number
): CharTiming[] | null {
  if (!segs.length) return null;

  // 1) 归一化偏移：缺失 = 0（仅每行首词会缺）；显式非法值 = 整条拒绝
  const offs: number[] = [];
  for (const seg of segs) {
    const off = seg?.tOffsetMs;
    if (off === undefined || off === null) {
      offs.push(0);
      continue;
    }
    if (typeof off !== 'number' || !Number.isFinite(off) || off < 0) return null;
    offs.push(off);
  }

  // 2) 至少有一个正数偏移才算真有官方词时间（防「全 0 假绿」）
  if (!offs.some((o) => o > 0)) return null;
  // 3) 偏移非递减，保证 gEnd >= gStart、相邻 group 不倒序不重叠
  for (let i = 1; i < offs.length; i++) {
    if (offs[i] < offs[i - 1]) return null;
  }

  const groups: Array<{ text: string; startMs: number; endMs: number }> = [];
  for (let i = 0; i < segs.length; i++) {
    const text = removeInvisible(segs[i].utf8 ?? '');
    if (!text) continue;
    const gStart = startMs + offs[i];
    // 下一个 seg 的偏移用归一化后的值：缺失（末词之后）按 0 时不能小于 gStart
    const gEnd =
      i + 1 < offs.length
        ? Math.max(gStart, startMs + offs[i + 1])
        : Math.max(gStart, endMs);
    groups.push({ text, startMs: gStart, endMs: Math.max(gStart, gEnd) });
  }
  if (!groups.length) return null;

  const out: CharTiming[] = [];
  for (const g of groups) {
    const chars = splitChars(g.text);
    const span = g.endMs - g.startMs;
    if (chars.length === 1 || span <= chars.length) {
      out.push({
        char: chars.length === 1 ? chars[0] : g.text,
        startMs: g.startMs,
        endMs: g.endMs,
        estimated: false
      });
      continue;
    }
    const durs = allocateByWeight(chars.map(charWeight), span);
    out.push(...buildTimings(chars, durs, g.startMs, false));
  }
  return out;
}

/**
 * 估算一句里每个字符的起止时间。
 *
 * 优先级：
 *   1. segs 带官方词级时间（首词可缺省隐含 0，至少一个正数偏移）→ 用真实值，`estimated: false`；
 *   2. 过短句（时长 < 400ms 或字符数 < 3）→ 整句一个时间片，`estimated: true`；
 *   3. 其余 → 按 `CHAR_WEIGHTS` 归一化分配，`estimated: true`。
 *
 * 无论走哪条分支，返回值在**时间上都是连续、无重叠、严格递增**的，且首尾与
 * 句边界（startMs / endMs）对齐 —— 渲染层可以放心按 index 推进。
 */
export function estimateCharTimings(input: CharTimingInput): CharTiming[] {
  const startMs = Number.isFinite(input.startMs) ? input.startMs : 0;
  const endMs = Number.isFinite(input.endMs) ? Math.max(startMs, input.endMs) : startMs;
  const text = input.text ?? '';

  if (input.segs && input.segs.length > 0) {
    const real = timingsFromRealSegs(input.segs, startMs, endMs);
    if (real && real.length > 0) return real;
  }

  const chars = splitChars(text);
  if (chars.length === 0) return [];

  const span = endMs - startMs;
  if (span <= 0 || span < MIN_SPAN_FOR_CHARS_MS || chars.length < MIN_CHARS_FOR_SPLIT) {
    return [{ char: text, startMs, endMs, estimated: true }];
  }
  if (span < chars.length) {
    // 极端兜底：每字符连 1ms 都分不到，就不逐字（保证严格单调优先）
    return [{ char: text, startMs, endMs, estimated: true }];
  }

  const durs = allocateByWeight(chars.map(charWeight), span);
  return buildTimings(chars, durs, startMs, true);
}

/**
 * 便捷入口：把 `dedupeLyricEvents` 的每一行 + 每一段显示批量算出字符时间。
 * 渲染层只要拿到 `LyricLine` 就能直接画卡拉OK。
 */
export function buildLineCharTimings(
  line: LyricLine,
  display: LyricDisplay
): CharTiming[] {
  return estimateCharTimings({
    text: line.text,
    startMs: display.startMs,
    endMs: display.endMs
  });
}

/* ============================================================================
 * 四、笔色：逐字颜色 + 真实字级时间（v0.5.0 数据层）
 * ----------------------------------------------------------------------------
 * v0.5.0 早期的结论「json3 没有颜色字段」是**错的**，这里纠正（实测样本
 * `Mfcj1AdnzhQ` 的 karaoke 轨，231 支笔，第 0 支是空对象 `{}`）：
 *
 *   - `pens[i].fcForeColor` 是 24 位整数 → `#RRGGBB`，颜色一直就在这里；
 *   - **逐字分层在单个 event 内部**，不是跨 event：已唱前缀的每个字符各占一支笔
 *     （彩虹渐变时颜色各异），未唱后缀整段一支 `#FEFEFE` 笔；
 *   - 同一句随时间重复下发多帧，已唱前缀逐帧变长 → 「某字第一次拿到非白颜色」
 *     的那一帧 `tStartMs` 就是它的**真实字级时间**。
 *
 * 一个反直觉的实测细节（**会改变结论，别按直觉写**）：同一行会在屏幕上被
 * **重复着色多轮**（同一 `wpWinPosId` / `wsWinStyleId`，同一位置，连续几轮各从
 * 全白扫到全彩）。样本首行 48 个 event 其实是 3 轮：
 *
 *   7524–9493  →  8 帧，单色 #FE3480（整行一个颜色）
 *   10160–12129 →  8 帧，彩虹 #71E5FF → #FE3480
 *   12830–14798 →  8 帧，彩虹 #37BABA → #F58017
 *
 * 三轮配色**互不相同**，所以「取哪一轮」必须明确：这里取**已唱字数最多的
 * 轮次里最后那一轮**（= 观众看到这一行结束时呈现的定色；若最后一轮被打断、
 * 字没唱完，则回退到最后一个完整的轮次）。轮次数放在 `passCount` 里暴露出来。
 */

/** 「未唱」哨兵色：笔色等于它即视为还没点亮，`extractLineColors` 会把它变成 null */
export const UNSUNG_COLOR = '#FEFEFE';

/** 彩虹判定：颜色种类下限 */
const RAINBOW_MIN_COLORS = 5;
/**
 * 彩虹判定：相邻已唱字符「颜色不同」的比例下限。
 *
 * 为什么不要求「全部相邻都不同」（任务书原文）：真实数据里**一个 seg 会覆盖
 * 2 个字符**（如 `", "` / `"e "`），这两个字必然同色；样本首行 31 字里就有 6 处
 * 这种连写，严格判据会把真彩虹行判成非彩虹。0.7 之下单色行是 0、渐变行是
 * 0.80–0.89，区分度很远。
 */
const RAINBOW_ADJACENT_DIFF_RATIO = 0.7;

/**
 * 允许用「真实时间」覆盖估算时间时，颜色所属窗口与传入时间窗的起点容差（ms）。
 *
 * 超过容差就**只上色、不动时间**：一行被重复着色多轮时，最后一轮只覆盖整段
 * 显示的末尾 2–3 秒，若照搬会把 7.5s 的窗口压成 2.7s、前 5 秒全黑 ——
 * 宁可保留平滑的估算节奏，也不要把时间轴压坏。
 */
const REAL_TIME_WINDOW_TOLERANCE_MS = 500;

/**
 * 24 位整数色 → `'#RRGGBB'`。
 *
 * 缺失 / `0` / 非数字 → `null`（真实数据里第 0 支笔就是 `{}`，多支笔
 * `fcForeColor: 0` 表示无色）。注意 `#FEFEFE` 会原样返回 —— 「白色 = 未唱」
 * 的判断在 `extractLineColors` 里做，`readPenColor` 只负责格式转换。
 */
export function readPenColor(pen: Json3Pen | undefined | null): string | null {
  if (!pen || typeof pen !== 'object') return null;
  const v = pen.fcForeColor;
  if (typeof v !== 'number' || !Number.isFinite(v) || v <= 0) return null;
  return '#' + (Math.floor(v) & 0xffffff).toString(16).toUpperCase().padStart(6, '0');
}

export interface LineColorInfo {
  /** 与 `line.text`（已剥 ruby / 零宽 / 压缩空白后的文本）**逐码点**对齐；未唱为 null */
  colors: (string | null)[];
  /** 该字在所选轮次里第一次拿到非白颜色的帧 `tStartMs`；从未着色为 null */
  startMs: (number | null)[];
  /** 已唱着色字符里出现最多的非 `#FEFEFE` 颜色（并列取最早出现者）；无着色为 null */
  mainColor: string | null;
  /** 相邻已唱字符颜色是否几乎两两不同且种类 >= 5（渐变彩虹行） */
  isRainbow: boolean;
  /** 上面这些颜色/时间来自哪个着色窗口（ms）：该轮次第一帧的 tStartMs */
  windowStartMs: number;
  /** 该轮次的最后一帧结束时刻（tStartMs + dDurationMs），末字的 endMs 对齐到它 */
  windowEndMs: number;
  /** 该行被重复着色了几轮（>1 = 副歌/重复乐句，被 dedupe 折叠成了一行） */
  passCount: number;
}

/** 单个字符 + 它的笔色（内部中间态） */
interface ColoredChar {
  ch: string;
  color: string | null;
}

/** 一帧（同一 tStartMs 去重后）的着色快照 */
interface ColorFrame {
  tStartMs: number;
  durMs: number;
  chars: ColoredChar[];
  text: string;
  /** 已唱（非 `#FEFEFE`）字符数，用来切「着色轮次」 */
  sung: number;
  /** 本帧出现过的不同颜色数，同刻多 event 时用来挑「信息更全」的那条 */
  distinct: number;
}

/** 取一帧内每个字符的颜色，并按 `stripInvisible` + `stripRuby` 的同一口径清洗。 */
function coloredCharsOfEvent(ev: Json3Event, pens?: Json3Pen[]): ColoredChar[] {
  const raw: ColoredChar[] = [];
  for (const seg of ev?.segs ?? []) {
    // pPenId 是 pens 数组下标，越界 → readPenColor(undefined) = null，不抛错
    const color = typeof seg?.pPenId === 'number' ? readPenColor(pens?.[seg.pPenId]) : null;
    for (const ch of Array.from(seg?.utf8 ?? '')) raw.push({ ch, color });
  }

  // 1) 去不可见字符 + 压缩空白 + 去首尾空白（等价 stripInvisible，但要带着颜色走）
  const kept: ColoredChar[] = [];
  let pendingSpace: ColoredChar | null = null;
  for (const x of raw) {
    if (isInvisibleChar(x.ch)) continue;
    if (/\s/.test(x.ch)) {
      if (!pendingSpace) pendingSpace = x;
      continue;
    }
    if (pendingSpace && kept.length > 0) kept.push({ ch: ' ', color: pendingSpace.color });
    pendingSpace = null;
    kept.push(x);
  }

  // 2) 剥 ruby 注音（等价 stripRuby，但要带着颜色走）
  const text = kept.map((x) => x.ch).join('');
  const drop = new Set<number>();
  const re = new RegExp(RUBY_RE.source, 'gu');
  let m: RegExpExecArray | null;
  while ((m = re.exec(text)) !== null) {
    for (let i = m.index + 1; i < m.index + m[0].length; i++) drop.add(i);
  }
  if (drop.size === 0) return kept;
  // 正则给的是 UTF-16 下标，kept 是按码点存的，emoji 之类要换算
  const cpOf = (utf16Index: number): number => Array.from(text.slice(0, utf16Index)).length;
  const dropCp = new Set<number>();
  for (const i of drop) dropCp.add(cpOf(i));
  return kept.filter((_, i) => !dropCp.has(i));
}

/** 把一行的所有 event 收成按时间升序、同刻去重的帧列表。 */
function readColorFrames(data: Json3CaptionData, key: string): ColorFrame[] {
  const events = Array.isArray(data?.events) ? data.events : [];
  const pens = Array.isArray(data?.pens) ? data.pens : undefined;
  const byTime = new Map<number, ColorFrame>();
  const order: number[] = [];

  for (const ev of events) {
    // 与 dedupeLyricEvents 同一口径的文本键，保证「属于这一行的 event」判定一致
    const text = stripRuby(stripInvisible(eventRawText(ev)));
    if (lyricKeyOf(text) !== key) continue;

    const chars = coloredCharsOfEvent(ev, pens);
    const colors = chars.map((c) => c.color).filter((c): c is string => !!c && c !== UNSUNG_COLOR);
    const frame: ColorFrame = {
      tStartMs: Number.isFinite(ev.tStartMs) ? ev.tStartMs : 0,
      durMs: Number.isFinite(ev.dDurationMs) && ev.dDurationMs > 0 ? ev.dDurationMs : 0,
      chars,
      text,
      sung: colors.length,
      distinct: new Set(colors).size
    };

    const prev = byTime.get(frame.tStartMs);
    if (prev) {
      // 同刻多 event = 双套样式渲染，配色方案一致；取信息更全的那条
      if (frame.distinct > prev.distinct) byTime.set(frame.tStartMs, frame);
    } else {
      byTime.set(frame.tStartMs, frame);
      order.push(frame.tStartMs);
    }
  }

  return order.sort((a, b) => a - b).map((t) => byTime.get(t) as ColorFrame);
}

/** 一帧的字符序列 → 参考文本的下标映射（前缀/后缀对齐，对不上的给 -1）。 */
function alignFrameToRef(frameChars: ColoredChar[], refChars: string[]): number[] {
  const m = frameChars.length;
  const n = refChars.length;
  const map = new Array<number>(m).fill(-1);

  let prefix = 0;
  while (prefix < m && prefix < n && frameChars[prefix].ch === refChars[prefix]) prefix++;
  let suffix = 0;
  while (
    suffix < m - prefix &&
    suffix < n - prefix &&
    frameChars[m - 1 - suffix].ch === refChars[n - 1 - suffix]
  ) {
    suffix++;
  }

  for (let i = 0; i < m; i++) {
    if (i < prefix) map[i] = i;
    else if (suffix > 0 && i >= m - suffix) map[i] = n - (m - i);
  }
  return map;
}

/**
 * 取一行的逐字颜色 + 真实字级时间。
 *
 * 算法（全部可复算，无启发式阈值）：
 *   1. 用 `line.key` 找出属于这一行的所有 event（与 `dedupeLyricEvents` 同口径）；
 *   2. 同 `tStartMs` 的多条 event 是一条的「双套样式」渲染，取颜色信息更全的一条；
 *   3. 按时间扫帧，**某一帧的「已唱字数」比本轮最大值回退 → 说明开始新一轮着色**，
 *      据此把帧切成轮次（`passCount`）；
 *   4. 选「已唱字数最多」的那些轮次里**最后**一轮，逐字取「第一次非白」的颜色与帧时刻；
 *   5. `#FEFEFE` = 未唱 → null；`pPenId` 越界 / 缺省 → null（不抛错）；
 *   6. 帧文本与 `line.text` 长度不一致时以**最长的一次**为参考对齐，对不上的位置给 null。
 *
 * 纯函数、零 IO、零随机：同一份 json3 + 同一行，结果逐字节可复现。
 */
export function extractLineColors(data: Json3CaptionData, line: LyricLine): LineColorInfo {
  const fallbackStart = Number.isFinite(line?.startMs) ? line.startMs : 0;
  const empty: LineColorInfo = {
    colors: [],
    startMs: [],
    mainColor: null,
    isRainbow: false,
    windowStartMs: fallbackStart,
    windowEndMs: fallbackStart,
    passCount: 0
  };
  if (!line || !line.key) return empty;

  const frames = readColorFrames(data, line.key);
  if (frames.length === 0) return empty;

  // 参考文本：最长的一次（line.text 由 dedupe 保证已是最长，这里只是兜底）
  let ref = line.text ?? '';
  for (const f of frames) {
    if (Array.from(f.text).length > Array.from(ref).length) ref = f.text;
  }
  const refChars = Array.from(ref);
  const n = refChars.length;
  if (n === 0) return empty;

  // ── 切轮次：已唱字数回退 = 新一轮从全白重新扫起 ──
  const passes: ColorFrame[][] = [];
  let cur: ColorFrame[] = [];
  let runMax = 0;
  for (const f of frames) {
    if (cur.length > 0 && f.sung < runMax) {
      passes.push(cur);
      cur = [f];
      runMax = f.sung;
    } else {
      cur.push(f);
      if (f.sung > runMax) runMax = f.sung;
    }
  }
  if (cur.length > 0) passes.push(cur);

  const peakOf = (pass: ColorFrame[]): number => pass.reduce((a, f) => Math.max(a, f.sung), 0);
  const peak = Math.max(...passes.map(peakOf));
  let chosen = passes[passes.length - 1];
  for (let i = passes.length - 1; i >= 0; i--) {
    if (peakOf(passes[i]) === peak) {
      chosen = passes[i];
      break;
    }
  }

  // ── 逐字取「第一次非白」──
  const colors = new Array<string | null>(n).fill(null);
  const startMs = new Array<number | null>(n).fill(null);
  for (const f of chosen) {
    const map = alignFrameToRef(f.chars, refChars);
    for (let i = 0; i < f.chars.length; i++) {
      const j = map[i];
      if (j < 0 || j >= n) continue;
      const c = f.chars[i].color;
      if (!c || c === UNSUNG_COLOR) continue;
      if (colors[j] !== null) continue;
      colors[j] = c;
      startMs[j] = f.tStartMs;
    }
  }

  // ── 主色 / 彩虹 ──
  const sungIdx: number[] = [];
  for (let i = 0; i < n; i++) if (colors[i] !== null) sungIdx.push(i);
  const freq = new Map<string, number>();
  for (const i of sungIdx) {
    const c = colors[i] as string;
    freq.set(c, (freq.get(c) ?? 0) + 1);
  }
  let mainColor: string | null = null;
  let best = 0;
  for (const [c, k] of freq) {
    if (k > best) {
      best = k;
      mainColor = c;
    }
  }
  let diffPairs = 0;
  for (let k = 1; k < sungIdx.length; k++) {
    if (colors[sungIdx[k]] !== colors[sungIdx[k - 1]]) diffPairs++;
  }
  const diffRatio = sungIdx.length > 1 ? diffPairs / (sungIdx.length - 1) : 0;
  const isRainbow =
    freq.size >= RAINBOW_MIN_COLORS && sungIdx.length >= 2 && diffRatio >= RAINBOW_ADJACENT_DIFF_RATIO;

  return {
    colors,
    startMs,
    mainColor,
    isRainbow,
    windowStartMs: chosen[0].tStartMs,
    windowEndMs: chosen.reduce((a, f) => Math.max(a, f.tStartMs + f.durMs), chosen[0].tStartMs),
    passCount: passes.length
  };
}

/**
 * 由「真实锚点」生成严格递增的字符起点数组。
 *
 * 约束与 `allocateByWeight` 一致：每片 >= 1ms、首片 = `startMs`、末片 end = `endMs`。
 * 同一帧点亮多个字（一个 seg 覆盖 2 字）时锚点相同，这里按 +1ms 顺延展开，
 * 保证严格递增且总漂移 <= 该帧点亮的字数。
 * 放不下（剩余时间不够每字 1ms）→ 返回 null，调用方放弃覆盖时间。
 */
function buildRealStarts(
  anchors: (number | null)[],
  spanStart: number,
  spanEnd: number
): number[] | null {
  const n = anchors.length;
  const starts = new Array<number>(n);
  let cursor = spanStart;
  for (let i = 0; i < n; i++) {
    const a = anchors[i];
    let v = typeof a === 'number' && Number.isFinite(a) ? Math.floor(a) : cursor;
    if (i === 0) v = spanStart;
    if (v < cursor) v = cursor;
    if (v > spanEnd - (n - i)) return null;
    starts[i] = v;
    cursor = v + 1;
  }
  return starts;
}

/**
 * 把 `extractLineColors` 的颜色（有真实时间时连同时间）写到逐字时间上。
 *
 * 规则（逐条对应测试）：
 *   1. 有颜色 → `color` + `source: 'pen'`；
 *   2. 无颜色 → **完全不动**（时间保持估算，`source: 'estimated'`）；
 *   3. 有真实时间且 `|info.windowStartMs − timings[0].startMs| <= 500ms` →
 *      用真实时间重建整条时间轴（首字 = 窗口起点、末字 end = 窗口终点、
 *      连续且严格递增）；窗口差太多时只上色不动时间（原因见容差常量注释）；
 *   4. 片数与字数不一致（短句「整句一片」分支）→ 只按索引上色，不动时间。
 *
 * 纯函数：不改入参，返回新数组（`CharTiming` 逐项浅拷贝）。
 */
export function attachCharColors(
  timings: CharTiming[],
  info: LineColorInfo | null | undefined
): CharTiming[] {
  if (!Array.isArray(timings) || timings.length === 0) return timings ? timings.slice() : [];
  const out = timings.map((t) => ({ ...t }));
  if (!info || !Array.isArray(info.colors) || info.colors.length === 0) return out;

  const n = out.length;
  const m = info.colors.length;
  const shared = Math.min(n, m);

  // 先统一标注「还是估算」，再用笔色把有颜色的位置盖成 'pen'
  for (let i = 0; i < n; i++) {
    if (out[i].estimated) out[i].source = 'estimated';
  }

  let painted = 0;
  for (let i = 0; i < shared; i++) {
    const c = info.colors[i];
    if (!c) continue;
    out[i].color = c;
    out[i].source = 'pen';
    painted++;
  }
  if (painted === 0 || n !== m) return out;
  if (!info.startMs.some((v) => typeof v === 'number')) return out;

  const spanStart = out[0].startMs;
  const spanEnd = info.windowEndMs;
  if (!(spanEnd > spanStart)) return out;
  if (Math.abs(info.windowStartMs - spanStart) > REAL_TIME_WINDOW_TOLERANCE_MS) return out;

  const starts = buildRealStarts(info.startMs, spanStart, spanEnd);
  if (!starts) return out;

  for (let i = 0; i < n; i++) {
    out[i].startMs = starts[i];
    out[i].endMs = i === n - 1 ? spanEnd : starts[i + 1];
    // 只有拿到真实锚点的字才算「非估算」；未唱后缀仍是估算节奏
    if (typeof info.startMs[i] === 'number') out[i].estimated = false;
  }
  return out;
}

/** 是否含不可见字符（转出，方便调用方只 import 一个模块）。 */
export { hasInvisible };
