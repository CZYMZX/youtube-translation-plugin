/**
 * YouTube 字幕原始数据格式 (Timedtext JSON3)
 */
/* 仅类型引用（编译期擦除）：逐字时间结构的唯一真相在 utils/lyric-track.ts，这里不复制一份 */
import type { CharTiming } from '../utils/lyric-track';
/* 仅类型引用（编译期擦除）：字体条目的形状与清洗只在 utils/fonts.ts 定义一份 */
import type { CustomFontPack } from '../utils/fonts';

export interface YouTubeCaptionTrack {
  baseUrl: string;
  name: { simpleText?: string; runs?: Array<{ text: string }> };
  vssId: string;
  languageCode: string;
  kind?: string; // 'asr' 表示自动生成语音识别字幕
  isTranslatable?: boolean;
}

export interface YouTubePlayerResponse {
  captions?: {
    playerCaptionsTracklistRenderer?: {
      captionTracks?: YouTubeCaptionTrack[];
      translationLanguages?: Array<{
        languageCode: string;
        languageName: { simpleText: string };
      }>;
    };
  };
  videoDetails?: {
    videoId: string;
    title: string;
    author: string;
    lengthSeconds: string;
  };
}

export interface Json3Seg {
  utf8: string;
  tOffsetMs?: number;
  acAsrConf?: number;
  /**
   * 着色笔下标 → `Json3CaptionData.pens[pPenId]`（v0.5.0 实测补全）。
   *
   * 这是**颜色与逐字进度的唯一来源**：同一 event 内已唱前缀的每个字符各占一支笔，
   * 未唱后缀整段一支 `#FEFEFE` 笔；同一句随时间重复下发时已唱前缀逐帧变长。
   * 越界下标（样本里存在 `pPenId` 缺省或指向空笔的情况）必须按「无色」处理，不能抛错。
   */
  pPenId?: number;
}

/**
 * json3 顶层的「着色笔」表（v0.5.0 实测：231 支，第 0 支是空对象 `{}`）。
 *
 * 早期版本认为「json3 没有颜色字段」，那是错的 —— 颜色一直在 `fcForeColor` 里，
 * 只是以 24 位整数存放（`0xFEFEFE` → `#FEFEFE`）。字段全部可选：真实数据里
 * 第 0 支就是 `{}`，`fcForeColor: 0` 也出现过（= 无色），所以读的时候必须容错。
 */
export interface Json3Pen {
  /** 24 位前景色整数（0xRRGGBB）；0 / 缺省 = 无色 */
  fcForeColor?: number;
  /** 笔宽，样本恒为 100 */
  szPenSize?: number;
  /** 描边类型（3 / 4） */
  etEdgeType?: number;
  /** 描边色 */
  ecEdgeColor?: number;
  /** 前景不透明度，样本 254 */
  foForeAlpha?: number;
  /** 背景不透明度，样本 0 */
  boBackAlpha?: number;
  /** 振假名专用笔（1 / 2 / 4）：`反`=99 正文、`(`=100 括号、`はん`=101 假名 */
  rbRuby?: number;
}

/** json3 的窗口样式表（按 `wsWinStyleId` 下标寻址；本版只透传，不解析） */
export interface Json3WinStyle {
  juJustifCode?: number;
  pdPrintDir?: number;
  sdScrollDir?: number;
  wfoWinFillAlpha?: number;
}

/** json3 的窗口位置表（按 `wpWinPosId` 下标寻址；本版只透传，不解析） */
export interface Json3WinPosition {
  apPoint?: number;
  ahHorPos?: number;
  avVerPos?: number;
}

