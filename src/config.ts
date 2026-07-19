import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { SNAPSHOT_MAX_BYTES } from "./hash.js";
import type { SnapshotStoreOptions } from "./snapshots.js";

export interface DHashlineConfig {
  readonly maxFileBytes: number;
  readonly snapshots: Required<SnapshotStoreOptions>;
}

export const DEFAULT_CONFIG: DHashlineConfig = Object.freeze({
  maxFileBytes: SNAPSHOT_MAX_BYTES,
  snapshots: Object.freeze({
    maxPaths: 30,
    maxVersionsPerPath: 4,
    maxTotalBytes: 64 * 1024 * 1024,
  }),
});

function objectValue(value: unknown, label: string): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error(`${label} must be a JSON object`);
  return value as Record<string, unknown>;
}

function rejectUnknown(object: Record<string, unknown>, allowed: readonly string[], label: string): void {
  const unknown = Object.keys(object).filter((key) => !allowed.includes(key));
  if (unknown.length > 0) throw new Error(`Unknown ${label} option: ${unknown.join(", ")}`);
}

function boundedInteger(value: unknown, fallback: number, label: string, maximum: number): number {
  if (value === undefined) return fallback;
  if (!Number.isSafeInteger(value) || (value as number) < 1 || (value as number) > maximum) {
    throw new Error(`${label} must be an integer between 1 and ${maximum}`);
  }
  return value as number;
}

export function loadConfig(cwd: string): DHashlineConfig {
  const path = resolve(cwd, "dhashline.json");
  let raw: string;
  try {
    raw = readFileSync(path, "utf8");
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return DEFAULT_CONFIG;
    throw error;
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch (error) {
    throw new Error(`Invalid dhashline.json: ${(error as Error).message}`);
  }
  const root = objectValue(parsed, "dhashline.json");
  rejectUnknown(root, ["maxFileBytes", "snapshots"], "dhashline.json");
  const snapshotInput = root.snapshots === undefined ? {} : objectValue(root.snapshots, "snapshots");
  rejectUnknown(snapshotInput, ["maxPaths", "maxVersionsPerPath", "maxTotalBytes"], "snapshots");
  const config: DHashlineConfig = {
    maxFileBytes: boundedInteger(root.maxFileBytes, DEFAULT_CONFIG.maxFileBytes, "maxFileBytes", 16 * 1024 * 1024),
    snapshots: {
      maxPaths: boundedInteger(snapshotInput.maxPaths, DEFAULT_CONFIG.snapshots.maxPaths, "snapshots.maxPaths", 1000),
      maxVersionsPerPath: boundedInteger(
        snapshotInput.maxVersionsPerPath,
        DEFAULT_CONFIG.snapshots.maxVersionsPerPath,
        "snapshots.maxVersionsPerPath",
        16,
      ),
      maxTotalBytes: boundedInteger(
        snapshotInput.maxTotalBytes,
        DEFAULT_CONFIG.snapshots.maxTotalBytes,
        "snapshots.maxTotalBytes",
        256 * 1024 * 1024,
      ),
    },
  };
  if (config.snapshots.maxTotalBytes < config.maxFileBytes) {
    throw new Error("snapshots.maxTotalBytes must be at least maxFileBytes");
  }
  return config;
}
