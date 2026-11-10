import assert from 'node:assert/strict';
import fs from 'node:fs';
import { inferAsrCharTimes, buildAsrCharTimings } from '../utils/asr-timing.ts';
import { extractCaptionTokens, segmentCaptionTokens } from '../utils/segmenter.ts';
import { DEFAULT_SETTINGS } from '../types/index.ts';
import { dedupeLyricEvents, extractLineColors } from '../utils/lyric-track.ts';

/**
 * ASR 逐词时间推断测试
 *
 * 口径：只看 `npm test` 退出码；计数打印，失败由 node:assert 抛错收口。
 *
 * ★ 时间表口径（v0.5.0 阶段 B 改回）：**词级** —— 同一个词的字符**共享同一个 startMs**
 *   （= 官方词起点），该词字符的 endMs = **下一个词的起点**（时间轴末词 = 句子 endMs）。
 *   渲染出来是「整词一起亮」（像 YouTube 那样按词推进），**不是**逐字跳转。
 *   由此派生两个标记（口径相反，别混用）：
 *     - charLevel：true = 字级（每字独立时间点，仅 inferred / estimated 分支）；
 *                   false = 词级（同词共享时间点，offset 分支）。
 *     - wordLevel：true = 时间表确实来自官方词级时间戳（offset 分支，可逐词高亮）；
 *                   false = 帧前缀推断 / 均分兜底。
 *   整句不倒序；**词与词之间严格递增**；同词内相等是允许的（词级共享的正常形态）。
 *
 * 第 1–5 节是构造样本（19 条，v0.5.0 阶段 B 之前既有，只增不减）。
 * 第 6 节起是**实测夹具回归**：
 *   - test/fixtures/asr-word-timing-en.json = XGxIE1hr0w4（BBC，唯一 a.en asr 轨）紧凑夹具
 *   - test/fixtures/asr-word-timing-ja.json = VyV7nxzYEqA（唯一 ja/kind=asr/vssId=a.ja 轨）紧凑夹具
 *   - test/fixtures/lyric-track-sample.json = Mfcj1AdnzhQ（v1 歌词轨，回归基线）
 *   夹具只保留 events(tStartMs/dDurationMs/aAppend/segs[].utf8/tOffsetMs) +
 *   pens / wsWinStyles / wpWinPositions，去掉 acAsrConf/id/wWinId 等无关字段。
 *   **事实与推断分列**：日文结论只针对 VyV7nxzYEqA 这一个样本，不外推到所有日文 ASR 轨。
 */

let passed = 0;
const failed = [];
function check(name, cond, detail) {
  if (cond) {
    passed++;
    console.log(`  ✓ ${name}`);
  } else {
    const msg = `${name}${detail !== undefined ? ' => ' + JSON.stringify(detail) : ''}`;
    failed.push(msg);
    console.error(`  ✗ ${msg}`);
  }
}

console.log('--- ASR 逐字时间推断 ---');

/* 1. 标准的「逐词长出来」序列 */
const grow = {
  events: [
    { tStartMs: 1000, dDurationMs: 400, segs: [{ utf8: '今天' }] },
    { tStartMs: 1350, dDurationMs: 400, segs: [{ utf8: '今天天气' }] },
    { tStartMs: 1700, dDurationMs: 400, segs: [{ utf8: '今天天气不错' }] }
  ]
};
const r1 = inferAsrCharTimes(grow, 1000, 2100, '今天天气不错');
check('首字时间 = 首帧 tStartMs', r1.firstSeenMs[0] === 1000, r1.firstSeenMs[0]);
check('第 3 字（天）时间 = 第二帧', r1.firstSeenMs[2] === 1350, r1.firstSeenMs[2]);
check('第 5 字（不）时间 = 第三帧', r1.firstSeenMs[4] === 1700, r1.firstSeenMs[4]);
check('覆盖率 100%', r1.coverage === 1, r1.coverage);
check('用了 3 帧', r1.frames === 3, r1.frames);

const t1 = buildAsrCharTimings(grow, 1000, 2100, '今天天气不错');
check('timings 长度 = 字符数', t1.timings.length === 6, t1.timings.length);
check(
  '严格递增且无重叠',
  t1.timings.every((x, i) => i === 0 || (x.startMs > t1.timings[i - 1].startMs && t1.timings[i - 1].endMs <= x.startMs)),
  t1.timings.map((x) => [x.startMs, x.endMs])
);
check('首尾对齐句子边界', t1.timings[0].startMs === 1000 && t1.timings[5].endMs === 2100, [
  t1.timings[0].startMs,
  t1.timings[5].endMs
]);
check('全部 source=pen', t1.timings.every((x) => x.source === 'pen'));
check('全部 estimated=false', t1.timings.every((x) => x.estimated === false));

/* 2. 前缀对不上（ASR 改写了句中）→ 不硬凑 */
const mismatch = {
  events: [{ tStartMs: 1000, dDurationMs: 400, segs: [{ utf8: '完全不同的句子' }] }]
};
const r2 = inferAsrCharTimes(mismatch, 1000, 2000, '今天天气不错');
check('前缀不匹配 → 覆盖率 0', r2.coverage === 0, r2.coverage);
const t2 = buildAsrCharTimings(mismatch, 1000, 2000, '今天天气不错');
check('推断失败仍返回可用时间表（均分兜底）', t2.timings.length === 6, t2.timings.length);
check('兜底时 estimated=true', t2.timings.every((x) => x.estimated === true));

