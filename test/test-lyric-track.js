import assert from 'node:assert/strict';
import fs from 'node:fs';
import {
  countInvisible,
  hasInvisible,
  removeInvisible,
  stripInvisible
} from '../utils/invisible-text.ts';
import {
  attachCharColors,
  buildLineCharTimings,
  charWeight,
  dedupeLyricEvents,
  detectKaraokeHighlight,
  detectLyricTrack,
  estimateCharTimings,
  extractLineColors,
  lyricKeyOf,
  readPenColor,
  stripRuby,
  toCaptionData,
  UNSUNG_COLOR
} from '../utils/lyric-track.ts';

/**
 * 歌词轨（逐词字幕）纯逻辑层测试 —— 任务一
 *
 * 口径：本文件只看 `npm test` 退出码。计数打印，失败项最后由 node:assert 抛错收口
 * （不用 console.assert —— 它在 Node 里失败只打印一行、不改退出码，会造成假绿）。
 *
 * 夹具来源（**事实，不是构造**）：
 *   test/fixtures/lyric-track-sample.json
 *   = D:\edge\_ui\yt-probe\captured.json 里那条 848KB json3 的**紧凑化**版本
 *     （event 保留 tStartMs / dDurationMs / segs[].utf8 / segs[].pPenId；
 *      顶层补齐 `pens`，但每支笔**只留 fcForeColor**、索引与原始数组严格一致、
 *      第 0 支保留为 `{}`；wsWinStyles / wpWinPositions 仍未收录。
 *      event 数 1238、seg 数 14288 与原始响应完全一致）。
 *   视频：hololive FLOW GLOW《BOUNCE BACK！》官方 MV，asr 轨 a.ja。
 *
 * ⚠️ v0.5.0 数据层纠正：json3 **有**颜色字段（`pens[i].fcForeColor`，231 支），
 *    「颜色只能由播放器端渲染」这个早期结论是错的。第 10 节按真实笔色跑断言。
 *   视频：hololive FLOW GLOW《BOUNCE BACK！》官方 MV，asr 轨 a.ja。
 */

let passed = 0;
const failedItems = [];
function check(name, cond, detail) {
  if (cond) {
    passed++;
    console.log(`  ✓ ${name}`);
  } else {
    const msg = `${name}${detail !== undefined ? ' => ' + detail : ''}`;
    failedItems.push(msg);
    console.error(`  ✗ ${msg}`);
  }
}

function readFixture() {
  const url = new URL('./fixtures/lyric-track-sample.json', import.meta.url);
  return JSON.parse(fs.readFileSync(url, 'utf8'));
}

/* ============================================================================
 * 1. 不可见字符清洗
 * ==========================================================================*/
console.log('--- 1. 不可见字符清洗（stripInvisible / hasInvisible）---');

const ZW = '\u200B';
const ALL_INVISIBLE = '\u200B\u200C\u200D\u200E\u200F\uFEFF\u2060';

check('七种不可见字符都能被剥掉', stripInvisible(ALL_INVISIBLE) === '', JSON.stringify(stripInvisible(ALL_INVISIBLE)));
check('零宽嵌在词中间 → 拼回完整词', stripInvisible(`O${ZW}k${ZW}ay`) === 'Okay');
check('hasInvisible 能识别 U+200B', hasInvisible(`a${ZW}b`) === true);
check('hasInvisible 对干净文本为 false', hasInvisible(' Okay, be there ') === false);
check('hasInvisible 空串为 false', hasInvisible('') === false);
check('countInvisible 精确计数', countInvisible(`${ZW}a${ZW}${ZW}b`) === 3, countInvisible(`${ZW}a${ZW}${ZW}b`));
check('连续空白压成一个', stripInvisible('a    b \t c') === 'a b c');
check('首尾空白被去掉', stripInvisible('   hi   ') === 'hi');
check('全角空格 U+3000 归一成半角空格', stripInvisible('あ\u3000\u3000い') === 'あ い');
check('CJK 文本不被破坏', stripInvisible(`${ZW}輝(かがや)くstage${ZW}`) === '輝(かがや)くstage');
check('标点原样保留（标点修补归断句层）', stripInvisible('これ、それ。') === 'これ、それ。');
check('空白不足时不会留下多个空格', stripInvisible(`${ZW}  ${ZW}`) === '');
check('removeInvisible 不动空白（字符下标对齐用）', removeInvisible(' a  b ') === ' a  b ');

/* ============================================================================
 * 2. 歌词轨识别：实测样本
 * ==========================================================================*/
console.log('--- 2. 歌词轨识别：实测样本（1238 event 的 karaoke 轨）---');

const fixture = readFixture();
const verdict = detectLyricTrack(fixture, { kind: 'asr', vssId: 'a.ja' });
const s = verdict.stats;

check('isLyric === true', verdict.isLyric === true, `confidence=${verdict.confidence}`);
check('confidence >= 0.6', verdict.confidence >= 0.6, `实际 ${verdict.confidence.toFixed(3)}`);
check('stats.events === 1238', s.events === 1238, s.events);
check('uniqueRatio < 0.35', s.uniqueRatio < 0.35, s.uniqueRatio.toFixed(4));
check('uniqueRatio 落在 0.05 附近（62/1238）', Math.abs(s.uniqueRatio - 0.0501) < 0.002, s.uniqueRatio.toFixed(4));
check('invisibleRatio > 0.03', s.invisibleRatio > 0.03, s.invisibleRatio.toFixed(4));
check('invisibleRatio 落在 0.229 附近（8966/39208）', Math.abs(s.invisibleRatio - 0.2287) < 0.002, s.invisibleRatio.toFixed(4));
check('avgEventMs < 900', s.avgEventMs < 900, s.avgEventMs.toFixed(1));
check('avgEventMs 落在 370ms 附近', Math.abs(s.avgEventMs - 370) < 5, s.avgEventMs.toFixed(1));
check('eventsPerSec > 3', s.eventsPerSec > 3, s.eventsPerSec.toFixed(2));
check('segsWithOffset === 0（没有真实字级时间）', s.segsWithOffset === 0, s.segsWithOffset);
check('平均 seg/event >= 3（看起来像逐词轨）', s.segsPerEvent >= 3, s.segsPerEvent.toFixed(1));
check('命中信号数 >= 3', verdict.signals.filter((x) => x.hit).length >= 3, verdict.signals.filter((x) => x.hit).length);

