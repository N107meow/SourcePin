# SourcePin 整页 DOM、离线包与合规验证

## 最新补充：整页样式按签名覆盖、srcset 规范解析与预览上限

2026-09-11：提交 `996dbbb`。三项改动同时落地，`npm run check` **88/88**，`npm run test:e2e` **15/15**，两者均为本次改动后的实跑结果。

**整页样式改为按签名代表采样。** 整页形态先按净化后的 tag/class/id/style 加至多两级父身份算出不透明 `styleKey`，每个签名只采样一个代表节点；`getComputedStyle` 在一次采集内按普通/伪元素分别缓存一次；内联 CSS 在完整声明组与保序属性共享之间取更小者；声明式 shadow root 各自写入其所需的代表规则。元素（Lite 元素）形态保持逐节点样式口径不变。

**srcset 改按 HTML 解析算法。** 不再按逗号切分，因此 CDN 路径中含逗号的候选不会被切成不存在的资源；每个候选仍逐个通过 `safeAssetUrl`，描述符白名单维持原有单一 `w`/`x` 范围。

**预览改为有界摘要。** 预览面板调用既有的 15 KiB 摘要渲染器，全文超过 4 MiB 时不再显示 `Markdown exceeds 4194304 bytes`；复制与下载仍使用完整报告。

实测（`demo/page-capture.html`，固定扩展夹具，两个适配器）：

| 指标 | 改动前 | 改动后 |
| --- | ---: | ---: |
| 采集节点 | 6,712 | 8,322 |
| 代表采样节点 | 105 | 17 |
| 整页覆盖（严格口径） | 105 / 6,712（1.56%） | 8,319 / 8,321（99.98%） |
| 内联 style 字节 | 35,824 | 21,779 |
| report.md 字节 | 1,605,819 | 2,280,408 |
| page.html 字节 | 352,150 | 469,145 |
| ZIP 字节 | 4,489,487 | 5,743,836 |
| 离线 DOM 规则命中（含 shadow 与惰性 template） | 未统计 | 8,320 / 8,321（99.99%） |
| 预览字节 | 1,605,819 | 10,754 |

改后数字来自 `artifacts/page-capture-results.json`（采集时间 2026-09-11T13:34:52.939Z）；两个适配器的采集节点、采样数、内联 CSS、覆盖计数、离线请求与 `siblingCount` 完全一致，报告与 ZIP 仅因包内绝对路径不同相差数十字节。改前数字取自用户已确认的 `artifacts/batch1-before.json`。

原页与离线页 `[data-row="1199"] p` 实测一致：font-size `16px`、color `rgb(32, 60, 49)`、display `block`、padding `0px`。离线页 `<script>` 数量为 **0**，两个适配器外部请求均为 **0**；解包 `page.html` 共 8,340 个唯一 `sp-*` 类标记（`sp-N` 与 `sp-s-N`）。

节点数从 6,712 增到 8,322 来自同一个 2 MiB 结构预算：共享规则占用更少字节，同一上限内可容纳更多节点，因此是本轮的覆盖变化，不是扩大预算——`maxNodes` 20,000 / `maxDepth` 40 / `maxBytes` 2,097,152 / `maxStyleNodes` 120 均未改动。

未达成与限制（同时写入 Degradations）：覆盖数字按严格口径统计的是「节点自身有采样样式，或其签名已有代表」——产物中 8,319/8,321 命中捕获规则，另有 2 个未实例化的 template 内容节点没有计算样式；代表样式不保证同签名的 `:nth-child`、更远祖先、布局或状态差异像素一致。单次采样的 `getComputedStyle` 读取普通样式由 4 次降为 1 次，伪元素仍各需 1 次（合计 6 → 3），并未把全部读取压缩到 1/4。这些限制没有通过隐藏计数或提高预算规避。

