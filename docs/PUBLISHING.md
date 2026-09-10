# GitHub 书签版分发

用户路线：GitHub 仓库首页 → 同仓库 GitHub Pages 安装页 → 将 SourcePin 拖入书签栏 → 打开目标网页并点击书签。

## 已准备的文件

运行 `npm ci && npm run build` 后得到：

- `dist/site/index.html`：带完整 javascript 书签代码的安装页，内置手动安装备用入口和体验区。
- `dist/site/robot.svg`：安装页插图，使用相对 URL，兼容 `/SourcePin/` 项目子路径。
- `dist/site/.nojekyll`：按静态文件直接发布。
- `dist/sourcepin-site.zip`：上述网站文件的压缩包。
- `dist/sourcepin.bookmarklet.txt`：完整书签网址，无本地服务或远程 loader 依赖。
- `dist/sourcepin-0.1.0-chrome.zip`：可选扩展版，提供 Chrome 截图和本地偏好保存。

## 正式发布时执行

1. 在用户选定的 GitHub 账号/仓库发布源码并确定许可证。
2. 将 `dist/site/` 的内容放入网站发布分支根目录（例如 `gh-pages`），不包含 `node_modules`。
3. 仓库 Settings → Pages → Deploy from a branch，选择该发布分支的根目录。
4. 将 GitHub 返回的实际 Pages URL 添加到 README 与仓库 About 的 Website 字段，作为“安装 SourcePin”入口。
5. 验证正式 HTTPS 安装页：显示书签栏、拖入标签、到另一普通网页点击书签、选中复制、两次 Esc、再次唤起。
6. 后续更新时重新构建并发布页面，已有用户重新拖入并替换旧书签。

当前只完成本地可发布产物，没有建立远程仓库或公开部署。GitHub README 的 HTML 净化使其不适合作为直接 javascript 拖拽入口，实际入口使用 GitHub Pages。

参考：[GitHub Markup](https://github.com/github/markup)、[GitHub Pages](https://docs.github.com/en/pages/getting-started-with-github-pages/what-is-github-pages)。