console.log('  信号命中表：');
for (const sig of verdict.signals) {
  console.log(
    `    ${sig.hit ? '●' : '○'} ${sig.key.padEnd(18)} w=${sig.weight} value=${Number(sig.value).toFixed(3)}  ${sig.detail}`
  );
}
console.log(`    置信度 = ${(verdict.confidence * 100).toFixed(1)}%（权重和 / 13）`);

/* ============================================================================
 * 3. 歌词轨识别：普通 VOD 反例
 * ==========================================================================*/
console.log('--- 3. 歌词轨识别：普通 VOD 反例（必须判 false）---');

// 3a. 手工轨：60 秒 4 句，唯一文本、无零宽、每句 3 秒左右
const normalManual = {
  wireMagic: 'pb3',
  events: [
    { tStartMs: 0, dDurationMs: 3000, segs: [{ utf8: 'Welcome back to the channel.' }] },
    { tStartMs: 3200, dDurationMs: 3400, segs: [{ utf8: 'Today we are going to talk about' }, { utf8: ' the new release.' }] },
    { tStartMs: 7000, dDurationMs: 2800, segs: [{ utf8: 'It came out last week and it is' }, { utf8: ' quite popular.' }] },
    { tStartMs: 10200, dDurationMs: 3600, segs: [{ utf8: 'Let me know what you think in the comments.' }] }
  ]
};
const vManual = detectLyricTrack(normalManual, { kind: 'manual', vssId: '.en' });
check('普通手工 CC → isLyric === false', vManual.isLyric === false, `confidence=${vManual.confidence.toFixed(3)}`);
check('普通手工 CC → 命中信号 < 3', vManual.signals.filter((x) => x.hit).length < 3, vManual.signals.filter((x) => x.hit).length);
check('普通手工 CC → uniqueRatio === 1', vManual.stats.uniqueRatio === 1, vManual.stats.uniqueRatio);
check('普通手工 CC → invisibleRatio === 0', vManual.stats.invisibleRatio === 0);

// 3b. 自动生成轨（真实字级 tOffsetMs 齐全）：这类轨很常见，绝不能被当成歌词轨
const asrEvents = [];
for (let i = 0; i < 40; i++) {
  const words = `the lecture continues with topic number ${i}`.split(' ');
  const segs = words.map((w, k) => ({ utf8: (k === 0 ? '' : ' ') + w, tOffsetMs: k * 300 }));
  asrEvents.push({ tStartMs: i * 5000, dDurationMs: 2600, segs });
}
const normalAsr = { events: asrEvents };
const vAsr = detectLyricTrack(normalAsr, { kind: 'asr', vssId: 'a.en' });
check('普通 ASR 轨（有真实 tOffsetMs）→ isLyric === false', vAsr.isLyric === false, `confidence=${vAsr.confidence.toFixed(3)}`);
check('普通 ASR 轨 → no-char-time 未命中', vAsr.signals.find((x) => x.key === 'no-char-time').hit === false);
check('普通 ASR 轨 → asr-kind 命中（但权重不足以判歌词）', vAsr.signals.find((x) => x.key === 'asr-kind').hit === true);

// 3c. 空轨 / 0 字节响应（实测里 `fmt=srv3` 会返回 200 + 0 字节）
const vEmpty = detectLyricTrack({});
check('空轨 → isLyric === false', vEmpty.isLyric === false);
check('空轨 → confidence === 0', vEmpty.confidence === 0);
check('空轨 → events === 0', vEmpty.stats.events === 0);

// 3d. 边界：1.5 秒里塞 6 句正常短句 —— 密度/短句信号会命中，但没有重复，不足以判歌词
const shortClipEvents = [];
for (let i = 0; i < 6; i++) {
  shortClipEvents.push({
    tStartMs: i * 260,
    dDurationMs: 250,
    segs: [{ utf8: ['one', 'two', 'three', 'four', 'five', 'six'][i] }]
  });
}
const shortClip = { events: shortClipEvents };
const vShort = detectLyricTrack(shortClip);
check('高密度但唯一文本的短片段 → isLyric === false', vShort.isLyric === false, `confidence=${vShort.confidence.toFixed(3)}`);
check('高密度但唯一文本的短片段 → time-density 命中', vShort.signals.find((x) => x.key === 'time-density').hit === true);
check('高密度但唯一文本的短片段 → repeat-ratio 未命中', vShort.signals.find((x) => x.key === 'repeat-ratio').hit === false);

/* ============================================================================
 * 4. 去重与合并
 * ==========================================================================*/
console.log('--- 4. 去重与合并（1238 event → 62 行）---');

const dedupe = dedupeLyricEvents(fixture);
const lines = dedupe.lines;

