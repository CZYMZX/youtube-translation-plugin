/**
 * YouTube 字幕原始数据格式 (Timedtext JSON3)
 */
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
}

export interface Json3Event {
  tStartMs: number;
  dDurationMs: number;
  wWinId?: number;
  segs?: Json3Seg[];
  id?: number;
}

export interface Json3CaptionData {
  wireMagic?: string;
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
  bgOpacity: number; // 0 ~ 100，默认 75
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
  bgOpacity: 75,
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
  aiResumeMode: 'manual'
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
