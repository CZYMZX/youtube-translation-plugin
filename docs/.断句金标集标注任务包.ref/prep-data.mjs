import fs from 'node:fs';
import { normalizeCaptionResponse } from 'file:///E:/Antigravity/油管翻译插件_v0.2.6/utils/caption-parser.ts';
import { extractCaptionTokens, segmentCaptionTokens } from 'file:///E:/Antigravity/油管翻译插件_v0.2.6/utils/segmenter.ts';

const S = {
  pauseThreshold: 450, maxWordsPerSentence: 16, minWordsPerSentence: 3,
  maxDurationMs: 6500, autoPunctuation: true,
  segmentationLanguage: 'auto', maxCharsPerSentence: 28, mergeShortFragments: true
};

function loadTokens(file) {
  const raw = fs.readFileSync('D:/WorkBuddy/2026-11-04-03-58-28/.tmp-yt/' + file, 'utf8');
  return extractCaptionTokens(normalizeCaptionResponse(raw));
}

function sliceTokens(tokens, fromMs, count) {
  const start = tokens.findIndex(t => t.start >= fromMs);
  return tokens.slice(start, start + count).map((t, i) => ({
    idx: i + 1, text: t.text, start: t.start, end: t.end, gap: t.gapToNext === 999999 ? null : t.gapToNext
  }));
}

function modelOutput(tokens, fromMs, toMs) {
  const seg = segmentCaptionTokens(tokens, S);
  return seg.filter(s => s.end >= fromMs && s.start <= toMs).map((s, i) => ({
    idx: i + 1, text: s.text, start: s.start, end: s.end
  }));
}

const out = {};
const plan = [
  ['ja', 'payload-ja.txt', 600000, 220],
  ['zh', 'payload.txt', 4500, 150],
  ['en', 'payload-en.txt', 4500, 150]
];
for (const [lang, file, from, count] of plan) {
  const tokens = loadTokens(file);
  const slice = sliceTokens(tokens, from, count);
  const toMs = slice.length ? slice[slice.length - 1].end + 1 : from;
  out[lang] = {
    video: file, fromMs: slice[0]?.start, toMs,
    totalTokens: tokens.length,
    tokens: slice,
    model: modelOutput(tokens, slice[0]?.start ?? from, toMs)
  };
  console.log(lang, 'tokens:', tokens.length, 'slice:', slice.length, 'modelSentences:', out[lang].model.length,
    'range:', Math.round((slice[0]?.start||0)/1000)+'s ~', Math.round(toMs/1000)+'s');
}
fs.writeFileSync('E:/Antigravity/油管翻译插件_v0.2.6/docs/.断句金标集标注任务包.ref/data.json', JSON.stringify(out, null, 1));
console.log('data.json written');
