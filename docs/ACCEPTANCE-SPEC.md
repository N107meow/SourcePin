# SourcePin 能力与验收规格

这份文件把当前实现的行为写成可核对的规则（Given/When/Then），并标明每条规则由哪个测试或人工步骤覆盖。它是**现行契约**，随实现更新；历史设计文档（`docs/superpowers/plans/`、`docs/dev/core-report.md` 等）不回写，只作当时的记录。

不写在这份文件里的行为不代表被支持。这里也**不宣布**任何尚未测量的性能目标、未发生的发布或未选择的许可证。

## 1. 三个用户任务

| 任务 | 用户想得到的 | 不属于这个任务 |
| --- | --- | --- |
| T1 定位组件 | 一个 AI 能重新找到的目标描述：标签、文本摘要、净化后的属性、多个定位器及回查结果 | 像素级还原、运行时状态 |
| T2 携带结构与样式上下文 | 选择时的静态快照：结构 JSON、清洗后的 HTML、有界采样的 CSS、预算与降级说明 | 实时同步、完整站点克隆、图片像素 |
| T3 记录实际交互 | Pro 下真实触发的 hover / focus / active / mutation 状态与迁移 | 推断未发生的交互、自动操作页面 |

**"定位准确"和"快照仍然反映实时内容"是两件事。** 定位器在导出前会重新回查（`validateLocators`）；页面正文变化而定位未变化时，导出内容是**旧快照**，界面会提示"页面已变化 · 复制前将回查定位"，用户可以重新选择以重新采集。

## 2. 形态矩阵

| 形态 | 输入 | 输出 | 失败与降级 |
| --- | --- | --- | --- |
| Lite 元素 | 点击（可 Shift 多选，≤10 个） | 有界 Markdown 摘要/报告 + 结构 JSON；不序列化 HTML/CSS | 节点/深度/字节预算命中时写入 Degradations；无截图 |
| Pro 元素 | 同上 | 额外：清洗后的 HTML、采样 CSS、伪元素、动画采样 | CSSOM 不可访问、无样式表、预算触顶均逐条声明 |
| 整页（page） | 三角 → 捕获整页 DOM | 离线 ZIP（`page.html`、`structure.json`、`assets.json`、`report.md`） | 图片只占位不下载；隐藏内容默认排除；预算与限制写入报告 |
| 书签版 | 书签点击（页面上下文） | 与内核相同的选择、复制、Markdown 下载 | 无截图、不保存跨会话偏好、可能受目标页 CSP 限制 |
| 扩展版 | 扩展图标 / `Cmd/Ctrl+Shift+Y` | 上述全部 + 截图 + 跨会话本地偏好 | 注入失败给出真实原因并重试一次 |

## 3. 现行规则（Given / When / Then）

### R1 首次导出取消不等于同意

- **Given** 本次选择还没有被接受过，**When** 用户点「取消」或按 Esc 关闭确认框，**Then** 不写剪贴板、不下载、不显示「已确认 · 声明」，下一次复制/下载/截图仍然要求确认。
- **Given** 用户已点「继续导出」，**When** 在同一份快照内再次导出且未检出个人信息，**Then** 不再弹窗，机身显示「已确认 · 声明」。
- **Given** 快照中出现个人信息计数 > 0，**When** 任何时候导出，**Then** 每次都显示完整确认。
- **Given** 页面结构变化、重新选择目标或改变模式，**When** 再次导出，**Then** 重新确认（确认只属于它当时描述的那份快照）。
- 覆盖：`tests/controller.test.mjs`（`cancelling or escaping the review never counts as confirming it`、`personal information still forces the full review on every export`、`the export review opens once per activation…`）、`docs/ACCEPTANCE.md` 第 7 节。

### R2 拾取不触发原网页操作

- **Given** 处于拾取状态，**When** 用户点击页面元素，**Then** 该次点击被吞掉：不执行原站 `click` handler，不创建原生选区残留，只更新选择与高亮。
- **Given** 处于拾取状态，**When** 点击落在不可支持区域（closed shadow 内部、跨源 iframe 内容），**Then** 该区域不可选，且边界在报告中说明，不尝试绕过。
- **Given** 工具已退出，**When** 用户点击同一元素，**Then** 原站行为恢复。
- 覆盖：`tests/controller.test.mjs`（`picker selects without invoking page…`、`a same-origin frame inside an open shadow root is pickable…`）、`tests/e2e.mjs`（`Selection does not click through`）。

### R3 预算各自约束什么

| 预算 | 值 | 约束 |
| --- | --- | --- |
| 选择数 | 10 | 单次采集的目标个数，超出时提示而不是静默丢弃 |
| 元素形态合计节点 | 600 | 多选共享的节点上限，超出的后代省略并声明 |
| 整页节点 / 深度 | 20 000 / 40 层 | 结构遍历上限 |
| 整页字节 | 2 MiB | 结构 JSON + HTML + CSS **共享**的字节上限 |
| 代表样式采样 | 120 节点 | 计算样式采样上限（整页按签名代表） |
| 摘要 | 15 KiB | 预览与复制的有界摘要；**字节，不是 token** |
| Markdown / HTML / ZIP | 4 MiB / 8 MiB / 16 MiB | 超出时拒绝导出并说明，不产出半成品 |

