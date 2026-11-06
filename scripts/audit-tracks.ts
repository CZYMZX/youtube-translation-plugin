/**
 * 三轨指标复测 + 括号短词策略改前/改后对照（v0.4.2，只读被测源码）
 *
 * 用法（仓库根目录）：
 *   npx tsx scripts/audit-tracks.ts [语料目录]
 *   SEG_CORPUS_DIR=D:/path/to/.tmp-yt npx tsx scripts/audit-tracks.ts
 *
 * 默认语料目录：D:/WorkBuddy/2026-11-04-03-58-28/.tmp-yt
 *   payload.txt（zh）/ payload-ja.txt（ja）/ payload-en.txt（en）
 *
 * 口径：
 * - tokens = extractCaptionTokens(raw).length（噪声过滤之后、断句之前）
 * - 句数/伪影/重叠/>7.4s/≥32字/最长句 均按 segmentCaptionTokens(默认设置) 输出
 * - 「括号短词改前/改后」不靠重跑旧代码，而是对比**新旧两版噪声判据**在同一条轨上的判定差：
 *   旧判据（v0.4.1）= 词表含 音/笑/se/咳、无歧义短词豁免；
 *   新判据（v0.4.2）= 移除上述 4 个条目 + 「单字 CJK / ≤2 字母内文」结构性豁免。
 *   判定差为 0 ⇒ token 流逐字一致 ⇒ 断句结果必然一致（无需再跑一遍旧代码）。
 */
import fs from 'node:fs';
import path from 'node:path';
import {
  extractCaptionTokens,
  segmentCaptionTokens,
  detectStreamLanguage
} from '../utils/segmenter.ts';
import type { SubtitleSentence } from '../types/index.ts';

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
const FILES = [
  { name: 'zh', file: 'payload.txt' },
  { name: 'ja', file: 'payload-ja.txt' },
  { name: 'en', file: 'payload-en.txt' }
];
const OUT_DIR = path.resolve('.output');
const OUT_TXT = path.join(OUT_DIR, 'audit-tracks.txt');

// ─── 括号判据（新旧两版，用于差异对照） ───
const SEQ_RE = /^(?:[\[【（(][^\]】）)]*[\]】）)])+$/;
const ITEM_RE = /[\[【（(]([^\]】）)]*)[\]】）)]/g;
const SOUND_WORDS_V041 = new Set([
  'music', 'applause', 'applauses', 'clapping', 'claps', 'laughter', 'laughs', 'laughing',
  'chuckles', 'giggle', 'giggling', 'silence', 'noise', 'breath', 'breathing', 'exhale',
  'inhale', 'sigh', 'sighs', 'sighing', 'gasp', 'gasps', 'cough', 'coughing', 'cheering',
  'crowd cheering', 'intro', 'outro', 'inaudible',
  '笑い', '笑', '笑い声', '叫び声', '悲鳴', '鼻息', 'うめき声', '息をのむ音', '泣き声',
  'ため息', '溜息', '吐息', 'あくび', '号泣', '嗚咽', '拍手', '音楽', '歓声', '効果音',
  '無音', '沈黙', '咳', '咳払い', '舌打ち', '足音', '物音', 'ざわめき', '音', 'bgm', 'se',
  '笑声', '掌声', '鼓掌', '音乐', '音效', '欢呼', '叹气', '咳嗽', '沉默', '掌声响起'
]);
const SOUND_WORDS_V042 = new Set(
  [...SOUND_WORDS_V041].filter((w) => !['音', '笑', 'se', '咳'].includes(w))
);
const SYMBOL_ONLY = /[a-zA-Z0-9\u3040-\u30ff\u3400-\u4dbf\u4e00-\u9fff\uac00-\ud7af]/;
const isAmbiguousShortInner = (inner: string) => {
  if (!inner) return false;
  if (/^[\u3041-\u3096\u30a1-\u30fa\u3400-\u4dbf\u4e00-\u9fff]$/.test(inner)) return true;
  if (/^[a-zA-Z]{1,2}$/.test(inner)) return true;
  return false;
};

