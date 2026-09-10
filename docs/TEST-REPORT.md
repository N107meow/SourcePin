# SourcePin 整页 DOM、离线包与合规验证

## 最新补充：Pro 机身颜色修复

2026-09-10：修复页面 `connect-src` 限制阻止内置 SVG 的 fetch，导致 Pro 仍使用绿色备用图片的问题。`src/ui/inspector.ts` 现在直接解码内置 SVG data URL，保留按钮动画与两种主题的独立阴影。

新增 `tests/pro-theme.test.mjs`：在 `connect-src 'none'` 页面运行实际书签入口，通过齿轮和 Switch 切换，断言 Pro 机身为 `rgb(255, 0, 63)`、屏框为 `#E60038`、屏幕为 `#FFD1D9`，切回 Lite 恢复绿色；修复前测试失败、修复后通过。截图见 `artifacts/pro-theme-csp.png`。

本次 `npm run check` **78/78 通过**，类型检查及生产构建通过，日志见 `artifacts/pro-theme-check.log`。以下 P1/P2 端到端数字保留前轮实测记录；本次针对主题修复运行完整 check 与专用书签回归。

验证日期：2026-09-10。此报告针对当前 P1/P2 实现，覆盖 P0 回归；历史设计文档未修改。

## 最终结果

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
| P0-3 保真与过滤 | `core.test.mjs` 的内联样式/srcset/template/开放 shadow/UTF-8 文本预算/敏感 URL 回归；`package.test.mjs` 离线页实际显示图片和 shadow 文本。原敏感值断言保留；旧禁止出现事件属性名称的断言改为禁止导出 HTML 中存在事件属性，同时允许审计里出现名称。 |
| P0-4 隐藏内容 | `core.test.mjs` 默认排除、显式 opt-in、标记测试；长页实际排除 **3 个隐藏子树**，计入 Degradations。 |
| P0-5 兄弟计数 | `core.test.mjs` 工具节点与同名节点定位测试；两份 e2e 采集 `siblingCount=2`，body 的 `childIndex=1`。 |
| P0-6 测量元数据 | e2e `documentHeight=1,065,131 px`；Meta 记录 html/documentElement rect、captureKind、预算、图片 `total=1 / complete=1`。complete 仅表示加载终止状态。 |
| P1-1 可打开的包 | `package.test.mjs` ZIP/资源/离线打开测试；`e2e.mjs` 下载后按 file URL 打开。doctype、html/head、base、scoped style、图片 data URI 存在；`Reference Impl` 链接包内页面。两种适配器外部请求均 **0**。 |
| P1-2 隐私审计 | `core.test.mjs` 的 attribute audit 测试：返回移除的 data-token/onclick/value 名称，各 1 次，无值。长页实际移除 **4 个属性：data-token ×1、srcdoc ×1、value ×2**；另报告 8 次属性过滤、归一化或脱敏。 |
| P1-3 输出策略 | `package.test.mjs` 强制压低 ZIP/HTML/Markdown 上限并断言拒绝；资源数量、单个字节、时间、网络失败测试；`output.test.mjs` 超过 4 MiB 拒绝、摘要准确列出 Design Tokens 等被舍弃章节、混采包内链接顺序测试。 |
| P1-4 合规产物 | `review.test.mjs` 邮箱/手机号/身份证/地址去重计数各 1，返回值不含匹配内容；`controller.test.mjs` 确认前无复制/下载、取消和页面变化不导出、第三方数据流提示；e2e 实际剪贴板/截图/下载均经确认。版本与权利声明通过 core/output 测试；README、manifest、demo 文案和权限核对。 |
| P2 可见性/性能 | `core.test.mjs` 祖先 opacity:0 单独标注，自身 visible 不被祖先透明状态误判；相同样式对象共享、CSS 合并。1,500 条无关类规则实测 **0 次 candidate matches**；`style-index.test.mjs` 核查复杂、转义、组合及分组选择器不漏匹配。调度为每 500 节点或 8 ms，让出次数及规则上限均写入 Degradations。 |

## 固定长页实测

固定页 `demo/page-capture.html` 有 8,000 个 article，结构超过默认字节预算。关键图片、shadow/template、隐藏及隐私种子位于前部，以验证预算截断和保真两条独立约束。

| 适配器 | 节点数 | 捕获内容 bytes | page.html bytes | report.md bytes | ZIP bytes | siblingCount | 离线请求 |
| --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: |
| extension | 6,712 | 1,673,466 | 352,150 | 1,605,819 | 4,489,487 | 2 | 0 |
| bookmarklet | 6,712 | 1,673,466 | 352,150 | 1,605,821 | 4,489,490 | 2 | 0 |

实际证据时间：2026-09-10T09:20:25.427Z。

结构字节计数为 UTF-8 `HTML + CSS + JSON.stringify(nodes)`。采集器保守预留标签、文本标记及 CSS 空间，因此触发结构预算时最终有效字节可能低于 2 MiB；不是遗漏报告。输出末尾有结构截断声明，不宣称导出了全部 8,000 行。

两份 ZIP 均包含 `page.html`、`structure.json`、`assets.json`、`report.md`。离线浏览器检查标题、Row 1199、图片 naturalWidth > 0、Shadow public fixture 可见；template 惰性正文保留，script 数量为 0，无外部网络请求。截图见 `artifacts/offline-extension.png` 和 `artifacts/offline-bookmarklet.png`。

关键 Degradations 包括：Structure byte budget reached、CSS source byte budget reached、3 hidden subtrees excluded、Removed attributes (4)、105/6712 个节点样式采样、iframe/recording/screenshot 等 absent 及包的离线限制。CSSOM 实测 5 条规则、34 次候选 matches、18 组复用样式。

## 改动文件清单

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
- CSS 仍是有界采样；样式 interning 和 CSS 合并降低复用对象/声明体积，未宣称消除每个采样节点的 getComputedStyle 读取。没有扩大现有样式采样预算。
- 个人信息检测是模式启发式，存在误报/漏报；计数针对已有 DOM 快照，截图未做 OCR。导出确认说明像素风险和 LLM 第三方处理。
- 当前无 LICENSE，默认保留所有权利；许可证、公开 GitHub 发布和未来商店政策 URL/数据用途/single purpose 仍需用户决策。未选择许可证、未公开发布。
- 没有引入内容上传、遥测、批量 URL 抓取或访问控制绕过；权限仍为 activeTab、scripting、storage，只有可选 downloads。
