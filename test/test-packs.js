/**
 * v0.2.9 术语库/场景包测试：结构 / 上传校验 / 启用包合并 / 场景解析 / 缓存指纹
 */
import {
  BUILTIN_SCENES,
  BUILTIN_GLOSSARY_PACKS,
  DEFAULT_GLOSSARY_PACKS,
  validateGlossaryPack,
  validateScenePack,
  collectGlossaryEntries,
  resolveScenePrompt,
  hashPrompt,
  loadCustomPacks
} from '../utils/packs.ts';
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

const EMPTY_CUSTOM = { glossaries: [], scenes: [] };

console.log('--- 测试 1: 内置场景与术语库 ---');
{
  check('内置场景 5 个', BUILTIN_SCENES.length === 5, String(BUILTIN_SCENES.length));
  check('vtuber/general 有提示词', ['vtuber', 'general'].every((id) => (BUILTIN_SCENES.find((s) => s.id === id)?.prompt || '').length > 50));
  check('科普/音乐/游戏实况为占位（空提示词）', ['science', 'music', 'gaming'].every((id) => (BUILTIN_SCENES.find((s) => s.id === id)?.prompt || '') === ''));
  check('内置术语库 3 个', BUILTIN_GLOSSARY_PACKS.length === 3);
  check('VTuber 术语库 146 条', BUILTIN_GLOSSARY_PACKS[0].entries.length === 146, String(BUILTIN_GLOSSARY_PACKS[0].entries.length));
  const mcPack = BUILTIN_GLOSSARY_PACKS.find((p) => p.id === 'mc');
  const aiPack = BUILTIN_GLOSSARY_PACKS.find((p) => p.id === 'ai');
  check('MC 术语库 >= 150 条', (mcPack?.entries.length || 0) >= 150, String(mcPack?.entries.length));
  check('AI 术语库 >= 30 条', (aiPack?.entries.length || 0) >= 30, String(aiPack?.entries.length));
  const mcEntries = mcPack?.entries || [];
  check('MC 条目字段完整', mcEntries.every((e) => e.ja && e.zh && e.source.startsWith('http')));
  check('MC 来源标注为官方语言文件', mcEntries.every((e) => e.sourceType === 'official' && e.source.includes('minecraft-assets')));
  check('MC 条目 ja 无重复', new Set(mcEntries.map((e) => e.ja)).size === mcEntries.length);
  check('MC 官方译名抽样（クリーパー→苦力怕）', mcEntries.find((e) => e.ja === 'クリーパー')?.zh === '苦力怕');
  // v0.3.1 官方语言文件核对修正项
  check('MC 修正项：ヒツジ→绵羊（非“羊”）', mcEntries.find((e) => e.ja === 'ヒツジ')?.zh === '绵羊');
  check('MC 修正项：松明→火把（官方汉字写法）', mcEntries.find((e) => e.ja === '松明')?.zh === '火把');
  check('MC 修正项：ジ・エンド→末地', mcEntries.find((e) => e.ja === 'ジ・エンド')?.zh === '末地');
  check('MC 修正项：レッドストーンダスト→红石粉', mcEntries.find((e) => e.ja === 'レッドストーンダスト')?.zh === '红石粉');
  check('MC 修正项：ダメージ増加→锋利（附魔）', mcEntries.find((e) => e.ja === 'ダメージ増加')?.zh === '锋利');
  check('MC 无“羊/红石”等旧译名残留', !mcEntries.some((e) => e.zh === '羊'));
  const aiEntries = aiPack?.entries || [];
  check('AI 条目字段完整', aiEntries.every((e) => e.ja && e.zh && e.source.startsWith('http')));
  check('AI 译名抽样（ハルシネーション→幻觉）', aiEntries.find((e) => e.ja === 'ハルシネーション')?.zh === '幻觉');
  check('默认启用 VTuber 术语库', DEFAULT_GLOSSARY_PACKS.join(',') === 'vtuber-hololive');
}

console.log('--- 测试 2: 术语库上传校验 ---');
{
  const good = validateGlossaryPack({
    version: 1,
    name: 'MC 游戏术语库',
    description: 'Minecraft 术语',
    entries: [
      { ja: 'クリーパー', zh: '苦力怕', en: 'Creeper', category: 'term' },
      { ja: 'エンダーマン', zh: '末影人' }
    ]
  });
  check('合法包通过', good.ok, JSON.stringify(good.errors));
  check('条目数正确', good.pack?.entries.length === 2);
  check('未知分类回落 term', good.pack?.entries[1].category === 'term');
  check('默认 sourceType=community', good.pack?.entries[1].sourceType === 'community');
  check('自动生成 id', typeof good.pack?.id === 'string' && good.pack.id.length > 0);

  const missingName = validateGlossaryPack({ entries: [{ ja: 'a', zh: 'b' }] });
  check('缺 name 被拒', !missingName.ok && missingName.errors.some((e) => e.includes('name')));

  const emptyEntries = validateGlossaryPack({ name: 'x', entries: [] });
  check('空 entries 被拒', !emptyEntries.ok);

  const badEntry = validateGlossaryPack({ name: 'x', entries: [{ ja: '', zh: 'b' }] });
  check('条目缺 ja 被拒', !badEntry.ok && badEntry.errors.some((e) => e.includes('ja')));

  const tooMany = validateGlossaryPack({ name: 'x', entries: new Array(2001).fill({ ja: 'a', zh: 'b' }) });
  check('超过 2000 条被拒', !tooMany.ok);

  const notObject = validateGlossaryPack('oops');
  check('非对象被拒', !notObject.ok);
}

