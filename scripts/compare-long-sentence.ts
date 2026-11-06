/**
 * 超长句治理对照实验（方案 C 落地版，只读被测源码）
 *
 * 目的：同一条字幕轨上，把「现状（C 关）/ 方案C / 方案C+方案A」三份断句结果并排打出来，
 *       供人判断 C 的合并闸门有没有把句子拉短、有没有切出 1~2 字碎片、有没有劈词。
 *
 * 用法（仓库根目录）：
 *   npx tsx scripts/compare-long-sentence.ts                       # 三轨全跑（zh/ja/en）
 *   npx tsx scripts/compare-long-sentence.ts <语料目录>
 *   npx tsx scripts/compare-long-sentence.ts <语料目录> ja         # 只跑某几轨（zh/ja/en 或文件名）
 *   SEG_CORPUS_DIR=D:/path/to/.tmp-yt npx tsx scripts/compare-long-sentence.ts
 *
 * 默认语料：D:/WorkBuddy/2026-11-04-03-58-28/.tmp-yt/{payload.txt,payload-ja.txt,payload-en.txt}
 * 输出：控制台 ASCII 摘要 + .output/compare-long-sentence.txt（UTF-8 明细）+ .json（结构化）
 *
 * 口径：
 * - tokens = extractCaptionTokens(raw).length（噪声过滤后、断句前）
 * - 现状 = { mergeCeiling: false }（关闭方案 C 的合并闸门，复刻 v0.2.7 行为）
 * - C    = { mergeCeiling: true }（= 默认路径，不传第三参数也是这个行为）
 * - C+A  = { mergeCeiling: true, ceilingBeforeToken: true }（A 仍为可选项）
 * - 三个开关只通过 segmentCaptionTokens 第三参数传入
 * - 方案 B 已否决，不再出现在对照列里（需要复现旧结论时用 SEGMENTER_EXP_B=1 + 传参）
 * - 「新增切点」= 本方案切点集合 − 现状切点集合（切点按「该句首个 token 起点 + 文本」标识），
 *   再按守卫语义分类，避免用绝对值糊成一片（绝对值把「本来正常的句子开头」也算进来）
 */
import fs from 'node:fs';
import path from 'node:path';
import {
  extractCaptionTokens,
  segmentCaptionTokens,
  detectStreamLanguage
} from '../utils/segmenter.ts';
import type { CaptionToken, SubtitleSentence } from '../types/index.ts';

const DEFAULTS: any = {
  pauseThreshold: 450,
  maxWordsPerSentence: 16,
  minWordsPerSentence: 3,
  maxDurationMs: 6500,
  autoPunctuation: true,
  segmentationLanguage: 'auto',
  maxCharsPerSentence: 28,
  mergeShortFragments: true
};

const CORPUS_DIR =
  process.env.SEG_CORPUS_DIR || process.argv[2] || 'D:/WorkBuddy/2026-11-04-03-58-28/.tmp-yt';

const TRACKS = [
  { name: 'zh', file: 'payload.txt' },
  { name: 'ja', file: 'payload-ja.txt' },
  { name: 'en', file: 'payload-en.txt' }
];

/** argv[3] / SEG_CORPUS_FILE 支持 'zh,ja,en' 或 'payload-ja.txt'（逗号分隔） */
function selectTracks(): typeof TRACKS {
  const raw = process.env.SEG_CORPUS_FILE || process.argv[3] || '';
  if (!raw.trim()) return TRACKS;
  const wanted = raw.split(',').map((s) => s.trim()).filter(Boolean);
  const picked = TRACKS.filter((t) => wanted.includes(t.name) || wanted.includes(t.file));
  return picked.length ? picked : TRACKS;
}

const OUT_DIR = path.resolve('.output');
const OUT_TXT = path.join(OUT_DIR, 'compare-long-sentence.txt');
const OUT_JSON = path.join(OUT_DIR, 'compare-long-sentence.json');

