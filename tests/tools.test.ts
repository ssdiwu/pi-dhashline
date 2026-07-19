import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { ExtensionAPI, ExtensionContext, ToolDefinition } from "@earendil-works/pi-coding-agent";
import { afterEach, describe, expect, it } from "vitest";
import { registerDHashlineTools } from "../src/tools.js";

const cleanups: string[] = [];
afterEach(async () => {
  await Promise.all(cleanups.splice(0).map((path) => rm(path, { recursive: true, force: true })));
});

async function harness(): Promise<{ dir: string; tools: Map<string, ToolDefinition>; ctx: ExtensionContext }> {
  const dir = await mkdtemp(join(tmpdir(), "pi-dhashline-tools-"));
  cleanups.push(dir);
  const tools = new Map<string, ToolDefinition>();
  const pi = {
    registerTool(tool: ToolDefinition) {
      tools.set(tool.name, tool);
    },
    appendEntry() {},
  } as unknown as ExtensionAPI;
  registerDHashlineTools(pi);
  const ctx = { cwd: dir, sessionManager: {} } as unknown as ExtensionContext;
  return { dir, tools, ctx };
}

function textOf(result: { content: Array<{ type: string; text?: string }> }): string {
  return result.content.find((item) => item.type === "text")?.text ?? "";
}

function rendered(component: { render(width: number): string[] }): string {
  return component.render(120).join("\n");
}

const fakeTheme = {
  fg: (color: string, value: string) => `<${color}>${value}</${color}>`,
  bg: (_color: string, value: string) => value,
  bold: (value: string) => `<b>${value}</b>`,
} as any;

function renderLifecycle(tool: ToolDefinition, args: any, result: any, expanded: boolean, isError = false) {
  const state: Record<string, unknown> = {};
  const base = { args, state, cwd: "/tmp", expanded, isError, lastComponent: undefined } as any;
  const call = tool.renderCall!(args, fakeTheme, base);
  const pending = rendered(call);
  const resultComponent = tool.renderResult!(result, { expanded, isPartial: false }, fakeTheme, base);
  const settledCall = tool.renderCall!(args, fakeTheme, { ...base, lastComponent: call });
  return { pending, settled: rendered(settledCall), result: rendered(resultComponent) };
}