console.log('--- 测试 3: 场景上传校验 ---');
{
  const good = validateScenePack({
    version: 1,
    name: '科普视频',
    description: '科学解说',
    hint: '例：TED-Ed',
    prompt: '你是一位科普字幕译者，要求术语准确、逻辑清晰，保留公式与单位，不添加原文没有的信息。'
  });
  check('合法场景包通过', good.ok, JSON.stringify(good.errors));
  check('场景 id 自动生成', typeof good.pack?.id === 'string');

  const noPrompt = validateScenePack({ name: 'x' });
  check('缺 prompt 被拒', !noPrompt.ok);

  const shortPrompt = validateScenePack({ name: 'x', prompt: '太短了' });
  check('prompt 过短被拒', !shortPrompt.ok);

  const unknownField = validateScenePack({ name: 'x', prompt: '你是一位视频字幕译者，请保持口语化、准确传达语义，不要添加原文没有的信息。', foo: 1 });
  check('未知字段被拒', !unknownField.ok && unknownField.errors.some((e) => e.includes('未知字段')));
}

console.log('--- 测试 4: 启用包合并与场景解析 ---');
{
  const custom = {
    glossaries: [
      {
        id: 'custom-mc-1',
        name: 'MC 自定义',
        description: 'test',
        builtIn: false,
        entries: [
          { id: 'c1', ja: 'クリーパー', zh: '苦力怕', category: 'term', source: 'upload', sourceType: 'community' }
        ]
      }
    ],
    scenes: [
      {
        id: 'custom-science-1',
        name: '科普自定义',
        description: 'test',
        builtIn: false,
        prompt: '你是一位严谨的科普译者，保持术语准确，必要时保留英文缩写。',
        hint: ''
      }
    ]
  };

  const onlyVtuber = collectGlossaryEntries(['vtuber-hololive'], custom);
  check('仅启用 VTuber 包时 146 条', onlyVtuber.length === 146, String(onlyVtuber.length));

  const withCustom = collectGlossaryEntries(['vtuber-hololive', 'custom-mc-1'], custom);
  check('启用自定义包后条目增加', withCustom.length === 147, String(withCustom.length));

  const none = collectGlossaryEntries([], custom);
  check('空启用列表回落默认包', none.length === 146);

  const mcEnabled = collectGlossaryEntries(['mc'], custom);
  check('仅启用 MC 包时条目 >= 60', mcEnabled.length >= 60, String(mcEnabled.length));
  check('MC 包可匹配苦力怕', mcEnabled.some((e) => e.ja === 'クリーパー' && e.zh === '苦力怕'));
  const aiEnabled = collectGlossaryEntries(['ai'], custom);
  check('仅启用 AI 包时条目 >= 30', aiEnabled.length >= 30, String(aiEnabled.length));

  check('内置场景解析 vtuber', resolveScenePrompt('vtuber', custom).name === 'VTuber 直播');
  check('占位场景回落 general', resolveScenePrompt('science', custom).name === '通用日常');
  check('自定义场景可解析', resolveScenePrompt('custom-science-1', custom).name === '科普自定义');
  check('未知场景回落 general', resolveScenePrompt('not-exist', custom).name === '通用日常');

  check('提示词指纹稳定', hashPrompt('abc') === hashPrompt('abc'));
  check('提示词变化指纹变化', hashPrompt('abc') !== hashPrompt('abd'));
}

console.log('--- 测试 5: 设置与存储 ---');
{
  const s1 = sanitizeSettings({});
  check('默认启用包列表', Array.isArray(s1.glossaryPacks) && s1.glossaryPacks[0] === 'vtuber-hololive', JSON.stringify(s1.glossaryPacks));
  const s2 = sanitizeSettings({ glossaryPacks: ['a', 123, '', 'b'] });
  check('非法元素被过滤', JSON.stringify(s2.glossaryPacks) === JSON.stringify(['a', 'b']), JSON.stringify(s2.glossaryPacks));
  const s3 = sanitizeSettings({ glossaryPacks: 'oops' });
  check('非数组回落默认', JSON.stringify(s3.glossaryPacks) === JSON.stringify(['vtuber-hololive']));
  const s4 = sanitizeSettings({ scenario: 'custom-science-1' });
  check('自定义场景 id 保留', s4.scenario === 'custom-science-1', s4.scenario);
  const s5 = sanitizeSettings({ scenario: 'bad id!!' });
  check('非法场景 id 回落 vtuber', s5.scenario === 'vtuber', s5.scenario);

  const custom = await loadCustomPacks();
  check('无 chrome 环境返回空包', custom.glossaries.length === 0 && custom.scenes.length === 0);
}

console.log(`\n结果: ${passed} 通过, ${failed} 失败`);
if (failed > 0) process.exit(1);
console.log('所有术语库/场景包测试通过！');
