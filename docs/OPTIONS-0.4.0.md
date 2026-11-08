# 高级设置页（v0.4.0）

> 目标：把「设置项增多后弹窗放不下」的问题从**加滚动条**改成**换承载面**——
> 弹窗只留高频开关，复杂配置迁到独立标签页。
> 结构参照 `chrome-extension://…/options.html#general` 这类分栏设置页（沉浸式翻译）：
> 顶栏固定 + 左侧 250px 分区导航 + 右侧「标题 + 行式设置项」。

---

## 一、信息架构

八个分区（v0.4.0 首版为 7 个，任务四新增「翻译场景」，见 §九），按「用户改这一项的动机」切，而不是按代码模块切：

| 分区 | 回答的问题 | 承载内容 |
|---|---|---|
| **常规** | 要不要用、翻成什么语言 | 总开关、目标语言、翻译服务、翻译场景卡、推理深度 |
| **服务与模型** | 用哪个模型、Key 对不对 | 厂牌一级 / 模型二级、Key 与端点、失败降级、**ASR 纠错授权**、厂牌面板内「测试连通性」（见 §十四） |
| **翻译场景** | 这套 prompt 到底长什么样、能改哪一层 | 场景列表（内置 + 自定义）+ 提示词分层卡片 + 场景人设编辑（另一条「查看 / 使用」分离的通路） |
| **术语库** | 专有名词怎么翻 | **专有名词括注原文** + 包列表（内置 146/165/35）+ 条目表格 + 搜索/筛选 + 增删改 + 导入导出 + 另存副本 |
| **断句引擎** | 一句话从哪断 | 语言策略、停顿阈值、字数上限、时长上限、词数上限、标点修补、碎片合并 |
| **字幕样式** | 浮层长什么样 | 实时预览 + 显示方式、上下顺序、字号、背景透明度、垂直位置、三种配色 |
| **同步与缓存** | 对不上、占空间 | 时间轴偏移、隐藏原生字幕、清空缓存、恢复默认 |
| **关于** | 这是什么、数据去哪了 | 版本、链路、隐私说明、快捷键 |

### 为什么这样切

- **前两区是「能不能用」**，中间三区是「用得爽不爽」，后两区是「出问题怎么办」——
  用户从上面下找，符合设置页的自然阅读顺序。
- **术语库单独成区**，因为它不是"一个开关"，而是一个**编辑器**（列表 + 表格 + 工具栏），
  塞进任何一栏都会把那一栏撑变形。
- **字幕样式带预览**：颜色和字号这类参数，看数值不如看效果，所以预览固定在该区顶部，改哪项都立刻反映。

---

## 二、布局与视觉

```
┌──────────────────────────────────────────────────────────────┐
│ 顶栏 58px：品牌 + 版本          恢复默认   ● 已保存           │
├───────────────┬──────────────────────────────────────────────┤
│ 导航 250px    │ 内容区 max 860px                             │
│ ─────────     │  分区标题（21px）+ 说明（12px）               │
│ ▌常规         │  ─────────────────────────────────           │
│  服务与模型   │  行标题 13px        控件（右对齐）            │
│  术语库       │  行说明 11.5px 灰                             │
│  …            │  ─────────────────────────────────           │
└───────────────┴──────────────────────────────────────────────┘
```

- **左侧 250px 固定 + 右侧自适应**：与参考页一致；导航用 `position: sticky` 独立滚动。
- **行式设置项**：左「标题 + 说明」、右「控件」，1px 分隔线，行高 14px 上下留白。
  这是设置页最省认知的排列——扫一眼左列就知道有哪些项。
- **令牌与弹窗同源**：颜色、字号、圆角、时长、缓动全部沿用弹窗的 `:root`，
  并由 `test/test-options-ui.js` **逐项比对两边取值**，防止日后改一边忘另一边。
- **配色克制**：中性铬层 + 白为唯一交互色，彩色只用于语义状态（成功/警告/错误）。
  没有紫罗兰渐变、没有装饰性光斑。

---

## 三、交互动效

| 位置 | 动效 | 为什么 |
|---|---|---|
| 左侧分区切换 | 2px 标记条 `translateY` 滑动，300ms 弹簧（`--spring-soft`） | 让"当前在哪一栏"有连续感，而不是瞬间跳 |
| 分区内容入场 | 容器 300ms 位移淡入 + 各行 160ms 错峰 30ms | 建立从上到下的阅读顺序 |
| 术语库表格 | 每行 18ms 错峰入场（上限 12 行，避免长表拖沓） | 过滤后结果"落位"的感觉 |
| 分段控件 | 滑块 300ms 弹簧移动 | 与弹窗同一套手感 |
| 开关 | 滑块 160ms 弹簧；按下 `scaleX` | 不触发重排 |
| 滑块拇指 | hover 1.08 / active 1.18 弹性缩放 | 微小但明确的可操作反馈 |
| 保存状态 | 「保存中」→「已保存」，黄点脉冲 → 绿点 | 明确告诉用户改动已落盘 |
| 提示条 | 底部弹入，`spring-snappy`，2.4s 自动收起 | 不打断操作 |
| 降级 | `prefers-reduced-motion` 全量归零 | 尊重系统设置，且不会停在动画起始帧 |

---

## 四、与现有弹窗的整合

### 4.1 职责划分

| | 弹窗（380px） | 高级设置（新标签页） |
|---|---|---|
| 定位 | 看视频时的**快捷遥控器** | 配置时的**工作台** |
| 保留 | 总开关、目标语言、服务、场景、推理深度、几个高频滑块 | 全部设置 + 术语库编辑器 + 颜色/位置 + 缓存处理 |
| 移除 | —— | 无（弹窗不删功能，只是不再承载复杂编辑） |

### 4.2 数据只有一份

- 两边都读写 `yt_sub_translator_settings`（`utils/storage.ts`），术语库都读写
  `yt_sub_custom_glossary_packs`（`utils/packs.ts`），**没有各自的副本**；
- 高级设置页监听 `chrome.storage.onChanged`：弹窗里改了开关，这边立刻反映，反之亦然；
- 缓存清理直接删 IndexedDB（`clearSentenceCache()`），与内容脚本共用同一个库。
- **（任务四补）Key 例外**：`apiKey` / `providerKeys` / 老 `serviceKeys` 只写
  `chrome.storage.local` 的 `yt_sub_translator_secrets`，其余设置仍写 sync。
  `getStoredSettings()` 返回「sync 设置 + local 密钥」的合并结果，所以上面对调用方的
  「只有一份」依然成立——它只是被拆成了两个物理位置，见 §11.3。

### 4.3 入口

- 弹窗底部新增 **「⚙ 高级设置」** 按钮 → `chrome.runtime.openOptionsPage()`；
- `manifest.options_ui = { page: options.html, open_in_tab: true }`，
  这样在扩展管理页点「扩展选项」也会在**新标签页**打开（而不是 380px 的小窗）。

### 4.4 两个新选项的界面承载（v0.4.2）

存储与提示词装配已由任务二完成（`types/index.ts` 默认值 + `utils/storage.ts#sanitizeSettings`
兜底 + `utils/translator.ts#buildAnnotationRule/buildAsrRule`），本轮只补界面：

| 字段 | 取值 | 默认 | 落位 | 控件 |
|---|---|---|---|---|
| `glossaryAnnotation` | `off` / `on` | `off` | 术语库分区顶部（包列表上方） | 分段：关闭 / 开启 |
| `asrCorrection` | `normal` / `strict` | `normal` | 服务与模型分区（失败降级之后、连通性测试之前） | 分段：常规 / 严格 |

- **为什么用分段而不是开关**：两项都不是「开/关」而是「两档语义」，
  开关会强迫用户把 `strict` 理解成「严格模式=开」，而 `off` 那档又不叫「关」。
  分段控件能直接写出两档的名字，也顺带复用弹窗同源的 `.seg` 滑块手感。
- **为什么括注放术语库而不是「常规」**：它是术语的呈现格式（译名后面要不要带原文），
  用户找它时一定在看译名；放在包列表上方，改完往下就能在表格里核对译名。
  ASR 纠错属于翻译质量，贴着「失败自动降级」放，符合「模型相关行为」的聚类。
- **不复用开关的原因（视觉）**：术语库分区里没有包级开关，但「内置/自定义 · 只读」
  与包选中态已经占用了高亮色；分段控件只在行右侧占 132px，与 `失败自动降级` 的开关
  右缘对齐（实测两者右边界同为 1074px），不会与包列表的选中块混淆。
- **绑定与同步**：两个控件就是普通的 `data-setting` + `data-value`，
  走 `bindControls()` / `reflectSettings()` 这条通用通路，**没有控件专属代码**：
  - 点选 → `update({ [key]: value })` → `saveStoredSettings()` → `chrome.storage.sync`；
  - 弹窗或另一标签页改同一个键 → `storage.onChanged` → `getStoredSettings()` →
    `reflectSettings()`，选中态与滑块一起回位；
  - 非法值不进 UI：`sanitizeSettings` 已把未知取值回落默认，页面拿到的永远是合法枚举。
- **默认值仍只有一份**：页面不做任何 `?? 'off'` 之类的兜底，全部来自 `DEFAULT_SETTINGS`。
- **文案**：
  - 「专有名词括注原文」+ 说明「开启后专名显示为 `中文译名（日文原文）`，关闭只显示中文译名」
    + 辅注「切换后已有字幕会按新格式重译一次」；
  - 「ASR 纠错授权」+ 说明「常规：按上下文修正明显的同音误转；严格：仅在上下文能确证时纠正，
    不确定保留原文」+ 辅注「两种模式的 token 消耗几乎无差别」。
- **新增样式只有三处，且不含新令牌**：`.row-note`（辅注，用既有 `--text-dim`）、
  `.seg-compact`（二元分段固定 132px，避免 `.seg` 的 `width:100%` 在收缩型
  `.row-control` 里算不出稳定宽度）、`.gloss-option-row`（选项行与工作区之间的 1px 分隔）。

---

## 五、验证

| 项 | 结果 |
|---|---|
| `tsc --noEmit` | 0 error |
| `npm test` | EXIT=0，11 个套件全绿（packs 82 · glossary 68 · segmenter-lang 85 · popup-ui 28 · **options-ui 69**；segmenter / parser / settings / vsr-styles / scenario / retry 走 assert 收口，均退出 0） |
| 分区 | 7 个，`role=tablist` + 7 个 `tabpanel`，每个面板的 `aria-labelledby` 都指向真实存在的 `#nav-*`，方向键 / Home / End 可切换 |
| 术语库 | 首包 146 行；搜索「そら」→ 1/146；只读横幅正确显示；「另存副本」后可编辑 |
| 操作列 | 「编辑」「删除」均完整渲染（实测各 37px，修复前编辑被裁掉） |
| 实时预览 | 字号 20px → 32px 立即生效，且 `fontSize=32` 已落盘 |
| 预览定位 | offsetY=82% 时字幕底边落在 155/190px（期望 156） |
| 两个新控件（puppeteer 渲染验证） | 39 项断言全过：括注在术语库分区、ASR 在服务与模型分区；默认 `off` / `normal` 高亮且滑块 index=0；点选后立即高亮并落盘 `on` / `strict`；外部 `onChanged` 改回 `off` / `normal` 后控件与滑块一起回位；注入 `maybe` / `lenient` 回落默认；两项都在同一份 `yt_sub_translator_settings` 里（local 无副本） |
| 二元分段几何 | 宽 132px；右缘 1074px，与「失败自动降级」开关右缘一致；窄屏 800px 仍为 132px 且无横向溢出 |
| 横向溢出 | 0（1440 / 800 两档） |
| 控制台 | 无 pageerror |
| 键盘 | Tab 到分段按钮按 Space 可切换，`.active` 与 `aria-pressed` 同步 |
| 构建 | chrome / edge 均 0.4.0，`options_ui.open_in_tab=true`；内容脚本 `backdrop-filter` 仍为 0（VSR 红线） |

### 修掉的实现缺陷（累计）

1. **分段滑块停在末位**：`reflectSettings` 给每个按钮都写了 `--seg-index`，最后一个覆盖全部 →
   改为只在选中项上写索引。
2. **术语库操作列裁掉「编辑」**：`col-ops: 10%` 放不下两个按钮 → 调整为 21%，并压缩前几列。
3. **预览参数滞后一次输入**：`applyPreview()` 在 `settings` 合并之前调用，滑块/取色器要连动两次才反映到预览。
   改为在 `update()` 内合并后统一重画，删掉 `silentPreview` 旁路。（2026-11 复核修复）
4. **预览背景色恒为默认色**：`hexToRgba` 的第三个捕获组误写成 `[a-fd]`（漏 `\d`），
   凡蓝通道含数字（`#0f172a`、`#123456` …）即失配 → 静默回退 `rgba(15, 23, 42, α)`，肉眼看不出来。
   已改正则。（2026-11 复核修复）
5. **7 个 `aria-labelledby="nav-*"` 悬空**：导航按钮没有 `id`，读屏软件拿不到分区名。已补 `id` 与 `aria-controls`。
6. **「恢复默认」名不副实**：`resetSettings` 手写了一份残缺默认值，漏掉 `segmentationLanguage`、三种配色、
   API 配置。改为直接展开 `types/index.ts` 的 `DEFAULT_SETTINGS`，不再维护第二份默认值副本。
7. **未定义令牌**：`.save-chip[data-state="saving"] i` 引用 `var(--ease-in-out)`（两页 `:root` 都没有），
   实际回落到默认 `ease`。改用已在字典里的 `--ease-standard`。
8. **关于页宣称不存在的能力**：写着「`Alt` + `T` 快速开关浮层」，但 `wxt.config.ts` 没有 `commands` 注册、
   内容脚本也没有对应 keydown。改为如实描述「点工具栏图标打开快捷面板」。
9. **目标语言缺项**：弹窗给 9 种语言，设置页只有 7 种（缺 fr / de）。已补齐。
10. **防抖窗口内的改动只剩最后一项**（v0.4.2 补测时发现）：`update()` 只用一个 `saveTimer`，
    连续改两项（例如先切「括注」再切「ASR 纠错」）时前一次的 `patch` 被 `clearTimeout` 连带丢掉，
    表现为「界面上两项都变了，重开设置页只剩后改的那项」。改为 `pendingPatch` 累积后再写。
11. **分段控件选中态要等存储回声**：`bindControls` 的按钮分支只调 `update()`，而 `.active` 与
    `--seg-index` 只在 `reflectSettings()` 里写，只有 `service/scenario` 两处会局部重绘——
    其余分段项（含本轮新增两项）要等 `storage.onChanged` 回声（≥320ms 防抖 + 存储往返）才动。
    改为点选后立即 `reflectSettings()`，同时补 `aria-pressed` 让读屏也知道哪档被选中。

---

## 六、取舍与已知限制

- **未做**「按站点/频道分别配置」：需要额外的作用域模型，本轮不引入。
- **术语库表格不分页**：165 条可接受；上千条时依赖搜索，后续可加虚拟滚动。
- **场景包编辑**：v0.4.0 只有上传 JSON；任务四已补「翻译场景」分区的在线编辑（见 §9.1），
  但只能改「场景人设」一层，其余层仍按设置项自动生成。
- **测试连接不再是分区级 `/models` 列表测速**：需求 7 已改为每个厂牌面板里的「测试连通性」，
  用一句样例真实翻译一次（`TRANSLATE_BATCH`）量往返耗时，口径见 §十四。
- **存储键仍有一处字面量重复**：`options/main.ts` 的 `storage.onChanged` 守卫里写了
  `'yt_sub_translator_settings'`（`utils/storage.ts` 未导出 `STORAGE_KEY`）。本轮不动 `utils/*`，
  留待后续统一导出；`test-options-ui.js` 已加守卫，禁止再在页面里「定义」第二份键/默认值。
- 参考页的导航有 18 项、按长页滚动定位；本项目 7 个分区用**面板切换**而非滚动锚点，
  因为设置项总量还不到需要整页滚动的程度。


---

## 七、「获取模型」（v0.4.2）

**问题**：设置页原来只有一行「模型名称」文本框，用户得自己去服务商文档里抄模型 id；能拉取列表的按钮只存在于弹窗里。

**做法**：把「输入框 + 获取模型按钮 + 可选列表」做成一组，落在 `服务与模型` 分区。

| 项 | 取值 |
|---|---|
| 控件 | `.row-control.model-fetch-control`（竖排三件套：`#model-name-input` → `#btn-fetch-models` → `#model-select`） |
| 拉取链路 | `chrome.runtime.sendMessage({ type: 'FETCH_MODELS', payload: { settings } })` → background → `fetchAvailableModels()`，与弹窗同一条链路、同一套鉴权差异处理 |
| 缓存 | `chrome.storage.local` 的 `cached_models_<service>`，键由 `utils/models.ts` 的 `cachedModelsKey()` 统一生成；弹窗拉到过，本页直接复用，反之亦然 |
| 预设 | `PRESET_MODELS` 从 `entrypoints/popup/main.ts` 移到 `utils/models.ts`，两个入口共用一份，杜绝「弹窗能选、设置页选不到」 |
| 选中即生效 | 下拉 `change` → `update({ modelName })` 落盘；选「手动输入其他模型…」把焦点交给输入框 |
| 手填保护 | 当前 `modelName` 不在列表里时，单独补一条「当前设置：xxx」并置为选中，列表刷新不会悄悄改掉手填值 |
| Google 通道 | 不请求、不下拉，提示「Google 免费通道无需选择模型」 |
| 失败 | 未填 Key → 直接提示并聚焦 Key 输入框；接口失败 → 显示 `res.error`，并在 `#fetch-models-status` 留一行可读原因 |



**验证**：`test/test-options-ui.js` 69 → **89** 项（新增 20 项：三件套存在与同宽竖排、走 `FETCH_MODELS`、进度态、写缓存、失败提示、Google 跳过、预设与缓存键单一来源、选中写回、服务切换后重载、弹窗改动同步）；静态渲染确认三件套与 API Key / Base URL 右边缘对齐，无溢出。

> **2026-11 更新**：§七 的「输入框 + 按钮 + 下拉」三件套已被 §八 的**模型卡片列表**取代
> （`#model-select` 已移除，手填入口与「获取模型」按钮都保留）。下面这节保留作历史记录。

---

## 八、模型配置改为可选列表（v0.4.2 第二轮）

### 8.1 为什么要换

