# YouTube 自动字幕断句翻译器（yt-sub-translator）

Edge / Chrome 浏览器扩展（Manifest V3）。把 YouTube 自动生成字幕（ASR cue）重新组装成完整句子、补齐标点，再按句批量送翻，以双语浮层叠加在播放器上。

当前版本 **0.5.1**，技术栈 WXT 0.21 + TypeScript 5.8，运行时无第三方依赖。

---

## 解决什么问题

| YouTube 自动字幕的毛病 | 本项目的做法 |
| --- | --- |
| 每行 2~4 个词滚动，碎不成句 | 断句引擎：语言分策略 + 停顿/字数/时长约束 + 防劈词守卫 |
| 全小写、无标点 | 语义补标点：首字母大写、陈述补 `.`、疑问补 `?`，`…` 与 `——` 不追加 |
| 碎片直译语义断裂 | 先断句再按批翻译（批量 8 句、逐行 JSON 回填），保证语序与指代 |
| 专名同一场里三种译法 | 术语库三包 + 边界匹配 + 语境门控，只注入本批命中条目 |
| 重复播放反复消耗 Token | IndexedDB 按句缓存，同句二次播放直接命中 |

## 功能概览

- **断句引擎**：日语（句末助词/敬语/接续助词/方言）、中文（标点+停顿+硬上限）、英语（缩写保护+从句分级）、通用兜底；≥5s 极端停顿无条件切；行级 ASR 按「、」细分。
- **场景化翻译**：`vtuber` / `general` 场景包，支持上传自定义 JSON 场景包。
- **术语库**：VTuber 146 / Minecraft 165 / AI 35 三条内置包，单字边界、`needsContext` 逐句门控、长词优先。
- **字幕浮层**：字号自适应、控制栏与进度条避让、画中画双语、隐藏原生字幕、时间轴偏移。
- **高级设置页**：常规 / 服务与模型 / 术语库 / 断句引擎 / 字幕样式 / 同步与缓存 / 关于，共 7 个分区。

## 目录结构

```
entrypoints/
  background.ts              后台：取字幕、代理请求、消息路由
  content/                   内容脚本：浮层渲染与样式（overlay-styles.ts 为 VSR 红线所在）
  popup/                     弹窗：看视频时的快捷设置（完整配置版，4 个页签）
  options/                   独立设置页（8 分区）
  youtube-bridge.content.ts  主世界桥接：截获播放器字幕响应
utils/
  segmenter.ts               断句核心
  translator.ts              提示词装配、批量请求、缓存键
  packs.ts                   场景包 / 术语包数据与校验
  glossary.ts                术语匹配与注入块
  caption-parser.ts          ASR 响应解析
  db-cache.ts                IndexedDB 句级缓存
  translation-queue.ts       翻译队列
  storage.ts                 设置读写与清洗
  ephemeral-subtitle-store.ts 临时字幕落盘（防抖）
  control-bar-button.ts      控制栏按钮注入
  icons.ts                   图标资源
types/                       共享类型
test/                        13 个测试文件（tsx 直跑，无测试框架）
docs/                        设计记录与专项说明
public/                      图标与 SVG
scripts/                     图标应用、对话导出等辅助脚本
```

## 快速开始

要求 Node.js ≥ 18。

```bash
npm install

# 开发（自动打开受控浏览器并加载扩展）
npm run dev:edge
npm run dev:chrome

# 构建，产物在 .output/{edge-mv3,chrome-mv3}
npm run build:edge
npm run build:chrome

# 类型检查
npm run compile

# 测试（13 个文件顺序执行，看退出码）
npm test; echo $?
```

安装已构建的扩展：浏览器打开 `edge://extensions` 或 `chrome://extensions`，开启开发者模式，选择「加载解压缩的扩展」，指向 `.output/edge-mv3`（或 `chrome-mv3`）。

## 配置

扩展的「高级设置 → 服务与模型」里填 OpenAI 兼容端点、API Key 与模型名。仓库默认值指向作者本机测试端点（`127.0.0.1:8045/v1`），使用前请替换为自己的服务；本仓库不含任何密钥，`npm test` 也不需要网络。

## 质量红线

