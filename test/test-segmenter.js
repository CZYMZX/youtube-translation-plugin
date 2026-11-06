import { extractCaptionTokens, segmentCaptionTokens } from '../utils/segmenter.ts';
import { DEFAULT_SETTINGS } from '../types/index.ts';

// 构造一个模拟 YouTube 自动字幕 (JSON3)
const mockJson3 = {
  wireMagic: 'pb3',
  events: [
    {
      tStartMs: 1000,
      dDurationMs: 2500,
      segs: [
        { utf8: 'hello' },
        { utf8: ' everyone', tOffsetMs: 300 },
        { utf8: ' today', tOffsetMs: 800 },
        { utf8: ' we', tOffsetMs: 1100 },
        { utf8: ' are', tOffsetMs: 1300 },
        { utf8: ' going', tOffsetMs: 1500 },
        { utf8: ' to', tOffsetMs: 1700 },
        { utf8: ' talk', tOffsetMs: 1900 },
        { utf8: ' about', tOffsetMs: 2200 }
      ]
    },
    // 注意：这里下一个 event 在 3500ms 开始，而上一个 event 最后一个词在 1000+2200=3200ms
    // 我们特意制造一个 800ms 的长停顿 (4000ms 开始)
    {
      tStartMs: 4000,
      dDurationMs: 2000,
      segs: [
        { utf8: 'javascript' },
        { utf8: ' browser', tOffsetMs: 350 },
        { utf8: ' extensions', tOffsetMs: 800 }
      ]
    },
    // 制造一个疑问句开头的片段，隔开 600ms
    {
      tStartMs: 6600,
      dDurationMs: 2000,
      segs: [
        { utf8: 'why' },
        { utf8: ' is', tOffsetMs: 250 },
        { utf8: ' this', tOffsetMs: 500 },
        { utf8: ' so', tOffsetMs: 750 },
        { utf8: ' important', tOffsetMs: 1000 }
      ]
    }
  ]
};

console.log('--- 测试 1: 提取词级 Token ---');
const tokens = extractCaptionTokens(mockJson3);
console.log(`成功提取 Token 数量: ${tokens.length}`);
console.assert(tokens.length === 17, `预期 17 个 token，实际: ${tokens.length}`);

console.log('\n--- 测试 2: 智能断句与标点重组 ---');
const sentences = segmentCaptionTokens(tokens, DEFAULT_SETTINGS);

console.log(`生成句子数量: ${sentences.length}`);
sentences.forEach((s) => {
  console.log(`[#${s.id}] [${s.start}ms ~ ${s.end}ms] => "${s.text}"`);
});

// 验证第 1 句末尾补标点且首字母大写
console.assert(sentences.length >= 2, '应该成功分出多句');
console.assert(sentences[0].text.startsWith('Hello'), '第 1 句应该首字母大写');
console.assert(sentences[0].text.endsWith('.'), '第 1 句陈述句应该自动补句号');

// 验证疑问句是否能补问号
const questionSent = sentences.find(s => s.text.toLowerCase().includes('why is this'));
if (questionSent) {
  console.assert(questionSent.text.endsWith('?'), '疑问句应该自动补问号，实际: ' + questionSent.text);
  console.log('✓ 疑问句自动补问号测试通过: ' + questionSent.text);
}

// 注意：本文件用 console.assert —— 断言失败只打印、进程仍以 EXIT=0 退出。
// 所以这句话只能说「执行完毕」，不能说「通过」；要看上方有没有 ASSERT 失败行
// （判定纪律见 README「质量红线」与 docs 任务六：console.assert 文件不能拿退出码当结论）。
console.log('\n用例执行完毕（本文件用 console.assert：失败不改变退出码，请核对上方输出）');