/* 3. 部分覆盖：只有前 4 字有帧，后 2 字靠插值 */
const partial = {
  events: [{ tStartMs: 1000, dDurationMs: 400, segs: [{ utf8: '今天天气' }] }]
};
const t3 = buildAsrCharTimings(partial, 1000, 2000, '今天天气不错');
check('部分覆盖：仍严格递增', t3.timings.every((x, i) => i === 0 || x.startMs > t3.timings[i - 1].startMs));
check(
  '部分覆盖：前 4 字有真实时间（index 0..3）',
  t3.timings[0].estimated === false && t3.timings[3].estimated === false,
  [t3.timings[0].estimated, t3.timings[3].estimated]
);
check(
  '部分覆盖：后 2 字靠插值（index 4..5）',
  t3.timings[4].estimated === true && t3.timings[5].estimated === true,
  [t3.timings[4].estimated, t3.timings[5].estimated]
);

/* 4. 空输入不抛错 */
check('空文本 → 空时间表', buildAsrCharTimings({ events: [] }, 0, 1000, '').timings.length === 0);
check('无事件 → 均分兜底', buildAsrCharTimings({ events: [] }, 0, 600, '三个字符').timings.length === 4);

/* 5. 时间范围外的帧不应被误用 */
const far = {
  events: [
    { tStartMs: 50000, dDurationMs: 400, segs: [{ utf8: '今天天气不错' }] }
  ]
};
const r5 = inferAsrCharTimes(far, 1000, 2000, '今天天气不错');
check('范围外的帧被排除', r5.coverage === 0, r5.coverage);

/* ============================================================================
 * 6. 实测夹具：普通 ASR 轨的官方词级时间（B 轨英文 / C 轨日文）
 *
 * A（歌词轨，Mfcj1AdnzhQ）与 B/C（普通 ASR 轨）是两套不同机制：
 *   A = 重复帧 + tOffsetMs 全 0 + pens 带 fcForeColor → 逐字上色，时间取首帧非白；
 *   B/C = 一次给全片 + 每词正数 tOffsetMs + pens=[{}] → 逐词显现，时间直接可读。
 * 详见 docs/LIVE-AND-ASR-0.5.0.md「A/B 两套机制」一节。
 *
 * ⚠️ 事实与推断分列：日文结论只针对 VyV7nxzYEqA 这一个样本，
 *    不得外推成「所有日文 ASR 轨都带词级时间」。
 * ==========================================================================*/
console.log('--- 6. 普通 ASR 轨官方词级时间（实测夹具）---');

function readAsrFixture(name) {
  return JSON.parse(fs.readFileSync(new URL(`./fixtures/${name}`, import.meta.url), 'utf8'));
}
const asrEn = readAsrFixture('asr-word-timing-en.json');
const asrJa = readAsrFixture('asr-word-timing-ja.json');
const lyricFixture = readAsrFixture('lyric-track-sample.json');

const ANCHORS_28480 = [28480, 29480, 29640, 30279, 30519, 30840, 31439];
const ANCHORS_90880 = [90880, 91200, 91520, 92280, 92520, 92600, 92840, 93439];
const ANCHORS_1079 = [1079, 1360, 1719, 2280, 2520, 3120, 3320];

const isTextLine = (e) =>
  Array.isArray(e.segs) && e.segs.length > 0 && e.aAppend !== 1 &&
  e.segs.map((s) => s.utf8 || '').join('').trim() !== '';
const textLinesOf = (data) => data.events.filter(isTextLine);
const lineTextOf = (ev) => ev.segs.map((s) => s.utf8 || '').join('');
const anchorsOf = (ev) => ev.segs.map((s) => ev.tStartMs + (s.tOffsetMs ?? 0));
const lineAt = (data, t) => textLinesOf(data).find((e) => e.tStartMs === t);
const realStartsOf = (v) => [...new Set(v.timings.filter((x) => !x.estimated).map((x) => x.startMs))];
const estFalseCount = (v) => v.timings.filter((x) => !x.estimated).length;
/**
 * 每个官方词的首字下标（按码点累加 seg 字数）→ 用来核对「词起点不变」。
 * 官方时间只挂在**词**上（seg.tOffsetMs），字级细分只能改词**内部**的分布，
 * 词与词之间的锚点必须原样保留。
 */
const wordFirstIdxOf = (ev) => {
  const idx = [];
  let pos = 0;
  for (const s of ev.segs) {
    idx.push(pos);
    pos += Array.from(s.utf8 || '').length;
  }
  return idx;
};
const wordFirstStarts = (v, ev) => wordFirstIdxOf(ev).map((i) => v.timings[i]?.startMs);
/**
 * 每个官方词的**末字**下标（词级口径下，词内所有字符共享 startMs / endMs，
 * 所以「词的末字」= 该词最后一个字符）。
 */
const wordLastIdxOf = (ev) => {
  const first = wordFirstIdxOf(ev);
  return first.map((f, i) =>
    i + 1 < first.length ? first[i + 1] - 1 : f + Array.from(ev.segs[i].utf8 || '').length - 1
  );
};

