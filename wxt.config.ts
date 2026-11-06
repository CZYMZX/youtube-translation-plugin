import { defineConfig } from 'wxt';

export default defineConfig({
  manifest: {
    name: 'YouTube 自动字幕断句翻译器 (YT Subtitle Segmenter & Translator)',
    description: '针对 YouTube 自动语音识别字幕（ASR）提供智能停顿断句、语义标点重构、双语对齐展示与多源实时翻译（Google / DeepSeek / Gemini / OpenAI）。',
    version: '0.2.3',
    permissions: ['storage'],
    host_permissions: [
      '*://*.youtube.com/*',
      'https://translate.googleapis.com/*',
      'https://translate.google.com/*',
      'https://api.mymemory.translated.net/*',
      'https://api.openai.com/*',
      'https://api.deepseek.com/*',
      'https://generativelanguage.googleapis.com/*',
      'http://*/*',
      'https://*/*'
    ],
    action: {
      default_title: 'YouTube 字幕断句翻译设置'
    },
    icons: {
      16: 'icon-16.png',
      48: 'icon-48.png',
      128: 'icon-128.png'
    }
  }
});