§七 的形态是「一个文本框 + 一个 select」。用户反馈原话：「将原本需重新填写的单一输入改为可选列表，
支持在多个 API/LLM 之间直接切换」。文本框要求用户知道 model id，下拉又把 id 藏在一行文字里，
两者都看不出「这个模型属于哪家、长什么样、现在用的是哪个」。

### 8.2 新的行结构

```
DeepSeek                                  ← 组标题（复用 .row-title + .model-group-title 调小一档）
┌──────────────────────────────────────┐
│ ◯  DeepSeek-V3 / Chat (推荐)  使用中 DeepSeek │  ← 使用中：左标线 + aria-disabled，不可再点
│    deepseek-chat                     │
│ ◯  DeepSeek-R1 / Reasoner      DeepSeek │
└──────────────────────────────────────┘
```

| 元素 | 实现 |
|---|---|
| 行 | `.model-row` > `button.model-hit`（真 button，Enter/Space 原生可选）+ `.model-ops`（仅自定义条目） |
| 图标 | 24px 圆形底 `.model-icon`，内联 15px SVG，`currentColor` |
| 文字 | `.model-label`（显示名）+ `.model-id`（等宽、`--text-muted`） |
| 右尾 | `.model-state`（使用中）+ `.model-badge`（服务商） |
| 对齐 | `.model-hit` 右侧固定留 88px 给编辑/删除，所有行同宽 → badge 右缘逐行对齐（实测偏差 0px） |
| 分组 | `MODEL_SERVICE_GROUPS`：DeepSeek / OpenAI 兼容 / Google Gemini / 自定义 |
| 键盘 | 行是真 button（Enter/Space），列表容器补 ↑↓/Home/End 移焦点；`:focus-visible` 焦点环沿用全局规则 |
| hover | 左侧 2px 标线 `scaleY` + 背景微亮，不做整体上浮 |

- **点一行 = 切服务 + 切模型 + 立即落盘**：`selectModel()` 组装 `{ modelName, service, apiKey, serviceKeys }`
  一次写入，避免「先改模型再改服务」中间态被存储回声覆盖。
- **在线列表是「并入」不是替换**：`onlineModels[service]` 排前面、`PRESET_MODELS` 补在后面，按 id 去重；
  自定义条目单独成组，不会在服务商组里重复出现。
- **手填不能丢**：`#model-name-input` 仍绑定 `data-setting="modelName"`，与列表共用同一个字段；
  手填的 id 不在任何列表里时，在所属服务商组头部补一条「手动输入」，让「现在用的是哪个」始终可见。
- **`service='custom'` 的映射**：`ExtensionSettings.service` 只有 google/gemini/openai/deepseek 四个值，
  自定义条目统一按 **OpenAI 兼容通道**请求（`resolveRequestService()`），badge 仍显示「自定义」。

### 8.3 自定义模型与图标集

- 入口：列表下方「＋ 自定义模型」→ `<dialog>` 弹层（Esc 可关、内置焦点管理，`margin:auto` 手动补回居中）。
- 字段：显示名（≤40）、model id（≤120，`[A-Za-z0-9._:/-]`）、服务商（自定义 / DeepSeek / OpenAI 兼容 / Gemini）、图标（9 格网格 `role=radiogroup`）。
- 持久化：`settings.customModels`，上限 20 条；行内有「编辑 / 删除」；改 id 时同步 `modelName`；
  删除正在使用中的条目 → 回退到该服务商 `PRESET_MODELS[service][0].id`，绝不留空 `modelName`。
- **图标 9 种，全部内联 SVG**（24×24，1.5px 描边或纯色填充，`currentColor`，无外链/base64/icon font）：

| key | 形态（简化几何标记，非官方 logo） |
|---|---|
| `deepseek` | 缺口圆环（鲸身）+ 右上喷水点 |
| `qwen` | 圆环 + 右下斜尾（Q 的几何化） |
| `chatgpt` | 外六边形 + 内六边形（结绳标的母题） |
| `gemini` | 四角星（填充） |
| `claude` | 八向星芒 |
| `kimi` | 填充月牙（Moonshot 母题） |
| `glm` | 圆角方框内嵌 Z |
| `deepl` | 字母 D 的几何化 + 右向翻译箭头 |
| `generic` | 靶心（兜底） |

图标 key 由 `inferModelIcon(id)` 按前缀推断（`deepseek* / qwen* / gpt|o1|o3|o4* / gemini|gemma* / claude* / kimi|moonshot* / glm* / deepl*`，其余 `generic`）。

### 8.4 跨服务商切换：按服务商记 Key

原来只有一个 `apiKey` 字段，切到另一家必然 401。现在：

| 项 | 规则 |
|---|---|
| 存储 | `settings.serviceKeys: Record<string, string>`，键只允许 google/gemini/openai/deepseek |
| 编辑 Key | 当前服务商那一格始终等于 `apiKey`（在 `sanitizeSettings` 里统一抹平，不靠页面各写一遍） |
| 切换服务 | 先把当前 `apiKey` 存回旧服务商那一格，再取回目标服务商的 Key 写进 `apiKey`（同一个 patch 落盘） |
| 取不回 | `apiKey` 置空 + API Key 行下方显示「该服务商还没有保存过 Key。」（`#service-key-hint`） |
| 升级兼容 | 老用户没有 `serviceKeys` 时 `apiKey` 原样保留、不会被历史值覆盖；用户清空 Key 时该格同步删除 |
| 长度 | `serviceKeys` 的值与 `apiKey` 共用 400 字符上限（trim + 截断） |

### 8.5 数据结构与清洗

```ts
interface CustomModelEntry { id: string; label: string; service: 'deepseek'|'openai'|'gemini'|'custom'; icon: string }
// settings.customModels: CustomModelEntry[]   上限 20（MAX_CUSTOM_MODELS）
// settings.serviceKeys: Record<string, string> 键白名单 + 值 trim/截断
```

`sanitizeSettings()` 的规则（`utils/storage.ts`）：

1. `customModels` 非数组 → `[]`；**逐条校验，非法/超限条目单独丢弃**（不整份重置，用户不丢已配好的）；
2. 空 id 丢、`service` 不在白名单丢、同 `service|id` 去重、`label` 缺省回落 id、`icon` 非白名单回落 `'generic'`；
3. `serviceKeys` 键不在白名单丢、非字符串丢、值 trim 后为空不占格；
4. 当前服务商那一格与 `apiKey` 强制一致（`apiKey` 为准）；
5. 默认值仍只在 `types/index.ts` 定义一份（`test-options-ui.js` 有断言守着，页面里不许出现第二份）。

### 8.6 需求二：原生下拉面板在深色下不可见

**病因**：`.ctl-select option { background: #14151a; color: var(--text-main) }` 早就写了，但 Windows
Chrome/Edge 的 `<select>` 弹出面板由**系统渲染**，不读 option 的 `background-color`，只读它的文字颜色 →
浅色面板 + `#fafafa` 文字 = 几乎看不见。

| 位置 | 加了什么 |
|---|---|
| `entrypoints/options/style.css` `:root` | `color-scheme: dark`（原生 popup / 滚动条 / 取色器的总开关；这也是 Windows 上唯一可靠的开关） |
| 同上 `.ctl-select option, select.gloss-input option` | `background-color: #14151a` + `color: var(--text-main)`（兜底 + 顺带修好行内编辑用的 `select.gloss-input`，它没有 `.ctl-select` 类） |
| `entrypoints/popup/style.css`（**v0.4.0 当时未改**，任务四已补，见 §9.3） | 已有 `.form-select option { background:#18181b; color:#fff }`，但同样缺 `color-scheme: dark` |

**为什么只加 `background-color` 不够**：原生 popup 是一层独立的系统窗口，`option` 的 `background-color`
在部分平台被忽略，而 `color-scheme` 会告诉浏览器「这个控件该用深色配色渲染」，Chrome 才会把 popup
连同高亮条、滚动条一起换成深色。两者叠起来才稳：`color-scheme` 决定面板底色，`option` 配色兜住
不认 `color-scheme` 的场景（老内核 / 非 Chromium）。

### 8.7 验证（本轮）

| 项 | 结果 |
|---|---|
| `npx tsc --noEmit` | 0 error |
| `npm test` | EXIT=0，11 个套件全绿 |
| `test-options-ui.js` | 89 → **139** 通过 / 0 失败（新增 50 项：列表与分组、点选写回、键盘、手填补行、图标白名单与推断、自定义增删改、`serviceKeys` 往返与升级兼容、`color-scheme` 与 option 配色） |
| `test-popup-ui.js` | **49** 通过 / 0 失败（未改动弹窗，数量不变） |
| 7 分区渲染 | 每个分区 `active` 唯一，`overflowX = 0`（1440 / 1080 / 800 三档） |
| 模型列表几何 | 11 行等高 44px；行宽唯一值 758px；badge 右缘偏差 **0px**；图标渲染尺寸统一 15×15 |
| 点选 | 点 Gemini 行 → `service=gemini`、`modelName=gemini-1.5-flash`、`apiKey=''`、提示行出现、`serviceKeys` 保留旧两家 |
| 手填 | 输入 `my-private-endpoint-v9` → 落盘一致、列表补一条「手动输入」并标为使用中 |
| 自定义模型 | 弹层居中（dx=dy=0）、9 图标、`aria-checked` 跟随点选、保存后 3 条落盘并重绘、弹层关闭 |
| 术语库 | 首包 146 行（146/146）；搜索「そら」→ 1/146 |
| 字号预览 | 32px 即时生效且 `fontSize=32` 落盘 |
| 下拉配色 | `#gloss-category` 的计算样式：`color-scheme: dark`、option `rgb(20,21,26)` / `rgb(250,250,250)` |
| 控制台 | 0 pageerror、0 console error |
| 令牌 | 未新增任何 `:root` 之外的令牌；与弹窗共享的 9 个关键令牌仍一致 |

---

## 九、任务四：翻译场景分区 + 新建术语库 + 两个收尾

三个独立需求一起做，是因为它们都在同一批文件里（`index.html` / `main.ts` / `style.css` /
`types` / `storage`），分三次改会重复跑同一条验证链。

### 9.1 「翻译场景」独立分区（第 8 项，位于「服务与模型」与「术语库」之间）

**用户原话**：「在术语库上方新增独立选项，用户可查看并修改该翻译场景的全部内容；同一场景下不同类型的
提示词需在 UI 上分区展示，并附说明。」

**与「常规」分区的场景卡片的分工**（这是本节唯一需要记住的设计决定）：

| | 常规分区的场景卡 | 本分区的场景列表 |
|---|---|---|
| 定位 | 遥控器：点一下即换用 | 工作台：点一下只是**查看** |
| 点击后 | `update({ scenario })` 立刻生效 | 只换右侧查看对象，`settings.scenario` 不动 |
| 换用 | 就是点卡片 | 必须显式点「使用此场景」 |

理由：用户想「看一眼别的场景写了什么」，不该把正在使用的场景换掉。

**右侧详情自上而下**：

1. 场景名 + 一句话描述 + 来源横幅（内置 = 改文案会另存副本；自定义 = 原地改）+ 「使用此场景」按钮
   （已在用则禁用并显示「正在使用」）；
2. 总说明：「这是实际注入给翻译模型的 system prompt，从上到下依次拼接；除「场景人设」外都不能在此修改。」
3. **分层卡片**：数据 100% 来自 `utils/prompt-layers.ts#buildPromptLayers()`，页面不拼一句文案
   （`test-options-ui.js` 断言 `main.ts` 里不出现 `COMMON_RULES` / 「禁 AI 腔」这类正文）。

| 层 | 卡片右上角标注的控制方 |
|---|---|
| `scene` 场景人设 | 场景自带 |
| `common` 通用硬规则 | 全局固定 |
| `annotation` 专名括注 | 受「专有名词括注原文」设置控制 |
| `asr` ASR 纠错授权 | 受「ASR 纠错授权」控制 |
| `reasoning` 推理深度 | 受推理档位控制 |
| `glossary` 本批命中术语 | 按本批命中的术语动态生成（**只留一句说明位，不展示空壳**） |
| `output` 输出契约 | 格式契约不可改 |

- **层号取 `PROMPT_LAYER_ORDER` 的位置**（`indexOf(key) + 1`），不按可见卡片数累加：
  术语层只留说明位时，输出契约仍显示第 7 层，不会缩成第 6 层与外面对不上。
- **空正文层隐藏**（`body.trim()` 判空）：`buildPromptLayers` 的口径是「空层不剔除、body 为空串」，
  隐藏是界面的事，装配器那边按 `trim()` 过滤，两边等价。
- **占位场景**（`prompt === ''`，如「科普视频」）走 `resolveScenePrompt` 兜到 general 的文案，
  并在头部明说「这个场景还没有自己的提示词，实际注入的是「通用日常」的人设」——界面与真正注入的同源。
- **长正文折叠**：`.layer-body` 默认 `max-height: calc(1.6em * 8 + 22px)`（= 8 行文本 + 内边距 + 1px 边框，
  直接写 `8.8em` 只够 4 行多），超出才显示「展开全文」。折叠判定先用 `estimateLayerLines()`
  估算（CJK 记 1 宽、拉丁 0.55 宽），页签可见后再由 `syncLayerClamp()` 用 `scrollHeight` 校正
  ——面板 `display:none` 时量出来全是 0，只能这么两段式。

**编辑与落库路径**（只有 `scene` 层 `editable === true`）：

| 当前场景 | 保存动作 | 落库 | 提示 |
|---|---|---|---|
| 内置 | 复制成自定义副本：id `custom-scene-<slug>-<base36>`（撞号加 `-2` 重试），名字加「· 自定义」 | `saveScenePacks([...])` + `update({ scenario: copy.id })` | 「已另存为自定义场景「X」并启用；该场景已更新，已有字幕会按新文案重译一次」 |
| 自定义 | 原地 `pack.prompt = text` | `saveScenePacks([...])`（**不切使用中**） | 「该场景已更新，已有字幕会按新文案重译一次」 |

- 长度校验与 `validateScenePack` 一致（20–4000 字），超限给**行内错误**（`role="alert"`），不静默截断。
- 为什么会重译：`scene` 层进静态骨架指纹（`buildPromptSkeleton → hashPrompt`），改一个字符缓存键就变。
- 保存的两种路径都只写 `yt_sub_custom_scene_packs` 这一份（`saveScenePacks`），没有页面级副本。

### 9.2 术语库「新建术语库」

**用户原话**：「当前只能通过导入文件新建，需在『导入 JSON』按钮上方增加『新建术语库』入口，支持直接创建。」

- 入口在 `pack-rail-foot` 内、**按钮顺序在「导入 JSON」之上**，两个都是 `.btn.btn-quiet.btn-block`
  （实测同宽同高：196×30 @1080 / 746×30 @800）。footer 补了 `flex-direction: column`
  ——`.btn` 是 inline-flex，不排成列两个 block 按钮会挤在同一行。
- 弹层复用 `.modal`（与「自定义模型」同一套 `.modal-body / .field / .modal-foot`）：
  名称（必填 ≤40）+ 描述（选填 ≤120）。重名给行内错误，不做静默改名。
- id：`custom-glossary-<slug>-<base36>`，与既有 id（含内置）撞了就加后缀重试。
- **空包不经过 `validateGlossaryPack`**：那个函数是「上传一份 JSON」的入口校验，明确要求
  `entries` 非空（没有内容的文件没有导入意义）。新建走**内部构造**，这里是有意的分歧点：
  校验管的是「外部文件能不能收」，空壳是「先建个容器再逐条填」。空包对下游安全——匹配 0 条、
  指纹按内容算（`glossaryPackFingerprint` 对空数组稳定）。
- 创建后：自动选中新包 → 清掉搜索/分类筛选（否则空表会被误读成「被过滤空了」）→ 右侧进空表状态
  （`0 / 0 条` + 空状态块）→ 「新增条目」直接用 → 一行成功提示。

### 9.3 两个收尾

**① 弹窗原生下拉看不见**：`entrypoints/popup/style.css` 的 `:root` 补一行 `color-scheme: dark`（其余未动）。
影响面：弹窗内**所有** `<select>` 的展开面板、滚动条、取色器都会按深色渲染；option 的
`background/color` 兜底（`.form-select option`）保持不变，两者叠加才在旧内核上也稳。

**② 按服务商记忆 Base URL**（照抄上一轮 `serviceKeys` 的做法）：

| 项 | 规则 |
|---|---|
| 存储 | `settings.baseUrls: Record<string, string>`，键只允许 google/gemini/openai/deepseek |
| 清洗 | `sanitizeBaseUrls()`：键白名单、值 `trim()` + 300 字上限、空串不占格（与 `sanitizeServiceKeys` 同构） |
| 一致性 | 当前服务商那一格**始终等于 `apiBaseUrl`**（在多处页面写一遍不如在 `sanitizeSettings` 里抹平一次） |
| 切换服务 | `serviceSwitchPatch()` 一个 patch 同时写 `service / apiKey / serviceKeys / apiBaseUrl / baseUrls`：先把当前值存回旧服务商那一格，再取回目标那一格（没有则清空 = 官方端点） |
| 升级兼容 | 老用户 `baseUrls` 为空 → `apiBaseUrl` 原样保留，随后补进当前服务商那一格，不被任何历史值覆盖 |
| 覆盖面 | 模型卡片行点选**与「翻译服务」分段控件**都走同一个 `serviceSwitchPatch`（原先分段控件只改 `service`，是端点被带过去的另一条路） |

`apiBaseUrl` 本身也补了 `trim()`（原先不 trim），与分格存储共用同一个 300 字上限，避免
「输入框尾部一个空格」导致两边不一致。

### 9.4 验证（本轮）

