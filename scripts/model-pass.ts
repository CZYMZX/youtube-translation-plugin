import { readFileSync, writeFileSync } from 'node:fs';
import { extractCaptionTokens, segmentCaptionTokens } from '../utils/segmenter.ts';

const SRC = 'D:/edge/youtube-subtitles.txt';
const OUT = 'D:/edge/model-pass.json';

const CUE = /^\[(\d+):(\d\d)\]\s*(.*)$/;

type Cue = { stamp: string; sec: number; text: string };

const cues: Cue[] = [];
for (const raw of readFileSync(SRC, 'utf8').split('\n')) {
  const line = raw.trim();
  if (!line) continue;
  const m = line.match(CUE);
  if (!m) continue;
  cues.push({ stamp: `${m[1]}:${m[2]}`, sec: Number(m[1]) * 60 + Number(m[2]), text: m[3].trim() });
}

// 一条 cue 一个 event；时长取到下一条的时间差（未知则给 2s）
const events = cues.map((c, i) => {
  const next = cues[i + 1];
  const dur = next ? Math.max(300, (next.sec - c.sec) * 1000) : 2000;
  return { tStartMs: c.sec * 1000, dDurationMs: dur, segs: [{ utf8: c.text, tOffsetMs: 0 }] };
});

const tokens = extractCaptionTokens({ events });
const sentences = segmentCaptionTokens(tokens, {
  pauseThreshold: 450,
  maxWordsPerSentence: 16,
  minWordsPerSentence: 3,
  maxDurationMs: 6500,
  autoPunctuation: true,
  segmentationLanguage: 'auto',
  maxCharsPerSentence: 28,
  mergeShortFragments: true,
} as any);

const out = sentences.map((s: any, i: number) => ({
  no: i + 1,
  text: s.text ?? s.tokens?.map((t: any) => t.text).join('') ?? '',
  startMs: s.startMs ?? s.tokens?.[0]?.startMs ?? 0,
  endMs: s.endMs ?? s.tokens?.[s.tokens.length - 1]?.endMs ?? 0,
}));

writeFileSync(OUT, JSON.stringify({ cues: cues.length, tokens: tokens.length, sentences: out.length, out }, null, 1), 'utf8');
console.log(`cues=${cues.length} tokens=${tokens.length} sentences=${out.length}`);
