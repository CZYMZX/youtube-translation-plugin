# 厂牌与模型清单（PROVIDER-MODELS）

> 口径日期：**2026-11-07**（按各厂商官方文档 / 定价页 / 模型列表页逐条核对）
> 代码位置：`utils/models.ts`（唯一真相）、`utils/provider-icons.ts`（厂牌图标）
> 相关文档：`docs/OPTIONS-0.4.0.md` §10（设置页的层级与交互）

这份文档只回答三件事：**有哪些厂牌、每个厂牌下有哪些模型、怎么把这份清单更新到下一个月**。
不要在别处再抄一份清单 —— 界面、测试、文档都从 `PROVIDERS` 派生。

> **清单性质（必读）**：下面所有表格是**内部参考清单**（默认模型 / 归属判断），
> **不再是任何模型下拉的列表来源**。界面里的可选型号只来自「获取模型」拉到的实际列表
> （`cached_models_<providerId>`）与用户自定义模型；未获取时下拉里只剩「当前设置」那一行
> 与一句「去获取」的提示。口径见 §二 与 §五。
> 与 `docs/OPTIONS-0.4.0.md` §14 是同一套说法。

---

## 一、厂牌表

| providerId | 名称 | 请求用 service | 默认端点（defaultBaseUrl） | 模型数 |
| --- | --- | --- | --- | --- |
| `deepseek` | DeepSeek | `deepseek` | `https://api.deepseek.com/v1` | 2 |
| `openai` | OpenAI | `openai` | `https://api.openai.com/v1` | 4 |
| `gemini` | Google Gemini | `gemini` | *（留空，走官方 SDK 自己的路径）* | 4 |
| `claude` | Anthropic Claude | `openai` | `https://api.anthropic.com/v1` | 4 |
| `qwen` | 阿里云通义千问 | `openai` | `https://dashscope.aliyuncs.com/compatible-mode/v1` | 3 |
| `kimi` | Moonshot Kimi | `openai` | `https://api.moonshot.cn/v1` | 2 |
| `zhipu` | 智谱 GLM | `openai` | `https://open.bigmodel.cn/api/paas/v4` | 3 |
| `google-free` | Google 免费翻译 | `google` | *（不需要）* | 0（免 Key、免模型） |

> 表中「模型数」是**内部参考清单**的条数（= 每家的默认模型来自这里），
> 不等于界面里能选的型号数：界面只渲染「获取模型」拉到的列表 + 自定义模型，见 §二。

### 为什么 service 和 providerId 不是一回事

请求层（`utils/translator.ts`）只认 4 个协议出口：`google` / `gemini` / `openai` / `deepseek`。

Claude、通义、Kimi、GLM 都提供 **OpenAI 兼容协议**，所以它们的 `service` 是 `openai`，
靠各自的 `defaultBaseUrl` 区分端点。这带来两条硬约束：

1. **选模型时必须把 `apiBaseUrl` 一起写进设置**，否则请求会打到 `api.openai.com` 上
   （401 看着像 Key 错，其实是端点错）。
2. **Key 不能只按 service 记**，必须按 `providerId` 记 —— 否则四家会共用同一格 Key，互相覆盖。

这就是「Key 跟随所选模型厂商分别配置」（`providerKeys`）存在的原因。

---

## 二、模型清单与定位（**内部参考，不是 UI 列表**）

`note` 只写**定位**（推荐 / 最快 / 最省 / 最强 / 便宜），不写广告语。

### 2.1 `PROVIDERS[].models` 现在只做三件事

| 用途 | 位置 |
| --- | --- |
| 每家厂牌的**默认模型**（`models[0]`，用户从没选过时用它） | 弹窗 `applyProviderSelection` / 设置页 `nextModelFor` / 切厂牌补丁 / 删除自定义模型后的回落 |
| **归属判断**：某个 model id 属于哪个厂牌 | `providerHasModel()` / `findProviderByModelId()` |
| 派生给老调用方的扁平清单 `PRESET_MODELS` | 仍导出，但**没有任何界面读它渲染列表** |

