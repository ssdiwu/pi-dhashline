import { constants } from "node:fs";
import { isUtf8 } from "node:buffer";
import { access, lstat, open, readFile, realpath, rename, stat, unlink } from "node:fs/promises";
import { homedir } from "node:os";
import { dirname, isAbsolute, relative, resolve } from "node:path";
import { randomBytes } from "node:crypto";
import { normalizeText, SNAPSHOT_MAX_BYTES } from "./hash.js";

export type LineEnding = "\n" | "\r\n" | "\r";

export interface TextFile {
  readonly requestedPath: string;
  readonly targetPath: string;
  readonly normalizedText: string;
  readonly hasBom: boolean;
  readonly lineEnding: LineEnding;
  readonly mode: number;
  readonly size: number;
}

export interface DiffDetails {
  readonly diff: string;
  readonly patch: string;
  readonly firstChangedLine: number;
}

export function resolveInputPath(cwd: string, input: string): string {
  const expanded = input === "~" ? homedir() : input.startsWith("~/") ? resolve(homedir(), input.slice(2)) : input;
  return isAbsolute(expanded) ? resolve(expanded) : resolve(cwd, expanded);
}

export function displayPath(cwd: string, absolutePath: string): string {
  const local = relative(cwd, absolutePath);
  return local.length > 0 && !local.startsWith("..") && !isAbsolute(local) ? local : absolutePath;
}

export function detectLineEnding(raw: string): LineEnding {
  const crlf = (raw.match(/\r\n/g) ?? []).length;
  const lf = (raw.match(/(?<!\r)\n/g) ?? []).length;
  const cr = (raw.match(/\r(?!\n)/g) ?? []).length;
  if (crlf >= lf && crlf >= cr && crlf > 0) return "\r\n";
  if (cr > lf && cr > 0) return "\r";
  return "\n";
}

export function isProbablyBinary(buffer: Buffer): boolean {
  const sample = buffer.subarray(0, Math.min(buffer.length, 8192));
  let controls = 0;
  for (const byte of sample) {
    if (byte === 0) return true;
    if (byte < 7 || (byte > 13 && byte < 32)) controls++;
  }
  return sample.length > 0 && controls / sample.length > 0.1;
}

export async function readTextFile(path: string, maxBytes = SNAPSHOT_MAX_BYTES): Promise<TextFile> {
  const requestedPath = resolve(path);
  const requestedStat = await lstat(requestedPath);
  if (!requestedStat.isFile() && !requestedStat.isSymbolicLink()) throw new Error(`Not a regular file: ${path}`);
  const targetPath = await realpath(requestedPath);
  const targetStat = await stat(targetPath);
  if (!targetStat.isFile()) throw new Error(`Not a regular file: ${path}`);
  if (targetStat.size > maxBytes) throw new Error(`File exceeds ${maxBytes} byte editable limit: ${path}`);
  await access(targetPath, constants.R_OK);
  const buffer = await readFile(targetPath);
  if (isProbablyBinary(buffer)) throw new Error(`Binary files cannot receive DHashline tags: ${path}`);
  if (!isUtf8(buffer)) throw new Error(`File is not valid UTF-8 and cannot receive DHashline tags: ${path}`);
  const raw = buffer.toString("utf8");
  return {
    requestedPath,
    targetPath,
    normalizedText: normalizeText(raw),
    hasBom: raw.startsWith("\uFEFF"),
    lineEnding: detectLineEnding(raw),
    mode: targetStat.mode & 0o7777,
    size: targetStat.size,
  };
}

export function encodeText(file: TextFile, normalizedText: string): string {
  const body = file.lineEnding === "\n" ? normalizedText : normalizedText.replaceAll("\n", file.lineEnding);
  return file.hasBom ? `\uFEFF${body}` : body;
}

export async function atomicWriteText(file: TextFile, normalizedText: string): Promise<void> {
  const encoded = encodeText(file, normalizedText);
  await access(file.targetPath, constants.W_OK);
  const preflight = await stat(file.targetPath);
  if (preflight.nlink > 1) {
    throw new Error(`Refusing to edit a file with ${preflight.nlink} hard links because atomic replacement would break link identity`);
  }

  const tempPath = resolve(dirname(file.targetPath), `.${randomBytes(8).toString("hex")}.dhashline.tmp`);
  let handle: Awaited<ReturnType<typeof open>> | undefined;
  try {
    handle = await open(tempPath, "wx", 0o600);
    await handle.writeFile(encoded, "utf8");
    await handle.sync();
    await handle.chmod(file.mode);
    await handle.close();
    handle = undefined;
    const beforeRename = await stat(file.targetPath);
    if (beforeRename.nlink > 1) {
      throw new Error(`Refusing to edit a file with ${beforeRename.nlink} hard links because atomic replacement would break link identity`);
    }
    await rename(tempPath, file.targetPath);
  } catch (error) {
    await handle?.close().catch(() => undefined);
    await unlink(tempPath).catch(() => undefined);
    throw error;
  }
}

function commonEdges(oldLines: string[], newLines: string[]): { prefix: number; suffix: number } {
  let prefix = 0;
  while (prefix < oldLines.length && prefix < newLines.length && oldLines[prefix] === newLines[prefix]) prefix++;
  let suffix = 0;
  while (
    suffix < oldLines.length - prefix &&
    suffix < newLines.length - prefix &&
    oldLines[oldLines.length - 1 - suffix] === newLines[newLines.length - 1 - suffix]
  ) suffix++;
  return { prefix, suffix };
}

function capChangedLines(lines: string[], marker: "+" | "-", start: number, width: number): string[] {
  const limit = 120;
  const shown = lines.length <= limit ? lines : [...lines.slice(0, 60), `… ${lines.length - 120} lines omitted …`, ...lines.slice(-60)];
  return shown.map((line, index) => `${marker}${String(start + index).padStart(width)} ${line}`);
}

export function createDiffDetails(path: string, oldText: string, newText: string): DiffDetails {
  const oldLines = oldText.split("\n");
  const newLines = newText.split("\n");
  const { prefix, suffix } = commonEdges(oldLines, newLines);
  const oldChanged = oldLines.slice(prefix, oldLines.length - suffix);
  const newChanged = newLines.slice(prefix, newLines.length - suffix);
  const width = String(Math.max(oldLines.length, newLines.length)).length;
  const before = oldLines.slice(Math.max(0, prefix - 4), prefix);
  const after = oldLines.slice(oldLines.length - suffix, oldLines.length - suffix + 4);
  const display = [
    ...before.map((line, index) => ` ${String(prefix - before.length + index + 1).padStart(width)} ${line}`),
    ...capChangedLines(oldChanged, "-", prefix + 1, width),
    ...capChangedLines(newChanged, "+", prefix + 1, width),
    ...after.map((line, index) => ` ${String(oldLines.length - suffix + index + 1).padStart(width)} ${line}`),
  ].join("\n");
  const patchBody = [
    ...before.map((line) => ` ${line}`),
    ...oldChanged.map((line) => `-${line}`),
    ...newChanged.map((line) => `+${line}`),
    ...after.map((line) => ` ${line}`),
  ].join("\n");
  const oldStart = Math.max(1, prefix - before.length + 1);
  const newStart = oldStart;
  const patch = `--- a/${path}\n+++ b/${path}\n@@ -${oldStart},${before.length + oldChanged.length + after.length} +${newStart},${before.length + newChanged.length + after.length} @@\n${patchBody}\n`;
  return { diff: display, patch, firstChangedLine: prefix + 1 };
}
