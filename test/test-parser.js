import assert from 'node:assert';
import {
  decodeHtmlEntities,
  normalizeCaptionResponse
} from '../utils/caption-parser.ts';

console.log('--- 测试: 字幕格式解析 ---');

// 1. 实体解码（包含 astral 码点）
assert.strictEqual(decodeHtmlEntities('A&amp;B'), 'A&B');
assert.strictEqual(decodeHtmlEntities('&#39;quote&#39;'), "'quote'");
assert.strictEqual(decodeHtmlEntities('&#128512;'), '😀', 'astral 码点必须正确解码');
assert.strictEqual(decodeHtmlEntities('&#x1F600;'), '😀', '十六进制 astral 码点必须正确解码');

// 2. JSON3
const json3 = JSON.stringify({
  events: [{ tStartMs: 0, dDurationMs: 1000, segs: [{ utf8: 'Hello &amp; world' }] }]
});
const parsedJson = normalizeCaptionResponse(json3);
assert.strictEqual(parsedJson.events.length, 1);
assert.strictEqual(parsedJson.events[0].segs[0].utf8, 'Hello & world');

// 3. WebVTT
const vtt = 'WEBVTT\n\n00:00:01.000 --> 00:00:02.500\nHello world\n';
const parsedVtt = normalizeCaptionResponse(vtt);
assert.strictEqual(parsedVtt.events.length, 1);
assert.strictEqual(parsedVtt.events[0].tStartMs, 1000);
assert.strictEqual(parsedVtt.events[0].dDurationMs, 1500);
assert.strictEqual(parsedVtt.events[0].segs[0].utf8, 'Hello world');

// 4. srv3 XML
const xml =
  '<timedtext format="3"><body><p t="1000" d="2000"><s t="0">こんにちは</s><s t="500">世界</s></p></body></timedtext>';
const parsedXml = normalizeCaptionResponse(xml);
assert.strictEqual(parsedXml.events.length, 1);
assert.strictEqual(parsedXml.events[0].tStartMs, 1000);
assert.strictEqual(parsedXml.events[0].segs.length, 2);

// 5. 缺少 events 的 JSON 不能误判成 VTT/XML
const parsedEmpty = normalizeCaptionResponse('{"foo":1}');
assert.strictEqual(parsedEmpty.events.length, 0);

console.log('✓ JSON3 / WebVTT / srv3 XML / 非法 JSON 分支均符合预期');
console.log('所有字幕解析测试通过！');
