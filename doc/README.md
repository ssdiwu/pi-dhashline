# pi-dhashline 文档入口

> English contributor navigation. 中文正文保留在下方，两版语义一致。
>
> | Where to start | What it answers |
> |---|---|
> | [../README.md](../README.md) | English project entry: tool surface, protocol, configuration, boundaries, install, development, contributing |
> | [../README-zh.md](../README-zh.md) | 中文完整版，与英文版语义一致 |
> | [../AGENTS.md](../AGENTS.md) | Agent rules: authority order, file-safety boundaries, bilingual README + changelog rules, verification |
> | [架构/初版架构.md](架构/初版架构.md) | The current mechanism: call chain, module responsibilities, protocol constraints, dependency boundary, human-readable projection, test layers |
> | [术语表.md](术语表.md) | Project terms |
> | [references/](references/) | Sources, verification records and history — not current authority |
> | [../CHANGELOG.md](../CHANGELOG.md) | User-perceivable changes per released version |
>
> Behavior changes update the architecture document first, then the code and tests, then both README versions. User-perceivable changes are logged daily in the Chinese `CHANGELOG-zh.md` and, per released version, mirrored in the English `CHANGELOG.md`; both changelogs and both READMEs ship in the npm package.

## 中文导航

1. [术语表](./术语表.md)
2. [架构正文](./架构/)
3. [决策档案](./决策档案/)
4. [经验笔记](./经验笔记.md)
5. [工程入口](../README.md)（英文默认版）；中文完整版见 [README-zh.md](../README-zh.md)
6. [代理协作规则](../AGENTS.md)
7. [贡献说明](../README.md#contributing)（英文默认版）；中文见 [README-zh.md](../README-zh.md#贡献)

`doc/架构/` 是当前机制的唯一正文；`doc/决策档案/` 是难逆转决策的刻碑；`doc/references/` 只保存来源、验证证据与历史方案，不作为并行需求或现行实现权威。公开工具协议、参数形状与产品规则以根 `README.md` / `README-zh.md`、`doc/架构/初版架构.md` 和已通过测试的源码为准。

## 架构正文（`doc/架构/`）

| 文件 | 回答什么 |
|---|---|
| [初版架构.md](./架构/初版架构.md) | `read` / `edit` / `write` / `search` 调用链、模块职责、协议约束、依赖边界、Session 生命周期、人类可读投影与测试层次 |

## 决策与经验

- [决策档案/README.md](./决策档案/README.md)：ADR 索引。修订以「后记」追加，不改写原文。
- [经验笔记.md](./经验笔记.md)：可改的做法与避坑经验（现象 + 做法 + 证据）。

## 证据与历史（`doc/references/`）

只保存来源、验证记录与历史阶段，不维护第二份现行正文：

| 文件 | 内容 |
|---|---|
| [oh-my-pi-hashline调研.md](./references/oh-my-pi-hashline调研.md) | 外部来源、已核实机制与本项目借鉴点 |

## 维护规则

- 机制变化 → 更新 `doc/架构/` 对应正文；难逆转决策 → 新增 ADR 并同步索引；可复用做法 → 追加 `经验笔记.md`。
- 用户可感知的已完成变化 → 日常写入本仓中文 `CHANGELOG-zh.md`，准备发布时按版本同步更新英文 `CHANGELOG.md`；两份都随 npm 包发布。
- 公开协议或用户可见行为变化 → 同步英文 `README.md` 与中文 `README-zh.md`；内部文件（`doc/`、`AGENTS.md`）无需全译。
- 当前没有独立规格正文、路线图、版本实施方案或历史归档，因此不创建对应空目录。
