当前可用基线，版本 0.1.6。仓库公开、以 MIT 许可证发布。

## 安装

1. 下载下面的 `sourcepin-0.1.6-delivery.zip` 并解压，包内顶层是 `sourcepin-0.1.6/` 目录。
2. 用 Chrome 打开其中的 `install.html`，把绿色的 **SourcePin** 标签拖到书签栏。
3. 打开任意普通网页，点击书签栏里的 SourcePin；点元素只选中，`Cmd/Ctrl+C` 才复制。

也可以直接用仓库的 GitHub Pages 安装页：[https://n107meow.github.io/SourcePin/](https://n107meow.github.io/SourcePin/)（无需下载）。

可选扩展（组件截图、跨会话本地偏好、全局快捷键）在包内 `extension/` 目录：打开 `chrome://extensions` → 开启开发者模式 → “加载已解压的扩展程序” → 选择该目录。

## 交付物

- `sourcepin-0.1.6-delivery.zip`：安装页、完整书签代码、已解压扩展、内核脚本与 `SHA256SUMS`。包内 `SHA256SUMS` 可逐个核对文件。
- 本说明下方的 `SHA256SUMS`：该 ZIP 自身的 sha256。

GitHub 自动生成的 “Source code” 压缩包用于开发，不包含构建产物（`dist/`、安装包）；需要时在仓库根目录运行 `npm ci && npm run build`，或直接 `npm run delivery`（会先自动构建并生成安装包目录）。

## 验证与边界

- `npm run check`：类型检查、**128/128** 单元与浏览器测试、生产构建通过。
- `npm run test:e2e`：**16/16** 实际扩展与书签端到端场景通过（含“工具不改动页面标题、head 与图标”的回归）。
- 书签版不提供截图与跨会话偏好；严格 CSP 的页面可能阻止运行；浏览器内置页无法注入。
- 书签栏那一项的图标由浏览器决定：`javascript:` 书签没有可抓取的站点图标，SourcePin 不去改运行页面的图标来伪装它。
- 导出确认：首次复制/下载/截图显示完整确认，取消不等于同意；检出个人信息时每次都确认。

## 已知边界（不是缺陷清单）

采样与预算是明确契约：图片只在原位放同尺寸占位、CSS 是有界采样、closed shadow 与跨源 iframe 内容不可访问、截图未做 OCR。详见仓库 `README.md` 与 `docs/ACCEPTANCE-SPEC.md`。本轮审查中发现的隐私与确认语义问题已在 0.1.6 源码中修复并有回归测试。

## 许可证

[MIT](../blob/main/LICENSE)。导出内容（网页文本、图片、Logo）的权利仍归原站/原作者。
