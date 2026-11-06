import assert from 'node:assert/strict';
import { extractCaptionTokens, segmentCaptionTokens } from '../utils/segmenter.ts';
import { DEFAULT_SETTINGS } from '../types/index.ts';

// 断言口径（v0.4.1 起）：本文件所有用例都走 check()，失败项在末尾用 node:assert 抛错，
// 进程以非零码退出，npm test 会真的变红。
// 刻意不用 console.assert —— 它在 Node 里失败只打印一行、不改变退出码，
// 会让「npm test 全绿」变成假绿（历史教训见 README「质量红线」）。
let passed = 0;
const failedItems = [];
function check(name, cond, detail) {
  if (cond) {
    passed++;
    console.log(`  ✓ ${name}`);
  } else {
    const msg = `${name}${detail ? ' => ' + detail : ''}`;
    failedItems.push(msg);
    console.error(`  ✗ ${msg}`);
  }
}

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
check('Token 数量应为 17', tokens.length === 17, `预期 17 个 token，实际: ${tokens.length}`);

console.log('\n--- 测试 2: 智能断句与标点重组 ---');
const sentences = segmentCaptionTokens(tokens, DEFAULT_SETTINGS);

console.log(`生成句子数量: ${sentences.length}`);
sentences.forEach((s) => {
  console.log(`[#${s.id}] [${s.start}ms ~ ${s.end}ms] => "${s.text}"`);
});

// 验证第 1 句末尾补标点且首字母大写
const firstText = sentences[0]?.text || '';
check('应该成功分出多句', sentences.length >= 2, `实际 ${sentences.length} 句`);
check('第 1 句应该首字母大写', firstText.startsWith('Hello'), firstText);
check('第 1 句陈述句应该自动补句号', firstText.endsWith('.'), firstText);

// 验证疑问句是否能补问号
// 原来这段在 if (questionSent) 里，句子没分出来时整条断言会被静默跳过（也是一种假绿），
// 现在把「疑问句被识别成独立句」本身也变成断言。
const questionSent = sentences.find(s => s.text.toLowerCase().includes('why is this'));
check('疑问句应被识别为独立句', Boolean(questionSent), '未找到包含「why is this」的句子');
check(
  '疑问句应该自动补问号',
  Boolean(questionSent) && questionSent.text.endsWith('?'),
  questionSent ? '实际: ' + questionSent.text : '句子缺失'
);
if (questionSent && questionSent.text.endsWith('?')) {
  console.log('✓ 疑问句自动补问号测试通过: ' + questionSent.text);
}

// 汇总 + 收口：有失败项就抛 AssertionError，让进程以非零码退出（不再只是打印一行）。
console.log(`\n汇总: ${passed} 通过, ${failedItems.length} 失败`);
assert.equal(
  failedItems.length,
  0,
  `断句用例有 ${failedItems.length} 项失败：\n` + failedItems.map((m) => '  ✗ ' + m).join('\n')
);
console.log('断句用例全部通过（node:assert 收口：失败会抛错并以非零码退出）');
