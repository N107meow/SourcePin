# SourcePin 0.1.0 测试报告

验证日期：2026-09-10（Asia/Shanghai）。最终端到端证据时间：2026-09-09T17:55:07.402Z。

## 结果

- `npm run check`：通过。TypeScript 类型检查无错误，49 项测试全部通过、0 失败、0 跳过，随后生成生产包。
- `npm run test:e2e`：12 项端到端流程全部通过，验收页没有未捕获的 JavaScript 错误。
- `unzip -t dist/sourcepin-0.1.0-chrome.zip`：包内 4 个文件完整性检查通过。
- 独立代码审查已复核关闭导出骨架 CSS 边界、初始 hover 误判、无关指针释放污染录制的 3 项发现。

## 环境与方法

macOS arm64，Node v24.16.0，Playwright 1.62.1，Chromium 151.0.7922.34。使用隔离的临时浏览器 profile，未操纵用户个人 Chrome。

端到端测试实际加载 `dist/extension`，通过 Chromium 测试 CDP 的 `Extensions.triggerAction` 触发扩展 action，走 activeTab、MV3 service worker、注入与消息传递链路。测试用的扩展调试启动参数不进入产品 manifest。复制通过真实键盘事件和系统剪贴板 API，下载通过浏览器 download 事件取得真实文件；书签测试点击打包后的 javascript 链接。

## 49 项回归测试

| 范围 | 数量 | 主要检查 |
| --- | ---: | --- |
| capture / locators | 17 | 唯一定位、重排、重复 ID、引号、同源 frame/open shadow、表单/属性/URL 过滤、节点/深度/文本预算、CSSOM、伪元素、动画、取消 |
| recorder / Markdown | 14 | 18 节 Pro 输出、Lite 输出、15 KB UTF-8 摘要、代码围栏、真实 hover/focus/按下/释放、pointerId、无关事件排除、超时、卸载 |
| UI | 6 | 原 SVG 热区、Lite/Pro、复制状态、预览、语言与设置、首次引导、键盘、320×420/900×700 四角拖动与面板边界 |
| controller | 5 | 点击不透传、只在命令时复制、原生编辑复制、取消与晚到结果、多选总预算 600、Shift 复制、高亮清理 |
| download / lifecycle / reference | 3 | 真正下载、快速重复唤起、运行导出骨架时 CSS 不能突破 style 标签 |
| platform / background | 4 | 设置限值、消息来源、可选权限拒绝、saveAs 取消与错误反馈 |

## 12 项端到端流程

1. action 按需注入扩展。
2. 点击只选中，Cmd+C 写入真实剪贴板。
3. Pro 被动录制放行真实页面按钮交互。
4. 完整 Pro 预览包含状态迁移与 ARIA 证据。
5. Esc 清理、重新唤起及设置持久化。
6. Shift 多选复制两个目标。
7. 开放 Shadow DOM 与同源 iframe 采集，iframe 高亮误差小于 2 px。
8. 输入框和 contenteditable 的原生复制。
9. 完整导出不含植入的测试 token 与密码。
10. 下载真实组件 PNG，核对像素尺寸并恢复工具 UI。
11. 可选下载权限拒绝时下载真实 Markdown 文件。
12. 打包书签实际启动、捕获、复制和退出。

## 可检查证据

- [结构化端到端结果](../artifacts/e2e-results.json)
- [Lite 界面](../artifacts/01-extension-lite.png)、[复制状态](../artifacts/02-selected-copy.png)、[Pro 预览](../artifacts/03-pro-preview.png)
- [真实组件截图](../artifacts/04-component-capture.png)、[高级验收场景](../artifacts/05-advanced.png)
- [Lite 示例](../artifacts/example-lite.md)、[Pro 完整示例](../artifacts/example-pro.md)、[实际下载文件](../artifacts/example-downloaded.md)

已检查最新 Pro 预览与组件 PNG：掌机颜色、原图标、面板和选中框正常，组件截图没有工具遮挡。小视口面板边界由 UI 测试覆盖。

## 验证范围与边界

- 测试系统保存取消时，Chrome API 返回值由适配测试控制；权限拒绝的降级流程则走真实文件下载。没有自动操作 macOS 原生另存为对话框，不能把“已提交保存对话框”称为“文件已保存”。
- 当前验证平台是上述 macOS/Chromium 版本；尚未实机验证 Windows、Linux、Chrome 120 或所有第三方网站。
- 截图只包含可见像素，像素文字不做脱敏。跨域 iframe、closed Shadow DOM、浏览器内置页、严格 CSP 书签页有浏览器能力限制。
- 捕获父组件时不展开 iframe/Shadow DOM 内部结构；可访问内部元素须直接选择。源码行号、Canvas 3D 场景和未知业务状态不作推测。
- HTML/CSS 是捕获时的快照；复制前重新回查定位，页面变化后需重新选择以更新内容。多视口由用户实际调整窗口后追加。
- 下载快捷键可能被浏览器保留，黄色 M 提供按钮入口。当前为本地可加载扩展，未进行商店审核或 GitHub 公开发布。

## 安装包

`dist/sourcepin-0.1.0-chrome.zip`，24,253 bytes。

SHA-256：`f8b7a1ea34fc9cce5c2922566bdbbddb00a401a9e2644147d1d0d0f8a475dc24`。

人工验收入口及步骤见 [ACCEPTANCE.md](ACCEPTANCE.md)，安装与启动见 [README](../README.md)。
