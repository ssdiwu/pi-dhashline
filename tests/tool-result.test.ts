import { describe, expect, it } from "vitest";
import { humanizeToolCall, humanizeToolResult } from "../src/tui/tool-result.js";

const tag = "ABCDEF12";

function render(component: { render(width: number): string[] }): string {
  return component.render(120).join("\n");
}

describe("human-readable tool projection", () => {
  it("read 默认摘要，展开显示锚点和可复制编辑语法", () => {
    const result = {
      content: [{ type: "text", text: `[sample.txt#${tag}]\n1:alpha\n2:beta` }],
      details: undefined,
    };
    expect(humanizeToolCall("read", { path: "sample.txt" })).toBe("read sample.txt");
    const compact = humanizeToolResult("read", result, false, { path: "sample.txt" });
    expect(compact).toContain(`read sample.txt · 2 行 · tag ${tag}`);
    expect(compact).toContain("Ctrl+O");
    expect(compact).not.toContain("1:alpha");
    const expanded = humanizeToolResult("read", result, true, { path: "sample.txt" });
    expect(expanded).toContain("1  alpha");
    expect(expanded).toContain("SWAP 1:");
    expect(expanded).toContain("INS.POST 1:");
    expect(expanded).not.toContain("{");
  });

  it("edit 将 opaque DSL 投影为动作摘要和展开 diff", () => {
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
    expect(expanded).toContain("替换第 2 行：BETA");
    expect(expanded).toContain("在第 4 行后插入：omega");
    expect(expanded).toContain(`请求锚点：[sample.txt#${tag}]`);
    expect(expanded).toContain("本次协议（仅供审计，不要重复执行）：");
    expect(expanded).toContain("INS.POST 4:");
    expect(expanded).toContain("-2 beta");
    expect(expanded).toContain("继续编辑前必须重新 read 或 search");
    expect(expanded).not.toContain('"patch"');
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