check('去重后条数落在 62 ± 3', lines.length >= 59 && lines.length <= 65, lines.length);
check('去重后条数 === 62', lines.length === 62, lines.length);
check('inputEvents === 1238', dedupe.stats.inputEvents === 1238, dedupe.stats.inputEvents);
check('没有 event 因纯零宽被丢弃', dedupe.stats.skippedEmpty === 0, dedupe.stats.skippedEmpty);
check('折叠率 > 0.9', dedupe.stats.collapsedRatio > 0.9, dedupe.stats.collapsedRatio.toFixed(4));
check('所有行文本零宽全清（hasInvisible 全 false）', lines.every((l) => !hasInvisible(l.text)));
check('所有行文本不含 U+200B', lines.every((l) => !l.text.includes('\u200B')));
check('所有行文本无首尾空白', lines.every((l) => l.text === l.text.trim()));
check('所有行 occurrences 升序', lines.every((l) => l.occurrences.every((v, i) => i === 0 || v >= l.occurrences[i - 1])));
check(
  'occurrences 总数 === 1238（一个 event 都没丢）',
  lines.reduce((acc, l) => acc + l.occurrences.length, 0) === 1238,
  lines.reduce((acc, l) => acc + l.occurrences.length, 0)
);
check('eventCount 总和 === 1238', lines.reduce((acc, l) => acc + l.eventCount, 0) === 1238);
check('第一行 startMs === 7524', lines[0].startMs === 7524, lines[0].startMs);
check('第一行文本 === "Okay, be there be there back to"', lines[0].text === 'Okay, be there be there back to', lines[0].text);
check('第一行是重复行（occurrences 48）', lines[0].occurrences.length === 48, lines[0].occurrences.length);
check('去重后行按 startMs 升序', lines.every((l, i) => i === 0 || l.startMs >= lines[i - 1].startMs));
check('每行 endMs > startMs', lines.every((l) => l.endMs > l.startMs));
check(
  '没有任何一行被副歌重复撑成 >15s 的长句',
  lines.every((l) => l.endMs - l.startMs <= 15000),
  Math.max(...lines.map((l) => l.endMs - l.startMs))
);
check(
  '存在多段显示的行（副歌重复出现）',
  lines.filter((l) => l.displays.length > 1).length > 0,
  lines.filter((l) => l.displays.length > 1).length
);
check('总显示段数 === 143', dedupe.stats.displays === 143, dedupe.stats.displays);
check(
  '同一行的多段显示不重叠',
  lines.every((l) => l.displays.every((d, i) => i === 0 || d.startMs >= l.displays[i - 1].endMs))
);
check('最长文本被选中且 ruby 已剥离（反射するface）', lines.some((l) => l.text === '反射するface'));

// 比较键：尾标点不参与比较
check('尾标点不进比较键', lyricKeyOf('Hello, world!') === 'Hello, world');
check('零宽不进比较键', lyricKeyOf('Hel\u200Blo') === 'Hello');
check('句中逗号保留在键里', lyricKeyOf('a, b') === 'a, b');

const captionData = toCaptionData(lines);
check('toCaptionData 形状 = Json3CaptionData', Array.isArray(captionData.events) && captionData.wireMagic === 'pb3');
check('toCaptionData 一段显示一个 event（143）', captionData.events.length === 143, captionData.events.length);
check('toCaptionData 按时间升序', captionData.events.every((e, i) => i === 0 || e.tStartMs >= captionData.events[i - 1].tStartMs));
check('toCaptionData 每 event 只有一个 seg', captionData.events.every((e) => e.segs.length === 1));
check('toCaptionData 每 event dDurationMs > 0', captionData.events.every((e) => e.dDurationMs > 0));
check('toCaptionData perLine 模式 = 62', toCaptionData(lines, { perLine: true }).events.length === 62);

/* ============================================================================
 * 5. 字符级时间估算
 * ==========================================================================*/
console.log('--- 5. 字符级时间估算（权重均分，无真实字级时间）---');

function assertContiguous(timings, startMs, endMs, label) {
  const problems = [];
  if (timings.length === 0) problems.push('空结果');
  if (timings.length > 0 && timings[0].startMs !== startMs) problems.push(`首片 start ${timings[0].startMs} ≠ ${startMs}`);
  if (timings.length > 0 && timings[timings.length - 1].endMs !== endMs) {
    problems.push(`末片 end ${timings[timings.length - 1].endMs} ≠ ${endMs}`);
  }
  for (let i = 0; i < timings.length; i++) {
    if (timings[i].endMs <= timings[i].startMs) problems.push(`第 ${i} 片时长为 0`);
    if (i > 0 && timings[i].startMs !== timings[i - 1].endMs) problems.push(`第 ${i} 片与前一片之间有缝`);
  }
  check(`${label}：连续、无重叠、严格递增、首尾对齐句边界`, problems.length === 0, problems.join('; '));
  check(`${label}：总时长 === 句时长`, timings.reduce((a, t) => a + (t.endMs - t.startMs), 0) === endMs - startMs);
}

// 5a. 实测样本前三句（用真实行 + 真实显示段）
const firstThree = lines.slice(0, 3);
for (const line of firstThree) {
  const d = line.displays[0];
  const timings = buildLineCharTimings(line, d);
  check(`「${line.text.slice(0, 12)}…」逐字片数 = 字符数`, timings.length === Array.from(line.text).length, `${timings.length} vs ${Array.from(line.text).length}`);
  check(`「${line.text.slice(0, 12)}…」全部标为 estimated`, timings.every((t) => t.estimated === true));
  assertContiguous(timings, d.startMs, d.endMs, `「${line.text.slice(0, 12)}…」`);
}

