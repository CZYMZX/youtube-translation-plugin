/**
 * 术语库 / 翻译场景「包」体系（v0.2.9）
 *
 * 设计：
 * - 内置包（builtIn=true）：VTuber 术语库（146 条）、MC 游戏术语库（0 条占位）、AI 术语库（0 条占位）；
 *   翻译场景：VTuber 直播、通用日常（有提示词），科普视频 / 音乐视频 / 游戏实况（0 占位）。
 * - 用户上传包：存 chrome.storage.local，结构由 validate*Packet 严格校验，不合格不入库。
 * - 上传规范见 docs/PACK-UPLOAD-SPEC.md（弹窗内也有摘要）。
 */
import type { GlossaryEntry, GlossaryCategory } from './glossary';
import { GLOSSARY } from './glossary';

export interface GlossaryPack {
  id: string;
  name: string;
  description: string;
  builtIn: boolean;
  entries: GlossaryEntry[];
}

export interface ScenePack {
  id: string;
  name: string;
  description: string;
  builtIn: boolean;
  /** 场景提示词（注入 system prompt）；空串 = 占位未配置 */
  prompt: string;
  /** 示例：这条场景适合什么视频 */
  hint: string;
}

export const CUSTOM_GLOSSARY_KEY = 'yt_sub_custom_glossary_packs';
export const CUSTOM_SCENE_KEY = 'yt_sub_custom_scene_packs';
/** 上传包格式版本 */
export const PACK_FORMAT_VERSION = 1;

/* ───────────────────────── 内置翻译场景 ───────────────────────── */

const VTUBER_SCENE_PROMPT = `你是一位精通 VTuber（虚拟主播）文化和 ACG 流行语的资深双语翻译字幕君（熟肉切片官/烤肉 Man）。
当前翻译场景是【VTuber 虚拟主播直播/切片】，请严格遵照以下行业翻译准则：
1. 风格生动活泼、萌趣传神、接地气，还原主播的性格特征、语气口癖与情绪起伏（如傲娇、惊慌尖叫、狂笑吐槽、假哭、自言自语等）。
2. 精准识别并地道翻译二次元/VTuber 圈内流行用语与弹幕黑话：
   - kusa / 草 / www / lmao -> “草”、“笑死”、“哈哈哈”、“www”
   - teetee / 尊い -> “太尊了”、“贴贴”、“甜死我了”
   - pon -> “天然呆”、“笨比”、“又犯蠢了”
   - seiso -> “清楚”（或反讽的“真清楚捏”）
   - yabai / yabe -> “牙白”、“要糟”、“寄了”、“坏了坏了”
   - stream / chat -> “直播间”、“弹幕区 / 观众们”
   - clipping / clipper -> “切片 / 烤肉组”
   - gachikoi / dd -> “单推 / 纯爱”、“DD”
   - superchat / sc -> “醒目留言 / SC”
   - 常见游戏用语（APEX/VALO/Minecraft等）：马枪、拉枪、偷屁股、下饭、送了
3. 主播与直播间弹幕观众（Chat）互动、互怼或玩梗时，译文必须符合国内熟肉切片和弹幕观看习惯，严禁僵硬死板的字面机翻。
4. 语言精炼易读，适合直播快节奏快速扫视。
5. 一人称按角色性格固定：俺/僕→“我”，あたし→“人家”或“我”，わし→“我”（只有明确老年角色才用“老夫”）。
6. 敬语分层：对 SC / 观众道谢保留礼貌但口语化（“谢谢老板的 SC！”），不要译成客服体。
7. 关西弁等方言轻口语化处理（捏 / 咧 / 嘛），不加方言注释。
8. 纯填充词（あの / その / えーっと）最多保留一个；情绪性感叹（えぇっ!?）保留。
9. 允许按上下文修正明显同音误转的 ASR 文本（如「パパって」实为「ぱぱっと」），但不得改写事实。`;