export interface Json3Event {
  tStartMs: number;
  dDurationMs: number;
  /** 旧字段名，json3 实际下发的是下面的 wpWinPosId / wsWinStyleId，保留兼容 */
  wWinId?: number;
  /** 窗口位置下标 → `wpWinPositions[wpWinPosId]` */
  wpWinPosId?: number;
  /** 窗口样式下标 → `wsWinStyles[wsWinStyleId]` */
  wsWinStyleId?: number;
  segs?: Json3Seg[];
  id?: number;
  /**
   * 滚动字幕（roll-up）的换行标记。值为 1 时该 event 只承载一个纯 "\n"，
   * **不是词**，也不带 tOffsetMs —— 逐词时间分支必须跳过它。
   * v0.5.0 阶段 B：普通 ASR 轨 XGxIE1hr0w4 共 65 个换行 event，其中 64 个带此标记。
   */
  aAppend?: number;
}

export interface Json3CaptionData {
  wireMagic?: string;
  /** 着色笔表：颜色与逐字进度的来源，见 Json3Seg.pPenId */
  pens?: Json3Pen[];
  wsWinStyles?: Json3WinStyle[];
  wpWinPositions?: Json3WinPosition[];
  events?: Json3Event[];
}

/**
 * 单词 Token 粒度
 */
export interface CaptionToken {
  text: string;
  start: number; // 毫秒
  end: number;   // 毫秒
  gapToNext: number; // 距离下一个词的毫秒停顿
}

/**
 * 歌词轨的一段「显示窗口」（v0.5.0 卡拉OK渲染用）
 * ----------------------------------------------------------------------------
 * 同一句歌词（副歌在 20s 与 200s 各出现一次）只翻译一次，但要在**多段时间**里
 * 重复显示，所以时间维度不能挂在句子上（一个句子只有一个 start/end），
 * 而是挂在窗口上；句子持有 `karaokeWindows` 数组。
 * 逐字时间 `charTimings` 由 `utils/lyric-track.ts#estimateCharTimings` 生成，
 * **一定是估算值**（该轨道 tOffsetMs 全 0，没有真实字级时间）。
 */
export interface KaraokeWindow {
  startMs: number;
  endMs: number;
  /** 这一窗口由多少个原始 karaoke 帧合并而来（仅调试用） */
  frameCount: number;
  /** 原文逐字时间；`char` 可能是整句（短句走整片分支），渲染须按 char.length 处理 */
  charTimings: CharTiming[];
  /**
   * true = 全片都是估算节奏；false = 至少有一片来自真实锚点（seg.tOffsetMs，
   * 或 `attachCharColors` 用着色帧推出的真实字级时间，看 `CharTiming.source`）。
   */
  estimated: boolean;
}

/**
 * 重构后的句子数据结构
 */
export interface SubtitleSentence {
  id: number;
  start: number; // 毫秒
  end: number;   // 毫秒
  text: string;  // 重构断句并修补标点后的完整原文
  rawTokens?: CaptionToken[];
  translation?: string; // 翻译后的译文
  status: 'idle' | 'translating' | 'done' | 'error';
  isAi?: boolean;       // 是否由大模型全篇 AI 深度精翻生成

  /* ── 以下为 v0.5.0 歌词轨（卡拉OK）可选字段：缺省 = 走 0.4.3 普通字幕路径 ── */
  /** 首段显示窗口的原文逐字时间（= karaokeWindows[0].charTimings，便于外部直读） */
  charTimings?: CharTiming[];
  /** 本行歌词的全部显示窗口（副歌重复出现时有多段），升序 */
  karaokeWindows?: KaraokeWindow[];
  /** 本句来自歌词轨识别（供日志、设置页提示与调试面板判断） */
  lyricTrack?: boolean;
  /**
   * v0.5.0 阶段 B：这句的逐字时间表来自**普通 ASR 词级时间**（每词 tOffsetMs），
   * 而非歌词轨的笔色/重复帧。供 `overlay.isKaraokeActive()` 按 `asrWordReveal`
   * 分流，与 `lyricKaraoke` 解耦。只加可选标记，不改任何默认值与既有类型。
   */
  asrTimed?: boolean;
  /**
   * v0.5.0 阶段 B：这句的时间表来自**官方词级时间戳**（ASR 轨的 seg.tOffsetMs）。
   *
   * true  → 同一个词的字符**共享同一个时间点**（词级），可应用**逐词高亮配色**
   *          （`settings.wordHighlightColor`），即「像 YouTube 那样按词逐步推进」；
   * false → 时间表来自帧前缀推断 / 均分兜底，没有官方词级数据，**不能**做逐词高亮。
   *
   * 数据来源：`utils/asr-timing.ts#buildAsrCharTimings` 返回的 `AsrTimingVerdict.wordLevel`
   * （= `source === 'offset'`）。由调用方（渲染层管线）写进本字段；
   * 缺省 = 旧路径（无逐词高亮）。
   */
  wordLevel?: boolean;
}

