# 整页 DOM 修复实施记录

依据用户提供的任务书执行，不修改 docs/superpowers 下的历史文档。

目标：Lite 下整页动作也产生净化 HTML、结构和 CSS，任何缺失、过滤或预算裁剪都有说明；保持本地执行。

- [x] 第一组：privacy 保留净化 style/srcset/sizes；统一 DOM 排除与 visibleChildren，修复工具节点计数/定位。新增固定页回归，npm run check。
- [x] 第二组：capture kind 与页面测量；结构 20000 节点/40 层/2MiB、样式独立采样；保留 template/open shadow、全局文本预算、隐藏内容默认排除与统计。新增长页/净化/预算回归，npm run check。
- [x] 第三组：逐捕获 Capabilities 驱动 Markdown（保留 Lite 原章节相对顺序）、controller page 形态生命周期、隐藏设置、framework 真实能力与纯本地设置。新增混合输出/完整 UI 操作回归，npm run check。
- [x] 交付：真实扩展与书签 E2E、生成固定页完整导出和结构化证据、更新当前使用说明及测试报告。

选择：Capabilities 紧接 Meta 插入，原 Lite 八个标题名称及相对顺序保持；新增完整内容章节按能力附加。样式完整性不夸大为全量：记录采样数量和无法读取的样式源。默认排除 hidden/display:none（也排除 visibility:hidden/collapse）子树；template 本身惰性不作为隐藏块删除。

已完成各组全量检查：59、63、65 项全绿；追加预算声明及净化边界后 67 项全绿。不存在数据上传或云同步路径。独立 Agent 当前额度不可用，主 Agent 自行复核并以浏览器测试证据收尾。

最终端到端 14/14；两种适配器实际下载均为 3,616 个节点的 Lite page 报告。重新解析验证 1,200 个 article、开放 shadow、template 与图片绝对定位。详情见 `docs/dev/TEST-REPORT.md`。