| 项 | 结果 |
|---|---|
| `npx tsc --noEmit` | 0 error |
| `npm test` | EXIT=0，12 个套件全绿 |
| `test-options-ui.js` | 139 → **213** 通过 / 0 失败（新增 74 项） |
| `test-popup-ui.js` | **49** 通过 / 0 失败（未改弹窗逻辑，只加一行 `color-scheme`） |
| `test-prompt-layers.js` | **67** 断言全过（未改动） |
| `test-packs.js` / `test-glossary.js` / `test-segmenter-lang.js` | 82 / 68 / 85 通过 |
| 分区 | 8 个，`role=tablist` + 8 个 `tabpanel`，`aria-labelledby` 全部指向真实 `#nav-*`；方向键 / Home / End 仍按 `.navitem` 集合走，无需改代码 |
| 分层卡片顺序 | 渲染结果 1 场景人设 → 2 通用硬规则 → 3 专名括注 → 4 ASR 纠错授权 → 5 推理深度 →（第 6 层说明位）→ 7 输出契约；`data-layer` = `scene/common/annotation/asr/reasoning/output` |
| 编辑入口唯一 | 只有 `scene` 卡有「编辑」；进入编辑态后该按钮消失、换成 textarea + 保存/取消 |
| 几何（1280 视口） | 两栏 `218px + 558px`（与 `.gloss-layout` 同一规则）；6 张卡片宽度唯一值 **558**；控制方 badge 右缘全部 **1061**（偏差 0）；正文统一 `ui-monospace 11px`；字号阶梯 15 / 12.5 / 11.5 / 11.5 / 10.5 / 10 |
| 折叠 | 只有超 8 行的层出现「展开全文」（`display:flex` × 1，其余 `none`）；展开后 `max-height` 放宽并允许内部滚动 |
| 编辑态 textarea | 528×**240**、`ui-monospace 11.5px`、`overflow-y:auto`、`label[for=scene-prompt-input]` 存在 |
| 卡片是否等高 | **不等高**（按内容自适应：273 / 210 / 210 / 192 / 175 / 214）。刻意不做等高：等高会把短层撑成大片空白，且展开/收起时抖动 |
| 新建术语库弹层 | 462.9×272.4、水平居中（`|中心-640| < 1`）、Esc 可关、两个按钮 30px 高 |
| 空包状态 | 包列表出现「我的常用译名 0」并被选中；右侧计数 `0 / 0 条`、空状态块可见；工具栏「新增条目」可用 |
| 横向溢出 | **0**（1280 / 1080 / 800 三档 × 4 个静态页） |
| 控制台 | 0 pageerror（4 个静态页） |
| 令牌 | 未新增任何 `:root` 之外的 CSS 自定义属性；`.layer-body` 的 `max-height` 用 `calc(1.6em * 8 + 22px)`，不引入新令牌 |

> 静态渲染用的是 `D:\edge\_ui\` 下的副本（`<link>` 换 `file:///`、去掉 `<script type="module">`、
> 注入脚本激活 pane）；分层卡片的正文与顺序由真实 `buildPromptLayers()` 在 Node 里生成后写入，
> 因此截图里的文案与线上同一份数据。

### 9.5 本轮问题清单 / 已知限制

1. **「分类」默认值没做**（需求里写的是「可选」）：`GlossaryPack` 只有
   `id/name/description/builtIn/entries`，没有「包级默认分类」字段，而 `utils/packs.ts` 本轮不可改。
   放一个只在内存里生效的下拉会变成「重启就丢」的半成品，所以弹层只收名称 + 描述。
   要做得先给 `GlossaryPack` 加字段（下一轮）。
2. **场景列表的「使用中」与「查看中」是两个状态**：列表项用 `aria-selected` + `aria-current`
   分别表达，视觉上「查看中」是 `.active` 底色、「使用中」是绿色 pill。两者可以不同——这是设计，不是 bug。
3. **`output` 层显示的是 `目标语言：zh-CN` 这种码值**，因为内容脚本就是把 `settings.targetLang` 原样
   传给 `buildPromptLayers`（没有任何「码值 → 语言名」映射）。这里选择如实显示：界面看到的必须等于
   真正注入的，宁可让码值看起来糙一点。
4. **`estimateLayerLines()` 是估算**：静态副本（无 JS）里保留估算态，真实页面会有
   `syncLayerClamp()` 用 `scrollHeight` 兜正；两者只在「刚好压 8 行边界」时有 ≤1 行差异。
5. **`glossary` 层永远是说明位**：界面不传 `glossaryBlock`（那需要一次真实批次命中的术语），
   所以这一层在设置页永远不预览正文，只解释它按批生成。
6. **包级「删除 / 启用」仍不在设置页**：术语库分区的现状（启用走弹窗的包开关），本轮未扩大范围；
   空包对这两条既有通路无影响（导出空包得到 `entries: []`）。
7. **`baseUrls` 不参与翻译请求的读取路径改造**：`utils/translator.ts` 本轮不可改，仍只读
   `apiBaseUrl`。因为「当前服务商那一格恒等于 `apiBaseUrl`」，语义上等价；真正的收益是
   **切服务商那一刻端点会跟着换**，这正是原来的 bug 点。

---

## 十、厂牌一级 / 模型二级（任务四 · 需求二 + 三）

> 清单口径见 **`docs/PROVIDER-MODELS.md`**（厂牌表、每个模型的定位、端点、Key 申请入口、更新方法）。
> 本节只讲**界面层级与落库**。

### 10.1 为什么要重排

原先把「服务」当成一把扁平下拉：4 个 service 各一组模型，Key 也按 service 记。两个问题：

1. **模型清单是混装的**：`openai` 组里塞着 `gemini-*` / `claude-*`，用户看不出「这是哪家的模型」；
2. **Key 记不住**：Claude / 通义 / Kimi / GLM 的 service 都是 `openai`，四家共用一格 Key，
   换一家就要重填，而填错时表现是 401 —— 用户会以为 Key 无效。

现在按 LobeHub 的信息结构重排：**厂牌是一级，模型折叠在厂牌下**；Key 与端点也跟着厂牌走。

### 10.2 层级

```
服务与模型
├── 翻译通道
│   ├── 免 Key 区：Google 免费翻译（单独一块，选中即 service='google'）
│   └── 厂牌列表（7 个需要 Key 的厂牌，默认只展开「正在用」的那个）
│       └── 厂牌行：图标 + 厂牌名 + Key 状态 + 模型数 + 展开箭头   ← button[aria-expanded]
│           └── 展开面板（缩进 24px，左侧一条细线交代从属关系）
│               ├── API Key（可显示/隐藏）+ 申请入口链接
│               ├── 高级：Base URL（<details>，默认收起）
│               ├── 模型行：显示名 + 等宽 model id + 定位 note + 使用中  ← button
│               └── 工具条：获取模型 / ＋ 自定义模型 / 测试连通性（都作用于这个厂牌）
├── 失败自动降级
└── ASR 纠错授权
```

- **厂牌行不是单选按钮**，是展开器（`aria-expanded` + `aria-controls`）：
  「选哪家」这件事由「点某个模型」完成，避免「点开看一眼就把正在用的换掉」。
- **模型行不再逐个画图标**（厂牌已经交代了归属），顺带去掉了原来那一列 24px 圆底，
  缩进 + 等宽 id 足够表达层级。
- **免 Key 区用 `aria-pressed`**（与页面上既有的分段按钮同一套语义），它不受 Key 约束。

### 10.3 交互要点

| 行为 | 结果 |
|---|---|
| 点厂牌行 | 展开 / 收起该厂牌，`aria-expanded` 同步，其余厂牌不受影响 |
| 点模型行 | 一次性写 `{ providerId, modelName, service, apiBaseUrl, apiKey }` 并落盘 |
| 切厂牌后再展开看 Key | 看到的是**那个厂牌自己**的 Key（`providerKeys[providerId]`），不会串到别家 |
| 编辑 Key | 只写该厂牌那一格；只有当它就是「正在用的厂牌」时才同步 `apiKey`（请求层只读 `apiKey`） |
| 编辑 Base URL | 覆盖值存进 `providerBaseUrls[厂牌]`；清空 = 回落到 `defaultBaseUrl`（Gemini 是空串，走官方 SDK 路径） |
| 获取模型 | 用**这个厂牌**的 Key + 端点调 `FETCH_MODELS`，结果缓存到 `cached_models_<providerId>`；这是**实际列表**，之后以它为准裁掉参考清单里没有的型号（§十四） |
| ＋ 自定义模型 | 弹层只收「显示名 + model id」，服务商与图标由所属厂牌决定；删除正在用的条目 → 回退到该厂牌默认模型 |
| 手填 / 下架的旧型号 | 仍在所属厂牌下显示一行「当前设置：<id>」并保持选中；没拉过实际列表时标「自定义 / 已下架」，有实际列表且它不在其中时标「当前设置 · 未在列表」（§十四） |
| 切「翻译通道」分段控件（常规分区） | 走同一个 `serviceSwitchPatch()`，把 Key / 端点 / 模型一起搬到目标厂牌 |

**键盘与焦点**：厂牌行、模型行都是原生 `button`（Enter/Space 可用），焦点环走全局
`:focus-visible`；展开后的面板在 DOM 顺序上紧跟厂牌行，Tab 依次经过 Key → 高级 → 模型 →
工具条；↑↓ / Home / End 在**可见的**模型行之间移动。列表是整块重绘的，所以每个可聚焦元素
带 `data-fk`，重绘前记下 `data-fk` + 光标位置、重绘后还回去 —— 否则「拉完列表光标跳回页顶」，
「输入 Key 时每敲一个字跳一次」。

**不做的事**：不做整行 hover 上浮（hover 用 `::before` 左标线，`.provider-row` 与 `.model-hit`
同一语义）；不做展开动画（面板用原生 `hidden`，收起即移出 tab 序列，也就不存在「动画期间能
Tab 到看不见的控件」）。

### 10.4 落库与迁移

| 设置项 | 形状 | 说明 |
|---|---|---|
| `providerId` | `string` | 当前厂牌，默认 `'deepseek'` |
| `providerKeys` | `Record<providerId, string>` | 每厂一格；键按 `PROVIDER_IDS` 白名单过滤，值 trim + 400 上限 |
| `providerBaseUrls` | `Record<providerId, string>` | 端点覆盖值；trim + 300 上限，空串不占格 |
| `serviceKeys` / `baseUrls` | 旧字段 | **仅作迁移输入**（`@deprecated`），迁完从输出里删除，不再写回 |
| `customModels[].providerId` | `string` | 自定义条目挂在哪个厂牌下；老条目按 service 主厂牌补 |

迁移只在 `sanitizeSettings()` 里做一次（读时做，写入时自然带过去），规则见
`docs/PROVIDER-MODELS.md` §四。两个细节值得记住：

1. **`service` 变了但 `providerId` 没跟上时，按 `service` 的「主厂牌」重新落位** ——
   弹窗只会写 `service`（它没有厂牌概念），不这么做就会把 A 家的 Key 写进 B 家的格子。
2. **`service === 'google'` 时不做 Key 同步** —— 免费通道不需要 Key，此时 `providerId`
   只是「上次用的那个厂牌」，把 `apiKey` 写进它那一格会造成串味。

### 10.5 验证（本轮）

| 项 | 结果 |
|---|---|
| `npx tsc --noEmit` | 0 error |
| `npm test` | EXIT=0，13 个套件全绿 |
| `test-options-ui.js` | 213 → **245** 通过 / 0 失败（新增/改写 32 项） |
| `test-popup-ui.js` | **49** 通过 / 0 失败（弹窗未改一行） |
| 厂牌数 | 8 = 7 个需要 Key 的厂牌 + 1 个免 Key 区；`google-free` 不渲染成厂牌行 |
| `PRESET_MODELS` | 仍非空、键仍是 `deepseek/gemini/openai`，与 `PROVIDERS` 逐 id 一致（测试自动比对） |
| 过时型号 | `deepseek-chat` / `deepseek-reasoner` / `gpt-4o(-mini)` / `gemini-1.5-*` / `gemini-2.0-flash-exp` / `claude-sonnet-4-6` 已从预设移除 |
| 令牌 | 未新增任何 `:root` 之外的 CSS 自定义属性（`test-options-ui` 的 strayTokens 断言仍为 0） |

---

## 十一、翻译场景新建 / 导入 / AI 模板 + Key 只落 local（任务四 · 需求四 + 五 + 隐私修复）

三个需求一起做：它们都要改 `entrypoints/options/*` 与 `utils/storage.ts`，分开跑会重复同一条验证链。

### 11.1 翻译场景：新建 / 导入 / 文件格式规范

**用户原话**：「翻译场景参考术语库，支持用户自行新建翻译场景或上传文件，并给出明确的文件格式规范。」

#### 入口（左侧场景栏底部，与术语库同一套）

```
翻译场景 7
├─ VTuber 直播      ← 点一下只是「查看」
├─ 通用日常
├─ …
└─ ＋ 新建场景        ← .btn.btn-quiet.btn-block
   导入 JSON
   用 AI 生成模板     ← 需求五
```

- 三个按钮都在 `.pack-rail-foot` 里，宽度/高度与术语库那三个完全同源（`flex-direction: column` 决定竖排，
  不排成列时三个 `inline-flex` 按钮会挤在同一行）。
- 顺序固定：**新建 → 导入 → 模板**（新建在上面、模板贴着导入下方，与需求描述一致）；
  `test-options-ui.js` 用 `pack-rail-foot` 内的 `indexOf` 顺序断言守着。

#### 新建场景

| 项 | 值 |
|---|---|
| 弹层 | `#new-scene-dialog`（`.modal.modal-wide`，`aria-labelledby="ns-title"`，`showModal()` → Esc 可关） |
| 字段 | `#ns-name`（必填 ≤40）、`#ns-desc`（选填 ≤120）、`#ns-prompt`（textarea，必填 20~4000，等宽多行） |
| 打开时 | 提示词框预填 `SCENE_PROMPT_SEED`（约 70 字的一段可用人设），**不给人一个过不了校验的空框** |
| 校验 | 直接复用 `validateScenePack({ version, name, description, hint: '', prompt })` —— 与「导入 JSON」同一条路径，长度/必填/未知字段都在那里 |
| 失败 | 只在 `#ns-error`（`role="alert"`）行内报错并聚焦对应字段，`customPacks` 一个字节都不动 |
| 落库 | `saveScenePacks(customPacks.scenes)`，只有这一份；id 由 `validateScenePack` 的 `makeId` 生成，撞号走 `uniqueSceneId` 加后缀重试 |
| 完成后 | `viewingSceneId = pack.id`（选中＝查看），**不改** `settings.scenario`；右侧「使用此场景」保持可点，点它才真的换用 |

「新建了但不自动切换」是刻意的：与 §9.1 的「遥控器 / 工作台」分工一致——用户可能只是想先建一个以后再换。
术语库那边「新建即选中」不冲突，因为术语库没有「使用中」这个概念。

#### 导入 JSON

`#file-import-scene`（隐藏 file input）→ `JSON.parse`（`try/catch`）→ `validateScenePack` → 通过才写库：

| 阶段 | 失败表现 |
|---|---|
| 不是合法 JSON | 顶部 `#scene-import-report`（`role="alert"` + `<ul>`）列出「JSON.parse 报错：常见原因是多余逗号、单引号、// 注释…」 |
| 校验不过 | 同一区块**逐条**列出 `validateScenePack` 的 errors（`缺少字段 prompt（场景提示词）` / `prompt 少于 20 字，无法有效翻译` / `存在未知字段：promt` …），一条也不入库 |
| 浏览器存储不可用 | 单独一行提示，同样不入库 |
| 成功 | 与内置/已有场景同名 → 名字加「（自定义）」后缀；入库并选中（不换用），toast 说明「点右侧『使用此场景』」 |

写库语句 `customPacks.scenes = [...customPacks.scenes.filter((p) => p.name !== pack.name), pack]` 在
**所有** 校验分支之后——`test-options-ui.js` 断言「失败分支的 return 出现在写库之前」，
这就是「不合法文件绝不半入库」的可验证形式。

#### 文件格式规范（分区内，默认收起）

`<details class="spec-block" id="scene-spec">`，标题「文件格式规范（JSON）· 点开查看」，内容是：

1. 一句总说明（UTF-8、≤1 MB、校验失败逐条列出且不入库）；
2. **顶层字段表**：`name` / `prompt` / `description` / `hint` / `version` 的类型、必填、长度；
3. 「不允许未知字段」一句；
4. **可直接复制的完整示例**（`<pre class="spec-code">`，与文档同一个 JSON）；
5. **常见错误表**：缺 prompt、prompt 过短/超长、非对象、未知字段、`version` 写成 2。

与 `docs/PACK-UPLOAD-SPEC.md` §2.1 / §2.4 **逐字一致**，而且是**测出来的**，不是约定的：
`test-options-ui.js` 把文档表格行去反引号/加粗后与界面 `<td>` 文本逐格全等比较（字段表 6 行、常见错误 6 行），
示例 JSON 也做整段字符串相等 + `JSON.parse` + `validateScenePack` 三重校验。改规范只改一处会被测试立刻拦下。

> 一处**如实说明**：`version` 目前**不参与校验**（`validateScenePack` 只挡未知字段），所以
> 「version 写成 2」这一行写的是「不会因此被拒」而不是「会被拒」。见问题清单第 1 条。

### 11.2 需求五：两个分区各一份「用 AI 生成模板」

**用户原话**：「在『导入 JSON』下方新增入口，提供符合当前规范的通用提示词模板：用户复制后可粘贴到自己使用的 AI 中，
在首行自行填写需求，最终输出可直接导入的 JSON 文件。」

| 项 | 落点 |
|---|---|
| 入口 | 术语库分区 `#btn-glossary-template`、翻译场景分区 `#btn-scene-template`，都在各自「导入 JSON」**下方**，文案「用 AI 生成模板」（`title` 补一句用途） |
| 正文来源 | `main.ts` 的 `TEMPLATE_HEADER` + `glossaryTemplatePrompt()` / `sceneTemplatePrompt()`。**HTML 里只有一个空 textarea**，正文一律由 JS 灌进去（`test-options-ui` 断言 HTML 内不含模板正文的骨架句） |
| 弹层 | `#template-dialog`（`aria-labelledby="tpl-title"`、`aria-label` 给正文、原生 `dialog` → Esc 可关）；打开时 `body.focus()` 并把光标停在首行「# 需求：」末尾 |
| 复制 | `navigator.clipboard.writeText`；无权限/抛错 → `body.select()` + toast「已选中全部内容，按 Ctrl+C 手动复制」 |
| 两份不同 | 术语库模板有 `entries` 与 6 个条目字段、没有 `hint`；场景模板有 `hint` / `prompt`、没有 `entries`。测试禁止两边互串 |

**两份模板的字段清单**（贴清单，不贴全文）：

