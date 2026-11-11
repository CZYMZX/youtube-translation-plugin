import { defineConfig } from 'wxt';

export default defineConfig({
  manifest: {
    name: 'YouTube 自动字幕断句翻译器 (YT Subtitle Segmenter & Translator)',
    description: '针对 YouTube 自动语音识别字幕（ASR）提供智能停顿断句、语义标点重构、双语对齐展示与多源实时翻译（Google / DeepSeek / Gemini / OpenAI）。',
    version: '0.6.0',
    // unlimitedStorage：用户上传的字幕字体（单个可达 5MB）存 chrome.storage.local，
    // 不加这条会被 ~10MB 的默认配额挡住，写入直接抛 QUOTA_BYTES 错误。
    permissions: ['storage', 'unlimitedStorage'],
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
    // 双气泡「无限符号」品牌图标（黑色版：扩展管理页是浅底，黑图才看得见）。
    // 加 32：Edge/Chrome 在 125%/150% 缩放下会取 32px 档，缺档会回退到 48 再缩，边缘发虚。
    icons: {
      16: 'icon-16.png',
      32: 'icon-32.png',
      48: 'icon-48.png',
      128: 'icon-128.png'
    }
  }
});
