import { isUtf8 } from "node:buffer";
import { createHash } from "node:crypto";
import { stat } from "node:fs/promises";
import { gunzipSync, gzipSync } from "node:zlib";
import {
  createGrepToolDefinition,
  createReadToolDefinition,
  generateDiffString,
  generateUnifiedPatch,
  truncateHead,
  truncateLine,
  withFileMutationQueue,
  type EditToolDetails,
  type ExtensionAPI,
  type ExtensionContext,
  type GrepToolDetails,
  type ReadToolDetails,
} from "@earendil-works/pi-coding-agent";
import { type Static, Type } from "typebox";
import { loadConfig, type DHashlineConfig } from "./config.js";
import { atomicWriteText, displayPath, readTextFile, resolveInputPath } from "./files.js";
import { computeFileTag, formatFileHeader, formatNumberedLines, getVisibleLines } from "./hash.js";
import { parsePatch, preparePatch } from "./protocol.js";
import { SnapshotStore } from "./snapshots.js";
import { renderDHashlineCall, renderDHashlineResult } from "./tui/tool-component.js";

const readSchema = Type.Object({
  path: Type.String({ description: "File path, relative to the current working directory or absolute" }),
  offset: Type.Optional(Type.Number({ description: "1-based line to start from" })),
  limit: Type.Optional(Type.Number({ description: "Maximum number of lines to return" })),
});

const editSchema = Type.Object({
  input: Type.String({
    description: "One [PATH#8_HEX_TAG] section. Grammar: SWAP N: or SWAP N.=M: plus +body; DEL N or DEL N.=M; INS.PRE N:, INS.POST N:, INS.HEAD:, or INS.TAIL: plus +body.",
  }),
});

type ReadInput = Static<typeof readSchema>;
type EditInput = Static<typeof editSchema>;

const SNAPSHOT_ENTRY = "pi-dhashline:snapshot-v1";
const SEEN_ENTRY = "pi-dhashline:seen-v1";
const CLEAR_ENTRY = "pi-dhashline:clear-v1";

interface RuntimeState {
  readonly store: SnapshotStore;
  readonly config: DHashlineConfig;
  readonly persisted: Set<string>;
}

const states = new WeakMap<object, Map<string, RuntimeState>>();

function stateFor(ctx: Pick<ExtensionContext, "sessionManager" | "cwd">): RuntimeState {
  const key = ctx.sessionManager as object;
  let byCwd = states.get(key);
  if (!byCwd) {
    byCwd = new Map<string, RuntimeState>();
    states.set(key, byCwd);
  }
  let state = byCwd.get(ctx.cwd);
  if (!state) {
    const config = loadConfig(ctx.cwd);
    state = { store: new SnapshotStore(config.snapshots), config, persisted: new Set<string>() };
    byCwd.set(ctx.cwd, state);
  }
  return state;
}

function storeFor(ctx: Pick<ExtensionContext, "sessionManager" | "cwd">): SnapshotStore {
  return stateFor(ctx).store;
}

export function getSnapshotStats(ctx: Pick<ExtensionContext, "sessionManager" | "cwd">): ReturnType<SnapshotStore["stats"]> {
  return storeFor(ctx).stats();
}

export function getDHashlineConfig(ctx: Pick<ExtensionContext, "sessionManager" | "cwd">): DHashlineConfig {
  return stateFor(ctx).config;
}

export function clearSnapshots(pi: ExtensionAPI, ctx: Pick<ExtensionContext, "sessionManager" | "cwd">): void {
  const state = stateFor(ctx);
  state.store.clear();
  state.persisted.clear();
  pi.appendEntry(CLEAR_ENTRY, { cwd: ctx.cwd });
}

function stripLeadingAt(path: string): string {
  return path.startsWith("@") ? path.slice(1) : path;
}

function assertNotAborted(signal: AbortSignal | undefined): void {
  if (signal?.aborted) throw new Error("Operation aborted");
}