| | 术语库模板 | 翻译场景模板 |
|---|---|---|
| 共用开头 | 第 1 行 `# 需求：` 空位 → 「## 只输出 JSON：不要解释 / 不要 markdown 代码块围栏 / 输出必须能被 JSON.parse 直接解析（不要尾逗号、单引号、注释、… 省略）」 | 同左 |
| 顶层字段 | `name`(✅ 1~40)、`entries`(✅ 1~2000)、`description`(否)、`version`(否) | `name`(✅ 1~40)、`prompt`(✅ 20~4000)、`description`(否)、`hint`(否)、`version`(否) |
| 条目/内容约束 | `ja`(✅1~60)、`zh`(✅1~120)、`en`(否)、`category`(否，5 个枚举)、`source`(否)、`sourceType`(否，3 个枚举) | 「prompt 必须写全 5 件事」：角色 / 受众与语气 / 术语策略 / 格式与数字 / 禁止事项 |
| 硬约束 | ja 用原文写法、一条一个译名、不带括号原文、不许拼错键名 | 同上收尾 + 顶层只允许 5 个字段 |
| 最小示例 | 1 条 `entries` 的一行 JSON | 一个 60 余字 prompt 的一行 JSON |
| 收尾 | 「现在只输出 JSON 本体。」 | 同左 |

字段表的每一行与 `PACK-UPLOAD-SPEC.md` 对应表格行一字不差（测试比对 10 条术语库行 / 5 条场景行），
示例 JSON 也各自过 `JSON.parse` + `validate*Pack` —— 示例本身必须是「拖进去就能入库」的。

### 11.3 隐私修复：Key 只落 local

**用户原话**：「Key 仅保存到本地。」

**病因**：原来 `saveStoredSettings` **先写 `chrome.storage.sync`**（失败才退 local），`sync` 会随浏览器账号
上传到云端，与「本地」直接冲突；而且写的是**整份设置**，所以 Key 一定在里面。

#### 键划分

| 位置 | 键 | 内容 |
|---|---|---|
| `sync` | `yt_sub_translator_settings` | 除密钥外的全部设置（语言、外观、断句、厂牌 id、`providerBaseUrls`、`customModels`…） |
| `local` | `yt_sub_translator_secrets` | `{ apiKey, providerKeys }`（老 `serviceKeys` 迁移时折进 `providerKeys`）；空值不占格 |
| `local` | `yt_sub_translator_settings` | 仅 sync 写失败时的降级副本（与改动前同语义） |
| `local` | `yt_sub_custom_glossary_packs` / `yt_sub_custom_scene_packs` | 术语库 / 场景包（原本就在 local） |

#### 读写时序

```
getStoredSettings()
  └─ Promise.all([ sync:settings, local:settings, local:secrets ])   ← 三个并行
       base = sync || local
       return sanitizeSettings({ ...base, ...secrets })              ← 密钥覆盖 sync

saveStoredSettings(patch)
  └─ updated = sanitizeSettings({ ...current, ...patch })
       plain = { ...updated }，delete plain.apiKey / providerKeys / serviceKeys
       ① 写 local:secrets  ← 先
       ② 写 sync:settings   ← 后（失败则整份退 local:settings，与原来一致）
       return updated（调用方拿到的仍是完整设置，弹窗 / background / content 一行没改）
```

**为什么必须先 local 后 sync**：`chrome.storage.set` 会触发 `storage.onChanged`，设置页收到通知就
`getStoredSettings()` 回读。若 sync 先落，这次回读拿到的是**旧 Key**，表现为「刚敲进去的 Key 被抹回原值」。

#### 迁移时序（老用户）

1. 读到 `sync:settings` 里仍带 `apiKey` / `providerKeys` / `serviceKeys` 之一 → 视为老格式；
2. `sanitizeSettings` 归一（老的按 service 分格 → 按厂牌分格），取出密钥得到 `migrated`；
3. 与 `local:secrets` 合并，**local 优先**（升级后 local 才是唯一真相）；
4. 写 `local:secrets`；
5. 重写一次 `sync:settings`（把三个字段`delete` 掉）；
6. 用合并结果返回 —— 本次读取就已经是新值。

- **幂等**：抹完之后 sync 里没有敏感字段了，下次读取走正常分支，0 次写入（测试用 set 计数证明）。
- **失败不影响读取**：第 4/5 步的写失败只 `console.warn`，本次读取照常返回旧 Key，下次读取再试。
- **「恢复默认」全清**：`resetSettings` 仍然只调 `saveStoredSettings({ ...DEFAULT_SETTINGS })`，
  而 `apiKey: ''` + `providerKeys: {}` 会让 `writeSecrets` 落成 `{}` —— 本地密钥被清空，不再是「UI 变了 Key 还在」。

#### 老用户会不会丢 Key？多设备会怎样？（诚实答案）

| 问题 | 答案 |
|---|---|
| 升级后 Key 会丢吗 | **不会**。第一次读取就把 sync 里的 Key 搬到 local 并抹掉 sync 那份；连 `serviceKeys` 残留也一起折成 `providerKeys` 搬走（测试覆盖） |
| 换一台设备登录同一浏览器账号 | **设置会同步过来，Key 不会** → 那台设备当前不可用（401 / 提示未配置 Key），需要**在每台设备各填一次 Key** |
| 重装浏览器 / 清站点数据 | local 一并清空 → 需要重填 Key（这是「只存本地」的代价，不是 bug） |
| 同一台设备多个标签页 | 无影响：读写的是同一个 `local`，`onChanged` 仍能让设置页与弹窗互相同步 |
| 结论 | Key 从此**不跟随账号**。要恢复「换设备免填」，等于把 Key 重新放回云端，与本次需求直接矛盾，不做 |

### 11.4 验证（本轮）

| 项 | 结果 |
|---|---|
| `npx tsc --noEmit` | 0 error |
| `npm test` | EXIT=0，13 个套件全绿 |
| `test-options-ui.js` | 245 → **303** 通过 / 0 失败（新增 58 项：三个入口位置与样式、规范说明与文档逐字比对、新建/导入/不半入库、共用校验口径、两份模板与字段表、复制与降级、存储拆分静态断言） |
| `test-settings.js` | 20 → **45** 条 `assert`（新增 7 组行为断言：sync 无密钥 / local 有密钥 / 端点仍在 sync / 迁移含 serviceKeys 残留 / 迁移幂等（写计数 0）/ 恢复默认清空 local / patch 里的 serviceKeys 不漏进 sync） |
| `test-popup-ui.js` | **49** 通过 / 0 失败（弹窗一行未改） |
| `test-ai-track.js` | **104** 汇总通过 / 0 失败 |
| 端到端（esbuild 打包 `main.ts` + chrome 桩，真实 Chrome headless，36 项断言） | 见 §11.4.1 |

#### 11.4.1 端到端实测（`storage.sync` 与 `storage.local` 是两个独立内存对象）

| # | 场景 | 实测输出 |
|---|---|---|
| a | 新建场景 → 出现列表 → 可切换 | 弹层种子 78 字（≥20 可过校验）；列表 5→6 且新项名为「E2E 数学讲解」；`yt_sub_custom_scene_packs` 尾部即该包；「使用此场景」`disabled=false`；点击后 `sync.settings.scenario` = 新 id |
| b | 导入合法 / 缺 prompt | 缺 prompt：`#scene-import-report` 文本含「缺少字段 prompt」，列表条数 6→6（不变）；合法：列表出现「E2E 导入场景」、错误区收起、包内 prompt 原样落库 |
| c | 模板弹层 + 复制 | 首行 = `# 需求：`；含 `\| ja \| ✅ \|` / `\| category \| 否 \|` / `\| entries \| ✅ \|`、`"entries":[{`、`输出必须能被 JSON.parse 直接解析`；复制后剪贴板桩内容 === textarea（>200 字）；把桩改成 reject 后 → toast 含 `Ctrl+C` 且选区长度 = 全文长度；场景模板首行同为 `# 需求：`、含 `\| prompt \| ✅ \|`、与术语库模板不同 |
| d | 保存设置后 | `sync` 的键集合里**没有** `apiKey` / `providerKeys` / `serviceKeys`；`local.yt_sub_translator_secrets.apiKey === 'sk-e2e-key-123'`；`sync` 仍有 `service/providerId/modelName` |
| e | 老数据迁移 | 手动把 `{apiKey:'sk-legacy-e2e', providerKeys:{deepseek:…}}` 塞回 `sync` 并删掉 local 密钥 → 触发 `onChanged` → 读回：`sync` 三个字段全无、`local.secrets.apiKey` 有值、界面 Key 输入框显示 `sk-legacy-e2e`（**Key 没丢**）；再次触发读取 → 写入计数不变（**幂等**） |

同一轮还顺带核对了渲染：8 个分区且同时只有一个 `active`、术语库首包 **146** 行、搜索「そら」→ `1 / 146 条`、
字号 32px 预览即时生效且落盘、1440/1080/800 三档**零横向溢出**、`prefers-reduced-motion` 下活动分区
`opacity=1`（不会卡在动画起始帧）、**零 pageerror**。

> 端到端脚本是临时产物（`scripts/.e2e-tmp.mjs`），跑完即删，不进仓库：
> 它把 `index.html` 的 `<script type="module" src="./main.ts">` 换成本地打包的 bundle + `chrome` 桩，
> 再起一个 127.0.0.1 静态服务（`file://` 下 ES module 会被 CORS 拦）。

### 11.5 问题清单 / 已知限制

1. **`version` 不参与校验**：`validateScenePack` 只挡「未知字段」，`version: 2` 或 `"1"` 都能导入。
   界面与文档都如实写「不会因此被拒」，没有假装拦得住。要不要硬性拒绝见「需要拍板」。
2. **场景包不能导出**：术语库有「导出」，场景分区本轮只做了新建/导入/模板（需求没要求导出）。
   要做的话是同一套 blob 下载，一次就能补。
3. **同名场景会被替换**：导入时同名走 `filter(name !== x)` 再 push（与术语库同一条规则），
   即「同名的第二份不能共存」。想保留两份就改个名——弹层与报告里都提示了后缀规则。
4. **模板正文与文档的字段表仍是两处文本**：靠 `test-options-ui.js` 逐行全等比对守着。
   要做到编译期同源，需要把规范搬进一个 `.ts` 常量再生成文档，本轮没做（文档是 markdown，生成器不在范围）。
5. **`onChanged` 只监听设置键**：`yt_sub_translator_secrets` 的变化本身不进 `options/main.ts` 的守卫。
   现在每次保存都会同时写设置，所以刷新不会漏；但若将来出现「只写 Key 不写设置」的调用，另一侧不会刷。
6. **`serviceKeys` 只作迁移输入**：它仍可能出现在调用方的 patch 里（老弹窗），保存时会被 `sanitizeSettings`
   折进 `providerKeys` 并从 sync 里删掉，不会漏出去（测试覆盖）。

### 11.6 需要拍板的三个点

| # | 待定 | 现在的做法 | 备选 |
|---|---|---|---|
| 1 | `version ≠ 1` 要不要硬拒 | 不拦，界面/文档如实写「不会因此被拒」 | 在 `validateScenePack` 里加 `version !== 1 → error`（会让历史文件失效，属于行为变更） |
| 2 | 场景包要不要「导出 JSON」 | 未做（需求没要求） | 照抄术语库的 blob 下载，约 20 行 |
| 3 | 新建场景是否自动切换为「使用中」 | 不切（沿用「查看 vs 使用」分离） | 像术语库那样建完即用；代价是「想先建着」的人会被静默切走 |

---

## 十二、可读性提升 + 补齐过渡（任务四 · 需求一 + 六）

> 纯视觉 / 动效层改动：**分区数、控件数量、字段绑定、`data-setting` 属性、按钮文案全部未动**。
> 改动文件只有 `entrypoints/options/style.css`、`main.ts`（仅动效相关的 class/属性切换）、
> `test/test-options-ui.js`、`docs/UI.md`、`docs/OPTIONS-0.4.0.md`。`index.html` 一行未改。

### 12.1 字号 / 行高 / 间距（改前 → 改后，均为 `getComputedStyle` 实测）

| 位置 | 选择器 | 改前 | 改后 |
|---|---|---|---|
| 基准 | `body` | 13px / 1.5（lh 19.5） | **14px / 1.55（lh 21.7）** |
| 分区标题 | `.pane-head h1` | 21px | **22px** |
| 分区说明 | `.pane-head p` | 12px | **13px** |
| 行标题 | `.row-title` | 13px | **14px** |
| 行说明 | `.row-desc` | 11.5px / 1.55（lh 17.8） | **12.5px / 1.6（lh 20）** |
| 辅注 | `.row-note` | 10.5px / 1.5（lh 15.8） | **12px / 1.65（lh 19.8）** |
| 导航 | `.navitem-label` / `.navitem-hint` | 12.5 / 10 | **13.5 / 11.5** |
| 控件 | `.ctl` / `.seg button` / `.range-out` | 12 / 11.5 / 11.5 | **13 / 12.5 / 12.5** |
| 等宽 | `.model-id` | 10.5px / lh 14.2 | **12px / lh 18** |
| 等宽 | `.mono` / `.spec-code` / `.layer-body` / `.tpl-body` / `.scene-editor` | 11.5 / 10.5 / 11 / 11 / 11.5 | **12.5 / 12 / 12 / 12 / 12.5** |
| 厂牌 | `.provider-name` / `.provider-meta` / `.provider-free-desc` | 12.5 / 10.5 / 10.5 | **13.5 / 12 / 12** |
| 模型行 | `.model-label` / `.model-note` / `.model-state` | 12 / 10.5 / 10.5 | **13 / 11.5 / 11.5** |
| 术语库表格 | `thead th` / `td` / `td.cell-cat` | 10 / 11.5 / 10.5 | **12.5 / 12.5 / 12** |
| 术语库表格行高 | `#gloss-tbody tr` | 36px | **40px**（要求 ≥34px） |
| 左栏列表 | `.pack-item-name` / `.pack-item-meta` | 12 / 10 | **13 / 12** |
| 场景 | `.scene-title` / `.scene-desc` / `.scene-intro` / `.layer-detail` | 15 / 11.5 / 11.5 / 10.5 | **16 / 12.5 / 12.5 / 12** |
| 弹层 | `.modal-head h2` / `.modal-head p` / `.field-label` | 15 / 11 / 11 | **16 / 12.5 / 12** |
| 按钮 | `.btn`（`min-height` 一并 30 → 32） | 11.5px | **12.5px / 32px** |

间距（全部用 `padding` / `gap`，没有叠 `margin`）：

| 位置 | 改前 | 改后 |
|---|---|---|
| `.row` 上下内边距 | 14px | **17px**（每侧 +3，行距 +6） |
| `.row-text` 标题与说明之间 | gap 3px | **5px** |
| `.pane` 上内边距 / `.pane-head` 下外边距 | 30 / 22 | **32 / 24** |
| `.pack-item` 内边距 | 7px 9px | **8px 9px 8px 11px**（给左侧标线让位） |
| `.gloss-table` 单元格 | th 8px / td 6px | **th 9px / td 7px** |
| `.range-out` 最小宽 | 62px | **66px**（数值变宽不再贴边） |

### 12.2 对比度（对 `--bg-primary: #0a0b0d`，WCAG 2.1 公式实算）

公式：`L = 0.2126·R + 0.7152·G + 0.0722·B`（每通道 `c ≤ 0.04045 ? c/12.92 : ((c+0.055)/1.055)^2.4`），
`ratio = (L_亮 + 0.05) / (L_暗 + 0.05)`。数值由测试与渲染脚本各自独立算过一遍，结果一致。

| 令牌 | 色值 | 改前 | 改后 | AA（4.5:1） |
|---|---|---|---|---|
| `--text-main` | `#fafafa` | 18.86 | 18.86 | ✅ |
| `--text-body` | `#d4d4d8` | 13.32 | 13.32 | ✅ |
| `--text-muted` | `#a1a1aa` | 7.68 | 7.68 | ✅ |
| `--text-dim` | `#71717a → #82828c` | **4.07 ❌** | **5.18 ✅** | ✅ |

- **真正不达 AA 的是 `--text-dim`，不是 `--text-muted`**：后者改前就有 7.68:1。
  `--text-dim` 用在 `.row-note` / `.navitem-hint` / `.provider-meta` / `.scene-intro` /
  `.layer-detail` / `.editor-count` / `.pack-item-meta` 七处说明性文字上，改后全部 4.07 → 5.18。
- **三级层次保留**（实际是四级）：18.86 / 13.32 / 7.68 / 5.18，逐级递减且弱化层仍比次要层暗 2.5:1；
  测试里有一条断言守着「不得拉平成同一个亮度」。
- `--text-muted` 没动：它与弹窗共享，`关键令牌与弹窗完全一致` 这条断言守着，而弹窗不在本轮范围（见 12.7）。

### 12.3 横向溢出（`scrollWidth - clientWidth`，实机测量）

8 个分区 × 3 档宽度，全部为 **0**：

| 宽度 | 常规 | 服务与模型 | 翻译场景 | 术语库 | 断句引擎 | 字幕样式 | 同步与缓存 | 关于 |
|---|---|---|---|---|---|---|---|---|
| 1280 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 0 |
| 1080 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 0 |
| 800 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 0 |

没有用 `overflow: hidden` 掩盖换行（测试断言 `.row` / `.row-text` / `.row-control` /
`.input-with-btn` / `.editor-bar` 上都没有 `overflow: hidden`）。实际手段：
`.row-control` 加 `flex-wrap: wrap` + `min-width: 0`、`.input-with-btn` 靠 `flex-shrink` 让出按钮宽度、
辅助文案本身没加长。

> 一处试错记录：先给 `.input-with-btn` 也加了 `flex-wrap: wrap`，结果 Key 输入框（`.field .ctl` 是 `width: 100%`）
> 把「显示/隐藏 Key」的眼睛按钮挤到了下一行（截图对比可见）。已回退成只留 `min-width: 0`。

### 12.4 动效清单

八处逐条见 `docs/UI.md` §8（含「改前有没有 / 改后是什么属性与时长」的表）。
本文件只记与本轮可读性改动同时落地的三条取舍：

1. 厂牌展开的 `grid-template-rows` 过渡要求内层**不能有 padding**：网格项的 min-content 高度会把 padding 算进去，
   收起态（0fr）会残留 12px 的空条（首版实测就是这样）。上下留白改由子元素的 padding 承担，收起后实测高度 = 0。
2. 折叠态的「不可聚焦」用 `inert`（不靠 `display: none`，否则过渡就没了）；首次渲染仍用原生 `hidden` 省一次布局。
3. 弹层关闭动画只能由 JS 延后 `close()`：时长从 `--dur-fast` 令牌读（`tokenDurationMs('--dur-fast', 160)`），
   JS 里没有第二个硬编码时长；`prefers-reduced-motion` 下直接关，不做等待。

