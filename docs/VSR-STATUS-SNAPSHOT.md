# v0.2.4 现状留档：YouTube 开启插件后 RTX VSR 失效

> 留档时间：2026-11-04 14:55 (GMT+8)
> 对应版本：`E:\Antigravity\油管翻译插件_v0.2.4`（版本号 0.2.4）
> 用途：记录问题发生时的插件配置、运行环境、复现步骤与初步证据，作为后续修复基线。

---

## 一、运行环境

| 项 | 值 |
|---|---|
| 操作系统 | Windows 11 家庭版 中文版 |
| GPU | NVIDIA GeForce RTX 3060 Laptop GPU（6144 MiB） |
| 显卡驱动 | 621.01 |
| 浏览器 | Microsoft Edge 156.0.4314.58 |
| 扩展版本 | 0.2.4（`.output/chrome-mv3`，Manifest V3） |
| 视频场景 | YouTube 普通视频 / 直播回放，窗口化播放，非全屏 |

> 备注：RTX VSR 需要 RTX 20/30/40 系以上、驱动 531.18+、浏览器 110+、开启硬件加速。
> 当前环境全部满足，且关闭插件时 VSR 可正常激活。

---

## 二、插件当前配置（DEFAULT_SETTINGS）

| 配置项 | 值 |
|---|---|
| enabled | true |
| targetLang | zh-CN |
| service | google |
| scenario | vtuber |
| reasoningEffort | low |
| pauseThreshold | 450 ms |
| maxWordsPerSentence / minWords | 16 / 3 |
| maxDurationMs | 6500 |
| autoPunctuation | true |
| displayMode / layoutOrder | bilingual / translation_top |
| fontSize / bgOpacity | 20 / 75 |
| bgColor / origColor / transColor | #0f172a / #e2e8f0 / #38bdf8 |
| offsetY / syncOffsetMs | 82 / 0 |
| autoHideNativeSubtitles | true |
| autoFallbackToGoogle | true |

---

## 三、复现步骤

1. 在 NVIDIA App 或 NVIDIA 控制面板中开启 **RTX Video Super Resolution**，并打开“在视频上显示状态指示器”（便于判断激活状态）。
2. 确认 Edge 设置中「使用图形加速」已开启；重启 Edge。
3. 在 `edge://extensions/` 加载 `油管翻译插件_v0.2.4\.output\chrome-mv3`，确认扩展启用。
4. 打开任意 1080p 及以下分辨率的 YouTube 视频（窗口化，非全屏），保持标签页在前台。
5. 观察 NVIDIA 状态指示器：
   - 扩展启用时：指示器显示 **Inactive / 不激活**，画面为浏览器默认缩放。
   - 禁用扩展并刷新页面后：指示器显示 **Active**，画面明显更锐利。
6. 可重复切换扩展开关验证，结果稳定复现。

---

## 四、当前观察与初步证据

### 1. 现象

- 只要扩展启用，无论字幕是否已经出现，VSR 都不激活。
- 全屏状态下偶有不同表现（NVIDIA 论坛也有“仅全屏生效”的报告），但窗口化稳定失效。

### 2. 代码侧事实

`entrypoints/content/overlay-styles.ts` 中存在 **15 条 `backdrop-filter` / `-webkit-backdrop-filter` 声明，分布在 9 个组件**，覆盖：

- `.status-indicator`（状态徽章，`blur(16px)`，启动后即存在于 DOM）
- `.subtitle-box`（字幕卡片，`blur(16px) saturate(180%)`，播放时持续显示）
- `.controls-bar`（悬浮工具坞，`blur(20px) saturate(160%)`）
- `.quick-panel`（快捷面板，`blur(24px) saturate(180%)`）
- `.qp-ai-banner`（`blur(14px)`）
- `.qp-preview-micro-card`（预览微卡片，`blur(10px)`）
- `.transcript-drawer`（剧本抽屉，`blur(24px) saturate(180%)`）
- `.drawer-sync-btn`（回到当前句胶囊，`blur(16px)`）
- `.toast-notification`（toast 提示，`blur(16px)`）

> 复核口径（按仓库 tag `v0.2.4` 的 `overlay-styles.ts` 实测）：带 `-webkit-` 前缀的成对写法 6 组 + 单条写法 3 处 = **15 条声明 / 9 个组件**。
> 留档时写的「10 处」是组件数量级的估读，与「15 条声明」不是同一个口径，引用时请按 15 条声明（9 个组件）表述。

同时 `overlay.ts` 在播放器内挂载了一个覆盖整块视频的宿主：

```ts
this.host.id = 'yt-sub-translator-host';
this.host.style.position = 'absolute';
this.host.style.top = '0';
this.host.style.left = '0';
this.host.style.width = '100%';
this.host.style.height = '100%';
this.host.style.pointerEvents = 'none';
this.host.style.zIndex = '85';
this.host.style.overflow = 'hidden';
```

> 复核（`entrypoints/content/overlay.ts` 的 `mount()`）：宿主是用 `top/left = 0` + `width/height = 100%` 铺满播放器，
> 并没有使用 `inset: 0`；`pointerEvents = none` / `zIndex 85` / `overflow hidden` 与留档一致。

### 3. 外部证据

NVIDIA 官方论坛（GeForce Forums）有明确复现记录：

> 页面上只要存在带 `backdrop-filter: blur(1px)` 的元素，RTX VSR 就会停止工作；
> 具体影响范围取决于元素位置——某些元素只影响窗口化，某些连全屏也影响。

链接：`https://www.nvidia.com/en-us/geforce/forums/game-ready-drivers/13/556461/`

### 4. 初步判断

`backdrop-filter` 会强制 Chromium 把视频与页面内容一起合成（无法走硬解视频叠加层 / direct scanout），
而 NVIDIA VSR 依赖该视频呈现路径。插件虽未直接调用 GPU，但通过 CSS 改变了浏览器的合成方式，从而“间接关闭”了 VSR。

---

## 五、留档时的构建与验证状态

- `npm run compile`：通过
- `npm test`：4 个测试文件（5 组用例）通过
- `.output/chrome-mv3` / `.output/edge-mv3`：manifest 均为 0.2.4
- Edge 实测：字幕、抽屉、popup 均正常；本问题为 GPU 呈现层问题，不影响字幕功能本身

---

## 六、后续修复基线

- 本文件与当前目录已完整复制到 `油管翻译插件_v0.2.4_archive_20261104_1455`。
- 后续修复在独立目录 `油管翻译插件_v0.2.5` 进行，本目录保持不变，便于对照与回滚。