/**
 * 自定义模型条目（v0.4.2）
 * ----------------------------------------------------------------------------
 * 与「获取模型」拉到的在线列表分开存：后者是可随时刷新的缓存，这份是用户手写、
 * 要长期留存的条目。`icon` 只接受 utils/models.ts#isModelIconKey 的白名单（历史值
 * ∪ 厂牌图标 key），非法值在 sanitizeSettings 里回落 'generic'（不整份丢弃）。
 */
export type CustomModelService = 'deepseek' | 'openai' | 'gemini' | 'custom';

export interface CustomModelEntry {
  /** 真正发给服务商的 model id */
  id: string;
  /** 卡片上显示的短名 */
  label: string;
  /** 'custom' = 自建/中转端点，按 OpenAI 兼容协议请求 */
  service: CustomModelService;
  /** 图标 key；界面已不再让用户选图标，新条目写的就是所属厂牌的 iconKey */
  icon: string;
  /**
   * 条目挂在哪个厂牌下（任务四）。service 不够用：claude / qwen / kimi / zhipu
   * 的 service 都是 'openai'，只有 providerId 能说清「这条属于哪个厂牌的列表」。
   * 老条目没有这个字段 → 清洗时按 service 的主厂牌补上（见 utils/storage.ts）。
   */
  providerId?: string;
}

/**
 * 扩展配置参数
 */
export interface ExtensionSettings {
  enabled: boolean;
  targetLang: string; // 目标语言，如 'zh-CN', 'zh-TW', 'en', 'ja', 'ko', 'es' 等
  service: 'google' | 'gemini' | 'openai' | 'deepseek';
  /**
   * 当前生效的 API Key。
   * 任务四起**只写 `chrome.storage.local`**（键 `yt_sub_translator_secrets`），
   * 不进 `chrome.storage.sync` —— sync 会随浏览器账号上传云端，与「Key 仅保存在本地」冲突。
   * 读的时候由 `utils/storage.ts#getStoredSettings` 把 local 的密钥合并回来，调用方无感。
   */
  apiKey?: string;
  apiBaseUrl?: string; // 大模型自定义端点，如 https://api.deepseek.com/v1
  modelName?: string;  // 如 deepseek-chat, gpt-4o-mini, gemini-1.5-flash 等
  
  // 翻译场景与推理程度
  scenario: string; // 翻译场景 id：内置 general/vtuber/science/music/gaming，或用户上传场景包 id
  reasoningEffort: 'none' | 'low' | 'high'; // 模型推理深度：极速 vs 轻度推理 vs 深度推理思考

  // 断句参数
  pauseThreshold: number; // 停顿切分阈值，默认 450 (ms)
  maxWordsPerSentence: number; // 单句最大单词数（拉丁词语言），默认 16
  minWordsPerSentence: number; // 单句最小单词数，默认 3
  maxDurationMs: number; // 单句最大持续时间，默认 6500 (ms)
  autoPunctuation: boolean; // 是否智能补齐大小写和标点
  segmentationLanguage: 'auto' | 'ja' | 'zh' | 'en' | 'generic'; // 断句语言策略，默认 auto 自动检测
  maxCharsPerSentence: number; // CJK 单句最大字数（中日韩），默认 28
  mergeShortFragments: boolean; // 无终止标点的短碎片是否并入相邻句，默认 true
  