// 5b. 短句走整片分支
const shortSpan = estimateCharTimings({ text: 'そうだよ', startMs: 1000, endMs: 1300 });
check('时长 < 400ms → 整句一个时间片', shortSpan.length === 1, shortSpan.length);
check('短句整片的 char 是整句文本', shortSpan[0].char === 'そうだよ', shortSpan[0].char);
check('短句整片覆盖整个句区间', shortSpan[0].startMs === 1000 && shortSpan[0].endMs === 1300);
check('短句整片 estimated === true', shortSpan[0].estimated === true);

const twoChars = estimateCharTimings({ text: 'OK', startMs: 0, endMs: 2000 });
check('字符数 < 3 → 整句一个时间片', twoChars.length === 1 && twoChars[0].char === 'OK');

const emptyTimings = estimateCharTimings({ text: '', startMs: 0, endMs: 1000 });
check('空文本 → 空结果', emptyTimings.length === 0);

// 5c. 权重表本身
check('CJK 权重 1.0', charWeight('漢') === 1.0);
check('假名权重 1.0', charWeight('か') === 1.0);
check('拉丁字母权重 0.55', charWeight('a') === 0.55);
check('数字权重 0.6', charWeight('7') === 0.6);
check('半角空格权重 0.25', charWeight(' ') === 0.25);
check('全角空格权重也是 0.25', charWeight('\u3000') === 0.25);
check('句号权重 0.15', charWeight('。') === 0.15);
check('逗号权重 0.15', charWeight(',') === 0.15);
check('全角波浪号按符号 0.15', charWeight('～') === 0.15);

// 5d. CJK 句比拉丁句更均匀（同句时长下的变异系数）
function cv(timings) {
  const durs = timings.map((t) => t.endMs - t.startMs);
  const mean = durs.reduce((a, b) => a + b, 0) / durs.length;
  const varr = durs.reduce((a, b) => a + (b - mean) ** 2, 0) / durs.length;
  return Math.sqrt(varr) / mean;
}
const cjkTimings = estimateCharTimings({ text: '輝くステージで踊ろう', startMs: 0, endMs: 2000 });
const latinTimings = estimateCharTimings({ text: 'Hello world tonight', startMs: 0, endMs: 2000 });
const cvCjk = cv(cjkTimings);
const cvLatin = cv(latinTimings);
console.log(`    变异系数：CJK ${cvCjk.toFixed(4)} / 拉丁 ${cvLatin.toFixed(4)}（越小越均匀）`);
check('CJK 句逐字时间比拉丁句更均匀（cv 更小）', cvCjk < cvLatin, `${cvCjk.toFixed(4)} vs ${cvLatin.toFixed(4)}`);
check('CJK 句 cv < 0.02（几乎等分）', cvCjk < 0.02, cvCjk.toFixed(4));
check('拉丁句 cv > 0.1（空格/标点明显更短）', cvLatin > 0.1, cvLatin.toFixed(4));
check(
  'CJK 句每个字符时长差 ≤ 1ms',
  Math.max(...cjkTimings.map((t) => t.endMs - t.startMs)) - Math.min(...cjkTimings.map((t) => t.endMs - t.startMs)) <= 1
);
assertContiguous(cjkTimings, 0, 2000, 'CJK 等分句');
assertContiguous(latinTimings, 0, 2000, '拉丁句');

// 5e. 真实 tOffsetMs 分支（未来轨真带字级时间时）
const realSegs = [
  { utf8: 'こ', tOffsetMs: 0 },
  { utf8: 'ん', tOffsetMs: 250 },
  { utf8: 'に', tOffsetMs: 500 },
  { utf8: 'ち', tOffsetMs: 750 },
  { utf8: 'は', tOffsetMs: 1000 }
];
const realTimings = estimateCharTimings({ text: 'こんにちは', startMs: 10000, endMs: 13000, segs: realSegs });
check('有真实 tOffsetMs → estimated === false', realTimings.every((t) => t.estimated === false));
check('真实偏移逐字一 片（5 片）', realTimings.length === 5, realTimings.length);
check('第 1 片 start = 句 start + 0', realTimings[0].startMs === 10000, realTimings[0].startMs);
check('第 3 片 start = 句 start + 500', realTimings[2].startMs === 10500, realTimings[2].startMs);
check('末片 end = 句 end', realTimings[4].endMs === 13000, realTimings[4].endMs);
assertContiguous(realTimings, 10000, 13000, '真实偏移句');

// seg 内多字符且区间够宽 → 段内仍按权重切，但整句仍标 estimated:false（有真实锚点）
const wideSegs = [
  { utf8: 'あい', tOffsetMs: 0 },
  { utf8: 'うえ', tOffsetMs: 1000 }
];
const wideTimings = estimateCharTimings({ text: 'あい うえ'.replace(' ', ''), startMs: 0, endMs: 2000, segs: wideSegs });
check('段内多字符也能逐字切（4 片）', wideTimings.length === 4, wideTimings.length);
check('段内切分沿用真实锚点', wideTimings[2].startMs === 1000, wideTimings[2].startMs);
check('段内切分 estimated === false', wideTimings.every((t) => t.estimated === false));
assertContiguous(wideTimings, 0, 2000, '段内切分句');

// 5f. 极端兜底：时长不够逐字时不伪造字边界
const tight = estimateCharTimings({ text: '一二三四五六七八九十', startMs: 0, endMs: 405 });
check('405ms / 10 字 仍可逐字（每片 ≥1ms）', tight.length === 10, tight.length);
assertContiguous(tight, 0, 405, '极窄区间句');

/* ============================================================================
 * 6. 可视化：实测样本前 3 句的字符时间表
 * ==========================================================================*/