function statsOf(data) {
  const lines = textLinesOf(data);
  let words = 0, positive = 0, missingFirst = 0, reversed = 0;
  for (const ev of lines) {
    let prev = -1;
    ev.segs.forEach((s, i) => {
      words++;
      const off = s.tOffsetMs;
      if (typeof off === 'number' && off > 0) {
        positive++;
        if (off < prev) reversed++;
        prev = off;
      } else if (i === 0 && off === undefined) {
        missingFirst++;
      }
    });
  }
  return {
    events: data.events.length,
    lines: lines.length,
    aAppend: data.events.filter((e) => e.aAppend === 1).length,
    words, positive, missingFirst, reversed
  };
}
const enStats = statsOf(asrEn);
const jaStats = statsOf(asrJa);

/* ── 6.1 夹具形态：pens / roll-up 字段 ── */
check('EN pens 为空画笔 [{}]（无 fcForeColor，与歌词轨 231 支截然不同）',
  Array.isArray(asrEn.pens) && asrEn.pens.length === 1 && Object.keys(asrEn.pens[0]).length === 0, asrEn.pens);
check('JA pens 同样为空画笔 [{}]',
  Array.isArray(asrJa.pens) && asrJa.pens.length === 1 && Object.keys(asrJa.pens[0]).length === 0, asrJa.pens);
check('EN roll-up：wsWinStyles.sdScrollDir=3 / wpWinPositions.rcRows=2',
  asrEn.wsWinStyles[1].sdScrollDir === 3 && asrEn.wpWinPositions[1].rcRows === 2,
  [asrEn.wsWinStyles[1].sdScrollDir, asrEn.wpWinPositions[1].rcRows]);
check('JA roll-up 字段与 EN 逐字段相同',
  JSON.stringify(asrJa.wsWinStyles) === JSON.stringify(asrEn.wsWinStyles) &&
  JSON.stringify(asrJa.wpWinPositions) === JSON.stringify(asrEn.wpWinPositions));

/* ── 6.2 英文统计一致（XGxIE1hr0w4，唯一 a.en asr 轨）── */
check('EN events = 130（65 文本行 + 64 aAppend 换行 + 1 窗口定义）', enStats.events === 130, enStats.events);
check('EN 文本行 = 65', enStats.lines === 65, enStats.lines);
check('EN aAppend:1 纯换行 = 64', enStats.aAppend === 64, enStats.aAppend);
check('EN 词 seg = 378', enStats.words === 378, enStats.words);
check('EN 正数 tOffsetMs = 313', enStats.positive === 313, enStats.positive);
check('EN 每行首词缺 tOffsetMs（隐含 0）= 65', enStats.missingFirst === 65, enStats.missingFirst);
check('EN 同 event 内偏移反序 = 0', enStats.reversed === 0, enStats.reversed);

/* ── 6.3 日文统计一致（VyV7nxzYEqA，唯一 ja/kind=asr/vssId=a.ja 轨）── */
check('JA events = 76（1 窗口定义 + 38 文本行 + 37 aAppend 换行）', jaStats.events === 76, jaStats.events);
check('JA 文本行 = 38', jaStats.lines === 38, jaStats.lines);
check('JA aAppend:1 纯换行 = 37', jaStats.aAppend === 37, jaStats.aAppend);
check('JA 词 seg = 275', jaStats.words === 275, jaStats.words);
check('JA 正数 tOffsetMs = 237', jaStats.positive === 237, jaStats.positive);
check('JA 每行首词缺 tOffsetMs（隐含 0）= 38', jaStats.missingFirst === 38, jaStats.missingFirst);
check('JA 同 event 内偏移反序 = 0', jaStats.reversed === 0, jaStats.reversed);
check('JA 按文节/形态素切分：文本行 seg 无前导空格（EN 每段带一个）',
  textLinesOf(asrJa).every((ev) => ev.segs.every((s) => !/^\s/.test(s.utf8 || ''))),
  textLinesOf(asrJa).filter((ev) => ev.segs.some((s) => /^\s/.test(s.utf8 || ''))).length);

/* ── 6.4 英文行 t=28480：核心回归（改前 35 字全 estimated）── */
const ev28480 = lineAt(asrEn, 28480);
const text28480 = lineTextOf(ev28480);
const v28480 = buildAsrCharTimings(asrEn, ev28480.tStartMs, ev28480.tStartMs + ev28480.dDurationMs, text28480);
check('28480 行文本 = "thinking you want get this from any"（35 字）',
  text28480 === 'thinking you want get this from any' && text28480.length === 35, text28480);
check('28480 行官方 7 词锚点 = 28480/29480/29640/30279/30519/30840/31439',
  JSON.stringify(anchorsOf(ev28480)) === JSON.stringify(ANCHORS_28480), anchorsOf(ev28480));
check('28480 行 source=offset', v28480.source === 'offset', v28480.source);
check('28480 行 wordCount=7', v28480.wordCount === 7, v28480.wordCount);
check('28480 行 35 字里 estimated=false 数量 > 0（改前为 0，核心回归）',
  estFalseCount(v28480) > 0, estFalseCount(v28480));