/**
 * 与 segmenter.ts 内部守卫同源的判定表（此处独立复刻，只用于给「新增切点」分类打标签）。
 * 注意：这里刻意用**现状**的守卫语义（含 ≤2 字平假名结构性推断），
 * 因为要回答的问题是「这个新切点，按现有守卫的定义算不算劈词」。
 */
const JA_CONTINUATION_PREFIXES = [
  'たん', 'けど', 'けれど', 'ので', 'のに', 'たら', 'れば', 'ばっ', 'ても', 'でも',
  'んで', 'でね', 'てね', 'てさ', 'でさ', 'ちゃって', 'ちゃう',
  'が', 'の', 'に', 'を', 'は', 'も', 'で', 'て', 'と', 'ば', 'し', 'っ', 'や', 'ね', 'な', 'わ', 'け'
];
const HANGING_PARTICLES = /[をがにはもでとへや]$/;

const stripTail = (s: string) => s.trim().replace(/[。！？…、，,.!?～〜\s]+$/, '');
const stripHead = (s: string) => s.trim().replace(/^[。！？…、，,.!?～〜\s]+/, '');
const isPureHiragana = (s: string) => /^[ぁ-ゖー]+$/.test(s);
const dur = (s: SubtitleSentence) => (s.end - s.start) / 1000;
const charLen = (s: string) => [...s].length;
const contentLen = (s: string) =>
  charLen(s.replace(/[\s。！？…、，,.!?♪～〜—\-（）()「」『』【】\[\]]/g, ''));
const tokenKey = (t: CaptionToken) => `${t.start}|${t.end}|${t.text}`;
const wordLen = (s: string) => s.trim().split(/\s+/).filter(Boolean).length;

interface Variant {
  key: string;
  label: string;
  exp: { mergeCeiling?: boolean; ceilingBeforeToken?: boolean };
}

const VARIANTS: Variant[] = [
  { key: 'C_off', label: '现状(C关)', exp: { mergeCeiling: false } },
  { key: 'C', label: '方案C', exp: { mergeCeiling: true } },
  { key: 'C+A', label: '方案C+A', exp: { mergeCeiling: true, ceilingBeforeToken: true } }
];

/** 切点 = 每个非首句的第一个 token（用 token 身份定位，不依赖时间四舍五入） */
function cutPoints(sentences: SubtitleSentence[]): Map<string, { sentence: number; tokenStart: number }> {
  const map = new Map<string, { sentence: number; tokenStart: number }>();
  for (let i = 1; i < sentences.length; i++) {
    const first = (sentences[i].rawTokens || [])[0];
    if (!first) continue;
    map.set(tokenKey(first), { sentence: i, tokenStart: first.start });
  }
  return map;
}

interface CutFinding {
  key: string;
  prevText: string;
  nextText: string;
  kinds: string[];
  /** 切点前后各 2 个 token 的原样文本（人工判断是否为「词被劈开」用） */
  ctx: string;
  /** 切点前那句是否以终止标点收尾（= 规则1 源标点断句，天然合法） */
  prevEndsTerminal: boolean;
  /** 现状（C 关）在同一个 token 上的切法：覆盖该 token 起点的句子的开头片段 */
  baseSentence: string;
  prevSentence: string;
  nextSentence: string;
}

/**
 * 新增切点分类（三类标签，互不排斥）：
 * - 「源标点前」：切点前那个 token 以源终止标点（。！？…）收尾 ⇒ 规则 1 的合法断句，天然不是劈词
 * - 「主循环切口」：切点前那个 token **没有**源终止标点 ⇒ 这个边界本来就在主循环产出里，
 *   只是过去被「短碎片合并」缝掉了。方案 C 一收闸门就会把它暴露出来 —— 这是需要人工复核的一类，
 *   因为主循环自己的切口（尤其守卫 A 漏判的 3 字以上接续形态）可能是劈词（实测：テリ｜ちゃん）。
 * - 「劈词嫌疑 / 悬空助词」：沿用旧启发式（下句 ≤2 字平假名 / 接续前缀命中；上句裸格助词收尾）
 */
