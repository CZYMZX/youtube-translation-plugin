/**
 * 场景配置 / 提示词装配守卫测试
 *
 * 断言口径：所有用例走 check() 计数器，末尾按失败数抛 AssertionError，进程以非零码退出。
 *
 * v0.4.2 起提示词分四层装配（utils/translator.ts），本文件按层断言：
 *   场景层 = 场景包 prompt（vtuber / general / 用户上传）
 *   公共层 = COMMON_RULES（禁 AI 腔 + 不增补；所有场景无条件继承）
 *   选项层 = glossaryAnnotation（专名括注）/ asrCorrection（ASR 纠错授权）
 *   推理层 = reasoningEffort
 * 术语块按批变化，不进指纹，也不在本文件断言范围内。
 *
 * 缓存指纹断言：tag = `s2.{场景id}#hash(整段静态骨架)`，骨架含公共层与选项层，
 * 因此「公共层改了 / 选项切换了 → 指纹变」可以被直接验证。
 */
import assert from 'node:assert/strict';
import { DEFAULT_SETTINGS } from '../types/index.ts';
import { BUILTIN_SCENES, BUILTIN_GLOSSARY_PACKS, hashPrompt } from '../utils/packs.ts';
import {
  COMMON_RULES,
  composeSystemPrompt,
  buildPromptSkeleton,
  buildScenarioTag,
  buildAnnotationRule,
  buildAsrRule
} from '../utils/translator.ts';

console.log('--- 测试: 场景与模型推理程度配置（v0.4.2 分层装配） ---');

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

const promptOf = (id) => BUILTIN_SCENES.find((s) => s.id === id)?.prompt || '';
const vtuber = promptOf('vtuber');
const general = promptOf('general');
// v0.5.0：music 场景新增「专名保留原文」条款，专名译名最容易被写死 —— 纳入同一批红线守卫
const music = promptOf('music');

// 默认配置下的完整静态骨架（= 默认 vtuber + off + normal + low）
const base = { ...DEFAULT_SETTINGS };
const skeletonDefault = buildPromptSkeleton(base, 'zh-CN');

// ── 1. 默认配置 ────────────────────────────────────────────────
check('默认场景应该是 vtuber', DEFAULT_SETTINGS.scenario === 'vtuber', String(DEFAULT_SETTINGS.scenario));
check('默认推理程度应该是 low', DEFAULT_SETTINGS.reasoningEffort === 'low', String(DEFAULT_SETTINGS.reasoningEffort));
check('默认括注关闭（glossaryAnnotation=off）', DEFAULT_SETTINGS.glossaryAnnotation === 'off', String(DEFAULT_SETTINGS.glossaryAnnotation));
check('默认 ASR 纠错为常规（asrCorrection=normal）', DEFAULT_SETTINGS.asrCorrection === 'normal', String(DEFAULT_SETTINGS.asrCorrection));
check('默认场景 id 指向内置场景（不是悬空 id）', BUILTIN_SCENES.some((s) => s.id === DEFAULT_SETTINGS.scenario));
check('场景取值仍含 vtuber / general', BUILTIN_SCENES.some((s) => s.id === 'vtuber') && BUILTIN_SCENES.some((s) => s.id === 'general'));

// ── 2. 提示词体量（条款上移后场景包变短，总量由公共层补齐）──────
console.log(`- 场景提示词体量：vtuber ${vtuber.length} 字 / general ${general.length} 字（上移前：1197 / 606）`);
console.log(`- 公共层 ${COMMON_RULES.length} 字；默认静态骨架合计 ${skeletonDefault.length} 字`);
check('vtuber 提示词非空且未被截断', vtuber.length > 100, `${vtuber.length} 字`);
check('general 提示词非空且未被截断', general.length > 100, `${general.length} 字`);
check('两个场景提示词内容不相同', vtuber !== general);
check('vtuber 提示词未超场景包 4000 字上限', vtuber.length <= 4000, `${vtuber.length} 字`);
check('general 提示词未超场景包 4000 字上限', general.length <= 4000, `${general.length} 字`);
check('公共段体量 ≤ 150 字（只放两条硬规则，不堆砌）', COMMON_RULES.length <= 150, `${COMMON_RULES.length} 字`);