**它不再被渲染成下拉 / 模型行。** 曾经的写法是「下拉 = 在线列表 + 参考清单补位」，
结果就是用户截图里的那个 bug：选了 OpenAI、端点指向中转站，下拉里仍混着 `gpt-*` 预置型号，
点一个必然 404。现在界面列表只有两个来源：

1. 「获取模型」拉到的 `cached_models_<providerId>`（真正可用的）；
2. `settings.customModels` 里挂在该厂牌下的自定义条目。

外加一行**必须保留**的「当前设置：<id>」—— 否则 `<select>` 显示不出当前值，
用户会以为自己没选模型（这一行不是候选，是「我现在用的是这个」的回显）。

### 2.2 未获取模型时，用户该怎么选（正确路径）

| 场景 | 界面长什么样 | 用户该做什么 |
| --- | --- | --- |
| 弹窗，该厂牌没拉过 | 模型下拉只有 1 行「当前设置：<当前模型>」+ 1 行**禁用提示**「点右侧「获取模型列表」拉取可用模型」 | 填好 Key → 点「获取模型列表」→ 从真实列表里选 |
| 弹窗，已经拉过 | 下拉 = 当前设置行 + 拉到的全部型号 + 「手动输入其它自定义模型...」 | 直接选 |
| 设置页，该厂牌没拉过且不在用 | 模型区只有空态提示「还没获取过模型列表…」+ 工具条按钮 | 点「获取模型」（或「＋ 自定义模型」手填 id） |
| 设置页，该厂牌正在用 | 只有一行「当前设置：<id>」+「当前设置 · 未在列表」 | 要么去拉列表，要么保持现状 |

「手填 model id」这条路径**一直都在**：弹窗是 `#model-name` 输入框，设置页是
「＋ 自定义模型」弹层（会存进 `customModels`，长期保留）。所以「不显示预置清单」
不等于「没法用清单外的型号」。

### 2.3 各厂牌的参考清单（仅用于默认值与文档核对）

### DeepSeek

| model id | 显示名 | 定位 |
| --- | --- | --- |
| `deepseek-flash` | DeepSeek V4.1 Flash | 推荐 |
| `deepseek-v4-pro` | DeepSeek V4 Pro | 最强推理 |

### OpenAI

| model id | 显示名 | 定位 |
| --- | --- | --- |
| `gpt-6.1-sol` | GPT-6.1 Sol | 推荐 |
| `gpt-6-luna` | GPT-6 Luna | 最快最省 |
| `gpt-6.1-terra` | GPT-6.1 Terra | — |
| `gpt-6-astra` | GPT-6 Astra | 最强 |

### Google Gemini

| model id | 显示名 | 定位 |
| --- | --- | --- |
| `gemini-3.8-flash` | Gemini 3.8 Flash | 推荐 |
| `gemini-3.1-flash-lite` | Gemini 3.1 Flash Lite | 最省 |
| `gemini-3.1-pro-preview` | Gemini 3.1 Pro (预览) | 最强 |
| `gemini-3-flash` | Gemini 3 Flash | — |

### Anthropic Claude

| model id | 显示名 | 定位 |
| --- | --- | --- |
| `claude-sonnet-5-5` | Claude Sonnet 5.5 | 推荐 |
| `claude-haiku-5-5` | Claude Haiku 5.5 | 最省 |
| `claude-opus-5-5` | Claude Opus 5.5 | 最强 |
| `claude-fable-5-1` | Claude Fable 5.1 | 顶级 · 较贵 |

### 阿里云通义千问

| model id | 显示名 | 定位 |
| --- | --- | --- |
| `qwen3.8-flash` | Qwen3.8 Flash | 推荐 |
| `qwen3.7-plus` | Qwen3.7 Plus | — |
| `qwen3.8-max` | Qwen3.8 Max | 最强 |

### Moonshot Kimi

| model id | 显示名 | 定位 |
| --- | --- | --- |
| `kimi-k2.6` | Kimi K2.6 | 推荐 · 便宜快 |
| `kimi-k3` | Kimi K3 | — |

