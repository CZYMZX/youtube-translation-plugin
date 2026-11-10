/**
 * 术语库 / 翻译场景「包」体系（v0.2.9）
 *
 * 设计：
 * - 内置包（builtIn=true）：VTuber 术语库（146 条）、MC 游戏术语库（165 条）、AI 术语库（35 条）；
 *   翻译场景：VTuber 直播、通用日常、科普视频、音乐视频、游戏实况（5 个均自带提示词）。
 * - 用户上传包：存 chrome.storage.local，结构由 validate*Packet 严格校验，不合格不入库。
 * - 上传规范见 docs/PACK-UPLOAD-SPEC.md（弹窗内也有摘要）。
 */
import type { GlossaryEntry, GlossaryCategory } from './glossary';
import { GLOSSARY, hashGlossaryContent, GLOSSARY_TAG_SCHEME, GLOSSARY_MATCHER_REVISION } from './glossary';

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

/* ───────────────────────── 内置翻译场景 ─────────────────────────
 * 场景包只管「这类视频该怎么译」：风格、行业用语、人称 / 敬语 / 方言 / 填充词。
 * 三类跨场景通用的约束**不在这里**，已上移到 utils/translator.ts 的公共层与选项层，
 * 否则用户上传的自定义场景包拿不到、场景包之间还会各写一份：
 *   - 禁用 AI 腔 / 不增补原文没有的信息 → translator.ts#COMMON_RULES（所有场景继承）
 *   - 专名是否括注原文 → translator.ts#buildAnnotationRule（设置项 glossaryAnnotation）
 *   - ASR 同音误转的纠错授权 → translator.ts#buildAsrRule（设置项 asrCorrection）
 */

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
8. 纯填充词（あの / その / えーっと）最多保留一个；情绪性感叹（えぇっ!?）保留。`;

const GENERAL_SCENE_PROMPT = `你是一位精通视频双语字幕翻译的资深专家。
当前翻译场景是【通用日常视频与访谈】，要求：
1. 语言地道自然，符合影视与日常口语化表达习惯，简练通顺。
2. 保持上下文连贯，准确处理前后句的代词指代与隐喻。
3. 按说话方式自适应分层（只依据本批句子自身的线索判断，不额外推测视频题材）：
   - 访谈 / 对谈：主持人与受访者交替发言、句末多为です・ます → 访谈类内容保留说话人的礼貌层级（です・ます 体对应适度礼貌的中文，不滥用“您”），问句译得像人开口说话，不像采访稿。
   - 讲解 / 科普 / 教程：句子偏长、术语与数字单位密集、感叹很少 → 书面化但可读，术语用通用译名，逻辑关系照原文，不自行加“因为”“所以”。
   - 日常闲聊 / vlog：句子短、常体（だ・よ・じゃん）、口癖与语气词多 → 口语化，可用语气词与短句，但不加原文没有的情绪与网络热词。
   同一批内保持同一层级，不逐句在书面语与口语之间来回跳。
