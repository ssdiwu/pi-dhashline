import { Buffer } from "node:buffer";
import { computeFileTag } from "./hash.js";

export interface Snapshot {
  readonly path: string;
  readonly text: string;
  readonly tag: string;
  readonly seenLines: Set<number>;
  recordedAt: number;
}

export interface SnapshotStoreOptions {
  maxPaths?: number;
  maxVersionsPerPath?: number;
  maxTotalBytes?: number;
}

const DEFAULT_MAX_PATHS = 30;
const DEFAULT_MAX_VERSIONS = 4;
const DEFAULT_MAX_BYTES = 64 * 1024 * 1024;

function addSeen(target: Set<number>, lines?: Iterable<number>): void {
  if (!lines) return;
  for (const line of lines) {
    if (Number.isInteger(line) && line > 0) target.add(line);
  }
}

function historyBytes(history: readonly Snapshot[]): number {
  return history.reduce((sum, entry) => sum + Buffer.byteLength(entry.text), 0);
}

export class SnapshotStore {
  readonly #histories = new Map<string, Snapshot[]>();
  readonly #maxPaths: number;
  readonly #maxVersions: number;
  readonly #maxBytes: number;
  #totalBytes = 0;

  constructor(options: SnapshotStoreOptions = {}) {
    this.#maxPaths = options.maxPaths ?? DEFAULT_MAX_PATHS;
    this.#maxVersions = options.maxVersionsPerPath ?? DEFAULT_MAX_VERSIONS;
    this.#maxBytes = options.maxTotalBytes ?? DEFAULT_MAX_BYTES;
  }

  record(path: string, text: string, seenLines?: Iterable<number>): string {
    const tag = computeFileTag(text);
    const history = this.#histories.get(path) ?? [];
    const existing = history.find((entry) => entry.tag === tag && entry.text === text);
    if (existing) {
      existing.recordedAt = Date.now();
      addSeen(existing.seenLines, seenLines);
      this.#replace(path, [existing, ...history.filter((entry) => entry !== existing)]);
      return tag;
    }

    const snapshot: Snapshot = {
      path,
      text,
      tag,
      seenLines: new Set<number>(),
      recordedAt: Date.now(),
    };
    addSeen(snapshot.seenLines, seenLines);
    this.#replace(path, [snapshot, ...history].slice(0, this.#maxVersions));
    this.#enforceLimits();
    return tag;
  }

  head(path: string): Snapshot | null {
    this.#touch(path);
    return this.#histories.get(path)?.[0] ?? null;
  }

  byContent(path: string, text: string): Snapshot | null {
    const match = (this.#histories.get(path) ?? []).find((entry) => entry.text === text) ?? null;
    this.#touch(path);
    return match;
  }

  byTag(path: string, tag: string): Snapshot | null {
    const matches = (this.#histories.get(path) ?? []).filter((entry) => entry.tag === tag);
    this.#touch(path);
    return matches.length === 1 ? matches[0] ?? null : null;
  }

  hasTag(path: string, tag: string): boolean {
    return (this.#histories.get(path) ?? []).some((entry) => entry.tag === tag);
  }

  recordSeenLines(path: string, tag: string, lines: Iterable<number>): void {
    const matches = (this.#histories.get(path) ?? []).filter((entry) => entry.tag === tag);
    if (matches.length !== 1) return;
    addSeen(matches[0]!.seenLines, lines);
    this.#touch(path);
  }

  stats(): { paths: number; versions: number; bytes: number } {
    let versions = 0;
    for (const history of this.#histories.values()) versions += history.length;
    return { paths: this.#histories.size, versions, bytes: this.#totalBytes };
  }

  clear(): void {
    this.#histories.clear();
    this.#totalBytes = 0;
  }

  #touch(path: string): void {
    const history = this.#histories.get(path);
    if (!history) return;
    this.#histories.delete(path);
    this.#histories.set(path, history);
  }

  #replace(path: string, history: Snapshot[]): void {
    const previous = this.#histories.get(path) ?? [];
    this.#totalBytes -= historyBytes(previous);
    this.#histories.delete(path);
    if (history.length === 0) return;
    this.#histories.set(path, history);
    this.#totalBytes += historyBytes(history);
  }

  #enforceLimits(): void {
    while (this.#histories.size > this.#maxPaths || this.#totalBytes > this.#maxBytes) {
      const oldestPath = this.#histories.keys().next().value as string | undefined;
      if (!oldestPath) break;
      this.#replace(oldestPath, []);
    }
  }
}