1. **VSR 兼容**：视频浮层禁用 `backdrop-filter` / `filter`（含 `-webkit-` 前缀）。`test/test-vsr-styles.js` 断言的是样式声明数，出现即失败；文件头注释里提到该词属说明文字，不计入。
2. **令牌一致性**：弹窗与设置页的 `:root` 逐项比对颜色、时长、缓动、圆角，防止改一边忘另一边。
3. **测试判定看退出码**，不要 `grep` 日志。13 个测试文件都做了断言收口（`check()` 计数 + 末尾 `assert` 抛错，或 `assert` 直接抛），任何一条断言失败都会让 `npm test` 返回非零码。`v0.4.1` 起 `test-segmenter.js` 与 `test-scenario.js` 已从 `console.assert` 迁到抛错断言 —— `console.assert` 在 Node 里失败只打印一行、不改变退出码，「全绿」可能是假的，这个坑现在已经补上，不再有例外文件。
4. **断言口径**：当前 `npm test` 的打印项是 **1396**（options-ui 554 · packs 114 · retry 110 · ai-track 104 · lyric-track 119 · scenario 94 · segmenter-lang 85 · glossary 68 · prompt-layers 67 · popup-ui 58 · segmenter 6），全部是 `check()` / `t()` 断言计数；`test-parser / test-settings / test-vsr-styles` 另有 89 条不打印的断言（14 / 62 / 13），合计约 **1485** 条。对外引用写「1396 打印项 / 约 1485 断言」，不要再说「1260 / 约 1341」或更旧的「1166 / 约 1235」「1137 / 约 1201」「1202 / 约 1266」「1122 / 约 1186」。（对照：`0.4.0` 发布当次实测 201；`0.4.1` 起 `retry 59`、`options-ui` 一路从 40 增到 494、`packs` 82 → 114、`popup-ui` 49 → 114；`0.4.2` 回退轮把弹窗从「遥控器」方案退回 v0.4.1 完整配置版，`popup-ui` 114 → 32（v0.4.1 基线 28 项 + 4 条回退锁定断言）；随后按「选项同步」把 8 通道、按厂牌 Key 与模型清单同步进弹窗，`popup-ui` 32 → 46、`options-ui` 493 → 494；最后修 4 个界面问题（切厂牌模型被重置 / 预置型号混进下拉 / 弹窗长列表铺满 / 设置页展开瞬跳），`popup-ui` 46 → 58、`options-ui` 494 → 511、`test-settings.js` 45 → 50，总打印项 1137 → 1166、断言约 1201 → 约 1235；`0.4.3` 把「降级顺序 / 逐级降级」的执行链与界面承载并入本版，`retry` 59 → 110（+51，降级链 12 组用例）、`options-ui` 511 → 554（+43，降级顺序列表与拖拽）、`test-settings.js` 50 → 62（+12，`fallbackOrder` 清洗与落盘），总打印项 1166 → 1260、断言约 1235 → 约 1341；降级顺序之后追加「歌词轨适配」的识别与渲染层，新增 `test-lyric-track.js` 119 条、`test-vsr-styles.js` 5 → 13（+8，卡拉OK三态与过渡），总打印项 1260 → 1379、断言约 1341 → 约 1468（v0.5.0 高亮自动检测与 ruby 剥离再 +17 → 1396 / 约 1485）。日志里另有若干信息性 `✓`（各套件末尾的「…测试通过」提示、`test-segmenter.js` 的用例输出）不计入打印项。工作区有并行改动时，数字以当次 `npm test` 实测为准。）

## 文档索引

| 文档 | 内容 |
| --- | --- |
| `docs/SEGMENTER-0.2.6.md` | 第一轮：语言分策略、硬约束前置、标点伪影、噪声过滤 |
| `docs/SEGMENTER-0.2.7.md` | 第二轮：译文语序、防劈词守卫、悬空助词、行级 ASR |
| `docs/GLOSSARY-0.2.8.md` | 术语库建立（146 条）与注入策略 |
| `docs/GLOSSARY-0.2.9-accum-A-内置术语库.md` | 三包化与上传规范 |
| `docs/GLOSSARY-0.2.9-accum-B-官方核对.md` | MC 术语按官方语言文件重建、AI 术语核对 |
| `docs/PACK-UPLOAD-SPEC.md` | 术语包 / 场景包上传字段与校验规则 |
| `docs/UI.md` | 弹窗动效与视觉规范（时长、缓动、弹簧、无障碍） |
| `docs/OPTIONS-0.4.0.md` | 独立设置页的信息架构与实现取舍 |
| `docs/VSR-FIX-0.2.5.md` | RTX VSR 失效根因与实测数据 |
| `docs/VSR-STATUS-SNAPSHOT.md` | VSR 红线现状快照 |
| `docs/REVIEW-FIXES-0.2.4.md` | 全量代码审查修复清单 |
| `docs/CHANGES-0.2.3-FOR-ANTIGRAVITY.md` | 早期交接说明 |
| `docs/immersive-translate-analysis.md` | 竞品（沉浸式翻译）分析 |
| `docs/断句金标集标注任务包.xlsx` | 人工标注任务包（220/150/150 行，尚未标注） |
| `docs/LIVE-AND-ASR-0.5.0.md` | 两项新能力设计：无字幕 ASR 回退 + 直播实时翻译（含分阶段计划，尚未实现） |
| `docs/conversations/CONVERSATION_HISTORY.md` | 开发过程对话整理（原始转写未入库） |
| `CHANGELOG.md` | 版本变更记录 |

## 版本说明

本项目版本号已整体去 1：`1.x.y → 0.x.y`。看到旧文档里写 `v1.2.9`、`v1.3.0` 等，对应关系为 `v0.2.9`、`v0.3.0`；Minecraft 的 `1.21.4` 等外部版本号不在此列。

## 已知限制

- 仅在 Edge 156 + Windows + RTX 3060 Laptop 上实测，Chrome / Firefox 未逐版本验证。
- 断句金标集尚未标注，因此没有绝对的 P/R/F1 基线，只有版本间的相对对比。
- 英文轨断句指标没有历史基线，表现可能弱于中文轨。
- 译文质量取决于所接模型与提示词，术语库只做词表约束，不保证 100% 遵守。
- 韩语未做语法级专项，走通用词计策略。

## 许可

MIT（见 `package.json`）。