证据：`artifacts/batch1-report.md`、`artifacts/batch1-final-check.log`、`artifacts/batch1-final-e2e.log`、`artifacts/e2e-results.json`、`artifacts/page-capture-results.json`、`artifacts/page-extension.zip`、`artifacts/page-bookmarklet.zip`。代码改动为 `src/core/capture.ts`、`serialize.ts`、`package.ts`、`privacy.ts`、`src/core/srcset.ts`（新增）、`dom.ts`、`locators.ts`、`markdown.ts`、`src/controller.ts`、`src/types.ts` 及五个测试文件（提交 `996dbbb`）；随后 `README.md`、`docs/ACCEPTANCE.md`、本文件按实测数字更新（提交 `e246681`）。两轮提交均未修改 `src/ui/**`、`public/manifest.json`、CSP 常量、净化名单、`fetch` 凭据策略与导出确认流程，权限仍为 activeTab、scripting、storage 与可选 downloads。

## 补充：引导只显示一次

2026-09-10：书签版在所有目标网站直接进入拾取，不再重复显示使用引导；安装页的独立体验入口只在首次使用显示，并只保存 `sourcepin:onboarding-seen` 这一布尔标记。扩展使用原有 `chrome.storage.local` 记住已显示状态，不增加权限。引导首次显示即记住，即使按 Esc 关闭而未点“开始选择”，也不会在下次重复。UI 更新同步到已显示状态，模式切换不会把记录覆盖回旧值。

验证：`npm run check` **81/81**；`npm run test:e2e` **15/15**。新增测试覆盖同页重开、刷新、同源新标签、跨源书签，以及存储不可用时的当前页降级；真实扩展验证首次显示、切换模式、关闭、刷新和换网站后均不重弹。端到端跨站检查安排在截图验证之后，避免隔离浏览器标签切换改变截图视口；原截图尺寸断言保留。

证据：`artifacts/onboarding-check.log`、`artifacts/onboarding-e2e.log`、`artifacts/e2e-results.json`。修改涉及 browser 平台的首次标记、controller/UI 的单次显示、共用 browser-launcher、安装页专用入口与 build、README/人工验收说明及对应测试。导出前的逐次数据确认仍保留。

边界：清除安装站点数据或扩展存储会重置首次记录；安装页存储被禁用时，仅能在当前页面记住。书签在目标网站不依赖这个记录，因此跨网站始终不弹引导。以下为前轮验收记录。

## 最新补充：Pro 机身颜色修复

2026-09-10：修复页面 `connect-src` 限制阻止内置 SVG 的 fetch，导致 Pro 仍使用绿色备用图片的问题。`src/ui/inspector.ts` 现在直接解码内置 SVG data URL，保留按钮动画与两种主题的独立阴影。

新增 `tests/pro-theme.test.mjs`：在 `connect-src 'none'` 页面运行实际书签入口，通过齿轮和 Switch 切换，断言 Pro 机身为 `rgb(255, 0, 63)`、屏框为 `#E60038`、屏幕为 `#FFD1D9`，切回 Lite 恢复绿色；修复前测试失败、修复后通过。截图见 `artifacts/pro-theme-csp.png`。

本次 `npm run check` **78/78 通过**，类型检查及生产构建通过，日志见 `artifacts/pro-theme-check.log`。以下 P1/P2 端到端数字保留前轮实测记录；本次针对主题修复运行完整 check 与专用书签回归。

验证日期：2026-09-10。此报告针对当前 P1/P2 实现，覆盖 P0 回归；历史设计文档未修改。

## 最终结果

本节为 P1/P2 交付轮的记录；其后各轮的最新数字见上方「最新补充」各节。

- `npm run check`：**77/77** 测试通过；TypeScript 检查和生产构建通过。
- `npm run test:e2e`：**14/14**；实际 MV3 扩展及打包书签均完成确认、真实下载、解包、file URL 离线打开，无未捕获 JavaScript 错误。
- 分组验证：审计/包内核 72 项通过；接入确认流程 73 项通过；P2 74 项通过；最终边界回归 77 项通过。一次沙箱内 Chromium 启动失败后，改用获准的隔离浏览器执行；不计作测试通过。
- 生产扩展 ZIP、安装站 ZIP、两份导出 ZIP 的 Python `zipfile.testzip()` 全部通过，包含 CRC 校验。ZIP 使用合法的 DOS 日期字段。
- `git diff --check` 通过；未修改 `docs/superpowers/`。最终校验值见 `dist/SHA256SUMS`。
- 本轮由主 Agent 复核代码与测试，没有把自身复核表述为独立审查。