describe("Pi tools", () => {
  it("publishes the complete edit grammar without requiring trial and error", async () => {
    const { tools } = await harness();
    const edit = tools.get("edit")!;
    const prompt = [edit.description, ...(edit.promptGuidelines ?? [])].join("\n");
    for (const syntax of ["SWAP N:", "SWAP N.=M:", "DEL N", "DEL N.=M", "INS.PRE N:", "INS.POST N:", "INS.HEAD:", "INS.TAIL:"]) {
      expect(prompt).toContain(syntax);
    }
    expect(prompt).toContain("Treat read and search output as authoritative");
    expect(prompt).toContain("already satisfied");
    expect(tools.get("read")?.renderResult).toBeTypeOf("function");
    expect(edit.renderResult).toBeTypeOf("function");
    expect(tools.get("write")?.renderResult).toBeTypeOf("function");
    expect(tools.get("search")?.renderResult).toBeTypeOf("function");
    expect(tools.get("write")?.description).toContain("Fails without writing if the target already exists");
    for (const name of ["read", "edit", "write", "search"]) expect(tools.get(name)?.renderShell).toBe("default");
  });

  it("merges call and result into one themed Pi-native component", async () => {
    const { tools } = await harness();
    const cases = [
      {
        name: "read",
        args: { path: "file.txt" },
        result: { content: [{ type: "text", text: "[file.txt#ABCDEF12]\n1:one" }], details: undefined },
        compact: "1 行 · tag ABCDEF12",
        expanded: "SWAP 1:",
      },
      {
        name: "edit",
        args: { input: "[file.txt#ABCDEF12]\nSWAP 1:\n+ONE" },
        result: { content: [{ type: "text", text: "Updated file.txt\n[file.txt#1234ABCD]" }], details: { diff: "-1 one\n+1 ONE", patch: "patch", firstChangedLine: 1 } },
        compact: "替换 1 处 · tag 1234ABCD",
        expanded: "-1 one",
      },
      {
        name: "write",
        args: { path: "new.txt", content: "one\ntwo\n" },
        result: {
          content: [{ type: "text", text: "Created new.txt\n[new.txt#1234ABCD]\n2 lines, 8 bytes." }],
          details: { path: "new.txt", tag: "1234ABCD", lines: 2, bytes: 8, created: true },
        },
        compact: "已创建 new.txt · 2 行 · tag 1234ABCD",
        expanded: "仅创建，未覆盖已有文件",
      },
      {
        name: "search",
        args: { pattern: "one", path: "." },
        result: { content: [{ type: "text", text: "[file.txt#ABCDEF12]\n*1:one" }], details: {} },
        compact: "1 个文件、1 处匹配",
        expanded: "1  one · 匹配",
      },
    ];
    for (const testCase of cases) {
      const tool = tools.get(testCase.name)!;
      const compact = renderLifecycle(tool, testCase.args, testCase.result, false);
      expect(compact.pending).toContain("<toolTitle>");
      expect(compact.settled).toContain(testCase.compact);
      expect(compact.settled).toContain("Ctrl+O");
      expect(compact.settled).not.toContain(testCase.expanded);
      expect(compact.result).toBe("");
      const expanded = renderLifecycle(tool, testCase.args, testCase.result, true);
      expect(expanded.settled).toContain(testCase.expanded);
      expect(expanded.result).toBe("");
    }
  });

  it("sanitizes terminal control sequences before native diff rendering", async () => {
    const { tools } = await harness();
    const edit = tools.get("edit")!;
    const args = { input: "[file.txt#ABCDEF12]\nSWAP 1:\n+PWN" };
    const result = {
      content: [{ type: "text", text: "Updated file.txt\n[file.txt#1234ABCD]" }],
      details: { diff: "-1 safe\n+1 \u001b[31mPWN\u001b[0m", patch: "patch", firstChangedLine: 1 },
    };
    const expanded = renderLifecycle(edit, args, result, true);
    expect(expanded.settled).not.toContain("\u001b");
    expect(expanded.settled).toContain("�[31mPWN�[0m");
  });

  it("uses Pi render context to project thrown edit errors", async () => {
    const { tools } = await harness();
    const edit = tools.get("edit")!;
    const args = { input: "[file.txt#ABCDEF12]\nINS.POST 4.=4:\n+omega" };
    const result = {
      content: [{ type: "text", text: "Unknown patch syntax at line 1: INS.POST 4.=4:. Expected INS.POST N: followed by +body lines." }],
      details: {},
    };
    const compact = renderLifecycle(edit, args, result, false, true);
    expect(compact.settled).toContain("语法错误");
    expect(compact.result).toBe("");
    const expanded = renderLifecycle(edit, args, result, true, true);
    expect(expanded.settled).toContain("收到：INS.POST 4.=4:");
    expect(expanded.settled).toContain("正确写法：INS.POST 4:");
    expect(expanded.result).toBe("");
  });

  it("reads tagged anchors and applies an edit with a fresh tag", async () => {
    const { dir, tools, ctx } = await harness();
    await writeFile(join(dir, "file.txt"), "one\ntwo\nthree\n");
    const read = tools.get("read")!;
    const edit = tools.get("edit")!;
    const readResult = await read.execute("r1", { path: "file.txt" }, undefined, undefined, ctx);
    const output = textOf(readResult);
    expect(output).toMatch(/^\[file\.txt#[0-9A-F]{8}\]\n1:one/m);
    const header = output.split("\n")[0]!;
    const editResult = await edit.execute(
      "e1",
      { input: `${header}\nSWAP 2:\n+TWO` },
      undefined,
      undefined,
      ctx,
    );
    expect(await readFile(join(dir, "file.txt"), "utf8")).toBe("one\nTWO\nthree\n");
    const freshHeader = textOf(editResult).split("\n").find((line) => /^\[file\.txt#[0-9A-F]{8}\]$/.test(line))!;
    expect(freshHeader).toBeDefined();
    expect((editResult.details as { diff: string }).diff).toContain("TWO");
    await expect(
      edit.execute("e2", { input: `${freshHeader}\nDEL 1` }, undefined, undefined, ctx),
    ).rejects.toThrow(/not shown/);
  });

  it("creates new files only, records an unseen fresh tag, and preserves existing targets", async () => {
    const { dir, tools, ctx } = await harness();
    const write = tools.get("write")!;
    const edit = tools.get("edit")!;
    await mkdir(join(dir, "nested"));
    const result = await write.execute(
      "w1",
      { path: "nested/new.txt", content: "one\ntwo\n" },
      undefined,
      undefined,
      ctx,
    );
    expect(await readFile(join(dir, "nested", "new.txt"), "utf8")).toBe("one\ntwo\n");
    expect(textOf(result)).toMatch(/^Created nested\/new\.txt\n\[nested\/new\.txt#[0-9A-F]{8}\]/);
    const header = textOf(result).split("\n")[1]!;
    await expect(edit.execute("e1", { input: `${header}\nDEL 1` }, undefined, undefined, ctx)).rejects.toThrow(/not shown/);
    await expect(
      write.execute("w2", { path: "nested/new.txt", content: "replace\n" }, undefined, undefined, ctx),
    ).rejects.toThrow(/already exists|did not write/i);
    expect(await readFile(join(dir, "nested", "new.txt"), "utf8")).toBe("one\ntwo\n");
    await tools.get("read")!.execute("r2", { path: "nested/new.txt" }, undefined, undefined, ctx);
    await rm(join(dir, "nested", "new.txt"));
    const recreated = await write.execute(
      "w3",
      { path: "nested/new.txt", content: "one\ntwo\n" },
      undefined,
      undefined,
      ctx,
    );
    const recreatedHeader = textOf(recreated).split("\n")[1]!;
    await expect(edit.execute("e2", { input: `${recreatedHeader}\nDEL 1` }, undefined, undefined, ctx)).rejects.toThrow(/not shown/);
  });

  it("limits edit display diff to one context line around each hunk", async () => {
    const { dir, tools, ctx } = await harness();
    const path = join(dir, "file.txt");
    await writeFile(path, "one\ntwo\nthree\nfour\nfive\nsix\nseven\n");
    const readResult = await tools.get("read")!.execute("r1", { path: "file.txt" }, undefined, undefined, ctx);
    const header = textOf(readResult).split("\n")[0]!;
    const result = await tools.get("edit")!.execute(
      "e1",
      { input: `${header}\nSWAP 4:\n+FOUR` },
      undefined,
      undefined,
      ctx,
    );
    const diff = (result.details as { diff: string }).diff;
    expect(diff).toContain("3 three");
    expect(diff).toContain("-4 four");
    expect(diff).toContain("+4 FOUR");
    expect(diff).toContain("5 five");
    expect(diff).not.toContain("2 two");
    expect(diff).not.toContain("6 six");
  });

  it("adds an actionable continuation offset when read output is truncated", async () => {
    const { dir, tools, ctx } = await harness();
    const content = Array.from({ length: 8000 }, (_, index) => `${index + 1}-${"x".repeat(20)}`).join("\n");
    await writeFile(join(dir, "large.txt"), content);
    const result = await tools.get("read")!.execute("r1", { path: "large.txt" }, undefined, undefined, ctx);
    expect(textOf(result)).toMatch(/\[Output truncated\. Use offset=\d+ to continue\.\]/);
  });

  it("rejects an anchor that was not included in a partial read", async () => {
    const { dir, tools, ctx } = await harness();
    await writeFile(join(dir, "file.txt"), "one\ntwo\nthree\n");
    const readResult = await tools.get("read")!.execute(
      "r1",
      { path: "file.txt", offset: 2, limit: 1 },
      undefined,
      undefined,
      ctx,
    );
    const header = textOf(readResult).split("\n")[0]!;
    await expect(
      tools.get("edit")!.execute("e1", { input: `${header}\nDEL 1` }, undefined, undefined, ctx),
    ).rejects.toThrow(/not shown/);
  });

  it("recovers a stale anchor after a unique head insertion", async () => {
    const { dir, tools, ctx } = await harness();
    const path = join(dir, "file.txt");
    await writeFile(path, "one\ntwo\nthree\n");
    const readResult = await tools.get("read")!.execute("r1", { path: "file.txt" }, undefined, undefined, ctx);
    const header = textOf(readResult).split("\n")[0]!;
    await writeFile(path, "zero\none\ntwo\nthree\n");
    const result = await tools.get("edit")!.execute(
      "e1",
      { input: `${header}\nSWAP 2:\n+TWO` },
      undefined,
      undefined,
      ctx,
    );
    expect(await readFile(path, "utf8")).toBe("zero\none\nTWO\nthree\n");
    expect(textOf(result)).toContain("Recovered a stale tag");
  });

  it("search returns tagged match anchors that can be edited", async () => {
    const { dir, tools, ctx } = await harness();
    const path = join(dir, "file.txt");
    await writeFile(path, "before\nneedle\nafter\n");
    const result = await tools.get("search")!.execute(
      "s1",
      { pattern: "needle", path: "." },
      undefined,
      undefined,
      ctx,
    );
    const output = textOf(result);
    expect(output).toMatch(/^\[file\.txt#[0-9A-F]{8}\]\n\*2:needle/m);
    const header = output.split("\n")[0]!;
    await tools.get("edit")!.execute(
      "e1",
      { input: `${header}\nSWAP 2:\n+found` },
      undefined,
      undefined,
      ctx,
    );
    expect(await readFile(path, "utf8")).toBe("before\nfound\nafter\n");
  });
});
