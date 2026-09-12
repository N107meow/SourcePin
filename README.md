# SourcePin

选中网页上的任意组件，得到可以交给 AI 的定位、结构与样式上下文。全部在本地运行，不上传内容，不需要账号。

![SourcePin](https://n107meow.github.io/SourcePin/robot.svg)

## 立即使用（推荐）

打开安装页：**<https://n107meow.github.io/SourcePin/>**

1. 显示浏览器书签栏（macOS：<kbd>⌘</kbd>+<kbd>Shift</kbd>+<kbd>B</kbd>，Windows/Linux：<kbd>Ctrl</kbd>+<kbd>Shift</kbd>+<kbd>B</kbd>）。
2. 把页面上的绿色 **SourcePin** 标签拖进书签栏。
3. 打开任意普通网页，点击书签栏里的 SourcePin，指向元素后点击选中。
4. 按 <kbd>⌘</kbd>/<kbd>Ctrl</kbd>+<kbd>C</kbd> 复制摘要，或按黄色 M 按钮下载完整内容。

不需要安装 Node.js、不需要启动本地服务。第一次复制/下载会显示一次本地确认（含疑似个人信息计数与第三方处理提示），点「继续导出」即可；**取消不等于同意**，下次仍会询问。

## 离线安装包与可选扩展

- **离线安装包**：到 [Releases](https://github.com/N107meow/SourcePin/releases/latest) 下载 `sourcepin-0.1.6-delivery.zip`，解压后双击 `install.html`，同样是拖拽安装（包内还带校验和与说明）。
- **Chrome 扩展（可选增强）**：包内 `extension/` 目录提供组件截图、跨会话本地偏好与全局快捷键。打开 `chrome://extensions` → 开启开发者模式 → 「加载已解压的扩展程序」→ 选择该目录。它只申请 `activeTab`、`scripting`、`storage`，以及按需的 `downloads`。
- 书签版与扩展版共享同一套采集内核，导出内容一致；书签版不提供截图与偏好保存，严格 CSP 的页面可能阻止运行。

## 能做什么

- **定位**：标签、文本摘要、净化后的属性，以及多个经过回查的定位器。
- **结构与样式**：清洗后的 HTML、有界采样的 CSS、伪元素与动画采样、结构 JSON。
- **交互记录**（Pro）：真实触发的 hover / focus / 点击 / 页面变化。
- **整页 DOM**：下载可离线打开的 ZIP，图片以同尺寸占位标记（不下载像素）。
- **多选**：最多 10 个目标，共享 600 节点预算；预算触顶会明确写在报告的 Degradations 里。

## 隐私与边界

- 本地采集：无账号、无上传、无遥测；书签版不保存跨会话偏好，扩展版只写入 `chrome.storage.local`。
- 导出前本地扫描邮箱、手机号、身份证号与地址模式，只显示去重计数；启发式检测可能误报或漏报，不等同于匿名化。
- DOM 输出会过滤表单值、脚本、事件属性、敏感属性和 URL 参数（含 `#fragment` 中的 `access_token` 一类参数）；截图是页面像素，其中文字未经 OCR 脱敏。
- 运行期间不改动你正在看的页面：标题、`<head>`（含 favicon）与地址栏 URL 保持不变。
- 书签栏那一项的图标由浏览器决定：`javascript:` 书签没有可抓取的站点图标，SourcePin 不去改页面图标来伪装它。
- 采样与预算是明确契约：图片只放占位、CSS 是有界采样、closed shadow 与跨源 iframe 内容不可访问。

## 反馈

使用问题或建议请开 [Issue](https://github.com/N107meow/SourcePin/issues)。源码不在默认分支：完整代码、测试与构建方式见 [`source` 分支](https://github.com/N107meow/SourcePin/tree/source)（`npm ci && npm run check`，`npm run delivery` 生成安装包）。

## 许可证

[MIT](https://github.com/N107meow/SourcePin/blob/source/LICENSE)。导出内容（网页文本、图片、Logo）的权利仍归原站/原作者，本许可证不授予这些内容的使用权。