const GENERAL_SCENE_PROMPT = `你是一位精通视频双语字幕翻译的资深专家。
当前翻译场景是【通用日常视频与访谈】，要求：
1. 语言地道自然，符合影视与日常口语化表达习惯，简练通顺。
2. 保持上下文连贯，准确处理前后句的代词指代与隐喻。
3. 访谈类内容保留说话人的礼貌层级（です・ます 体对应适度礼貌的中文，不滥用“您”）。
4. 数字与单位本地化（3 日に 1 回 → “每三天一次”），专有名词保留原文或通用译名，不加括注。`;

export const BUILTIN_SCENES: ScenePack[] = [
  {
    id: 'vtuber',
    name: 'VTuber 直播',
    description: '虚拟主播直播 / 切片：口语化、梗文化、情绪还原',
    builtIn: true,
    prompt: VTUBER_SCENE_PROMPT,
    hint: '例：hololive 直播回放、游戏实况切片'
  },
  {
    id: 'general',
    name: '通用日常',
    description: '日常 vlog、访谈、闲聊：自然口语，保留礼貌层级',
    builtIn: true,
    prompt: GENERAL_SCENE_PROMPT,
    hint: '例：街头采访、生活 vlog'
  },
  {
    id: 'science',
    name: '科普视频',
    description: '科普 / 讲解类：术语准确、逻辑清晰（待上传场景包）',
    builtIn: true,
    prompt: '',
    hint: '例：TED-Ed、科学解说'
  },
  {
    id: 'music',
    name: '音乐视频',
    description: 'MV / 歌词 / 音乐访谈：歌词意译、押韵（待上传场景包）',
    builtIn: true,
    prompt: '',
    hint: '例：MV 字幕、歌词翻译'
  },
  {
    id: 'gaming',
    name: '游戏实况',
    description: '非 VTuber 游戏实况：操作解说、游戏术语（待上传场景包）',
    builtIn: true,
    prompt: '',
    hint: '例：攻略解说、速通'
  }
];

/* ───────────────────────── 内置术语库 ───────────────────────── */

export const BUILTIN_GLOSSARY_PACKS: GlossaryPack[] = [
  {
    id: 'vtuber-hololive',
    name: 'VTuber / hololive',
    description: '主播 80 · 团体 19 · 游戏 16 · 歌曲 12 · 用语 19',
    builtIn: true,
    entries: GLOSSARY
  },
  {
    id: 'mc',
    name: 'MC 游戏术语库',
    description: 'Minecraft 方块 / 生物 / 机制术语（待上传）',
    builtIn: true,
    entries: []
  },
  {
    id: 'ai',
    name: 'AI 专用术语库',
    description: 'AI / 大模型 / 编程术语（待上传）',
    builtIn: true,
    entries: []
  }
];

/** 默认启用的术语库包 */
export const DEFAULT_GLOSSARY_PACKS = ['vtuber-hololive'];

/* ───────────────────────── 自定义包：读写 ───────────────────────── */

interface StorageLike {
  get: (keys: string | string[]) => Promise<Record<string, unknown>>;
  set: (items: Record<string, unknown>) => Promise<void>;
}

function getLocalStorage(): StorageLike | null {
  try {
    const g = globalThis as any;
    if (g.chrome?.storage?.local?.get && g.chrome?.storage?.local?.set) {
      return {
        get: (keys) => g.chrome.storage.local.get(keys),
        set: (items) => g.chrome.storage.local.set(items)
      };
    }
  } catch {
    /* chrome 不可用（例如单测环境） */
  }
  return null;
}

export interface CustomPacks {
  glossaries: GlossaryPack[];
  scenes: ScenePack[];
}