function classifyNewCuts(
  base: SubtitleSentence[],
  variant: SubtitleSentence[],
  index: Map<string, number>,
  tokens: CaptionToken[]
): CutFinding[] {
  const baseCuts = cutPoints(base);
  const vCuts = cutPoints(variant);
  const out: CutFinding[] = [];
  for (const [key, info] of vCuts) {
    if (baseCuts.has(key)) continue;
    const j = index.get(key);
    if (j === undefined) continue;
    const nextTok = tokens[j];
    const prevTok = j > 0 ? tokens[j - 1] : undefined;
    const nextHead = stripHead(nextTok.text);
    const kinds: string[] = [];
    const prevEndsSourceTerminal = prevTok ? /[.!?。！？…]$/.test(prevTok.text.trim()) : false;

    if (!prevEndsSourceTerminal) {
      kinds.push('主循环切口');
    }
    if (isPureHiragana(nextHead) && [...nextHead].length <= 2) {
      kinds.push('劈词·下句≤2字平假名');
    } else if (JA_CONTINUATION_PREFIXES.some((p) => nextHead.startsWith(p))) {
      kinds.push('劈词·接续前缀');
    }
    if (prevTok && HANGING_PARTICLES.test(stripTail(prevTok.text))) {
      kinds.push('悬空助词');
    }
    if (!kinds.length) continue;
    const ctx = tokens
      .slice(Math.max(0, j - 2), Math.min(tokens.length, j + 3))
      .map((t) => t.text)
      .join(' ¦ ');
    const prevSent = variant[info.sentence - 1];
    const tStart = nextTok.start;
    const baseCover = base.filter((s) => s.start <= tStart && s.end >= tStart);
    out.push({
      key,
      prevText: prevTok ? prevTok.text : '',
      nextText: nextTok.text,
      kinds,
      ctx,
      prevEndsTerminal: prevEndsSourceTerminal,
      baseSentence: baseCover.length
        ? baseCover.map((s) => `${dur(s).toFixed(2)}s「${s.text}」`).join(' ‖ ')
        : '（该 token 不在任何句中）',
      prevSentence: prevSent.text,
      nextSentence: variant[info.sentence].text
    });
  }
  return out;
}

interface Metrics {
  key: string;
  label: string;
  sentences: number;
  over74: number;
  over65: number;
  over13: number;
  ge32chars: number;
  longestSec: number;
  longestChars: number;
  shortSentences: number;
  fragmentRows: number;
  artifact: number;
  overlap: number;
  newCuts: number;
  /** 新增切点中「前句无源终止标点」的数量 = 主循环切口被暴露（需人工复核） */
  newCutNoPunct: number;
  newCutSplit: number;
  newCutHanging: number;
  /** 既无源标点、又命中劈词/悬空启发式 ⇒ 真实风险集合（人工抽检的主对象） */
  newCutRisky: number;
}

/** 无终止标点且短 ⇒ 本该被合并却留在原地的碎片行（方案 C 的上限会制造这类残留，需单独计数） */
function isFragmentRow(s: SubtitleSentence, charBased: boolean): boolean {
  const raw = s.rawTokens || [];
  const lastRaw = raw[raw.length - 1]?.text || s.text;
  if (/[.!?。！？…]$/.test(lastRaw.trim())) return false;
  return charBased ? contentLen(s.text) < 6 : wordLen(s.text) < 3;
}

