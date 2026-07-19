import { describe, expect, it } from "vitest";
import { humanizeToolCall, humanizeToolResult } from "../src/tui/tool-result.js";

const tag = "ABCDEF12";

function render(component: { render(width: number): string[] }): string {
  return component.render(120).join("\n");
}

describe("human-readable tool projection", () => {
  it("read 默认摘要，展开仅显示窗口边界和可复制编辑语法", () => {
    const result = {
      content: [{ type: "text", text: `[sample.txt#${tag}]\n1:alpha\n2:beta\n3:gamma\n4:delta` }],
      details: undefined,
    };
    expect(humanizeToolCall("read", { path: "sample.txt" })).toBe("read sample.txt");
    const compact = humanizeToolResult("read", result, false, { path: "sample.txt" }, "Alt+E 展开");
    expect(compact).toContain(`read sample.txt · 4 行 · tag ${tag}`);
    expect(compact).toContain("Alt+E 展开");
    expect(compact).not.toContain("1:alpha");
    const expanded = humanizeToolResult("read", result, true, { path: "sample.txt" });
    expect(expanded).toContain("1  alpha");
    expect(expanded).toContain("4  delta");
    expect(expanded).toContain("省略第 2–3 行");
    expect(expanded).not.toContain("2  beta");
    expect(expanded).not.toContain("3  gamma");
    expect(expanded).toContain("SWAP 1:");
    expect(expanded).toContain("INS.POST 1:");
    expect(expanded).not.toContain("{");
  });

  it("edit 将 opaque DSL 投影为动作摘要和单行上下文 diff", () => {
    const input = `[sample.txt#${tag}]\nSWAP 2.=2:\n+BETA\nINS.POST 4:\n+omega`;
    const result = {
      content: [{ type: "text", text: "Updated sample.txt\n[sample.txt#1234ABCD]\nRead or search the fresh tag before another edit." }],
      details: { diff: " 1 alpha\n-2 beta\n+2 BETA\n 3 needle\n+5 omega", patch: "patch", firstChangedLine: 2 },
    };
    const call = humanizeToolCall("edit", { input });
    expect(call).toContain("edit sample.txt · 替换 1 处、插入 1 处");
    const compact = humanizeToolResult("edit", result, false, { input });
    expect(compact).toContain("已更新 sample.txt · 替换 1 处、插入 1 处 · tag 1234ABCD");
    expect(compact).toContain("Ctrl+O");
    expect(compact).not.toContain("-2 beta");
    const expanded = humanizeToolResult("edit", result, true, { input });
    expect(expanded).toContain("替换第 2 行");
    expect(expanded).toContain("在第 4 行后插入");
    expect(expanded).toContain(`请求锚点：[sample.txt#${tag}]`);
    expect(expanded).not.toContain("本次协议（仅供审计，不要重复执行）：");
    expect(expanded).not.toContain("INS.POST 4:");
    expect(expanded).not.toContain("替换第 2 行：BETA");
    expect(expanded).toContain("-2 beta");
    expect(expanded).toContain("继续编辑前必须重新 read 或 search");
    expect(expanded).not.toContain('"patch"');
  });

  it("write 不回显正文，并明确 create-only 结果和已存在错误", () => {
    const args = { path: "new.txt", content: "secret one\nsecret two\n" };
    expect(humanizeToolCall("write", args)).toBe("write new.txt · 创建 2 行");
    const result = {
      content: [{ type: "text", text: "Created new.txt\n[new.txt#1234ABCD]\n2 lines, 22 bytes." }],
      details: { path: "new.txt", tag: "1234ABCD", lines: 2, bytes: 22, created: true },
    };
    const compact = humanizeToolResult("write", result, false, args);
    expect(compact).toContain("已创建 new.txt · 2 行 · tag 1234ABCD");
    expect(compact).not.toContain("secret");
    const expanded = humanizeToolResult("write", result, true, args);
    expect(expanded).toContain("结果锚点：[new.txt#1234ABCD]");
    expect(expanded).toContain("仅创建，未覆盖已有文件");
    expect(expanded).toContain("继续编辑前请先 read 或 search");
    expect(expanded).not.toContain("secret");

    const error = {
      isError: true,
      content: [{ type: "text", text: "Target already exists; DHashline write only creates new files and did not write: new.txt" }],
      details: {},
    };
    expect(humanizeToolResult("write", error, false, args)).toContain("目标已存在，未写入");
    expect(humanizeToolResult("write", error, true, args)).toContain("目标未被修改");
  });

  it("search 默认显示数量，展开显示匹配锚点和编辑示例", () => {
    const result = {
      content: [{ type: "text", text: `[sample.txt#${tag}]\n*3:needle\n 4:context` }],
      details: {},
    };
    expect(humanizeToolCall("search", { pattern: "needle", path: "sample.txt" })).toBe('search "needle" · sample.txt');
    const compact = humanizeToolResult("search", result, false, { pattern: "needle", path: "sample.txt" });
    expect(compact).toContain('search "needle" · 1 个文件、1 处匹配');
    expect(compact).toContain("Ctrl+O");
    expect(compact).not.toContain("*3:needle");
    const expanded = humanizeToolResult("search", result, true, { pattern: "needle", path: "sample.txt" });
    expect(expanded).toContain("3  needle · 匹配");
    expect(expanded).toContain("SWAP 3:");
    expect(expanded).not.toContain("{");
  });

  it("语法错误默认收敛，展开给出收到内容和正确写法", () => {
    const input = `[sample.txt#${tag}]\nINS.POST 4.=4:\n+omega`;
    const result = {
      isError: true,
      content: [{ type: "text", text: "Unknown patch syntax at line 1: INS.POST 4.=4:. Expected INS.POST N: followed by +body lines." }],
      details: {},
    };
    const compact = humanizeToolResult("edit", result, false, { input });
    expect(compact).toContain("edit sample.txt · 语法错误");
    expect(compact).toContain("Ctrl+O");
    const expanded = humanizeToolResult("edit", result, true, { input });
    expect(expanded).toContain("收到：INS.POST 4.=4:");
    expect(expanded).not.toContain("收到：INS.POST 4.=4:. Expected");
    expect(expanded).toContain("正确写法：INS.POST 4:");
    expect(expanded).not.toContain("{");
  });

  it("折叠路径和搜索模式中的换行，避免污染 TUI 行", () => {
    expect(humanizeToolCall("read", { path: "bad\npath.txt" })).toBe("read bad path.txt");
    expect(humanizeToolCall("search", { pattern: "a\r\nb", path: "dir\nname" })).toBe('search "a b" · dir name');
  });
});