check('28480 行 35 字全部 estimated=false（细分不改变来源判定）',
  estFalseCount(v28480) === 35, estFalseCount(v28480));
check('28480 行 distinctAnchors=7 / coverage=1',
  v28480.distinctAnchors === 7 && v28480.coverage === 1, [v28480.distinctAnchors, v28480.coverage]);

/* ── 6.4b 词级口径：同词字符共享时间点（整词一起亮）── */
check('28480 行 charLevel=false（词级：同词字符共享时间点，不是字级）', v28480.charLevel === false, v28480.charLevel);
check('28480 行 wordLevel=true（时间表来自官方词级时间戳，可逐词高亮）', v28480.wordLevel === true, v28480.wordLevel);
check('28480 行 timings 长度 = Array.from(text).length（码点口径）',
  v28480.timings.length === Array.from(text28480).length, v28480.timings.length);
const starts28480 = v28480.timings.map((x) => x.startMs);
check('28480 行 35 字 startMs 不倒序（允许同词内相等）',
  starts28480.every((s, i) => i === 0 || s >= starts28480[i - 1]), starts28480);
check('28480 行 真实字的时间点个数 = 7（每词一个时间点，不是逐字 35 个）',
  realStartsOf(v28480).length === 7, realStartsOf(v28480).length);
check('28480 行 thinking（8 字）共享 startMs = 28480（整词一起亮）',
  v28480.timings.slice(0, 8).every((x) => x.startMs === 28480),
  v28480.timings.slice(0, 8).map((x) => x.startMs));
check('28480 行 thinking（8 字）共享 endMs = 29480（= 下一词起点）',
  v28480.timings.slice(0, 8).every((x) => x.endMs === 29480),
  v28480.timings.slice(0, 8).map((x) => x.endMs));
check('28480 行 you（4 字）共享 startMs = 29480',
  v28480.timings.slice(8, 12).every((x) => x.startMs === 29480),
  v28480.timings.slice(8, 12).map((x) => x.startMs));
check('28480 行 you（4 字）共享 endMs = 29640（= 下一词起点）',
  v28480.timings.slice(8, 12).every((x) => x.endMs === 29640),
  v28480.timings.slice(8, 12).map((x) => x.endMs));
check('28480 行 边界：第 8 字（thinking 末字）endMs = 第 9 字（" you" 首字）startMs = 29480',
  v28480.timings[7].endMs === 29480 && v28480.timings[8].startMs === 29480,
  [v28480.timings[7].endMs, v28480.timings[8].startMs]);
check('28480 行 同词内不切分：thinking 8 字的 startMs/endMs 全等（不是逐字跳转）',
  v28480.timings.slice(0, 8).every((x) => x.startMs === 28480 && x.endMs === 29480),
  v28480.timings.slice(0, 8).map((x) => [x.startMs, x.endMs]));
check('28480 行 词起点不变：7 个词的首字 startMs = 官方 7 锚点',
  JSON.stringify(wordFirstStarts(v28480, ev28480)) === JSON.stringify(ANCHORS_28480),
  wordFirstStarts(v28480, ev28480));
check('28480 行 词间严格递增：相邻两词的首字 startMs 严格变大',
  wordFirstStarts(v28480, ev28480).every((s, i) => i === 0 || s > wordFirstStarts(v28480, ev28480)[i - 1]),
  wordFirstStarts(v28480, ev28480));
check('28480 行 词窗口首尾相接：每一词的末字 endMs = 下一词首字 startMs',
  ANCHORS_28480.slice(0, -1).every((a, i) => v28480.timings[wordLastIdxOf(ev28480)[i]].endMs === ANCHORS_28480[i + 1]),
  ANCHORS_28480.slice(0, -1).map((a, i) => v28480.timings[wordLastIdxOf(ev28480)[i]].endMs));
check('28480 行 末词（any，4 字）共享 [31439, 31920)：startMs 全等 31439，endMs 全等 31920',
  v28480.timings.slice(31, 35).every((x) => x.startMs === 31439 && x.endMs === 31920),
  v28480.timings.slice(31, 35).map((x) => [x.startMs, x.endMs]));

/* ── 6.5 英文行 t=90880：8 词 / 39 字 ── */
const ev90880 = lineAt(asrEn, 90880);
const text90880 = lineTextOf(ev90880);
const v90880 = buildAsrCharTimings(asrEn, ev90880.tStartMs, ev90880.tStartMs + ev90880.dDurationMs, text90880);
check('90880 行文本 = "make you cry never going to say goodbye"（39 字）',
  text90880 === 'make you cry never going to say goodbye' && text90880.length === 39, text90880);
check('90880 行官方 8 词锚点精确',
  JSON.stringify(anchorsOf(ev90880)) === JSON.stringify(ANCHORS_90880), anchorsOf(ev90880));
check('90880 行 source=offset / wordCount=8',
  v90880.source === 'offset' && v90880.wordCount === 8, [v90880.source, v90880.wordCount]);
check('90880 行 39 字全部 estimated=false（细分不改变来源判定）',
  estFalseCount(v90880) === 39, estFalseCount(v90880));