function measure(
  variant: Variant,
  sentences: SubtitleSentence[],
  baseSentences: SubtitleSentence[],
  index: Map<string, number>,
  tokens: CaptionToken[],
  charBased: boolean
): Metrics {
  let over74 = 0;
  let over65 = 0;
  let over13 = 0;
  let ge32chars = 0;
  let longestSec = 0;
  let longestChars = 0;
  let shortSentences = 0;
  let fragmentRows = 0;
  let artifact = 0;
  let overlap = 0;
  for (let i = 0; i < sentences.length; i++) {
    const s = sentences[i];
    const d = dur(s);
    const len = charLen(s.text);
    if (d > 7.4) over74++;
    if (d > 6.5) over65++;
    if (d > 13) over13++;
    if (len >= 32) ge32chars++;
    if (d > longestSec) longestSec = d;
    if (len > longestChars) longestChars = len;
    if (contentLen(s.text) <= 2) shortSentences++;
    if (isFragmentRow(s, charBased)) fragmentRows++;
    if (s.text.includes('，。')) artifact++;
    if (i > 0 && s.start < sentences[i - 1].end) overlap++;
  }
  const baseCuts = cutPoints(baseSentences);
  const vCuts = cutPoints(sentences);
  let newCuts = 0;
  for (const k of vCuts.keys()) if (!baseCuts.has(k)) newCuts++;
  const findings = classifyNewCuts(baseSentences, sentences, index, tokens);
  const isSplit = (f: CutFinding) => f.kinds.some((k) => k.startsWith('劈词')) || f.kinds.includes('悬空助词');
  return {
    key: variant.key,
    label: variant.label,
    sentences: sentences.length,
    over74,
    over65,
    over13,
    ge32chars,
    longestSec: +longestSec.toFixed(2),
    longestChars,
    shortSentences,
    fragmentRows,
    artifact,
    overlap,
    newCuts,
    newCutNoPunct: findings.filter((f) => f.kinds.includes('主循环切口')).length,
    newCutSplit: findings.filter((f) => f.kinds.some((k) => k.startsWith('劈词'))).length,
    newCutHanging: findings.filter((f) => f.kinds.includes('悬空助词')).length,
    newCutRisky: findings.filter((f) => f.kinds.includes('主循环切口') && isSplit(f)).length
  };
}

/** 某个时间窗被哪些句子覆盖（「同一段话三种切法」对照） */
function covering(sentences: SubtitleSentence[], start: number, end: number) {
  return sentences
    .filter((s) => s.start < end && s.end > start)
    .map((s) => ({
      start: +(s.start / 1000).toFixed(2),
      end: +(s.end / 1000).toFixed(2),
      sec: +dur(s).toFixed(2),
      chars: charLen(s.text),
      text: s.text,
      seg: (s.rawTokens || []).map((t) => t.text).join('·')
    }));
}

interface TrackResult {
  track: (typeof TRACKS)[number];
  tokens: number;
  lang: string;
  charBased: boolean;
  results: Array<{ variant: Variant; sentences: SubtitleSentence[]; metrics: Metrics }>;
  top5: any[];
  detail: any[];
  cSplitExamples: Array<{ window: any; off: any[]; on: any[]; clean: boolean }>;
  cSplitTotal: number;
  cCleanCount: number;
  findingsByVariant: Array<{ label: string; findings: CutFinding[] }>;
}

