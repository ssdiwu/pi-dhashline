export type DHashlineToolKind = "read" | "edit" | "search" | "write";

type ToolArgs = Record<string, unknown>;

interface AnchorLine {
  readonly number: number;
  readonly text: string;
  readonly match: boolean;
}

interface AnchorSection {
  readonly path: string;
  readonly tag: string;
  readonly lines: AnchorLine[];
}

interface EditAction {
  readonly kind: "replace" | "delete" | "insert";
  readonly label: string;
  readonly body: string[];
}

export function humanizeToolCall(kind: DHashlineToolKind, args: ToolArgs): string {
  if (kind === "read") {
    const path = text(args.path) || "未知文件";
    const offset = integer(args.offset);
    const limit = integer(args.limit);
    return offset === undefined && limit === undefined
      ? `read ${path}`
      : `read ${path} · ${offset ?? 1}${limit === undefined ? " 起" : `–${(offset ?? 1) + limit - 1} 行`}`;
  }
  if (kind === "search") {
    return `search ${quote(text(args.pattern) || "未知模式")} · ${text(args.path) || "."}`;
  }
  if (kind === "write") {
    const content = multiline(args.content);
    const lines = content.length === 0 ? 0 : content.split("\n").length - (content.endsWith("\n") ? 1 : 0);
    return `write ${text(args.path) || "未知文件"} · 创建 ${lines} 行`;
  }
  const patch = parseEditInput(multiline(args.input));
  const summary = actionSummary(patch.actions);
  return `edit ${patch.path || "未知文件"}${summary ? ` · ${summary}` : ""}`;
}

export function humanizeToolResult(
  kind: DHashlineToolKind,
  result: any,
  expanded: boolean,
  args: ToolArgs = {},
  expandHint = "Ctrl+O 展开",
): string {
  if (result?.isError) return errorText(kind, result, expanded, args, expandHint);
  if (kind === "read") return readText(result, expanded, args, expandHint);
  if (kind === "search") return searchText(result, expanded, args, expandHint);
  if (kind === "write") return writeText(result, expanded, args, expandHint);
  return editText(result, expanded, args, expandHint);
}

function readText(result: any, expanded: boolean, args: ToolArgs, expandHint: string): string {
  const sections = parseAnchorSections(resultText(result));
  const section = sections[0];
  if (!section) return `read ${text(args.path) || "未知文件"} · 无可显示文本`;
  const summary = `read ${section.path} · ${section.lines.length} 行 · tag ${section.tag}`;
  if (!expanded) return withExpandHint(summary, expandHint);
  const lines = [summary, "", ...boundaryAnchorLines(section), "", ...editExamples(section.lines[0]?.number)];
  appendTruncation(lines, result?.details?.truncation);
  return lines.join("\n");
}

function searchText(result: any, expanded: boolean, args: ToolArgs, expandHint: string): string {
  const raw = resultText(result);
  const sections = parseAnchorSections(raw);
  if (sections.length === 0) return `search ${quote(text(args.pattern) || "未知模式")} · 无匹配`;
  const matches = sections.reduce((count, section) => count + section.lines.filter((line) => line.match).length, 0);
  const summary = `search ${quote(text(args.pattern) || "未知模式")} · ${sections.length} 个文件、${matches} 处匹配`;
  if (!expanded) return withExpandHint(summary, expandHint);
  const lines = [summary];
  for (const section of sections) {
    lines.push("", `${section.path} · tag ${section.tag}`, ...anchorLines(section));
  }
  const firstMatch = sections.flatMap((section) => section.lines).find((line) => line.match);
  lines.push("", ...editExamples(firstMatch?.number));
  appendTruncation(lines, result?.details?.truncation);
  return lines.join("\n");
}

function editText(result: any, expanded: boolean, args: ToolArgs, expandHint: string): string {
  const patch = parseEditInput(multiline(args.input));
  const resultSections = parseAnchorSections(resultText(result));
  const fresh = resultSections[0];
  const path = fresh?.path || patch.path || "未知文件";
  const actions = actionSummary(patch.actions);
  const tagPart = fresh ? ` · tag ${fresh.tag}` : "";
  const summary = `已更新 ${path}${actions ? ` · ${actions}` : ""}${tagPart}`;
  if (!expanded) return withExpandHint(summary, expandHint);
  const lines = [
    summary,
    "",
    ...(patch.header ? [`请求锚点：${patch.header}`, ""] : []),
    "动作：",
    ...patch.actions.map((action) => `- ${action.label}`),
  ];
  const warning = resultText(result).split("\n").find((line) => line.startsWith("Warning:"));
  if (warning) lines.push("", `恢复告警：${warning.slice("Warning:".length).trim()}`);
  const diff = result?.details?.diff;
  if (typeof diff === "string" && diff.length > 0) lines.push("", "diff：", diff);
  lines.push("", "下一步：继续编辑前必须重新 read 或 search，以建立新 tag 下的已见行。");
  return lines.join("\n");
}

