import { computeFileTag, getVisibleLines } from "./hash.js";
import type { SnapshotStore } from "./snapshots.js";

export type PatchOperation =
  | { kind: "swap"; start: number; end: number; lines: string[]; sourceLine: number }
  | { kind: "delete"; start: number; end: number; sourceLine: number }
  | { kind: "insert"; where: "pre" | "post"; anchor: number; lines: string[]; sourceLine: number }
  | { kind: "insert"; where: "head" | "tail"; lines: string[]; sourceLine: number };

export interface PatchSection {
  readonly path: string;
  readonly tag: string;
  readonly operations: PatchOperation[];
}

export interface PreparedPatch {
  readonly text: string;
  readonly operations: PatchOperation[];
  readonly recovered: boolean;
  readonly warning?: string;
}

function parseRange(rawStart: string, rawEnd: string | undefined, sourceLine: number): [number, number] {
  const start = Number(rawStart);
  const end = rawEnd === undefined ? start : Number(rawEnd);
  if (!Number.isSafeInteger(start) || !Number.isSafeInteger(end) || start < 1 || end < start) {
    throw new Error(`Invalid line range at patch line ${sourceLine}`);
  }
  return [start, end];
}

function readBody(lines: string[], startIndex: number, operation: string): { body: string[]; next: number } {
  const body: string[] = [];
  let index = startIndex;
  while (index < lines.length && lines[index]!.startsWith("+")) {
    body.push(lines[index]!.slice(1));
    index++;
  }
  if (body.length === 0) throw new Error(`${operation} at patch line ${startIndex} requires one or more +body lines`);
  return { body, next: index };
}

function syntaxExpectation(line: string): string {
  if (line.startsWith("SWAP")) return "Expected SWAP N: or SWAP N.=M: followed by +body lines.";
  if (line.startsWith("DEL")) return "Expected DEL N or DEL N.=M with no colon or body.";
  if (line.startsWith("INS.PRE")) return "Expected INS.PRE N: followed by +body lines.";
  if (line.startsWith("INS.POST")) return "Expected INS.POST N: followed by +body lines.";
  if (line.startsWith("INS.HEAD")) return "Expected INS.HEAD: followed by +body lines.";
  if (line.startsWith("INS.TAIL")) return "Expected INS.TAIL: followed by +body lines.";
  return "Expected one of SWAP N:, SWAP N.=M:, DEL N, DEL N.=M, INS.PRE N:, INS.POST N:, INS.HEAD:, or INS.TAIL:.";
}

function parseOperation(lines: string[], index: number): { operation: PatchOperation; next: number } {
  const sourceLine = index + 1;
  const line = lines[index]!;
  const swap = /^SWAP (\d+)(?:\.=(\d+))?:$/.exec(line);
  if (swap) {
    const [start, end] = parseRange(swap[1]!, swap[2], sourceLine);
    const { body, next } = readBody(lines, index + 1, "SWAP");
    return { operation: { kind: "swap", start, end, lines: body, sourceLine }, next };
  }
  const deletion = /^DEL (\d+)(?:\.=(\d+))?$/.exec(line);
  if (deletion) {
    const [start, end] = parseRange(deletion[1]!, deletion[2], sourceLine);
    return { operation: { kind: "delete", start, end, sourceLine }, next: index + 1 };
  }
  const anchored = /^INS\.(PRE|POST) (\d+):$/.exec(line);
  if (anchored) {
    const anchor = Number(anchored[2]);
    const { body, next } = readBody(lines, index + 1, `INS.${anchored[1]}`);
    return {
      operation: { kind: "insert", where: anchored[1]!.toLowerCase() as "pre" | "post", anchor, lines: body, sourceLine },
      next,
    };
  }
  const edge = /^INS\.(HEAD|TAIL):$/.exec(line);
  if (edge) {
    const { body, next } = readBody(lines, index + 1, `INS.${edge[1]}`);
    return {
      operation: { kind: "insert", where: edge[1]!.toLowerCase() as "head" | "tail", lines: body, sourceLine },
      next,
    };
  }
  throw new Error(`Unknown patch syntax at line ${sourceLine}: ${line}. ${syntaxExpectation(line)}`);
}