function runTrack(track: (typeof TRACKS)[number]): TrackResult | null {
  const full = path.join(CORPUS_DIR, track.file);
  if (!fs.existsSync(full)) {
    console.log(`MISSING ${full}`);
    return null;
  }
  const raw = JSON.parse(fs.readFileSync(full, 'utf8'));
  const tokens = extractCaptionTokens(raw);
  const lang = detectStreamLanguage(tokens);
  const charBased = lang === 'ja' || lang === 'zh';
  const index = new Map<string, number>();
  tokens.forEach((t, i) => {
    if (!index.has(tokenKey(t))) index.set(tokenKey(t), i);
  });

  const baseSentences = segmentCaptionTokens(tokens, DEFAULTS, VARIANTS[0].exp);
  const results = VARIANTS.map((v) => {
    const sentences =
      v.key === 'C_off' ? baseSentences : segmentCaptionTokens(tokens, DEFAULTS, v.exp);
    return { variant: v, sentences, metrics: measure(v, sentences, baseSentences, index, tokens, charBased) };
  });

  const base = results[0];

  // 现状最长的 5 句
  const top5 = [...base.sentences]
    .sort((a, b) => dur(b) - dur(a))
    .slice(0, 5)
    .map((s) => ({
      start: +(s.start / 1000).toFixed(2),
      end: +(s.end / 1000).toFixed(2),
      sec: +dur(s).toFixed(2),
      chars: charLen(s.text),
      text: s.text,
      tokenCount: (s.rawTokens || []).length
    }));

  const detail = top5.map((w) => ({
    window: w,
    perVariant: results.map((r) => ({
      key: r.variant.key,
      label: r.variant.label,
      pieces: covering(r.sentences, w.start * 1000, w.end * 1000)
    }))
  }));

  // 例句：现状 >7.4s 且 C 把它切开的时间窗。优先给「切开后每段都 <=6.6s」的干净例子，
  // 其余按现状时长降序补齐 —— 避免只挑到最难看的那几条，也避免只挑好看的。
  const cOn = results[1];
  const cSplitCandidates = [...base.sentences]
    .filter((s) => dur(s) > 7.4)
    .map((s) => {
      const off = covering(base.sentences, s.start, s.end);
      const on = covering(cOn.sentences, s.start, s.end);
      return {
        window: {
          start: +(s.start / 1000).toFixed(2),
          end: +(s.end / 1000).toFixed(2),
          sec: +dur(s).toFixed(2),
          chars: charLen(s.text),
          text: s.text
        },
        off,
        on,
        clean: on.length > off.length && on.every((p: any) => p.sec <= 6.6)
      };
    })
    .filter((x) => x.on.length > x.off.length)
    .sort((a, b) => (a.clean === b.clean ? b.window.sec - a.window.sec : a.clean ? -1 : 1));
  const cSplitExamples = cSplitCandidates.slice(0, 5);
  const cCleanCount = cSplitCandidates.filter((x) => x.clean).length;

  const findingsByVariant = results
    .filter((r) => r.variant.key !== 'C_off')
    .map((r) => ({
      label: r.variant.label,
      findings: classifyNewCuts(baseSentences, r.sentences, index, tokens)
    }));

  // 参考行：完全关闭短碎片合并（= 合并环节能造成多少 >7.4s 的地板值，用于证明 C 是否已吃掉全部合并型长句）
  const mergeOffVariant: Variant = { key: 'mergeOff', label: '参考(不合并)', exp: {} };
  const mergeOffSentences = segmentCaptionTokens(tokens, {
    ...DEFAULTS,
    mergeShortFragments: false
  });
  const mergeOffMetrics = measure(
    mergeOffVariant,
    mergeOffSentences,
    baseSentences,
    index,
    tokens,
    charBased
  );
  results.push({ variant: mergeOffVariant, sentences: mergeOffSentences, metrics: mergeOffMetrics });

  console.log(`\n=== ${track.name} (${track.file}) ===`);
  console.log(`tokens: ${tokens.length}  lang: ${lang}  charBased: ${charBased}`);
  console.log(
    'variant   sent  >7.4s  >6.5s  >13s  >=32ch  maxSec  maxCh  short<=2  frag  artifact  overlap  newCuts  noPunct  risky'
  );
  for (const r of results) {
    const m = r.metrics;
    console.log(
      `${r.variant.key.padEnd(9)} ${String(m.sentences).padStart(4)}  ${String(m.over74).padStart(5)}  ` +
        `${String(m.over65).padStart(5)}  ${String(m.over13).padStart(4)}  ${String(m.ge32chars).padStart(6)}  ` +
        `${String(m.longestSec).padStart(6)}  ${String(m.longestChars).padStart(5)}  ${String(m.shortSentences).padStart(8)}  ` +
        `${String(m.fragmentRows).padStart(4)}  ${String(m.artifact).padStart(8)}  ${String(m.overlap).padStart(7)}  ` +
        `${String(m.newCuts).padStart(7)}  ${String(m.newCutNoPunct).padStart(7)}  ${String(m.newCutRisky).padStart(5)}`
    );
  }
  console.log(`top-5 longest baseline windows:`);
  for (const w of top5) console.log(`  ${w.start}s~${w.end}s (${w.sec}s / ${w.chars}ch / ${w.tokenCount}tk)`);
  console.log(
    `C 相对现状的切分差异：${cSplitCandidates.length} 例（其中干净切分 ${cCleanCount} 例）`
  );

  return {
    track,
    tokens: tokens.length,
    lang,
    charBased,
    results,
    top5,
    detail,
    cSplitExamples,
    cSplitTotal: cSplitCandidates.length,
    cCleanCount,
    findingsByVariant
  };
}