可复查证据：`artifacts/p1-check.log`、`artifacts/p1-e2e.log`、`artifacts/page-capture-results.json`、`artifacts/e2e-results.json`、`artifacts/export-review.png`。

## 逐条验收

| 要求 | 对应测试与证据 |
| --- | --- |
| P0-1 独立 page | `core.test.mjs` 的 Lite page 非空结构测试、`controller.test.mjs` 的 whole-page/recapture 测试，以及两个适配器的 e2e ZIP。默认独立预算 20,000 节点 / 40 层 / 2 MiB；本次 6,712 个节点触发结构字节预算并记录截断。 |
| P0-2 能力清单 | `output.test.mjs` 的 capabilities 混采/recording 归属测试和 Lite 原八节顺序测试；`controller.test.mjs` 验证 framework 适配结果。每份报告 Meta 后紧接 Capabilities，明确 present/absent 原因。 |
| P0-3 保真与过滤 | `core.test.mjs` 的内联样式/srcset/template/开放 shadow/UTF-8 文本预算/敏感 URL 回归；`package.test.mjs` 离线页实际显示图片和 shadow 文本。原敏感值断言保留；旧禁止出现事件属性名称的断言改为禁止导出 HTML 中存在事件属性，同时允许审计里出现名称。srcset 自本轮起按 HTML 解析算法处理，含逗号的 CDN 候选不再被切分（见 `core.test.mjs` 与 `package.test.mjs` 的 CDN 用例）。 |
| P0-4 隐藏内容 | `core.test.mjs` 默认排除、显式 opt-in、标记测试；长页实际排除 **3 个隐藏子树**，计入 Degradations。 |
| P0-5 兄弟计数 | `core.test.mjs` 工具节点与同名节点定位测试；两份 e2e 采集 `siblingCount=2`，body 的 `childIndex=1`。 |
| P0-6 测量元数据 | e2e `documentHeight=1,065,131 px`；Meta 记录 html/documentElement rect、captureKind、预算、图片 `total=1 / complete=1`。complete 仅表示加载终止状态。 |
| P1-1 可打开的包 | `package.test.mjs` ZIP/资源/离线打开测试；`e2e.mjs` 下载后按 file URL 打开。doctype、html/head、base、scoped style、图片 data URI 存在；`Reference Impl` 链接包内页面。两种适配器外部请求均 **0**。 |
| P1-2 隐私审计 | `core.test.mjs` 的 attribute audit 测试：返回移除的 data-token/onclick/value 名称，各 1 次，无值。长页实际移除 **4 个属性：data-token ×1、srcdoc ×1、value ×2**；另报告 8 次属性过滤、归一化或脱敏。 |
| P1-3 输出策略 | `package.test.mjs` 强制压低 ZIP/HTML/Markdown 上限并断言拒绝；资源数量、单个字节、时间、网络失败测试；`output.test.mjs` 超过 4 MiB 拒绝、摘要准确列出 Design Tokens 等被舍弃章节、混采包内链接顺序测试。 |
| P1-4 合规产物 | `review.test.mjs` 邮箱/手机号/身份证/地址去重计数各 1，返回值不含匹配内容；`controller.test.mjs` 确认前无复制/下载、取消和页面变化不导出、第三方数据流提示；e2e 实际剪贴板/截图/下载均经确认。版本与权利声明通过 core/output 测试；README、manifest、demo 文案和权限核对。 |
| P2 可见性/性能 | `core.test.mjs` 祖先 opacity:0 单独标注，自身 visible 不被祖先透明状态误判；相同样式对象共享、CSS 合并。1,500 条无关类规则实测 **0 次 candidate matches**；`style-index.test.mjs` 核查复杂、转义、组合及分组选择器不漏匹配。调度为每 500 节点或 8 ms，让出次数及规则上限均写入 Degradations。 |
| 整页代表样式覆盖 | `core.test.mjs` 新增「page style signatures cover repeated deep nodes…」「capture style cache is per invocation…」「shared signatures in separate shadow roots…」；整页按净化签名分配不透明 `styleKey`，每签名采样一个代表并各自写入所需的 shadow root 规则，普通/伪元素样式在单次采集内各缓存一次且不跨调用。固定页实测 17 个代表覆盖 8,319/8,321 个产物节点，内联 CSS 21,779 字节，18 组复用样式；覆盖计数、未覆盖数与代表近似后果同时出现在 Capabilities、Degradations 与本表。 |