check('90880 行 charLevel=false（词级：同词字符共享时间点）', v90880.charLevel === false, v90880.charLevel);
check('90880 行 wordLevel=true（时间表来自官方词级时间戳，可逐词高亮）', v90880.wordLevel === true, v90880.wordLevel);

/* ── 6.5b 词级口径：8 词各自共享时间点 ── */
const starts90880 = v90880.timings.map((x) => x.startMs);
check('90880 行 39 字 startMs 不倒序（允许同词内相等）',
  starts90880.every((s, i) => i === 0 || s >= starts90880[i - 1]), starts90880);
check('90880 行 真实字的时间点个数 = 8（每词一个时间点，不是逐字 39 个）',
  realStartsOf(v90880).length === 8, realStartsOf(v90880).length);
check('90880 行 词起点不变：8 个词的首字 startMs = 官方 8 锚点',
  JSON.stringify(wordFirstStarts(v90880, ev90880)) === JSON.stringify(ANCHORS_90880),
  wordFirstStarts(v90880, ev90880));
check('90880 行 词间严格递增：相邻两词的首字 startMs 严格变大',
  wordFirstStarts(v90880, ev90880).every((s, i) => i === 0 || s > wordFirstStarts(v90880, ev90880)[i - 1]),
  wordFirstStarts(v90880, ev90880));
check('90880 行 make（4 字）共享 [90880, 91200)',
  v90880.timings.slice(0, 4).every((x) => x.startMs === 90880 && x.endMs === 91200),
  v90880.timings.slice(0, 4).map((x) => [x.startMs, x.endMs]));
check('90880 行 going（6 字）共享 [92520, 92600)（窄窗也整词一起亮）',
  v90880.timings.slice(18, 24).every((x) => x.startMs === 92520 && x.endMs === 92600),
  v90880.timings.slice(18, 24).map((x) => [x.startMs, x.endMs]));
check('90880 行 末词（goodbye，8 字）共享 [93439, 94360)',
  v90880.timings.slice(31, 39).every((x) => x.startMs === 93439 && x.endMs === 94360),
  v90880.timings.slice(31, 39).map((x) => [x.startMs, x.endMs]));
check('90880 行 词窗口首尾相接：每一词的末字 endMs = 下一词首字 startMs',
  ANCHORS_90880.slice(0, -1).every((a, i) => v90880.timings[wordLastIdxOf(ev90880)[i]].endMs === ANCHORS_90880[i + 1]),
  ANCHORS_90880.slice(0, -1).map((a, i) => v90880.timings[wordLastIdxOf(ev90880)[i]].endMs));

/* ── 6.6 inferAsrCharTimes 单锚点防假绿（同一 28480 行）── */
const inf28480 = inferAsrCharTimes(asrEn, ev28480.tStartMs, ev28480.tStartMs + ev28480.dDurationMs, text28480);
check('inferAsrCharTimes 在 28480 行 coverage 不再是 1.00', inf28480.coverage !== 1, inf28480.coverage);
check('inferAsrCharTimes 单锚点判 coverage=0（杜绝假绿）', inf28480.coverage === 0, inf28480.coverage);
check('inferAsrCharTimes 返回 distinctAnchors 字段（number）',
  'distinctAnchors' in inf28480 && typeof inf28480.distinctAnchors === 'number', inf28480.distinctAnchors);
check('inferAsrCharTimes distinctAnchors=1', inf28480.distinctAnchors === 1, inf28480.distinctAnchors);

/* ── 6.7 日文行 t=1079（仅 VyV7nxzYEqA 单样本实测，不外推）── */
const ev1079 = lineAt(asrJa, 1079);
const text1079 = lineTextOf(ev1079);
const v1079 = buildAsrCharTimings(asrJa, ev1079.tStartMs, ev1079.tStartMs + ev1079.dDurationMs, text1079);
check('JA 1079 行官方 7 词锚点 = 1079/1360/1719/2280/2520/3120/3320',
  JSON.stringify(anchorsOf(ev1079)) === JSON.stringify(ANCHORS_1079), anchorsOf(ev1079));
check('JA 1079 行 source=offset / wordCount=7',
  v1079.source === 'offset' && v1079.wordCount === 7, [v1079.source, v1079.wordCount]);
check('JA 1079 行 9 字全部 estimated=false（细分不改变来源判定）',
  estFalseCount(v1079) === 9, estFalseCount(v1079));
check('JA 1079 行 seg 无前导空格', ev1079.segs.every((s) => !/^\s/.test(s.utf8 || '')));
check('JA 1079 行 charLevel=false（词级：同词字符共享时间点）', v1079.charLevel === false, v1079.charLevel);
check('JA 1079 行 wordLevel=true（时间表来自官方词级时间戳，可逐词高亮）', v1079.wordLevel === true, v1079.wordLevel);

/* ── 6.7b 日文词级：词起点不变，同词字符共享时间点 ── */
const starts1079 = v1079.timings.map((x) => x.startMs);
check('JA 1079 行 9 字 startMs 不倒序（允许同词内相等）',
  starts1079.every((s, i) => i === 0 || s >= starts1079[i - 1]), starts1079);
check('JA 1079 行 真实字的时间点个数 = 7（每词一个时间点）',
  realStartsOf(v1079).length === 7, realStartsOf(v1079).length);