4. 数字与单位本地化（3 日に 1 回 → “每三天一次”），专有名词统一用通用译名，具体书写格式按本 prompt 的专名条款执行。`;

const SCIENCE_SCENE_PROMPT = `你是一位专做科普视频中文引进的字幕译者，长年把日文科学解说与动画讲解译成中文，读者是想学点知识但没有专业背景的普通观众——高中生、上班族、被标题吸引点进来的路人。
当前翻译场景是【科普 / 讲解类视频】，请严格遵照以下准则：
1. 术语策略：概念与术语首次出现用国内教材、国标或科普出版物的通行中文译名，不生造直译、不音译；暂无公认中文名的沿用业界通用说法，不硬凑字面对应的假术语。中文读者本就按英文缩写称呼的（DNA、CPU、pH）直接沿用缩写，不硬译成生僻全称，也不在译文里另加解释。专名书写格式按本 prompt 的专名条款执行。
2. 语气：讲解体，重心是把事讲明白而不是抒情；句子完整、停顿自然。讲师面向镜头的提问与反问要译成真在问人的句子，不译成念稿腔。推测与确定的强度照原文：原文说「〜と考えられています」「可能性がある」就译成推测，不得升级成定论。
3. 数字与单位：数值、量级、比较关系必须与原文一致，不擅自四舍五入、不擅自换算单位；日文习惯说法按中文读法转（3 割 → 三成，2 倍 → 两倍，1 メートル → 一米）；原文的模糊限定（約 / ほど / 近く）要保留。原文口播念出的符号（Δ、log、x²）照念法译，不自行改写成公式或补出推导。
4. 条件不能丢：实验对象、样本量、方法与适用范围（「マウス実験では」）必须译出，不得压缩成「实验证明」「研究表明」这类被放大的结论——科普翻译最伤人的失真就在这里。
5. 格式：字幕是短句，一句一块，不合并成跨屏长句；译文内不换行，不加小标题、序号或「第一点」这类原文没有的结构词。
6. 边界：说话人说错又当场改口（「……いや、0.3 秒です」）时，两半都照原样保留，不得只留改正后的说法，也不得把改口当成听错抹掉。原文的比喻照译，不得另造比喻替代原意，也不得为通俗省掉关键限定。
7. 禁止：不得自己发明通俗化类比去替换术语（原文自己打了比方才译那个比方）；不得把一句完整讲解拆成几个互不衔接的碎片；不得为显得专业把日常说法改写成术语。`;

const MUSIC_SCENE_PROMPT = `你是一位歌词译者，专门把歌曲做成目标语言的歌词字幕；听众一边听原唱一边看字幕，译文要和旋律、气口、行位对得上。
当前翻译场景是【音乐视频 / MV / 歌词】，请严格遵照以下准则：
1. 行对行：一句原文对应一句译文，不合并、不拆行。副歌重复出现时每次都要写全，不写「同上」「（重复）」；同一句在全曲内用同一译法，不逐次换说法。
2. 长度与韵律对齐原歌词：译文长度尽量与原歌词相当——句尾尽量押韵，字数／词数贴近原句的音节数（一般允许上下浮动两字），整段篇幅与原文相当；逐行对应（按第 1 条的行位），不把两行并成一行，也不把一行拆成两行。节奏与韵律同样要对齐原语言：句子的长短、停顿与气口落在哪里、抑扬与重音怎么起伏、平仄怎么对应，都按原词的拍子走，让字幕跟得上原唱的旋律。为对齐长度与节奏可以调整语序与用词，但人称、时态、情绪、意象与叙述对象一个都不能挪。
3. 专名保留原文，其余一律译成目标语言：
   - 专名范围：人名与艺名、团体名与机构名、地名、歌曲名与专辑名、影视／动画／游戏／小说等作品名与专有系列名、品牌与产品名，以及其他以固定写法指认某一个具体对象的专有名称。这类专名保留原文写法，不音译、不意译，全曲写法统一。
   - 优先级：本批术语库已给出的条目以术语库的译名为准（用户显式指定的专名译法，优先于「保留原文」）；术语库未命中的专名才按上面的口径保留原文——保留原文的专名不再另配目标语言译名，也不附括号原文或罗马字。
   - 其余一切内容必须翻译成目标语言：歌词正文、口语与感叹、普通名词与动词，都不许留原文；拟声拟态词（きらきら、ふわふわ）按情绪译成目标语言里的动词或形容词，不硬译字面。不得因为「这是歌词」就整句、整段照抄原文——原样保留的只有专名本身与第 6 条的无意义音节。
