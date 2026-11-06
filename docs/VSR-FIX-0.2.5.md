# v0.2.5 修复报告：开启插件后 RTX VSR 失效

> 日期：2026-11-04
> 基线：`油管翻译插件_v0.2.4`（已存档：`油管翻译插件_v0.2.4_archive_20261104_1455`）
> 修复版本：`油管翻译插件_v0.2.5`
> 问题：扩展启用后，YouTube 的 NVIDIA RTX Video Super Resolution (VSR) 不再激活。
>
> 目录说明（2026-11-06 迁移后）：文中的 `油管翻译插件_v0.2.x` 均为历史快照目录，只读参考；当前工作基线是
> `E:\Antigravity\youtube-translation-plugin`（Gitee 私有仓库，分支 master，tag v0.2.3 … v0.4.0，无 v0.3.0）。
> 引用代码位置时一律用仓库内路径：`entrypoints/content/overlay-styles.ts`、`test/test-vsr-styles.js`、`utils/control-bar-button.ts`。

---

## 一、结论

**根因不是插件调用了 GPU，而是 CSS 的 `backdrop-filter` 改变了 Chromium 的视频合成路径。**

- v0.2.4 的浮层样式包含 **15 条 `backdrop-filter` / `-webkit-backdrop-filter` 声明**（分布在 9 个组件：状态徽章、字幕框、工具坞、快捷面板、AI 提示条、预览微卡片、剧本抽屉、回到当前句胶囊、toast 提示）。
- 页面中只要存在带 `backdrop-filter` 的元素，Chromium 就无法把 `<video>` 交给独立视频叠加层（direct scanout / hardware overlay），而 NVIDIA VSR 依赖该呈现路径，于是被驱动判定为不可增强。
- 启动即存在的 `.status-indicator` 也带 `backdrop-filter`，所以**不需要等字幕出现**，扩展一加载 VSR 就会失效；字幕出现后 `.subtitle-box` 的毛玻璃会进一步稳定复现。

NVIDIA 官方论坛有同机制记录：

> “页面中只要有 `backdrop-filter: blur(1px)` 的元素，RTX VSR 就停止工作；影响范围取决于元素位置，某些只影响窗口化，某些连全屏也影响。”
> https://www.nvidia.com/en-us/geforce/forums/game-ready-drivers/13/556461/

---

## 二、实测证据（本机 RTX 3060 Laptop / 驱动 621.01 / Edge 156）

### 1. 样式侧

| 版本 | `backdrop-filter` 声明数 | 字幕框 computed style |
|---|---|---|
| v0.2.4 | 15（`blur(10px)` ~ `blur(24px)`） | `blur(16px) saturate(1.8)` |
| v0.2.5 | 0 | `none` |

### 2. GPU 侧（同一视频、同一 120s 片段、720p、窗口 2376×1228，视频显示 1668×938）

| 阶段 | 条件 | 平均功耗 | 平均 GPU 利用率 | 平均核心频率 |
|---|---|---|---|---|
| A | 无 `backdrop-filter`（v0.2.5 默认） | **89.74 W** | **43.8 %** | **2082 MHz** |
| B | 运行时注入 `backdrop-filter: blur(16px)` | **42.82 W** | **27.8 %** | **1605 MHz** |
| C | 移除注入，恢复无滤镜 | **98.43 W** | **48.1 %** | **2088 MHz** |

A/C 与 B 的唯一变量就是 `backdrop-filter`。功耗与核心频率接近腰斩，符合“VSR（Tensor Core 计算）被关闭”的特征；移除后立即恢复。
同时说明：**覆盖整块播放器的透明 host 本身不影响 VSR**，问题只在毛玻璃。

---

## 三、修复内容

### 1. 移除全部毛玻璃

`entrypoints/content/overlay-styles.ts`

- 删除 15 条 `backdrop-filter` / `-webkit-backdrop-filter`（状态徽章、字幕框、工具坞、快捷面板、AI 提示条、抽屉、预览等）。
- 保留原有 `rgba()` 高不透明度背景、边框、内外阴影，视觉上仍是深色卡片，只是不再实时模糊视频。
- 字幕原文/译文继续使用 `text-shadow` 保证可读性。

### 2. 移除视频上层的 `filter`

- `.sentence-ai-badge` 的 `filter: drop-shadow(...)` 删除。
- `utils/control-bar-button.ts` 的 `filter: drop-shadow(...)` / `filter: grayscale(...)` 改为 `box-shadow` 与 `opacity`。

### 3. 防回归

