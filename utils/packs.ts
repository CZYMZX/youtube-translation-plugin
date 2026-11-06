/**
 * 术语库 / 翻译场景「包」体系（v0.2.9）
 *
 * 设计：
 * - 内置包（builtIn=true）：VTuber 术语库（146 条）、MC 游戏术语库（165 条）、AI 术语库（35 条）；
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

/* ───────────────────── MC 术语库（v0.3.1 内置） ─────────────────────
 * 数据来源：Minecraft Java Edition 1.21.4 官方语言文件
 *   assets/minecraft/lang/{ja_jp,zh_cn,en_us}.json
 *   （镜像：cdn.jsdelivr.net/gh/InventivetalentDev/minecraft-assets@1.21.4）
 * 生成方式：按官方本地化 key 精确取值，非人工转写，保证与游戏内译名逐字一致。
 * 共 165 条：方块 44 · 物品 36 · 生物 54 · 机制 28 · 维度 3
 * 数据日期：2026-11-05。
 * 复核：2026-11-06 用 ja_jp 值反查 key、再比对 zh_cn，165/165 逐字一致（0 差异、0 缺失 key），
 *   6 处写法偏差（レッドストーンダスト / ネザライトインゴット / 松明 / ジ・エンド / 白色のベッド /
 *   シード値）中前 5 项在库，`シード値` 不在 165 条选集中；药水效果三项（移動速度上昇→迅捷、
 *   採掘速度上昇→急迫、攻撃力上昇→力量）在库。
 */