// ── 3. 公共层：条款已上移、场景包内不再重复 ──────────────────────
const AI_SLOP = ['值得注意的是', '总而言之', '让我们一起', '首先', '不难发现', '综上所述', '众所周知', '由此可见'];
const hasAiSlopBan = (p) => AI_SLOP.every((w) => p.includes(w));

check('公共层含 AI 腔禁用清单（8 个禁用词齐全）', hasAiSlopBan(COMMON_RULES), AI_SLOP.filter((w) => !COMMON_RULES.includes(w)).join(','));
check('公共层含「不增补原文没有的信息」', /不增补原文没有的信息/.test(COMMON_RULES));
check(
  '公共层限定为「原文确有此意时照常译出」（不误删原文确有的表达）',
  /原文确有此意/.test(COMMON_RULES) && /漏译/.test(COMMON_RULES)
);
// 去重：条款只留一份，两个场景包里不许再写一遍（否则改一处会漏一处）
check('vtuber 包内已无 AI 腔清单（上移后不重复）', !hasAiSlopBan(vtuber));
check('general 包内已无 AI 腔清单（上移后不重复）', !hasAiSlopBan(general));
check('vtuber 包内已无 AI 腔 / 机翻腔条款（统一由公共层管）', !/禁用 AI 腔|机翻腔/.test(vtuber) && !/补连词/.test(vtuber));
check('general 包内已无 AI 腔 / 机翻腔条款（统一由公共层管）', !/禁用 AI 腔|机翻腔/.test(general) && !/补连词/.test(general));
check('vtuber 包内已无 ASR 条款（移入 asrCorrection 选项层）', !/ASR/.test(vtuber));
check('vtuber 包内已无括注条款（移入 glossaryAnnotation 选项层）', !/括注/.test(vtuber));
check('general 包内已无括注条款（移入 glossaryAnnotation 选项层）', !/括注/.test(general));

// 继承性：公共层与场景包文案无关 —— 换成任意自定义场景文案也照样带上
const customPersona = '你是一位播客字幕译者，要求口语化、保留语气词，不添加原文没有的信息。';
const customPrompt = composeSystemPrompt(customPersona, base, 'zh-CN');
check('自定义场景包（用户上传）同样继承公共层', customPrompt.includes(COMMON_RULES));
check('自定义场景包同样继承选项层（括注 + ASR）', customPrompt.includes('【专名书写') && customPrompt.includes('【ASR 纠错授权'));
check('自定义场景文案本身被保留', customPrompt.startsWith(customPersona));

// ── 4. 六类诊断问题的规则守卫（按层定位）───────────────────────
// 1) 一人称无映射 → わし 被译成「老夫」
check('vtuber 含一人称映射（含 わし）', /一人称/.test(vtuber) && /わし/.test(vtuber));
// 2) 敬语对象泛化 → 打赏者被泛化成「大家」
check('vtuber 含敬语分层（SC / 观众道谢）', /敬语/.test(vtuber) && /SC/.test(vtuber));
// 3) 方言逐批漂移 → 关西弁无统一策略
check('vtuber 含方言处理策略', /关西|方言/.test(vtuber));
// 4) 填充词全保留
check('vtuber 含填充词折叠策略', /填充词/.test(vtuber));

// ── 5. 选项层：专名括注（off / on 两态）────────────────────────
const offPrompt = composeSystemPrompt('场景文案占位（长度足够以通过装配）', { ...base, glossaryAnnotation: 'off' }, 'zh-CN');
const onPrompt = composeSystemPrompt('场景文案占位（长度足够以通过装配）', { ...base, glossaryAnnotation: 'on' }, 'zh-CN');