function writeText(result: any, expanded: boolean, args: ToolArgs, expandHint: string): string {
  const details = result?.details as { path?: string; tag?: string; lines?: number; bytes?: number } | undefined;
  const section = parseAnchorSections(resultText(result))[0];
  const path = details?.path || section?.path || text(args.path) || "未知文件";
  const tag = details?.tag || section?.tag;
  const lineCount = details?.lines ?? 0;
  const bytes = details?.bytes ?? 0;
  const summary = `已创建 ${path} · ${lineCount} 行${tag ? ` · tag ${tag}` : ""}`;
  if (!expanded) return withExpandHint(summary, expandHint);
  return [
    summary,
    "",
    ...(tag ? [`结果锚点：[${path}#${tag}]`] : []),
    `大小：${bytes} bytes`,
    `行数：${lineCount}`,
    "写入方式：仅创建，未覆盖已有文件。",
    "",
    "下一步：继续编辑前请先 read 或 search，以建立已见行。",
  ].join("\n");
}

function errorText(kind: DHashlineToolKind, result: any, expanded: boolean, args: ToolArgs, expandHint: string): string {
  const raw = resultText(result) || `${kind} 操作失败`;
  const path = kind === "edit" ? parseEditInput(multiline(args.input)).path : text(args.path);
  const label = errorLabel(raw);
  const summary = `${kind}${path ? ` ${path}` : ""} · ${label}`;
  if (!expanded) return withExpandHint(summary, expandHint);
  const lines = [summary, "", `原因：${sanitize(raw)}`];
  const received = /Unknown patch syntax at line \d+: (.*?)(?:\. Expected|$)/i.exec(raw)?.[1];
  if (received) {
    lines.push(`收到：${sanitize(received)}`, `正确写法：${expectedSyntax(received)}`);
  } else {
    lines.push(`处理建议：${errorAdvice(raw)}`);
  }
  return lines.join("\n");
}