- `overlay-styles.ts` 顶部增加 VSR 兼容红线注释。
- 新增 `test/test-vsr-styles.js`：断言样式中**不存在** `backdrop-filter`（含 `-webkit-`）与任何 `filter`（含 `-webkit-filter`，即 `blur` / `drop-shadow` / `grayscale` 都在禁列），并检查字幕文字阴影兜底。
- 纳入 `npm test`。

判定口径（两点必须分清）：

1. 断言的是**样式声明数 = 0**，不是关键词出现次数。`overlay-styles.ts` 头注释用 2 行（共 3 次出现）的文字解释这条红线，属于说明文字、不带冒号，不计入声明；
   用朴素 `grep` / `Select-String` 计数会误报（按行计 2 处、按出现次数计 3 次），不能拿 `grep` 结果当红线结论。
   测试脚本改为显式统计声明数并断言 `=== 0`，同时在输出里打印两个计数，便于人工核对。
2. 分层：弹窗（`entrypoints/popup/style.css`）与设置页（`entrypoints/options/style.css`）允许 `backdrop-filter`，内容脚本（`entrypoints/content/**`）必须为 0。
   改样式前先确认文件属于哪一侧，「弹窗也有毛玻璃」不能作为给浮层加回来的理由。

---

## 四、验证方式

### 已实际执行

```text
npm run compile      → 0 error
npm test             → 断句 / 解析 / 设置清洗 / VSR 样式 / 场景配置 全部通过
npm run build:chrome → manifest 0.2.5，产物中 backdrop-filter 出现次数 = 0
```

> 口径说明：构建产物已被压缩、不含注释，因此「关键词出现次数 = 0」与「声明数 = 0」等价；源码侧仍以
> `test/test-vsr-styles.js` 统计的声明数为准（头注释含该关键词，按关键词计数会误报）。

Edge 运行时（TED 1080p，窗口化）：

```json
{
  "active": true,
  "orig": "我的思维变得混沌，但我没觉察到它很混沌，因为我的思维很混沌。",
  "backdropBox": "none",
  "backdropBadge": "none",
  "backdropDrawer": "none",
  "filterBox": "none"
}
```

GPU 对照见第二节，功耗/VSR 特征符合预期。

### 建议人工确认（NVIDIA 状态指示器）

1. NVIDIA App → 设置 → 视频 → 开启「RTX 视频增强 / Super Resolution」，并打开「在视频上显示状态指示器」。
2. 加载 `油管翻译插件_v0.2.5\.output\chrome-mv3`（当前基线对应 `youtube-translation-plugin\.output\chrome-mv3`），重启 Edge。
3. 打开 1080p 或 720p YouTube 视频，**窗口最大化**（视频显示尺寸需大于源分辨率），播放 10 秒。
4. 指示器应显示 **Active**；字幕正常显示。
5. 对照实验：在 DevTools 控制台给字幕框加回毛玻璃：
   ```js
   const sr = document.getElementById('yt-sub-translator-host').shadowRoot;
   const st = document.createElement('style');
   st.textContent = '.subtitle-box{backdrop-filter:blur(16px)!important}';
   sr.appendChild(st);
   ```
   指示器应在 1~2 秒内变为 **Inactive**；删除该 `<style>` 后恢复 **Active**。
6. 全屏/窗口化各测一次（NVIDIA 论坛提到不同元素对全屏影响不同）。

---

## 五、边界与注意事项

1. **其他扩展/网页也可能带 `backdrop-filter`**：如果 v0.2.5 仍不激活，请用 DevTools 搜索页面所有元素（含 shadow DOM）的 `backdrop-filter`，或临时禁用其他扩展对照。
2. **VSR 需要视频显示尺寸小于输出分辨率**：窗口很小时不会触发，验证请最大化或全屏。
3. **VSR 激活状态无法通过浏览器 API 读取**：本报告用 GPU 功耗/频率作为客观代理指标，最终以 NVIDIA 指示器为准。
4. **视觉变化**：毛玻璃改为高不透明度纯色卡片，这是为 VSR 做的有意取舍；如未来想恢复模糊，必须提供“VSR 兼容模式”开关并默认关闭模糊。

---

## 六、变更文件

| 文件 | 变更 |
|---|---|
| `entrypoints/content/overlay-styles.ts` | 删除 15 条 backdrop-filter；删除 AI 徽章 drop-shadow；增加 VSR 红线注释 |
| `utils/control-bar-button.ts` | filter 改为 box-shadow / opacity |
| `test/test-vsr-styles.js` | 新增防回归断言 |
| `package.json` / lock / `wxt.config.ts` / banner / popup | 版本号 0.2.5 |
| `docs/VSR-FIX-0.2.5.md` | 本报告 |