### 12.5 渲染与动效实测证据

方法：esbuild 把 `options/main.ts` 打成 IIFE（带 `chrome` 桩）→ 起 127.0.0.1 静态服务 → 真 Chrome headless。
「改前」用改动前快照（`%TEMP%\opts-before`）单独渲染一份，**没有动工作区、没有 stash**。

| 项 | 改前实测 | 改后实测 |
|---|---|---|
| 8 个分区 / 同时只有 1 个 active | 8 / 1 | 8 / 1（未变） |
| 分段滑块 `transition-property` | `transform` 0.3s `linear(0,…)` | 同左（确认「本来就有」） |
| 分段滑块位移 | 946 → 1008px（62px） | 946 → 1008px（62px），80ms 处 `matrix(…, 30.7, 0)` 为中间值 |
| 厂牌面板 `transition-property` | `""`（无过渡） | **`grid-template-rows, opacity` 0.3s / 0.16s** |
| 厂牌展开过程 | 90ms 处高度已到终值（硬切） | 90ms 处 `grid-template-rows: 105.3px` → 终值 428.6px（逐帧） |
| 厂牌收起 | 立刻 0 | 90ms 处 216px → 500ms 后 0，内层也 0 |
| 收起后不可聚焦 | `inert: false`（只有 `hidden`） | `inert: true`，`btn.focus()` 后 `focusLanded: false` |
| `<details>` 标记 | 原生 `list-style: disclosure-closed`，`::before` 无内容 | `list-style: none`，`::before content: ""`，`transition: transform 0.16s` |
| 标记旋转过程 | 无 | 0° → 30ms 54.7° → 60ms 80.6° → 100ms 86.4° → 90°（`ease-out-expo`） |
| `<details>` 内容出现 | `animation: none` | `detailsReveal` 0.3s（opacity + translateY） |
| 弹层遮罩 | `animation-name: none` | **`backdropEnter` 0.3s** |
| 弹层关闭 | 瞬间 `open=false` | `.is-closing` + `modalExit` 0.16s；关闭中 `open` 仍为 true，动画结束后才 `close()` |
| 列表选中切换 | 列表重建（`nodesReused: false`），高亮瞬切 | 节点复用（`nodesReused: true`），背景 `rgba(0,0,0,0)` → `rgba(255,255,255,0.075)`，标线 `scaleY 0.3 → 1` |
| 复制反馈 | 按钮无变化（`is-copied: false`，文案恒为「复制」） | `is-copied: true`，底色 `rgb(94,226,142)`，文案「已复制」，1.4s 后回到白底「复制」 |
| 「展开全文」 | `transition-property: all` 0s，163px → 444px 瞬跳 | `max-height` 0.3s：175.6 → 406.7 → 464.2 → 480 → 482.8px |
| 术语库表格 | 146 行 / 行高 36px / th 10px / td 11.5px | 146 行 / **行高 40px** / **th 12.5px / td 12.5px**，首包仍 146 行，搜索仍 1/146 |
| 控制台 | 无 pageerror（仅 favicon 404） | **零 pageerror / 零 console.error** |
| `prefers-reduced-motion` | 活动分区 `opacity=1`、`animation: none` | 同上；**新增的** `.provider-panel` 过渡为 `none/0s`、展开瞬间到 `428.6px`、`.btn.is-copied` / 标线 / details 标记全部 `transition: none`，无动画残留 |

### 12.6 测试与类型

| 项 | 结果 |
|---|---|
| `npx tsc --noEmit` | **0 error** |
| `npm test` | **EXIT=0**，13 个套件全绿 |
| `test-options-ui.js` | 303 → **377 通过 / 0 失败**（新增 74 项：字号 12 项、行高/间距 5 项、等宽与表格 9 项、对比度与层次 7 项、溢出防线 6 项、动效 25 项、reduced-motion 10 项；另有 2 条旧断言随实现更新，见下） |
| `test-popup-ui.js` | **49 通过 / 0 失败**（弹窗一行未改） |
| `test-settings.js` | 通过（44 处 assert，未改） |
| `test-ai-track.js` | **104 汇总通过 / 0 失败**（未改） |
| 其余套件 | packs 82 · glossary 68 · segmenter-lang 85 · prompt-layers 94 · parser 67 · retry 59 等，均 0 失败 |

随实现更新的两条旧断言（都是断言本身过期，不是放宽）：

1. `模型行缩进在厂牌面板里` 原来匹配 `margin: 0 0 8px 24px`，面板改成折叠网格后下边距进到内层，改为匹配 `margin: 0 0 0 24px`。
2. `列表支持 ↑↓/Home/End` 原来匹配 `.provider-panel:not([hidden])`，就地切换后 `hidden` 不再是唯一开关，
   改为 `.provider-group.is-open .provider-panel`——否则收起的面板里的模型行也会被方向键走到。

### 12.7 问题清单 / 需要拍板

| # | 事项 | 现状 | 备选 / 代价 |
|---|---|---|---|
| 1 | `--text-muted` 要不要再提亮 | **没动**（保持 `#a1a1aa`，7.68:1，AA 通过） | 改它必须同步 `popup/style.css`（`关键令牌与弹窗完全一致` 断言守着），而弹窗不在本轮允许改动范围。若要做，建议两页一起提到 `#b4b4bb`（约 9.3:1） |
| 2 | `--text-dim` 命名与语义 | 已从「不达 AA 的弱化色」变成「达 AA 的最弱一级」 | 若将来要四级更分明，可再插一档 `--text-faint`（会新增令牌，本轮按纪律没加） |
| 3 | 术语库表格行高 | 40px（要求 ≥34） | 若嫌 146 行太长，可把 `.op-btn` 的 padding 收到 2px、`td` 收到 6px，能压到 ~36px；代价是操作列更好点错 |
| 4 | 厂牌面板展开时页面会不会跳 | 展开会让下方内容下移（原本也如此），只是现在有 300ms 过渡可见 | 若要「不推布局」，得改成 overlay 面板，属于结构变更，不在本轮 |
| 5 | 弹层关闭的 200ms 等待 | `close()` 延后 `--dur-fast` + 40ms | 若觉得关得慢，可只用 `--dur-instant`(90ms)；本轮按「反向动画用 fast」的既有分级 |

### 12.8 没敢改的地方

1. **`--text-muted` 的取值**：见 12.7-1，动了会破令牌一致性。
2. **`index.html` 一行未改**：`.pane-eyebrow` 其实是 `<p>`，字号被 `.pane-head p`（13px）盖掉。
   本轮把那条**永远不生效**的 `font-size: 11.5px` 从 CSS 里删掉（让它老实继承 13px），
   但没有为了「让 eyebrow 更小」去改结构或加 `!important`。
3. **`.provider-advanced[open]` 的 `padding-bottom` 与 `.spec-block[open]` 的 `border-bottom`**：
   「出现/消失」型变化，`padding` 不在允许过渡的属性里。
4. **`.nav-marker` 的高度切换**：仍是瞬变（`height` 不允许过渡；`scaleY` 会压扁 2px 圆头）。
5. **内容脚本 / 弹窗 / background / utils**：按本轮纪律一律未动（`backdrop-filter` 声明数仍为 0）。

---

## 十三、常规页两处折叠 + 整体自适应缩放（任务四 · 需求五 + 六 + 八）

> 改动文件只有 `entrypoints/options/{index.html,main.ts,style.css}`、`test/test-options-ui.js`、
> `docs/UI.md`、`docs/OPTIONS-0.4.0.md`。`utils/*`（含 `packs.ts`）、`popup/*`、`content/*`、
> `background.ts`、`README.md` 一行未动；**没有** commit / tag / push，没有改版本号，没有构建发布产物。

### 13.1 需求五：「翻译服务」从四段控件改为可折叠厂牌选择器

| 项 | 改前 | 改后 |
|---|---|---|
| 结构 | `<div class="seg seg-4" data-seg="service">` + 4 个 `<button data-setting="service" data-value="…">` | `<div class="fold" id="provider-fold">`：一行摘要按钮 + 折叠面板 |
| 覆盖通道 | **硬编码 4 种**（google / deepseek / openai / gemini） | `utils/models.ts#PROVIDERS` 全量 **8 个**（Google 免费 + 7 个厂牌），顺序为「免费在最上 + 声明顺序」 |
| 收起态 | 四段并排，占满整行 | 一行摘要：厂牌图标（`providerIconHtml`）+ 厂牌名 + **当前模型 id（等宽 `.fold-mono`）** + Key 状态小标 + 箭头 |
| 展开态 | — | 8 行通道列表（复用 `.provider-row`：图标 / 名字 / `已配置·未配置 Key` / `N 个模型`），当前项标「使用中」+ 左侧 2px 标线；底部一行细字链接「更多模型与自定义模型 → 服务与模型」 |
| 切换语义 | 改 `service` 一个字段 | 一次写 `providerId + service + modelName（厂牌默认模型）+ apiKey + apiBaseUrl（各取 providerKeys / providerBaseUrls）` |
| 未配置 Key | 无此概念（四段不含 Key） | **允许点**，先完成切换，再 toast「×× 还没保存 Key，去「服务与模型」填写」 |
| 数据源 | HTML 里 4 个写死的按钮 | `PROVIDERS`（只读，未改 `utils/models.ts`）+ `modelRowsFor()` 算模型数（与「服务与模型」逐行一致） |

**只有一份切换实现**：新增 `providerSwitchPatch(providerId)`，原来按协议切换的
`serviceSwitchPatch(target)` 改为 `resolveProviderByService(target)` 后转调它。
两处（常规折叠块 / 服务与模型）不会各长一套「换通道」逻辑。

折叠语义与「服务与模型」的厂牌展开**逐项对齐**：`aria-expanded` 在按钮上、
面板 `hidden`（收起不参与布局）+ `inert`（收起不进 tab 序列）、
`grid-template-rows: 0fr → 1fr` + `opacity` 展开、箭头 `rotate(0 → 90deg)` 只走 `transform`。
展开状态**不持久化**（`let providerFoldOpen = false`），每次进页面收起。

### 13.2 需求六：「翻译场景」改为可折叠（卡片网格原样搬进面板）

- 收起态一行摘要：**当前场景名**（`VTuber 直播`）+ **一句话说明**（取 `hint || description`，
  与卡片上那句同一个取值函数 `sceneHintOf()`）+ **场景总数**（`5 个`）+ 箭头。
- 展开后是**原来那张 `.scenario-grid`**：`grid-template-columns: repeat(auto-fill, minmax(168px, 1fr))`、
  `gap: 8px`、卡片 `padding: 10px 12px` / `radius: 8px` / `.scenario-name 13px` / `.scenario-hint 12px`
  —— 这些声明**一条都没改**，只是给网格套了一层容器内边距（实测值见 13.4）。
- 场景数据仍来自 `getAllScenes(customPacks)`（内置 + 自定义全列），本轮**没有**扩大范围。
- 展开状态不持久化、不新增设置项（`let scenarioFoldOpen = false`）。
- 折叠的意义是「场景变多时不占满首屏」：收起后这个分区只占 44px 一行。

### 13.3 需求八：整体自适应缩放

**宽度**（新增 `:root` 令牌，没有第二条自定义属性来源）：

| 令牌 | 取值 | 用途 |
|---|---|---|
| `--nav-width` | `250px → **218px**` | 侧栏宽度（需求给的 218） |
| `--content-max` | **`1100px`** | 主内容上限；`.pane` 用它 + `margin: 0 auto` 居中 |
| `--pad-pane` | `clamp(20px, 1.6vw + 12px, 34px)` | 分区内边距 |

**字号**（只动基准 + 5 个关键尺寸，其余 px 一律保留）：

| 令牌 | clamp | 下限 = 改前值？ |
|---|---|---|
| `--font-base` | `clamp(14px, 0.18vw + 13.2px, 16px)` | 14（**地板，不许回退**） |
| `--font-h1` | `clamp(21px, 0.3vw + 19.4px, 25px)` | 21（改前 22，仅下限放宽 1px，仍 > 行标题 +5） |
| `--font-title` | `clamp(14px, 0.16vw + 13.3px, 16.5px)` | 14 = 改前 |
| `--font-lead` | `clamp(13px, 0.14vw + 12.3px, 15px)` | 13 = 改前 |
| `--font-desc` | `clamp(12.5px, 0.12vw + 11.9px, 14px)` | 12.5 = 改前 |
| `--font-note` | `clamp(12px, 0.1vw + 11.5px, 13.5px)` | 12 = 改前 |

**三档断点**：

| 档 | 条件 | 侧栏 | 主区 |
|---|---|---|---|
| 1 | ≥1280（默认规则） | 218px，竖排 sticky | `1fr` 自适应，`.pane` 上限 1100 + 居中 |
| 2 | 1024–1279 | **180px** | `.panes { min-width: 720px }`，实测 844 |
| 3 | ≤1023（含要求的 768–1023） | 顶部**横向滚动页签**（`flex-direction: row` + `overflow-x: auto`，`position: static`） | 单列铺满（`max-width: none`），两栏工作区降为 `1fr` |

≤880 的既有收紧（`.row` 竖排、滑块满宽、模型工具条竖排）原样保留，没有并进 1023 档。

**不用 `transform: scale()`**：没有整体缩放，只有布局与字号的流体化（测试断着
`.shell/.panes/.pane/.rows/.row` 上不出现 `transform: scale`）。

### 13.4 五档实测（真 Chrome headless + esbuild IIFE + chrome 桩，`file://` 直连仓库 CSS）

| 宽度 | `scrollWidth-clientWidth` | 侧栏形态 / 实宽 | 主区实宽 | `.pane` max-width | `body` 字号 |
|---|---|---|---|---|---|
| 1920 | **0** | 竖排 sticky / 218 | 1702 | 1100（**生效**，内容 1100） | **16px** |
| 1440 | **0** | 竖排 sticky / 218 | 1222 | 1100（**生效**，内容 1100） | 15.792px |
| 1280 | **0** | 竖排 sticky / 218 | 1062 | 1100（未触及，内容 1062） | 15.504px |
| 1024 | **0** | 竖排 sticky / **180** | **844**（min 720） | 1100（未触及） | 15.0432px |
| 800 | **0** | **顶部页签** `row` / static / `overflow-x:auto`，高 57 | 800 | `none` | **14.64px** |

流体字号另两个观测点：`.row-title` 16.372 / 15.604 / 15.348 / 14.9384 / **14.58**px，
`.row-desc` 14 / 13.628 / 13.436 / 13.1288 / **12.86**px（1920 → 800 单调递减，无回退）。

8 个分区 × 5 档 = 40 格，`scrollWidth - clientWidth` **全为 0**，零 pageerror / 零 console.error。
术语库首包仍 **146 行**，搜索 `hololive` → **9 / 146 条**（布局改动没有影响表格渲染）。

折叠块实测（1440）：

| 项 | 收起 | 展开 |
|---|---|---|
| `aria-expanded` | `false` | `true` |
| 面板 `hidden` / `inert` | `true` / `true`，高度 **0** | `false` / `false`，高度 **368** |
| 箭头 `transform` | `matrix(1,0,0,1,0,0)`（0°） | `matrix(0,1,-1,0,0,0)`（90°） |
| 摘要 | `DeepSeek` + `deepseek-flash`（等宽）+ `已配置 Key` + 图标 SVG | 摘要不变 |
| 通道行 | — | **8 行，行高全为 40px**，8 个厂牌图标（Google 走字母兜底 G），当前项 `deepseek` 带「使用中」+ 标线 |
| 场景折叠 | 摘要 `VTuber 直播` / `例：hololive 直播回放、游戏实况切片` / `5 个` | 5 张卡、**5 列**、卡高全为 **79px**、`padding 10px 12px` / `radius 8px` / `name 13px` / `hint 12px` / `gap 8px` |

点选写回（读 `chrome.storage` 两处：设置在 `sync`、Key 在 `local` 的 `yt_sub_translator_secrets`）：

| 操作 | providerId | service | modelName | apiKey | apiBaseUrl |
|---|---|---|---|---|---|
| 起始 | deepseek | deepseek | deepseek-flash | sk-deepseek-1111 | `https://api.deepseek.com/v1` |
| 点 Claude（已配置） | **claude** | **openai** | **claude-sonnet-5-5** | **sk-ant-2222** | **`https://api.anthropic.com/v1`** |
| 点 Kimi（未配置） | **kimi** | **openai** | **kimi-k2.6** | —（toast 提示去填） | **`https://api.moonshot.cn/v1`** |

点 Kimi 后 toast = 「Moonshot Kimi 还没保存 Key，去「服务与模型」填写」，摘要同步变成
`Moonshot Kimi / kimi-k2.6 / 未配置 Key`，折叠块同时收起；「服务与模型」那行
`当前使用：Moonshot Kimi · kimi-k2.6` 也一起变了（同一份 store）。
「更多模型与自定义模型 → 服务与模型」点后 `pane-service` 激活、导航切到 `service`、折叠块收起。

`prefers-reduced-motion: reduce` 下：面板 `transition-property: none / 0s`、展开瞬间
`opacity=1`、高度直接 368（不卡 0fr），8 行仍等高 40px。

### 13.5 测试与类型

| 项 | 结果 |
|---|---|
| `npx tsc --noEmit` | **0 error** |
| `npm test` | **EXIT=0**，13 个套件全绿 |
| `test/test-options-ui.js` | 377 → **435 通过 / 0 失败**（+58：需求五 26 项、需求六 10 项、需求八 22 项） |
| `test/test-popup-ui.js` | **49 通过 / 0 失败**（弹窗一行未改） |
| 其余套件 | settings / packs 114 / glossary 68 / segmenter-lang 85 / prompt-layers 94 / parser 67 / retry 59 / ai-track 104，均 0 失败 |

**旧断言改动清单（只有 1 处，改的是取值助手，没有改任何断言的语义或阈值）**：

1. `fontOf()` / `bodyFont` 原来只认 `font-size: <数字>px`。本轮基准与 5 个关键尺寸改成了
   `font-size: var(--font-…)` → `:root` 里的 `clamp(...)`，原助手取不到值会返回 `NaN`，
   使 6 条既有的可读性断言（基准 14 / 行标题 13.5–14 / 说明 12.5 / 辅注 ≥12 /
   `.pane-head p` ≥12 / h1 > 行标题 +5）全部误报。
   改法：新增 `fontPx()`——先把 `var(--令牌)` 解析到 `:root` 取值，再取 `clamp()` 的**下限**。
   下限正是这 6 条断言真正要守的「窄窗口可读性地板」，阈值一个没动，改后 6 条全部通过。
   （顺带修掉一个早就存在的隐患：`body` 曾用 `/\nbody\s*\{[^}]*\}/` 取块，会先撞上
   `html, body { min-height }` 那条合写，现改为「取第一条带 `font-size` 的 body 规则」。）