export function parsePatch(input: string): PatchSection {
  const lines = input.replaceAll("\r\n", "\n").replaceAll("\r", "\n").split("\n");
  while (lines[0] === "") lines.shift();
  while (lines.at(-1) === "") lines.pop();
  const header = lines.shift();
  const match = header ? /^\[(.+)#([0-9A-Fa-f]{8})\]$/.exec(header) : null;
  if (!match) throw new Error("Patch must start with [PATH#8_HEX_TAG]");
  const operations: PatchOperation[] = [];
  let index = 0;
  while (index < lines.length) {
    if (lines[index] === "") {
      index++;
      continue;
    }
    if (/^\[.+#[0-9A-Fa-f]{8}\]$/.test(lines[index]!)) {
      throw new Error("The initial DHashline protocol accepts exactly one file section per edit call");
    }
    const parsed = parseOperation(lines, index);
    operations.push(parsed.operation);
    index = parsed.next;
  }
  if (operations.length === 0) throw new Error("Patch contains no operations");
  return { path: match[1]!, tag: match[2]!.toUpperCase(), operations };
}

function anchoredRange(operation: PatchOperation): [number, number] | null {
  if (operation.kind === "swap" || operation.kind === "delete") return [operation.start, operation.end];
  if (operation.where === "pre" || operation.where === "post") return [operation.anchor, operation.anchor];
  return null;
}

export function requiredSeenLines(operations: readonly PatchOperation[]): Set<number> {
  const required = new Set<number>();
  for (const operation of operations) {
    const range = anchoredRange(operation);
    if (!range) continue;
    for (let line = range[0]; line <= range[1]; line++) required.add(line);
  }
  return required;
}

function operationBoundary(operation: PatchOperation, lineCount: number): number {
  if (operation.kind === "swap" || operation.kind === "delete") return operation.start - 1;
  switch (operation.where) {
    case "head":
      return 0;
    case "tail":
      return lineCount;
    case "pre":
      return operation.anchor - 1;
    case "post":
      return operation.anchor;
  }
}

export function validateOperations(
  operations: readonly PatchOperation[],
  lineCount: number,
  seenLines?: ReadonlySet<number>,
): void {
  const consumed: Array<[number, number, number]> = [];
  const boundaries = new Map<number, number>();
  for (const operation of operations) {
    const range = anchoredRange(operation);
    if (range && range[1] > lineCount) throw new Error(`Operation at patch line ${operation.sourceLine} exceeds ${lineCount} file lines`);
    if (range && seenLines) {
      for (let line = range[0]; line <= range[1]; line++) {
        if (!seenLines.has(line)) throw new Error(`Line ${line} was not shown by read or search for this tag; read it before editing`);
      }
    }
    if (operation.kind === "swap" || operation.kind === "delete") consumed.push([operation.start, operation.end, operation.sourceLine]);
    else {
      if ((operation.where === "pre" || operation.where === "post") && operation.anchor > lineCount) {
        throw new Error(`Insertion anchor ${operation.anchor} exceeds ${lineCount} file lines`);
      }
      const boundary = operationBoundary(operation, lineCount);
      const previous = boundaries.get(boundary);
      if (previous !== undefined) throw new Error(`Insertions at patch lines ${previous} and ${operation.sourceLine} target the same boundary`);
      boundaries.set(boundary, operation.sourceLine);
    }
  }
  consumed.sort((left, right) => left[0] - right[0]);
  for (let index = 1; index < consumed.length; index++) {
    if (consumed[index]![0] <= consumed[index - 1]![1]) {
      throw new Error(`Operations at patch lines ${consumed[index - 1]![2]} and ${consumed[index]![2]} overlap`);
    }
  }
  for (const [boundary, sourceLine] of boundaries) {
    const conflict = consumed.find(([start, end]) => boundary >= start - 1 && boundary <= end);
    if (conflict) throw new Error(`Insertion at patch line ${sourceLine} conflicts with operation at patch line ${conflict[2]}`);
  }
}

function remapOperation(operation: PatchOperation, offset: number): PatchOperation {
  if (operation.kind === "swap") return { ...operation, start: operation.start + offset, end: operation.end + offset };
  if (operation.kind === "delete") return { ...operation, start: operation.start + offset, end: operation.end + offset };
  if (operation.where === "pre" || operation.where === "post") return { ...operation, anchor: operation.anchor + offset };
  return operation;
}

function candidateOffsets(snapshotLines: string[], currentLines: string[], start: number, end: number): number[] {
  const source = snapshotLines.slice(start - 1, end);
  const candidates: number[] = [];
  for (let currentStart = 0; currentStart + source.length <= currentLines.length; currentStart++) {
    if (!source.every((line, index) => line === currentLines[currentStart + index])) continue;
    const beforeMatches = start === 1 || (currentStart > 0 && snapshotLines[start - 2] === currentLines[currentStart - 1]);
    const afterMatches = end === snapshotLines.length || snapshotLines[end] === currentLines[currentStart + source.length];
    if (beforeMatches && afterMatches) candidates.push(currentStart - (start - 1));
  }
  return candidates;
}

export function recoverOperations(snapshotText: string, currentText: string, operations: readonly PatchOperation[]): PatchOperation[] | null {
  const snapshotLines = getVisibleLines(snapshotText);
  const currentLines = getVisibleLines(currentText);
  if (!operations.some((operation) => anchoredRange(operation) !== null)) return null;
  let sharedOffset: number | undefined;
  for (const operation of operations) {
    const range = anchoredRange(operation);
    if (!range) continue;
    const offsets = candidateOffsets(snapshotLines, currentLines, range[0], range[1]);
    if (offsets.length !== 1) return null;
    if (sharedOffset !== undefined && sharedOffset !== offsets[0]) return null;
    sharedOffset = offsets[0];
  }
  const recovered = operations.map((operation) => remapOperation(operation, sharedOffset ?? 0));
  try {
    validateOperations(recovered, currentLines.length);
    return recovered;
  } catch {
    return null;
  }
}

function assertNoSatisfiedOperations(lines: readonly string[], operations: readonly PatchOperation[]): void {
  for (const operation of operations) {
    if (operation.kind !== "swap") continue;
    const current = lines.slice(operation.start - 1, operation.end);
    if (current.length === operation.lines.length && current.every((line, index) => line === operation.lines[index])) {
      throw new Error(
        `SWAP at patch line ${operation.sourceLine} already matches the requested content; omit already satisfied operations and trust the latest read or search output`,
      );
    }
  }
}

export function applyOperations(text: string, operations: readonly PatchOperation[]): string {
  const hadFinalNewline = text.endsWith("\n");
  const lines = getVisibleLines(text);
  validateOperations(operations, lines.length);
  assertNoSatisfiedOperations(lines, operations);
  const ordered = [...operations].sort((left, right) => operationBoundary(right, lines.length) - operationBoundary(left, lines.length));
  for (const operation of ordered) {
    if (operation.kind === "swap") lines.splice(operation.start - 1, operation.end - operation.start + 1, ...operation.lines);
    else if (operation.kind === "delete") lines.splice(operation.start - 1, operation.end - operation.start + 1);
    else lines.splice(operationBoundary(operation, lines.length), 0, ...operation.lines);
  }
  const next = lines.length === 0 ? "" : `${lines.join("\n")}${hadFinalNewline ? "\n" : ""}`;
  if (next === text) throw new Error("Patch produced no changes; re-read before repeating a no-op edit");
  return next;
}

export function preparePatch(
  section: PatchSection,
  canonicalPath: string,
  currentText: string,
  snapshots: SnapshotStore,
): PreparedPatch {
  const liveTag = computeFileTag(currentText);
  const expectedSnapshot = snapshots.byTag(canonicalPath, section.tag);
  if (liveTag === section.tag) {
    if (!expectedSnapshot) throw new Error(`DHashline tag ${section.tag} is not from this session; re-read ${section.path}`);
    if (expectedSnapshot.text !== currentText) {
      throw new Error(`DHashline tag collision detected for ${section.path}; re-read before editing`);
    }
    validateOperations(section.operations, getVisibleLines(currentText).length, expectedSnapshot.seenLines);
    return { text: applyOperations(currentText, section.operations), operations: section.operations, recovered: false };
  }
  if (!expectedSnapshot) {
    const reason = snapshots.hasTag(canonicalPath, section.tag) ? "tag collision is ambiguous" : "tag is not from this session";
    throw new Error(`Stale DHashline tag ${section.tag}: ${reason}; re-read ${section.path}`);
  }
  validateOperations(section.operations, getVisibleLines(expectedSnapshot.text).length, expectedSnapshot.seenLines);
  const recovered = recoverOperations(expectedSnapshot.text, currentText, section.operations);
  if (!recovered) throw new Error(`File changed at or around the requested anchors; re-read ${section.path}`);
  return {
    text: applyOperations(currentText, recovered),
    operations: recovered,
    recovered: true,
    warning: "Recovered a stale tag by a unique, content-preserving line offset.",
  };
}