console.log('--- 6. 实测样本前 3 句字符时间表（相对句首，单位 ms）---');
for (const line of firstThree) {
  const d = line.displays[0];
  const timings = buildLineCharTimings(line, d);
  console.log(
    `\n  行「${line.text}」  ${d.startMs}–${d.endMs}ms（${d.endMs - d.startMs}ms, ${d.frameCount} 帧）`
  );
  let row = '   ';
  for (const t of timings) {
    const label = t.char === ' ' ? '␠' : t.char;
    row += `${label}[${t.startMs - d.startMs}-${t.endMs - d.startMs}) `;
    if (row.length > 96) {
      console.log(row);
      row = '   ';
    }
  }
  if (row.trim()) console.log(row);
}

/* ============================================================================
 * 8. 「当前字高亮」自动检测（v0.5.0，判据已修正一次）
 *
 * 第一版拿「同一 tStartMs 两条同文本、笔号不同」当已唱/未唱，是错的：
 * 那些 event 文本完全相同、seg 切分也相同，只有笔号整体 +2 —— 是「正文/次要样式」。
 * 笔号真正区分的是字符角色（ruby 行：正文 99 / 括号 100 / 假名 101）。
 * 现在只认「文本互补（互为前缀）+ 笔组不同」= 已唱/未唱被拆开下发。
 * ==========================================================================*/
console.log('--- 8. 当前字高亮自动检测（detectKaraokeHighlight）---');
{
  const sample = readFixture();

  // 这条轨：606 个同文本双套、互补 0 个 → 没有逐字高亮
  const hl = detectKaraokeHighlight(sample);
  check('实测样本判定为「没有逐字高亮」（同文本双套不算）', hl.hasHighlight === false, JSON.stringify(hl));
  check('互补成对 == 0（该轨没有已唱/未唱拆分）', hl.complementaryEvents === 0, hl.complementaryEvents);
  check('同文本双套 == 606（笔号整体 +2，属样式而非进度）', hl.sameTextPairs === 606, hl.sameTextPairs);
  check('detail 是可读人话', /互补成对 \d+\/\d+/.test(hl.detail), hl.detail);

  // 正例：构造一条真正的卡拉OK —— 同刻两条 event 文本互补、笔组不同
  const karaoke = {
    events: [
      { tStartMs: 1000, dDurationMs: 800, segs: [{ utf8: 'Hello', pPenId: 5 }] },
      { tStartMs: 1000, dDurationMs: 800, segs: [{ utf8: 'Hello world', pPenId: 6 }] },
      { tStartMs: 1800, dDurationMs: 800, segs: [{ utf8: 'Hello world', pPenId: 5 }] },
      { tStartMs: 1800, dDurationMs: 800, segs: [{ utf8: 'Hello world again', pPenId: 6 }] },
      { tStartMs: 2600, dDurationMs: 800, segs: [{ utf8: 'again', pPenId: 5 }] },
      { tStartMs: 2600, dDurationMs: 800, segs: [{ utf8: 'again ok', pPenId: 6 }] },
      { tStartMs: 3400, dDurationMs: 800, segs: [{ utf8: 'ok', pPenId: 5 }] },
      { tStartMs: 3400, dDurationMs: 800, segs: [{ utf8: 'ok done', pPenId: 6 }] },
      { tStartMs: 4200, dDurationMs: 800, segs: [{ utf8: 'done', pPenId: 5 }] },
      { tStartMs: 4200, dDurationMs: 800, segs: [{ utf8: 'done now', pPenId: 6 }] }
    ]
  };
  const hlK = detectKaraokeHighlight(karaoke);
  check('互补文本 + 笔组不同 → 判定有高亮', hlK.hasHighlight === true, JSON.stringify(hlK));
  check('互补成对 == 5', hlK.complementaryEvents === 5, hlK.complementaryEvents);

  // 反例 1：完全没有 pPenId
  const noPen = {
    events: sample.events.slice(0, 40).map((e) => ({
      tStartMs: e.tStartMs,
      dDurationMs: e.dDurationMs,
      segs: e.segs.map((sg) => ({ utf8: sg.utf8 }))
    }))
  };
  check('无 pPenId → 判定关闭', detectKaraokeHighlight(noPen).hasHighlight === false);

  // 反例 2：每个时刻只有一条 event
  const seen = new Set();
  const single = {
    events: sample.events.filter((e) => {
      if (seen.has(e.tStartMs)) return false;
      seen.add(e.tStartMs);
      return true;
    })
  };
  check('每时刻单条 event → 判定关闭', detectKaraokeHighlight(single).hasHighlight === false);

  // 反例 3：空轨
  check('空 event → 判定关闭', detectKaraokeHighlight({ events: [] }).hasHighlight === false);
}

/* ============================================================================
 * 9. ruby 注音剥离（v0.5.0）
 *
 * 日语歌词轨把假名注音内联在正文里：`反(はん)射(しゃ)るface`。
 * 不剥离就会把读音当正文送进翻译 —— 这是"字幕对不上内容"的主因。
 * ==========================================================================*/
