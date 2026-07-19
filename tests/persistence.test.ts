import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { ExtensionAPI, ExtensionContext, ToolDefinition } from "@earendil-works/pi-coding-agent";
import { afterEach, describe, expect, it } from "vitest";
import extension from "../index.js";

const cleanups: string[] = [];
afterEach(async () => {
  await Promise.all(cleanups.splice(0).map((path) => rm(path, { recursive: true, force: true })));
});

interface CustomEntry {
  type: "custom";
  customType: string;
  data: unknown;
}

function runtime(entries: CustomEntry[]) {
  const tools = new Map<string, ToolDefinition>();
  const events = new Map<string, (event: unknown, ctx: ExtensionContext) => unknown>();
  const pi = {
    registerTool(tool: ToolDefinition) {
      tools.set(tool.name, tool);
    },
    registerCommand() {},
    on(name: string, handler: (event: unknown, ctx: ExtensionContext) => unknown) {
      events.set(name, handler);
    },
    appendEntry(customType: string, data: unknown) {
      entries.push({ type: "custom", customType, data });
    },
  } as unknown as ExtensionAPI;
  extension(pi);
  return { tools, events };
}

function context(cwd: string, entries: CustomEntry[], branch: CustomEntry[] = entries): ExtensionContext {
  return { cwd, sessionManager: { getEntries: () => entries, getBranch: () => branch } } as unknown as ExtensionContext;
}

function textOf(result: { content: Array<{ type: string; text?: string }> }): string {
  return result.content.find((item) => item.type === "text")?.text ?? "";
}

describe("session persistence", () => {
  it("restores snapshots and seen lines after an extension reload", async () => {
    const dir = await mkdtemp(join(tmpdir(), "pi-dhashline-session-"));
    cleanups.push(dir);
    const path = join(dir, "file.txt");
    await writeFile(path, "one\ntwo\n");
    const entries: CustomEntry[] = [];

    const first = runtime(entries);
    const firstContext = context(dir, entries);
    const readResult = await first.tools.get("read")!.execute("r1", { path: "file.txt" }, undefined, undefined, firstContext);
    const header = textOf(readResult).split("\n")[0]!;
    expect(entries.length).toBeGreaterThan(0);

    const branch = [...entries];
    entries.push({ type: "custom", customType: "pi-dhashline:clear-v1", data: { cwd: dir } });
    const resumed = runtime(entries);
    const resumedContext = context(dir, entries, branch);
    const onStart = resumed.events.get("session_start");
    expect(onStart).toBeDefined();
    await onStart!({ type: "session_start", reason: "resume" }, resumedContext);
    await resumed.tools.get("edit")!.execute(
      "e1",
      { input: `${header}\nSWAP 2:\n+TWO` },
      undefined,
      undefined,
      resumedContext,
    );
    expect(await readFile(path, "utf8")).toBe("one\nTWO\n");
  });
});