const MC_TERMS: Array<[string, string, string]> = [
  ['草ブロック', '草方块', 'Grass Block'],
  ['土', '泥土', 'Dirt'],
  ['石', '石头', 'Stone'],
  ['丸石', '圆石', 'Cobblestone'],
  ['オークの原木', '橡木原木', 'Oak Log'],
  ['オークの板材', '橡木木板', 'Oak Planks'],
  ['砂', '沙子', 'Sand'],
  ['砂利', '沙砾', 'Gravel'],
  ['石炭鉱石', '煤矿石', 'Coal Ore'],
  ['鉄鉱石', '铁矿石', 'Iron Ore'],
  ['銅鉱石', '铜矿石', 'Copper Ore'],
  ['金鉱石', '金矿石', 'Gold Ore'],
  ['ダイヤモンド鉱石', '钻石矿石', 'Diamond Ore'],
  ['エメラルド鉱石', '绿宝石矿石', 'Emerald Ore'],
  ['レッドストーン鉱石', '红石矿石', 'Redstone Ore'],
  ['ラピスラズリ鉱石', '青金石矿石', 'Lapis Lazuli Ore'],
  ['黒曜石', '黑曜石', 'Obsidian'],
  ['ネザーラック', '下界岩', 'Netherrack'],
  ['ソウルサンド', '灵魂沙', 'Soul Sand'],
  ['グロウストーン', '荧石', 'Glowstone'],
  ['エンドストーン', '末地石', 'End Stone'],
  ['作業台', '工作台', 'Crafting Table'],
  ['かまど', '熔炉', 'Furnace'],
  ['チェスト', '箱子', 'Chest'],
  ['エンダーチェスト', '末影箱', 'Ender Chest'],
  ['松明', '火把', 'Torch'],
  ['はしご', '梯子', 'Ladder'],
  ['TNT', 'TNT', 'TNT'],
  ['白色のベッド', '白色床', 'White Bed'],
  ['エンチャントテーブル', '附魔台', 'Enchanting Table'],
  ['醸造台', '酿造台', 'Brewing Stand'],
  ['金床', '铁砧', 'Anvil'],
  ['本棚', '书架', 'Bookshelf'],
  ['ホッパー', '漏斗', 'Hopper'],
  ['ピストン', '活塞', 'Piston'],
  ['ディスペンサー', '发射器', 'Dispenser'],
  ['ドロッパー', '投掷器', 'Dropper'],
  ['レバー', '拉杆', 'Lever'],
  ['ガラス', '玻璃', 'Glass'],
  ['シュルカーボックス', '潜影盒', 'Shulker Box'],
  ['ネザライトブロック', '下界合金块', 'Block of Netherite'],
  ['レッドストーンブロック', '红石块', 'Block of Redstone'],
  ['氷', '冰', 'Ice'],
  ['雪ブロック', '雪块', 'Snow Block'],
  ['レッドストーンダスト', '红石粉', 'Redstone Dust'],
  ['ダイヤモンド', '钻石', 'Diamond'],
  ['エメラルド', '绿宝石', 'Emerald'],
  ['ラピスラズリ', '青金石', 'Lapis Lazuli'],
  ['ネザークォーツ', '下界石英', 'Nether Quartz'],
  ['石炭', '煤炭', 'Coal'],
  ['木炭', '木炭', 'Charcoal'],
  ['鉄インゴット', '铁锭', 'Iron Ingot'],
  ['金インゴット', '金锭', 'Gold Ingot'],
  ['銅インゴット', '铜锭', 'Copper Ingot'],
  ['ネザライトインゴット', '下界合金锭', 'Netherite Ingot'],
  ['ネザライトの欠片', '下界合金碎片', 'Netherite Scrap'],
  ['エンダーパール', '末影珍珠', 'Ender Pearl'],
  ['エンダーアイ', '末影之眼', 'Eye of Ender'],
  ['ブレイズロッド', '烈焰棒', 'Blaze Rod'],
  ['金のリンゴ', '金苹果', 'Golden Apple'],
  ['エンチャントされた金のリンゴ', '附魔金苹果', 'Enchanted Golden Apple'],
  ['エンチャントの本', '附魔书', 'Enchanted Book'],
  ['名札', '命名牌', 'Name Tag'],
  ['弓', '弓', 'Bow'],
  ['矢', '箭', 'Arrow'],
  ['ダイヤモンドの剣', '钻石剑', 'Diamond Sword'],
  ['ダイヤモンドのツルハシ', '钻石镐', 'Diamond Pickaxe'],
  ['盾', '盾牌', 'Shield'],
  ['バケツ', '铁桶', 'Bucket'],
  ['水入りバケツ', '水桶', 'Water Bucket'],
  ['溶岩入りバケツ', '熔岩桶', 'Lava Bucket'],
  ['コンパス', '指南针', 'Compass'],
  ['時計', '时钟', 'Clock'],
  ['白紙の地図', '空地图', 'Empty Map'],
  ['釣竿', '钓鱼竿', 'Fishing Rod'],
  ['パン', '面包', 'Bread'],
  ['ステーキ', '牛排', 'Steak'],
  ['ポーション', '药水', 'Potion'],
  ['エリトラ', '鞘翅', 'Elytra'],
  ['シュルカーの殻', '潜影壳', 'Shulker Shell'],
  ['クリーパー', '苦力怕', 'Creeper'],
  ['ゾンビ', '僵尸', 'Zombie'],
  ['スケルトン', '骷髅', 'Skeleton'],
  ['クモ', '蜘蛛', 'Spider'],
  ['洞窟グモ', '洞穴蜘蛛', 'Cave Spider'],
  ['エンダーマン', '末影人', 'Enderman'],
  ['スライム', '史莱姆', 'Slime'],
  ['ウィッチ', '女巫', 'Witch'],
  ['村人', '村民', 'Villager'],
  ['行商人', '流浪商人', 'Wandering Trader'],
  ['アイアンゴーレム', '铁傀儡', 'Iron Golem'],
  ['スノウゴーレム', '雪傀儡', 'Snow Golem'],
  ['オオカミ', '狼', 'Wolf'],
  ['ネコ', '猫', 'Cat'],
  ['ヤマネコ', '豹猫', 'Ocelot'],
  ['キツネ', '狐狸', 'Fox'],
  ['パンダ', '熊猫', 'Panda'],
  ['シロクマ', '北极熊', 'Polar Bear'],
  ['ラマ', '羊驼', 'Llama'],
  ['ミツバチ', '蜜蜂', 'Bee'],
  ['イルカ', '海豚', 'Dolphin'],
  ['カメ', '海龟', 'Turtle'],
  ['ウーパールーパー', '美西螈', 'Axolotl'],
  ['カエル', '青蛙', 'Frog'],
  ['イカ', '鱿鱼', 'Squid'],
  ['コウモリ', '蝙蝠', 'Bat'],
  ['オウム', '鹦鹉', 'Parrot'],
  ['ウサギ', '兔子', 'Rabbit'],
  ['ニワトリ', '鸡', 'Chicken'],
  ['ウシ', '牛', 'Cow'],
  ['ブタ', '猪', 'Pig'],
  ['ヒツジ', '绵羊', 'Sheep'],
  ['ウマ', '马', 'Horse'],
  ['エンダードラゴン', '末影龙', 'Ender Dragon'],
  ['ウィザー', '凋灵', 'Wither'],
  ['ガスト', '恶魂', 'Ghast'],
  ['ブレイズ', '烈焰人', 'Blaze'],
  ['ゾンビピグリン', '僵尸猪灵', 'Zombified Piglin'],
  ['ピグリン', '猪灵', 'Piglin'],
  ['ホグリン', '疣猪兽', 'Hoglin'],
  ['ストライダー', '炽足兽', 'Strider'],
  ['ウィザースケルトン', '凋灵骷髅', 'Wither Skeleton'],
  ['ガーディアン', '守卫者', 'Guardian'],
  ['エルダーガーディアン', '远古守卫者', 'Elder Guardian'],
  ['シュルカー', '潜影贝', 'Shulker'],
  ['ファントム', '幻翼', 'Phantom'],
  ['ピリジャー', '掠夺者', 'Pillager'],
  ['ヴィンディケーター', '卫道士', 'Vindicator'],
  ['エヴォーカー', '唤魔者', 'Evoker'],
  ['ラヴェジャー', '劫掠兽', 'Ravager'],
  ['ヴェックス', '恼鬼', 'Vex'],
  ['ウォーデン', '监守者', 'Warden'],
  ['アレイ', '悦灵', 'Allay'],
  ['商人のラマ', '行商羊驼', 'Trader Llama'],
  ['移動速度上昇', '迅捷', 'Speed'],
  ['移動速度低下', '缓慢', 'Slowness'],
  ['採掘速度上昇', '急迫', 'Haste'],
  ['攻撃力上昇', '力量', 'Strength'],
  ['跳躍力上昇', '跳跃提升', 'Jump Boost'],
  ['再生能力', '生命恢复', 'Regeneration'],
  ['火炎耐性', '抗火', 'Fire Resistance'],
  ['水中呼吸', '水下呼吸', 'Water Breathing'],
  ['暗視', '夜视', 'Night Vision'],
  ['毒', '中毒', 'Poison'],
  ['弱体化', '虚弱', 'Weakness'],
  ['空腹', '饥饿', 'Hunger'],
  ['ダメージ増加', '锋利', 'Sharpness'],
  ['効率強化', '效率', 'Efficiency'],
  ['耐久力', '耐久', 'Unbreaking'],
  ['ダメージ軽減', '保护', 'Protection'],
  ['幸運', '时运', 'Fortune'],
  ['シルクタッチ', '精准采集', 'Silk Touch'],
  ['修繕', '经验修补', 'Mending'],
  ['落下耐性', '摔落缓冲', 'Feather Falling'],
  ['射撃ダメージ増加', '力量', 'Power'],
  ['サバイバルモード', '生存模式', 'Survival Mode'],
  ['クリエイティブモード', '创造模式', 'Creative Mode'],
  ['ハードコアモード！', '极限模式！', 'Hardcore Mode!'],
  ['スペクテイターモード', '旁观模式', 'Spectator Mode'],
  ['最大体力', '最大生命值', 'Max Health'],
  ['平原', '平原', 'Plains'],
  ['砂漠', '沙漠', 'Desert'],
  ['オーバーワールド', '主世界', 'Overworld'],
  ['ネザー', '下界', 'Nether'],
  ['ジ・エンド', '末地', 'The End']
];