### 智谱 GLM

| model id | 显示名 | 定位 |
| --- | --- | --- |
| `glm-5.3-flash` | GLM-5.3 Flash | 推荐 |
| `glm-5.3` | GLM-5.3 | — |
| `glm-5.2` | GLM-5.2 | — |

### Google 免费翻译

不需要模型 id、不需要 Key。选中即 `service='google'`，由
`translate.googleapis.com` 的免费接口逐句翻译（会自动降级到备用域名）。

---

## 三、Key 从哪申请（只给官网入口）

| 厂牌 | 入口 |
| --- | --- |
| DeepSeek | <https://platform.deepseek.com/api_keys> |
| OpenAI | <https://platform.openai.com/api-keys> |
| Google Gemini | <https://aistudio.google.com/apikey> |
| Anthropic Claude | <https://console.anthropic.com/settings/keys> |
| 阿里云通义千问（百炼） | <https://bailian.console.aliyun.com/> |
| Moonshot Kimi | <https://platform.moonshot.cn/console/api-keys> |
| 智谱 GLM | <https://open.bigmodel.cn/usercenter/apikeys> |

设置页里每个厂牌展开后的 Key 输入框下方有同一个链接。
**Key 只写进本机浏览器存储**（`chrome.storage`，本扩展走 local/sync 降级路径），不上传任何服务器。

---

## 四、数据怎么存

| 设置项 | 形状 | 说明 |
| --- | --- | --- |
| `providerId` | `string` | 当前使用的厂牌，默认 `'deepseek'` |
| `service` | `'google' \| 'gemini' \| 'openai' \| 'deepseek'` | 真正发请求的协议出口 |
| `modelName` | `string` | 当前模型 id |
| `apiKey` / `apiBaseUrl` | `string` | **当前生效**的那把 Key / 那个端点（请求层只读这两个） |
| `providerKeys` | `Record<providerId, string>` | 每个厂牌各存一把；当前厂牌那格以 `apiKey` 为准，两边一起写 |
| `providerBaseUrls` | `Record<providerId, string>` | 端点覆盖值；空 = 用 `defaultBaseUrl` |
| `providerModelSelections` | `Record<providerId, string>` | **按厂牌记住上次选的模型**（切走留底、切回恢复）；不校验是否还在清单里，手填 id 也能恢复 |
| `autoFallbackToGoogle` | `boolean`（默认 `true`） | 「自动降级」总开关：false = 主通道失败后一次都不降级 |
| `fallbackOrder` | `string[]`（providerId，默认 `[]`） | **降级顺序**：数组顺序即优先级（高 → 低）。`[]` = 现有行为（失败直接降级 Google 免费）；非空 = 逐级降级，最后仍以 Google 免费兜底。`utils/storage.ts#sanitizeFallbackOrder` 只留合法厂牌 id、去重、上限 8 |
| `customModels[].providerId` | `string` | 自定义条目挂在哪个厂牌下（老条目按 service 主厂牌补） |
| `cached_models_<providerId>` | `ModelOption[]`（`chrome.storage.local`） | 「获取模型」拉到的在线列表 |

**老数据迁移**（`utils/storage.ts#sanitizeSettings`）：
`service` + `apiKey` → `providerId`（按 service 主厂牌落位）+ `providerKeys`；
`serviceKeys` / `baseUrls` 里的旧值按 service 映射到对应厂牌，**只在目标格为空时**写入；
迁完这两个旧字段从输出里删除，不再写回。

### 降级顺序怎么执行（`fallbackOrder`）

主通道抛错（网络 / HTTP，即传输级失败）后，`utils/translator.ts` 按这张表往下走：

```
noFallback（测试连接 / AI 深度全篇） → 抛真实错误
autoFallbackToGoogle === false      → 不降级
fallbackOrder 为空                  → 直接降级 Google 免费（v0.4.1 行为，默认）
fallbackOrder 非空                  → 按顺序逐级试 → 全部失败再落 Google 免费
```

