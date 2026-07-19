# tests

- 纯协议测试验证公共输入输出，不断言私有实现结构。
- 工具投影测试覆盖默认摘要、动态展开快捷键、精简上下文、错误指导和 renderer 接线，不比较原始 JSON。
- 文件集成测试只在临时目录运行并负责清理，create-only write 必须验证已有目标不变与失败无残留。
- Pi 宿主边界允许 mock（模拟）工具定义、ExtensionContext（扩展上下文）和 session custom entries（会话自定义条目）。
- 完成改动后依次运行 `npm test`、`npm run typecheck`、`npm run check` 与实际 Pi 加载 smoke test（冒烟测试）。