check('JA 1079 行 词起点不变：7 个词的首字 startMs = 官方 7 锚点',
  JSON.stringify(wordFirstStarts(v1079, ev1079)) === JSON.stringify(ANCHORS_1079),
  wordFirstStarts(v1079, ev1079));
check('JA 1079 行 词间严格递增：相邻两词的首字 startMs 严格变大',
  wordFirstStarts(v1079, ev1079).every((s, i) => i === 0 || s > wordFirstStarts(v1079, ev1079)[i - 1]),
  wordFirstStarts(v1079, ev1079));
check('JA 1079 行 始まり（3 字）共享 startMs = 1719（整词一起亮）',
  v1079.timings.slice(2, 5).every((x) => x.startMs === 1719),
  v1079.timings.slice(2, 5).map((x) => x.startMs));
check('JA 1079 行 始まり（3 字）共享 endMs = 2280（= 下一词起点）',
  v1079.timings.slice(2, 5).every((x) => x.endMs === 2280),
  v1079.timings.slice(2, 5).map((x) => x.endMs));
check('JA 1079 行 単字词的窗口 = 官方锚点差（夜 1079→1360 / に 3320→下一词起点）',
  v1079.timings[0].startMs === 1079 && v1079.timings[0].endMs === 1360 &&
  v1079.timings[1].startMs === 1360 && v1079.timings[1].endMs === 1719,
  [v1079.timings[0].startMs, v1079.timings[0].endMs, v1079.timings[1].startMs, v1079.timings[1].endMs]);
check('JA 1079 行 末词（に，1 字）startMs = 3320，endMs = 下一词起点 5000',
  v1079.timings[8].startMs === 3320 && v1079.timings[8].endMs === 5000,
  [v1079.timings[8].startMs, v1079.timings[8].endMs]);
check('JA 1079 行 词窗口首尾相接：每一词的末字 endMs = 下一词首字 startMs',
  ANCHORS_1079.slice(0, -1).every((a, i) => v1079.timings[wordLastIdxOf(ev1079)[i]].endMs === ANCHORS_1079[i + 1]),
  ANCHORS_1079.slice(0, -1).map((a, i) => v1079.timings[wordLastIdxOf(ev1079)[i]].endMs));

/* ── 6.8 [音楽] 非词汇标记：带偏移也不导致异常 ── */
const musicLine = lineAt(asrJa, 16359);
const musicText = lineTextOf(musicLine);
let musicThrew = null;
let vMusic = null;
try {
  vMusic = buildAsrCharTimings(asrJa, musicLine.tStartMs, musicLine.tStartMs + musicLine.dDurationMs, musicText);
} catch (err) {
  musicThrew = err;
}
check('JA 含 [音楽] 标记且该标记自带 tOffsetMs', musicLine.segs.some((s) => s.utf8.includes('[音楽]') && typeof s.tOffsetMs === 'number'));
check('JA 含 [音楽] 标记的行不抛异常且仍走 offset（timings 与文本等长）',
  musicThrew === null && vMusic !== null && vMusic.source === 'offset' && vMusic.timings.length === musicText.length,
  musicThrew ? musicThrew.message : (vMusic && [vMusic.source, vMusic.timings.length, musicText.length]));

/* ── 6.9 跨 event 拼接：一句覆盖多个 event ── */
const enLines = textLinesOf(asrEn);
const i28480 = enLines.findIndex((e) => e.tStartMs === 28480);
const lineA = enLines[i28480];
const lineB = enLines[i28480 + 1];
const mergedText = lineTextOf(lineA) + ' ' + lineTextOf(lineB);
const vMerged = buildAsrCharTimings(asrEn, lineA.tStartMs, lineB.tStartMs + lineB.dDurationMs, mergedText);
check('跨 event 合并句（28480 + 31920 两行）source=offset', vMerged.source === 'offset', vMerged.source);
check('跨 event 合并句 wordCount(16) > 任一单 event 词数(7/9)',
  vMerged.wordCount > lineA.segs.length && vMerged.wordCount > lineB.segs.length,
  [vMerged.wordCount, lineA.segs.length, lineB.segs.length]);

/* ── 6.10 完整管线汇总：extractCaptionTokens → segmentCaptionTokens → timings ── */
const enSentences = segmentCaptionTokens(extractCaptionTokens(asrEn), DEFAULT_SETTINGS);
let enOffset = 0, enWordAnchors = 0;
for (const s of enSentences) {
  const v = buildAsrCharTimings(asrEn, s.start, s.end, s.text);
  if (v.source === 'offset') enOffset++;
  enWordAnchors += v.wordCount;
}
check('英文完整管线断出 30 句', enSentences.length === 30, enSentences.length);
check('英文完整管线 30/30 句走 offset（改前仅 3/30）', enOffset === 30, enOffset);
check('英文完整管线官方词锚点合计 366（改前 26）', enWordAnchors === 366, enWordAnchors);
const jaSentences = segmentCaptionTokens(extractCaptionTokens(asrJa), DEFAULT_SETTINGS);
let jaOffset = 0;
for (const s of jaSentences) {
  if (buildAsrCharTimings(asrJa, s.start, s.end, s.text).source === 'offset') jaOffset++;
}
check('日文单样本 VyV7nxzYEqA 完整管线断出 17 句', jaSentences.length === 17, jaSentences.length);
check('日文单样本 16/17 句走 offset（仅此 1 个样本实测，不外推所有日文 ASR 轨）',
  jaOffset === 16, jaOffset);