function innerParts(t: string): string[] | null {
  if (!SEQ_RE.test(t)) return null;
  const inners = [...t.matchAll(ITEM_RE)].map((m) => m[1].trim());
  return inners.length ? inners : null;
}

function isNoiseBracket(t: string, version: 'v041' | 'v042'): boolean {
  const inners = innerParts(t.trim());
  if (!inners) return false;
  const words = version === 'v041' ? SOUND_WORDS_V041 : SOUND_WORDS_V042;
  return inners.every(
    (inner) =>
      !inner ||
      (version === 'v042' && isAmbiguousShortInner(inner)
        ? false
        : words.has(inner.toLowerCase())) ||
      !SYMBOL_ONLY.test(inner)
  );
}

const dur = (s: SubtitleSentence) => (s.end - s.start) / 1000;
const charLen = (s: string) => [...s].length;
const contentLen = (s: string) =>
  charLen(s.replace(/[\s。！？…、，,.!?♪～〜—\-（）()「」『』【】\[\]]/g, ''));

function rawSegs(raw: any): string[] {
  const out: string[] = [];
  for (const ev of raw.events || []) {
    if (Array.isArray(ev.segs)) {
      for (const seg of ev.segs) if (seg && typeof seg.utf8 === 'string') out.push(seg.utf8.trim());
    }
  }
  return out;
}