console.log('--- 9. ruby 注音剥离（stripRuby）---');
{
  check("汉字 + 假名括号 → 只留汉字", stripRuby('反(はん)射(しゃ)するface') === '反射するface', stripRuby('反(はん)射(しゃ)するface'));
  check('句中 ruby 同样剥离', stripRuby('手(て)と手(て)はhand shake') === '手と手はhand shake');
  check('全角括号也剥', stripRuby('東京（とうきょう）タワー') === '東京タワー', stripRuby('東京（とうきょう）タワー'));
  check('括号内非假名（英文）不动', stripRuby('(Yeah) okay') === '(Yeah) okay');
  check('括号内数字不动', stripRuby('(20) times') === '(20) times');
  check('无汉字前缀的括号不动', stripRuby('see (you)') === 'see (you)');

  // 实测样本：去重后不应残留任何 ruby
  const sample = readFixture();
  const { lines } = dedupeLyricEvents(sample);
  const RUBY_CHECK = /[\u4e00-\u9fff][（(][\u3040-\u30ff]{1,6}[）)]/u;
  const withRuby = lines.filter((l) => RUBY_CHECK.test(l.text));
  check('去重后 62 行内无残留 ruby', withRuby.length === 0, withRuby.map((l) => l.text).slice(0, 3));

  // 窗口不重叠（去重出口统一裁剪）
  const flat = [];
  for (const l of lines) for (const d of l.displays) flat.push(d);
  flat.sort((a, b) => a.startMs - b.startMs);
  let overlap = 0;
  for (let i = 0; i < flat.length - 1; i++) if (flat[i].endMs > flat[i + 1].startMs) overlap++;
  check('显示窗口重叠数 ≤ 8（裁剪后，原为 45）', overlap <= 8, overlap);
}

/* ============================================================================
 * 10. 笔色 → 逐字颜色 + 真实字级时间（v0.5.0 数据层修正）
 *
 * 早期结论「json3 没有颜色字段」是错的。颜色在 `pens[i].fcForeColor`（24 位整数），
 * 逐字进度在**单个 event 内部**：已唱前缀每字一支笔（颜色各异），未唱后缀整段
 * `#FEFEFE`。同一句随时间重复下发多帧，已唱前缀逐帧变长。
 *
 * 实测另一个反直觉事实（第 10.3 节断言）：同一行会被**重复着色多轮**（同一位置、
 * 连续几轮各从全白扫到全彩），三轮配色互不相同。样本首行：
 *   7524–9493  单色 #FE3480
 *   10160–12129 彩虹 #71E5FF → #FE3480     ← 任务书里引用的 10828 属于这一轮
 *   12830–14798 彩虹 #37BABA → #F58017     ← 数据层取「最后一轮」（最终定色）
 * ==========================================================================*/
