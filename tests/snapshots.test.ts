import { describe, expect, it } from "vitest";
import { computeFileTag } from "../src/hash.js";
import { SnapshotStore } from "../src/snapshots.js";

describe("SnapshotStore", () => {
  it("keeps versions and merges seen lines for identical content", () => {
    const store = new SnapshotStore();
    const tag = store.record("/a", "one\n", [1]);
    store.record("/a", "one\n", [2]);
    expect(store.byTag("/a", tag)?.seenLines).toEqual(new Set([1, 2]));
    expect(store.stats()).toMatchObject({ paths: 1, versions: 1 });
  });

  it("clears inherited seen lines when the same content becomes a fresh file state", () => {
    const store = new SnapshotStore();
    const tag = store.record("/a", "one\n", [1]);
    expect(store.byTag("/a", tag)?.seenLines).toEqual(new Set([1]));
    expect(store.recordFresh("/a", "one\n")).toBe(tag);
    expect(store.byTag("/a", tag)?.seenLines).toEqual(new Set());
    expect(store.stats()).toMatchObject({ paths: 1, versions: 1 });
  });

  it("limits versions and paths by LRU", () => {
    const store = new SnapshotStore({ maxPaths: 2, maxVersionsPerPath: 2 });
    store.record("/a", "a1");
    store.record("/a", "a2");
    store.record("/a", "a3");
    expect(store.byTag("/a", computeFileTag("a1"))).toBeNull();
    store.record("/b", "b");
    store.record("/c", "c");
    expect(store.head("/a")).toBeNull();
    expect(store.stats().paths).toBe(2);
  });

  it("evicts histories when the byte budget is exceeded", () => {
    const store = new SnapshotStore({ maxTotalBytes: 5 });
    store.record("/a", "1234");
    store.record("/b", "5678");
    expect(store.head("/a")).toBeNull();
    expect(store.head("/b")?.text).toBe("5678");
  });
});
