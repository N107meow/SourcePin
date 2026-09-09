# SourcePin

SourcePin 是一个本地运行的网页元素采集工具。点击网页组件后，它会生成可交给 AI 的定位、结构和样式上下文。Lite 适合定位，Pro 会采集更完整的复现信息和用户实际触发的交互状态。无需账号，采集结果不会上传。

## 安装 Chrome 扩展

项目已经提供 `dist/sourcepin-0.1.0-chrome.zip` 和 `dist/extension`：

1. 解压 `dist/sourcepin-0.1.0-chrome.zip`；也可以直接使用交付目录中的 `dist/extension`。
2. 打开 `chrome://extensions`，开启“开发者模式”。
3. 点击“加载已解压的扩展程序”，选择解压后的目录或 `dist/extension`。
4. 打开普通 HTTP/HTTPS 网页，点击 SourcePin 扩展图标，或按 `Cmd/Ctrl+Shift+Y` 唤起。

如果快捷键与浏览器或其他扩展冲突，可在 `chrome://extensions/shortcuts` 修改。下载快捷键是 `Cmd/Ctrl+Shift+M`，但该组合可能被浏览器保留；掌机上的黄色 M 按钮是可靠入口。

## 使用

- 指向元素查看高亮，点击选择；点击不会自动复制，也不会执行原网页操作。
- 按住 Shift 点击可多选，再按 `Cmd/Ctrl+C` 或掌机红色圆钮复制摘要。
- 黄色 M 按钮下载完整 Markdown；双击屏幕或聚焦屏幕后按 Enter 可打开预览。
- 齿轮切换 Lite/Pro。蓝色圆钮打开设置；三角按钮打开截图、整页 DOM 和追加视口操作。
- Pro 录制只记录你真实触发的 hover、focus、点击和页面变化。停止录制后，进入设置并点“重新选择元素”，才能恢复拾取。
- 截图只包含当前可见视口；组件截图也只能裁剪目标当前可见的部分。追加不同视口前，需要手动调整浏览器窗口大小，再点“追加当前视口”。
- 按 Esc 先关闭当前面板，再按一次退出 SourcePin。

HTML 与 CSS 是选择时的快照。页面变化后应重新选择，以更新结构、样式和定位结果；复制或导出前工具会再次检查定位。普通线上网页通常没有源码文件和行号，只有页面提供 React/Vue 等开发元数据时才可能得到来源信息。

截图保存的是页面像素，其中可见文字没有脱敏。DOM 输出会过滤表单值、脚本、事件属性、敏感属性和 URL 参数，但仍应在分享前检查内容。

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

打开 [本地验收页](http://127.0.0.1:4317) 可直接体验共享内核。书签版产物是 `dist/sourcepin.bookmarklet.txt`：它与扩展共用采集内核，但没有扩展截图和 Chrome 设置同步，并且可能受目标页 CSP 限制。源码检出后须先构建生成 dist。

详细人工步骤见 [docs/ACCEPTANCE.md](docs/ACCEPTANCE.md)。GitHub 发布所用账号、仓库和许可证将在用户验收后确定；当前仓库不会自行公开发布。
