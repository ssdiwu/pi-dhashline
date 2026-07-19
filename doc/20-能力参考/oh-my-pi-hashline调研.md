# oh-my-pi Hashline 调研摘要

## 来源

- 仓库：<https://github.com/can1357/oh-my-pi>
- 初次引入：commit `611e24fea04f2691513139260bd38a16e7d0aca5`（2026-02-10）。
- 当前独立核心：`packages/hashline/`，包名 `@oh-my-pi/hashline`。
- 许可证：MIT；仓库版权包含 Mario Zechner 与 Can Bölük。

## 已核实机制

当前 oh-my-pi 使用文件级短标签、裸行号文本协议、会话多版本快照、保守 stale recovery、全量预检和 fresh tag（新标签）回传。其成熟实现还包含语法块定位、文件移动删除、LSP / ACP（代理客户端协议）写入接缝和流式渲染。

## 本项目借鉴

- 保留 parser / apply / snapshot / recovery / host adapter 的职责分离。
- 使用文件级标签而非逐行短哈希。
- 恢复只接受未变且唯一、偏移一致的锚点，不做近邻猜测。
- 编辑成功后返回新标签，重复 no-op（无变化）升级为错误。

## 本项目差异

- 标签使用 8 位而非 4 位十六进制，降低短标签碰撞风险。
- 运行于 Node / Pi，不依赖 Bun 或 `@oh-my-pi/hashline`。
- 初版只做单文件文本操作，不实现 block、REM、MV、LSP 或 ACP。
- `search` 复用 Pi 原生 grep（内容搜索）能力，不引入运行依赖。

## 实测

`@oh-my-pi/hashline@17.0.4` 官方测试 227/227 通过；直接由当前 Pi / Node 加载时报 `Bun is not defined`，替换 hash 与文件系统接缝后可运行。因此本项目选择移植机制而非直接依赖该包。