check('off：明确「只给一个中文译名」', /只给中文译名/.test(buildAnnotationRule('off')));
check('off：禁止括号原文 / 罗马字 / 英文补充', /不得附括号原文/.test(buildAnnotationRule('off')) && /罗马字/.test(buildAnnotationRule('off')));
check('off：要求同批同一专名同一译法', /同一批内同一专名必须同一译法/.test(buildAnnotationRule('off')));
check('off：未出现 on 的格式定义（两态互斥）', !/（日文原文）/.test(buildAnnotationRule('off')));

check('on：格式唯一，统一为「中文译名（日文原文）」', /统一写成「中文译名（日文原文）」/.test(buildAnnotationRule('on')));
check('on：括号内只放日文原词，禁英文 / 罗马字混用', /只放日文原词/.test(buildAnnotationRule('on')) && /不放英文、不放罗马字/.test(buildAnnotationRule('on')));
check('on：明确否掉「中文（英文）」「中文（罗马字）」写法', /不要写成「中文（英文）」「中文（罗马字）」/.test(buildAnnotationRule('on')));
check('on：术语表命中的条目也带括号原文', /术语表已给出的条目/.test(buildAnnotationRule('on')) && /补上日文原词/.test(buildAnnotationRule('on')));
check('on：未命中术语表的专名同样括注原文', /未命中术语表的专名同样要括注原文/.test(buildAnnotationRule('on')));
check('on：与术语块标题「不得加注原文」冲突处明确以本条为准', /不得加注原文.按本条执行/.test(buildAnnotationRule('on')));
check('on：拉丁字母原名不重复括注（AZKi / IRyS）', /只写一次原名/.test(buildAnnotationRule('on')));

check('off 生效于完整 prompt（默认取 off）', offPrompt.includes(buildAnnotationRule('off')) && !offPrompt.includes(buildAnnotationRule('on')));
check('on 生效于完整 prompt', onPrompt.includes(buildAnnotationRule('on')) && !onPrompt.includes(buildAnnotationRule('off')));

// ── 5b. on 档：译名自带括号时的去重约定（v0.4.4）───────────────
// 遗留项：术语表 `スパチャ → SC（醒目留言）` 照「中文译名（日文原文）」会叠成双层括号。
// 断言口径与前文一致：只判「规则在不在、边界划没划」，真实译文仍需接模型抽检。
const onRule = buildAnnotationRule('on');

// (a) 期望形态：SC（醒目留言）→ SC（スパチャ）
check('on：括注去重条款存在（不许叠成两层）', /不得叠成两层/.test(onRule));
check('on：给出真实反例「SC（醒目留言）」', /「SC（醒目留言）」/.test(onRule));
check('on：期望形态钉死为「SC（スパチャ）」', /写成「SC（スパチャ）」/.test(onRule));
check('on：明确括号内中文解释要丢弃（不是译名的一部分）', /中文解释丢掉/.test(onRule) && /不属于译名/.test(onRule));
// 反例的 zh 必须与术语库里的真实条目一致，否则规则举例会和数据脱节
const vtuberPack = BUILTIN_GLOSSARY_PACKS.find((p) => p.id === 'vtuber-hololive');
const scEntry = (vtuberPack?.entries || []).find((e) => e.ja === 'スパチャ');
check('术语库真实条目 = `スパチャ → SC（醒目留言）`（规则举例与数据同源）', scEntry?.zh === 'SC（醒目留言）', String(scEntry?.zh));
check('真实条目的 zh 用的是全角圆括号（与规则判定口径一致）', /^[^（]+（[^）]+）$/.test(scEntry?.zh || ''), String(scEntry?.zh));

// (b) 边界一：只认全角圆括号
check('on：去重只认全角圆括号（）', /只认全角圆括号（）/.test(onRule));
check('on：半角括号 / 「」『』 / 方括号不据此拆分', /半角括号、「」『』、方括号都不算注释/.test(onRule) && /不据此拆分/.test(onRule));

