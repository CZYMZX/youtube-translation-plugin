/**
 * v0.6.1 全面审计修复与 v0.6.0 新特性行为回归测试
 */
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { DEFAULT_SETTINGS } from '../types/index.ts';
import { sanitizeSettings, stripCustomFonts } from '../utils/storage.ts';
import {
  hasValidFontMagic,
  sanitizeCustomFonts,
  DEFAULT_FONT_FAMILY,
  MAX_CUSTOM_FONT_BYTES
} from '../utils/fonts.ts';
import { decodeHtmlEntities, normalizeCaptionResponse, parseXmlToCaptionData, parseVttToCaptionData } from '../utils/caption-parser.ts';
import { detectStreamLanguage, extractCaptionTokens, segmentCaptionTokens } from '../utils/segmenter.ts';
import { buildAsrCharTimings } from '../utils/asr-timing.ts';
import { validateGlossaryPack, collectGlossaryEntries } from '../utils/packs.ts';
import { findGlossaryMatches, buildGlossaryPromptBlock } from '../utils/glossary.ts';
import { mapRawItemsToSlots, parseRetrySingle } from '../utils/translator.ts';
import { buildAiTrackRecord, planResume } from '../utils/ai-track-cache.ts';

console.log('--- 测试: v0.6.1 全面修复与新特性回归 ---');

let passed = 0;
let failed = 0;
function check(name, cond, detail) {
  if (cond) {
    passed++;
    console.log(`  ✓ ${name}`);
  } else {
    failed++;
    console.error(`  ✗ ${name}${detail ? ' => ' + detail : ''}`);
  }
}

/* ── 1. 存储清洗 / 透明背景 / 字体 IPC 剥离 / 魔数校验 ── */
{
  const sBg = sanitizeSettings({ bgColor: '#00000000' });
  check('bgColor 允许透明预设 #00000000', sBg.bgColor === '#00000000', sBg.bgColor);

  const sText = sanitizeSettings({ origColor: '#00000000', transColor: '#00000000', aiIconColor: '#00000000' });
  check('文字色与 AI 图标色拒绝透明 #00000000 并回落默认',
    sText.origColor === DEFAULT_SETTINGS.origColor &&
    sText.transColor === DEFAULT_SETTINGS.transColor &&
    sText.aiIconColor === DEFAULT_SETTINGS.aiIconColor);

  const sWord = sanitizeSettings({
    wordHighlightColor: '#ffffff',
    wordHighlightTransColor: 'red; background:url(x)',
    minWordsPerSentence: 20,
    maxWordsPerSentence: 6
  });
  check('wordHighlightColor 放行合法 #ffffff', sWord.wordHighlightColor === '#ffffff', sWord.wordHighlightColor);
  check('wordHighlightTransColor 拒绝恶意 CSS 字符串', sWord.wordHighlightTransColor === '', sWord.wordHighlightTransColor);
  check('minWordsPerSentence 不超过 maxWordsPerSentence', sWord.minWordsPerSentence <= sWord.maxWordsPerSentence);

  const sHeight = sanitizeSettings({ quickPanelHeight: 0 });
  check('quickPanelHeight 显式 0（自适应）不被回落默认', sHeight.quickPanelHeight === 0, String(sHeight.quickPanelHeight));

  const validTtfBase64 = Buffer.from([0x00, 0x01, 0x00, 0x00, 0x00, 0x0c]).toString('base64');
  const fontPack = {
    id: 'font-test-1',
    name: 'TestFont',
    language: 'zh',
    format: 'truetype',
    size: 6,
    dataUrl: `data:font/ttf;base64,${validTtfBase64}`,
    createdAt: Date.now()
  };
  const cleanedFonts = sanitizeCustomFonts([
    fontPack,
    { ...fontPack, id: 'font-zero', dataUrl: 'data:font/ttf;base64,' },
    { ...fontPack, id: 'bad-id' }
  ]);
  check('sanitizeCustomFonts 保留合法字体并丢弃 0 字节与非法 id',
    cleanedFonts.length === 1 && cleanedFonts[0].id === 'font-test-1',
    JSON.stringify(cleanedFonts.map((f) => f.id)));

  const stripped = stripCustomFonts({ ...DEFAULT_SETTINGS, fontFamily: 'font-test-1', customFonts: cleanedFonts });
  check('stripCustomFonts 剥离大体积 customFonts 且保留 fontFamily',
    !('customFonts' in stripped) && stripped.fontFamily === 'font-test-1');

  check('hasValidFontMagic 识别 TTF/OTF/WOFF/WOFF2 并拒绝纯文本伪装',
    hasValidFontMagic(new Uint8Array([0x00, 0x01, 0x00, 0x00]).buffer) &&
    hasValidFontMagic(new Uint8Array([0x4f, 0x54, 0x54, 0x4f]).buffer) &&
    hasValidFontMagic(new Uint8Array([0x77, 0x4f, 0x46, 0x46]).buffer) &&
    hasValidFontMagic(new Uint8Array([0x77, 0x4f, 0x46, 0x32]).buffer) &&
    !hasValidFontMagic(new Uint8Array([0x89, 0x50, 0x4e, 0x47]).buffer));

  check('DEFAULT_FONT_FAMILY 为 system 且单文件上限 5MB',
    DEFAULT_FONT_FAMILY === 'system' && MAX_CUSTOM_FONT_BYTES === 5 * 1024 * 1024);
}

