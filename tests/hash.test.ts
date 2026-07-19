import { describe, expect, it } from "vitest";
import { computeFileTag, formatFileHeader, getVisibleLines, normalizeText } from "../src/hash.js";

describe("file tags", () => {
  it("normalizes BOM and line endings before hashing", () => {
    const normalized = normalizeText("\uFEFFone\r\ntwo\r");
    expect(normalized).toBe("one\ntwo\n");
    expect(computeFileTag(normalized)).toMatch(/^[0-9A-F]{8}$/);
    expect(computeFileTag(normalized)).toBe(computeFileTag("one\ntwo\n"));
  });

  it("keeps content differences significant", () => {
    expect(computeFileTag("line \n")).not.toBe(computeFileTag("line\n"));
  });

  it("formats headers and visible lines", () => {
    expect(formatFileHeader("src/a.ts", "ABCDEF12")).toBe("[src/a.ts#ABCDEF12]");
    expect(getVisibleLines("a\n\n")).toEqual(["a", ""]);
    expect(getVisibleLines("")).toEqual([]);
  });
});