## 固定长页实测

固定页 `demo/page-capture.html` 有 8,000 个 article，结构超过默认字节预算。关键图片、shadow/template、隐藏及隐私种子位于前部，以验证预算截断和保真两条独立约束。

| 适配器 | 节点数 | 代表采样 | 内联 CSS bytes | 捕获内容 bytes | page.html bytes | report.md bytes | ZIP bytes | 预览 bytes | siblingCount | 离线请求 |
| --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: |
| extension | 8,322 | 17 | 21,779 | 2,021,329 | 469,145 | 2,280,408 | 5,743,836 | 10,754 | 2 | 0 |
| bookmarklet | 8,322 | 17 | 21,779 | 2,021,329 | 469,145 | 2,280,410 | 5,743,839 | 10,756 | 2 | 0 |

实际证据时间：2026-09-11T13:34:52.939Z（`artifacts/page-capture-results.json`）。该表随每轮实测刷新；本轮改动前的数字（6,712 节点、105 代表采样、35,824 CSS bytes、1,605,819 report bytes、4,489,487 ZIP bytes）见上一节对照表。

结构字节计数为 UTF-8 `HTML + CSS + JSON.stringify(nodes)`。采集器保守预留标签、文本标记及 CSS 空间，因此触发结构预算时最终有效字节可能低于 2 MiB；不是遗漏报告。输出末尾有结构截断声明，不宣称导出了全部 8,000 行。

两份 ZIP 均包含 `page.html`、`structure.json`、`assets.json`、`report.md`。离线浏览器检查标题、Row 1199、图片 naturalWidth > 0、Shadow public fixture 可见；template 惰性正文保留，script 数量为 0，无外部网络请求。截图见 `artifacts/offline-extension.png` 和 `artifacts/offline-bookmarklet.png`。

关键 Degradations 包括：Structure byte budget reached、CSS source byte budget reached、3 hidden subtrees excluded、Removed attributes (4)、`Sampled 17/8322 nodes; covered 8320/8322`、共享签名的代表样式近似说明、iframe/recording/screenshot 等 absent 及包的离线限制。CSSOM 实测 5 条规则、4 次候选 matches、18 组复用样式、17 次让出。

## 改动文件清单

下表覆盖 P1/P2 交付轮；其后各轮的改动见「最新补充」各节末尾，最新一轮为 `src/core/srcset.ts`（新增，共享 srcset 解析）、`src/core/capture.ts`、`serialize.ts`、`package.ts`、`privacy.ts`、`dom.ts`、`locators.ts`、`markdown.ts`、`src/controller.ts`、`src/types.ts` 及五个测试文件。