  // UI 样式与排版
  displayMode: 'bilingual' | 'translation_only' | 'original_only';
  layoutOrder: 'translation_top' | 'original_top'; // 默认推荐上译下原（沉浸式翻译标准体验）
  fontSize: number; // px，默认 20
  /**
   * v0.5.6：字幕字体。取值是**字体 id**：
   * - 内置字体 id（见 `utils/fonts.ts#BUILTIN_FONTS`，如 'yahei' / 'noto-jp'）；
   * - 自定义字体 id（`font-xxx`，从 `customFonts` 里查）；
   * - 'system'（默认）= 跟随 YouTube 自带字体（渲染层清掉内联 font-family）。
   *
   * 声明为可选：老版本存下来的设置里没有这一项，且弹窗保存的是部分字段的字面量；
   * 运行时一律经 sanitizeSettings 补齐为 DEFAULT_SETTINGS 里的 'system'。
   */
  fontFamily?: string;
  /**
   * v0.5.6：用户上传的字体包（含 base64 dataUrl）。
   * **只存 `chrome.storage.local`**（键 `yt_sub_translator_fonts`）：单个字体动辄几百 KB ~ 几 MB，
   * 远超 sync 的 100KB 总配额；sync 里连元数据都不放，只留 `fontFamily`。
   * 读取时由 `utils/storage.ts#getStoredSettings` 合并回来，调用方无感。
   */
  customFonts?: CustomFontPack[];
  bgOpacity: number; // 0 ~ 100，默认 75
  /**
   * v0.5.5：播放器内「快捷设置面板」高度（px，0 ~ 900）。
   * - `0` = 自适应：面板高度由内容决定（auto）；
   * - `> 0` = 固定高度：面板高度锁定该值，内容超出时**面板内**滚动。
   * 默认 429 = 折叠态真实内容高 417 + 12px 余量（Edge 156 / 1700×1080 实测），
   * 保证开箱折叠态底部两个按钮完整可见且不出现滚动条。
   */
  quickPanelHeight: number;
  bgColor: string; // 背景颜色十六进制值，默认 '#0f172a'
  origColor: string; // 原文字体颜色，默认 '#e2e8f0'
  transColor: string; // 译文字体颜色，默认 '#38bdf8'
  aiIconColor?: string; // AI 深度翻译右上角六角星标识颜色，默认 '#fbbf24'
  offsetY: number; // 垂直偏移百分比，默认 82% (靠近底部)
  autoHideNativeSubtitles: boolean; // 是否自动隐藏 YouTube 默认字幕避免重叠
  syncOffsetMs: number; // 字幕时间戳同步微调 (ms)，默认 0，范围 -2000 ~ +2000
  autoFallbackToGoogle?: boolean; // 大模型失败时是否自动平滑降级至 Google 免费翻译 (默认开启)

  /**
   * v0.4.2 降级顺序（providerId 数组，按用户设定优先级**从高到低**，上限 8 个）。
   *
   * - `[]`（默认）：**完全保持 v0.4.1 行为** —— 大模型失败直接降级 Google 免费翻译；
   * - 非空：按数组顺序逐级尝试（跳过当前正在用的厂牌、跳过未配 Key 的厂牌），
   *   每一级都用**该厂牌自己的 Key / 端点 / 模型**译同一批文本；
   *   全部失败后仍以 Google 免费兜底。
   *
   * 语义只在 `autoFallbackToGoogle !== false` 且 `noFallback !== true` 时生效：
   * 「自动降级」开关关掉 = 一律不降级（不管这里配了什么）。
   * 执行链见 utils/translator.ts（resolveFallbackCandidates / 逐级降级），
   * 清洗见 utils/storage.ts#sanitizeFallbackOrder（非法 id / 重复项丢弃，超 8 截断）。
   */
  fallbackOrder?: string[];
  glossaryEnabled?: boolean; // v0.2.8：翻译时注入 VTuber/hololive 术语库（默认开启）
  glossaryPacks?: string[]; // v0.2.9：启用的术语库包 id 列表（内置 + 上传）

