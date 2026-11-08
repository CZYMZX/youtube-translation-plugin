# UI 动效与视觉规范重构（v0.3.0）

> 参考规范：[feitangyuan/motion-web](https://github.com/feitangyuan/motion-web) 的
> `references/motion-tokens.md`、`baseline-ui.md`、`components.md`、`page-design.md`、`design-slop.md`。
> 落地对象：扩展弹窗（popup）设置面板，共 4 个页签。

---

## 一、从规范里真正拿到了什么

README 只有理念，具体数值在 `references/`。实际采用的可执行条目：

| 规范条目 | 具体值 | 落到本项目 |
|---|---|---|
| 时长阶梯 | instant 80–100 / fast 150–200 / standard 280–350 / slow 600–800 | `--dur-instant:90` `--dur-fast:160` `--dur-base:300` `--dur-slow:600` |
| 缓动词典 | `ease-out-expo` `cubic-bezier(.16,1,.3,1)` 等 8 条 | 定义 6 条 + 保留兼容别名 |
| 弹簧曲线 | `linear(0, .32 8%, .79 20%, 1.03 30%, 1.01 46%, 1)` | `--spring-snappy` / `--spring-soft` |
| 错峰 | tight-grid 40ms / standard-list 70–80ms | 30ms 递增（弹窗条目少，取更紧的一档） |
| 变换预算 | 只动 `transform` / `opacity`；`width/height/padding` 属昂贵档 | 开关按下改 `scaleX`；卡片 hover 用 `scaleY` 标线 |
| 降级阶梯 | opacity only → translate only → no motion | `prefers-reduced-motion` 直接呈现最终态 |
| 反套路 B3 | 「一个 0.3s ease 走全站」= CSS 默认味 | 改前 6 处 `transition: all` + 单一 `--transition-fast`，改后按属性分别声明 |
| 反套路 B1 | 「所有卡片统一 translateY(-4px)」无信息量 | 卡片 hover 改为左侧 2px 标线生长 |
| 反套路 A4 | 紫罗兰/靛蓝渐变是最大 AI 味 | 保持中性铬层，主题色仍为白，彩色只用于语义状态 |
| 无障碍地板 | 焦点环 / 触控目标 / 降级可用 | 见下 |

---

## 二、改动范围（界面与组件清单）

### 2.1 全局
- `:root` 令牌层重写：表面、文字层级、圆角档位（`--radius-lg/md/sm/pill` = 12 / 8 / 6 / 999，见 §5.1）、时长四级、缓动六条、弹簧两条、错峰两档、阴影两级。
- 移除 `transition: all` **6 处**（`.form-select/.form-input`、`.btn-sm/.btn-xs`、`.btn`、`.glossary-chip`、`.btn-chip`、`.preview-box`）。
- 卡片放弃「表面 + 边框 + 阴影」三重叠加，只留表面 + 边框；模糊半径 16px → 10px。

### 2.2 页签导航（`smooth-tabs` / `tab-btn` / `tab-glider`）
- 滑块：`0.38s --ease-elastic` → **`300ms --spring-soft`**（轻微过冲后收敛）。
- 按钮：颜色 160ms 快切；激活态 `translateY(-0.5px)`（走合成层，不推布局）；按下 `scale(.97)`。
- 内容切换：单一 `fadeIn` → **两级入场**（容器 300ms + 子项 160ms 错峰 30ms）。

### 2.3 表单控件
- 下拉/输入框：只过渡 `background-color / border-color / box-shadow`。
- 滑块拇指：hover `scale(1.06)`、active `scale(1.16)`，走弹簧曲线。
- 开关（`switch`）：滑块 `--spring-snappy`；**按下反馈由 `width` 改为 `scaleX`**（原实现动画 `width` 会触发重排，规范列为昂贵属性）。
- 复选行 `min-height: 32px`，分段控件 `min-height: 30px`。

### 2.4 卡片与列表
- `.card`：去阴影、降模糊。
- `.pack-card`（术语库/场景卡片）：hover 语义改为**左侧 2px 标线 `scaleY` 生长**，激活态同款；不再使用整体位移。
- 折叠区箭头 `ai-accordion-arrow` 加 `transform` 过渡。

### 2.5 排版层级
- 主标题 15.5px / `-0.012em`；副标题 10.5px / 降级色 —— 建立类型对比（原 15px 对 11px 对比不足）。
- 分区标题（`section-title`）改 **eyebrow 式**：10.5px + `0.14em` 字距 + `--text-muted`。
- 数值徽章 `font-variant-numeric: tabular-nums`，数字变化不抖宽度。
- 页签高度地板 380px → **320px**，缩短短页签下方空档（原 128px → 68px），同时保留稳定区。

### 2.6 无障碍
- `:focus-visible` 统一焦点环（2px + 2px offset）；`focus:not(:focus-visible)` 去掉鼠标焦点环。
- 页签补 ARIA：`role="tablist"/"tab"/"tabpanel"` + `aria-selected` + `aria-controls` + roving tabindex。
- 键盘导航：← → ↑ ↓ 循环切换，Home / End 跳首尾（`main.ts` 新增 keydown 处理）。
- `prefers-reduced-motion: reduce`：动画时长归零、入场条目直接呈现最终态。

---

## 三、版本合并的处理方式

### 3.1 合并原则

原状态：

```
0.2.9  → 术语库/场景可扩展（页签 + 上传）
0.3.0  → 内置术语库扩充（MC 74 / AI 35）
0.3.1  → 官方语言文件核对 + 匹配修复
```

按需求改为「**0.2.9 为唯一功能基线 + 0.3.0 只承载 UI**」：

```
0.2.9（唯一基线）
  ├─ 原有：术语库/场景可扩展
  ├─ 并入：内置术语库扩充        ← 原 0.3.0
  └─ 并入：官方核对 + 匹配修复    ← 原 0.3.1
0.3.0（本次） = 0.2.9 全部功能 + UI 重构，功能面无新增
```

### 3.2 具体动作

1. **代码基线**：以 `油管翻译插件_v0.3.1`（已含全部累积改动）为源，复制为新的 `油管翻译插件_v0.3.0`；
2. **旧目录归档**：原 `油管翻译插件_v0.3.0`（术语库版）重命名为
   `油管翻译插件_v0.3.0_archive_术语库版_20261105`，保留可追溯证据；
3. **版本号回落**：`package.json` / `package-lock.json` / `wxt.config.ts` / 三个入口 banner / popup 页脚统一为 `0.3.0`；
4. **变更记录重排**：
   - 删除原 `[0.3.1]`、`[0.3.0]` 两个条目；
   - 将其内容压缩为 `[0.2.9]` 下的「📦 累积改动（原 0.3.0 / 0.3.1 并入本节）」，分 A/B/C 三段；
   - 新增 `[0.3.0]` 条目，只描述 UI，并在开头写「版本合并说明」。

### 3.3 为什么这样合并

- 版本号语义清晰：**0.3.0 = 一个可交付的 UI 里程碑**，而不是「术语库小改 + UI」的混合体；
- 功能面等价性可验证：0.3.0 与 0.2.9 的差异应**只有 CSS/HTML/ARIA**，便于回归与回滚；
- 旧的两段记录不删除而是并入 0.2.9，避免丢失「某条术语为什么这么定」的历史依据。

---

## 四、验证

| 项 | 结果 |
|---|---|
| `tsc --noEmit` | 0 error |
| `npm test` | 全绿（packs 53 · glossary 46 · segmenter 34 · UI 28 等） |
| 新增 `test/test-popup-ui.js` | **28 项断言**全过 |
| 令牌实机解析 | `--dur-fast: .16s`、`--dur-base: .3s`、`--spring-soft: linear(0, .18 12%, …)` |
| 滑块计算值 | `transition-timing-function: linear(0 0%, .18 12%, …)`、`duration: 0.3s` |
| 键盘导航 | `ArrowRight` → 激活「术语与场景」、`aria-selected` 同步、焦点跟随 |
| reduced-motion | 页签子项 `opacity=1`、`animation-name: none`，无「停在 from 帧」（子项数随页签变化：常规 6 个 / 断句引擎 8 个） |
| 横向溢出 | `scrollWidth - clientWidth = 0` |
| 控制台 | 无 pageerror |
| 构建 | chrome / edge 均 0.3.0；内容脚本 `backdrop-filter` = 0（VSR 红线保持） |

> 顺带修掉一个**自 0.2.9 起就失效的陈旧断言**：`test-settings.js` 仍要求 `scenario` 非法时回退
> `general`，而 0.2.9 起场景支持自定义包 id、默认值为 `vtuber`。此前的"全绿"结论因只筛
> `✗ / 失败` 字样而漏掉了 `AssertionError`。现已改为：合法自定义 id 原样保留、非法 id 回退
> `vtuber`、缺省为 `vtuber`，并改用退出码判断整体结果。

---

## 五、与规范的偏离（有意为之）

| 规范 | 本项目取值 | 原因 |
|---|---|---|
| 触控目标 ≥ 44px | 32px（复选行）/ 30px（分段） | popup 是桌面鼠标场景，44px 会把面板撑高近一倍；移动端不加载此面板 |
| 卡片零阴影 | 卡片无阴影，但页签滑块保留一层轻投影 | 滑块需要与底槽区分层级，属功能而非装饰 |
| 单一 accent | 保留白色为唯一交互色，另留 3 个语义状态色（成功/警告/错误） | 状态色是信息编码，不是装饰用色 |
| `backdrop-filter` | popup 保留 10px 毛玻璃，内容脚本仍为 0 | 毛玻璃只影响弹窗；视频浮层加滤镜会关闭 RTX VSR（已有回归测试守护） |

---

## 5.1 登记偏差（勿擅自「顺手修」）

以下是文档口径与代码现状的**已知不一致**，全部保留原状，只有拍板后才改：

| 项 | 文档口径 | 代码现状 | 为什么不改 |
|---|---|---|---|
| 圆角档位 | 「12 / 8 / 999 三档」 | 两页 `:root` 都有第四档 `--radius-sm: 6px`（`.btn-sm/.btn-xs`、`.pack-item`、`.op-btn`、`.gloss-input` 在用），测试只校验「令牌种类 ≤ 4」所以不报红 | 改取值会动 `.btn-sm/.btn-xs` 等控件外观，属视觉变更 |
| 硬编码圆角 | 未列 | popup 另有 `7px`（`.switcher-glider` / `.switcher-item`）、`8px`（`.header-logo-icon`、`.glossary-list`、`.spec-details`、`.pack-preview`）、`6px`（`.spec-body pre`、`.btn-chip`）、`4px`（`.glossary-meta`）、`2px`（`.pack-card::before`）；`9px` 只出现在 `options/style.css` 的 `.brand-mark` | 同理，是视觉变更 |
| `.preview-sub` 过渡 | 「只动 transform / opacity」 | **已修**（任务四 · 需求六）：`options/style.css` 里那条 `transition: bottom` 已删除——`main.ts` 早已改用 `top`，且 `bottom` 被强制成 `auto`，该过渡一次都不会触发。没有改成 `top`：`top` 是布局属性，逐帧改会重排、也让滑块跟随变「黏」，预览本该实时跟随。见 §8.7 |
| 档名 | 早期引用写作 `UI-1.3.0.md` | 本任务对应文档就是 `docs/UI.md`（正文标题已是 v0.3.0），仓库里不存在 `UI-1.3.0.md` | 只在资料库侧修正引用，仓库不改名，避免历史链接断裂 |

---

## 六、回退方式

`style.css` 末尾的「v0.3.0 · UI 动效与视觉规范层」是**后置覆盖块**，整段删除即回到 v0.2.9 视觉；
令牌改动（`:root`）与开关 `scaleX`、页签 ARIA 属就地修改，回退需按 `CHANGELOG` 对应条目反向操作。

---

## 七、0.4.2 弹窗布局与折叠分区

### 7.1 页签底部的空白（`通用与翻译` 选 Google 时）

- **成因**：`.tab-content` 上有一条 `min-height: 320px` 的高度地板（本意是避免切换页签时预览块跳动）。
  选定「Google 免费翻译」后 `#ai-config-section` 被 `hidden` 掉，该页只剩 5 行内容（约 170px），
  地板多出的约 150px 就成了复选框与「效果实时预览」之间的大片空白。
- **改法**：删掉这条地板。弹窗高度本来就随内容自适应，删掉后每个页签按自身内容收口；
  代价是切换页签时预览块会随内容高度小幅上下移动（该块在四个页签里共用一份）。
- **约束**：`body` 的 `min-height: 480px` 保留——它是弹窗最小高度，不产生内部空白。
- **回退影响（v0.4.2 回退轮）**：这次删改随弹窗整体回退一并撤销，`min-height: 320px`
  地板重新存在，选 Google 时的页签底部空白**回来了**。实测（400px 宽、service=google）：
  `.tab-content` 高度被撑到 320px、内容实际到 255px，**底部空 66px**。属于已知代价，
  本轮不做二次修改（弹窗只允许三处缺陷修复）。

### 7.2 「翻译场景」「术语库」改为可折叠分区（v0.4.2 修复轮**已重做**）

> **历史**：本节最早记录的是一版「折叠后只显示 `is-current` 卡片、其余 `display: none`」的方案，
> 那批改动随 v0.4.2 回退轮（`git checkout HEAD -- entrypoints/popup/*`）一起丢失。
> **修复轮按新口径重做了一遍**（`<section class="pack-section">` + `section-toggle` +
> `grid-template-rows 0fr → 1fr` + `chrome.storage.local` 持久化），
> 现行实现与验收见 §十一，本节表格只作早期设计记录，**不要照它实现**。

| 项 | 早期取值（已废弃） |
|---|---|
| 折叠显示 | 只显示 `.pack-card.is-current`（场景＝使用中的那一个，术语库＝已启用的那些） |
| 折叠隐藏 | 其余卡片、`spec-details`、`pack-preview` 一并 `display: none` |
| 状态保留 | 非当前卡片不移出 DOM；折叠/展开不重渲染列表 |
| 折叠状态持久化 | `chrome.storage.local` 的 `yt_sub_popup_pack_sections`，**不写进设置对象**（这一条沿用至今） |

> 「当前生效」的判定：场景取 `currentSettings.scenario`，术语库取 `currentSettings.glossaryPacks`（空数组视为三包全启用，与 `getEnabledPackIds()` 一致）。

### 7.3 验证

- 静态渲染（Chrome headless，380px 宽）：选 Google 时复选框与预览块之间无空档。
- `test/test-popup-ui.js` 当时 28 → 49 项（新增页签无高度地板、两个分区默认折叠、`is-current` 标记、
  折叠态隐藏规范块、折叠状态存 local 而非设置对象、渲染后重新应用折叠态等 21 项）。
  **回退后这 21 项随折叠分区一起作废**：`test-popup-ui.js` 回到 v0.4.1 基线的 28 项，
  再加本轮 4 条回退锁定断言 = **32**。
- 注意：§7.1 的「删掉 `min-height: 320px` 地板」**也随回退恢复原状**——`style.css`
  第 318 行那条 320px 地板又回来了，选「Google 免费翻译」时页签底部空白重新出现
  （登记为已知代价，见 §10.3）。

---

## 八、设置页补齐过渡（任务四 · 需求六）

> 对象：**高级设置页**（`entrypoints/options/`），不是弹窗。这一节只登记「动效层」，
> 可读性（字号 / 对比度 / 间距）见 `docs/OPTIONS-0.4.0.md` §12。
> 逐项纪律：只过渡 `transform` / `opacity` / `grid-template-rows` / `max-height` /
> `background-color` / `border-color` / `color`；时长一律取 `--dur-*`；`transition: all` 仍为 0 处。

### 8.1 八处清单

| # | 位置 | 改前 | 改后 | 属性 / 时长 |
|---|---|---|---|---|
| 1 | 分段控件滑块 `.seg-glider`（9 处分段） | 已有过渡，但**没验证过真的在动** | 实测确认：`--seg-index` 变化 → 位移 62px | `transform` · `--dur-base`(300ms) · `--spring-soft` |
| 2 | 厂牌展开 / 收起 `.provider-panel` | 原生 `hidden` 硬切，**没有任何过渡**（实测 `transition-property: ""`） | `grid-template-rows: 0fr → 1fr` + 透明度 | `grid-template-rows` 300ms `--spring-soft` + `opacity` 160ms `--ease-out-expo` |
| 3 | 原生 `<details>`（规范说明 / 高级 Base URL） | 原生 `▸` 标记不可旋转；内容整块硬闪 | 自绘三角 `::before` 旋转 90° + 内容淡入上移 | `transform` 160ms `--ease-out-expo`；内容 `detailsReveal` 300ms |
| 4 | 弹层（新建术语库 / 新建场景 / 自定义模型 / 模板） | 只有入场 `modalEnter`；遮罩无动画；关闭瞬间消失 | 遮罩淡入 300ms；关闭反向 `modalExit` 160ms `--ease-in-expo`（`close()` 由 JS 延后一拍） | `opacity` / `transform` |
| 5 | 术语库 / 场景列表的选中切换 | 点一下**重建整张列表**，新节点直接落终态 → 高亮瞬切 | 改成就地切 class；背景 + 左侧 2px 标线 `scaleY` 生长 | `background-color` / `border-color` / `color` 160ms；标线 `transform` 300ms `--spring-snappy` |
| 6 | 复制按钮成功反馈 | 只有 toast，按钮本身没变化 | `.is-copied`：底色切成功色 + 文案「已复制」，1.2s 还原（不弹窗） | `background-color` / `border-color` / `color` 160ms |
| 7 | `.preview-sub` | `transition: bottom`，而 `bottom` 被强制成 `auto` → 永不触发 | 删掉该声明（见 §5.1） | — |
| 8 | 全局补课 | 见 8.2 | 见 8.2 | — |

### 8.2 自查补上的零散过渡

| 交互点 | 状态变化 | 补了什么 |
|---|---|---|
| `.layer-body`「展开全文」 | `max-height` 8 行 → 24 行，原来**瞬跳** | `max-height` 300ms `--ease-out-expo`（实测 175.6px → 482.8px 逐帧过渡） |
| `.provider-row[aria-expanded]` | 展开时文字提亮到 `--text-main`，颜色瞬变 | `color` 160ms |
| `.provider-icon` | 切到「使用中 / 展开」时图标与圆底变色 | `color` + `background-color` 160ms |
| `.link-btn`（展开全文 / 收起） | hover 变色 | `color` 160ms |
| `.model-hit` | 选中行文字色 | `color` 160ms |
| `.btn:disabled` | 透明度突变 | `opacity` 160ms |
| `.gloss-input` | 行内编辑框获得焦点 | `border-color` + `background-color` 160ms |
| `.latency`（连通性实测） | 结果色在成功 / 失败间切换 | `color` + `border-color` 160ms |

### 8.3 有意不补（写了也播不出来，或不允许）

| 交互点 | 原因 |
|---|---|
| `.readonly-banner` / `.empty-state` / `.import-report` / `.layer-more` | 显隐走 `display: none` 切换，`display` 不参与过渡 |
| `.spec-block[open]` 的 `border-bottom`、`.provider-advanced[open]` 的 `padding-bottom` | 「出现 / 消失」型变化；`padding` 不在允许属性里（红线段），硬做会引入布局动画 |
| `.gloss-table tr.is-editing` 的行底色 | 进入编辑会重建该行，节点是新的，过渡不会播 |
| `.nav-marker` 的高度 | 随导航项文字高度变化；`height` 不允许过渡，改 `scaleY` 会把 2px 圆头压扁 |
| 弹窗「入场」的 `--starting-style` 方案 | 当前 `modalEnter` 已覆盖入场；没有引入实验性特性 |

### 8.4 收起后为什么仍然「不可聚焦」

两道保险，都不依赖 `display: none`（否则过渡就没了）：

1. **`inert`**：`syncProviderGroupState()` 与首次渲染都写 `panel.inert = !open`，
   收起时整棵子树不可聚焦、不进 tab 序列、读屏也不念（实测：收起后 `focus()` 落在别处 → `focusLanded: false`）。
2. **`grid-template-rows: 0fr` + 内层 `overflow: hidden`**：高度真的收到 0（实测 collapsed 高度 = 0 / inner 高度 = 0），
   不是靠 `visibility` 藏起来。
3. 首次渲染的折叠态仍带原生 `hidden`（省一次布局）；就地展开时先摘 `hidden` → 强制一次布局 → 再加 `.is-open`，
   这样起点「0fr + opacity 0」先落地，过渡才会播。

> 键盘 ↑↓ 只在「展开中」的面板里找模型行，选择器随之从 `.provider-panel:not([hidden])`
> 换成 `.provider-group.is-open .provider-panel`——就地切换后 `hidden` 不再是唯一开关，用 `hidden` 判会走进收起的面板。

### 8.5 验证

`npm test` / `npx tsc --noEmit` 结果见 `docs/OPTIONS-0.4.0.md` §12.6；
动效的实测证据（`transition-property` / 逐帧采样 / `prefers-reduced-motion`）见同文 §12.5。

---

## 九、设置页「常规」的两处折叠（任务四 · 需求五 + 六）

> 对象：**高级设置页**的 `#pane-general`。这里只登记交互与折叠语义；
> 数据来源、切换函数、自适应数值见 `docs/OPTIONS-0.4.0.md` §13。

### 9.1 折叠件 `.fold`（一处实现，两处复用）

| 部件 | 类名 / 属性 | 说明 |
|---|---|---|
| 摘要行 | `button.fold-toggle` + `aria-expanded` + `aria-controls` | 整行可点，`min-height: 44px`；原生 button，Enter / Space 与 `:focus-visible` 都是现成的 |
| 面板 | `.fold-panel`（`hidden` + `inert`） | 收起时 `hidden` 让它不参与布局，`inert` 让它不进 tab 序列、读屏也念不到 |
| 展开动画 | `grid-template-rows: 0fr → 1fr` + `opacity` | 与「服务与模型」的厂牌面板**同一条曲线**（300ms `--spring-soft` / 160ms `--ease-out-expo`），不碰 `height` |
| 箭头 | `.fold-chevron` | CSS 三角形，只转 `transform`：`rotate(0 → 90deg)`，160ms `--ease-out-expo` |
| 收起态内容 | `.fold-title` / `.fold-sub`（可加 `.fold-mono`）/ `.fold-badge` | 名称 / 副行（当前模型 id 等宽，或场景一句话说明）/ 右侧计数或状态 |
| 状态 | 局部变量 `providerFoldOpen` / `scenarioFoldOpen` | **不持久化**、不写 `chrome.storage`、不新增设置项；每次进页面收起 |

展开的第一步是「先摘 `hidden` → 强制一次布局 → 再加 `.is-open`」，
否则起点（0fr + opacity 0）和终态在同一帧被合并，过渡永远播不出来——与 §8.4 同一处理。

### 9.2 「翻译服务」：可折叠的厂牌选择器

- 摘要：厂牌图标（`providerIconHtml`）+ 厂牌名 + 当前模型 id（等宽）+ `已配置 / 未配置 Key` + 箭头。
- 面板：`utils/models.ts#PROVIDERS` 全量 8 个通道（Google 免费在最上），
  行结构**复用 `.provider-row`**，所以行高（40px）、hover 标线、图标尺寸与「服务与模型」逐像素一致。
- 当前项：`aria-pressed="true"` + `aria-current` + 右侧「使用中」+ 左侧 2px 标线
  （折叠块里没有 `.provider-group.is-current` 可挂，另加一条 `.fold-list .provider-row[aria-pressed="true"]::before`）。
- 面板底部一行细字链接：`更多模型与自定义模型 → 服务与模型`，点击 `activatePane('service')` 并收起本块。
- 点一行后自动收起；列表每次刷新都重建行节点，所以焦点交还给 `.fold-toggle`（不把键盘用户甩到页首）。

### 9.3 「翻译场景」：可折叠的场景网格

- 摘要：当前场景名 + 一句话说明（`hint || description`，与卡片上那句同一个取值函数）+ `N 个` + 箭头。
- 面板里就是原来那张 `.scenario-grid`（`auto-fill minmax(168px, 1fr)`），
  **卡片样式一个像素没改**，只多了容器内边距；场景变多时收起后仍只占一行。
- 场景列表仍由 `renderScenarios()` 一次性渲染，折叠不重建卡片，选中态与点击行为不受影响。

### 9.4 降级

`prefers-reduced-motion: reduce` 下 `.fold-panel` / `.fold-chevron` 的过渡置为 `none`，
展开即终态（`opacity: 1`、`grid-template-rows: 1fr`），收起仍是 `0fr` + 透明——
不会因为「动画被掐断」而停在 0fr 的收起高度上。实测证据见 `docs/OPTIONS-0.4.0.md` §13.4。

---

## 十、弹窗保留完整配置（v0.4.1 形态）/ 设置页是同一套设置的完整视图（任务四 · 需求一，**已回退**）

> 基线：tag `v0.4.1` / `package.json 0.4.2`；本轮实测 `npm test` EXIT=0
> （`test-popup-ui.js` **46**、`test-options-ui.js` **494**，较回退轮 32 / 493 各增 14 / 1）。
> 本轮只做「选项对齐」：不改版本号、不构建发布产物、不 commit / tag / push。

### 10.0 回退记录（本轮的核心动作）

需求一曾把弹窗精简成「遥控器」：4 页签压到 2 页签，Key / 端点 / 模型 / 断句滑块 /
取色器 / 字号 / 上传包 / 细开关全部搬到设置页。**该方案已回退**：

| | 内容 |
|---|---|
| 回退了什么 | `entrypoints/popup/{index.html,main.ts,style.css}` 三个文件整体 `git checkout HEAD --`，回到 tag `v0.4.1` 的完整配置版：**4 个页签**（通用与翻译 / 术语与场景 / 断句引擎 / 样式排版），`#api-key`、`#api-base-url`、`#btn-fetch-models`、`#model-name`、4 个断句滑块、4 个取色器、`#font-size`、`#bg-opacity`、场景/术语库上传、`#auto-fallback-toggle`、`#auto-hide-native`、`#btn-test-api` 全部回到弹窗 |
| 为什么 | 精简版把「看视频时改一下」的路径拉长成「开新标签页 → 找分区 → 改」，实测使用成本高于收益；且精简过程中生成的一批断言把「弹窗不再有配置」写成了硬口径，与产品判断不符 |
| 没回退什么 | 设置页（`entrypoints/options/`）、`utils/*`、`types/*`、内容脚本、background **一行未动**；设置页仍是 8 厂牌通道，`glossaryEnabled` 仍保留 |
| 不可恢复的部分 | 上一轮把弹窗「翻译场景 / 术语库」改成**可折叠分区**（`<section class="pack-section">` + `section-toggle` + `is-current` 折叠态 + `yt_sub_popup_pack_sections` 持久化）的那批改动，因为 git 没有中间提交、无法精确重建，**已随回退一并丢失**；弹窗现在是 v0.4.1 的平铺列表（全部卡片直接铺开，规范说明用原生 `<details>`）。**不要**自行重新设计折叠 UI，需要时另开一轮按 §7.2 的历史描述重做 |

回退带回来的三个真实缺陷已在弹窗侧就地修掉（不属于「精简」，属于缺陷修复）：

| 位置 | 改前 | 改后 |
|---|---|---|
| `index.html` 服务下拉 | `OpenAI API (GPT-4o-mini 等)` | 回退轮先改成 `OpenAI API（兼容端点）`（不写具体型号）；**v0.4.2 本轮升级为按 `PROVIDERS` 动态生成 8 个 option**（见 §10.8） |
| `main.ts` `serviceLabel` | 兜底写死 `gpt-4o-mini` / `deepseek-chat` / `gemini-1.5-flash` | 回退轮从 `currentSettings.modelName` 取、取不到只显示服务名；**本轮改为厂牌名 + 当前模型**（`Anthropic Claude [claude-sonnet-5-5]`，Google 仍是「Google 翻译」） |
| `index.html` `#scenario-select` | 只有 `vtuber` / `general` 两个 option | 补齐 `science` / `music` / `gaming`，与设置页 5 个内置场景对齐（否则设置页选了科普，弹窗显示空白） |

### 10.1 一句话职责

| | 弹窗（380px） | 高级设置页（新标签页） |
|---|---|---|
| 定位 | **一组常用设置的完整视图**：v0.4.1 形态，配置项一项没少 | **同一套设置的完整视图 + 编辑器**：多了术语库条目编辑、厂牌 8 通道、缓存处理 |
| 页签 / 分区 | 4 个页签（常规 / 包 / 断句 / 样式），平铺展开 | 8 分区面板切换 |
| 形态差异 | 中文页签 + 手风琴收拢 Key/端点/模型 | 侧栏导航 + `.fold` 折叠块 |
| 入口 | 底部「高级设置」→ `chrome.runtime.openOptionsPage()`（`options_ui.open_in_tab` 保持 `true`） | 侧栏「打开快捷面板」 |

**弹窗功能一项没删**。残留的「遥控器」措辞已从界面文案中清掉，`test-popup-ui.js`
有一条断言守着（见 §10.6）。

### 10.2 两处共有的设置项清单

两处读写的是**同一份** `yt_sub_translator_settings`（Key 单独落 local 的
`yt_sub_translator_secrets`），默认值只有 `types/index.ts#DEFAULT_SETTINGS` 一份。

| 设置项 | 弹窗控件（回退后） | 设置页落位 |
|---|---|---|
| `enabled` | `#enabled-toggle` 头部总开关 | 常规 · 启用字幕翻译 |
| `targetLang` | `#target-lang`（9 种语言，与设置页一致） | 常规 · 目标语言 |
| `service` + `modelName` + `apiKey` + `apiBaseUrl` | `#service-select`（8 通道，`value` = `providerId`）+ `#model-select` / `#model-name` / `#api-key` / `#api-base-url`（Key 与端点按厂牌分格） | 常规折叠块 / 服务与模型厂牌面板（同源 8 通道） |
| `scenario` | `#scenario-select`（5 个）+ 场景卡片列表（`getAllScenes`） | 常规折叠块 / 翻译场景分区 |
| `reasoningEffort` | 三段平滑切换器 | 常规 · 推理深度 |
| `glossaryEnabled` | `#glossary-enabled` 注入总开关 | 术语库分区顶部「注入术语库」（本轮保留） |
| `glossaryPacks` | 术语库包勾选列表 | 术语库包列表（包内容编辑在工作台） |
| 断句 4 项 + 语言策略 + 两个开关 | `#pause-threshold` / `#max-words` / `#max-chars` / `#max-duration` / `#segmentation-language` / `#auto-punctuation` / `#merge-fragments` | 断句引擎分区 |
| 样式（模式 / 顺序 / 4 色 / 字号 / 不透明度） | `#display-mode` / `#layout-order` / 4 个取色器 + 色块 / `#font-size` / `#bg-opacity` + 实时预览 | 字幕样式分区 |
| 细开关 | `#auto-fallback-toggle`、`#auto-hide-native` | 服务与模型 · 失败自动降级 / 同步与缓存 · 隐藏原生字幕 |

**同步是单向的**（回退的已知代价）：设置页改任一项 → `chrome.storage.onChanged` →
设置页自身 `getStoredSettings()` → `reflectSettings()`；弹窗改任一项 →
`persistSettings()` 发**整份 settings**（`SAVE_SETTINGS`，不是 patch）→ 设置页经
`onChanged` 刷新。**弹窗不再监听 `onChanged`、也没有 `reloadFromStorage()`**，
所以「设置页改完弹窗立刻变」不再成立，需要重开弹窗（重开时会 `GET_SETTINGS` 重新拉取）。

> 整份 settings 不会覆盖工作台的高级字段：`utils/storage.ts#saveStoredSettings` 走
> `sanitizeSettings({ ...current, ...newSettings })`，弹窗对象里**根本没写**的键
> （`providerId` / `providerKeys` / `providerBaseUrls` / `customModels` /
> `glossaryAnnotation` / `asrCorrection` / `aiCacheTtlHours` / `aiResumeMode` 等）
> 会被 `current` 保留，不是被写成 `undefined`。

### 10.3 弹窗与设置页当前口径不同的地方（如实登记）

> **v0.4.2 本轮已同步「选项」**：服务列表、模型清单、Key / 端点三项都改成与设置页同源，
> 见下面的「已同步」行。**仍未同步的只有实时双向刷新**（弹窗不监听 `onChanged`）。

| 项 | 弹窗 | 设置页 | 说明 |
|---|---|---|---|
| 服务列表 ✅ 已同步 | 由 `PROVIDERS` 动态填充的 **8 通道**（首项 `google-free`，其余 7 厂牌，`value = provider.id`） | **8 厂牌通道**（同源 `PROVIDERS`） | 两边同一份清单，`index.html` 里不再硬编码任何 `<option>`（HTML 只留空 `<select>`） |
| 模型下拉 ✅ 已同步 | 按 `providerId` 读 `getProvider(providerId).models`；在线列表优先、参考补后、按 id 去重 | 按 `providerId` 读 `PROVIDERS` | 弹窗自带的 `PRESET_MODELS` 已删除，**下架型号（`gpt-4o-mini` / `gemini-1.5-flash` / `deepseek-chat` …）在两边都不再出现**；同一 service 下不会再混装 `claude-*` / `qwen*` / `kimi*` / `glm-*` |
| Key / 端点 ✅ 已同步 | 切厂牌时一次性写 `providerKeys[providerId]` / `providerBaseUrls[providerId]`，三个输入框随之刷新 | 同上（`providerKeyOf` / `providerBase`） | 弹窗保存仍发**整份 settings**，别家 Key 原样带出；`apiKey` / `apiBaseUrl` 只放「当前厂牌那一份」，请求层仍只读这两个字段 |
| 模型缓存键 ✅ 已同步 | 读写 `cached_models_<providerId>`；读到空时**回退读旧的 `cached_models_<service>`** | `cachedModelsKey(providerId)` | 兼容改造前弹窗留下的按 service 缓存，老用户升级不白丢一次拉取结果；claude / qwen / kimi / zhipu 各占一条互不污染（唯一的旧缓存串台风险见 §10.8） |
| 场景 | 5 个（`vtuber` / `general` / `science` / `music` / `gaming`）**已补齐** | 5 个（同源 `getAllScenes`） | 回退时 `#scenario-select` 只有 2 个 option，会在设置页选了科普后显示空白；已补 3 个 |
| 布局 | 平铺列表（无折叠分区） | 分区 + `.fold` 折叠块 | 见 §10.0「不可恢复的部分」 |
| 深色原生控件 ✅ 已同步 | `:root { color-scheme: dark }` + `.form-select option` 兜底 | `:root { color-scheme: dark }` | 8 个 option 的厂牌名较长，原生下拉面板必须深色底；本轮把回退时丢掉的这一行补回弹窗 |
| Key 存储 | `apiKey` / `providerKeys` 经 `SAVE_SETTINGS` → `writeSecrets` 落 `local` 的 `yt_sub_translator_secrets` | 同一条路径 | **Key 存 local 仍然生效**，回退没有把它带回 `sync` |

已知代价（本轮接受，登记不修）：

1. **折叠分区丢失**：弹窗「翻译场景 / 术语库」回到平铺，长列表会一直铺开（见 §7.2）。
2. **页签底部空白回归**：`min-height: 320px` 地板回来了，选 Google 时空 66px（见 §7.1）。
3. **同步变单向**：弹窗不再监听 `onChanged`，设置页改完需重开弹窗才看到（见 §10.2）；本轮**没有**恢复实时双向同步。
4. **弹窗写整份 settings**：不再发 patch；靠 `saveStoredSettings` 的 `{...current, ...new}` 合并保住工作台高级字段。
5. ~~弹窗预设含下架型号~~ → **本轮已消除**（`PRESET_MODELS` 删除，改用 `PROVIDERS`）。
6. ~~弹窗 `:root` 无 `color-scheme`~~ → **本轮已补**（8 通道下拉的深色可读性）。
7. **原生 `<option>` 放不下 SVG**：8 个 option 只有文字；厂牌图标只出现在「已选中」那一格（`#service-icon`），
   没有为了图标把 `select` 换成自定义组件（本轮不改交互形态）。
8. **切厂牌不做「未配 Key」拦截**：照切、照写，只靠手风琴徽标显示「未配置」（与设置页 `selectModel` 同口径）。

### 10.4 设置页保留的东西（本轮不回退）

- **厂牌 8 通道**：`PROVIDERS` 全量渲染，`test-options-ui.js` 断言
  `PROVIDERS.length === 8` 且设置页仍 `for (const provider of PROVIDERS)`，不受弹窗回退影响。
- **`glossaryEnabled`**：设置页「术语库」分区顶部的注入总开关仍在（`data-setting="glossaryEnabled"`），
  与弹窗 `#glossary-enabled` 读写同一字段、同一个默认值 `true`。
- **`utils/models.ts` 是唯一权威清单**：v0.4.2 本轮起**弹窗也直接 import 它**（不再留兜底副本），
  两边 service 键集合一致这条断言已升级为「两边共用同一份 `PROVIDERS`」。

### 10.5 一处盘点偏差（复核结论）

任务描述里的「`mergeFragments`（弹窗有、设置页缺）」实际字段名是
**`mergeShortFragments`**（`types/index.ts` / `DEFAULT_SETTINGS` / `sanitizeSettings`），
而设置页 `entrypoints/options/index.html` 断句引擎分区**早已有**
`data-setting="mergeShortFragments"` 的「短碎片合并」开关，
`test-options-ui.js` 也一直有「细粒度项存在 mergeShortFragments」断言守着。
搜 `mergeFragments` 搜不到只是名字不同。本轮**没有重复加控件**（避免同一字段两个
UI 入口），只补了断言与文档口径。真正缺的只有 `glossaryEnabled` 一项，已补齐。

### 10.6 验证（回退轮实测；本轮的选项同步验证见 §10.8）

| 项 | 结果 |
|---|---|
| `npm test` | EXIT=0，13 个套件全绿（回退轮 popup-ui **32** / options-ui **493**；本轮 **46** / **494**） |
| `npx tsc --noEmit` | 0 error |
| 令牌一致性 | 两页 `:root` **9 个**共享令牌逐项相等（`--bg-primary` / `--text-main` / `--text-muted` / `--dur-fast` / `--dur-base` / `--ease-out-expo` / `--spring-soft` / `--radius-lg` / `--radius-pill`，`drift.length === 0`）；未新增 `:root` 之外的新令牌 |
| `prefers-reduced-motion` | 弹窗活动页 6 个子项 `opacity=1`、`animation-name: none` |
| 方向键 / Home / End | 4 个页签的 tablist 键盘导航正常（含首尾回环），`aria-selected` 同步 |
| 横向溢出 | 400px 宽 × 4 个页签，`scrollWidth-clientWidth` 均为 **-5**（无正向溢出） |
| 控制台 | 零 pageerror / 零 console error |
| 端到端 | esbuild 打包回退后的 `popup/main.ts`（113.9 kB IIFE）+ `chrome` 桩，真 Chrome headless 逐页签截图，见 §10.7 |

> 弹窗 400px 宽量到的原始差值是 **-5**（`width: 380px` + `scrollbar-gutter: stable`
> 使 `documentElement.clientWidth` 略大于 `scrollWidth`），属于**无正向溢出**；
> 按 `max(0, Δ)` 口径为 0，如实登记，没有用 `overflow: hidden` 掩盖。

### 10.7 渲染验证（回退轮 4 张，`D:\edge\_ui\revert-popup\`，不进仓库）

| 文件 | 看到什么 |
|---|---|
| `popup-general.png` | 4 页签；服务下拉四行，第 3 行已是「OpenAI API（兼容端点）」；`API 与模型详细参数` 手风琴展开，「已就绪 + 当前模型: deepseek-flash」，API Key（密文）、Base URL、模型下拉、手填模型、`测试连接与延迟`、自动降级开关、隐藏原生字幕开关全在；底部预览与「高级设置」入口 |
| `popup-packs.png` | 5 张场景卡（VTuber 直播 / 通用日常 / 科普视频 / 音乐视频 / 游戏实况，均「内置 · 使用/使用中 · 上传」）+ 「＋ 上传场景」；术语库区「注入」勾选 + `146 条` + 「＋ 上传术语库」，3 张包卡（146 / 165 / 35 条）各带启用与上传 |
| `popup-segmentation.png` | 5 段语言策略切换器；4 个滑块（450 ms / 16 词 / 28 字 / 6.5 秒）与刻度说明；两个开关 |
| `popup-style.png` | 展示模式 3 段、排列顺序 2 段；4 个取色器 + 色块行（译文 5 / 原文 4 / AI 标识 6 / 背景 5）；字号 20px、不透明度 75%；实时预览跟着 `deepseek-flash` 配置渲染 |

### 10.8 弹窗与设置页的选项同步（v0.4.2 本轮）

| | 内容 |
|---|---|
| 改了什么 | `entrypoints/popup/{main.ts,index.html,style.css}`：服务下拉改由 `PROVIDERS` 动态填充；删掉弹窗自带的 `PRESET_MODELS`；模型下拉按 `providerId`；Key / 端点写 `providerKeys` / `providerBaseUrls`；`:root` 补 `color-scheme: dark`；`#service-icon` 显示当前厂牌图标 |
| 没改什么 | **一个配置控件都没删**：`#api-key` / `#btn-toggle-key` / `#api-base-url` / `#btn-fetch-models` / `#model-select` / `#model-name` / 4 个断句滑块 / 4 个取色器 / `#font-size` / `#bg-opacity` / 上传场景与术语库 / `#auto-fallback-toggle` / `#auto-hide-native` / AI 配置手风琴 / `#btn-test-api` 全部保留；`utils/*`、`entrypoints/options/*`、`content`、`background`、`types` **一行未改** |
| 切厂牌写哪五样 | `providerId` / `service` / `modelName`（当前模型属于该厂牌则保留，否则取该厂牌首个模型）/ `apiKey`（= `providerKeys[providerId]`）/ `apiBaseUrl`（= `providerBaseUrls[providerId]`，没覆盖则用 `provider.defaultBaseUrl`） |
| 「获取模型」用什么 | 当前厂牌的 Key + 端点（不再用 `service` 拼端点），结果写 `cached_models_<providerId>` |
| 测试连接显示名 | `getProvider(providerId).name` + 当前模型，如 `Anthropic Claude [claude-sonnet-5-5]`；`service === 'google'` 仍是「Google 翻译」 |
| 停在 Google 免费通道时 | `providerId` 保留「上次用的那个厂牌」（不改写成 `google-free`），否则设置页「服务与模型」会展开一个没有模型的面板 |
| 唯一的旧缓存串台 | 回退读的是 `cached_models_<service>`，而 claude / qwen / kimi / zhipu 的 service 都是 `openai` —— 只放旧 `cached_models_openai` 时，切到 claude 会先显示 OpenAI 那份旧列表，**点一次「获取模型」即纠正**（`cached_models_claude` 有值后就只读自己那条）。这是「旧缓存兼容」的已知取舍 |

验证（真 Chrome headless + esbuild 包 + chrome 桩，夹具 `D:\edge\_ui\popup-sync\`，不进仓库）：
8 项下拉；选 Claude → `providerId=claude` / `service=openai` / Key 为 Claude 那把 / 端点为
`https://api.anthropic.com/v1` / 模型 4 个全 `claude-*`；切回 DeepSeek 全复原；在 Claude 下改 Key →
`providerKeys.claude` 更新而 `providerKeys.deepseek` 不变，`aiCacheTtlHours` / `aiResumeMode` 仍在；
7 个厂牌的模型下拉无一个下架型号、无跨厂牌串台；12 个配置控件全在；旧缓存可回退读取；
零 `pageerror`、弹窗无横向溢出（Δ = -5，按 `max(0, Δ)` 为 0）。

---

## 十一、v0.4.2 修复轮：折叠分区 / 模型下拉口径 / 按厂牌记忆（弹窗侧）

> 本轮弹窗只改三件事：**问题 1（模型记忆）**、**问题 2（预置型号退出下拉）**、**问题 3（两个分区可折叠）**。
> 设置页侧的同名改动见 `docs/OPTIONS-0.4.0.md` §十六。红线照旧：弹窗**功能一项没删**，
> `options_ui.open_in_tab` 保持 `true`，数据仍只有 `yt_sub_translator_settings` 一份。

### 11.1 「翻译场景」「术语库」改为可折叠分区（问题 3）

| 项 | 取值 |
| --- | --- |
| 结构 | `<section class="pack-section">` + `<button class="section-toggle" aria-expanded aria-controls>` + `.section-body` / `.section-body-inner` |
| 默认态 | **收起**（HTML 里 `aria-expanded="false"` + 内容区 `hidden`，JS 启动时补 `inert`） |
| 收起摘要·场景 | 分区名 + 当前场景名（`#scene-active-badge`，取 `currentSettings.scenario`）+ 「共 N 个」 |
| 收起摘要·术语库 | 「注入开 / 注入关」+ 启用条目总数（`#glossary-total-badge`）+ 包总数「M 个库」 |
| 展开动画 | `grid-template-rows: 0fr → 1fr` + `opacity`，`--dur-base`(300ms) `--spring-soft` / `--ease-out-expo`；与设置页 `.fold-panel` **逐字相同** |
| 箭头 | `border` 画的 CSS 三角形，只转 `transform: rotate(0 → 90deg)`，同为 `--dur-base` |
| 收起不可聚焦 | 内容区 `inert`（不是只靠视觉隐藏）；首次渲染的收起态另有 `hidden` 省一次布局 |
| 状态持久化 | `chrome.storage.local` 的 **`yt_sub_popup_pack_sections`**，存 `{ scene: boolean, glossary: boolean }`（`true` = 展开）；**不写进 `ExtensionSettings`**，也不进翻译缓存键 |
| 降级 | `prefers-reduced-motion: reduce` 下过渡 1ms，展开即终态（不会停在 0fr） |

**功能一项没少**（只是被折叠起来，展开后原样都在）：场景卡片（使用 / 使用中 / 上传）、
「＋ 上传场景」、「＋ 上传术语库」、术语库「注入」总开关、包勾选（启用）、条目数徽标、
术语库预览、两份上传规范 `details`。

折叠时不重建列表（`syncPackSectionState()` 只切 class / `hidden` / `inert`），
所以勾选、选中态、上传按钮的状态都不会丢；摘要里的数字由 `renderSceneList()` /
`renderGlossaryPackList()` 顺带刷新，不会出现「列表变了摘要没变」。

### 11.2 模型下拉：预置型号彻底退出（问题 2）

| 状态 | 下拉里有什么 |
| --- | --- |
| 没拉过（`cached_models_<providerId>` 与旧 `cached_models_<service>` 都空） | **1 行「当前设置：<id>」+ 1 行禁用提示**「点右侧「获取模型列表」拉取可用模型」 |
| 拉过 | 「当前设置」行（若当前型号不在列表里）+ 拉到的全部型号 + 「手动输入其它自定义模型...」 |
| 当前厂牌是 Google 免费通道 | 整个 AI 配置区隐藏，下拉不动 |

- 数据源只有 `cachedModelsKey(providerId)`（读到空时回退旧的 `cachedModelsKey(provider.service)`）
  ∪ 当前 `modelName`；`PROVIDERS[].models` **不再补位**，`buildModelChoices()` 连 `provider` 参数都不再收；
- 「当前设置」那一行不是候选，是回显 —— 没有它 `<select>` 显示不出当前值，用户会以为没选模型；
- 手填路径保留：`#model-name` 输入框照旧可直接写任意 id；「手填入口」选项只在有真实列表时出现
  （没列表时它只会让人以为还有别的型号可选）。

### 11.3 按厂牌记住上次选的模型（问题 1）

切走前把当前 `modelName` 写进 `providerModelSelections[旧 providerId]`；切到新厂牌按
「记忆 → 当前型号本就属于它 → `provider.models[0]`」三级取值；手动选 / 手填也同步更新记忆。
`persistSettings()` 的整份 payload 带上 `providerModelSelections`（漏了它等于每次保存都清一次记忆）。
边界与存储清洗口径见 `docs/OPTIONS-0.4.0.md` §16.2。

### 11.4 验证与断言改动

| 项 | 结果 |
| --- | --- |
| `test-popup-ui.js` | 46 → **58**（新增 12 条：模型记忆三条 + 下拉口径两条 + 折叠分区七条） |
| 改口径的旧断言 | ①「模型下拉按厂牌取（`provider.models`）」→「不再用参考清单补位」；②「在线优先、参考补后、按 id 去重」→「缓存 ∪ 当前设置 + 禁用提示」 |
| 端到端（`D:\edge\_ui\fix5\`，真 Chrome headless） | 选 `deepseek-v4-pro` → 切 Claude（变 `claude-sonnet-5-5`）→ 切回 DeepSeek **仍是 v4-pro**；重开弹窗后再切一次仍能恢复；两个分区默认收起 / 展开 / 收起不可聚焦 / 刷新保持；无横向溢出、零 pageerror |

### 11.5 已知代价（登记不修）

1. **页签底部的空白更明显了**：`.tab-content` 的 `min-height: 320px` 地板还在（§7.1 的历史取舍，
   回退轮恢复、本轮不动），而两个分区改成折叠后「术语与场景」页内容更短，
   收起态与「效果实时预览」之间会留出地板与内容高度的差（截图里是那段空档）。
   **这是本轮折叠改动暴露出的观感问题**，要改就得动那条全局地板（会让页签切换时预览块上下跳），
   留给下一轮拍板。
2. **收起态的内容仍在 DOM 里**：为了让收起方向也有高度过渡（`0fr` ← 过渡而非直接隐藏），
   面板展开过一次之后就不再挂 `hidden`，改用 `inert` + `0fr` + 内层 `overflow: hidden`
   三重收口（实测收起高度 0、焦点进不去）。首次渲染的收起态仍带 `hidden`。
3. **折叠状态不同步设备**：只存 `chrome.storage.local` 的 `yt_sub_popup_pack_sections`，
   不进设置对象，所以换设备不会同步「收起着还是展开着」——刻意为之。

### 11.6 视频浮层移除「翻译场景」入口（任务五 · 问题 4）

> **浮层不再提供场景切换，场景只在扩展弹窗 / 设置页切换。**

| 项 | 取值 |
| --- | --- |
| 删掉的浮层模块 | 快捷面板第三个折叠模块 `data-accordion="scenario"`（标题「翻译场景」+ `#qp-badge-scenario` + 2 段 `.qp-smooth-switcher[data-switcher="scenario"]`） |
| 删掉的逻辑 | `syncQuickPanelValues()` 里的场景同步、`bindQuickPanelEvents()` 里的 `data-scenario` 点击绑定、「切换场景：xxx」toast |
| 浮层剩余折叠模块 | 双语排版模式 / 时间轴同步微调 / 推理思考深度（原第 4 个顺延为第 3 个） |
| 保留下来的只读展示 | 面板状态行「已就绪 (VTuber直播 · 2 句)」与右上角就绪徽章仍按 `settings.scenario` 显示当前场景名，只是不再提供入口 |
| 没动的部分 | `settings.scenario` 字段、UI 之外的所有调用方（弹窗 `#scenario-select` + 场景卡片、设置页「翻译场景」分区）一律不动 |
| CSS | 该模块没有任何专属选择器（`overlay-styles.ts` 里搜不到 `scenario`），所以**一行 CSS 都没删**；`.qp-accordion-*` / `.qp-smooth-switcher` 全是被剩下模块共用的规则 |
| 布局 | `.qp-view` 是 `flex-direction: column; gap: 8px`，少一个子元素后间距自动收敛为 8px，无需补偿 |




## 十二、设置页「自动降级 · 降级顺序」的动效与交互（v0.4.2）

> 结构、数据与执行链见 `docs/OPTIONS-0.4.0.md` §17；这里只记**动效与交互口径**。

### 12.1 它沿用同一套 disclosure 过渡声明（第六类）

| 项 | 取值 |
| --- | --- |
| 选择器 | `.depend-panel`（开关那一行 `.row-depend` 的第三块，换行占满一整行） |
| 展开 / 收起 | `grid-template-rows: 0fr → 1fr` + `opacity: 0 → 1` |
| 过渡 | `grid-template-rows var(--dur-base) var(--spring-soft), opacity var(--dur-base) var(--ease-out-expo)` —— 与 `.fold-panel` / `.provider-panel` / `.details-body` **逐字相同**（300ms） |
| 内层收口 | `.fallback-order-inner { min-height: 0; overflow: hidden }`（内边距不放这里，否则 0fr 会残留一条） |
| 首次收起 | HTML 带 `hidden`；`.depend-panel[hidden] { display: none }` 显式盖掉 `display: grid` |
| 收起不可聚焦 | JS 的 `panel.inert = !open`（与厂牌面板、两个 `.fold` 同一道保险） |
| reduced-motion | `transition: none !important` + `opacity: 1 / 0 !important`，直接以终态呈现 |

### 12.2 拖拽只动 transform / opacity

| 元素 | 动的地方 |
| --- | --- |
| 被拖行 `.is-dragging` | `transform: translateY(dy)`（跟手，`transition: none`）+ `opacity: .72` + 亮边 + `box-shadow` |
| 让位行 | `transform: translateY(±step)`，保留 `--dur-fast` 的 `transform` 过渡 → 平滑让位 |
| 插入指示线 `.fallback-drop` | 绝对定位 + 只写 `transform: translateY(y)`（`top: 0` 固定），`opacity` 切 `is-on` |
| 绝不出现 | `top / left / height / width / margin` 的过渡（`test-options-ui.js` 的「过渡只作用于允许的属性」守着） |

依据：`transition` 白名单仍是 `transform / opacity / grid-template-rows / max-height /
background-color / border-color / color`，本轮一个新属性都没加。

### 12.3 触控与键盘

- 手柄 `touch-action: none` + `user-select: none`：触控按住拖动不会把整页滚走；
- 手柄与 ↑ / ↓ 的**命中区 32px**（视觉 17px / 13px 的字形），用 `margin: -4px 0` 撑出来，
  行高仍是 36px 与厂牌行齐平 —— 沿用既定取舍「触控目标 32px，不按 44px 修正」；
- `:focus-visible` 给行加 `box-shadow` 焦点环（与 `.ctl:focus` 同一档 3px `rgba(255,255,255,.08)`）；
- 边界不 `disabled` 而用 `aria-disabled="true"` + `opacity: .35`：`disabled` 会让焦点掉回 body，
  键盘用户连按 ↑ 时会在第一格断掉。

### 12.4 一处有意为之

被拖行的位移**夹在列表范围内**（`[-from·step, (n-1-from)·step]`）。不夹的话把最后一行拖到
最上时，它会骑到「降级顺序」那行标题文字上（实测截图确认），看起来像行被画到了列表外面。
落点判定仍按未夹取的指针位移算，所以「拖到列表外」照样能落到第一 / 最后一格。
