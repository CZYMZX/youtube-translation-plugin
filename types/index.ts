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
 * 扩展配置参数
 */
export interface ExtensionSettings {
  enabled: boolean;
  targetLang: string; // 目标语言，如 'zh-CN', 'zh-TW', 'en', 'ja', 'ko', 'es' 等
  service: 'google' | 'gemini' | 'openai' | 'deepseek';
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
  glossaryEnabled: true,
  glossaryPacks: ['vtuber-hololive'],
  /* v0.4.2：两个新增选项的默认值 = 现有行为，老用户升级后译文格式不变 */
  glossaryAnnotation: 'off',
  asrCorrection: 'normal'
};

export interface ModelOption {
  id: string;
  name?: string;
  description?: string;
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
      };
    }
  | { type: 'GET_SETTINGS' }
  | { type: 'SAVE_SETTINGS'; payload: Partial<ExtensionSettings> }
  | { type: 'CHECK_GOOGLE_TRANSLATE_CONNECTION' }
  | { type: 'SETTINGS_UPDATED'; settings: ExtensionSettings };
