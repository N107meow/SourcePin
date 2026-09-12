# GitHub 书签版分发

用户路线：GitHub 仓库首页 → 同仓库 GitHub Pages 安装页 → 将 SourcePin 拖入书签栏 → 打开目标网页并点击书签。

线上安装页：<https://n107meow.github.io/SourcePin/>（仓库 Pages 源为 `gh-pages` 分支根目录，HTTPS 强制）。

## 已准备的文件

运行 `npm ci && npm run build` 后得到：

- `dist/site/index.html`：带完整 javascript 书签代码的安装页，内置手动安装备用入口和体验区。
- `dist/site/robot.svg`：安装页插图，使用相对 URL，兼容 `/SourcePin/` 项目子路径。
- `dist/site/.nojekyll`：按静态文件直接发布。
- `dist/sourcepin-site.zip`：上述网站文件的压缩包。
- `dist/sourcepin.bookmarklet.txt`：完整书签网址，无本地服务或远程 loader 依赖。
- `dist/sourcepin-0.1.6-chrome.zip`：可选扩展版，提供 Chrome 截图和本地偏好保存。

`npm run delivery` 在 `artifacts/sourcepin-<版本>/` 生成可直接分发的整包（安装页 + 扩展 + 书签源码 + `SHA256SUMS`），并在缺少 `dist/` 时自动先构建。

## 更新线上安装页

1. `npm run build`。
2. 把 `dist/site/` 的**内容**（`.nojekyll`、`index.html`、`robot.svg`）提交到 `gh-pages` 分支根目录，不带 `dist/site/` 前缀。
3. 等待 Pages 构建完成，再验证：打开 <https://n107meow.github.io/SourcePin/>，拖入书签栏，到另一普通网页点击书签、选中复制、两次 Esc、再次唤起。
4. 安装页内容与 `dist/site/index.html` 应逐字节一致；线上页面地址与仓库 About 的 Website 字段保持一致。

回退：把 `gh-pages` 分支指回上一版提交即可；已装书签**不会**随网站回退或升级，用户需要用新安装页重新拖入并替换旧书签。

## 正式发布记录

- 公开仓库：<https://github.com/N107meow/SourcePin>（MIT 许可证，见仓库 `LICENSE`）。
- Release：<https://github.com/N107meow/SourcePin/releases/tag/v0.1.6>，资产为 `sourcepin-0.1.6-delivery.zip` 与其 `SHA256SUMS`。
- Pages：<https://n107meow.github.io/SourcePin/>，源 `gh-pages` 分支根目录。

参考：[GitHub Markup](https://github.com/github/markup)、[GitHub Pages](https://docs.github.com/en/pages/getting-started-with-github-pages/what-is-github-pages)。