function snapshotIdentity(path: string, text: string): string {
  return `${path}\0${createHash("sha256").update(text, "utf8").digest("hex")}`;
}

function persistSnapshot(pi: ExtensionAPI, ctx: ExtensionContext, path: string, text: string): string {
  const state = stateFor(ctx);
  const tag = state.store.record(path, text);
  const identity = snapshotIdentity(path, text);
  if (!state.persisted.has(identity)) {
    pi.appendEntry(SNAPSHOT_ENTRY, {
      cwd: ctx.cwd,
      path,
      tag,
      payload: gzipSync(Buffer.from(text, "utf8")).toString("base64"),
    });
    state.persisted.add(identity);
  }
  return tag;
}

function persistSeen(pi: ExtensionAPI, ctx: ExtensionContext, path: string, tag: string, lines: Iterable<number>): void {
  const values = [...lines].filter((line) => Number.isSafeInteger(line) && line > 0);
  if (values.length === 0) return;
  storeFor(ctx).recordSeenLines(path, tag, values);
  pi.appendEntry(SEEN_ENTRY, { cwd: ctx.cwd, path, tag, lines: values });
}

function entryData(value: unknown): Record<string, unknown> | null {
  return value !== null && typeof value === "object" && !Array.isArray(value) ? (value as Record<string, unknown>) : null;
}

function restoreSnapshotEntry(state: RuntimeState, data: Record<string, unknown>): void {
  if (typeof data.path !== "string" || typeof data.tag !== "string" || typeof data.payload !== "string") return;
  try {
    const bytes = gunzipSync(Buffer.from(data.payload, "base64"), { maxOutputLength: state.config.maxFileBytes });
    if (!isUtf8(bytes)) return;
    const text = bytes.toString("utf8");
    if (computeFileTag(text) !== data.tag) return;
    state.store.record(data.path, text);
    state.persisted.add(snapshotIdentity(data.path, text));
  } catch {
    // Corrupt or oversized persisted state is ignored, so its tags fail closed.
  }
}

export function restoreSessionSnapshots(ctx: ExtensionContext): void {
  const state = stateFor(ctx);
  state.store.clear();
  state.persisted.clear();
  for (const entry of ctx.sessionManager.getBranch()) {
    if (entry.type !== "custom") continue;
    const data = entryData(entry.data);
    if (!data || data.cwd !== ctx.cwd) continue;
    if (entry.customType === CLEAR_ENTRY) {
      state.store.clear();
      state.persisted.clear();
    } else if (entry.customType === SNAPSHOT_ENTRY) {
      restoreSnapshotEntry(state, data);
    } else if (
      entry.customType === SEEN_ENTRY &&
      typeof data.path === "string" &&
      typeof data.tag === "string" &&
      Array.isArray(data.lines)
    ) {
      state.store.recordSeenLines(data.path, data.tag, data.lines.filter((line): line is number => typeof line === "number"));
    }
  }
}

function isImagePath(path: string): boolean {
  return /\.(?:jpe?g|png|gif|webp|bmp)$/i.test(path);
}

function validateReadInput(params: ReadInput): { offset: number; limit: number | undefined } {
  const offset = params.offset ?? 1;
  if (!Number.isSafeInteger(offset) || offset < 1) throw new Error("read offset must be a positive integer");
  if (params.limit !== undefined && (!Number.isSafeInteger(params.limit) || params.limit < 1)) {
    throw new Error("read limit must be a positive integer");
  }
  return { offset, limit: params.limit };
}

