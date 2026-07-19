import { describe, expect, it } from "vitest";
import { computeFileTag } from "../src/hash.js";
import { applyOperations, parsePatch, preparePatch, recoverOperations, validateOperations } from "../src/protocol.js";
import { SnapshotStore } from "../src/snapshots.js";

function tagged(text: string, body: string): string {
  return `[file.txt#${computeFileTag(text)}]\n${body}`;
}

describe("DHashline protocol", () => {
  it("parses and applies SWAP, DEL and insert operations in original coordinates", () => {
    const text = "one\ntwo\nthree\nfour\nfive\n";
    const patch = parsePatch(tagged(text, [
      "INS.HEAD:", "+zero", "SWAP 2.=2:", "+TWO", "INS.POST 3:", "+three-and-half", "DEL 5",
    ].join("\n")));
    expect(applyOperations(text, patch.operations)).toBe("zero\none\nTWO\nthree\nthree-and-half\nfour\n");
  });

  it("preserves explicit blank body lines and terminal newline style", () => {
    const text = "one\n";
    const patch = parsePatch(tagged(text, "INS.TAIL:\n+two\n+"));
    expect(applyOperations(text, patch.operations)).toBe("one\ntwo\n\n");
  });

  it.each([
    "[file.txt#1234]\nDEL 1",
    "[file.txt#12345678]\nSWAP 1:\nraw",
    "[file.txt#12345678]\nDEL 2.=1",
    "[file.txt#12345678]\nUNKNOWN 1",
    "[file.txt#12345678]",
  ])("rejects invalid syntax: %s", (input) => {
    expect(() => parsePatch(input)).toThrow();
  });

  it("returns actionable grammar help for malformed operations", () => {
    expect(() => parsePatch("[file.txt#12345678]\nINS.POST 4.=4:\n+omega")).toThrow(
      /Expected INS\.POST N: followed by \+body lines/,
    );
    expect(() => parsePatch("[file.txt#12345678]\nSWAP 2.=2\n+BETA")).toThrow(
      /Expected SWAP N: or SWAP N\.=M:/,
    );
  });

  it("rejects overlapping edits and unseen anchors", () => {
    const operations = parsePatch("[file.txt#12345678]\nSWAP 1.=2:\n+x\nDEL 2").operations;
    expect(() => validateOperations(operations, 3, new Set([1, 2, 3]))).toThrow(/overlap/);
    const deletion = parsePatch("[file.txt#12345678]\nDEL 2").operations;
    expect(() => validateOperations(deletion, 3, new Set([1]))).toThrow(/not shown/);
  });

  it("recovers one unique uniform line offset", () => {
    const snapshot = "one\ntwo\nthree\n";
    const current = "zero\none\ntwo\nthree\n";
    const operations = parsePatch(tagged(snapshot, "SWAP 2:\n+TWO")).operations;
    const recovered = recoverOperations(snapshot, current, operations);
    expect(recovered).not.toBeNull();
    expect(applyOperations(current, recovered!)).toBe("zero\none\nTWO\nthree\n");
  });

  it("rejects ambiguous or changed stale anchors", () => {
    const snapshot = "before\ntarget\nafter\n";
    const operations = parsePatch(tagged(snapshot, "DEL 2")).operations;
    expect(recoverOperations(snapshot, "before\nchanged\nafter\n", operations)).toBeNull();
    expect(recoverOperations(snapshot, "before\ntarget\nafter\nbefore\ntarget\nafter\n", operations)).toBeNull();
  });

  it("rejects a satisfied SWAP before another operation can duplicate content", () => {
    const text = "one\nTWO\nthree\nfour\n";
    const section = parsePatch(tagged(text, "SWAP 2:\n+TWO\nINS.POST 3:\n+four"));
    expect(() => applyOperations(text, section.operations)).toThrow(/SWAP.*already matches|already satisfied/i);
  });

  it("requires a session snapshot and reports satisfied no-op operations", () => {
    const text = "one\n";
    const section = parsePatch(tagged(text, "SWAP 1:\n+one"));
    expect(() => preparePatch(section, "/file", text, new SnapshotStore())).toThrow(/not from this session/);
    const store = new SnapshotStore();
    store.record("/file", text, [1]);
    expect(() => preparePatch(section, "/file", text, store)).toThrow(/already matches/);
  });

  it("prepares a stale edit only when its original anchors were seen", () => {
    const snapshot = "one\ntwo\nthree\n";
    const current = "zero\none\ntwo\nthree\n";
    const section = parsePatch(tagged(snapshot, "SWAP 2:\n+TWO"));
    const store = new SnapshotStore();
    store.record("/file", snapshot, [2]);
    const prepared = preparePatch(section, "/file", current, store);
    expect(prepared.recovered).toBe(true);
    expect(prepared.text).toContain("TWO");
  });

  it("rejects a stale patch that has only HEAD or TAIL insertions", () => {
    const snapshot = "one\n";
    const current = "changed\n";
    const section = parsePatch(tagged(snapshot, "INS.TAIL:\n+two"));
    const store = new SnapshotStore();
    store.record("/file", snapshot);
    expect(() => preparePatch(section, "/file", current, store)).toThrow(/re-read|changed/i);
  });

  it("rejects a live-tag collision when snapshot content differs", () => {
    const current = "current\n";
    const tag = computeFileTag(current);
    const section = parsePatch(`[file.txt#${tag}]\nDEL 1`);
    const fakeStore = {
      byTag: () => ({ path: "/file", text: "different\n", tag, seenLines: new Set([1]), recordedAt: 0 }),
      hasTag: () => true,
    } as unknown as SnapshotStore;
    expect(() => preparePatch(section, "/file", current, fakeStore)).toThrow(/collision|re-read/i);
  });
});
