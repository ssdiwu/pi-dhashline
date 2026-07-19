import { createHash } from "node:crypto";

export const FILE_TAG_LENGTH = 8;
export const SNAPSHOT_MAX_BYTES = 4 * 1024 * 1024;

export function normalizeText(text: string): string {
  const withoutBom = text.startsWith("\uFEFF") ? text.slice(1) : text;
  return withoutBom.replaceAll("\r\n", "\n").replaceAll("\r", "\n");
}

export function computeFileTag(normalizedText: string): string {
  return createHash("sha256")
    .update(normalizedText, "utf8")
    .digest("hex")
    .slice(0, FILE_TAG_LENGTH)
    .toUpperCase();
}

export function formatFileHeader(displayPath: string, tag: string): string {
  return `[${displayPath}#${tag}]`;
}

export function getVisibleLines(normalizedText: string): string[] {
  if (normalizedText.length === 0) return [];
  const lines = normalizedText.split("\n");
  if (normalizedText.endsWith("\n")) lines.pop();
  return lines;
}

export function formatNumberedLines(lines: readonly string[], startLine = 1): string {
  return lines.map((line, index) => `${startLine + index}:${line}`).join("\n");
}