/* ── 6.11 歌词轨夹具回归：A 机制不因 B/C 的 offset 路由而变化 ── */
const { lines: lyricLines } = dedupeLyricEvents(lyricFixture);
const lyricRainbow = lyricLines.find((l) => l.text === 'Okay, be there be there back to');
const lyricColors = extractLineColors(lyricFixture, lyricRainbow);
const vLyric = buildAsrCharTimings(lyricFixture, lyricRainbow.startMs, lyricRainbow.endMs, lyricRainbow.text);
check('歌词轨夹具：去重后 62 行不变', lyricLines.length === 62, lyricLines.length);
check('歌词轨夹具：tOffsetMs 全 0 → buildAsrCharTimings 不走 offset（wordCount=0）',
  vLyric.source !== 'offset' && vLyric.wordCount === 0, [vLyric.source, vLyric.wordCount]);
check('歌词轨夹具：extractLineColors 彩虹行首色 #37BABA 不变',
  lyricColors.colors[0] === '#37BABA', lyricColors.colors[0]);
check('歌词轨夹具：彩虹行 3 轮着色 / 窗口 12830–15532 不变',
  lyricColors.passCount === 3 && lyricColors.windowStartMs === 12830 && lyricColors.windowEndMs === 15532,
  [lyricColors.passCount, lyricColors.windowStartMs, lyricColors.windowEndMs]);
let lyricColored = 0;
for (const l of lyricLines) if (extractLineColors(lyricFixture, l).colors.some(Boolean)) lyricColored++;
check('歌词轨夹具：笔色命中行数 >= 55（实测 58）不变', lyricColored >= 55, lyricColored);
const lyricFace = lyricLines.find((l) => l.text === '反射するface');
const lyricFaceColors = extractLineColors(lyricFixture, lyricFace);
check('歌词轨夹具：单色行 #F58017 / 首帧非白 18168 不变',
  lyricFaceColors.mainColor === '#F58017' && lyricFaceColors.startMs[0] === 18168,
  [lyricFaceColors.mainColor, lyricFaceColors.startMs[0]]);

/* ── 6.12 无 pens / 无 tOffsetMs 的普通 CC：行为与旧版一致（均分兜底）── */
const plainCc = {
  events: [
    { tStartMs: 1000, dDurationMs: 3000, segs: [{ utf8: 'hello there general kenobi' }] },
    { tStartMs: 4200, dDurationMs: 3000, segs: [{ utf8: 'a surprise to be sure' }] }
  ]
};
const plainText = 'Hello there general kenobi.';
const vPlain = buildAsrCharTimings(plainCc, 1000, 4000, plainText);
check('无 pens / 无 tOffsetMs 的普通 CC：source=estimated', vPlain.source === 'estimated', vPlain.source);
check('普通 CC：全部 estimated=true（行为与旧版一致）',
  vPlain.timings.every((x) => x.estimated === true), estFalseCount(vPlain));
check('普通 CC：coverage=0 / distinctAnchors=0 / wordCount=0',
  vPlain.coverage === 0 && vPlain.distinctAnchors === 0 && vPlain.wordCount === 0,
  [vPlain.coverage, vPlain.distinctAnchors, vPlain.wordCount]);
check('普通 CC：仍返回与文本等长的均分时间表', vPlain.timings.length === plainText.length, vPlain.timings.length);
check('普通 CC（estimated 分支）charLevel=true（本来就是字级）',
  vPlain.charLevel === true, vPlain.charLevel);
check('普通 CC（estimated 分支）wordLevel=false（没有官方词级时间戳，不能逐词高亮）',
  vPlain.wordLevel === false, vPlain.wordLevel);
const plainOneFrame = {
  pens: [{}],
  events: [{ tStartMs: 1000, dDurationMs: 3000, segs: [{ utf8: '今天天气不错' }] }]
};
const infOneFrame = inferAsrCharTimes(plainOneFrame, 1000, 4000, '今天天气不错');
check('普通 CC 单帧全句前缀：单锚点 coverage 强制 0（不再是 1.00 假绿）',
  infOneFrame.coverage === 0 && infOneFrame.distinctAnchors === 1,
  [infOneFrame.coverage, infOneFrame.distinctAnchors]);
const vInferred = buildAsrCharTimings(plainOneFrame, 1000, 4000, '今天天气不错');
check('inferred 分支行为不变：source=inferred / coverage=0（单锚点）/ wordCount=0',
  vInferred.source === 'inferred' && vInferred.coverage === 0 && vInferred.wordCount === 0,
  [vInferred.source, vInferred.coverage, vInferred.wordCount]);
check('inferred 分支 charLevel=true / 字数不变 / 仍严格递增',
  vInferred.charLevel === true && vInferred.timings.length === 6 &&
  vInferred.timings.every((x, i) => i === 0 || x.startMs > vInferred.timings[i - 1].startMs),
  [vInferred.charLevel, vInferred.timings.length]);