export async function loadCustomPacks(): Promise<CustomPacks> {
  const storage = getLocalStorage();
  if (!storage) return { glossaries: [], scenes: [] };
  try {
    const raw = await storage.get([CUSTOM_GLOSSARY_KEY, CUSTOM_SCENE_KEY]);
    const glossaries = Array.isArray(raw[CUSTOM_GLOSSARY_KEY])
      ? (raw[CUSTOM_GLOSSARY_KEY] as GlossaryPack[]).filter((p) => p && Array.isArray(p.entries))
      : [];
    const scenes = Array.isArray(raw[CUSTOM_SCENE_KEY])
      ? (raw[CUSTOM_SCENE_KEY] as ScenePack[]).filter((p) => p && typeof p.prompt === 'string')
      : [];
    return { glossaries, scenes };
  } catch {
    return { glossaries: [], scenes: [] };
  }
}

async function persist(key: string, value: unknown): Promise<boolean> {
  const storage = getLocalStorage();
  if (!storage) return false;
  try {
    await storage.set({ [key]: value });
    return true;
  } catch {
    return false;
  }
}

export async function saveGlossaryPacks(packs: GlossaryPack[]): Promise<boolean> {
  return persist(CUSTOM_GLOSSARY_KEY, packs.filter((p) => !p.builtIn));
}

export async function saveScenePacks(packs: ScenePack[]): Promise<boolean> {
  return persist(CUSTOM_SCENE_KEY, packs.filter((p) => !p.builtIn));
}

/* ───────────────────────── 上传校验 ───────────────────────── */

export interface PackValidationResult<T> {
  ok: boolean;
  errors: string[];
  pack?: T;
}

const CATEGORY_SET = new Set<GlossaryCategory>(['talent', 'group', 'game', 'song', 'term']);
const SOURCE_TYPES = new Set(['official', 'wiki', 'community']);

function asString(value: unknown): string {
  return typeof value === 'string' ? value.trim() : '';
}

function makeId(prefix: string, name: string): string {
  const slug = name
    .toLowerCase()
    .replace(/[^a-z0-9\u4e00-\u9fff]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 24) || 'pack';
  return `${prefix}-${slug}-${Date.now().toString(36)}`;
}

/**
 * 校验并规范化「术语库上传包」
 * 格式：{ version, name, description?, entries: [{ ja, zh, en?, category?, source?, sourceType? }] }
 */
export function validateGlossaryPack(raw: unknown): PackValidationResult<GlossaryPack> {
  const errors: string[] = [];
  if (!raw || typeof raw !== 'object') {
    return { ok: false, errors: ['文件内容不是 JSON 对象'] };
  }
  const obj = raw as Record<string, unknown>;
  const name = asString(obj.name);
  if (!name) errors.push('缺少字段 name（术语库名称）');
  if (name.length > 40) errors.push('name 超过 40 字');

  const entriesRaw = obj.entries;
  if (!Array.isArray(entriesRaw) || entriesRaw.length === 0) {
    errors.push('entries 必须是非空数组');
  }
  if (Array.isArray(entriesRaw) && entriesRaw.length > 2000) {
    errors.push('单包条目不得超过 2000 条');
  }

  const entries: GlossaryEntry[] = [];
  if (Array.isArray(entriesRaw)) {
    entriesRaw.slice(0, 2000).forEach((item, i) => {
      const row = i + 1;
      if (!item || typeof item !== 'object') {
        errors.push(`第 ${row} 条不是对象`);
        return;
      }
      const e = item as Record<string, unknown>;
      const ja = asString(e.ja);
      const zh = asString(e.zh);
      if (!ja) errors.push(`第 ${row} 条缺少 ja（日文原词）`);
      if (!zh) errors.push(`第 ${row} 条缺少 zh（中文译名）`);
      if (ja.length > 60) errors.push(`第 ${row} 条 ja 超过 60 字`);
      if (zh.length > 120) errors.push(`第 ${row} 条 zh 超过 120 字`);
      if (!ja || !zh) return;
      const category = CATEGORY_SET.has(e.category as GlossaryCategory)
        ? (e.category as GlossaryCategory)
        : 'term';
      const sourceType = SOURCE_TYPES.has(String(e.sourceType))
        ? (e.sourceType as 'official' | 'wiki' | 'community')
        : 'community';
      entries.push({
        id: `custom-${row}`,
        ja,
        zh,
        en: asString(e.en) || undefined,
        category,
        source: asString(e.source) || '用户上传',
        sourceType
      });
    });
  }

  if (errors.length > 0) return { ok: false, errors };
  return {
    ok: true,
    errors: [],
    pack: {
      id: makeId('custom-glossary', name),
      name,
      description: asString(obj.description) || `用户上传 · ${entries.length} 条`,
      builtIn: false,
      entries
    }
  };
}

