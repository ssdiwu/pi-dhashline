import { chmod, link, lstat, mkdir, readFile, stat, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { mkdtemp } from "node:fs/promises";
import { afterEach, describe, expect, it } from "vitest";
import { rm } from "node:fs/promises";
import { atomicWriteText, createTextFileExclusive, readTextFile } from "../src/files.js";

const cleanups: string[] = [];
afterEach(async () => {
  await Promise.all(cleanups.splice(0).map((path) => rm(path, { recursive: true, force: true })));
});

async function temp(): Promise<string> {
  const path = await mkdtemp(join(tmpdir(), "pi-dhashline-"));
  cleanups.push(path);
  return path;
}

describe("text file mutation", () => {
  it("preserves BOM, CRLF and permissions through atomic replacement", async () => {
    const dir = await temp();
    const path = join(dir, "file.txt");
    await writeFile(path, "\uFEFFone\r\ntwo\r\n");
    await chmod(path, 0o640);
    const file = await readTextFile(path);
    expect(file.normalizedText).toBe("one\ntwo\n");
    await atomicWriteText(file, "one\nTWO\n");
    expect(await readFile(path, "utf8")).toBe("\uFEFFone\r\nTWO\r\n");
    expect((await stat(path)).mode & 0o777).toBe(0o640);
  });

  it("preserves a symbolic link and updates its target", async () => {
    const dir = await temp();
    const target = join(dir, "target.txt");
    const alias = join(dir, "alias.txt");
    await writeFile(target, "old\n");
    await symlink(target, alias);
    const file = await readTextFile(alias);
    await atomicWriteText(file, "new\n");
    expect((await lstat(alias)).isSymbolicLink()).toBe(true);
    expect(await readFile(target, "utf8")).toBe("new\n");
  });

  it("rejects hard-linked files instead of claiming a non-atomic write", async () => {
    const dir = await temp();
    const first = join(dir, "first.txt");
    const second = join(dir, "second.txt");
    await writeFile(first, "old\n");
    await link(first, second);
    const file = await readTextFile(first);
    await expect(atomicWriteText(file, "new\n")).rejects.toThrow(/hard link/i);
    expect(await readFile(first, "utf8")).toBe("old\n");
    expect((await stat(first)).ino).toBe((await stat(second)).ino);
  });

  it("creates a new text file exclusively inside an existing real parent", async () => {
    const dir = await temp();
    const parent = join(dir, "nested", "deep");
    await mkdir(parent, { recursive: true });
    const path = join(parent, "file.txt");
    const created = await createTextFileExclusive(path, "one\r\ntwo\r\n");
    expect(await readFile(path, "utf8")).toBe("one\r\ntwo\r\n");
    expect(created.normalizedText).toBe("one\ntwo\n");
    expect(created.size).toBe(Buffer.byteLength("one\r\ntwo\r\n"));
  });

  it("rejects existing files and symbolic links without changing their content", async () => {
    const dir = await temp();
    const existing = join(dir, "existing.txt");
    const target = join(dir, "target.txt");
    const alias = join(dir, "alias.txt");
    await writeFile(existing, "keep\n");
    await writeFile(target, "target\n");
    await symlink(target, alias);
    await expect(createTextFileExclusive(existing, "replace\n")).rejects.toThrow(/already exists|did not write/i);
    await expect(createTextFileExclusive(alias, "replace\n")).rejects.toThrow(/already exists|did not write/i);
    expect(await readFile(existing, "utf8")).toBe("keep\n");
    expect(await readFile(target, "utf8")).toBe("target\n");
    expect((await lstat(alias)).isSymbolicLink()).toBe(true);
    const parentAlias = join(dir, "parent-alias");
    await symlink(dir, parentAlias);
    await expect(createTextFileExclusive(join(parentAlias, "new.txt"), "new\n")).rejects.toThrow(/Parent path/);
    await expect(lstat(join(dir, "new.txt"))).rejects.toMatchObject({ code: "ENOENT" });
  });

  it("rejects unsafe content and missing parents without leaving a target", async () => {
    const dir = await temp();
    await expect(createTextFileExclusive(join(dir, "bad.txt"), "ok\u0000bad")).rejects.toThrow(/Binary/);
    await expect(createTextFileExclusive(join(dir, "unicode.txt"), "\ud800")).rejects.toThrow(/Unicode/);
    await expect(createTextFileExclusive(join(dir, "large.txt"), "123456", 5)).rejects.toThrow(/exceeds/);

    const missingParent = join(dir, "missing-parent");
    await expect(createTextFileExclusive(join(missingParent, "file.txt"), "text\n")).rejects.toThrow(/Parent directory does not exist/);
    await expect(lstat(missingParent)).rejects.toMatchObject({ code: "ENOENT" });
  });

  it("rejects oversized and binary files", async () => {
    const dir = await temp();
    const binary = join(dir, "binary.dat");
    await writeFile(binary, Buffer.from([1, 2, 0, 4]));
    await expect(readTextFile(binary)).rejects.toThrow(/Binary/);
    const invalidUtf8 = join(dir, "invalid.txt");
    await writeFile(invalidUtf8, Buffer.from([0xff, 0xfe, 0x61]));
    await expect(readTextFile(invalidUtf8)).rejects.toThrow(/UTF-8|Binary/);
    const oversized = join(dir, "large.txt");
    await mkdir(dir, { recursive: true });
    await writeFile(oversized, "123456");
    await expect(readTextFile(oversized, 5)).rejects.toThrow(/exceeds/);
  });
});