### 13.6 问题清单 / 需要拍板

| # | 事项 | 现状 | 备选 / 代价 |
|---|---|---|---|
| 1 | 侧栏 250 → 218 | **已按需求改成 218**（`--nav-width`）。需求正文写「侧栏固定 218px」，但改前代码是 **250px**；`218px` 其实是 `.gloss-layout` 左栏的宽度 | 若觉得导航变挤，可回到 240；代价是主区上限得一起降 |
| 2 | 需求写的「主区上限 760~800px」 | 改前实际是 **860px**（`.pane max-width`） | 口径以代码为准，本轮按需求取 1100 |
| 3 | 1920 下右侧仍留 301px | `.pane` 1100 + 居中；左侧含侧栏 218，视觉上左右不完全对称 | 若要严格对称，得让内容在**整窗**居中（侧栏浮起来），属结构变更 |
| 4 | 1024–1279 档左栏仍是 218 | `.gloss-layout` 没有跟着收窄，详情区只剩约 542 | 可改成 `minmax(180px, 218px)`；但会动测试里「两栏栅格与 .gloss-layout 同一条规则」的既有匹配串，本轮按纪律没改 |
| 5 | `.row` 行距仍固定 17px | 需求说「间距」可流体化，但既有断言按 `padding: <数字>px` 解析（16–18） | 要流体化需同时改断言，收益很小，本轮不动 |
| 6 | `.navitem-label` 在 1024–1279 固定 13px | 只在档 2 写了固定值，没做 clamp | 可换成 `--font-note` 一类；怕 180px 侧栏里文字换行，先固定 |
| 7 | <768 未定义 | 档 3 一路到最窄都是顶部横向滚动页签 | 若要手机级体验，需要汉堡/抽屉导航，属新结构 |
| 8 | 展开折叠块会推布局 | 与厂牌面板同一取舍（300ms 可见） | 要「不推布局」得改成 overlay |
| 9 | 弹窗未同步这轮字号 | 弹窗仍是固定 px（本轮不允许改 `popup/*`） | 两页字号口径将出现差异：设置页 14→16 流体，弹窗 14 固定。若要对齐，需单独一轮动弹窗 |

---

## 十四、需求 7 收尾：参考模型只是参考 + 厂牌内真实翻译测速

> 本节是任务四需求 7 的最终口径，取代 §六「测试连接走 `/models`」与 §10.2 / §10.3 里
> 「在线列表并入预设」「连通性测试单独一行」的旧描述。清单怎么维护见
> **`docs/PROVIDER-MODELS.md`**，两处是同一套说法，不要各写一套。
> 本轮只改 `test/test-options-ui.js` 与两份文档；`utils/*`、弹窗、内容脚本、background 未动，
> 没有改版本号、没有构建发布产物、没有 commit / tag / push。

### 14.1 预设清单是「参考」，不是「权威」

> ⚠️ **口径已再次收紧（v0.4.2 修复轮）**：本节描述的「参考清单按实际列表裁剪」已被
> **§16.1** 取代 —— 参考清单**彻底退出 UI 列表**（一个字都不渲染），模型行只剩
> 实际列表 ∪ 自定义 ∪ 当前在用。下面这段保留作为演进记录，实现以 §16.1 为准。

`utils/models.ts#PROVIDERS` 是按各家官网抄的一份清单，厂商下线 / 改名之后，它就会变成
一堆「点一下就 404」的型号。所以：**一旦真的「获取模型」拉到过某个厂牌的实际列表
（`cached_models_<providerId>` 非空），界面以实际列表为准** —— 参考清单里不在实际列表中的
型号一律不渲染，列表 = 实际列表 ∪ 自定义模型，按 id 去重；被裁掉的条数会在列表末尾
写一句「参考清单里有 N 个型号不在实际列表中，已隐藏。」，不静默吞掉。

隐藏规则的四个边界（都由 `test-options-ui.js` 把 `main.ts` 的真实源码切片转译后执行验证，
不是照注释重写一份逻辑）：

| # | 边界 | 行为 |
| --- | --- | --- |
| 1 | 有缓存且命中实际列表 | 该参考型号照常渲染，且按 id 去重只出现一次 |
| 2 | 有缓存但未命中 | 该参考型号隐藏；在线列表里的新型号正常出现 |
| 3 | 无缓存（从没拉过） | 全部参考模型照常显示，`hiddenReferenceCount = 0` |
| 4 | 缓存为 `[]` | 与「无缓存」同等对待，**不清空**参考清单（接口抽风一次不该让列表变空） |

另有两条例外，都不受隐藏规则影响：

- **当前使用中的型号**：即使不在实际列表里也要显示，补在最前面并标
  「当前设置 · 未在列表」；没拉过实际列表时仍标「自定义 / 已下架」。
  否则用户会看不到自己正在用的是什么。
- **自定义模型**：由用户自己维护，始终渲染；只有 id 与实际列表重复时才去重，
  别厂牌的条目不会串进来。

厂牌行上的「· N 个模型」直接取 `modelRowsFor()` 的同一份 `rows.length`，
与展开面板里实际渲染的行数必然一致。

### 14.2 「测试连通性」搬进厂牌面板：一句样例真实翻译一次

| 项 | 口径 |
| --- | --- |
| 位置 | 每个厂牌展开面板底部的工具条（与「获取模型」「＋ 自定义模型」并列），按钮 id `btn-test-provider-<厂牌>`；服务分区原来那一行全局测试按钮与 `#btn-test-service` / `#service-latency` / `#service-test-desc` 已删除 |
| 测试对象 | 该厂牌下**实际渲染**的每个模型（含自定义模型），不含被隐藏的参考型号 |
| 测法 | `TRANSLATE_BATCH` + 一句英文样例 + `noFallback: true` + `bypassCache: true`，量真实翻译往返耗时 |
| 不走 | **不再用 `/models` 列表测速**：中转站不一定实现该端点，量到的也不是翻译耗时 |
| 串行 | 一个测完再测下一个（并发会把限流与网络抖动搅在一起）；`runToken` 失效保护让被新测试取代的旧循环停手 |
| 超时 | 15s 没回调按失败处理，按钮不会一直停在「测试中」 |
| 不落盘 | 请求只用 `latencyQueryFor()` 造的临时 settings（展开当前设置、只换 `modelName`）；不调 `update()` / `saveStoredSettings()`，结果只存在内存 `latencyResults` 里，`providerId` / `modelName` / `apiKey` 一个字节都不动 |

### 14.3 延迟显示在哪、怎么分档

延迟徽标挂在**模型名后面**（`.model-tail` 内、「使用中」之前），重绘后由内存结果补回。
成功显示 `${ms} ms`，按与弹窗一致的三档着色：

| 往返耗时 | 标记 | CSS 类 |
| --- | --- | --- |
| < 600ms | 极速 | `.is-fast` |
| 600 ~ <1800ms | 良好 | `.is-medium` |
| ≥ 1800ms | 较慢 | `.is-slow` |
| 失败 / 超时 | **失败** | `.is-error` |

失败那条不显示毫秒数，直接写「失败」，`title` / `aria-label` 里保留原因。

### 14.4 验证（本轮）

| 项 | 结果 |
| --- | --- |
| `test-options-ui.js` | 433 通过 / 2 失败 → **480 通过 / 0 失败**（改 2 条过期断言 + 新增 45 条，通过数只增不减） |
| 两条旧断言 | 「连通性测试仍在服务分区」改为「降级开关 / ASR 仍在服务分区 + 测试按钮已迁入厂牌面板 + 旧 id 已删除」；「在线列表与预设并入」改为「参考模型只是参考，有实际列表时按实际列表隐藏」，并补一条守「并入 / 去重 / 空数组不清空」 |
| 新增断言 | 隐藏四分支、当前使用中型号例外、自定义模型、厂牌计数三档、按钮位置、测速口径、串行 / 15s / 不落盘、徽标位置与 600/1800 阈值 |
| `npm test` | **EXIT=0**，13 个套件全绿 |
| `npx tsc --noEmit` | **0 error** |
| `test-popup-ui.js` / `test-packs.js` / `test-ai-track.js` | 49 / 114 / 104（均未改动） |
| 端到端 | esbuild 打包 `main.ts` 为 IIFE + `chrome` 桩（拦截 `TRANSLATE_BATCH` 按模型名返回不同延迟并制造一次失败），真 Chrome headless 七条实测见 §14.5 |

> **版本自检说明**：§13.5 的「435 通过 / 0 失败 / EXIT=0」是上一轮（需求五 + 六 + 八）交付时的
> 快照；本轮开工时实测基线是 **433 通过 / 2 失败、EXIT=1**（需求 7 代码已落地、断言口径没跟上），
> 现已修复为 480 / 0。仓库 tag / 包版本仍是 **v0.4.1 / 0.4.1**，本轮不改版本号、不构建产物。

### 14.5 端到端实测（真 Chrome headless，夹具在 `D:\edge\_ui\req7\`，不进仓库）

`esbuild` 把 `entrypoints/options/main.ts` 打成 IIFE（224105 B）+ `chrome` 桩：桩拦截
`TRANSLATE_BATCH`，按模型名返回 60 / 700 / 1900ms 三档延迟，并让 `e2e-fail` 失败一次；
`chrome.storage.sync` / `local` 是两个独立内存对象，`set` 会触发 `onChanged`。
起 127.0.0.1 静态服务后用 `puppeteer-core` 连真 Chrome headless。服务分区默认
`display:none`，实测前先点 `#nav-service` 激活，按钮几何 89×32、`disabled=false`、
面板 `hidden=false / inert=false`，再用 **Puppeteer 原生鼠标点击**（不是 DOM `.click()` 兜底）。
**7/7 通过，零 pageerror、零 console error**。

| # | 场景 | 实测输出 |
| --- | --- | --- |
| a | 有获取缓存且不含某参考型号 | 缓存 `[deepseek-flash]` → 渲染行只剩 `["deepseek-flash"]`，`deepseek-v4-pro` 不渲染；厂牌计数「· 1 个模型」；提示「参考清单里有 1 个型号不在实际列表中，已隐藏。」 |
| b | 当前使用中型号不在实际列表 | `modelName=legacy-in-use` + 实际列表 4 项 → 渲染 `["legacy-in-use","deepseek-flash","e2e-medium","e2e-slow","e2e-fail"]`，首行文本「当前设置：legacy-in-use…当前设置 · 未在列表…使用中」 |
| c | 无缓存 / 缓存为 `[]` | 无缓存 → `["deepseek-flash","deepseek-v4-pro"]`；缓存 `[]` → 同样两行；两档的隐藏提示都为空（参考清单没被清空） |
| d | 厂牌行计数 vs 实际行数（三档） | 无缓存「· 2 个模型」/ 2 行；有实际列表「· 4 个模型」/ 4 行；缓存 `[]`「· 2 个模型」/ 2 行，三档全等 |
| e | 点「测试连通性」 | 4 行 → **4 次** `TRANSLATE_BATCH`，每次 `texts` 都是 1 句样例且 `noFallback=true` / `bypassCache=true`；时间轴 2930→2991→3693→5595→5636ms，后者 `start ≥ 前者 end`（串行无重叠）；徽标 `61 ms / is-fast`、`701 ms / is-medium`、`1902 ms / is-slow`、`失败 / is-error`；4 行全部有徽标，按钮回到「测试连通性」 |
| f | 测试前后设置快照 | `providerId=deepseek`、`modelName=deepseek-flash`、`apiKey=sk-e2e-deepseek`、`providerKeys={"deepseek":"sk-e2e-deepseek"}` 前后全等；测试期间 `chrome.storage.set` 调用数 **0** |
| g | 翻译通道无旧按钮 | `#btn-test-service` 不存在、常规页折叠列表无该 id、服务分区内没有「连通性」标题行（`serviceRowsWithTest=0`） |

### 14.6 问题清单

1. **端到端点按钮要先切到服务分区**：分区默认 `display:none`，headless 下按钮 rect 为 0 会被
   Puppeteer 判为不可点击。夹具先激活 `#nav-service` 再用原生点击，属夹具处理，不是页面缺陷。
2. **`/models` 字样仍出现在说明性注释里**（`index.html` 第 249 行、`main.ts` 的连通性注释），
   文案是「不再用 /models 列表测速」，不是把 `/models` 当测速实现；静态断言守的是
   「测速链路里不出现该端点 / `FETCH_MODELS`」，没有误伤说明文字。
3. **§13.5 的 435 / 0 是上一轮快照**：本轮没有改写历史章节，改在 §14.4 里如实标注
   开工基线 433 / 2 与本轮 480 / 0。
4. 弹窗、内容脚本、`utils/*`、background、版本号、发布产物**一行未动**；夹具全在
   `D:\edge\_ui\req7\`，没有进仓库，没有 commit / tag / push。

---

## 十五、设置页承接弹窗配置（任务四 · 需求一 · 收尾）——**已回退**

> ⚠️ **本节整节已回退**（v0.4.2 回退轮）：这里记录的是「把弹窗精简成遥控器、配置全部搬到
> 设置页」的方案，该方案**已被撤回**——弹窗整体 `git checkout HEAD --` 回到 tag `v0.4.1`
> 的完整配置版。**原文全部保留作为历史记录**，不要按本节描述去「恢复」弹窗精简。
> 回退后的实际状态见 **§15.7**。
>
> 唯一仍然有效的是 **§15.1 的 `glossaryEnabled` 部分**（设置页不回退，该开关仍在）。

> 基线 tag `v0.4.1` / 包版本 `0.4.1`（本轮不改版本号）。开工实测
> `npm test` EXIT=0，`test-options-ui.js` **480 / 0**、`test-popup-ui.js` **49 / 0**。
> 本轮把弹窗精简为「仅选择 + 测试连通性」，设置页成为**唯一工作台**；
> 完整职责切分、共有项清单与移除清单见 `docs/UI.md` §十，本节只登记设置页侧。

### 15.1 两项设置的位置与口径

| 字段 | 本轮动作 | 落位 | 控件 | 默认值来源 |
|---|---|---|---|---|
| `glossaryEnabled` | **新增控件** | 术语库分区 `.rows` 最上方（「专有名词括注原文」之前） | `.switch` + `data-setting="glossaryEnabled"` | `types/index.ts#DEFAULT_SETTINGS.glossaryEnabled = true` |
| `mergeShortFragments` | **复核已有，未重复添加** | 断句引擎分区（「智能标点修补」之后） | `.switch` + `data-setting="mergeShortFragments"` | `DEFAULT_SETTINGS.mergeShortFragments = true` |

- **文案**：「注入术语库」+ 说明「关闭后所有已选术语库都不再注入，但包与条目保留。」
  + 辅注「与快捷面板的「注入术语库」是同一份设置，改动会双向同步。」
- **为什么用开关**：两项都是布尔语义，与同分区「短碎片合并」「智能标点修补」
  同一套 `.switch` 形态，不必引入分段控件。
- **零控件专属代码**：两项都是普通 `data-setting`，走 `bindControls()` /
  `reflectSettings()` / `update()` 的通用通路，`options/main.ts` 一行未改。
- **默认值只有一份**：页面里没有 `?? true` 之类的兜底；`sanitizeSettings` 用
  `!== false` 清洗，非法值回落 `true`。`resetSettings` 仍直接展开 `DEFAULT_SETTINGS`。

### 15.2 双向同步（实测）

弹窗侧新增 `chrome.storage.onChanged` 监听，设置键变化即 `GET_SETTINGS` 回读并重绘；
设置页原有的 `onChanged → getStoredSettings → reflectSettings` 链路不变。
弹窗改为只发**变化字段的 patch**（`SAVE_SETTINGS` payload 不再是整份
`currentSettings`），因此工作台里的 `providerKeys` / `customModels` /
`aiCacheTtlHours` 等高级字段不会被弹窗保存时冲掉。
收紧项：`options/main.ts` 的存储键守卫仍只有一处，`popup/main.ts` 不出现
`yt_sub_translator_settings` 字面量（用前缀过滤），「数据只有一份」红线保持。

### 15.3 盘点偏差（已在 `docs/UI.md` §10.5 登记）

任务里写的 `mergeFragments` 实际字段名是 **`mergeShortFragments`**，
且设置页断句引擎分区**早已有**对应控件与测试断言；搜 `mergeFragments` 搜不到
只是名字不同。本轮不重复加控件，只补断言与文档。真正缺的只有 `glossaryEnabled`。

### 15.4 端到端五条实测（真 Chrome headless）

夹具在 `D:\edge\_ui\req1\`（不进仓库）：esbuild 把 `popup/main.ts`（91,703 B）
与 `options/main.ts`（224,525 B）分别打成 IIFE，注入 `chrome` 桩
（`sync` / `local` 两个独立内存对象、跨标签页 `storage` 事件、`TRANSLATE_BATCH`
桩返回 120ms 译文），起 127.0.0.1 静态服务后用 `puppeteer-core` 连
`C:\Program Files\Google\Chrome\Application\chrome.exe`。两个页面放在同一个
`BrowserContext` 并关闭后台节流，否则 headless 会冻结后台标签导致同步不到。
**5/5 通过，零 pageerror、零 console error。**

| # | 场景 | 实测输出 |
|---|---|---|
| a | 弹窗选择 → 落盘 → 设置页刷新同值 | 弹窗依次切 `targetLang=ja` / 厂牌 `openai` / 模型 `gpt-6-luna` / 场景 `science`；`sync.settings` = `{targetLang:'ja', providerId:'openai', service:'openai', modelName:'gpt-6-luna', scenario:'science'}`；设置页显示 `targetLang='ja'`、折叠摘要 `OpenAI / gpt-6-luna`、场景名 `科普视频` |
| b | 设置页改两项 → 弹窗同步 | 设置页把 `mergeShortFragments` / `glossaryEnabled` 都点成 `false` → `sync.settings` 两项均为 `false`；弹窗 `storageEvents=2`、`GET_SETTINGS` 调用 1→3、`#glossary-enabled.checked` 由 `true` → **`false`**；两项默认值均为 `true`（`DEFAULT_SETTINGS`），确认读写同一字段 |
| c | 点「测试连接与延迟」 | 消息类型只有 `TRANSLATE_BATCH`（`FETCH_MODELS` 0 次），`texts` 恰好 1 句样例、`noFallback=true`、`bypassCache=true`；徽标 `121 ms / latency-fast`，状态行 `连通正常 (OpenAI [gpt-6-luna]) · 耗时 121ms` |
| d | 配置项不存在 / 测试按钮可见 | 20 个被移除 id（`api-key` / `btn-fetch-models` / `pause-threshold` / `trans-color-input` / `font-size` / `btn-upload-scene` …）全部 `null`；`#btn-test-api` 存在、`121×37`、`disabled=false` |
| e | 两档宽度 × 两页 | 归一化溢出 `popup@400 / popup@1280 / options@400 / options@1280` 全为 **0**（弹窗原始差值 -5，见 `docs/UI.md` §10.6）；零 pageerror |