console.log('--- 10. 笔色：逐字颜色 + 真实字级时间 ---');
{
  const sample = readFixture();
  const { lines: colorLines } = dedupeLyricEvents(sample);

  // ── 10.1 readPenColor ──
  check('readPenColor: 16659584 → #FE3480', readPenColor({ fcForeColor: 16659584 }) === '#FE3480', readPenColor({ fcForeColor: 16659584 }));
  check('readPenColor: 空笔 {} → null', readPenColor({}) === null);
  check('readPenColor: undefined → null', readPenColor(undefined) === null);
  check('readPenColor: null → null', readPenColor(null) === null);
  check('readPenColor: fcForeColor=0 → null（无色）', readPenColor({ fcForeColor: 0 }) === null);
  check('readPenColor: 非数字 → null', readPenColor({ fcForeColor: 'red' }) === null);
  check('readPenColor: 白色也照常转换（白色=未唱 由 extractLineColors 判）', readPenColor({ fcForeColor: 16711422 }) === UNSUNG_COLOR, readPenColor({ fcForeColor: 16711422 }));
  check('readPenColor: 不足 6 位会补零', readPenColor({ fcForeColor: 255 }) === '#0000FF', readPenColor({ fcForeColor: 255 }));
  check('夹具已补 pens（231 支，与原始数组等长）', Array.isArray(sample.pens) && sample.pens.length === 231, sample.pens?.length);
  check('夹具 pens[0] 仍是空对象（索引不能错位）', JSON.stringify(sample.pens[0]) === '{}');
  check('夹具 pens[4] = #FEFEFE（= 16711422）', sample.pens[4].fcForeColor === 16711422, sample.pens[4].fcForeColor);

  // ── 10.2 实测样本：彩虹行（intro）──
  const rainbowLine = colorLines.find((l) => l.text === 'Okay, be there be there back to');
  const ri = extractLineColors(sample, rainbowLine);
  const rainbowChars = Array.from(rainbowLine.text);

  check('彩虹行：颜色数组与 line.text 逐码点对齐（31）', ri.colors.length === rainbowChars.length && rainbowChars.length === 31, `${ri.colors.length} vs ${rainbowChars.length}`);
  check('彩虹行：startMs 数组同样对齐', ri.startMs.length === rainbowChars.length);
  check('彩虹行：首字颜色 #37BABA（最后一轮渐变起点）', ri.colors[0] === '#37BABA', ri.colors[0]);
  check('彩虹行：第 2 个字 #3EBFC3（渐变色逐字不同）', ri.colors[1] === '#3EBFC3', ri.colors[1]);
  check('彩虹行：末个已唱字 #F58017（最后一轮渐变终点）', ri.colors[30] === '#F58017', ri.colors[30]);
  check('彩虹行：isRainbow === true', ri.isRainbow === true);
  check('彩虹行：颜色种类 >= 5', new Set(ri.colors.filter(Boolean)).size >= 5, new Set(ri.colors.filter(Boolean)).size);
  check('彩虹行：mainColor = #55D0DE（出现最多；并列取最早）', ri.mainColor === '#55D0DE', ri.mainColor);
  check('彩虹行：确实有多轮着色（passCount === 3）', ri.passCount === 3, ri.passCount);
  check('彩虹行：取最后一轮（窗口 12830–15532）', ri.windowStartMs === 12830 && ri.windowEndMs === 15532, `${ri.windowStartMs}-${ri.windowEndMs}`);
  check('彩虹行：整行都被着色（31 字无 null）', ri.colors.every((c) => c !== null));
  check('彩虹行：没有把未唱白色 #FEFEFE 当成颜色', ri.colors.every((c) => c !== UNSUNG_COLOR));
  check(
    '彩虹行：每个字的起始时间都落在所选窗口内',
    ri.startMs.every((t) => typeof t === 'number' && t >= ri.windowStartMs && t < ri.windowEndMs),
    JSON.stringify(ri.startMs.slice(0, 4))
  );

  // ── 10.3 实测样本：#F58017 单色行 ──
  const faceLine = colorLines.find((l) => l.text === '反射するface');
  const fi = extractLineColors(sample, faceLine);
  check('单色行：mainColor === #F58017', fi.mainColor === '#F58017', fi.mainColor);
  check('单色行：8 个字全是 #F58017', fi.colors.length === 8 && fi.colors.every((c) => c === '#F58017'), JSON.stringify(fi.colors));
  check('单色行：isRainbow === false', fi.isRainbow === false);
  check('单色行：passCount === 1（只着色一轮）', fi.passCount === 1, fi.passCount);
  check('单色行：ruby 已剥离后长度 = 8（反(はん)射(しゃ)るface → 反射するface）', Array.from(faceLine.text).length === 8, faceLine.text);
  check(
    '单色行：首字真实时间 = 该轮第一帧（18168）',
    fi.startMs[0] === 18168 && fi.windowStartMs === 18168,
    `${fi.startMs[0]} / ${fi.windowStartMs}`
  );

  // ── 10.4 真实时间覆盖 ──
  const estOverInfo = estimateCharTimings({
    text: rainbowLine.text,
    startMs: ri.windowStartMs,
    endMs: ri.windowEndMs
  });
  const attached = attachCharColors(estOverInfo, ri);
  check('真实时间：首字 startMs === 该行第一帧 tStartMs（12830）', attached[0].startMs === ri.windowStartMs, attached[0].startMs);
  check('真实时间：末字 endMs === 窗口终点（15532）', attached[attached.length - 1].endMs === ri.windowEndMs, attached[attached.length - 1].endMs);
  check('真实时间：严格递增（每个字都比前一个字晚起）', attached.every((t, i) => i === 0 || t.startMs > attached[i - 1].startMs));
  check('真实时间：连续无缝隙（后一片 start === 前一片 end）', attached.every((t, i) => i === 0 || t.startMs === attached[i - 1].endMs));
  check('真实时间：每片时长 >= 1ms', attached.every((t) => t.endMs - t.startMs >= 1));
  check('真实时间：总时长 === 窗口长度', attached.reduce((a, t) => a + (t.endMs - t.startMs), 0) === ri.windowEndMs - ri.windowStartMs);
  check('真实时间：全部标为 estimated=false', attached.every((t) => t.estimated === false));
  check('真实时间：全部 source=pen', attached.every((t) => t.source === 'pen'));
  check('真实时间：color 与 info.colors 逐项相等', attached.every((t, i) => t.color === ri.colors[i]));
  check(
    '真实时间：首字 12830–13130 与实测帧界一致（下一帧 13130）',
    attached[0].startMs === 12830 && attached[0].endMs === 13130,
    `${attached[0].startMs}-${attached[0].endMs}`
  );
  check('真实时间：不修改入参数组（纯函数）', estOverInfo[0].startMs !== attached[0].startMs || estOverInfo[0].color === undefined);

  // 窗口对不上（颜色来自最后一轮，时间窗是整段显示）→ 只上色、不动时间
  const displayTimings = buildLineCharTimings(rainbowLine, rainbowLine.displays[0]);
  const widened = attachCharColors(displayTimings, ri);
  check(
    '窗口不匹配：时间完全不动（整段显示 7524 起）',
    widened.every((t, i) => t.startMs === displayTimings[i].startMs && t.endMs === displayTimings[i].endMs),
    `${widened[0].startMs} vs ${displayTimings[0].startMs}`
  );
  check('窗口不匹配：颜色照样上', widened[0].color === ri.colors[0], widened[0].color);

  // ── 10.5 无 pens 的普通 CC：全 null，时间不动 ──
  const plainCc = {
    events: [
      { tStartMs: 1000, dDurationMs: 1200, segs: [{ utf8: 'Hello' }, { utf8: ' there' }] },
      { tStartMs: 1000, dDurationMs: 1200, segs: [{ utf8: 'Hello' }, { utf8: ' there' }] },
      { tStartMs: 2600, dDurationMs: 1400, segs: [{ utf8: 'It is' }, { utf8: ' fine' }] }
    ]
  };
  const plainLines = dedupeLyricEvents(plainCc).lines;
  const plainLine = plainLines.find((l) => l.text === 'Hello there');
  const pi = extractLineColors(plainCc, plainLine);
  check('无 pens：colors 全 null', pi.colors.length === 11 && pi.colors.every((c) => c === null), JSON.stringify(pi.colors));
  check('无 pens：startMs 全 null', pi.startMs.every((t) => t === null));
  check('无 pens：mainColor === null', pi.mainColor === null);
  check('无 pens：isRainbow === false', pi.isRainbow === false);

  const plainEst = estimateCharTimings({ text: plainLine.text, startMs: 1000, endMs: 2200 });
  const plainAttached = attachCharColors(plainEst, pi);
  check('无 pens：片数不变', plainAttached.length === plainEst.length);
  check('无 pens：char 逐字不变', plainAttached.every((t, i) => t.char === plainEst[i].char));
  check('无 pens：startMs 逐字不变', plainAttached.every((t, i) => t.startMs === plainEst[i].startMs));
  check('无 pens：endMs 逐字不变', plainAttached.every((t, i) => t.endMs === plainEst[i].endMs));
  check('无 pens：estimated 逐字不变', plainAttached.every((t, i) => t.estimated === plainEst[i].estimated));
  check('无 pens：仍标 source=estimated', plainAttached.every((t) => t.source === 'estimated'));
  check('无 pens：没有写出任何 color', plainAttached.every((t) => t.color === undefined));

  // ── 10.6 构造样本：#FEFEFE 后缀 = 未唱 → null；越界 pPenId → null 不抛错 ──
  const whiteSuffix = {
    pens: [{}, { fcForeColor: 0x71e5ff }, { fcForeColor: 0xfefefe }],
    events: [
      { tStartMs: 5000, dDurationMs: 900, segs: [{ utf8: 'AB', pPenId: 1 }, { utf8: 'CD', pPenId: 2 }] },
      { tStartMs: 5400, dDurationMs: 900, segs: [{ utf8: 'ABC', pPenId: 1 }, { utf8: 'D', pPenId: 2 }] }
    ]
  };
  const wsLine = dedupeLyricEvents(whiteSuffix).lines[0];
  const wi = extractLineColors(whiteSuffix, wsLine);
  check('白色后缀：未唱字为 null（D）', wi.colors[3] === null, JSON.stringify(wi.colors));
  check('白色后缀：已唱字保留颜色（A/B/C）', wi.colors.slice(0, 3).join() === '#71E5FF,#71E5FF,#71E5FF', JSON.stringify(wi.colors));
  check('白色后缀：未唱字 startMs 为 null', wi.startMs[3] === null);
  check('白色后缀：mainColor = #71E5FF', wi.mainColor === '#71E5FF', wi.mainColor);
  check('白色后缀：startMs 取自「第一次非白」那一帧（A@5000、C@5400）', wi.startMs[0] === 5000 && wi.startMs[2] === 5400, JSON.stringify(wi.startMs));

  const oob = {
    pens: [{ fcForeColor: 0x123456 }],
    events: [{ tStartMs: 0, dDurationMs: 1000, segs: [{ utf8: 'XY', pPenId: 9999 }, { utf8: 'Z', pPenId: -1 }] }]
  };
  const oobLine = dedupeLyricEvents(oob).lines[0];
  let oobThrew = null;
  let oobInfo = null;
  try {
    oobInfo = extractLineColors(oob, oobLine);
  } catch (err) {
    oobThrew = err;
  }
  check('越界 pPenId：不抛错', oobThrew === null, oobThrew && oobThrew.message);
  check('越界 pPenId：全部按无色处理', oobInfo && oobInfo.colors.every((c) => c === null), JSON.stringify(oobInfo && oobInfo.colors));

  // ── 10.7 空输入 / 缺字段 ──
  check('空 data → 全 null 不抛错', extractLineColors({}, { key: 'x', text: 'x', startMs: 0, endMs: 0, occurrences: [], displays: [], eventCount: 0 }).colors.length === 0);
  check('attachCharColors 传 null info → 原样返回', attachCharColors(plainEst, null).every((t, i) => t.startMs === plainEst[i].startMs));

  // ── 10.8 全量画像（打印，便于人眼复核）──
  let coloredLines = 0;
  let rainbowLines = 0;
  let multiPassLines = 0;
  for (const l of colorLines) {
    const i = extractLineColors(sample, l);
    if (i.colors.some(Boolean)) coloredLines++;
    if (i.isRainbow) rainbowLines++;
    if (i.passCount > 1) multiPassLines++;
  }
  console.log(
    `    62 行中：有笔色 ${coloredLines} 行、彩虹渐变 ${rainbowLines} 行、被重复着色多轮 ${multiPassLines} 行`
  );
  check('实测样本：绝大多数行能读到笔色（>= 55）', coloredLines >= 55, coloredLines);
  check('实测样本：彩虹行至少 3 行', rainbowLines >= 3, rainbowLines);
  check('实测样本：存在被重复着色多轮的行', multiPassLines > 0, multiPassLines);

  console.log('\n  前 3 行颜色表（字符 / 颜色 / 起始 ms）:');
  for (const line of colorLines.slice(0, 3)) {
    const info = extractLineColors(sample, line);
    const chars = Array.from(line.text);
    console.log(
      `\n  行「${line.text}」 笔色 ${info.colors.filter(Boolean).length}/${chars.length} 字, 主色 ${info.mainColor ?? '-'}, 彩虹 ${info.isRainbow}, 轮次 ${info.passCount}, 窗口 ${info.windowStartMs}–${info.windowEndMs}ms`
    );
    let row = '   ';
    for (let i = 0; i < chars.length; i++) {
      const label = chars[i] === ' ' ? '␠' : chars[i];
      row += `${label}[${info.colors[i] ?? '无色'}@${info.startMs[i] ?? '-'}] `;
      if (row.length > 100) {
        console.log(row);
        row = '   ';
      }
    }
    if (row.trim()) console.log(row);
  }
}

/* ============================================================================
 * 汇总
 * ==========================================================================*/
console.log(`\n汇总: ${passed} 通过, ${failedItems.length} 失败`);
assert.equal(
  failedItems.length,
  0,
  `歌词轨用例有 ${failedItems.length} 项失败：\n` + failedItems.map((m) => '  ✗ ' + m).join('\n')
);
console.log('歌词轨测试全部通过（node:assert 收口：失败会抛错并以非零码退出）');