async function executeTextRead(pi: ExtensionAPI, params: ReadInput, ctx: ExtensionContext): Promise<{ content: Array<{ type: "text"; text: string }>; details: ReadToolDetails | undefined }> {
  const { offset, limit } = validateReadInput(params);
  const requested = resolveInputPath(ctx.cwd, stripLeadingAt(params.path));
  const file = await readTextFile(requested, stateFor(ctx).config.maxFileBytes);
  const lines = getVisibleLines(file.normalizedText);
  if (lines.length > 0 && offset > lines.length) throw new Error(`Offset ${offset} exceeds ${lines.length} file lines`);
  const selected = lines.slice(offset - 1, limit === undefined ? undefined : offset - 1 + limit);
  const shownPath = displayPath(ctx.cwd, requested);
  const tag = persistSnapshot(pi, ctx, file.targetPath, file.normalizedText);
  const header = formatFileHeader(shownPath, tag);
  const body = formatNumberedLines(selected, offset);
  const truncation = truncateHead(body ? `${header}\n${body}` : header);
  const seen = new Set<number>();
  for (const line of truncation.content.split("\n").slice(1)) {
    const match = /^(\d+):/.exec(line);
    if (match) seen.add(Number(match[1]));
  }
  persistSeen(pi, ctx, file.targetPath, tag, seen);
  return {
    content: [{ type: "text", text: truncation.content }],
    details: truncation.truncated ? { truncation } : undefined,
  };
}

function registerRead(pi: ExtensionAPI): void {
  pi.registerTool({
    name: "read",
    label: "read",
    renderShell: "default",
    description: "Read a text file with a file-level DHashline tag and 1-based line anchors. Images remain supported through Pi's native reader.",
    promptSnippet: "Read files as [PATH#TAG] plus LINE:TEXT anchors",
    promptGuidelines: [
      "Use read before edit so the edit input carries the current [PATH#TAG] header and shown line numbers.",
      "Continue read with offset/limit when the needed edit anchors were not shown.",
    ],
    parameters: readSchema,
    async execute(toolCallId, params, signal, onUpdate, ctx) {
      assertNotAborted(signal);
      const normalized = { ...params, path: stripLeadingAt(params.path) };
      if (isImagePath(normalized.path)) {
        return createReadToolDefinition(ctx.cwd).execute(toolCallId, normalized, signal, onUpdate, ctx);
      }
      return executeTextRead(pi, normalized, ctx);
    },
    renderCall(args, theme, context) {
      if (isImagePath(args.path)) {
        return createReadToolDefinition(context.cwd).renderCall!(args, theme, context as any);
      }
      return renderDHashlineCall("read", args, theme, context);
    },
    renderResult(result, options, theme, context) {
      if (isImagePath(context.args.path)) {
        return createReadToolDefinition(context.cwd).renderResult!(result as any, options, theme, context as any);
      }
      return renderDHashlineResult("read", result, options.expanded, theme, context);
    },
  });
}

async function executeEdit(pi: ExtensionAPI, params: EditInput, signal: AbortSignal | undefined, ctx: ExtensionContext) {
  assertNotAborted(signal);
  const parsed = parsePatch(params.input);
  const requested = resolveInputPath(ctx.cwd, stripLeadingAt(parsed.path));
  return withFileMutationQueue(requested, async () => {
    assertNotAborted(signal);
    const file = await readTextFile(requested, stateFor(ctx).config.maxFileBytes);
    const prepared = preparePatch(parsed, file.targetPath, file.normalizedText, storeFor(ctx));
    const shownPath = displayPath(ctx.cwd, requested);
    const generated = generateDiffString(file.normalizedText, prepared.text);
    const details: EditToolDetails = {
      diff: generated.diff,
      patch: generateUnifiedPatch(shownPath, file.normalizedText, prepared.text),
      ...(generated.firstChangedLine === undefined ? {} : { firstChangedLine: generated.firstChangedLine }),
    };
    await atomicWriteText(file, prepared.text);
    const freshTag = persistSnapshot(pi, ctx, file.targetPath, prepared.text);
    const warning = prepared.warning ? `\nWarning: ${prepared.warning}` : "";
    return {
      content: [{ type: "text" as const, text: `Updated ${shownPath}\n${formatFileHeader(shownPath, freshTag)}${warning}\nRead or search the fresh tag before another edit.` }],
      details,
    };
  });
}