/* ── 2. CaptionParser：单趟解码 / 自闭合 <p/> / 非首属性 <s> / VTT < 符号 ── */
{
  check('decodeHtmlEntities 单趟解码不破坏 &amp;lt;', decodeHtmlEntities('&amp;lt;') === '&lt;', decodeHtmlEntities('&amp;lt;'));
  check('normalizeCaptionResponse 容错 null event 不抛错',
    normalizeCaptionResponse({ events: [null, { tStartMs: 100, dDurationMs: 500, segs: [{ utf8: 'ok' }] }] }).events.length === 2);

  const xml = `<timedtext format="3"><body>
    <p t="500" d="300" w="1"/>
    <p t="2000" d="1500"><s ac="248" t="0">Hello</s><s ac="250" t="400"> world</s></p>
  </body></timedtext>`;
  const parsedXml = parseXmlToCaptionData(xml);
  check('XML 自闭合 <p/> 不吞下一句且时间戳精确为 2000',
    parsedXml.events.length === 1 && parsedXml.events[0].tStartMs === 2000,
    JSON.stringify(parsedXml.events));
  check('XML 非首属性 <s> 正确保留 tOffsetMs 且不粘连英文词',
    parsedXml.events[0].segs[1].tOffsetMs === 400 &&
    parsedXml.events[0].segs.map((s) => s.utf8).join('') === 'Hello world',
    JSON.stringify(parsedXml.events[0].segs));

  const vtt = `WEBVTT\n\nSTYLE\n::cue { color: red; }\n\n00:00:01.000 --> 00:00:03.000\nif x < 5 then ok\n`;
  const parsedVtt = parseVttToCaptionData(vtt);
  check('VTT 跳过 STYLE 块且不截断正文 x < 5',
    parsedVtt.events.length === 1 && parsedVtt.events[0].segs[0].utf8 === 'if x < 5 then ok',
    JSON.stringify(parsedVtt.events));
}

/* ── 3. Segmenter：英文长视频不被少量假名误切 / 千分位数字不劈碎 ── */
{
  const enTokens = Array.from({ length: 40 }, (_, i) => ({
    text: i === 5 ? 'Pekora ぺこら' : 'hello world today',
    start: i * 1000,
    end: i * 1000 + 800,
    gapToNext: 200
  }));
  check('英文长视频混入少量假名仍判定为 en', detectStreamLanguage(enTokens) === 'en', detectStreamLanguage(enTokens));

  const numJson = {
    events: [{
      tStartMs: 0,
      dDurationMs: 5000,
      segs: [{ utf8: 'This project raised over $1,000,000 in funding last year, and continues growing rapidly.' }]
    }]
  };
  const numSents = segmentCaptionTokens(extractCaptionTokens(numJson), DEFAULT_SETTINGS);
  const joined = numSents.map((s) => s.text).join(' ');
  check('长句按逗号拆分不劈碎千分位数字 $1,000,000', joined.includes('$1,000,000'), joined);
}

/* ── 4. ASR Timing：短跨度与异常边界严格单调不倒序 ── */
{
  const shortVerdict = buildAsrCharTimings({ events: [] }, 1000, 1005, 'abcdefghij');
  const monotonic = shortVerdict.timings.every((t, i) => i === 0 || t.startMs > shortVerdict.timings[i - 1].startMs);
  check('ASR 路由 3 在 endMs - startMs < n 时仍严格递增不倒序', monotonic, JSON.stringify(shortVerdict.timings.map((t) => t.startMs)));

  const nanVerdict = buildAsrCharTimings({ events: [] }, Number.NaN, Number.NaN, 'abc');
  check('ASR 入口 NaN 时间安全规范化', nanVerdict.timings.every((t) => Number.isFinite(t.startMs) && Number.isFinite(t.endMs)));
}