/* ───────────────────── AI 术语库（v0.3.0 内置） ─────────────────────
 * 来源：日文维基百科条目 + 中文维基对应条目（经 API 跨语言链接核对，28/35 有对应条目），
 * 中文译名取业界通行译法；无语种链接的术语人工核定。
 * 数据时间：2026-11-05。
 * 注意：source 是「包级来源」（35 条统一指向大規模言語モデル 条目），不是逐条 URL；
 *   逐条核对方法与未立条清单见 docs/GLOSSARY-0.2.9-accum-B-官方核对.md 第九节。
 */
const AI_TERMS: Array<[string, string, string]> = [
  ['人工知能', '人工智能', 'Artificial Intelligence'],
  ['機械学習', '机器学习', 'Machine Learning'],
  ['深層学習', '深度学习', 'Deep Learning'],
  ['ニューラルネットワーク', '神经网络', 'Neural Network'],
  ['大規模言語モデル', '大语言模型', 'Large Language Model'],
  ['生成AI', '生成式 AI', 'Generative AI'],
  ['自然言語処理', '自然语言处理', 'Natural Language Processing'],
  ['教師あり学習', '监督学习', 'Supervised Learning'],
  ['教師なし学習', '无监督学习', 'Unsupervised Learning'],
  ['強化学習', '强化学习', 'Reinforcement Learning'],
  ['ファインチューニング', '微调', 'Fine-tuning'],
  ['プロンプト', '提示词', 'Prompt'],
  ['プロンプトエンジニアリング', '提示词工程', 'Prompt Engineering'],
  ['ハルシネーション', '幻觉', 'Hallucination'],
  ['トークン', '词元', 'Token'],
  ['埋め込み', '嵌入', 'Embedding'],
  ['推論', '推理', 'Inference'],
  ['事前学習', '预训练', 'Pre-training'],
  ['データセット', '数据集', 'Dataset'],
  ['ベンチマーク', '基准测试', 'Benchmark'],
  ['マルチモーダル', '多模态', 'Multimodal'],
  ['検索拡張生成', '检索增强生成', 'Retrieval-Augmented Generation'],
  ['エージェント', '智能体', 'Agent'],
  ['コンテキストウィンドウ', '上下文窗口', 'Context Window'],
  ['量子化', '量化', 'Quantization'],
  ['蒸留', '蒸馏', 'Distillation'],
  ['注意機構', '注意力机制', 'Attention Mechanism'],
  ['トランスフォーマー', 'Transformer', 'Transformer'],
  ['過学習', '过拟合', 'Overfitting'],
  ['転移学習', '迁移学习', 'Transfer Learning'],
  ['敵対的生成ネットワーク', '生成对抗网络', 'GAN'],
  ['音声認識', '语音识别', 'Speech Recognition'],
  ['音声合成', '语音合成', 'Speech Synthesis'],
  ['画像生成', '图像生成', 'Image Generation'],
  ['光学文字認識', '光学字符识别', 'OCR']
];