每一级用**该厂牌自己的** `providerKeys[pid]` + `providerBaseUrls[pid] || defaultBaseUrl` +
`providerModelSelections[pid] || models[0]`，跳过「当前正在用的厂牌」和「没配 Key 的厂牌」。
每级只发一次请求（失败直接进下一级，不逐句重试），降级链内部禁止再次降级 ——
最坏请求量是 `1 + 候选数 + 1`，与句数无关。口径细节见 `docs/TRANSLATOR-RETRY.md` §九–§十三。

> 注意：`fallbackOrder` **不进缓存键**（它不改变译文风格，只决定失败后找谁），
> 所以改顺序不会让任何旧译文失效；降级成功的译文写在**主通道的缓存键**下，下次直接命中。

---

## 五、怎么更新这份清单

### 场景 A：某厂牌发了新模型（最常见）

1. 在 `utils/models.ts` 的 `PROVIDERS` 里找到那个厂牌，往 `models` 数组加一条
   `{ id, label, note? }`：
   - `id` 必须与厂商文档里的 model id **逐字符一致**（区分大小写、区分点号）；
   - `label` 是给人看的短名，需要能一眼区分代次；
   - `note` 只写定位（推荐 / 最省 / 最强 / 最快 / 便宜），不写广告语。
2. 如果新模型替代了旧的推荐位，把 `note: '推荐'` 从旧条目移到新条目上（推荐位只能有一个）；
   想让新模型成为该厂牌的**默认模型**，就把它放到 `models` 数组第一位（`models[0]`）。
3. 跑 `npx tsx test/test-options-ui.js`：`PRESET_MODELS 与 PROVIDERS 完全一致` 那条会自动校验
   派生结果；**不需要**改弹窗或设置页的列表渲染（界面不读这份清单）。
4. 在本文档 §2.3 对应表格里加同一行（文档与代码必须同源，不然后人没法核对）。

### 场景 B：模型下线 / 改名

1. 从 `models` 数组里**删掉**（不要留着当「兼容条目」——用户点了就是 404）。
2. 如果这是某厂的唯一模型，先在同一 PR 里补上新模型，避免该厂牌没有默认模型。
3. **用户界面本来就不会因为它下架而 404**：列表只放「获取模型」拉到的实际型号，
   参考清单早就退出渲染（见 §2.1）。更新 `PROVIDERS` 的意义变成了「默认模型别指向下架型号」。
4. **用户已经在用的下架型号不会被清掉**：`settings.modelName` 不在任何列表里时，
   设置页仍会显示一行「当前设置：<id>」并保持选中，标「当前设置 · 未在列表」。
   等用户自己换掉或重新配置，这是刻意设计，不要"顺手清理"。

### 场景 C：新厂牌接入

1. 先确认它是否提供 **OpenAI 兼容**端点（`/chat/completions`）：
   - 是 → `service: 'openai'` + 自己的 `defaultBaseUrl`，不需要改请求层；
   - 否 → 需要新增协议分支（`utils/translator.ts`），属于另一类改动。
2. 在 `PROVIDERS` 末尾（`google-free` 之前）加入厂牌条目。
3. 图标：把官方 `@lobehub/icons-static-svg` 里的对应 svg 路径补进
   `utils/provider-icons.ts`（**直接用原始路径，不要重绘**）；没有图标就把 `iconKey` 留空，
   `providerIconHtml` 会用厂牌名首字母兜底。
4. 同步更新本文档 §一 / §二 / §三。

### 核对方式（不改代码就能验证真实可用型号）

设置页 →「服务与模型」→ 展开目标厂牌 → 填 Key → 点 **获取模型**：

- 拉到的是**该厂牌自己**的模型列表，缓存到 `cached_models_<providerId>`；
- **这份就是列表本身**：界面模型行 = 实际列表 ∪ 自定义模型（按 id 去重）
  ∪「当前设置」那一行；参考清单一个字都不渲染；
