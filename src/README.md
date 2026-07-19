# src

- `config.ts`：严格读取项目根 `dhashline.json` 与容量上限。
- `hash.ts`：规范化完整文件并计算 8-hex 标签。
- `snapshots.ts`：session 级多版本快照、容量限制与已见行。
- `protocol.ts`：单文件文本补丁解析、校验、应用和保守恢复。
- `files.ts`：文本格式、路径、仅创建写入、原子替换与 diff。
- `tools.ts`：Pi `read`、`edit`、`write`、`search` 工具定义，以及压缩 session entry（会话条目）持久化。
- `tui/`：四工具默认摘要、动态展开快捷键、精简上下文和错误指导投影。

模块只通过明确导出协作；不要为单一实现新增 adapter（适配器）接口。