  /**
   * v0.4.2 专名括注（参与缓存键：切换即让旧译文失效）
   * - 'off'（默认，保持旧行为）：专名只给一个中文译名，禁止括号原文 / 罗马字 / 英文；
   * - 'on'：专名写作「中文译名（日文原文）」，术语表命中与未命中的专名都带括号原文。
   */
  glossaryAnnotation?: 'off' | 'on';

  /**
   * v0.4.2 ASR 纠错授权（参与缓存键：切换即让旧译文失效）
   * - 'normal'（默认，保持旧行为）：可按上下文修正明显同音误转，不得改写事实；
   * - 'strict'：仅当上下文能确证时才改，不确定就保留原文。
   */
  asrCorrection?: 'strict' | 'normal';

  /** v0.4.2 用户自建模型（上限 20 条；超限/非法条目单独丢弃，不整份重置） */
  customModels?: CustomModelEntry[];

  /**
   * v0.4.2 按服务商分别记住的 Key
   * - 键只允许已知 service（google / gemini / openai / deepseek）；
   * - 切换服务商时取回该服务商上次用过的 Key，避免「换了服务商就 401」；
   * - 当前服务商那一格始终以 apiKey 为准（见 utils/storage.ts#sanitizeSettings）。
   *
   * @deprecated 任务四起由 providerKeys 接管（Key 跟着**厂牌**走，而不是粗粒度的 service）。
   *   sanitizeSettings 仍然**读**它做老数据迁移，但**不再写回**，也不再作为设置页的写入目标。
   */
  serviceKeys?: Record<string, string>;

  /**
   * 任务四 按服务商分别记住的 Base URL（与 serviceKeys 同一套规则）
   * - 只有一个 apiBaseUrl 时，从 DeepSeek 切到中转站会把旧端点带过去、请求直接 404；
   * - 键只允许已知 service；值 trim + 长度上限（见 utils/storage.ts#sanitizeBaseUrls）；
   * - 当前服务商那一格始终以 apiBaseUrl 为准：老用户升级后 apiBaseUrl 不被历史值覆盖。
   *
   * @deprecated 同 serviceKeys：仅作迁移输入，写入目标已换成 providerBaseUrls。
   */
  baseUrls?: Record<string, string>;

  /**
   * 任务四：当前使用的**厂牌** id（见 utils/models.ts#PROVIDERS，默认 'deepseek'）。
   * 单独存一份的理由：claude / qwen / kimi / zhipu 的 service 都是 'openai'，
   * 只有 providerId 能说清「现在用的是哪家的端点与 Key」。
   */
  providerId?: string;

  /**
   * 任务四：按厂牌分别保存的 Key（providerId → Key）。
   * - **只存本地**：与 `apiKey` 一起写在 `chrome.storage.local` 的
   *   `yt_sub_translator_secrets` 里，`chrome.storage.sync` 的那份设置里显式删除这三个字段
   *   （见 `utils/storage.ts#SECRET_FIELDS`）；代价是换设备不会带 Key，需要各填一次；
   * - 值 trim + 长度上限（与 apiKey 同一个 400 上限，见 utils/storage.ts#sanitizeProviderKeys）；
   * - 正在使用的厂牌那一格始终以 apiKey 为准，两边一起写（见 sanitizeSettings）。
   */
  providerKeys?: Record<string, string>;

  /**
   * 任务四：按厂牌分别保存的 Base URL（providerId → 端点覆盖值）。
   * 空对象 / 缺这个键 = 各家用 utils/models.ts 里声明的官方端点；
   * 值 trim + 300 字符上限，空串不占格。
   */
  providerBaseUrls?: Record<string, string>;