check('inferred 分支 wordLevel=false（帧前缀推断不是官方词级时间戳）',
  vInferred.wordLevel === false, vInferred.wordLevel);

/* ── 6.13 词级口径总契约（完整管线 + 三分支一致性）── */
const pipeVerdicts = [];
for (const s of enSentences) pipeVerdicts.push({ s, v: buildAsrCharTimings(asrEn, s.start, s.end, s.text) });
for (const s of jaSentences) pipeVerdicts.push({ s, v: buildAsrCharTimings(asrJa, s.start, s.end, s.text) });
const pipeOffset = pipeVerdicts.filter((x) => x.v.source === 'offset');

check('wordLevel 恒等于 (source === "offset")：英文 30 句 + 日文 17 句全部成立',
  pipeVerdicts.every((x) => x.v.wordLevel === (x.v.source === 'offset')),
  pipeVerdicts.filter((x) => x.v.wordLevel !== (x.v.source === 'offset')).length);
check('wordLevel=true 的句数 = offset 句数（英文 30 + 日文 16 = 46）',
  pipeOffset.length === 46 && pipeOffset.every((x) => x.v.wordLevel === true),
  [pipeOffset.length, pipeOffset.filter((x) => x.v.wordLevel === true).length]);
check('charLevel 在 offset 分支恒为 false（词级：同词共享时间点）',
  pipeOffset.every((x) => x.v.charLevel === false),
  pipeOffset.filter((x) => x.v.charLevel !== false).length);
check('charLevel 在非 offset 分支恒为 true（inferred / estimated 本来就是字级）',
  pipeVerdicts.filter((x) => x.v.source !== 'offset').every((x) => x.v.charLevel === true),
  pipeVerdicts.filter((x) => x.v.source !== 'offset' && x.v.charLevel !== true).length);
check('完整管线：每句 timings.length === Array.from(text).length（码点口径不变）',
  pipeVerdicts.every((x) => x.v.timings.length === Array.from(x.s.text).length),
  pipeVerdicts.filter((x) => x.v.timings.length !== Array.from(x.s.text).length).length);
check('完整管线：整句 startMs 不倒序（词级共享允许同词内相等）',
  pipeVerdicts.every((x) => x.v.timings.every((t, i) => i === 0 || t.startMs >= x.v.timings[i - 1].startMs)),
  pipeVerdicts.filter((x) => !x.v.timings.every((t, i) => i === 0 || t.startMs >= x.v.timings[i - 1].startMs)).length);
check('完整管线：offset 句的真实字时间点个数 = wordCount（同词共享，一个词一个时间点）',
  pipeOffset.every((x) => new Set(x.v.timings.filter((t) => !t.estimated).map((t) => t.startMs)).size === x.v.wordCount),
  pipeOffset.filter((x) => new Set(x.v.timings.filter((t) => !t.estimated).map((t) => t.startMs)).size !== x.v.wordCount).length);
check('完整管线：offset 句的真实字数 = 命中词覆盖的字符数（词级不丢字）',
  pipeOffset.every((x) => x.v.timings.filter((t) => !t.estimated).length >= x.v.wordCount),
  pipeOffset.filter((x) => x.v.timings.filter((t) => !t.estimated).length < x.v.wordCount).length);
check('完整管线：offset 句的真实字 startMs 全部落在官方词锚点上（不臆造时间）',
  pipeOffset.every((x) => x.v.timings.filter((t) => !t.estimated)
    .every((t) => Number.isInteger(t.startMs) && t.startMs >= 0)),
  pipeOffset.filter((x) => x.v.timings.filter((t) => !t.estimated)
    .some((t) => !Number.isInteger(t.startMs) || t.startMs < 0)).length);
check('完整管线：offset 句每字 endMs > startMs（词窗口零长时兜底 +1ms）',
  pipeOffset.every((x) => x.v.timings.every((t) => t.endMs > t.startMs)),
  pipeOffset.filter((x) => !x.v.timings.every((t) => t.endMs > t.startMs)).length);

/* ── 6.14 词级高亮配色设置（供渲染层 / 设置页使用）── */
check('默认 wordHighlightColor = \'\'（空串 = 跟随用户的原文色）',
  DEFAULT_SETTINGS.wordHighlightColor === '', DEFAULT_SETTINGS.wordHighlightColor);
check('默认 wordHighlightTransColor = \'\'（空串 = 跟随用户的译文色）',
  DEFAULT_SETTINGS.wordHighlightTransColor === '', DEFAULT_SETTINGS.wordHighlightTransColor);
check('新增 wordHighlightColor 不动既有默认值（lyricKaraoke / asrWordReveal 仍为 true）',
  DEFAULT_SETTINGS.lyricKaraoke === true && DEFAULT_SETTINGS.asrWordReveal === true,
  [DEFAULT_SETTINGS.lyricKaraoke, DEFAULT_SETTINGS.asrWordReveal]);

console.log(`\n汇总: ${passed} 通过, ${failed.length} 失败`);
assert.equal(failed.length, 0, `ASR 时间推断有 ${failed.length} 项失败：\n` + failed.map((m) => '  ✗ ' + m).join('\n'));
console.log('ASR 时间推断测试全部通过');