截图：`D:\edge\_ui\req1\popup-400.png`、`options-1280.png`，另复制一份到
`D:\edge\_ui\req1-popup-400.png` / `D:\edge\_ui\req1-options-1280.png`。

### 15.5 测试与断言改动

| 项 | 改前 | 改后 |
|---|---|---|
| `npm test` | EXIT=0 | **EXIT=0**（13 套件全绿） |
| `npx tsc --noEmit` | 0 error | **0 error** |
| `test-popup-ui.js` | 49 / 0 | **114 / 0**（保留 46 条、改 3 条口径、新增 65 条） |
| `test-options-ui.js` | 480 / 0 | **491 / 0**（改 4 条过期口径、新增 11 条） |

**`test-popup-ui.js` 改掉的 3 条旧断言**（都是断言本身过期，不是放宽）：
1. 「四个页签均为 role=tab」→「两个页签均为 role=tab」（4 → 2，页签收敛是需求）。
2. 「面板为 role=tabpanel 4 个」→「两个面板均为 role=tabpanel」。
3. 「折叠态收起上传规范与预览块」→「折叠态收起列表之外的辅助块」：
   上传规范 / 预览 DOM 已从弹窗移除，改由新断言「被移除的配置项 id 全部不存在」守着。

**新增 65 条**分六组：保留选择项清单（14）、被移除项不存在（7，含 `persistSettings`
字段集合与 patch 口径）、测试连通性口径（11）、厂牌 8 通道（8）、模型 / 场景口径（10）、
视觉口径与两处共有 key 集合（15）。没有靠删断言凑绿：原 49 条里 46 条原样保留。

**`test-options-ui.js` 改掉的 4 条旧断言**：
1. 「弹窗与设置页读写同一个缓存键」→「弹窗不再读写在线模型缓存（清单改由 PROVIDERS 分组）」。
2. 「PRESET_MODELS 条目带 name（弹窗直接展示）」→ 文案改为「兼容仍按 service 读清单的调用方」（断言不变）。
3. 「弹窗仍按 service 读预设与缓存键」→「弹窗按厂牌分组读 PROVIDERS（不再把 5 家 OpenAI 兼容厂牌混进一个 openai 组）」。
4. 「缓存键模板只有一份（弹窗按 service）」→ 文案改为「现只服务设置页的厂牌内拉取」（断言不变）。
另把「两项都走 onChanged 同步链」的正则窗口 400 → 900 字符（函数体注释变长，非放宽语义）。

### 15.6 问题清单 / 需要拍板

1. **`mergeShortFragments` 是否还要在弹窗留一个开关**：本轮按「弹窗仅用于选择」移除了
   断句页，也就不显示它；设置页保留。若希望弹窗也能快速切，需要重新加回一个选择类开关。
2. **弹窗页签是否进一步收敛到 1 个**：当前留 2 个（翻译选择 / 场景与术语库），
   为的是保住 tablist 方向键 / Home / End 无障碍与折叠分区。若要单页，需重写这批断言。
3. **`glossaryPacks` 的包级启用仍不在设置页**：启用走弹窗的包勾选（既有设计，
   见 §9.5-6）；本轮未扩大范围。若要「工作台全包办」，需给设置页术语库包列表加启用开关。
4. **`--text-dim` 是唯一动过的 `:root` 令牌**：把弹窗 `#71717a` 对齐到设置页已有的
   `#82828c`，另一侧本就是该值，令牌一致性测试通过。若不想动任何 `:root`，可回退这一行。
5. **资料库「任务四」文档仍是 v0.4.0 历史快照**（顶部写基线 0.4.0、断言 28 / 40、7 分区），
   与仓库 v0.4.1 / 480→491 / 8 分区不一致；本轮按用户给定口径执行，未改资料库文档。

---

## 15.7 回退后的实际状态（v0.4.2 回退轮）

### 15.7.1 回退了什么

`entrypoints/popup/{index.html,main.ts,style.css}` 三个文件整体回到 tag `v0.4.1`：

- 弹窗恢复 **4 个页签**（通用与翻译 / 术语与场景 / 断句引擎 / 样式排版），平铺展开；
- 回到弹窗的控件：`#api-key`、`#btn-toggle-key`、`#api-base-url`、`#btn-fetch-models`、
  `#model-select`、`#model-name`、4 个断句滑块、`#segmentation-language`、`#auto-punctuation`、
  `#merge-fragments`、4 个取色器与色块、`#font-size`、`#bg-opacity`、`#display-mode`、
  `#layout-order`、`#btn-upload-scene`、`#btn-upload-glossary`、`#auto-fallback-toggle`、
  `#auto-hide-native`、`#btn-test-api`、实时预览块；
- **撤销的精简行为**：2 页签收敛、`popupProviderSwitchPatch()`、按厂牌 `<optgroup>` 分组、
  `cachedModelsKey` 复用、只发变化字段的 patch、`storage.onChanged` 回读
  （`reloadFromStorage()`）、「复杂配置请到详细设置」之类遥控器文案。

### 15.7.2 设置页这几项不受影响（本轮不回退）

| 项 | 状态 |
|---|---|
| 8 分区信息架构 | 不变（常规 / 服务与模型 / 术语库 / 断句引擎 / 字幕样式 / 同步与缓存 / 翻译场景 / 关于） |
| 厂牌 **8 通道** | 不变，`PROVIDERS.length === 8`，仍 `for (const provider of PROVIDERS)` 渲染；弹窗那条 `PRESET_MODELS[service]` 路径与它无关 |
| `glossaryEnabled` 开关 | **保留**（§15.1 那项），`data-setting="glossaryEnabled"`，默认 `true`，与弹窗 `#glossary-enabled` 同字段 |
| 翻译场景 5 个内置场景 | 不变；提示词本轮已在 `utils/packs.ts` 补齐 |
| Key 只落 local | 不变（§11.3）；弹窗保存也走同一条 `writeSecrets` |
| `:root { color-scheme: dark }` | 设置页保留；弹窗随回退丢失（弹窗只剩 `.form-select option` 兜底） |
| 断点 / 缩放 / 过渡 / 可读性 | 不变（§12 / §13） |

### 15.7.3 回退后口径变了的三件事

1. **同步方向**：弹窗不再监听 `onChanged`，链路变成「弹窗写 → 设置页刷新」单向；
   「设置页改 → 弹窗立刻变」不成立，需重开弹窗（重开时 `GET_SETTINGS` 重新拉取）。
2. **payload 从 patch 回到整份**：弹窗发整份 `currentSettings`（`SAVE_SETTINGS`）。
   工作台高级字段（`providerId` / `providerKeys` / `providerBaseUrls` / `customModels` /
   `glossaryAnnotation` / `asrCorrection` / `aiCacheTtlHours` / `aiResumeMode`）之所以
   不会被冲掉，靠的是 `utils/storage.ts#saveStoredSettings` 的
   `sanitizeSettings({ ...current, ...newSettings })` 合并语义——弹窗对象里没写这些键，
   `current` 就会把它们原样带过去。
3. **模型清单两份**：设置页按厂牌读 `utils/models.ts#PROVIDERS`；弹窗回到自带的
   `PRESET_MODELS`（按 `service`，一次列一家，无 `optgroup`），且**仍含已下架型号**
   （`gpt-4o-mini` / `gemini-1.5-flash` / `gemini-1.5-pro` / `gemini-2.0-flash-exp` /
   `claude-sonnet-4-6`）。断言只要求两边 `service` 键集合一致（deepseek / openai / gemini）。

### 15.7.4 `test-options-ui.js` 的 8 条断言已按回退后的真实行为改写

| # | 原口径（精简版） | 新口径（回退后） | 为什么 |
|---|---|---|---|
| 1 | 预设清单只在 `utils/models.ts` 定义一份（弹窗不许有 `const PRESET_MODELS`） | 设置页只此一份权威；弹窗有自带兜底副本，断言改为**两边 `service` 键集合必须相等** | 弹窗自带一份是 v0.4.1 的既成事实；键集合对齐才能真正防住「设置页能选、弹窗选不到」 |
| 2 | 两个入口都从 `utils/models` 取预设 | 设置页从 `utils/models` 取；弹窗**不再 import**（如实登记） | 弹窗没有这个 import 了，硬留必红 |
| 3 | 缓存键只在 `utils/models` 生成（含弹窗） | `cachedModelsKey()` 一份 + 弹窗内联 `` `cached_models_${service}` `` 同一模板，并实算 `cachedModelsKey('service') === 'cached_models_service'` | 模板必须同名，否则老缓存失效；断言模板等价而不是断言「弹窗不许写」 |
| 4 | 弹窗不再读写在线模型缓存（清单改由 PROVIDERS 分组） | 弹窗**会**读写 `cached_models_<service>`（`storage.local.get` + `set` 两条路径都断言） | 回退后弹窗就是靠这条缓存键工作 |
| 5 | 弹窗 `:root` 补上 `color-scheme: dark` | 设置页有 `color-scheme: dark`、弹窗**没有**（只剩 `.form-select option` 兜底），登记为已知缺口 | 回退把弹窗那条带走了；不允许改弹窗 `style.css` 补回 |
| 6 | 弹窗按厂牌分组读 `PROVIDERS`（`optgroup`、禁 `PRESET_MODELS[service]`） | 弹窗**按 `service`** 读 `PRESET_MODELS`，且不再出现 `PROVIDERS` / `optgroup` | 回退后的真实实现 |
| 7 | 弹窗侧也监听 `onChanged` 并回读（双向） | 设置页监听 `onChanged`、弹窗**不**监听且无 `reloadFromStorage()` → 同步为单向 | 回退后的真实实现；单向是已知代价，不假装双向 |
| 8 | 弹窗 `persistSettings` 只写选择类字段（6 个 key） | 弹窗 `persistSettings` 发**整份 settings**：断言 payload 必含 20 个配置类字段且 key 数 ≥ 20 | 回退后配置类字段全在 payload 里，6 key 的 patch 口径已不成立 |

另**新增 2 条**（本轮加）：设置页仍是厂牌 8 通道（不受弹窗回退影响）、
`glossaryEnabled` 在设置页仍存在（设置页不回退）。

### 15.7.5 回退轮验证

| 项 | 结果 |
|---|---|
| `npm test` | **EXIT=0**，13 套件全绿（`test-popup-ui.js` 28 → **32**、`test-options-ui.js` **493**） |
| `npx tsc --noEmit` | **0 error** |
| `npm run build:chrome` / `build:edge` | 均 EXIT=0；`.output/{chrome,edge}-mv3/manifest.json` 版本 **0.4.2** |
| 弹窗渲染（4 页签截图） | 零 pageerror、`scrollWidth-clientWidth` 全为 **-5**（无正向溢出），见 `docs/UI.md` §10.7 |

## 15.8 弹窗「选项」与设置页同步（v0.4.2 本轮）

> 用户原话：「简化虽然去了，但选项同步添加上」。上一轮的「弹窗精简」**不恢复**，
> 本轮只把**选项**对齐：通道数 / 模型清单 / Key 与端点归属。**实时双向同步不开**。

### 15.8.1 弹窗侧的口径（`entrypoints/popup/`）

| 项 | 改前（v0.4.1 回退形态） | 改后 |
|---|---|---|
| 通道数 | `index.html` 里 4 个硬编码 `<option>`（google / deepseek / openai / gemini） | `renderServiceOptions()` 从 `PROVIDERS` 生成 **8 项**，`value = provider.id`，首项 `google-free`；HTML 只剩空 `<select>` |
| 模型清单 | 弹窗自带 `PRESET_MODELS`（含 `gpt-4o-mini` / `gemini-1.5-flash` / `deepseek-chat` 等下架型号） | 删常量，改读 `getProvider(providerId).models`；在线列表优先、参考补后、按 id 去重（与设置页 `modelRowsFor` 同一规则） |
| 缓存键 | `` `cached_models_${service}` ``（内联模板） | `cachedModelsKey(providerId)`；读到空则回退 `cachedModelsKey(provider.service)` 兼容旧缓存 |
| Key | 只有一个 `apiKey` 输入框，切厂牌不会换 | 切厂牌照 `providerKeys[providerId]` 回填输入框，输入即写回该格；请求层读的 `apiKey` 同步 |
| 端点 | 只有一个 `apiBaseUrl` 输入框，placeholder 按 service 分支 | 切厂牌照 `providerBaseUrls[providerId] \|\| provider.defaultBaseUrl` 回填；placeholder 用厂牌声明值 |
| 获取模型 | `service` 决定 service 字段 | 当前厂牌的 Key + 端点，结果写 `cached_models_<providerId>` |
| 测试连接显示名 | 按 service 三分支（`OpenAI代理` / `DeepSeek` / `Gemini`） | `getProvider(providerId).name` + 当前模型；Google 仍是「Google 翻译」 |
| 深色可读性 | `:root` 无 `color-scheme`（回退丢失） | `:root` 补 `color-scheme: dark`；厂牌图标只出现在选中态 `#service-icon`（原生 `<option>` 放不下 SVG） |

### 15.8.2 一行都不许动的东西（本轮红线）

`utils/*`（尤其 `models.ts` / `provider-icons.ts`，**只读引用**）、`entrypoints/options/*`、
`entrypoints/content/*`、`entrypoints/background.ts`、`types/index.ts`、其他测试文件。
弹窗侧也**一个控件没删**：Key / 显示隐藏 Key / Base URL / 获取模型 / 手填 model id /
4 个断句滑块 / 4 个取色器 / 字号 / 不透明度 / 上传场景与术语库 / 自动降级 / 隐藏原生字幕 /
AI 配置手风琴 / 测试连接全部保留。

### 15.8.3 端到端七条（真 Chrome headless，夹具 `D:\edge\_ui\popup-sync\`，不进仓库）

| # | 验的什么 | 实测 |
|---|---|---|
| a | 下拉项数 / 首项 | **8 项**，首项 `google-free` =「Google 免费翻译 (无需 Key，免配置)」，其后按 `PROVIDERS` 顺序（DeepSeek / OpenAI / Gemini / Anthropic Claude / 通义千问 / Kimi / GLM） |
| b | 选 Claude | `providerId=claude`、`service=openai`、Key 框显示 `sk-ant-claude-…`（**不是** DeepSeek 那把）、Base URL `https://api.anthropic.com/v1`、模型 4 个全 `claude-*` |
| c | 切回 DeepSeek | Key 恢复 `sk-deepseek-…`、Base URL 回 `api.deepseek.com/v1`，模型列表无一个 `claude-*` |
| d | 在 Claude 下改 Key | `providerKeys.claude` 更新、`providerKeys.deepseek` 不变；保存后 `aiCacheTtlHours=720` / `aiResumeMode=manual` 仍在（整份下发 + `sanitizeSettings` 合并） |
| e | 下架型号 | 7 个厂牌的模型下拉全部扫过：`e_staleHits = []`，跨厂牌串台 `e_crossContamination = []`（`claude-*` 只在 claude，`qwen*` 只在 qwen，`glm-*` 只在 zhipu…） |
| f | 配置控件 | 12 个必备 + 10 个附加控件全部在 DOM 里，**没有顺手精简** |
| g | 旧缓存兼容 | 只放 `cached_models_openai`、当前 `claude`（service 同为 `openai`）时读到旧列表（`legacy-openai-model-1/2`），并把当前型号补成「当前设置」一行 |

零 `pageerror`；弹窗无横向溢出（Δ = **-5**，`max(0, Δ)` 口径为 0）。

### 15.8.4 测试与断言改动

- `test-popup-ui.js` 32 → **46**（新增 §11「选项与设置页同步」14 条：同源 `PROVIDERS`、
  8 通道动态填充、切厂牌换五样、`providerKeys` / `providerBaseUrls` 分格、在线/参考/去重规则、
  旧缓存回退、缓存写厂牌键、无下架型号、`serviceLabel`、`color-scheme`、图标只在显示区）。
- `test-options-ui.js` 493 → **494**。改口径的旧断言（逐条说明）：
  1. 「设置页预设只有一份；弹窗回退后自带兜底副本，service 键必须对齐」→ 改为「**两边同源**：都从 `utils/models` 取 `PROVIDERS`」。
  2. 「设置页从 `utils/models` 取预设（弹窗回退后不再 import）」→ 改为「**弹窗也 import**」。
  3. 「缓存键口径同一套：弹窗内联 `cached_models_<service>`」→ 改为「弹窗按 `providerId` + **兼容旧 service 键**」。
  4. 「弹窗会读写 `cached_models_<service>`」→ 改为「弹窗按厂牌存 Key / 端点，整份 settings 下发」。
  5. 「设置页 `:root` 有 `color-scheme`，弹窗没有（已知缺口）」→ 改为「**两侧都有**」（本轮补回弹窗）。
  6. 「弹窗按 service 读 `PRESET_MODELS`，不建 optgroup」→ 改为「弹窗也按厂牌列模型，同 service 不混装」。
  7. §19「设置页仍是 8 通道（弹窗 4 项不影响）」→ 改为「**设置页与弹窗都是 8 通道**」。
- 未改任何其他套件断言；`utils/*` 一个字符未动。

---

## 十六、v0.4.2 修复轮：模型行口径收紧 + 按厂牌记忆 + 展开过渡统一

> 本轮只做四件事里属于设置页的三件：**问题 1（模型记忆）**、**问题 2（预置型号退出列表）**、
> **问题 5（所有可展开容器一个过渡口径）**。弹窗侧（问题 1 / 2 / 3）见 `docs/UI.md` §十一。
> §16.1 取代 §14.1 的「参考清单按实际列表裁剪」口径。