  /**
   * v0.4.2：**按厂牌记住上次选的模型**（providerId → model id）。
   *
   * 为什么需要单独一格：设置里只有一个 `modelName`（请求层只读它）。切走厂牌时
   * 旧厂牌的选择就没有地方记，切回来只能落到 `provider.models[0]`，于是出现
   * 「DeepSeek 选了 deepseek-v4-pro → 切 Claude → 切回 DeepSeek 变回 flash」。
   * 有了这一格，切回来时按 `providerModelSelections[pid]` 恢复。
   *
   * 取值口径：**不校验是否还在该厂牌的清单里** —— 用户手填的自定义 id、厂商已下架的
   * 型号都要能原样恢复（清单只是内部参考，见 docs/PROVIDER-MODELS.md §二）。
   * 键只接受已知厂牌 id，值 trim + 120 字符上限，空串不占格（见 utils/storage.ts）。
   */
  providerModelSelections?: Record<string, string>;

  /**
   * 需求 7：AI 深度精翻字幕的本地保留时长（小时）。
   * 只允许 24 / 168 / 720 / 0（0 = 永久）；其他值一律回落 720，
   * 不做「就近取整」——避免出现存储层自己发明一个用户没选过的档位。
   * 声明为可选：老版本存下来的设置里没有这一项，且弹窗保存的是部分字段的
   * 字面量（与 glossaryAnnotation / customModels 同一约定）；运行时真正取值
   * 一律经过 sanitizeSettings，缺省即等于 DEFAULT_SETTINGS 里那一份。
   */
  aiCacheTtlHours?: number;

  /**
   * 需求 7：视频重新打开时，检测到上次只翻了一半怎么办。
   * - 'manual'（默认）：只提示「已完成 N/M」，等用户点「AI 深度精翻」再续翻；
   * - 'auto'：直接续翻剩余句子。
   * 两种模式都**只翻缺失部分**，并带上文两句保持语境。
   */
  aiResumeMode?: 'auto' | 'manual';

  /**
   * v0.5.0 歌词轨卡拉OK逐字点亮（**默认 true = 自动适配，由检测结果驱动**）。
   *
   * v0.5.0 起不再是"用户手动开的功能"，而是**自动检测**：
   * 三个条件同时成立才走新路径 ——
   * ① `detectLyricTrack` 判定当前轨是歌词轨；
   * ② `detectKaraokeHighlight` 判定该轨**确实存在当前字高亮**（依据 pPenId 着色笔
   *    成对下发：同一 tStartMs 两条同文本 event、笔组不同、已唱部分随帧变长）；
   * ③ 本开关未被用户显式关掉。
   *
   * 任一不成立 → 渲染与翻译管线与 0.4.3 逐字节一致。
   * 也就是说：普通 VOD、无逐字高亮的 CC、以及关掉本项的用户，都不会看到新行为。
   *
   * 诚实边界（v0.5.0 数据层修正，**推翻早期结论**）：
   *   - 该轨 json3 的 `tOffsetMs` 全为 0，但**颜色与真实字级时间都在 `pens` 里**
   *     （`pens[i].fcForeColor` 24 位整数 → `#RRGGBB`；同一 event 内已唱前缀逐字各占
   *     一支笔，未唱后缀整段 `#FEFEFE`）。逐字真实时间由「某字第一次拿到非白颜色」
   *     的那一帧 `tStartMs` 得到，见 `utils/lyric-track.ts#extractLineColors`；
   *   - 没有笔色可读（普通 CC / 无 pens 的轨）时才回落到按字符权重估算
   *     （`estimateCharTimings`，`estimated` 恒为 true）；
   *   - 注意 `detectKaraokeHighlight` 用的是「同刻文本互补」判据，对**逐字笔色分层**
   *     这种形态会判 false —— 是否启用彩色字幕建议改用「笔色是否可读」判据
   *     （`extractLineColors` 的返回即判据来源，见其注释）。
   */
  lyricKaraoke?: boolean;

