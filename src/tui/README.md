# tui

`tool-result.ts` 负责 `read`、`edit`、`search` 的人类可读文字投影；`tool-component.ts` 使用 Pi `Text` / `Container`、theme 和 `renderDiff`，把调用与结果原位合并为一个原生工具组件。

- 模型可见 `content` 保留精确 `[PATH#TAG]`、行号和错误文本。
- 默认 UI 只显示动作、对象、关键数量、状态和 tag，并提示 `Ctrl+O`。
- 展开 UI 显示完整锚点、编辑动作、diff、告警和可复制语法，但不显示原始 JSON 或内部 details 对象。
- renderer 只投影，不拥有快照、协议解析或文件生命周期。