### 16.1 模型行只放「真正可用的」+ 一行「当前设置」（取代 §14.1）

| | 改前（§14.1） | 改后（本轮） |
| --- | --- | --- |
| 列表来源 | 在线缓存 ∪ 参考清单（参考清单按实际列表裁剪）→ 自定义 | **在线缓存 ∪ 自定义**（参考清单一个字都不渲染） |
| 无缓存 / 缓存为 `[]` | 参考模型全显示 | **0 行 + 空态提示**（「还没获取过模型列表…点下面的『获取模型』」） |
| 「隐藏了几个参考型号」提示 | 有（`hiddenReferenceCount` + 一句交代） | **删除**（不再有意义：参考清单不在列表里） |
| 当前在用的型号 | 补一行，标「当前设置 · 未在列表」/「自定义 / 已下架」 | 补一行，**统一标「当前设置 · 未在列表」**（两种情况都是「不在可用列表里」） |
| 厂牌行计数 | `· N 个模型`（含参考） | `· N 个模型`（= 实际渲染行数，无缓存时是 1 或 0） |

`PROVIDERS[].models` 仍在用，但只做三件事：**默认模型（`models[0]`）**、
`providerHasModel()` / `findProviderByModelId()` 归属判断、派生出 `PRESET_MODELS` 供老调用方。
`docs/PROVIDER-MODELS.md` §2.1 有同一张表，改一处必须改另一处。

**为什么不再兜底**：参考清单是「按各家官网抄的」，与实际账号能力无关。用户选了 OpenAI
却把 Base URL 指向中转站时，下拉里混着 `gpt-6.1-sol` 之类必然 404；更糟的是它会掩盖
「我还没拉过列表」这个事实。空态提示把下一步动作说清楚，比给一堆假选项更有用。

### 16.2 按厂牌记住上次选的模型（问题 1）

| 时机 | 写什么 |
| --- | --- |
| 切走厂牌前 | `providerModelSelections[旧 providerId] = 当前 modelName`（空型号不写，免得覆盖） |
| 切到新厂牌 | `providerModelSelections[新 providerId] = nextModel` |
| 手动点一行模型 / 手动改自定义模型 id | 同一条记忆跟着更新 |
| 删掉正在用的自定义模型 | 回落到 `provider.models[0]` 并覆盖记忆；没有默认模型时**删掉**这条记忆 |
| 读取 | `nextModelFor()`：记忆 → 当前 `modelName` 本就属于该厂牌 → `provider.models[0]` |

边界（都写在 `nextModelFor` 的注释里，测试也守着）：

- 记忆里的值**不校验是否还在参考清单里** —— 手填的 `my-private-deploy`、已下架型号都要能恢复；
- 记忆键只接受厂牌 id；厂牌被删 / 不存在时忽略（`sanitizeProviderMap` 的键白名单）；
- 存储层把它当**普通对象**保留：老数据缺这一项 → `{}`，不报错、不整份重置。

### 16.3 五个可展开容器的展开过渡统一（问题 5）

排查范围 = 设置页**所有** `[aria-expanded]` 与 `<details>`：

| # | 元素 | 改前 | 改后 |
| --- | --- | --- | --- |
| 1 | 常规 · 翻译服务 `#provider-fold` 的 `.fold-panel` | `grid-template-rows 0fr→1fr` 300ms + `opacity` **160ms** | 同左，`opacity` 统一到 **300ms**（与网格行同一档，内容不再「先亮完再长高」） |
| 2 | 常规 · 翻译场景 `#scenario-fold` 的 `.fold-panel` | 同上 | 同上 |
| 3 | 服务与模型 · 厂牌面板 `.provider-panel`（工具条 / Key / 模型都在里面；工具条本身没有独立展开行为） | `grid-template-rows 0fr→1fr` 300ms + `opacity` 160ms | `opacity` 也 300ms |
| 4 | 服务与模型 · `details.provider-advanced`（高级 Base URL） | 只有 `detailsReveal` 淡入动画，**高度瞬跳** | 内容包 `.details-body`（grid 0fr→1fr）+ toggle 驱动 `.is-open`，300ms 过渡（与 1~3 逐字相同） |
| 5 | 翻译场景 · `details.spec-block#scene-spec`（文件格式规范 · 点开查看） | 同上，高度瞬跳 | 同上 |
| 6 | 翻译场景 · `.layer-card` 的「展开全文」 | `max-height` 175.6 → 482.8px，已是 300ms | **保持不变**：它不是「0 → 内容」的 disclosure（8 行 ↔ 24 行夹取），`max-height` 才是对的属性；时长同为 `--dur-base`，并补了 `aria-expanded` |

箭头（`.provider-chevron` / `.fold-chevron` / `summary::before`）一并从 160ms 改到
**`--dur-base`**：箭头先到、内容后到会显得两截。`prefers-reduced-motion: reduce` 下
`.details-body` 与 `.fold-panel` / `.provider-panel` 一起 `transition: none`，且收起态
仍是 `0fr + opacity 0`（不会停在半开）。

**收起方向**：`details` 关闭后内容不再渲染，没有可过渡的终态，所以 4 / 5 收起仍是瞬切 ——
这是原生 `<details>` 的固有限制，如实登记，不为了「收起也有动画」去自造 disclosure 组件。
1~3 是 `grid` 面板，收起方向有过渡。

实现要点（`attachDetailsMotion()`）：

1. `.details-body` 默认 `grid-template-rows: 1fr` —— 万一脚本没跑到，内容照常可读，不会被 CSS 藏死；
2. JS 给 `<details>` 加 `.is-motion` 之后才切成 `0fr`，展开时先落回起点、强排一次、下一帧加 `.is-open`；
3. `toggle` 是**异步**派发的，所以另在 `summary` 的 `click` 里预先把 `.is-open` 摘掉，
   避免「先画一帧全开再塌回去」的闪动；
4. 用 `data-details-motion` 属性标记（而不是 class）：静态的 `#scene-spec` 与 JS 创建的
   `provider-advanced` 走同一个选择器，少一处遗漏就少一次瞬跳。

### 16.4 验证（本轮）

| 项 | 结果 |
| --- | --- |
| `npm test` | **EXIT=0**（按退出码判定）。`options-ui` 494 → **511**；`popup-ui` 46 → **58**；`test-settings.js` 45 → **50** 条断言 |
| `npx tsc --noEmit` | **0 error** |
| `npm run build:chrome` / `build:edge` | 均 EXIT=0；两个 `manifest.json` 的 `version` = **0.4.2**，`options_ui.open_in_tab` 仍为 `true` |
| 五个 disclosure 的计算值 | 逐个实测：`transition-property: "grid-template-rows, opacity"`、`transition-duration: "0.3s, 0.3s"`（五处**完全一致**） |
| `details` 高度渐变 | `#scene-spec` 展开采样 `0 → 280 → 503 → 611.8 → 688.3 → 728.5`（8 个不同值）；`provider-advanced` `0 → 15.3 → 35.2 → 54.4 → 71.9 → 82.1 → 88.8 → 91.7` |
| 模型行口径 | 未在用的厂牌：0 行 + 空态提示；在用的厂牌：1 行「当前设置：<id>」+「当前设置 · 未在列表」 |
| 参考型号扫描 | 7 个厂牌逐个展开后扫描正文：非「当前设置」的参考型号 **0 处**，下架型号 **0 处** |
| 横向溢出 / pageerror | 8 个分区 + 800px 窄屏 Δ 均为 0；零 pageerror |

端到端夹具在 `D:\edge\_ui\fix5\`（esbuild IIFE + chrome 桩 + 真 Chrome headless，
桩里的 `GET/SAVE_SETTINGS` 直接转发给仓库真实的 `utils/storage.ts`），不进仓库。



## 十七、「自动降级」+ 降级顺序（v0.4.2）

> 需求原话：「为翻译功能添加『降级顺序』配置：默认保持现有行为，即用户未主动选择时可直接降级
> 至谷歌免费翻译；新增『自动降级』开关，开启后允许用户为已配置的厂牌设置优先级顺序，
> 并支持通过上下拖拽直接调整排序。」

数据与执行链由另一路先做完（`ExtensionSettings.fallbackOrder` + `utils/storage.ts#sanitizeFallbackOrder`
+ `utils/translator.ts#resolveFallbackCandidates`），本轮**只做界面承载**，一个字段的语义都没动。

### 17.1 开关语义（没有第二个开关字段）

| 项 | 取值 |
| --- | --- |
| 承载字段 | 既有的 `autoFallbackToGoogle`（默认 `true`）——**不是**新字段，也没写专属保存代码 |
| 绑定通路 | `<label class="switch"><input type="checkbox" data-setting="autoFallbackToGoogle">`，走 `bindControls()` 的通用 checkbox 分支 |
| 标题 | 失败自动降级 → **自动降级** |
| 说明 | 「关闭时失败不降级；开启后可指定降级顺序，不设置则直接降级到 Google 免费翻译。」 |
| 关掉时 | 列表收起，**不写 `fallbackOrder`**（用户排好的顺序留着，下次开启还在）；运行时一次降级都不发生 |
| 打开时 | 同一行块内展开「降级顺序」；`fallbackOrder` 为空 → 直接降级 Google 免费（v0.4.1 行为不变） |
| 读屏 | `aria-expanded` 随开关走，`aria-controls="fallback-order-panel"` |

> `aria-expanded` 只在 JS 里写（`syncFallbackDepend()`），HTML 里不落静态值 ——
> 静态 `aria-expanded=` 仍只有常规页两个 `.fold` 那两处，`test-options-ui.js` 的
> 「全部可展开件仍是 aria-expanded / details」断言因此不需要改。

### 17.2 列表规则（一行 = 一级）

展示顺序 = 执行顺序（高 → 低），三类条目：

1. **`fallbackOrder` 里的厂牌**，按数组顺序；未配 Key 的**也留着**但置灰标「未配置 Key · 不生效」
   （Key 可以事后补，优先级是用户偏好 —— 界面不替用户删条目，运行时自己跳过）；
2. **已配 Key 但还没写进数组的厂牌**，追加在末尾，标「未排序」；
3. **未配 Key 且不在数组里的厂牌不展示**（它不参与降级，列出来只会让人以为会试它）。

末尾**固定一行**：`Google 免费翻译` + 「最终兜底 · 无需 Key，始终作为最后一级」，
`data-draggable="false"`、`draggable=false`、无手柄、无上/下移、不可删。
`fallbackOrder` 里若真的出现 `google-free`（存储层白名单允许），不重复占一行 ——
它就是那条固定兜底行，写回时按旧下标插回去（不静默删掉用户的配置）。

| 场景 | 表现 |
| --- | --- |
| 空态（一个已配 Key 的厂牌都没有） | 「还没有可参与降级的厂牌 · 先去上面的厂牌行填写 API Key」+ 固定兜底行 |
| 数组为空 | 额外显示「未设置顺序时，失败会直接降级到 Google 免费翻译。」——**不预填任何默认顺序** |
| 每行 | 拖拽手柄（⠿）+ 厂牌图标（`providerIconHtml`）+ 厂牌名 +（状态）+ 序号 + ↑ / ↓ |

行结构与尺寸沿用 `.provider-row` 的口径：`min-height: 36px`、`gap: 10px`、图标 28px、
序号用等宽字体（与 `.model-id` / `.fold-mono` 同一套字体栈）。手柄与 ↑↓ 的命中区 32px
（视觉 17px / 13px，用 `margin: -4px 0` 撑住，行高不被顶开）—— 沿用「触控目标 32px
是既定取舍」的登记，不按 44px「修正」。

### 17.3 拖拽与键盘

**实现方式：Pointer Events（`pointerdown/move/up/cancel`），不是 HTML5 DnD。**
理由：`dragstart` 在移动端与部分环境下根本不触发；Pointer Events 一套代码同时覆盖鼠标、
触控与触控笔，且手柄上 `touch-action: none` 就能拿到「按住拖动不滚页面」。
零第三方依赖（项目运行时不引任何库）。

| 环节 | 做法 |
| --- | --- |
| 起手 | 手柄 `pointerdown`（鼠标只认主键）；4px 死区，轻点不算拖 |
| 跟手 | 被拖行 `translateY(dy)`，`.is-dragging` 把 `transition` 摘掉 → 严格跟手 |
| 落点判定 | 被拖行中心的实时 y 与其它行中心比较；拖出列表上下边界照样能落到头 / 尾 |
| 让位 | 中间行整体挪一行高（`transform: translateY(±step)`），保留 `transform` 过渡 → 平滑让位 |
| 视觉 | 被拖行 `opacity: .72` + 亮边 + `box-shadow` 提升；插入指示线绝对定位、位置只写 `transform` |
| 位移夹取 | 被拖行夹在 `[-from·step, (n-1-from)·step]`：否则拖到最上会骑到「降级顺序」标题行上 |
| 松手 | 立刻写回 `fallbackOrder`（数组 = 界面行顺序），随后重绘并重编号 |
| 存储回声 | 拖拽进行中 `renderFallbackOrder()` 直接返回 —— 否则 320ms 后的回声会把节点换掉、手势当场断 |

**键盘可达**（两套都给，互不依赖）：

1. 每行两个按钮 `<button class="fallback-move" data-move="up|down" aria-label="上移 / 下移 <厂牌名>">`，
   视觉就是 ↑ / ↓；边界用 `aria-disabled="true"` + no-op，**不** `disabled`
   （disabled 会把焦点丢回 body，连按就断）；
2. `Alt+↑ / ↓`：焦点落在行内任意位置（含刚拖完的那一行）也能调顺序。

重绘后焦点回到「被移动的那一行」：`captureFallbackFocus()` 在重建 DOM 前记下行 / 按钮，
`applyFallbackFocus()` 重建后还原 —— 存储回声那一次重绘也不会把焦点掉回 body。

### 17.4 与执行链的对应关系

| 界面 | `utils/translator.ts#resolveFallbackCandidates` |
| --- | --- |
| 行顺序 | `fallbackOrder` 数组顺序（高 → 低） |
| 未配 Key 的置灰行 | 运行时跳过（`!isFree && !apiKey → continue`），但**保留在数组里** |
| 「未排序」行 | 不在数组里 → 这一轮不参与降级；拖动一次就写进数组 |
| 固定兜底行 | 链尾恒为 Google 免费（无需 Key / 模型） |
| 数组为空 | 直接走 Google 免费 —— 与 v0.4.1 完全一致 |

缓存：`fallbackOrder` 不进缓存指纹，改它**不会**让旧译文失效，所以这一行**没有**任何
「将重新翻译」提示（对比：切场景 / 改括注会提示）。保存走既有 `update()` →
`saveStoredSettings()` → `sync`，与弹窗是同一份存储。

### 17.5 验证（本轮）

| 项 | 结果 |
| --- | --- |
| `npm test` | **EXIT=0**；`options-ui` 511 → **554**（+43，全部是新增断言，旧断言一条未改） |
| `npx tsc --noEmit` | **0 error** |
| `npm run build:chrome` / `build:edge` | 均 EXIT=0；两个 `manifest.json` 版本 **0.4.2**、`options_ui.open_in_tab` 仍为 `true` |
| 端到端（真 Chrome headless + esbuild + chrome 桩） | **50 / 50 通过，零 pageerror**（a~h 八项 + 空态 i 组，逐条见下） |
| 1280 / 800 横向溢出 | 整页 / body / 列表 Δ 均为 **0** |

端到端逐项（夹具 `D:/edge/_ui/fallback-order/`，不进仓库）：

| 组 | 断言 |
| --- | --- |
| a | 开关默认勾选 = `autoFallbackToGoogle`；关闭 → 面板高 0 / `opacity: 0` / `inert` / `aria-expanded=false`；关闭不写 `fallbackOrder`；再开启行数不变 |
| b | 行 = `['kimi','deepseek']` + 追加 `openai`、`gemini`；`claude/qwen/zhipu`（未配 Key 且不在数组）不出现；序号 1/2/3/4；固定兜底行无手柄无按钮 |
| c | 第 3 行拖到第 1 位：拖拽中 `opacity 0.72`、`translateY(-80px)`、指示线 `is-on`、其余行让位；松手 `fallbackOrder = ['openai','kimi','deepseek','gemini']`，序号重排，焦点回到被移动行 |
| d | 点「上移」→ `['kimi','openai','deepseek','gemini']`，焦点仍在该按钮；首位再按不落盘 |
| e | 关闭再开启，顺序仍是上次排好的（未被重置） |
| f | 首次开启且数组为空 → **不写任何顺序**（仍 `[]`），显示「未设置顺序…」提示 |
| g | 未配 Key 的 `gemini` 在数组里 → 仍显示（置灰）+ 无手柄；拖拽后仍在数组里，没被挤掉 |
| h | 1280 / 800 两档无横向滚动条、零 pageerror |
| i | 空态：只有提示 + 固定兜底行，且顺序未被写入 |

### 17.6 问题清单 / 已知限制

1. **未排序行的语义边界**：界面上任何一次重排（拖拽或 ↑↓）都会把**当前可见的全部行**
   按新顺序整份写回 `fallbackOrder`，也就是那些「未排序」的已配 Key 厂牌会一次性进入降级链。
   这是「松手即写回（只含可拖拽的厂牌，按新顺序）」最直白的实现，也保证「所见即执行顺序」；
   代价是用户没法只排两个厂牌、其余保持「不参与」。若要支持，需要第三个字段（例如
   显式的 `fallbackOrderExplicit` 标记），本轮不引入。
2. **插入指示线与被拖行位置基本重合**：因为被拖行是跟手走的，指示线画在「空出来的那一格顶边」，
   多数时刻就压在被拖行的上边缘。夹取到底 / 到顶时它仍有用（提示还能不能再往上）。
   没有为了「更显眼的指示线」改成不跟手的幽灵行 —— 那样拖拽手感会退化。
3. **拖拽不跨「固定兜底行」**：Google 兜底行不可拖也不可被感知为落点（它不是
   `fallbackOrder` 的成员），所以列表最后一个可拖位置是它上面那一格。
4. **`.row-depend` 靠 `flex-wrap` 换行**放置面板：≤880px 时 `.row` 变成 `column`，
   面板的 `flex-basis: 100%` 在 column 方向会指向高度，已在同一断点里改回 `auto`。
5. **未修（沿用上一轮登记）**：`--radius-sm: 6px` 与弹窗硬编码 7 / 9 / 4 / 2px 的偏差、
   `.preview-sub` 的 `transition: bottom` —— 本轮一行都没碰。
