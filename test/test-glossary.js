/**
 * v0.2.8 术语库回归测试：结构完整性 / 匹配 / prompt 注入 / 缓存键 / 设置清洗
 */
import { GLOSSARY, GLOSSARY_VERSION, getGlossaryStats, findGlossaryMatches, buildGlossaryPromptBlock } from '../utils/glossary.ts';
import { buildSentenceCacheKey } from '../utils/db-cache.ts';
import { sanitizeSettings } from '../utils/storage.ts';

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

console.log('--- 测试 1: 术语库结构完整性 ---');
{
  const stats = getGlossaryStats();
  check(`条目总数 >= 120（当前 ${stats.total}）`, stats.total >= 120, `total=${stats.total}`);
  check('五个分类均有条目', Object.values(stats.byCategory).every((n) => n > 0), JSON.stringify(stats.byCategory));
  check('主播条目 >= 70', stats.byCategory.talent >= 70, `talent=${stats.byCategory.talent}`);
  check('歌曲条目 >= 10', stats.byCategory.song >= 10, `song=${stats.byCategory.song}`);
  check('id 全局唯一', new Set(GLOSSARY.map((e) => e.id)).size === GLOSSARY.length);
  check('每条都有 ja/zh/category/source', GLOSSARY.every((e) => e.ja && e.zh && e.category && e.source));
  check('source 为 http(s) 链接', GLOSSARY.every((e) => /^https?:\/\//.test(e.source)));
  check('sourceType 合法', GLOSSARY.every((e) => ['official', 'wiki', 'community'].includes(e.sourceType)));
  check('术语库版本号非空', typeof GLOSSARY_VERSION === 'string' && GLOSSARY_VERSION.length > 0);
}

console.log('--- 测试 2: 术语匹配 ---');
{
  const m1 = findGlossaryMatches(['今日はときのそらとコラボするぞ！']);
  check('命中「ときのそら」', m1.some((e) => e.ja === 'ときのそら'), JSON.stringify(m1.map((e) => e.ja)));
  check('译名为时乃空', m1.find((e) => e.ja === 'ときのそら')?.zh === '时乃空');

  const m2 = findGlossaryMatches(['マインクラフトで遊ぼう']);
  check('命中游戏「マインクラフト」', m2.some((e) => e.category === 'game'));

  const m3 = findGlossaryMatches(['スパチャありがとうございます']);
  check('命中用语「スパチャ」', m3.some((e) => e.ja === 'スパチャ'));

  const m4 = findGlossaryMatches(['今日はいい天気ですね']);
  check('无命中返回空数组', m4.length === 0, JSON.stringify(m4.map((e) => e.ja)));

  const m5 = findGlossaryMatches(['ホロライブ'.repeat(1)], 1);
  check('limit 生效', m5.length <= 1);
}

console.log('--- 测试 3: prompt 注入块 ---');
{
  const entries = findGlossaryMatches(['ガルガンダーを捕まえる、ホロライブの配信で']);
  const block = buildGlossaryPromptBlock(entries);
  check('生成的块包含术语映射', block.includes('→'), block.slice(0, 60));
  check('块包含分类标签', /（(主播|团体|游戏|歌曲|用语)）/.test(block), block.slice(0, 80));
  check('空条目返回空串', buildGlossaryPromptBlock([]) === '');
}

console.log('--- 测试 4: 缓存键隔离 ---');
{
  const base = buildSentenceCacheKey('zh-CN', 'テスト', 'vtuber', 'low', 'openai', 'gemini-3.5-flash-lite');
  const withGlossary = buildSentenceCacheKey('zh-CN', 'テスト', 'vtuber', 'low', 'openai', 'gemini-3.5-flash-lite', GLOSSARY_VERSION);
  check('术语库版本参与缓存键', base !== withGlossary, `${base} vs ${withGlossary}`);
  check('旧键格式保持兼容（无标记时无尾缀）', !base.endsWith(':'), base);
}

console.log('--- 测试 5: 设置清洗 ---');
{
  const s1 = sanitizeSettings({});
  check('默认启用术语库', s1.glossaryEnabled === true);
  const s2 = sanitizeSettings({ glossaryEnabled: false });
  check('可关闭', s2.glossaryEnabled === false);
  const s3 = sanitizeSettings({ glossaryEnabled: 'yes' });
  check('非法值回落为启用', s3.glossaryEnabled === true);
}

console.log(`\n结果: ${passed} 通过, ${failed} 失败`);
if (failed > 0) process.exit(1);
console.log('所有术语库测试通过！');
