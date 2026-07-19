import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { DEFAULT_CONFIG, loadConfig } from "../src/config.js";

const cleanups: string[] = [];
afterEach(async () => {
  await Promise.all(cleanups.splice(0).map((path) => rm(path, { recursive: true, force: true })));
});

async function temp(): Promise<string> {
  const dir = await mkdtemp(join(tmpdir(), "pi-dhashline-config-"));
  cleanups.push(dir);
  return dir;
}

describe("dhashline.json", () => {
  it("uses bounded defaults when no config exists", async () => {
    const dir = await temp();
    expect(loadConfig(dir)).toEqual(DEFAULT_CONFIG);
  });

  it("loads snapshot and file limits", async () => {
    const dir = await temp();
    await writeFile(join(dir, "dhashline.json"), JSON.stringify({
      maxFileBytes: 1024,
      snapshots: { maxPaths: 5, maxVersionsPerPath: 2, maxTotalBytes: 4096 },
    }));
    expect(loadConfig(dir)).toMatchObject({
      maxFileBytes: 1024,
      snapshots: { maxPaths: 5, maxVersionsPerPath: 2, maxTotalBytes: 4096 },
    });
  });

  it("rejects unknown or unsafe values", async () => {
    const dir = await temp();
    await writeFile(join(dir, "dhashline.json"), JSON.stringify({ unsafe: true }));
    expect(() => loadConfig(dir)).toThrow(/unknown/i);
    await writeFile(join(dir, "dhashline.json"), JSON.stringify({ maxFileBytes: 0 }));
    expect(() => loadConfig(dir)).toThrow(/maxFileBytes/);
  });
});
