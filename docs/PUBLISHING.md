# GitHub 书签版分发

用户路线：GitHub 仓库首页 → 同仓库 GitHub Pages 安装页 → 将 SourcePin 拖入书签栏 → 打开目标网页并点击书签。

线上安装页：<https://n107meow.github.io/SourcePin/>（仓库 Pages 源为 `gh-pages` 分支根目录，HTTPS 强制）。

## 分支结构

仓库只保留两个分支：

- `main`：完整源码、测试、构建脚本、文档与全部历史，同时是用户到达仓库时读到的首页。`npm ci && npm run check` 在这里可以直接跑通。
- `gh-pages`：安装页三件套（`.nojekyll`、`index.html`、`robot.svg`），Pages 从这里发布。**删除该分支会让在线安装页 404。**

标签 `v0.1.6` 指向 `main` 上的发布提交，因此 Release 的 “Source code” 下载是完整源码。

## 纳入版本控制的构建产物

`extension/` 是唯一提交进仓库的构建产物，共 9 个文件（`manifest.json`、`content.js`、`background.js`、四个尺寸图标、`INSTALL.txt`）。理由是克隆后要能直接在 `chrome://extensions` 加载，不必先装 Node.js 再构建。它由 `npm run build` 生成，与本分支下的 `dist/sourcepin-<版本>-chrome.zip` 逐字节一致；改动 `src/` 后重新构建并一起提交。

其余产物都留在 `dist/`（gitignore）：书签源码、安装页、两个 ZIP 与 `SHA256SUMS`。

## 已准备的文件

运行 `npm ci && npm run build` 后得到：

- `extension/`：可直接加载的 MV3 扩展（截图、跨会话偏好、全局快捷键）。
- `dist/site/index.html`：带完整 javascript 书签代码的安装页，内置手动安装备用入口和体验区。
- `dist/site/robot.svg`：安装页插图，使用相对 URL，兼容 `/SourcePin/` 项目子路径。
- `dist/site/.nojekyll`：按静态文件直接发布。
- `dist/sourcepin-site.zip`：上述网站文件的压缩包。
- `dist/sourcepin.bookmarklet.txt`：完整书签网址，无本地服务或远程 loader 依赖。
- `dist/sourcepin-<版本>-chrome.zip`：同一个扩展目录的压缩包。

`npm run delivery` 在 `artifacts/sourcepin-<版本>/` 生成可直接分发的整包（安装页 + 扩展 + 书签源码 + `SHA256SUMS`），并在缺少 `dist/` 时自动先构建。

## 更新线上安装页

1. `npm run build`。
2. 把 `dist/site/` 的**内容**（`.nojekyll`、`index.html`、`robot.svg`）提交到 `gh-pages` 分支根目录，不带 `dist/site/` 前缀。
3. 等待 Pages 构建完成，再验证：打开 <https://n107meow.github.io/SourcePin/>，拖入书签栏，到另一普通网页点击书签、选中复制、两次 Esc、再次唤起。
4. 安装页内容与 `dist/site/index.html` 应逐字节一致；线上页面地址与仓库 About 的 Website 字段保持一致。

回退：把 `gh-pages` 分支指回上一版提交即可；已装书签**不会**随网站回退或升级，用户需要用新安装页重新拖入并替换旧书签。

## 推送

优先用普通 Git：`git push origin main`（`gh-pages` 同理）。

如果这条路走不通——某些网络能连 api.github.com 却连不上 github.com:443，`git push` 会报 `Empty reply from server`——用仓库里的 API 推送脚本代替：

```bash
GITHUB_TOKEN=$(gh auth token) node scripts/publish-github.mjs        # 推 main
GITHUB_TOKEN=$(gh auth token) node scripts/publish-github.mjs gh-pages
```

脚本按 `git ls-files` 逐个上传文件、用同一个父提交创建提交、再移动分支指针；上传后的树必须与本地 `HEAD` 的树哈希一致才会移动指针，非快进会被 GitHub 拒绝（脚本也会先拒绝）。它会先要求工作区干净，所以先提交再推。

代价是 GitHub 把提交的作者记成调用 API 的账号（`meow <…@users.noreply.github.com>`），因此远程提交会得到一个自己的 SHA：本地与远程内容完全一致，提交 ID 不同。这种网络下 `git fetch` 也用不了，所以 `refs/remotes/origin/main` 停在被替换前的位置，`git status` 会一直显示 “ahead”。核对两侧是否一致用这两条：

```bash
gh api repos/N107meow/SourcePin/commits/main --jq '.commit.tree.sha'   # 远程 main 的树
git rev-parse HEAD^{tree}                                              # 本地 HEAD 的树
```

两个树哈希相同即内容一致（`git ls-files | wc -l` 与远程 blob 数量也应相同）。最近一次 API 发布的提交与树记在 `.git/sourcepin-remote-main` 与 `.git/sourcepin-main-tree`（仅本地）。

`gh-pages` 不受影响：它的内容由 `dist/site/` 生成，用同一条命令推送即可；本次整理前后线上安装页逐字节未变。

## 发布清单

推送到 GitHub 前逐条核对：

1. `npm run check` 全绿，`extension/` 与 `src/` 同步（重跑构建后 `git status` 只应显示你本次有意的改动）。
2. 全仓搜索密钥：`grep -rInE "api_key|secret|client_secret|sk-|password|token" --include='*.ts' --include='*.mjs' --include='*.json' src scripts public tests`；命中的应当只有隐私过滤器自身的规则与测试夹具。
3. `git status --ignored` 确认 `dist/`、`artifacts/`、`node_modules/`、`.DS_Store` 都不在待提交列表里。
4. 更新安装页后同时推 `main` 与 `gh-pages`；Release 资产用 `npm run delivery` 的产物（`sourcepin-<版本>-delivery.zip` 与 `SHA256SUMS`），不要把 `dist/` 提交进仓库。

## 正式发布记录

- 公开仓库：<https://github.com/N107meow/SourcePin>（MIT 许可证，见仓库 `LICENSE`），分支为 `main` 与 `gh-pages`。
- Release：<https://github.com/N107meow/SourcePin/releases/tag/v0.1.6>，资产为 `sourcepin-0.1.6-delivery.zip` 与其 `SHA256SUMS`。
- Pages：<https://n107meow.github.io/SourcePin/>，源 `gh-pages` 分支根目录。

参考：[GitHub Markup](https://github.com/github/markup)、[GitHub Pages](https://docs.github.com/en/pages/getting-started-with-github-pages/what-is-github-pages)。