  /**
   * v0.5.0 阶段 B：普通 ASR 轨「逐词显现」独立开关（**默认 true = 开**）。
   *
   * 与 lyricKaraoke（歌词轨笔色逐字上色）是**两条独立机制**：
   *   - 歌词轨 A：重复帧 + 偏移全 0 + pens 笔色 → 逐字上色；
   *   - 普通 ASR 轨 B：一次给全片 + 每词 tOffsetMs + pens 为空 → 逐词显现，
   *     真实词时间由 utils/asr-timing.ts#buildAsrCharTimings 直接读出。
   *
   * 显式设为 false 时行为必须与旧版完全一致：不启用逐词显现、不挂逐字时间，
   * 渲染 / 翻译管线回退到 0.4.3 路径。可选字段，老配置里没有这一项时由
   * DEFAULT_SETTINGS 补齐，不触发用户设置迁移。
   */
  asrWordReveal?: boolean;

  /**
   * v0.5.0 阶段 B：**逐词高亮配色 —— 原文侧**（默认 `''` = 跟随）。
   *
   * 只对「这句的时间表来自官方词级时间戳」的 ASR 句生效
   * （`SubtitleSentence.wordLevel === true`）：同一个词的字符共享同一个时间点，
   * 词点亮时整词一起换成这个颜色 —— 即「像 YouTube 那样按词逐步推进」。
   *
   * 取值口径：十六进制颜色字符串（`#rrggbb`），与 `origColor` / `transColor` 同族。
   *
   * **空串 `''` = 跟随**用户自己在「字幕样式」里选的**原文色**（`settings.origColor`）：
   * 用户选了「白色原文」就亮白、选了「蓝色原文」就亮蓝 —— 只有用户**单独改过**
   * 这一项时才用这里的自定义值。旧版本存下来的默认 `#ffffff` 由设置页迁移成空串
   * （视为「用户没单独改过」），所以渲染层拿到的要么是空串、要么是用户自己挑的颜色。
   */
  wordHighlightColor?: string;

  /**
   * v0.5.0 阶段 B：**逐词高亮配色 —— 译文侧**（默认 `''` = 跟随）。
   *
   * 与 `wordHighlightColor` **完全对称**：空串 `''` = 跟随用户的**译文色**
   * （`settings.transColor`），否则是用户单独指定的十六进制颜色。
   * 原文侧与译文侧**各设各的**（CSS 变量 `--k-word-hi` / `--k-word-hi-trans`）。
   */
  wordHighlightTransColor?: string;
}

/** 续翻时随批发送的「上文参考」条目（只用于理解指代与语气，不产出译文） */
export interface AiContextSentence {
  text: string;
  translation: string;
}

/**
 * 默认配置
 */
