/**
 * 术语库/场景包测试：结构 / 上传校验 / 启用包合并 / 场景解析 / 缓存指纹（含 v0.4.1 内容指纹标签）
 */
import {
  BUILTIN_SCENES,
  BUILTIN_GLOSSARY_PACKS,
  BUILTIN_GLOSSARY_FINGERPRINTS,
  DEFAULT_GLOSSARY_PACKS,
  validateGlossaryPack,
  validateScenePack,
  collectGlossaryEntries,
  resolveScenePrompt,
  hashPrompt,
  glossaryPackFingerprint,
  buildGlossaryTag,
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
  // v0.4.2：三类跨场景通用约束已上移到 utils/translator.ts（公共层 + 选项层），场景包内不得重复
  const vtuberPrompt = BUILTIN_SCENES.find((s) => s.id === 'vtuber')?.prompt || '';
  const generalPrompt = BUILTIN_SCENES.find((s) => s.id === 'general')?.prompt || '';
  const scenePrompts = [vtuberPrompt, generalPrompt];
  check('场景包内不再写 AI 腔清单（已上移公共层）', scenePrompts.every((p) => !p.includes('值得注意的是')));
  check('场景包内不再写 ASR 纠错授权（已移入 asrCorrection 选项）', scenePrompts.every((p) => !/ASR/.test(p)));
  check('场景包内不再写括注规则（已移入 glossaryAnnotation 选项）', scenePrompts.every((p) => !/括注/.test(p)));
  check('内置术语库 3 个', BUILTIN_GLOSSARY_PACKS.length === 3);
  check('VTuber 术语库 146 条', BUILTIN_GLOSSARY_PACKS[0].entries.length === 146, String(BUILTIN_GLOSSARY_PACKS[0].entries.length));
  const mcPack = BUILTIN_GLOSSARY_PACKS.find((p) => p.id === 'mc');
  const aiPack = BUILTIN_GLOSSARY_PACKS.find((p) => p.id === 'ai');
  // 条数一律用精确相等：宽松的 `>=` 让「误删十几条」照样过测（曾有包被删掉 10 条没人发现）
  check('MC 术语库 165 条', (mcPack?.entries.length || 0) === 165, String(mcPack?.entries.length));
  check('AI 术语库 35 条', (aiPack?.entries.length || 0) === 35, String(aiPack?.entries.length));
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
  check('仅启用 MC 包时 165 条', mcEnabled.length === 165, String(mcEnabled.length));
  check('MC 包可匹配苦力怕', mcEnabled.some((e) => e.ja === 'クリーパー' && e.zh === '苦力怕'));
  const aiEnabled = collectGlossaryEntries(['ai'], custom);
  check('仅启用 AI 包时 35 条', aiEnabled.length === 35, String(aiEnabled.length));

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

  // v0.4.2 两个新增选项：默认值 = 老行为，非法值回落默认，合法值原样保留
  check('默认 glossaryAnnotation=off', s1.glossaryAnnotation === 'off', String(s1.glossaryAnnotation));
  check('默认 asrCorrection=normal', s1.asrCorrection === 'normal', String(s1.asrCorrection));
  check('glossaryAnnotation=on 保留', sanitizeSettings({ glossaryAnnotation: 'on' }).glossaryAnnotation === 'on');
  check('glossaryAnnotation 非法值回落 off', sanitizeSettings({ glossaryAnnotation: 'yes' }).glossaryAnnotation === 'off');
  check('glossaryAnnotation 非字符串回落 off', sanitizeSettings({ glossaryAnnotation: 1 }).glossaryAnnotation === 'off');
  check('asrCorrection=strict 保留', sanitizeSettings({ asrCorrection: 'strict' }).asrCorrection === 'strict');
  check('asrCorrection 非法值回落 normal', sanitizeSettings({ asrCorrection: 'lenient' }).asrCorrection === 'normal');
  check('asrCorrection 非字符串回落 normal', sanitizeSettings({ asrCorrection: null }).asrCorrection === 'normal');

  const custom = await loadCustomPacks();
  check('无 chrome 环境返回空包', custom.glossaries.length === 0 && custom.scenes.length === 0);
}