function parseAnchorSections(raw: string): AnchorSection[] {
  const sections: AnchorSection[] = [];
  let current: { path: string; tag: string; lines: AnchorLine[] } | undefined;
  for (const rawLine of raw.split("\n")) {
    const header = /^\[(.+)#([0-9A-Fa-f]{8})\]$/.exec(rawLine);
    if (header) {
      current = { path: header[1]!, tag: header[2]!.toUpperCase(), lines: [] };
      sections.push(current);
      continue;
    }
    if (!current) continue;
    const line = /^([* ])?(\d+):(.*)$/.exec(rawLine);
    if (line) current.lines.push({ number: Number(line[2]), text: line[3]!, match: line[1] === "*" });
  }
  return sections;
}

function parseEditInput(input: string): { path: string; header: string; actions: EditAction[] } {
  const lines = input.replaceAll("\r\n", "\n").replaceAll("\r", "\n").split("\n");
  const header = /^\[(.+)#[0-9A-Fa-f]{8}\]$/.exec(lines[0] ?? "");
  const actions: EditAction[] = [];
  for (let index = 1; index < lines.length; index++) {
    const line = lines[index]!;
    const body: string[] = [];
    let next = index + 1;
    while (next < lines.length && lines[next]!.startsWith("+")) body.push(lines[next++]!.slice(1));
    const swap = /^SWAP (\d+)(?:\.=(\d+))?:$/.exec(line);
    const deletion = /^DEL (\d+)(?:\.=(\d+))?$/.exec(line);
    const anchored = /^INS\.(PRE|POST) (\d+):$/.exec(line);
    const edge = /^INS\.(HEAD|TAIL):$/.exec(line);
    if (swap) actions.push({ kind: "replace", label: `替换${rangeText(swap[1]!, swap[2])}`, body });
    else if (deletion) actions.push({ kind: "delete", label: `删除${rangeText(deletion[1]!, deletion[2])}`, body: [] });
    else if (anchored) actions.push({ kind: "insert", label: `在第 ${anchored[2]} 行${anchored[1] === "PRE" ? "前" : "后"}插入`, body });
    else if (edge) actions.push({ kind: "insert", label: `在文件${edge[1] === "HEAD" ? "开头" : "末尾"}插入`, body });
    if (body.length > 0) index = next - 1;
  }
  return { path: header?.[1] ?? "", header: header ? inline(lines[0]!) : "", actions };
}

function actionSummary(actions: EditAction[]): string {
  const counts = actions.reduce((all, action) => ({ ...all, [action.kind]: (all[action.kind] ?? 0) + 1 }), {} as Record<EditAction["kind"], number>);
  return [
    counts.replace ? `替换 ${counts.replace} 处` : "",
    counts.delete ? `删除 ${counts.delete} 处` : "",
    counts.insert ? `插入 ${counts.insert} 处` : "",
  ].filter(Boolean).join("、");
}

function anchorLines(section: AnchorSection): string[] {
  return section.lines.map((line) => `${line.number}  ${line.text}${line.match ? " · 匹配" : ""}`);
}

function boundaryAnchorLines(section: AnchorSection): string[] {
  if (section.lines.length <= 2) return anchorLines(section);
  const first = section.lines[0]!;
  const last = section.lines.at(-1)!;
  return [
    `${first.number}  ${first.text}${first.match ? " · 匹配" : ""}`,
    `… 省略第 ${first.number + 1}–${last.number - 1} 行 …`,
    `${last.number}  ${last.text}${last.match ? " · 匹配" : ""}`,
  ];
}

function editExamples(lineNumber: number | undefined): string[] {
  if (lineNumber === undefined) return [];
  return [
    "可编辑示例：",
    `SWAP ${lineNumber}:`,
    "+新内容",
    "",
    `INS.POST ${lineNumber}:`,
    "+插入内容",
  ];
}

function expectedSyntax(received: string): string {
  const number = /\d+/.exec(received)?.[0] ?? "N";
  if (received.startsWith("INS.POST")) return `INS.POST ${number}:\n+内容`;
  if (received.startsWith("INS.PRE")) return `INS.PRE ${number}:\n+内容`;
  if (received.startsWith("INS.HEAD")) return "INS.HEAD:\n+内容";
  if (received.startsWith("INS.TAIL")) return "INS.TAIL:\n+内容";
  if (received.startsWith("SWAP")) return `SWAP ${number}: 或 SWAP ${number}.=M:\n+内容`;
  if (received.startsWith("DEL")) return `DEL ${number} 或 DEL ${number}.=M`;
  return "SWAP N: / SWAP N.=M: / DEL N / DEL N.=M / INS.PRE N: / INS.POST N: / INS.HEAD: / INS.TAIL:";
}

function errorLabel(raw: string): string {
  if (/Unknown patch syntax|Patch must start|requires one or more \+body/i.test(raw)) return "语法错误";
  if (/Target already exists|only creates new files/i.test(raw)) return "目标已存在，未写入";
  if (/already matches|already satisfied/i.test(raw)) return "操作已经满足";
  if (/not shown/i.test(raw)) return "锚点未显示";
  if (/stale|changed|collision/i.test(raw)) return "标签或锚点已失效";
  if (/hard links?/i.test(raw)) return "硬链接写入被拒绝";
  if (/UTF-8|Unicode|Binary/i.test(raw)) return "文件格式不支持";
  return "操作失败";
}

function errorAdvice(raw: string): string {
  if (/Target already exists|only creates new files/i.test(raw)) return "目标未被修改；先 read 获取当前 tag，再使用 edit。";
  if (/already matches|already satisfied/i.test(raw)) return "以最新 read/search 为准，删除已满足操作；不要为服从旧描述而重复插入内容。";
  if (/not shown/i.test(raw)) return "重新 read 或 search 目标行，再使用新返回的 tag 编辑。";
  if (/stale|changed|collision/i.test(raw)) return "重新 read 相关行，不要猜测旧锚点。";
  if (/hard links?/i.test(raw)) return "先解除硬链接关系，或使用明确理解链接语义的外部工具。";
  return "检查输入后重试；不要绕过 DHashline 的安全校验。";
}

function rangeText(start: string, end: string | undefined): string {
  return end && end !== start ? `第 ${start}–${end} 行` : `第 ${start} 行`;
}



function withExpandHint(summary: string, expandHint: string): string {
  return `${summary}（${expandHint}）`;
}

function appendTruncation(lines: string[], truncation: any): void {
  if (!truncation?.truncated) return;
  lines.push("", `输出已截断：显示 ${truncation.outputLines ?? "部分"} / ${truncation.totalLines ?? "未知"} 行。`);
}

function resultText(result: any): string {
  return sanitize(result?.content?.find?.((item: any) => item?.type === "text")?.text ?? "");
}

function quote(value: string): string {
  return `"${value.replaceAll('"', '\\"')}"`;
}

function integer(value: unknown): number | undefined {
  return Number.isSafeInteger(value) ? (value as number) : undefined;
}

function text(value: unknown): string {
  return typeof value === "string" ? inline(value) : "";
}

function multiline(value: unknown): string {
  return typeof value === "string" ? sanitize(value) : "";
}

function inline(value: string): string {
  return sanitize(value).replace(/[\r\n]+/g, " ").trim();
}

function sanitize(value: string): string {
  return value.replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F-\u009F]/g, "�");
}
