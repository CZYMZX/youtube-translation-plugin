/**
 * v0.2.8 术语库回归测试：结构完整性 / 匹配 / prompt 注入 / 缓存键 / 设置清洗
 */
import { GLOSSARY, GLOSSARY_VERSION, getGlossaryStats, findGlossaryMatches, buildGlossaryPromptBlock } from '../utils/glossary.ts';
import { buildSentenceCacheKey } from '../utils/db-cache.ts';
import { sanitizeSettings } from '../utils/storage.ts';
import { BUILTIN_GLOSSARY_PACKS } from '../utils/packs.ts';

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

console.log('--- 测试 6: 单字与高频词匹配边界（v0.3.1） ---');
{
  const mc = BUILTIN_GLOSSARY_PACKS.find((p) => p.id === 'mc').entries;
  const hits = (t) => findGlossaryMatches([t], 40, mc);
  const has = (t, ja) => hits(t).some((e) => e.ja === ja);

  // 单字术语应有条件生效（左右非汉字）
  check('「土を掘る」命中 土→泥土', has('土を掘って整地する', '土'));
  check('「石を採る」命中 石→石头', has('石をツルハシで採る', '石'));
  check('「弓と矢」命中 弓/矢', has('弓と矢を作りたい', '弓') && has('弓と矢を作りたい', '矢'));
  check('「毒を食らう」命中 毒→中毒', has('毒を食らった', '毒'));

  // 日常词中的同字不应命中
  check('「土曜日」不误命中 土', !has('土曜日は休み', '土'));
  check('「宝石」不误命中 石', !has('宝石みたいな瞳', '石'));
  check('「弓道」不误命中 弓', !has('弓道を習ってる', '弓'));
  check('「氷点下」不误命中 氷', !has('氷点下の寒さ', '氷'));

  // 高频日常词：需语境支撑
  check('「家を修繕する」不注入 修繕', !has('この家、修繕しないとな', '修繕'));
  check('「幸運なことに」不注入 幸運', !has('幸運なことに晴れた', '幸運'));
  check('MC 语境下 幸運 正常注入', has('幸運エンチャントつけたい、ダイヤモンドのツルハシに', '幸運'));
  // 语境必须按句判定：同批其他句子的正常术语不能把日常句里的「修繕」救活
  const batch = findGlossaryMatches(['この家、修繕しないとな', 'ダイヤモンドのツルハシを作らないと', 'あ、ヒツジいた'], 40, mc);
  check('同批其他句子不救活 修繕', !batch.some((e) => e.ja === '修繕'), batch.map((e) => e.ja).join(','));
  check('同批正常术语仍照常注入', batch.some((e) => e.ja === 'ヒツジ') && batch.some((e) => e.ja === 'ダイヤモンドのツルハシ'));
  const ctxEntries = mc.filter((e) => e.needsContext).map((e) => e.ja);
  check('needsContext 标记仅限 3 个高频词', ctxEntries.length === 3 && ctxEntries.includes('修繕'), ctxEntries.join(','));
}

console.log('--- 测试 7: AI 术语库维基核对项（v0.3.1） ---');
{
  const ai = BUILTIN_GLOSSARY_PACKS.find((p) => p.id === 'ai').entries;
  const hits = (t) => findGlossaryMatches([t], 40, ai);
  const has = (t, ja) => hits(t).some((e) => e.ja === ja);
  const find = (ja) => ai.find((e) => e.ja === ja);

  check('AI 术语库 35 条', ai.length === 35, String(ai.length));
  check('「学習」已移除（过宽，会误伤 学習塾）', !find('学習'));
  check('「事前学習 → 预训练」已加入', find('事前学習')?.zh === '预训练');
  check('AI 语境命中 事前学習', has('大規模言語モデルの事前学習', '事前学習'));
  check('日常句「学習塾」不命中', hits('今日は学習塾に行ってきた').length === 0);

  const ctx = ai.filter((e) => e.needsContext).map((e) => e.ja).sort();
  check('跨领域同形词标记 3 个', ctx.join(',') === ['トークン', 'エージェント', '推論'].sort().join(','), ctx.join(','));
  check('AI 语境下 トークン 正常注入', has('トークン数がコンテキストウィンドウを超えてる', 'トークン'));
  check('API 令牌语境不注入 トークン', !has('このAPIのトークンが切れてる', 'トークン'));
  check('逻辑推理语境不注入 推論', !has('彼は論理的に推論した', '推論'));
}

console.log(`\n结果: ${passed} 通过, ${failed} 失败`);
if (failed > 0) process.exit(1);
console.log('所有术语库测试通过！');
