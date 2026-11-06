# 术语库缓存标签：按内容判定（v0.4.1）

日期：2026-11-06（基线 HEAD `9b657bf`，package.json 0.4.0 未动）
涉及文件：`utils/glossary.ts`、`utils/packs.ts`（术语数据区）、`utils/translator.ts`（仅 `getGlossaryTag` 函数体）、`test/test-glossary.js`、`test/test-packs.js`

---

## 一、修的是什么问题

改前结构：

```
GLOSSARY_VERSION = '2026-11-04.1'          // 三包共用一个手工字符串，停在 2026-11-04
getGlossaryTag() = `${GLOSSARY_VERSION}|${启用包id}|${自定义包 id:条目数}`
```

两个漏点：

1. **内置三包共用一个人工 bump 的字符串**。术语维护最常见的形态是「条数不变、只改译名」（例：`ヒツジ` 的译名从「羊」订正为「绵羊」）。这种修正条数一样、版本号靠人记着改；忘了 bump 就**不会让旧译文失效**，用户继续看到旧译名，新旧译名混用。
2. **自定义包指纹只有 `id:条目数`**。用户在术语库编辑器里把一个译名改掉、条数不变 → 指纹一模一样 → 缓存全部命中 → 编辑看起来「没生效」。

## 二、改后结构

```
tag = {scheme}.{matcherRev}|{启用包id(排序)}|{启用内置包 id:内容hash(包序)}|{启用自定义包 id:内容hash(排序)}

例（默认设置）：
g1.1|vtuber-hololive|vtuber-hololive:13vfi4w-15n3re|
例（启用 MC）：
g1.1|mc,vtuber-hololive|vtuber-hololive:13vfi4w-15n3re,mc:k2izfp-12e3fkt|
例（自定义包改一个译名，条数不变 → 只有末段变）：
g1.1|custom-x,vtuber-hololive|vtuber-hololive:13vfi4w-15n3re|custom-x:eza9my-1k1d7w
g1.1|custom-x,vtuber-hololive|vtuber-hololive:13vfi4w-15n3re|custom-x:1j7sa8h-bvkzed
```

| 段 | 含义 | 变化条件 |
|---|---|---|
| `scheme`（`g1`） | 指纹算法 / 标签拼装格式的版本 | 只有换算法时改（一次性全失效，避免新旧 fingerprint 混算） |
| `matcherRev`（`1`） | 匹配 / 门控逻辑修订号 | **只改匹配规则、数据没动**时必须手工 bump（内容 hash 察觉不到逻辑变化） |
| 启用包 id | 排序后的启用列表 | 勾选 / 取消包 |
| 内置包段 | `id:内容hash`，只含**已启用**的包 | 该包任一条目的 `ja` / `zh` / `category` / `needsContext` 变化 |
| 自定义包段 | `id:内容hash`，只含**已启用**的包 | 同上（含条数变化，含只改译名） |

指纹算法：`hashGlossaryContent()`（`utils/glossary.ts`）= djb2 + FNV-1a 两条独立 32 位散列拼成 `xxxx-xxxx`，字段间插 `\u0001`、条目间 `\u0002` 防拼接歧义。

**喂进 hash 的字段**：`ja`、`zh`、`category`、`needsContext` —— 这四项任一变化都会改变注入结果（`ja` 决定命中、`zh` 决定译名、`category` 决定 prompt 里的分类标签、`needsContext` 决定是否注入）。
**刻意不喂的字段**：`en`、`source`、`sourceType`、`id` —— 只用于溯源与检索，不进 prompt、不参与匹配；修一个失效 URL 不该烧掉全库缓存。
**顺序敏感**：条目顺序变化会让指纹变（同长度词在「≤40 条」截断处谁先谁后可能不同），因此按「宁多失效」处理。

## 三、影响面（谁会重译）

缓存键 = `service:model:scenarioId#promptHash:reasoning:targetLang:text[:glossaryTag]`（`utils/db-cache.ts#buildSentenceCacheKey`）。
术语标签是**按设置/按批**生成的，**不区分本句是否命中术语** ⇒ 键一变，**所有走了术语注入配置的句子**都换键，而不只是「含术语的句子」。