function registerEdit(pi: ExtensionAPI): void {
  pi.registerTool({
    name: "edit",
    label: "edit",
    renderShell: "default",
    description: "Atomically edit one tagged text file. Exact grammar: SWAP N: or SWAP N.=M: followed by +body lines; DEL N or DEL N.=M; INS.PRE N:, INS.POST N:, INS.HEAD:, or INS.TAIL: followed by +body lines. Rejects unknown, ambiguous, overlapping, unseen, or changed anchors.",
    promptSnippet: "Edit one [PATH#TAG] section with compact line operations",
    promptGuidelines: [
      "Use edit with exactly one [PATH#TAG] section copied from read or search.",
      "Use exactly: SWAP N: or SWAP N.=M: followed by +body lines; DEL N or DEL N.=M; INS.PRE N: or INS.POST N: followed by +body lines; INS.HEAD: or INS.TAIL: followed by +body lines.",
      "Treat read and search output as authoritative. If requested source text is absent or the target state is already satisfied, do not force or replay the edit; report the mismatch or omit the satisfied operation.",
      "Treat a stale or unseen-line edit error as a request to read the relevant lines again; do not guess anchors.",
    ],
    parameters: editSchema,
    execute(_toolCallId, params, signal, _onUpdate, ctx) {
      return executeEdit(pi, params, signal, ctx);
    },
    renderCall(args, theme, context) {
      return renderDHashlineCall("edit", args, theme, context);
    },
    renderResult(result, options, theme, context) {
      return renderDHashlineResult("edit", result, options.expanded, theme, context);
    },
  });
}

interface GrepRow {
  readonly sourcePath: string;
  readonly line: number;
  readonly match: boolean;
}

function parseGrepRows(text: string): GrepRow[] {
  const rows: GrepRow[] = [];
  for (const line of text.split("\n")) {
    const match = /^(.*?):(\d+): (.*)$/.exec(line);
    if (match) {
      rows.push({ sourcePath: match[1]!, line: Number(match[2]), match: true });
      continue;
    }
    const context = /^(.*?)-(\d+)- (.*)$/.exec(line);
    if (context) rows.push({ sourcePath: context[1]!, line: Number(context[2]), match: false });
  }
  return rows;
}

interface SearchGroup {
  readonly file: Awaited<ReturnType<typeof readTextFile>>;
  readonly shownPath: string;
  readonly tag: string;
  readonly rows: Map<number, boolean>;
}

async function groupSearchRows(pi: ExtensionAPI, rows: GrepRow[], searchRoot: string, isDirectory: boolean, ctx: ExtensionContext): Promise<SearchGroup[]> {
  const groups = new Map<string, SearchGroup>();
  for (const row of rows) {
    const requested = isDirectory ? resolveInputPath(searchRoot, row.sourcePath) : searchRoot;
    let group = groups.get(requested);
    if (!group) {
      const file = await readTextFile(requested, stateFor(ctx).config.maxFileBytes);
      group = {
        file,
        shownPath: displayPath(ctx.cwd, requested),
        tag: persistSnapshot(pi, ctx, file.targetPath, file.normalizedText),
        rows: new Map<number, boolean>(),
      };
      groups.set(requested, group);
    }
    group.rows.set(row.line, row.match || group.rows.get(row.line) === true);
  }
  return [...groups.values()];
}

function renderSearchGroups(groups: SearchGroup[]): { text: string; safe: Map<string, Set<number>> } {
  const sections: string[] = [];
  const safe = new Map<string, Set<number>>();
  for (const group of groups) {
    const header = formatFileHeader(group.shownPath, group.tag);
    const lines = getVisibleLines(group.file.normalizedText);
    const rendered = [header];
    const safeLines = new Set<number>();
    for (const [lineNumber, isMatch] of [...group.rows].sort((left, right) => left[0] - right[0])) {
      const source = lines[lineNumber - 1];
      if (source === undefined) continue;
      const clipped = truncateLine(source);
      rendered.push(`${isMatch ? "*" : " "}${lineNumber}:${clipped.text}`);
      if (!clipped.wasTruncated) safeLines.add(lineNumber);
    }
    sections.push(rendered.join("\n"));
    safe.set(header, safeLines);
  }
  return { text: sections.join("\n\n"), safe };
}