// (c) 边界二：拉丁字母原名不重复（AZKi 不得变成 AZKi（AZKi））
check('on：拉丁字母原名仍「只写一次」（去重条款未推翻上轮约定）', /只写一次原名/.test(onRule));
check('on：全段不出现拉丁字母自重复括注（AZKi（AZKi）这类）', !/([A-Za-z][A-Za-z0-9_]*)\s*（\s*\1\s*）/.test(onRule));
check('on：拉丁字母条目不触发去重（它不带全角括号，拆不出主词）', !/AZKi（|IRyS（/.test(onRule));

// (d) 边界三：括号内是必要限定时保留原样
check('on：限定型括号（同名区分）保留原样、不拆', /佐藤（声优）/.test(onRule) && /整条译名保留原样/.test(onRule));
check('on：限定型不追加原文（宁少一次括注也不叠括号）', /不再追加原文/.test(onRule));
check('on：给出可执行的判定标准（主词是否仍唯一指向）', /仍能唯一指向该专名/.test(onRule) && /指代会变歧义/.test(onRule));

// (e) 只在 on 档生效，off 档完全不受影响
const offRule = buildAnnotationRule('off');
const DEDUP_MARKS = [/叠成两层/, /主词/, /醒目留言/, /全角圆括号/, /佐藤/, /唯一指向/];
check('off：不含任何去重条款字样（off 本来就禁括号）', DEDUP_MARKS.every((re) => !re.test(offRule)));
check('off：完整 prompt 里也不出现去重条款', DEDUP_MARKS.every((re) => !re.test(offPrompt)));
check('off：仍要求只出现一个中文译名（行为一字未变）', /只出现一个中文译名/.test(offRule) && /不得附括号原文/.test(offRule));
console.log(`- 括注规则体量：off ${offRule.length} 字 / on ${onRule.length} 字（去重条款占 ${onRule.length - 264} 字，仅 on 档每次请求一次）`);
check('on 规则体量可控（≤ 520 字，防止日后无限堆条款）', onRule.length <= 520, `${onRule.length} 字`);

// 术语块表头写死「不得加注原文」，与 on 档冲突：必须紧贴术语块声明优先级
const fakeGlossary = '\n【术语库·必须严格采用以下译名，专有名词不得音译或加注原文】\n- ときのそら → 时乃空（主播）';
const onWithGlossary = composeSystemPrompt('场景文案占位（长度足够以通过装配）', { ...base, glossaryAnnotation: 'on' }, 'zh-CN', fakeGlossary);
const offWithGlossary = composeSystemPrompt('场景文案占位（长度足够以通过装配）', { ...base, glossaryAnnotation: 'off' }, 'zh-CN', fakeGlossary);
check('on：术语块前就地带一句「表头不适用」的优先级声明', /【括注已开启】紧邻下方术语块标题/.test(onWithGlossary));
check('on：优先级声明位于术语块之前', onWithGlossary.indexOf('【括注已开启】紧邻下方术语块标题') < onWithGlossary.indexOf('【术语库'));
check('off：不出现优先级声明（无冲突不必多说）', !/紧邻下方术语块标题/.test(offWithGlossary));
check('术语块本体原样注入（未被改写）', offWithGlossary.includes('ときのそら → 时乃空'));
// 去重条款必须落在完整 prompt 里（不只是规则函数里）—— 否则等于没生效
check('on：完整 prompt 里带去重条款', onWithGlossary.includes('不得叠成两层') && /写成「SC（スパチャ）」/.test(onWithGlossary));

// ── 6. 选项层：ASR 纠错授权（normal / strict 两态）─────────────
const normalRule = buildAsrRule('normal');
const strictRule = buildAsrRule('strict');
check('normal：可按上下文修正明显同音误转', /明显同音误转/.test(normalRule));
check('normal：限定不得改写事实', /不得改写事实/.test(normalRule));
check('strict：只在上下文可确证时改', /上下文能确证/.test(strictRule));
check('strict：明确「不确定就保留原文」', /不确定就保留原文原样/.test(strictRule));
check('strict：同样限定不得改写事实 / 不补内容', /不得改写事实/.test(strictRule) && /不得补出原文没有的信息/.test(strictRule));
check('strict / normal 文案互斥', normalRule !== strictRule && !/不确定就保留原文/.test(normalRule));
check('默认取 normal（老行为不变）', composeSystemPrompt('场景文案占位（长度足够以通过装配）', base, 'zh-CN').includes(normalRule));

