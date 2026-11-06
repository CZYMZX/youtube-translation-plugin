import assert from 'node:assert';
import { sanitizeSettings } from '../utils/storage.ts';
import { DEFAULT_SETTINGS } from '../types/index.ts';

console.log('--- 测试: 设置项校验与清洗 ---');

const dirty = sanitizeSettings({
  service: 'evil',
  scenario: 'unknown',
  reasoningEffort: 'ultra',
  displayMode: 'weird',
  layoutOrder: 'x',
  fontSize: 999,
  bgOpacity: -20,
  offsetY: 500,
  pauseThreshold: 1,
  syncOffsetMs: 99999,
  bgColor: 'red',
  transColor: '#12',
  targetLang: '   ',
  apiKey: undefined
});

assert.strictEqual(dirty.service, 'google', '非法 service 应回退 google');
assert.strictEqual(dirty.scenario, 'general', '非法 scenario 应回退 general');
assert.strictEqual(dirty.reasoningEffort, 'low', '非法 reasoning 应回退 low');
assert.strictEqual(dirty.displayMode, 'bilingual', '非法 displayMode 应回退 bilingual');
assert.strictEqual(dirty.layoutOrder, 'translation_top', '非法 layoutOrder 应回退默认');
assert.strictEqual(dirty.fontSize, 48, 'fontSize 应被夹到上限 48');
assert.strictEqual(dirty.bgOpacity, 0, 'bgOpacity 应被夹到 0');
assert.strictEqual(dirty.offsetY, 94, 'offsetY 应被夹到 94');
assert.strictEqual(dirty.pauseThreshold, 120, 'pauseThreshold 应被夹到下限 120');
assert.strictEqual(dirty.syncOffsetMs, 2000, 'syncOffsetMs 应被夹到 2000');
assert.strictEqual(dirty.bgColor, DEFAULT_SETTINGS.bgColor, '非法背景色应回退默认');
assert.strictEqual(dirty.transColor, DEFAULT_SETTINGS.transColor, '非法译文色应回退默认');
assert.strictEqual(dirty.targetLang, DEFAULT_SETTINGS.targetLang, '空目标语言应回退默认');
assert.strictEqual(dirty.apiKey, '', 'undefined apiKey 应归一为空串');

const normal = sanitizeSettings({ fontSize: 22, bgColor: '#112233', enabled: false });
assert.strictEqual(normal.fontSize, 22);
assert.strictEqual(normal.bgColor, '#112233');
assert.strictEqual(normal.enabled, false);

console.log('✓ 非法枚举、越界数值、非法颜色、空语言均被正确清洗');
console.log('所有设置项校验测试通过！');
