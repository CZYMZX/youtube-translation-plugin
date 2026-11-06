/**
 * 术语库回归测试：结构完整性 / 匹配 / prompt 注入 / 缓存键 / 设置清洗 / 内容指纹（v0.4.1）
 */
import {
  GLOSSARY,
  GLOSSARY_CONTENT_HASH,
  GLOSSARY_TAG_SCHEME,
  GLOSSARY_MATCHER_REVISION,
  hashGlossaryContent,
  getGlossaryStats,
  findGlossaryMatches,
  buildGlossaryPromptBlock
} from '../utils/glossary.ts';
import { buildSentenceCacheKey } from '../utils/db-cache.ts';
import { sanitizeSettings } from '../utils/storage.ts';
import { BUILTIN_GLOSSARY_PACKS, buildGlossaryTag, collectGlossaryEntries } from '../utils/packs.ts';

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
  // 条数一律用精确相等：宽松的 `>=` 让「误删十几条」照样过测
  check(`条目总数 146（当前 ${stats.total}）`, stats.total === 146, `total=${stats.total}`);
  check('五个分类均有条目', Object.values(stats.byCategory).every((n) => n > 0), JSON.stringify(stats.byCategory));
  check('主播条目 80', stats.byCategory.talent === 80, `talent=${stats.byCategory.talent}`);
  check('团体 19 / 游戏 16 / 歌曲 12 / 用语 19', JSON.stringify(stats.byCategory) === JSON.stringify({ talent: 80, group: 19, game: 16, song: 12, term: 19 }), JSON.stringify(stats.byCategory));
  check('id 全局唯一', new Set(GLOSSARY.map((e) => e.id)).size === GLOSSARY.length);
  check('每条都有 ja/zh/category/source', GLOSSARY.every((e) => e.ja && e.zh && e.category && e.source));
  check('source 为 http(s) 链接', GLOSSARY.every((e) => /^https?:\/\//.test(e.source)));
  check('sourceType 合法', GLOSSARY.every((e) => ['official', 'wiki', 'community'].includes(e.sourceType)));
  check('术语库内容指纹非空', typeof GLOSSARY_CONTENT_HASH === 'string' && GLOSSARY_CONTENT_HASH.length > 0, GLOSSARY_CONTENT_HASH);
  check('内容指纹与包内条目一一对应', GLOSSARY_CONTENT_HASH === hashGlossaryContent(GLOSSARY));
  // 精确比对修订号：误改回旧值 → 门控规则变了却复用旧缓存（症状是旧译名残留）
  check('缓存键 scheme / 匹配修订号已定义', GLOSSARY_TAG_SCHEME === 'g1' && GLOSSARY_MATCHER_REVISION === 2, `${GLOSSARY_TAG_SCHEME}.${GLOSSARY_MATCHER_REVISION}`);
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
  const tag = buildGlossaryTag(undefined, { glossaries: [], scenes: [] });
  const base = buildSentenceCacheKey('zh-CN', 'テスト', 'vtuber', 'low', 'openai', 'gemini-3.5-flash-lite');
  const withGlossary = buildSentenceCacheKey('zh-CN', 'テスト', 'vtuber', 'low', 'openai', 'gemini-3.5-flash-lite', tag);
  check('术语库标签参与缓存键', base !== withGlossary, `${base} vs ${withGlossary}`);
  check('旧键格式保持兼容（无标记时无尾缀）', !base.endsWith(':'), base);
  check('标签含内容指纹（不是旧的手工版本号）', !/^\d{4}-\d{2}-\d{2}/.test(tag) && tag.includes('g1.'), tag);
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
  check('「砂漠」不误命中 砂（只命中 砂漠→沙漠）', !has('砂漠を歩く', '砂') && has('砂漠を歩く', '砂漠'));
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

console.log('--- 测试 8: 内容指纹判定「条数不变、译名变了」（v0.4.1） ---');
{
  const clone = (list) => list.map((e) => ({ ...e }));
  const base = hashGlossaryContent(GLOSSARY);

  // 核心回归：条数一模一样，只把一条译名改掉 → 指纹必须变
  // （旧实现是三包共用一个手工 bump 的版本号，这类修正经常忘了 bump → 旧译文残留）
  const renamed = clone(GLOSSARY);
  renamed[0].zh = renamed[0].zh + '（订正）';
  check('条数不变·改译名 → 指纹变', renamed.length === GLOSSARY.length && hashGlossaryContent(renamed) !== base);

  // 连译名长度都不变（排除「长度影响 hash」的错觉）
  const sameLen = clone(GLOSSARY);
  sameLen[0].zh = '空乃时';
  check(
    '条数/译名长度都不变·改译名 → 指纹变',
    sameLen.length === GLOSSARY.length && sameLen[0].zh.length === GLOSSARY[0].zh.length && hashGlossaryContent(sameLen) !== base,
    `${GLOSSARY[0].zh} → ${sameLen[0].zh}`
  );

  // 其他会改变译文结果的字段
  const recat = clone(GLOSSARY);
  recat[0].category = 'term';
  check('条数不变·改分类 → 指纹变', hashGlossaryContent(recat) !== base);

  const reJa = clone(GLOSSARY);
  reJa[0].ja = 'ときのそら（旧表记）';
  check('条数不变·改日文原词 → 指纹变', hashGlossaryContent(reJa) !== base);

  // 元数据（不参与匹配、不进 prompt）不该烧缓存
  const reSource = clone(GLOSSARY);
  reSource[0].source = 'https://example.com/new-source';
  check('只改 source URL → 指纹不变（元数据不烧缓存）', hashGlossaryContent(reSource) === base);

  const reEn = clone(GLOSSARY);
  reEn[0].en = 'Tokino Sora (alt)';
  check('只改 en 罗马字 → 指纹不变（不进 prompt）', hashGlossaryContent(reEn) === base);

  // 条数变化、顺序变化仍必须失效
  check(
    '加一条 → 指纹变',
    hashGlossaryContent([...clone(GLOSSARY), { ...GLOSSARY[0], id: 'test-extra', ja: 'テスト用語' }]) !== base
  );
  const swapped = clone(GLOSSARY);
  [swapped[0], swapped[1]] = [swapped[1], swapped[0]];
  check('调换两条顺序 → 指纹变（保守取向：宁多失效）', hashGlossaryContent(swapped) !== base);

  // 分隔符防撞：拼接歧义不应产生同一指纹
  const a = [{ id: 'x', ja: 'ab', zh: 'c', category: 'term', source: 's', sourceType: 'wiki' }];
  const b = [{ id: 'x', ja: 'a', zh: 'bc', category: 'term', source: 's', sourceType: 'wiki' }];
  check('字段拼接有分隔符（ja/zh 错位不撞）', hashGlossaryContent(a) !== hashGlossaryContent(b));
}

console.log('--- 测试 9: 门控词不互为语境证据（v0.4.2） ---');
{
  const mc = BUILTIN_GLOSSARY_PACKS.find((p) => p.id === 'mc').entries;
  const ai = BUILTIN_GLOSSARY_PACKS.find((p) => p.id === 'ai').entries;
  // translator 会把多个启用包的条目合并成一个 source 再匹配，跨包场景必须一起验
  const all = collectGlossaryEntries(['vtuber-hololive', 'mc', 'ai'], { glossaries: [], scenes: [] });
  const ja = (list) => list.map((e) => e.ja);

  // 回归 1：两个门控词同句 = 谁都没有语境证据。
  // 旧实现把它们自己也数进「同句命中数」，门槛恰好是 2 → 互相救活。
  const m1 = findGlossaryMatches(['幸運なことに、この家を修繕しないとな'], 40, mc);
  check('幸運 + 修繕 同句不注入（门控词不互证）', m1.length === 0, ja(m1).join(','));

  const m2 = findGlossaryMatches(['このAPIのトークンが切れて、彼の推論も止まった'], 40, ai);
  check('トークン + 推論 同句不注入（门控词不互证）', m2.length === 0, ja(m2).join(','));

  // 回归 2：门控词 + 普通术语 仍必须注入（收紧不能把正确行为一起砍掉）
  const m3 = findGlossaryMatches(['幸運エンチャントつけたい、ダイヤモンドのツルハシに'], 40, mc);
  check('幸運 + 钻石镐 同句仍注入 幸運', ja(m3).includes('幸運'), ja(m3).join(','));
  const m4 = findGlossaryMatches(['トークン数がコンテキストウィンドウを超えてる'], 40, ai);
  check('トークン + 上下文窗口 同句仍注入 トークン', ja(m4).includes('トークン'), ja(m4).join(','));

  // 回归 3：逐句判定——语境证据不能来自同批的其他句子
  const m5 = findGlossaryMatches(['幸運なことに晴れた', 'ダイヤモンドのツルハシを作った'], 40, mc);
  check(
    '同批另一句的普通术语不救活 幸運',
    !ja(m5).includes('幸運') && ja(m5).includes('ダイヤモンドのツルハシ'),
    ja(m5).join(',')
  );

  // 回归 4：跨包合并后仍按「同句」判定（凭证在别的包、但同句 → 注入；别的句子 → 不注入）
  const m6 = findGlossaryMatches(['この家を修繕しながらホロライブ見てる'], 40, all);
  check('跨包：修繕(MC) + ホロライブ(vtuber) 同句 → 修繕 注入', ja(m6).includes('修繕'), ja(m6).join(','));

  const m7 = findGlossaryMatches(['この家、修繕しないとな', 'ホロライブの配信みた'], 40, all);
  check('跨包：凭证在别的句子 → 修繕 不注入', !ja(m7).includes('修繕'), ja(m7).join(','));

  // 回归 5：门控词跨包也不互证（MC 的 幸運 不给 AI 的 推論 作证）
  const m8 = findGlossaryMatches(['幸運なことに、その推論は当たった'], 40, all);
  check(
    '跨包门控词也不互证（幸運 不给 推論 作证）',
    !ja(m8).includes('幸運') && !ja(m8).includes('推論'),
    ja(m8).join(',')
  );

  // 不变量：任何被注入的门控词，其所在句子里必须真的存在普通术语
  const gated = new Set(all.filter((e) => e.needsContext).map((e) => e.ja));
  const plainKeys = all.filter((e) => !e.needsContext).map((e) => e.ja);
  const batch = [
    '幸運なことに、この家を修繕しないとな',
    'このAPIのトークンが切れて、彼の推論も止まった',
    'ダイヤモンドのツルハシを作った',
    '幸運エンチャントつけたい'
  ];
  const injected = findGlossaryMatches(batch, 40, all);
  const violates = injected
    .filter((e) => gated.has(e.ja))
    .filter((e) => {
      const own = batch.filter((t) => t.includes(e.ja));
      return !own.some((t) => plainKeys.some((p) => t.includes(p)));
    })
    .map((e) => e.ja);
  check('不变量：注入的门控词所在句必含普通术语', violates.length === 0, violates.join(','));
}

console.log(`\n结果: ${passed} 通过, ${failed} 失败`);
if (failed > 0) process.exit(1);
console.log('所有术语库测试通过！');