function recordVisibleSearchLines(pi: ExtensionAPI, output: string, groups: SearchGroup[], safe: Map<string, Set<number>>, ctx: ExtensionContext): void {
  const byHeader = new Map(groups.map((group) => [formatFileHeader(group.shownPath, group.tag), group]));
  let activeHeader: string | undefined;
  const visible = new Map<string, Set<number>>();
  for (const line of output.split("\n")) {
    if (byHeader.has(line)) {
      activeHeader = line;
      visible.set(line, new Set<number>());
      continue;
    }
    const match = /^[* ](\d+):/.exec(line);
    if (activeHeader && match && safe.get(activeHeader)?.has(Number(match[1]))) visible.get(activeHeader)?.add(Number(match[1]));
  }
  for (const [header, lines] of visible) {
    const group = byHeader.get(header)!;
    persistSeen(pi, ctx, group.file.targetPath, group.tag, lines);
  }
}

async function executeSearch(pi: ExtensionAPI, native: ReturnType<typeof createGrepToolDefinition>, toolCallId: string, params: Static<typeof native.parameters>, signal: AbortSignal | undefined, onUpdate: Parameters<typeof native.execute>[3], ctx: ExtensionContext) {
  assertNotAborted(signal);
  const normalized = { ...params, ...(params.path === undefined ? {} : { path: stripLeadingAt(params.path) }) };
  const result = await native.execute(toolCallId, normalized, signal, onUpdate, ctx);
  const text = result.content.find((item) => item.type === "text")?.text ?? "";
  const rows = parseGrepRows(text);
  if (rows.length === 0) return result;
  const searchRoot = resolveInputPath(ctx.cwd, normalized.path ?? ".");
  const isDirectory = (await stat(searchRoot)).isDirectory();
  const groups = await groupSearchRows(pi, rows, searchRoot, isDirectory, ctx);
  const rendered = renderSearchGroups(groups);
  const notice = /\n\n(\[[^\n]+\])$/.exec(text)?.[1];
  const truncation = truncateHead(`${rendered.text}${notice ? `\n\n${notice}` : ""}`);
  recordVisibleSearchLines(pi, truncation.content, groups, rendered.safe, ctx);
  const nativeDetails = result.details as GrepToolDetails | undefined;
  const details: GrepToolDetails | undefined = truncation.truncated
    ? { ...nativeDetails, truncation }
    : nativeDetails;
  return { content: [{ type: "text" as const, text: truncation.content }], details };
}

function registerSearch(pi: ExtensionAPI): void {
  const schemaSource = createGrepToolDefinition(".");
  pi.registerTool({
    name: "search",
    label: "search",
    renderShell: "default",
    description: "Search file contents with Pi's native grep engine, then return file-tagged match and context anchors. Match rows start with * and context rows with a space.",
    promptSnippet: "Search contents and return editable [PATH#TAG] line anchors",
    promptGuidelines: [
      "Use search instead of grep when search results may become edit anchors.",
      "Use read for any search row marked as truncated before editing that line.",
    ],
    parameters: schemaSource.parameters,
    execute(toolCallId, params, signal, onUpdate, ctx) {
      return executeSearch(pi, createGrepToolDefinition(ctx.cwd), toolCallId, params, signal, onUpdate, ctx);
    },
    renderCall(args, theme, context) {
      return renderDHashlineCall("search", args, theme, context);
    },
    renderResult(result, options, theme, context) {
      return renderDHashlineResult("search", result, options.expanded, theme, context);
    }
  });
}

export function registerDHashlineTools(pi: ExtensionAPI): void {
  registerRead(pi);
  registerEdit(pi);
  registerSearch(pi);
}