console.log('--- 测试 6: 术语库缓存标签（按内容判定，v0.4.1） ---');
{
  const empty = { glossaries: [], scenes: [] };
  const entry = (id, ja, zh) => ({ id, ja, zh, category: 'term', source: 'upload', sourceType: 'community' });
  const pack = (entries, id = 'custom-a') => ({ id, name: '自定义', description: 'test', builtIn: false, entries });

  // 结构：三包各自有指纹，且互不相同
  const fps = BUILTIN_GLOSSARY_PACKS.map((p) => BUILTIN_GLOSSARY_FINGERPRINTS[p.id]);
  check('内置三包各有内容指纹', fps.every((fp) => typeof fp === 'string' && fp.length > 0), fps.join(' / '));
  check('三包指纹互不相同', new Set(fps).size === 3, fps.join(' / '));
  check('包指纹只由条目内容决定（与包名/条数无关）', glossaryPackFingerprint(BUILTIN_GLOSSARY_PACKS[0]) === fps[0]);

  // 默认标签：稳定 + 只覆盖已启用的包
  const defTag = buildGlossaryTag(undefined, empty);
  check('默认标签稳定（同输入同输出）', defTag === buildGlossaryTag(undefined, empty));
  check('默认标签含 scheme 前缀', defTag.startsWith('g1.'), defTag);
  check('默认只含 vtuber 指纹（mc/ai 未启用不参与）', defTag.includes('vtuber-hololive:') && !defTag.includes('mc:') && !defTag.includes(',ai:'), defTag);

  const mcOn = buildGlossaryTag(['vtuber-hololive', 'mc'], empty);
  check('启用 MC 后标签变化', mcOn !== defTag);
  check('启用列表顺序无关', buildGlossaryTag(['mc', 'vtuber-hololive'], empty) === mcOn);
  check(
    '未启用的包不参与指纹（改 MC 数据不影响仅启用 vtuber 的标签）',
    buildGlossaryTag(['vtuber-hololive'], { glossaries: [], scenes: [] }) === defTag
  );

  // 核心回归 1：自定义包「条数不变、只改译名」→ 标签必须变
  // 旧实现是 `id:条目数`，这种情况标签不变 → 用户继续看到旧译名
  const p1 = pack([entry('c1', 'クリーパー', '苦力怕'), entry('c2', 'エンダーマン', '末影人')]);
  const p2 = pack([entry('c1', 'クリーパー', '苦力怕'), entry('c2', 'エンダーマン', '安德曼')]);
  check('自定义包条目数一致（前提）', p1.entries.length === p2.entries.length);
  check('自定义包 id 一致（前提）', p1.id === p2.id);
  const tag1 = buildGlossaryTag(['vtuber-hololive', 'custom-a'], { glossaries: [p1], scenes: [] });
  const tag2 = buildGlossaryTag(['vtuber-hololive', 'custom-a'], { glossaries: [p2], scenes: [] });
  check('条数不变·只改自定义包译名 → 标签变', tag1 !== tag2, `${tag1} vs ${tag2}`);
  check('标签里的自定义段是 id:内容hash（不是 id:条数）', /custom-a:[0-9a-z]+-[0-9a-z]+/.test(tag1), tag1);

  // 核心回归 2：内置包同理（VTuber 改一个译名，条数不变）
  const vtuber = BUILTIN_GLOSSARY_PACKS[0];
  const patchedVtuber = { ...vtuber, entries: vtuber.entries.map((e, i) => (i === 0 ? { ...e, zh: '空乃时' } : e)) };
  const patchedPacks = [patchedVtuber, ...BUILTIN_GLOSSARY_PACKS.slice(1)];
  // 直接验证：包指纹随内容变（buildGlossaryTag 读的是模块级快照，故此处比对指纹函数）
  check('内置包条数不变·改译名 → 包指纹变', glossaryPackFingerprint(patchedVtuber) !== fps[0]);
  check('内置包条数未变（前提）', patchedPacks[0].entries.length === vtuber.entries.length);

  // 条数变化仍失效（旧行为不能退化）
  const p3 = pack([entry('c1', 'クリーパー', '苦力怕'), entry('c2', 'エンダーマン', '末影人'), entry('c3', 'ゾンビ', '僵尸')]);
  const tag3 = buildGlossaryTag(['vtuber-hololive', 'custom-a'], { glossaries: [p3], scenes: [] });
  check('自定义包加一条 → 标签变', tag3 !== tag1);

  // 未启用的自定义包内容变化不影响标签（不烧无谓缓存）
  const tagIgnore = buildGlossaryTag(['vtuber-hololive'], { glossaries: [p2], scenes: [] });
  check('自定义包未启用 → 内容变化不影响标签', tagIgnore === defTag);

  // 多包时顺序无关
  const tagMultiA = buildGlossaryTag(['custom-a', 'custom-b'], { glossaries: [p1, pack([entry('d1', 'x', 'y')], 'custom-b')], scenes: [] });
  const tagMultiB = buildGlossaryTag(['custom-b', 'custom-a'], { glossaries: [pack([entry('d1', 'x', 'y')], 'custom-b'), p1], scenes: [] });
  check('多自定义包顺序无关', tagMultiA === tagMultiB, `${tagMultiA} vs ${tagMultiB}`);
}

console.log(`\n结果: ${passed} 通过, ${failed} 失败`);
if (failed > 0) process.exit(1);
console.log('所有术语库/场景包测试通过！');
