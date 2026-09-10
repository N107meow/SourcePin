# SourcePin 整页 DOM 修复测试报告

验证日期：2026-09-10。最终端到端证据时间：2026-09-10T06:25:06.532Z。

## 结果

- 每组按用户要求执行 `npm run check`：第一组 59 项、第二组 63 项、第三组 65 项通过；补充边界后最终 **67/67**，类型检查与生产构建通过。
- 最终 `npm run test:e2e`：**14/14**，覆盖真实 MV3 扩展与打包书签；无未捕获 JavaScript 错误。
- 两个分发 ZIP 的 `unzip -t` 均通过。校验值记录在 `dist/SHA256SUMS`。
- `git diff --check` 通过；`docs/superpowers/` 历史设计与计划文件无改动。
- 独立 Agent 额度不可用，本轮由主 Agent 自行复核、测试及核对截图；不将其表述为已通过独立审查。

## P0 验收证据

| 要求 | 已验证的行为 |
| --- | --- |
| P0-1 page 形态 | 默认 Lite 的整页按钮实际下载非空 HTML/CSS/Structure，且保持 Lite。重新采集保持 page，重新拾取恢复 element。预算默认 20,000 节点、40 层、2 MiB。 |
| P0-2 能力报告 | Capabilities 紧接 Meta，逐捕获列出 present/absent 与原因；Lite 原八节名称与相对顺序保留。有适配器时按真实 framework 结果报告；混合形态只给有内容的快照追加 HTML/CSS，录制仅关联目标捕获。 |
| P0-3 保真与隐私 | 内联定位、净化 srcset/sizes、template、声明式开放 Shadow DOM、SVG image 自闭合、长文本与 UTF-8 全局预算通过。表单值、脚本、事件属性、敏感属性与 URL 参数未回归；补测 template URL 和 CSSOM 敏感声明净化。 |
| P0-4 隐藏护栏 | hidden/display:none/visibility:hidden/collapse 子树默认排除，目标摘要与定位文本也不会夹带隐藏正文；明确开启后包含并标记 data-sourcepin-hidden，过滤和包含数量写入报告。 |
| P0-5 工具污染 | 工具节点排除后三兄弟恢复为 HEAD/BODY 两个；body 的 siblingCount=2、childIndex=1。同名注入节点下的结构 CSS 定位仍命中真实目标。 |
| P0-6 外部测量 | Meta 包含 documentHeight、documentElementRect、htmlRect、captureKind、img total/complete，以及本次预算。 |

## 固定长页的真实下载

[固定验收页](http://127.0.0.1:4317/demo/page-capture.html) 含 1,200 个 article、长中文/emoji 文本、定位图片、template、开放 shadow、iframe、隐藏块与隐私种子。

| 适配器 | Structure 节点 | Markdown 字节 | 页面 scrollHeight | img complete/total |
| --- | ---: | ---: | ---: | ---: |
| extension | 3,616 | 1,077,833 | 162,006 | 1/1 |
| bookmarklet | 3,616 | 1,077,835 | 162,006 | 1/1 |

两份报告都包含 Row 1199、Template public fixture、Shadow public fixture，隐藏/表单/脚本/敏感参数种子未进入输出。complete 是加载终止状态，不能解释为所有图片加载成功。

进一步在隔离 Chromium 中重新解析下载的 HTML/CSS：article 数 1,200，声明式 Shadow DOM 实际建立，template 保留惰性正文，script 数为 0，隐藏测试正文不存在，图片计算 position=absolute。此检查只验证固定页结构与关键样式，不承诺任意网站逐像素复现。

## 回归范围

| 范围 | 数量 |
| --- | ---: |
| 核心捕获、隐私与定位 | 25 |
| controller 生命周期与整页动作 | 8 |
| Markdown 与录制 | 15 |
| UI | 11 |
| 下载、生命周期、Reference CSS 边界 | 3 |
| 安装页 | 1 |
| platform/background | 4 |

原有选择不透传、命令复制、双 Esc、滚动逐帧跟随、多选、录制放行、iframe/open-shadow 定位、截图、下载权限降级均继续通过。

## 证据与边界

- [书签整页实际下载](../artifacts/page-bookmarklet.md)、[扩展整页实际下载](../artifacts/page-extension.md)
- [结构化整页结果](../artifacts/page-capture-results.json)、[完整 E2E 结果](../artifacts/e2e-results.json)
- [书签整页截图](../artifacts/page-bookmarklet.png)、[扩展整页截图](../artifacts/page-extension.png)
- [check 日志](../artifacts/page-check.log)、[E2E 日志](../artifacts/page-e2e.log)

2 MiB 指节点 JSON + HTML + CSS 的 UTF-8 内容预算，元数据及 Markdown 格式开销另计。样式独立采样，CSSOM 最多检查 2,000 条规则；采样、截断及过滤均明确说明。iframe 内部不采集，closed shadow 无法检查，截图不嵌入 Markdown。工具不自动滚动加载懒加载内容，不读取服务端业务逻辑或未展示状态。

仅在 macOS arm64 / Chromium 151.0.7922.34 / Node v24.16.0 的隔离 profile 验证；未重新访问任务书所述 appllama.io，也未把固定页结果说成该站点已实测通过。没有新增数据上传、遥测、批量抓取或云同步；扩展偏好改为 chrome.storage.local。未公开发布 GitHub。