const selected = selectTracks();
const tracks: TrackResult[] = [];
for (const t of selected) {
  const r = runTrack(t);
  if (r) tracks.push(r);
}
if (!tracks.length) {
  console.error(`[ERROR] 找不到任何语料：${CORPUS_DIR}`);
  console.error('       用 SEG_CORPUS_DIR / argv[2] 指定语料目录。');
  process.exit(1);
}

// ─── UTF-8 明细 ───
const L: string[] = [];
L.push('# 超长句治理对照（现状 C关 / 方案C / 方案C+A）');
L.push(`语料目录：${CORPUS_DIR}`);
L.push(
  `设置：pauseThreshold 450 / maxDurationMs 6500 / maxChars 28 / maxWords 16 / mergeShortFragments on / language auto`
);
L.push(`轨：${tracks.map((t) => `${t.track.name}(${t.track.file}, ${t.lang})`).join(' / ')}`);
L.push('');
L.push('## 三轨总表');
L.push(
  '| 轨 | 方案 | 句数 | >7.4s | >6.5s | >13s | ≥32字 | 最长句(s) | 最长句(字) | 极短句(实字≤2) | 碎片行残留 | 「，。」 | 重叠 | 新增切点 | 其中无源标点(主循环切口) | 其中切口且劈词/悬空 |'
);
L.push('|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|');
for (const t of tracks) {
  for (const r of t.results) {
    const m = r.metrics;
    L.push(
      `| ${t.track.name} | ${r.variant.label} | ${m.sentences} | ${m.over74} | ${m.over65} | ${m.over13} | ${m.ge32chars} | ${m.longestSec} | ${m.longestChars} | ${m.shortSentences} | ${m.fragmentRows} | ${m.artifact} | ${m.overlap} | ${m.newCuts} | ${m.newCutNoPunct} | ${m.newCutRisky} |`
    );
  }
}
L.push('');
L.push(
  '> 「碎片行残留」= 无终止标点且短（CJK 实字 <6 / 拉丁 <3 词）但仍独立成句的行数——方案 C 的合并上限会制造这类残留，故单列；' +
    '「新增切点」以「现状(C关)」为基线；「其中无源标点(主循环切口)」= 新增切点里切点前**没有源终止标点**的那些' +
    '（即主循环本来就切在那里、过去被合并 pass 缝掉，C 收闸门后暴露出来）；最后一列是这些切口里又命中劈词/悬空启发式的数量。'
);

