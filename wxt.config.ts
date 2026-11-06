import { defineConfig } from 'wxt';

export default defineConfig({
  manifest: {
    name: 'YouTube 自动字幕断句翻译器 (YT Subtitle Segmenter & Translator)',
    description: '针对 YouTube 自动语音识别字幕（ASR）提供智能停顿断句、语义标点重构、双语对齐展示与多源实时翻译（Google / DeepSeek / Gemini / OpenAI）。',
    version: '0.4.0',
    permissions: ['storage'],
    // 说明：保留 https://*/* 是为了支持用户自定义 OpenAI 兼容端点；
    // 不再申请 http://*/*，避免扩展具备明文 HTTP 全域访问能力。
    host_permissions: [
      '*://*.youtube.com/*',
      'https://translate.googleapis.com/*',
      'https://translate.google.com/*',
      'https://api.mymemory.translated.net/*',
      'https://api.openai.com/*',
      'https://api.deepseek.com/*',
      'https://generativelanguage.googleapis.com/*',
      'https://*/*'
    ],
    action: {
      default_title: 'YouTube 字幕断句翻译设置'
    },
    // v0.4.0：高级设置页需要独立标签页（分栏布局在弹窗尺寸下无法成立）
    options_ui: {
      page: 'options.html',
      open_in_tab: true
    },
    icons: {
      16: 'icon-16.png',
      48: 'icon-48.png',
      128: 'icon-128.png'
    }
  }
});