/**
 * 校验并规范化「翻译场景上传包」
 * 格式：{ version, name, description?, hint?, prompt }
 */
export function validateScenePack(raw: unknown): PackValidationResult<ScenePack> {
  const errors: string[] = [];
  if (!raw || typeof raw !== 'object') {
    return { ok: false, errors: ['文件内容不是 JSON 对象'] };
  }
  const obj = raw as Record<string, unknown>;
  const name = asString(obj.name);
  const prompt = asString(obj.prompt);
  if (!name) errors.push('缺少字段 name（场景名称）');
  if (name.length > 40) errors.push('name 超过 40 字');
  if (!prompt) errors.push('缺少字段 prompt（场景提示词）');
  if (prompt.length < 20) errors.push('prompt 少于 20 字，无法有效指导翻译');
  if (prompt.length > 4000) errors.push('prompt 超过 4000 字');

  const unknownKeys = Object.keys(obj).filter((k) => !['version', 'name', 'description', 'hint', 'prompt'].includes(k));
  if (unknownKeys.length > 0) errors.push(`存在未知字段：${unknownKeys.join(', ')}`);

  if (errors.length > 0) return { ok: false, errors };
  return {
    ok: true,
    errors: [],
    pack: {
      id: makeId('custom-scene', name),
      name,
      description: asString(obj.description) || '用户上传场景',
      hint: asString(obj.hint),
      builtIn: false,
      prompt
    }
  };
}

/* ───────────────────────── 解析与注入 ───────────────────────── */

export function getAllGlossaryPacks(custom: CustomPacks): GlossaryPack[] {
  return [...BUILTIN_GLOSSARY_PACKS, ...custom.glossaries];
}

export function getAllScenes(custom: CustomPacks): ScenePack[] {
  return [...BUILTIN_SCENES, ...custom.scenes];
}

/** 解析场景提示词；未配置/占位的场景回退到 general */
export function resolveScenePrompt(scenarioId: string, custom: CustomPacks): { prompt: string; name: string } {
  const scenes = getAllScenes(custom);
  const scene = scenes.find((s) => s.id === scenarioId);
  if (scene && scene.prompt) return { prompt: scene.prompt, name: scene.name };
  const fallback = scenes.find((s) => s.id === 'general');
  return { prompt: fallback?.prompt || '', name: fallback?.name || '通用日常' };
}

/** 场景提示词指纹（参与缓存键：自定义场景改提示词后旧译文失效） */
export function hashPrompt(prompt: string): string {
  let hash = 5381;
  for (let i = 0; i < prompt.length; i++) {
    hash = ((hash << 5) + hash + prompt.charCodeAt(i)) >>> 0;
  }
  return hash.toString(36);
}

/** 汇总启用包内的全部条目（用于匹配） */
export function collectGlossaryEntries(enabledPackIds: string[], custom: CustomPacks): GlossaryEntry[] {
  const packs = getAllGlossaryPacks(custom);
  const enabled = enabledPackIds.length > 0 ? enabledPackIds : DEFAULT_GLOSSARY_PACKS;
  const entries: GlossaryEntry[] = [];
  for (const pack of packs) {
    if (enabled.includes(pack.id)) entries.push(...pack.entries);
  }
  return entries;
}