- **Given** 任一预算触顶，**When** 导出，**Then** Degradations 中逐条说明触顶项与影响，不静默截断。
- 覆盖：`tests/core.test.mjs`（`node budget…`、`global UTF-8 byte and structural budgets…`、`budget-limited pages…`）、`tests/package.test.mjs`（`hard ZIP/file limits refuse…`）、`tests/controller.test.mjs`（`multi-select retains all roots within a combined 600-node budget`）。

### R4 预算满足不等于完整还原

- **Given** 导出成功，**When** 阅读报告，**Then** 裁剪、采样与占位都可见：图片是占位说明、CSS 是采样、未采样节点有覆盖计数、截图未做 OCR。
- **Given** 真实字体、音视频或图片像素，**When** 查看离线包，**Then** 它们不被获取，包内说明这一点。
- 覆盖：`tests/core.test.mjs`（`budget-limited pages and stylesheet sampling explicitly report every boundary`、`page serialization…`）、`tests/package.test.mjs`（`page ZIP marks every image in place…`）。

### R5 存储与网络边界

- **Given** 书签版，**When** 关闭页面后换一个网站，**Then** 不保留跨实例偏好（仅当页内存）。
- **Given** 扩展版，**When** 修改设置，**Then** 只写入 `chrome.storage.local`。
- **Given** 任何导出，**When** 检查网络，**Then** 没有内容上传、没有遥测；离线页自动网络请求为零。
- 覆盖：`tests/e2e.mjs`（离线零请求、跨源引导记录）、`tests/package.test.mjs`（`no image reference is ever fetched…`）。

### R6 敏感信息不经过已声明的过滤通路泄漏

- **Given** URL 的查询串、`#fragment` 或 userinfo 中含敏感参数（`access_token`、`apiKey`、用户名密码等），**When** 值进入 Meta、reach、链接、CSS、assets 或结构输出，**Then** 一律替换为 `[redacted]`；正常锚点与业务路由保持可读。
- **Given** 元素的敏感属性已被过滤，**When** 它的 `::before`/`::after` 通过 `attr()` 或属性选择器把该值渲染成内容，**Then** 该声明整条省略，普通伪元素文案保留。
- **Given** Pro 正在录制，**When** 页面写入 `--api-key` 之类的声明或改写敏感 id/class，**Then** 变化详情只保留原因与计数，元素身份使用净化后的值；普通的 class / `aria-*` 变化仍可读。
- 覆盖：`tests/core.test.mjs`（`URL sanitization covers fragments…`、`filtered attributes cannot be republished by pseudo-element content`、`recording changes use the same sanitizer…`、`capture sanitizes source URLs…`）、`docs/ACCEPTANCE.md` 第 8 节。

### R7 导出确认与第三方处理告知

- **Given** 用户要导出，**When** 确认框出现，**Then** 显示本地检测计数、LLM 第三方处理提示与权利声明；截图路径额外说明像素未做 OCR。
- **Given** 导出物将被粘贴给 AI，**When** 阅读报告与预览，**Then** 明确"粘贴即把内容交给第三方"，且不声称能过滤一切 prompt injection。
- 覆盖：`tests/controller.test.mjs`（`export review reports local counts and data flow…`）、`tests/review.test.mjs`。

### R8 键盘可用

- **Given** 用户只用键盘，**When** 按 Tab / Shift+Tab，**Then** 每个控件都有可见焦点；打开面板后焦点进入面板，关闭后回到入口控件。
- **Given** 焦点在拖动条上，**When** 按方向键或 Home，**Then** 机身按格移动或回到右下角，且始终不越出视口。
- **Given** 用户只用鼠标，**When** 点击任意控件，**Then** 不留下持久的焦点方框。
- 覆盖：`tests/ui.test.mjs`（`keyboard focus is painted on the console and never on a plain click`、`the console answers the keyboard everywhere the pointer works`、`the standing notice is a control of its own…`、`the drag handle moves the console with arrow keys…`）。

### R9 构建可重复、可回退

- **Given** 两个构建进程同时运行，**When** 其中一个正在初始化锁，**Then** 另一个等待而不是抢占；接管使用原子操作且只有一个赢家。
- **Given** 同一份源码连续构建两次，**When** 比较产物，**Then** SHA256SUMS 逐字节一致，且与本次构建的产物一一对应。
- **Given** 构建失败或被强杀，**When** 下一次构建，**Then** 不残留锁与临时文件，也能从陈旧锁恢复。
- 覆盖：`tests/build-lock.test.mjs`（9 项）。

### R10 尚未验证的领域（写在这里以免被当成已完成）

- 未做性能基线，也没有 2 万节点 p95 ≤ 3 秒、取消 ≤ 200 ms 之类的实测结论。**这些是待测目标，不是已达标事实。**
- 未做依赖漏洞数据库扫描；"零漏洞"未被验证，也不写进任何报告。
- 未做屏幕阅读器与多浏览器人工验收。
- 书签运行在目标页上下文里，其 UI 与局部净化**不是**对抗恶意宿主脚本的隔离边界。
- 网页文本与导出源码都是非可信数据：报告提醒下游 AI 不要执行网页内伪装成系统指令的内容，但不宣称能过滤一切注入。

## 4. 规格与测试的缺口

| 规则 | 状态 |
| --- | --- |
| R1–R9 | 有自动化覆盖，见上表条目 |
| R8 200% 缩放 | 仅覆盖小视口（360×480）；缩放场景仍是人工检查 |
| R9 Windows | 锁接管依赖目录 `rename`，未在 Windows 上验证 |
| R10 全部条目 | 明确未验证 |