// ── 7. 缓存指纹：必须覆盖公共层 + 选项层 ───────────────────────
const tagOf = (patch) => buildScenarioTag({ ...base, ...patch }, 'zh-CN');
const tagDefault = tagOf({});
console.log(`- 默认指纹：${tagDefault}`);
check('指纹含口径前缀 s2.（与只 hash 场景包的 s1 区分开）', tagDefault.startsWith('s2.'), tagDefault);
check('指纹 = s2.{场景id}#hash(整段静态骨架)', tagDefault === `s2.vtuber#${hashPrompt(buildPromptSkeleton(base, 'zh-CN'))}`);
check('静态骨架确实包含公共层（⇒ 公共层改字 → 指纹必变）', buildPromptSkeleton(base, 'zh-CN').includes(COMMON_RULES));
check('静态骨架不包含按批变化的术语块（⇒ 不会因批次不同而抖动）', !/【术语库/.test(buildPromptSkeleton(base, 'zh-CN')));
check('切换 glossaryAnnotation off→on → 指纹变化', tagOf({ glossaryAnnotation: 'on' }) !== tagDefault, `${tagDefault} vs ${tagOf({ glossaryAnnotation: 'on' })}`);
check('切换 asrCorrection normal→strict → 指纹变化', tagOf({ asrCorrection: 'strict' }) !== tagDefault, `${tagDefault} vs ${tagOf({ asrCorrection: 'strict' })}`);
check('换场景（vtuber→general）→ 指纹变化', tagOf({ scenario: 'general' }) !== tagDefault);
check(
  '占位场景（science）回落 general 文案，但 id 段仍是 science（键互不覆盖）',
  tagOf({ scenario: 'science' }) === `s2.science#${hashPrompt(buildPromptSkeleton({ ...base, scenario: 'science' }, 'zh-CN'))}`
);
check('指纹同输入同输出（稳定）', tagOf({}) === tagOf({}));
check('缩略：两个选项同时切换 → 指纹仍变化', tagOf({ glossaryAnnotation: 'on', asrCorrection: 'strict' }) !== tagDefault);

// ── 8. 红线守卫：术语译名不得写死进场景 prompt ─────────────────
const mcPack = BUILTIN_GLOSSARY_PACKS.find((p) => p.id === 'mc');
const mcSamples = (mcPack?.entries || []).filter((e) => ['苦力怕', '末影人', '潜影贝', '下界合金锭'].includes(e.zh));
check('MC 术语库可用于红线抽样', mcSamples.length >= 3, String(mcSamples.length));
const hardcoded = [vtuber, general, music].some((p) => mcSamples.some((e) => p.includes(e.zh)));
check('场景 prompt 未写死术语库译名（不绕过术语注入）', !hardcoded);
// v0.5.0：music 的「专名保留原文」条款最容易顺手写死歌曲 / 主播译名 —— 单独抽一遍歌曲条目
const songSamples = (BUILTIN_GLOSSARY_PACKS[0]?.entries || []).filter((e) => e.category === 'song');
check('VTuber 术语库的歌曲条目可用于红线抽样', songSamples.length >= 3, String(songSamples.length));
const songHardcoded = [vtuber, general, music].some((p) => songSamples.some((e) => p.includes(e.zh)));
check('场景 prompt 未写死歌曲译名（music 的专名条款同样不许绕过术语注入）', !songHardcoded);
// v0.5.0：music 同时有「专名保留原文」与术语库「用译名」两条，优先级必须写在 prompt 里，否则模型两套规则乱套
check(
  'music：术语库优先于「保留原文」的优先级写进了场景 prompt',
  /术语库已给出的条目以术语库的译名为准/.test(music) && /术语库未命中的专名才按上面的口径保留原文/.test(music)
);
check('music：保留原文的专名不再另配译名（与选项层通用专名条款划清界）', /不再另配目标语言译名/.test(music));

