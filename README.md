# SourcePin

SourcePin 是一个本地运行的网页元素采集工具。点击网页组件后，它会生成可交给 AI 的定位、结构和样式上下文。Lite 适合定位，Pro 会采集更完整的复现信息和用户实际触发的交互状态。无需账号，采集结果不会上传。

## 安装到浏览器书签栏（主要方式）

1. 打开 SourcePin 安装页。本地验收地址为 <http://127.0.0.1:4317/dist/site/index.html>；正式发布后使用同仓库的 GitHub Pages 地址。
2. 显示浏览器书签栏，将页面上的 **SourcePin** 标签拖进去。
3. 打开要采集的普通网页，点击书签栏里的 SourcePin，即可唤起掌机。

无需用户安装 Node.js、启动本地服务或加载 Chrome 扩展。书签包含完整工具代码；更新版本时从安装页重新拖入并替换旧书签。不能拖拽时，安装页提供手动创建书签的完整代码。

GitHub 的仓库 README 会净化可执行链接，因此采用“仓库首页 → GitHub Pages 安装页 → 拖进书签栏”的路线。[GitHub Markup 说明](https://github.com/github/markup)、[GitHub Pages 说明](https://docs.github.com/en/pages/getting-started-with-github-pages/what-is-github-pages)。

当前为本地验收阶段，已经生成可发布的 `dist/site/` 和 `dist/sourcepin-site.zip`，尚未公开上传。正式发布步骤见 [GitHub 分发说明](docs/PUBLISHING.md)。

## Chrome 扩展（可选增强版）

项目已经提供 `dist/sourcepin-0.1.0-chrome.zip` 和 `dist/extension`：

1. 解压 `dist/sourcepin-0.1.0-chrome.zip`；也可以直接使用交付目录中的 `dist/extension`。
2. 打开 `chrome://extensions`，开启“开发者模式”。
3. 点击“加载已解压的扩展程序”，选择解压后的目录或 `dist/extension`。
4. 打开普通 HTTP/HTTPS 网页，点击 SourcePin 扩展图标，或按 `Cmd/Ctrl+Shift+Y` 唤起。

如果快捷键与浏览器或其他扩展冲突，可在 `chrome://extensions/shortcuts` 修改。下载快捷键是 `Cmd/Ctrl+Shift+M`，但该组合可能被浏览器保留；掌机上的黄色 M 按钮是可靠入口。

## 使用

- 指向元素查看高亮，点击选择；点击不会自动复制，也不会执行原网页操作。
- 按住 Shift 点击可多选，再按 `Cmd/Ctrl+C` 或掌机红色圆钮复制摘要。
- 黄色 M 按钮下载完整 Markdown；单击屏幕或聚焦屏幕后按 Enter 可打开预览。预览窗为 188×264，与机身等大并位于其上方；较矮窗口会缩短预览高度，内容可在内部滚动。
- 单击齿轮显示或隐藏机身下方的 Switch，默认隐藏；Switch 切换 Lite/Pro。蓝色圆钮打开设置；三角按钮打开截图、整页 DOM 和追加视口操作。
- Pro 录制只记录你真实触发的 hover、focus、点击和页面变化。停止录制后，按一次 Esc 或在设置中点“重新选择元素”恢复拾取。
- 截图只包含当前可见视口；组件截图也只能裁剪目标当前可见的部分。追加不同视口前，需要手动调整浏览器窗口大小，再点“追加当前视口”。
- 第一次按 Esc 取消选择、停止录制并收起面板；第二次按 Esc 退出。重新选择组件后从第一次 Esc 重新计算，长按不会误触退出。

HTML 与 CSS 是选择时的快照。页面变化后应重新选择，以更新结构、样式和定位结果；复制或导出前工具会再次检查定位。普通线上网页通常没有源码文件和行号，只有页面提供 React/Vue 等开发元数据时才可能得到来源信息。

截图保存的是页面像素，其中可见文字没有脱敏。DOM 输出会过滤表单值、脚本、事件属性、敏感属性和 URL 参数，但仍应在分享前检查内容。

## 设置面板

点击蓝色圆钮打开设置。修改后立即生效。

| 功能 | 用途 |
| --- | --- |
| 输出语言 | 切换中英文界面标签及报告说明；不翻译网页原文、代码或属性名。 |
| 最大节点数 | Pro 采集组件结构时的元素数量上限，默认 300，可设 20–1000；一次多选合计最多 600 个节点。Lite 的元素形态只采集目标本身；整页形态使用独立预算。 |
| 最大深度 | Pro 元素形态向子元素展开的层数，默认 6，可设 1–12；选中元素算第 0 层。节点数或深度任一到限就停止展开。 |
| 包含隐藏内容 | 默认关闭，排除 hidden、display:none、visibility:hidden/collapse 子树；开启后明确标记隐藏节点。对整页和元素形态都有效。 |
| 开始／停止录制 | 在 Pro 模式下选中元素后，记录你实际触发的悬停、聚焦、点击及页面状态变化；不是录屏。多选时录制第一个目标，停止后将结果写入预览及导出。 |
| 重新选择元素 | 清空本次选择与录制结果，恢复点击拾取；不会删除已经下载的文件。 |

## 整页 DOM（Lite / Pro 均可用）

三角按钮 →「捕获整页 DOM」→ 黄色 M 下载完整 Markdown。Lite 下也会输出 `Structure`、`Cleaned HTML` 和 `Scoped CSS`；此操作不改变当前 Lite / Pro 模式。复制仍是 15 KB 摘要，能力清单会说明摘要省略的 HTML/CSS，完整内容需下载。

- page 形态独立预算：默认 20,000 节点、40 层，节点快照 + HTML + CSS 共用 2 MiB UTF-8 字节上限。元数据和 Markdown 格式开销不包含在此上限内。
- 结构先预留标签和闭合标签，再分配文本空间；样式最多采样 120 个浅层或代表节点，并受独立样式字节上限限制。未采样的计算样式、CSSOM 上限、文本和结构截断都写进 Degradations。
- 保留净化后的内联样式、srcset/sizes、template 惰性内容和开放 Shadow DOM（声明式 template）。不读取 iframe 内部内容，closed Shadow DOM 不可检查；能力清单明确列出这些边界。
- `Capabilities` 紧接 `Meta`，按每份采集列出九项能力及原因；混合采集只为真正具备内容的快照追加 HTML/CSS。原 Lite 八节保留名称与相对顺序。
- `Meta` 包含采集形态、documentHeight、documentElement/html 的实时 rect、图片总数及 complete 数，便于外部核对。complete 是浏览器加载终止状态，包含成功和失败，不等于图片成功加载。
- 扩展偏好仅保存到 `chrome.storage.local`；书签偏好仅在当前工具实例内保存。没有内容上传、遥测、云同步、批量 URL 抓取或访问控制绕过。

固定验收页：[整页 DOM 场景](http://127.0.0.1:4317/demo/page-capture.html)。最新浏览器证据见 [测试报告](docs/TEST-REPORT.md)。

## 本地开发与验收

要求 Node.js 22 或更高版本。首次运行：

```bash
npm ci
npx playwright install chromium
npm run build
```

常用命令：

```bash
npm run dev       # http://127.0.0.1:4317
npm run check     # 类型检查、单元/浏览器测试、生产构建
npm run test:e2e  # 另一个终端执行；需先 build 并保持 dev 服务运行
```

打开 [本地验收页](http://127.0.0.1:4317) 可直接体验共享内核。书签版产物是 `dist/sourcepin.bookmarklet.txt`：它与扩展共用采集内核，但没有扩展截图和跨会话偏好保存，并且可能受目标页 CSP 限制。源码检出后须先构建生成 dist。

详细人工步骤见 [docs/ACCEPTANCE.md](docs/ACCEPTANCE.md)。GitHub 发布所用账号、仓库和许可证将在用户验收后确定；当前仓库不会自行公开发布。