| 用户状态 | 本轮升级后 | 之后的行为 |
|---|---|---|
| `glossaryEnabled = false` | **完全不受影响**（`getGlossaryTag()` 返回 `''`，键里没有术语段） | 一直不受影响 |
| 默认（只启用 VTuber 包） | 全部句子换键 → 首看重译一次（API 成本一次） | 只有在 VTuber 包内容/启用列表/匹配规则变化时才失效 |
| 只启用 MC / AI 包 | 同上，一次 | 这两包内容不动就长期稳定；改它们才失效 |
| 只用自定义包 | 同上，一次 | **这正是本轮修复点**：以后改译名（哪怕条数不变）立即失效 |
| MC 包内容变动但用户没启用 MC | **不失效**（改前会失效——旧 `GLOSSARY_VERSION` 是全局的） | — |

判断依据：标签只由「已启用包的内容指纹 + 启用列表 + scheme/matcherRev」构成，且 `translator.ts` 在 `planBatch()` / `commitBatch()` / `translateSentenceBatch()` 三处对**每一条句子**都用同一个 `getGlossaryTag(settings)` 拼键，没有「先匹配再决定要不要带标签」的分支。

代价与取舍：
- 一次术语订正 = 全库重译一次。这是「批级 prompt」的必然结果：一批句子的 system prompt 里含该批命中术语，逐句无法精确归因，随批波动。若要更细（只让命中的句子失效），得在查缓存**前**先跑匹配、把「本句命中条目的指纹」塞进键——那会改动翻译主链路与批语义，本轮不做（记入问题清单）。
- 旧译文不报错，只是不再被命中，由 IndexedDB 30 天 TTL 自然淘汰；想立刻回收空间可用「清空翻译缓存」。
- 自定义包内容改动经 `refreshPacksIfStale()` 的 10s TTL 才进入 `activeCustomPacks` ⇒ **编辑后最多 10 秒才生效**（既有行为，本轮未改）。

## 四、以后改术语的规矩（给维护者）

| 只改了什么 | 要不要手工 action |
|---|---|
| 任意包的 `ja` / `zh` / `category` / `needsContext` | 不用，内容 hash 自动失效 |
| 包的 `source` / `en` / 描述 / 包名 | 不用（不影响译文，也不该失效） |
| 包增删、启用列表变化 | 不用 |
| **匹配规则**（单字边界、`needsContext` 逐句判定与「≥1 条普通术语」门槛、`≤40` 截断、长词优先） | **必须 bump `GLOSSARY_MATCHER_REVISION`**（`utils/glossary.ts`） |
| 标签拼装格式 / hash 算法 | 改 `GLOSSARY_TAG_SCHEME` |

## 五、测试覆盖

`test/test-glossary.js` 测试 8（+9 项）与 `test/test-packs.js` 测试 6（+18 项），核心断言：

- **条数不变、只改译名 → 指纹/标签变**（两处都断言；含「连译名长度都不变」的严格用例）
- 条数不变、改分类 / 改 `ja` → 变
- 只改 `source` / `en` → **不变**（元数据不烧缓存）
- 加一条 / 调换顺序 → 变
- `ja`/`zh` 错位拼接不撞（分隔符生效）
- 三包指纹互不相同；默认标签只含已启用的包；启用列表顺序无关；未启用包的内容变化不影响标签
- 缓存键仍为「无标记时无尾缀」的旧格式（兼容）

实测：`test-glossary.js` 68 项、`test-packs.js` 71 项，`npm test` 退出码 0。

### 门控回归（`test-glossary.js` 测试 9，+9 项，v0.4.2）

- 两个门控词同句**不互相作证**：`幸運` + `修繕`、`トークン` + `推論` 均不注入
- 门控词 + 普通术语同句**仍注入**：`幸運` + `钻石镐`、`トークン` + `上下文窗口`
- 逐句判定：同批另一句的普通术语不救活门控词
- 跨包合并（`vtuber-hololive` + `mc` + `ai` 并成一个 source）：同句凭证生效、异句凭证不生效、门控词跨包也不互证
- 不变量：任何被注入的门控词，其所在句子必含普通术语