- 边界：有缓存 → 只显示缓存里的；**无缓存 / 缓存为 `[]` → 0 行 + 空态提示**
  （不再拿参考清单兜底）；正在使用的型号始终保留一行；
- 如果接口返回了清单里没有的新型号，就地选中即可用（不需要先改代码）；
- 想核对「默认模型该不该更新」时才需要看 `PROVIDERS`（场景 A / B）。

> 注意：Gemini 的「获取模型」走官方 `models` 接口；Claude 走 OpenAI 兼容层。
> 两家的接口都可能因为 Key 权限（只授权了部分模型）而返回更短的列表 —— 那是账户限制，不是清单错误。
> 因为「列表就是实际列表」，权限不足时界面会如实只显示那几个型号。

### 测试连通性的正确口径（不是「拉一次模型列表」）

设置页 →「服务与模型」→ 展开目标厂牌 → 工具条里的 **测试连通性**
（按钮 `btn-test-provider-<厂牌>`，旧的服务分区全局按钮 `#btn-test-service` 已删除）：

| 项 | 口径 |
| --- | --- |
| 测什么 | 该厂牌下**实际渲染的每个模型**（含自定义模型），逐个用一句英文样例真实翻译一次 |
| 怎么测 | `TRANSLATE_BATCH` + `noFallback: true` + `bypassCache: true`，量真实往返耗时；**不走 `/models` 列表测速** —— 中转站不一定实现该端点，量到的也不是翻译耗时 |
| 顺序 | 串行，一个测完再测下一个；中途重开 / 切厂牌时旧循环由 `runToken` 失效保护停手 |
| 超时 | 15s 没回调按失败处理，不会一直停在「测试中」 |
| 结果 | 显示在**模型名后面**：成功 `${ms} ms`，<600 极速 / <1800 良好 / 其余较慢；失败显示「失败」 |
| 落盘 | **不落盘**：只用临时 settings（展开当前设置、只换 `modelName`），不写 `chrome.storage`，结果只存在本次会话内存里；`providerId` / `modelName` / `apiKey` 都不变 |

与 `docs/OPTIONS-0.4.0.md` §14 同一套说法。

---

## 六、为什么移除这些旧型号

| 已移除 | 原因 |
| --- | --- |
| `deepseek-chat`、`deepseek-reasoner` | 2026-07-24 起官方停用，改名并合并进 `deepseek-flash` / `deepseek-v4-pro` |
| `gpt-4o`、`gpt-4o-mini` | 已被 GPT-6 系列替代；保留会让「推荐」指向一个更贵更慢的型号 |
| `gemini-1.5-flash`、`gemini-1.5-pro` | 1.5 代已下线 |
| `gemini-2.0-flash-exp` | 实验型号，早已停止对外提供 |
| `claude-sonnet-4-6` | 5.5 代已取代；4.6 在新的计费与上下文口径下不再是推荐 |
| 旧 `openai` 分组里的 `gemini-*` / `claude-*` 混装条目 | 当时只按协议分组，把别家模型塞进了 OpenAI 组；现在按厂牌分层，模型只在它自己的厂牌下出现 |

一并修掉的还有 `utils/translator.ts` 里两个兜底型号（`deepseek-chat`、`gpt-4o-mini`、
`gemini-1.5-flash` → 现在分别是 `deepseek-flash`、`gpt-6.1-sol`、`gemini-3.8-flash`）——
用下架型号做兜底，等于必然 404。

---

## 七、图标

- 来源：<https://lobehub.com/zh/icons>，包 `@lobehub/icons-static-svg` v1.102.0（MIT）。
- 处理：只去掉根 `<svg>` 与 `<title>`，**保留原始路径**；单色版继承 `currentColor`，
  深浅两套主题共用一份。
- 不要重绘、不要加新图标、不要用 `<img>` / icon font / base64。
- `google-free` 没有独立品牌图标，也不拿 Gemini 的星芒冒充 —— 用圆底字母 `G` 兜底。
- 品牌图形版权归各厂商，这里仅用于标识对应服务商，不构成任何背书。
