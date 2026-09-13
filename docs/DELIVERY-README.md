# SourcePin {{VERSION}} · 交付包

两种用法，任选其一或都用。两者共享同一套采集内核，导出内容一致。

## 一、书签版（推荐，免安装、免权限）

1. 双击 `install.html`（用 Chrome 打开）。这一页与线上安装页内容一致，进度、快捷键说明和整页验收入口都在，双击即可离线使用。
2. 把页面上绿色的 **SourcePin** 标签**拖到书签栏**。
   - 看不到书签栏：<kbd>Ctrl</kbd>+<kbd>Shift</kbd>+<kbd>B</kbd>（macOS：<kbd>⌘</kbd>+<kbd>Shift</kbd>+<kbd>B</kbd>）。
   - 拖拽不便：在该页底部展开「手动安装」，复制完整代码，新建书签并把代码粘进**网址**字段（名称随意）。
3. 打开任意普通网页，点击书签栏里的 **SourcePin**。
4. 指向元素会高亮，**点击只选中**；按 <kbd>⌘</kbd>/<kbd>Ctrl</kbd>+<kbd>C</kbd> 才复制。
   初次复制/下载会先出现一次本地确认窗，点「继续导出」。
5. 想先试：在同一页点「唤起 SourcePin」即可就地体验（用的是本包同一份内核），不必先装书签。

书签版能做的：单选/多选（≤10）、复制 15 KB 摘要、下载完整 Markdown、捕获整页 DOM 并下载可离线打开的 ZIP、Pro 模式录制真实交互。
书签版不做的：截图、跨会话偏好保存（严格 CSP 的站点也可能阻止运行）。

## 二、扩展版（可选增强：截图、跨会话偏好、全局快捷键）

1. 打开 `chrome://extensions`，右上角开启**开发者模式**。
2. 点「加载已解压的扩展程序」，选择本目录下的 **`extension`** 文件夹。
   - 也可以解压 `sourcepin-{{VERSION}}-chrome.zip` 后选择解压出的文件夹，内容相同。
3. 打开普通网页，点扩展图标或按 <kbd>⌘</kbd>/<kbd>Ctrl</kbd>+<kbd>Shift</kbd>+<kbd>Y</kbd>。
4. 权限只有 `activeTab` + `scripting` + `storage`，下载权限按需申请（可选）。

## 三、30 秒自检

书签版：在任意网页点书签 → 点一个按钮 → 屏幕显示 `1`；<kbd>⌘</kbd>/<kbd>Ctrl</kbd>+<kbd>C</kbd> → 确认 → 圆钮变绿；粘贴得到 Markdown。

扩展版：同上，另外三角按钮里的「截取组件」应可用（书签版是灰的，并说明原因）。

## 四、本包含什么

| 文件 | 说明 |
| --- | --- |
| `install.html` | 双击即用的安装页；与线上安装页同一份内容，只有内嵌的内核与插图为本包版本（自包含，无外部文件） |
| `sourcepin.bookmarklet.txt` | 书签完整网址（`javascript:` 开头），供手动安装或脚本化分发 |
| `sourcepin.js` | 压缩后的内核脚本，便于核对与自建安装页 |
| `extension/` | 已解压的 Chrome MV3 扩展，可直接加载 |
| `sourcepin-{{VERSION}}-chrome.zip` | 同一扩展的压缩包，便于传输 |
| `SHA256SUMS` | 上述产物的校验和，`shasum -a 256 -c SHA256SUMS` 可核对 |

## 五、边界与注意

- **书签栏那一项的图标由浏览器决定**：`javascript:` 书签没有可被抓取的站点图标，任何工具都无法指定。SourcePin 不会改动你正在看的页面来“伪装”这一项。
- **不改变你正在看的标签页**：运行前后页面的标题、`<head>`（含 favicon）与地址栏 URL 保持不变；这一点已写成端到端回归测试。
- **升级要重新拖入**：书签不随安装页更新，新版本需要用新的 `install.html` 重新拖一次并替换旧书签；扩展版在 `chrome://extensions` 重新加载即可。
- **导出前请检查确认窗**：本地启发式检测可能误报或漏报；粘贴给 LLM 等于把内容交给该第三方处理。SourcePin 本身不上传、无账号、无遥测。
- 截图包含页面像素，其中的文字没有脱敏。

版本 {{VERSION}} · 校验和见 `SHA256SUMS`（`shasum -a 256 -c SHA256SUMS` 可核对）· 详细说明见仓库 `README.md` 与 `docs/ACCEPTANCE-SPEC.md`

本包由 `npm run build && npm run delivery` 生成；`install.html` 直接取自同一份安装页模板，因此不会与线上安装页产生内容差异。
