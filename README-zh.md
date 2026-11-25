# pi-dhashline

[English](./README.md) | 中文

零运行时依赖的 Pi Extension（扩展）：以文件级内容标签替换内置 `read` / `edit`，以 create-only（仅创建）语义接管 `write`，并新增输出同类锚点的 `search`。

## 初版能力

- `read`：输出 `[PATH#TAG]` 与 `LINE:TEXT`，支持 `offset` / `limit` 和图片透传。
- `edit`：使用紧凑文本协议执行 `SWAP`、`DEL`、`INS.PRE`、`INS.POST`、`INS.HEAD`、`INS.TAIL`。
- `write`：只原子创建不存在的 UTF-8 文本文件；目标已存在时拒绝且不改任何字节。
- `search`：复用 Pi 原生搜索能力，按文件返回标签和可直接编辑的行号。
- 会话级多版本快照、Pi session entry（会话条目）持久化、严格 stale tag（过期标签）拒绝与保守行位移恢复。
- 文件变更队列、原子创建/替换、BOM / 行尾 / 权限 / 符号链接目标保留；为保证原子性，硬链接文件拒绝编辑。
- 四个公开工具采用统一人类可读投影：默认只显示动作摘要，使用 Pi 当前展开快捷键查看必要锚点、单行上下文 diff 与错误修复语法。

## 协议示例

`read` 返回：

```text
[src/greet.ts#8E1A44C2]
1:export function greet(name: string) {
2:  return `Hello, ${name}`;
3:}
```

`edit` 请求：

```json
{
  "input": "[src/greet.ts#8E1A44C2]\nSWAP 2.=2:\n+  return `Hi, ${name}`;"
}
```

删除与插入（模型提示与错误信息会完整列出这些形式）：

```text
DEL 4.=6
INS.PRE 3:
+// before line 3
INS.POST 3:
+// after line 3
INS.HEAD:
+// file header
INS.TAIL:
+// file footer
```

所有行号都指向签发标签时的原始文件。一次请求中的操作先统一校验，再从后向前应用。`read` / `search` 的现实内容高于旧任务描述；已经满足的 `SWAP` 会在任何其他操作落盘前拒绝，避免组合请求继续产生重复插入。成功后 `edit` 返回新标签；这个新标签没有已见行，继续编辑前必须重新 `read` 或 `search`。

`search` 的匹配行写作 `*LINE:TEXT`，上下文行写作 ` LINE:TEXT`；只有未截断且实际返回给模型的行才可作为编辑锚点。

`write` 保持 Pi 的 `path + content` 参数形状，但只允许创建新文件。成功后返回 fresh tag 且不授予已见行；继续编辑前必须重新 `read` 或 `search`。目标已存在、是符号链接或在创建竞态中出现时均失败关闭。

## 工具展示

模型仍接收精确标签与行号。人类界面默认显示紧凑摘要；展开后，`read` 只显示本次窗口首尾各一行，`edit` 的每个 hunk 只保留修改前后各一行，`write` 只显示创建元数据而不回显正文。错误展开给出原因、未写入状态和可执行下一步，不显示原始 JSON 或内部 details。

## 安装与开发

0.1.2 候选版需要 Node.js 22.19.0 或更高版本，以及满足 `^0.80.10 || ^1.6.0` 的 Pi 宿主。在 Pi 1.6 中试用，请从 `main` 分支安装。旧标签 `v0.1.1` 对应 Pi 0.80.10。

```bash
pi install git:github.com/ssdiwu/pi-dhashline@main
```

本地开发：

```bash
git clone https://github.com/ssdiwu/pi-dhashline.git
cd pi-dhashline
npm install
npm run check
pi --no-extensions -e .
```

## 目录

- `index.ts`：Pi 扩展入口与工具注册。
- `src/`：标签、快照、协议、文件与工具实现。
- `tests/`：单元与集成行为测试。
- `doc/`：架构、外部证据、术语和决策记录。

## 配置

项目根可选 `dhashline.json`：

```json
{
  "maxFileBytes": 4194304,
  "snapshots": {
    "maxPaths": 30,
    "maxVersionsPerPath": 4,
    "maxTotalBytes": 67108864
  }
}
```

配置在 session（会话）启动时读取；非法或未知字段会失败关闭。`maxFileBytes` 上限为 16 MiB，快照总量上限为 256 MiB。

## 当前边界

- `write` 只在已存在且非符号链接的父目录中创建新的有效 UTF-8 本地文本文件；已有文件必须使用 `read` + `edit`。
- 初版每次 `edit` 只接受一个文件 section（文件段）。
- 不提供文件删除、移动、语法块定位或跨文件事务。
- 文件默认超过 4 MiB 时 `read` 不签发可编辑标签，`write` 也拒绝创建；可在安全上限内配置。
- 仅含 `INS.HEAD` / `INS.TAIL` 的 patch（补丁）无法证明 stale 状态安全，因此文件变化后会拒绝。

## 验证

```bash
npm run typecheck
npm test
npm run check
```

实际加载：

```bash
printf '' | pi --no-extensions -e . --mode rpc --no-session
```

按纯协议单元测试 → 文件 / 工具集成测试 → 当前 Pi 实际加载 smoke test 分层报告；文件安全断言不得只靠 mock。

## 贡献

- 先读 [`AGENTS.md`](AGENTS.md)，再读 [`doc/README.md`](doc/README.md) 与架构正文 [`doc/架构/初版架构.md`](doc/架构/初版架构.md)。
- 行为改动先改架构正文，再改代码与测试，然后同步英文 `README.md` 与中文 `README-zh.md` —— 两版必须保持语义一致。
- 公开协议变化（工具参数、标签语义、文件安全边界）必须配套行为测试。
- 用户可感知变化写入变更日志：本仓日常维护中文 `CHANGELOG-zh.md`，准备发布时按版本把同样的事实同步到英文 `CHANGELOG.md`；两份 changelog 与两版 README 都随 npm 包发布。
- 一次提交只做一件事，遵循 Conventional Commits（约定式提交）。未经明确授权不提交、不推送、不打标签、不发布。

## License

MIT。Hashline 设计来源与上游 MIT 版权声明见 `THIRD_PARTY_NOTICES.md`。