/** 由元组表生成内置包条目 */
function buildBuiltinEntries(
  idPrefix: string,
  category: GlossaryCategory,
  terms: Array<[string, string, string]>,
  source: string,
  sourceType: 'official' | 'wiki' | 'community',
  contextOnly: ReadonlyArray<string> = []
): GlossaryEntry[] {
  return terms.map(([ja, zh, en], i) => ({
    id: `${idPrefix}-${i + 1}`,
    ja,
    zh,
    en,
    category,
    source,
    sourceType,
    ...(contextOnly.includes(ja) ? { needsContext: true } : {})
  }));
}

const MC_GLOSSARY_ENTRIES = buildBuiltinEntries(
  'mc',
  'game',
  MC_TERMS,
  // 官方语言文件（zh_cn / ja_jp / en_us 同源，1.21.4）
  'https://cdn.jsdelivr.net/gh/InventivetalentDev/minecraft-assets@1.21.4/assets/minecraft/lang/zh_cn.json',
  'official',
  // 高频日常词但在 MC 语境下是专有译名，单句出现不注入
  ['修繕', '幸運', '再生能力']
);

const AI_GLOSSARY_ENTRIES = buildBuiltinEntries(
  'ai',
  'term',
  AI_TERMS,
  'https://ja.wikipedia.org/wiki/大規模言語モデル',
  'wiki',
  // 跨领域同形词：トークン（认证令牌）/ 推論（逻辑推理）/ エージェント（代理人）
  ['トークン', '推論', 'エージェント']
);


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
    description: `方块 44 · 物品 36 · 生物 54 · 机制 28 · 维度 3（共 ${MC_GLOSSARY_ENTRIES.length} 条 · 官方语言文件）`,
    builtIn: true,
    entries: MC_GLOSSARY_ENTRIES
  },
  {
    id: 'ai',
    name: 'AI 专用术语库',
    description: `机器学习 / 大模型 / 生成式 AI（共 ${AI_GLOSSARY_ENTRIES.length} 条）`,
    builtIn: true,
    entries: AI_GLOSSARY_ENTRIES
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

/** 解析场景提示词；未配置/占位的场景整体回退到 general（prompt 与 name 均取 general） */
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