function audit(entry: { name: string; file: string }) {
  const full = path.join(CORPUS_DIR, entry.file);
  if (!fs.existsSync(full)) return null;
  const raw = JSON.parse(fs.readFileSync(full, 'utf8'));
  const tokens = extractCaptionTokens(raw);
  const lang = detectStreamLanguage(tokens);
  const sentences = segmentCaptionTokens(tokens, DEFAULTS);

  // 括号短词：新旧判据差异
  const bracketKinds = new Map<string, number>();
  const flips: Array<{ text: string; count: number }> = [];
  const keptShort: Array<{ text: string; count: number }> = [];
  for (const t of rawSegs(raw)) {
    if (!/^[\[【（(]/.test(t)) continue;
    const inners = innerParts(t);
    if (!inners) continue;
    bracketKinds.set(t, (bracketKinds.get(t) || 0) + 1);
    const oldNoise = isNoiseBracket(t, 'v041');
    const newNoise = isNoiseBracket(t, 'v042');
    if (oldNoise && !newNoise) flips.push({ text: t, count: 1 });
    if (!newNoise && inners.some((i) => isAmbiguousShortInner(i))) {
      const hit = keptShort.find((x) => x.text === t);
      if (hit) hit.count++;
      else keptShort.push({ text: t, count: 1 });
    }
  }
  // 统计同一 seg 出现次数
  const segCount = new Map<string, number>();
  for (const t of rawSegs(raw)) segCount.set(t, (segCount.get(t) || 0) + 1);
  const flipCount = flips.reduce((a, b) => a + (segCount.get(b.text) || 0), 0);

  let artifact = 0;
  let overlap = 0;
  let over74 = 0;
  let ge32 = 0;
  let longestSec = 0;
  let longestText = '';
  let longestChars = 0;
  let shortestChars = Infinity;
  let shortSentences = 0;
  for (let i = 0; i < sentences.length; i++) {
    const s = sentences[i];
    const d = dur(s);
    if (d > 7.4) over74++;
    if (d > longestSec) {
      longestSec = d;
      longestText = s.text;
    }
    const len = charLen(s.text);
    if (len >= 32) ge32++;
    if (len > longestChars) longestChars = len;
    const c = contentLen(s.text);
    if (c < shortestChars) shortestChars = c;
    if (c <= 2) shortSentences++;
    if (s.text.includes('，。')) artifact++;
    if (i > 0 && s.start < sentences[i - 1].end) overlap++;
  }

  return {
    name: entry.name,
    file: entry.file,
    cues: (raw.events || []).filter((e: any) => e.segs).length,
    tokens: tokens.length,
    lang,
    sentences: sentences.length,
    artifact,
    overlap,
    over74,
    over74Pct: ((over74 / Math.max(1, sentences.length)) * 100).toFixed(1),
    ge32,
    ge32Pct: ((ge32 / Math.max(1, sentences.length)) * 100).toFixed(1),
    longestSec: +longestSec.toFixed(2),
    longestChars,
    longestText: longestText.slice(0, 70),
    shortestChars: shortestChars === Infinity ? 0 : shortestChars,
    shortSentences,
    bracketKinds: bracketKinds.size,
    bracketTotal: [...bracketKinds.values()].reduce((a, b) => a + b, 0),
    flipKinds: flips.length,
    flipHits: flipCount,
    flips: flips.map((f) => `${f.text}×${segCount.get(f.text) || 1}`).slice(0, 20),
    keptShort: keptShort.map((k) => `${k.text}×${k.count}`)
  };
}

const results: any[] = [];
for (const f of FILES) {
  const r = audit(f);
  if (!r) {
    console.log(`MISSING ${f.file}`);
    continue;
  }
  results.push(r);
  console.log(`\n=== ${r.name} (${r.file}) ===`);
  console.log(`cues=${r.cues} tokens=${r.tokens} lang=${r.lang} sentences=${r.sentences}`);
  console.log(
    `artifact=${r.artifact} overlap=${r.overlap} over7.4=${r.over74}(${r.over74Pct}%) ge32=${r.ge32}(${r.ge32Pct}%) longest=${r.longestSec}s/${r.longestChars}ch short<=2=${r.shortSentences}`
  );
  console.log(
    `bracketKinds=${r.bracketKinds} bracketTotal=${r.bracketTotal} flipKinds=${r.flipKinds} flipHits=${r.flipHits}`
  );
}

const L: string[] = [];
L.push('# 三轨指标 + 括号短词策略改前/改后');
L.push(`语料目录：${CORPUS_DIR}`);
L.push(`设置：pauseThreshold 450 / maxDurationMs 6500 / maxChars 28 / merge on / language auto`);
L.push('');
L.push('| 轨 | cues | tokens | lang | 句数 | 「，。」 | 重叠 | >7.4s | ≥32字 | 最长句(s) | 最长句(字) | 极短句(实字≤2) |');
L.push('|---|---|---|---|---|---|---|---|---|---|---|---|');
for (const r of results) {
  L.push(
    `| ${r.name} | ${r.cues} | ${r.tokens} | ${r.lang} | ${r.sentences} | ${r.artifact} | ${r.overlap} | ${r.over74}(${r.over74Pct}%) | ${r.ge32}(${r.ge32Pct}%) | ${r.longestSec} | ${r.longestChars} | ${r.shortSentences} |`
  );
}
L.push('');
L.push('## 括号短词改前/改后判定差');
for (const r of results) {
  L.push('');
  L.push(`### ${r.name}：括号段 ${r.bracketKinds} 种 / ${r.bracketTotal} 处`);
  L.push(`- 旧判据剔除→新判据保留（flip）：${r.flipKinds} 种 / ${r.flipHits} 处`);
  if (r.flipKinds) L.push(`  - ${r.flips.join(' ')}`);
  L.push(`- 命中「歧义短词豁免」而保留的：${r.keptShort.length ? r.keptShort.join(' ') : '（0 处）'}`);
  L.push(`- 最长句：${r.longestSec}s / ${r.longestChars} 字 —— ${r.longestText}`);
}
fs.mkdirSync(OUT_DIR, { recursive: true });
fs.writeFileSync(OUT_TXT, L.join('\n'), 'utf8');
console.log(`\nDETAIL -> ${OUT_TXT}`);