export const DEFAULT_SETTINGS: ExtensionSettings = {
  enabled: true,
  targetLang: 'zh-CN',
  service: 'google',
  apiKey: '',
  apiBaseUrl: '',
  modelName: '',
  scenario: 'vtuber',
  reasoningEffort: 'low',
  pauseThreshold: 450,
  maxWordsPerSentence: 16,
  minWordsPerSentence: 3,
  maxDurationMs: 6500,
  autoPunctuation: true,
  segmentationLanguage: 'auto',
  maxCharsPerSentence: 28,
  mergeShortFragments: true,
  displayMode: 'bilingual',
  layoutOrder: 'translation_top', // 默认上译下原
  fontSize: 20,
  /* v0.5.6：字幕字体默认「系统默认」（= 不写 font-family，跟随 YouTube）；字体包只存 local */
  fontFamily: 'system',
  customFonts: [],
  bgOpacity: 75,
  /* v0.5.5：快捷面板固定高度 = 折叠态实测内容高 417 + 12px 余量（0 = 自适应） */
  quickPanelHeight: 429,
  bgColor: '#0f172a',
  origColor: '#e2e8f0',
  transColor: '#38bdf8',
  aiIconColor: '#fbbf24',
  offsetY: 82,
  autoHideNativeSubtitles: true,
  syncOffsetMs: 0,
  autoFallbackToGoogle: true,
  /* v0.4.2 降级顺序：空数组 = 现有行为（失败直接降级 Google 免费），老用户升级后行为不变 */
  fallbackOrder: [],
  glossaryEnabled: true,
  glossaryPacks: ['vtuber-hololive'],
  /* v0.4.2：两个新增选项的默认值 = 现有行为，老用户升级后译文格式不变 */
  glossaryAnnotation: 'off',
  asrCorrection: 'normal',
  /* v0.4.2：自定义模型与「按服务商记 Key」的默认值只在 types 里定义一份 */
  customModels: [],
  /* @deprecated 仅迁移用：新写入目标是下面两组 provider* 字段 */
  serviceKeys: {},
  /* 任务四：按服务商记的 Base URL，默认空对象（= 各家用官方端点） */
  baseUrls: {},
  /* 任务四：厂牌维度的默认值。providerId 默认 deepseek（service 仍默认 google 免费通道，
     用户没配大模型时界面停在上面的免 Key 区，展开的却是 DeepSeek 那一组） */
  providerId: 'deepseek',
  providerKeys: {},
  providerBaseUrls: {},
  /* v0.4.2：按厂牌记住上次选的模型（空 = 各家都还没选过，切过去用清单首个型号） */
  providerModelSelections: {},
  /* 需求 7：AI 精翻字幕默认保留 30 天、续翻默认手动（不擅自烧 token） */
  aiCacheTtlHours: 720,
  aiResumeMode: 'manual',
  /* v0.5.0：歌词轨卡拉OK改为**自动检测**（默认 true = 允许自动适配）。
     只有在「歌词轨 + 确有当前字高亮」同时成立时才会启用；关掉它即强制回到 0.4.3 行为。 */
  lyricKaraoke: true,
  /* v0.5.0 阶段 B：普通 ASR 轨逐词显现，独立开关，默认开。
     置 false 即完全回到旧版行为（不挂逐字时间），不影响上面的 lyricKaraoke。 */
  asrWordReveal: true,
  /* v0.5.0 阶段 B：逐词高亮配色 —— 原文侧 / 译文侧各一个，**空串 = 跟随**。
     空串时渲染层分别跟随 settings.origColor / settings.transColor ——
     用户在「字幕样式」里选了「蓝色译文 + 白色原文」，逐词就应当是
     「译文亮蓝、原文亮白」；只有用户**单独改过**这一项时才用自定义值。 */
  wordHighlightColor: '',
  wordHighlightTransColor: ''
};

export interface ModelOption {
  id: string;
  name?: string;
  description?: string;
  /** 定位短语（推荐 / 最省 / 最强），由 utils/models.ts#PROVIDERS 派生，界面直接展示 */
  note?: string;
}

/**
 * 消息通信协议
 */
export type ExtensionMessage =
  | { type: 'FETCH_CAPTIONS'; payload: { url: string } }
  | {
      type: 'FETCH_TRACKS_BY_VIDEO_ID';
      payload: {
        videoId: string;
        apiKey?: string;
        clientVersion?: string;
        visitorData?: string;
      };
    }
  | { type: 'FETCH_MODELS'; payload: { settings: ExtensionSettings } }
  | {
      type: 'TRANSLATE_BATCH';
      payload: {
        texts: string[];
        targetLang: string;
        settings: ExtensionSettings;
        noFallback?: boolean;
        bypassCache?: boolean;
        /**
         * 续翻语境：紧邻上文（原文 + 已有译文）。**只用于理解指代与语气**，
         * 不参与产出、不进缓存键、不计入输出条目数。
         */
        contextBefore?: AiContextSentence[];
      };
    }
  | { type: 'GET_SETTINGS' }
  | { type: 'SAVE_SETTINGS'; payload: Partial<ExtensionSettings> }
  | { type: 'CHECK_GOOGLE_TRANSLATE_CONNECTION' }
  | { type: 'SETTINGS_UPDATED'; settings: ExtensionSettings };