| 文件 | 改动 |
| --- | --- |
| `src/core/package.ts` | 构造可离线打开的页面包，无凭据读取引用图片、SVG 净化、资源占位与预算审计。 |
| `src/core/zip.ts` | 实现有总字节上限的无依赖 stored ZIP，含 UTF-8 名称与 CRC。 |
| `src/core/privacy.ts` | safeAttributes 返回净化属性与被移除名称。 |
| `src/core/capture.ts` | 汇总属性审计与采样界限，记录版本、祖先透明度，复用样式并调整让出策略。 |
| `src/core/style-index.ts` | 简单选择器候选索引，复杂选择器保守回退。 |
| `src/core/serialize.ts` | 合并相同 CSS 声明，保留各节点选择器。 |
| `src/core/provenance.ts` | 从 package.json 读取版本，并统一权利声明。 |
| `src/core/review.ts` | 本地个人信息模式扫描，只返回去重计数。 |
| `src/core/markdown.ts` | 全文上限、准确摘要省略清单、版本/权利元数据和 page 包内链接。 |
| `src/core/locators.ts` | 适配 safeAttributes 新返回类型。 |
| `src/core/recorder.ts` | 适配 safeAttributes 新返回类型。 |
| `src/controller.ts` | 接入导出确认、取消与变更保护，page 下载 ZIP，元素仍下载 Markdown。 |
| `src/ui/inspector.ts` | 添加导出确认面板、计数、隐私与第三方处理提示。 |
| `src/platform/browser.ts` | 浏览器下载适配 Blob ZIP 与原 Markdown。 |
| `src/extension/platform.ts` | ZIP 本地 Blob 下载，不增加扩展权限。 |
| `src/types.ts` | 增加 provenance、祖先透明度、Blob 下载和确认 UI 接口。 |
| `tsconfig.json` | 开启 JSON 模块导入以读取工具版本。 |
| `public/manifest.json` | 描述使用中性的结构/样式上下文文案。 |
| `demo/index.html` | 中性产品文案。 |
| `demo/page-capture.html` | 固定压力验收页扩至 8,000 行，关键保真场景前置。 |
| `README.md` | 更新离线包/预算/确认流程，权利合规、许可证和商店披露待办。 |
| `docs/ACCEPTANCE.md` | 更新可手工复现的确认、审计、ZIP 与离线验收步骤。 |
| `docs/PUBLISHING.md` | 修正“设置同步”为本地偏好保存。 |
| `docs/EXPORT-PACKAGE-PLAN.md` | 记录本轮方案、预算与完成情况。 |
| `docs/TEST-REPORT.md` | 当前验收映射、实测数字和交付证据。 |
| `tests/core.test.mjs` | 审计、provenance、透明度、样式复用与索引工作量回归。 |
| `tests/output.test.mjs` | 摘要省略、全文上限与多文件链接回归。 |
| `tests/package.test.mjs` | 包结构、离线打开、资源失败/预算、无凭据请求与取消测试。 |
| `tests/review.test.mjs` | 本地个人信息去重计数测试。 |
| `tests/style-index.test.mjs` | 候选索引与原生 matches 的一致性测试。 |
| `tests/controller.test.mjs` | 确认、取消、页面变化与既有选择流程测试。 |
| `tests/download.test.mjs` | 在确认后核验真实 Markdown 下载。 |
| `tests/install.test.mjs` | 书签安装测试适配确认步骤。 |
| `tests/e2e.mjs` | 实际扩展/书签 ZIP 下载及 file URL 离线验收。 |
| `tests/helpers/export.mjs` | 测试通过可见确认按钮继续导出。 |
| `tests/helpers/zip.mjs` | 测试解读 stored ZIP 文件以检查真实产物。 |

构建同时刷新 `dist/extension/manifest.json`、扩展 JS 与 ZIP、书签 JS/文本、`dist/site/`、安装站 ZIP 及 SHA256SUMS。dist 与 artifacts 是本地构建/证据目录，不纳入源码提交。

## 降级与待决策

- 图片资源 CORS、鉴权、重定向或预算失败时使用占位图；不绕过限制。离线页禁用外联、脚本、iframe、表单提交和导航，不提供原站业务功能，不采集字体或音视频。
- CSS 仍是有界采样；样式 interning、CSS 合并与整页按签名代表采样降低复用对象/声明体积与读取次数，未宣称消除每个节点的 getComputedStyle 读取。整页形态下同签名的 `:nth-child`、更远祖先、布局或状态差异可能被代表样式近似，已写入 Capabilities 与 Degradations；元素形态保持逐节点样式口径。采样预算（`maxStyleNodes` 120、CSS 字节 `maxBytes/4`、结构 2 MiB）未扩大。
- 个人信息检测是模式启发式，存在误报/漏报；计数针对已有 DOM 快照，截图未做 OCR。导出确认说明像素风险和 LLM 第三方处理。
- 当前无 LICENSE，默认保留所有权利；许可证、公开 GitHub 发布和未来商店政策 URL/数据用途/single purpose 仍需用户决策。未选择许可证、未公开发布。
- 没有引入内容上传、遥测、批量 URL 抓取或访问控制绕过；权限仍为 activeTab、scripting、storage，只有可选 downloads。
