# AGENTS.md — pi-dhashline

## 项目定位与权威

`pi-dhashline` 是零运行时依赖的 Pi Extension：用文件内容标签替换内置 `read` / `edit`，以 create-only 语义接管 `write`，并提供可直接产出编辑锚点的 `search`。

- 先读 `README.md` 与 `doc/README.md`，再按任务读取 `package.json`、`src/README.md`、`index.ts`、目标实现和测试。
- 公开工具协议、renderer 与加载入口以 README、源码和测试为权威；不在本文件复制版本或会话快照。

## 实现与文件安全边界

- `dependencies` 必须保持为空；只使用 Node 标准库与 Pi 提供的 peer dependencies。
- 模型工具面固定为 `read`、`edit`、`write`、`search`；实现细节不得进入工具名前缀。
- `read` / `search` 只有在记录完整文件快照后才能签发可编辑标签。
- `edit` 必须先完成语法、标签、范围、冲突与写权限预检，再触碰磁盘。
- `write` 只允许 exclusive create 原子创建不存在的文本文件；不得覆盖现有文件，成功后的 fresh tag 不授予已见行。
- stale recovery 必须失败关闭；目标内容变化、重复歧义或偏移不一致时拒绝写入。
- 文件修改必须使用 Pi 的 `withFileMutationQueue`，并保留 BOM、主行尾风格、权限和符号链接目标；硬链接文件必须拒绝，不能以原地截断冒充原子写入。
- 文件删除、移动、Tree-sitter、LSP 与跨文件事务不属于现有公开工具职责；扩展这些能力必须先明确契约和安全验证。
- edit / write 成功返回的新标签不自动授予已见行；后续编辑必须重新 `read` 或 `search`。
- renderer 保持“默认摘要 + Pi 当前展开快捷键的人类可读详情”；`read` 只显示窗口边界，`edit` diff 只保留每个 hunk 前后各一行，`write` 不回显完整正文。

## 验证与外部动作

```bash
npm run check
pi --no-extensions -e . --mode rpc --no-session
```

- 按纯协议单元测试 → 文件 / 工具集成测试 → 当前 Pi 实际加载 smoke test 分层报告；文件安全断言不得只靠 mock。
- 未经用户明确授权，不创建 commit，不执行 `git push`、推送 tag、`npm publish` 或其它对外发布。
