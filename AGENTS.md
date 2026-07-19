# AGENTS.md — pi-dhashline

## 项目定位

`pi-dhashline` 是一个零运行时依赖的 Pi Extension（扩展），用文件级内容标签替换内置 `read` / `edit`，以 create-only 语义接管 `write`，并提供可直接产出编辑锚点的 `search`。

## 阅读顺序

1. `README.md`：功能、协议、安装和验证。
2. `doc/README.md`：文档地图与权威边界。
3. `doc/术语表.md`：项目术语。
4. `doc/10-架构与运行/初版架构.md`：当前实现与调用链。
5. `src/README.md`：源码目录职责。
6. `index.ts`：Pi 扩展入口。

## 实现与安全边界

- `dependencies` 必须保持为空；只使用 Node 标准库与 Pi 提供的 peer dependencies（宿主依赖）：coding-agent、pi-tui、typebox。
- 模型工具面固定为 `read`、`edit`、`write`、`search`；实现细节不得进入工具名前缀。
- `read` / `search` 只有在记录完整文件快照后才能签发可编辑标签。
- `edit` 必须先完成语法、标签、范围、冲突与写权限预检，再触碰磁盘。
- `write` 只允许使用 exclusive create 原子创建不存在的文本文件；不得覆盖现有文件，成功后的 fresh tag 不授予已见行。
- stale recovery（过期恢复）必须失败关闭；目标内容变化、重复歧义或偏移不一致时拒绝写入。
- 文件修改必须使用 Pi 的 `withFileMutationQueue`，并保留 BOM、主行尾风格、权限和符号链接目标；硬链接文件必须拒绝，不能以原地截断冒充原子写入。
- 初版不实现文件删除、移动、`Tree-sitter`（语法树解析）、LSP（语言服务器协议）或跨文件事务。
- edit / write 成功返回的新标签未自动授予已见行；后续编辑必须重新 `read` 或 `search`。
- 公开工具 renderer 必须保持“默认摘要 + Pi 当前展开快捷键的人类可读详情”；`read` 只显示窗口边界，`edit` diff 只保留每个 hunk 前后各一行，`write` 不回显完整正文。

## 代码工程纪律

- 删除测试判断模块价值：删除后复杂度消失的透传模块应删除；复杂度会散回调用方的模块才保留。
- 接缝纪律：只有两个以上真实实现才抽接口；单一 adapter（适配器）不提前抽象。
- 函数控制在 100 行以内，超出时按行为职责拆分。
- 测试通过公共接口验证行为；mock（模拟）只放在文件系统、Pi 工具执行等系统边界。
- 调试先建立确定性反馈环；临时日志必须带唯一 `[DEBUG-xxxx]` tag 并在收口前删除。

## 验证

```bash
npm run check
pi --no-extensions -e . --mode rpc --no-session
```

测试分层：纯协议单元测试 → 文件/工具集成测试 → 当前 Pi 实际加载 smoke test（冒烟测试）。

## Git

- 一次提交只做一件事，遵循 Conventional Commits（约定式提交）。
- 除非用户明确要求，不执行 `git commit`、`git push`、`git tag` 或 `npm publish`。