// ── 9. 六条诊断样本：只判「有无规则覆盖」，不是真实译文对照 ────────
// 真实译文质量需接模型跑，这里固定住「规则不丢」这一层，防止后续重写 prompt 又漏条款。
// 规则已分层，need 分景匹配：场景层查场景包，公共层 / 选项层查完整骨架。
const samples = [
  { text: 'スパチャありがとうございます', layer: '场景层 vtuber 第 6 条（敬语分层 / SC 道谢不译成客服体）', src: skeletonDefault, need: [/敬语/, /SC/] },
  { text: 'わしもそう思うわ', layer: '场景层 vtuber 第 5 条（一人称映射，わし→我）', src: skeletonDefault, need: [/一人称/, /わし/] },
  { text: 'ガルガンダーを捕まえる', layer: '选项层 glossaryAnnotation=off（专名只给中文译名、不括注、同批一致）', src: skeletonDefault, need: [/括注/, /专名/, /同一批/] },
  { text: 'ガルガンダーを捕まえる（括注开启）', layer: '选项层 glossaryAnnotation=on（中文译名（日文原文））', src: buildPromptSkeleton({ ...base, glossaryAnnotation: 'on' }, 'zh-CN'), need: [/（日文原文）/, /只放日文原词/] },
  { text: 'あの、その、えーっと…（填充词串）', layer: '场景层 vtuber 第 8 条（纯填充词最多保留一个）', src: skeletonDefault, need: [/填充词/] },
  { text: 'パパって食べれるパン', layer: '选项层 asrCorrection=normal（同音误转可纠、不得改写事实）', src: skeletonDefault, need: [/ASR/, /同音/, /不得改写事实/] },
  { text: 'パパって食べれるパン（严格模式）', layer: '选项层 asrCorrection=strict（不确定就保留原文）', src: buildPromptSkeleton({ ...base, asrCorrection: 'strict' }, 'zh-CN'), need: [/ASR/, /不确定就保留原文/] },
  { text: '関西弁のセリフ（关西腔）', layer: '场景层 vtuber 第 7 条（方言轻口语化、不加方言注释）', src: skeletonDefault, need: [/关西|方言/] },
  { text: '（任意一句，检查 AI 腔）', layer: '公共层 COMMON_RULES（禁用 AI 腔套话）', src: skeletonDefault, need: [/值得注意的是/, /原文没有|不增补/] }
];
for (const s of samples) {
  const covered = s.need.every((re) => re.test(s.src));
  check(`样本「${s.text}」有规则覆盖`, covered, covered ? s.layer : `缺规则覆盖（${s.layer}）`);
}

// ── 10. 上轮遗留缺口：本轮闭合状态 ─────────────────────────────
const stillOpen = [];
if (!hasAiSlopBan(COMMON_RULES)) stillOpen.push('公共层无 AI 腔清单');
if (!(hasAiSlopBan(COMMON_RULES) && !hasAiSlopBan(vtuber) && !hasAiSlopBan(general))) stillOpen.push('AI 腔条款未真正上移（仍在场景包 / 或漏了）');
if (!/访谈/.test(general) && !/讲解|科普/.test(general)) stillOpen.push('general 无自适应分层');
if (/括注/.test(vtuber + general)) stillOpen.push('括注条款仍写在场景包里（选项层无法生效）');
if (/ASR/.test(vtuber + general)) stillOpen.push('ASR 条款仍写在场景包里（选项层无法生效）');
check('上轮遗留缺口已闭合（AI 腔上移 / 分层 / 括注与 ASR 归位到选项层）', stillOpen.length === 0, stillOpen.join(' / '));

console.log(`\n汇总: ${passed} 通过, ${failed} 失败`);
if (failed > 0) {
  assert.fail(`场景/提示词守卫有 ${failed} 项失败，详见上方 ✗ 行`);
}
console.log('\n所有测试项验证通过！');