for (const t of tracks) {
  L.push('');
  L.push(`## ${t.track.name} 轨（${t.track.file}，lang=${t.lang}，tokens=${t.tokens}）`);

  L.push('');
  L.push('### 现状最长的 5 句：三种切法逐句对照');
  for (let i = 0; i < t.detail.length; i++) {
    const d = t.detail[i];
    L.push('');
    L.push(`#### ${i + 1}. ${d.window.start}s ~ ${d.window.end}s（${d.window.sec}s / ${d.window.chars} 字 / ${d.window.tokenCount} tokens）`);
    L.push(`现状原句：${d.window.text}`);
    for (const pv of d.perVariant) {
      L.push('');
      L.push(`**[${pv.label}]** 覆盖该时间窗的句子 ${pv.pieces.length} 句：`);
      for (const p of pv.pieces) {
        L.push(`- ${p.start}s~${p.end}s（${p.sec}s / ${p.chars}字）${p.text}`);
        L.push(`  · token：${p.seg}`);
      }
    }
  }

  L.push('');
  L.push(`### 例句：现状 >7.4s 而 C 切开（本轨共 ${t.cSplitTotal} 例，其中「切开后每段都 <=6.6s」的干净例子 ${t.cCleanCount} 例；此处最多列 5 条）`);
  if (!t.cSplitExamples.length) {
    L.push('- （本轨无此类句子）');
  }
  for (let i = 0; i < t.cSplitExamples.length; i++) {
    const e = t.cSplitExamples[i];
    L.push('');
    L.push(
      `#### ${i + 1}. ${e.window.start}s ~ ${e.window.end}s（现状 ${e.window.sec}s / ${e.window.chars} 字）${e.window.text}` +
        `　${e.clean ? '【干净切分】' : '【含超限片段或碎片】'}`
    );
    L.push(`- 现状(C关) ${e.off.length} 句：${e.off.map((p: any) => `${p.sec}s「${p.text}」`).join(' ‖ ')}`);
    L.push(`- 方案C    ${e.on.length} 句：${e.on.map((p: any) => `${p.sec}s「${p.text}」`).join(' ‖ ')}`);
  }

  L.push('');
  L.push('### 新增切点 A 组：主循环切口被暴露（切点前无源终止标点，人工复核对象，全列）');
  for (const fb of t.findingsByVariant) {
    const risky = fb.findings.filter((f) => f.kinds.includes('主循环切口'));
    L.push('');
    L.push(`#### ${fb.label}：${risky.length} 处`);
    if (!risky.length) L.push('- （无）');
    for (const f of risky.slice(0, 40)) {
      L.push(`- [${f.kinds.join('+')}] 「${f.prevText}」｜「${f.nextText}」`);
      L.push(`    token 上下文：${f.ctx}`);
      L.push(`    现状(同一 token)：${f.baseSentence}`);
      L.push(`    现状切法 → C 切法：`);
      L.push(`      C 前句：${f.prevSentence}`);
      L.push(`      C 后句：${f.nextSentence}`);
    }
  }

  L.push('');
  L.push('### 新增切点 B 组：源标点之后的切点（命中启发式但属规则1，最多 15 条）');
  for (const fb of t.findingsByVariant) {
    const legit = fb.findings.filter((f) => !f.kinds.includes('主循环切口'));
    L.push('');
    L.push(`#### ${fb.label}：${legit.length} 处`);
    if (!legit.length) L.push('- （无）');
    for (const f of legit.slice(0, 15)) {
      L.push(`- [${f.kinds.join('+')}] 「${f.prevText}」｜「${f.nextText}」`);
      L.push(`    token 上下文：${f.ctx}`);
      L.push(`    现状(同一 token)：${f.baseSentence}`);
    }
  }
}

fs.mkdirSync(OUT_DIR, { recursive: true });
fs.writeFileSync(OUT_TXT, L.join('\n'), 'utf8');
fs.writeFileSync(
  OUT_JSON,
  JSON.stringify(
    {
      corpusDir: CORPUS_DIR,
      settings: DEFAULTS,
      tracks: tracks.map((t) => ({
        track: t.track,
        tokens: t.tokens,
        lang: t.lang,
        metrics: t.results.map((r) => r.metrics),
        top5: t.detail,
        cSplitExamples: t.cSplitExamples,
        cSplitTotal: t.cSplitTotal,
        cCleanCount: t.cCleanCount,
        findings: t.findingsByVariant.map((f) => ({
          label: f.label,
          count: f.findings.length,
          items: f.findings.slice(0, 40)
        }))
      }))
    },
    null,
    2
  ),
  'utf8'
);
console.log(`\nDETAIL -> ${OUT_TXT}`);
console.log(`JSON   -> ${OUT_JSON}`);
