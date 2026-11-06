import { DEFAULT_SETTINGS } from '../types/index.ts';

console.log('--- 测试: 场景与模型推理程度配置 ---');

// 检查默认配置项
console.assert(DEFAULT_SETTINGS.scenario === 'vtuber', '默认场景应该是 vtuber');
console.assert(DEFAULT_SETTINGS.reasoningEffort === 'low', '默认推理程度应该是 low');

console.log('✓ 默认配置项校验通过:');
console.log(`- 翻译场景: ${DEFAULT_SETTINGS.scenario}`);
console.log(`- 推理程度: ${DEFAULT_SETTINGS.reasoningEffort}`);

console.log('\n所有测试项验证通过！');
