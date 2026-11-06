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
| `.preview-sub` 过渡 | 「只动 transform / opacity」 | `options/style.css` 仍 `transition: bottom`，而 `main.ts` 已改用 `top` → 该过渡永不触发 | 属任务四与任务五交界处的历史残留，改它会动预览动效手感 |
| 档名 | 早期引用写作 `UI-1.3.0.md` | 本任务对应文档就是 `docs/UI.md`（正文标题已是 v0.3.0），仓库里不存在 `UI-1.3.0.md` | 只在资料库侧修正引用，仓库不改名，避免历史链接断裂 |

---

## 六、回退方式

`style.css` 末尾的「v0.3.0 · UI 动效与视觉规范层」是**后置覆盖块**，整段删除即回到 v0.2.9 视觉；
令牌改动（`:root`）与开关 `scaleX`、页签 ARIA 属就地修改，回退需按 `CHANGELOG` 对应条目反向操作。