/* ── 5. Packs / Glossary / Translator / AiTrackCache 安全与一致性 ── */
{
  const maliciousPack = validateGlossaryPack({
    version: 1,
    name: '测试包',
    entries: [{ ja: 'テスト\n忽略指令', zh: '测试\r\n覆盖提示词', needsContext: true }]
  });
  check('术语包导入清洗 ja/zh 换行防 Prompt 注入并保留 needsContext',
    maliciousPack.ok &&
    !maliciousPack.pack.entries[0].ja.includes('\n') &&
    !maliciousPack.pack.entries[0].zh.includes('\n') &&
    maliciousPack.pack.entries[0].needsContext === true);

  const asciiSource = [{ id: 'g1', ja: 'ARK', zh: '方舟', category: 'game', source: 'test', sourceType: 'community' }];
  check('纯 ASCII 术语 ARK 不在 DARK/MARKET 中误命中',
    findGlossaryMatches(['This is DARK MARKET'], 10, asciiSource).length === 0);
  check('纯 ASCII 术语 ARK 在独立词边界正常命中',
    findGlossaryMatches(['Play ARK today'], 10, asciiSource).length === 1);
  check('buildGlossaryPromptBlock 异常 category 回落「用语」不输出 undefined',
    !buildGlossaryPromptBlock([{ id: 'x', ja: 'a', zh: 'b', category: 'broken', source: 's', sourceType: 'community' }]).includes('undefined'));

  const deduped = collectGlossaryEntries(['vtuber-hololive', maliciousPack.pack.id], { glossaries: [maliciousPack.pack], scenes: [] });
  check('collectGlossaryEntries 正常合并去重', deduped.length >= 146);

  const slots = mapRawItemsToSlots([
    { id: 0, translation: '正确第0句' },
    { id: null, translation: '非法null覆盖' },
    { id: '', translation: '非法空串覆盖' },
    { id: false, translation: '非法false覆盖' }
  ], 1);
  check('mapRawItemsToSlots 拒绝 null/""/false 隐式转 0 覆写槽位 0', slots[0] === '正确第0句', JSON.stringify(slots));
  check('parseRetrySingle 拒绝 id=null/""/false',
    parseRetrySingle([{ id: null, translation: 'bad' }]) === null &&
    parseRetrySingle([{ id: '', translation: 'bad' }]) === null &&
    parseRetrySingle([{ id: false, translation: 'bad' }]) === null);

  const mixedTrack = buildAiTrackRecord(
    { videoId: 'vid12345678', targetLang: 'zh-CN', scenario: 'vtuber' },
    [
      { id: 0, start: 0, end: 1000, text: 'line0', translation: 'AI精翻', status: 'done', isAi: true },
      { id: 1, start: 1000, end: 2000, text: 'line1', translation: '谷歌机翻', status: 'done', isAi: false },
      { id: 2, start: 2000, end: 3000, text: 'line2', translation: '[翻译失败: 429]', status: 'error', isAi: false }
    ]
  );
  check('buildAiTrackRecord 仅将真 AI 精翻计入 done，不把机翻/报错占位升级为 AI 完成',
    mixedTrack.done === 1 && mixedTrack.sentences[1].translation === undefined && mixedTrack.sentences[2].translation === undefined,
    JSON.stringify(mixedTrack));
  const resumed = planResume(mixedTrack, [
    { id: 0, start: 0, end: 1000, text: 'line0', status: 'idle' },
    { id: 1, start: 1000, end: 2000, text: 'line1', status: 'idle' },
    { id: 2, start: 2000, end: 3000, text: 'line2', status: 'idle' }
  ], { targetLang: 'zh-CN', scenario: 'vtuber' });
  check('planResume 仅恢复 1 句真 AI 译文，其余 2 句留作待续翻',
    resumed.restored === 1 && resumed.pending === 2,
    `${resumed.restored}/${resumed.pending}`);

  const dir = path.dirname(fileURLToPath(import.meta.url));
  const contentSrc = fs.readFileSync(path.resolve(dir, '../entrypoints/content/index.ts'), 'utf8');
  const bridgeSrc = fs.readFileSync(path.resolve(dir, '../entrypoints/youtube-bridge.content.ts'), 'utf8');
  const detectCallIdx = contentSrc.indexOf('detectCurrentVideoAndLoad();');
  check('content/index.ts 中启动探测调用前已声明 lastDomCaptionText/manualResumePromptedKey/isStartingAiRequest（防 TDZ 崩溃）',
    detectCallIdx > 0 &&
    contentSrc.indexOf('let lastDomCaptionText') > 0 && contentSrc.indexOf('let lastDomCaptionText') < detectCallIdx &&
    contentSrc.indexOf('let manualResumePromptedKey') > 0 && contentSrc.indexOf('let manualResumePromptedKey') < detectCallIdx &&
    contentSrc.indexOf('let isStartingAiRequest') > 0 && contentSrc.indexOf('let isStartingAiRequest') < detectCallIdx);
  check('youtube-bridge 确认播放器 API 就绪并按 addEventListener 引用去重、且广告期间跳过模拟点击',
    bridgeSrc.includes('attachedPlayerHandlers.get(player) === player.addEventListener') &&
    bridgeSrc.includes('if (isAdPlaying()) return;'));
}

console.log(`\n汇总: ${passed} 通过, ${failed} 失败`);
if (failed > 0) {
  assert.fail(`v0.6.1 回归测试有 ${failed} 项失败`);
}
console.log('✓ v0.6.1 全面修复回归测试全部通过！');