4. 语气与文体：原文的敬体 / 常体、女性 / 男性口吻、古语、方言、口语缩略都要保留，不统一成一种腔调；抒情行不译成散文长句，不加解释性从句，不把几行拼成一段话。
5. 数字与具体名物：年份、数量、颜色、季节、物品照原文，不为凑字数改动；不为对仗把具体名物换成没有意义的近义词。
6. 边界：哼唱与无意义音节（ラララ、Yeah yeah、Oh oh）按音节保留（写「啦啦啦」「Yeah yeah」），不译成有意义的词、不删行、不与相邻行合并——它们占的是旋律位置。纯感叹（あぁ、Uh）用等值的目标语言叹词。
7. 禁止：不得为押韵编造原文没有的情节、情绪或对象（歌词翻译最常见的失真）；不得音译硬凑（把音节音译成似是而非的词）；不得把歌词改写成散文或说明文；不得加译者注、旁白、引号说明。`;

const GAMING_SCENE_PROMPT = `你是一位游戏实况与攻略解说的字幕译者，把日文游戏实况、速通与攻略讲解译成中文；观众既想学操作，也是来看热闹的玩家。
当前翻译场景是【游戏实况 / 攻略解说 / 速通】，请严格遵照以下准则：
1. 术语用圈内通行译法：技能名、装备名、道具名、职业名、版本名以官方中文版译名为准，没有官方中文的用玩家社区通行叫法；同一款游戏内全片一致，不自由发挥成同义词。中文圈本来就按英文缩写说的（CD、DPS、HP、RTA、Gank、Nerf）直接沿用，不硬译全称、不在译文里加解释。专名书写格式按本 prompt 的专名条款执行。
2. 操作口语要利落：短句、动词开头，跟着解说的语速走（打一套、先溜一波、贴脸换血、拉扯一下、踩点闪），主语能省就省；不把一口气的动作译成流水账，也不加书面语式的解释从句。
3. 数字与口径：伤害、血量、帧数、时间（3 分 20 秒、200 血、一帧之差）照原文，不换算、不估算；量词用圈内说法（一波、一发、一套、一轮），不写成「一次进攻机会」这种书面表达；倍率与百分比照原文。
4. 情绪强度保留：惊叫、爆粗、懊悔、狂吹都要保住强度，但不必逐字搬脏话，用等强度的中文口语（卧槽、牛啊、完了完了）；不放大、不美化成温吞说法，也不添加原文没有的脏话。
5. 多人同时说话：按「谁在说什么」分句处理，抢话、插话、喊叫各自成句，不合并成一段第三人称转述；听不清的部分保持原文的残缺状态，不补内容。
6. 边界：游戏内置专名（Boss 名、地名、道具名）用官方或圈内译名；玩家自己起的昵称、梗名按口语处理，不加引号解释。攻略里的顺序词（まず / 次に）译成「先…然后…」，但不擅自补出原文没有的步骤与结论。
7. 格式：字幕单行短句，译文内不换行，不加「解说：」这类原文没有的说话人标签，不加表情符号与音效标注。
8. 禁止：不得把实况译成说明书腔（「请执行以下操作」「接下来进行操作」）；不得把圈内术语泛化成模糊描述（RTA 译成「打游戏比赛」、バグ 译成「问题」）；不得把喊叫、笑场、失误当噪声删掉整句——那是实况本身的信息。`;

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
    description: '科普 / 讲解类：术语用通行译名、条件与数值照原文',
    builtIn: true,
    prompt: SCIENCE_SCENE_PROMPT,
    hint: '例：TED-Ed、科学解说'
  },
  {
    id: 'music',
    name: '音乐视频',
    description: 'MV / 歌词：行对行、押韵与字数优先于字面',
    builtIn: true,
    prompt: MUSIC_SCENE_PROMPT,
    hint: '例：MV 字幕、歌词翻译'
  },
  {
    id: 'gaming',
    name: '游戏实况',
    description: '非 VTuber 游戏实况：圈内术语、操作口语利落',
    builtIn: true,
    prompt: GAMING_SCENE_PROMPT,
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

/* ───────────────────── 术语库缓存指纹（v0.4.1） ─────────────────────
 * 旧做法：三包共用一个手工 bump 的 GLOSSARY_VERSION，自定义包只记 `id:条目数`。
 * 后果：「条数不变、只改译名」的修正（术语维护最常见的形态）不会让旧译文失效。
 * 现做法：每个包各自按**条目内容**生成指纹，聚合进同一个 tag；见 buildGlossaryTag()。
 */

/** 单个术语库包的内容指纹（纯内容 hash，不含包 id / 包名 / 描述） */
export function glossaryPackFingerprint(pack: GlossaryPack): string {
  return hashGlossaryContent(pack.entries);
}

/** 内置包内容指纹表：包 id → 内容 hash（模块加载时算一次） */
export const BUILTIN_GLOSSARY_FINGERPRINTS: Record<string, string> = Object.fromEntries(
  BUILTIN_GLOSSARY_PACKS.map((pack) => [pack.id, glossaryPackFingerprint(pack)])
);

/**
 * 术语库缓存标签（参与翻译缓存键，translator.getGlossaryTag 的唯一实现）
 *
 * 格式：`{scheme}.{matcherRev}|{启用包id(排序)}|{启用内置包 id:内容hash(包序)}|{启用自定义包 id:内容hash(排序)}`
 * - 内置包指纹：内容 hash（改译名不改条数 → 变）
 * - 自定义包指纹：`id:内容hash`（旧版是 `id:条目数`，改译名不改条数 → 不变 → 旧译文残留）
 * - 只统计**已启用**的包：禁用的包内容再变也不影响注入结果，不该烧缓存
 * - matcherRev：只改匹配/门控规则、数据没动时靠它失效，必须手工 bump
 */
export function buildGlossaryTag(enabledPackIds: string[] | undefined, custom: CustomPacks): string {
  const enabled = (enabledPackIds && enabledPackIds.length > 0 ? enabledPackIds : DEFAULT_GLOSSARY_PACKS)
    .slice()
    .sort();
  const enabledSet = new Set(enabled);
  const builtinFp = BUILTIN_GLOSSARY_PACKS.filter((pack) => enabledSet.has(pack.id))
    .map((pack) => `${pack.id}:${BUILTIN_GLOSSARY_FINGERPRINTS[pack.id]}`)
    .join(',');
  const customFp = (custom?.glossaries || [])
    .filter((pack) => pack && enabledSet.has(pack.id))
    .map((pack) => `${pack.id}:${glossaryPackFingerprint(pack)}`)
    .sort()
    .join(',');
  return `${GLOSSARY_TAG_SCHEME}.${GLOSSARY_MATCHER_REVISION}|${enabled.join(',')}|${builtinFp}|${customFp}`;
}

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
