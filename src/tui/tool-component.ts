import { keyHint, renderDiff, type Theme } from "@earendil-works/pi-coding-agent";
import { Container, Text, type Component } from "@earendil-works/pi-tui";
import { humanizeToolCall, humanizeToolResult, type DHashlineToolKind } from "./tool-result.js";

export interface DHashlineRenderState {
  callComponent?: DHashlineToolComponent;
  result?: any;
  isError?: boolean;
}

export function renderDHashlineCall(
  kind: DHashlineToolKind,
  args: Record<string, unknown>,
  theme: Theme,
  context: any,
): Component {
  const state = ensureState(context);
  const component = getCallComponent(state, context.lastComponent);
  component.update(kind, args, state.result, context.expanded, state.isError ?? false, theme);
  return component;
}

export function renderDHashlineResult(
  kind: DHashlineToolKind,
  result: any,
  expanded: boolean,
  theme: Theme,
  context: any,
): Component {
  const state = ensureState(context);
  state.result = { ...result, isError: context.isError };
  state.isError = context.isError;
  const component = getCallComponent(state, undefined);
  component.update(kind, context.args, state.result, expanded, context.isError, theme);
  const resultSlot = context.lastComponent instanceof Container ? context.lastComponent : new Container();
  resultSlot.clear();
  return resultSlot;
}

class DHashlineToolComponent extends Container {
  update(
    kind: DHashlineToolKind,
    args: Record<string, unknown>,
    result: any | undefined,
    expanded: boolean,
    isError: boolean,
    theme: Theme,
  ): void {
    this.clear();
    if (!result) {
      this.addChild(new Text(stylePending(humanizeToolCall(kind, args), theme), 0, 0));
      return;
    }
    const projection = humanizeToolResult(kind, result, expanded, args, expandHint());
    if (kind === "edit" && expanded && typeof result?.details?.diff === "string") {
      this.addEditProjection(projection, result.details.diff, editPath(args), isError, theme);
      return;
    }
    this.addChild(new Text(styleProjection(projection, isError, theme), 0, 0));
  }

  private addEditProjection(projection: string, diff: string, filePath: string | undefined, isError: boolean, theme: Theme): void {
    const marker = "\ndiff：\n";
    const start = projection.indexOf(marker);
    if (start < 0) {
      this.addChild(new Text(styleProjection(projection, isError, theme), 0, 0));
      return;
    }
    const diffStart = start + marker.length;
    const diffEnd = projection.indexOf("\n\n下一步：", diffStart);
    const end = diffEnd < 0 ? projection.length : diffEnd;
    const before = `${projection.slice(0, start)}\n\ndiff：`;
    const after = projection.slice(end).replace(/^\n+/, "");
    this.addChild(new Text(styleProjection(before, isError, theme), 0, 0));
    this.addChild(new Text(nativeDiff(diff, filePath, theme), 0, 0));
    if (after) this.addChild(new Text(styleProjection(after, isError, theme, false), 0, 0));
  }
}

function ensureState(context: any): DHashlineRenderState {
  if (!context.state || typeof context.state !== "object") context.state = {};
  return context.state as DHashlineRenderState;
}

function getCallComponent(state: DHashlineRenderState, lastComponent: Component | undefined): DHashlineToolComponent {
  if (lastComponent instanceof DHashlineToolComponent) {
    state.callComponent = lastComponent;
    return lastComponent;
  }
  if (state.callComponent) return state.callComponent;
  const component = new DHashlineToolComponent();
  state.callComponent = component;
  return component;
}

function stylePending(value: string, theme: Theme): string {
  const [verb, ...rest] = value.split(" ");
  const title = theme.fg("toolTitle", theme.bold(verb || "tool"));
  return rest.length > 0 ? `${title} ${theme.fg("accent", rest.join(" "))}` : title;
}

function styleProjection(value: string, isError: boolean, theme: Theme, styleFirst = true): string {
  return value
    .split("\n")
    .map((line, index) => {
      if (index === 0 && styleFirst) {
        const marker = isError ? theme.fg("error", "✗") : theme.fg("success", "✓");
        return `${marker} ${theme.fg(isError ? "error" : "toolTitle", theme.bold(line))}`;
      }
      if (line === "动作：" || line === "可编辑示例：" || line === "本次协议（仅供审计，不要重复执行）：" || line === "diff：") {
        return theme.fg("accent", theme.bold(line));
      }
      if (line.startsWith("请求锚点：")) return theme.fg("accent", line);
      if (line.startsWith("恢复告警：")) return theme.fg("warning", line);
      if (line.startsWith("下一步：") || line.startsWith("处理建议：") || line.startsWith("输出已截断：")) {
        return theme.fg("dim", line);
      }
      if (/^(SWAP|DEL|INS\.)/.test(line) || line.startsWith("+")) return theme.fg("mdCode", line);
      if (line.endsWith(" · 匹配")) return theme.fg("accent", line);
      return line.length > 0 ? theme.fg("toolOutput", line) : "";
    })
    .join("\n");
}

function expandHint(): string {
  try {
    return keyHint("app.tools.expand", "展开");
  } catch {
    return "Ctrl+O 展开";
  }
}

function nativeDiff(diff: string, filePath: string | undefined, theme: Theme): string {
  const safeDiff = diff.replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F-\u009F]/g, "�");
  try {
    return renderDiff(safeDiff, filePath ? { filePath } : {});
  } catch {
    return safeDiff
      .split("\n")
      .map((line) => {
        if (line.startsWith("+")) return theme.fg("toolDiffAdded", line);
        if (line.startsWith("-")) return theme.fg("toolDiffRemoved", line);
        return theme.fg("toolDiffContext", line);
      })
      .join("\n");
  }
}

function editPath(args: Record<string, unknown>): string | undefined {
  if (typeof args.input !== "string") return undefined;
  return /^\[(.+)#[0-9A-Fa-f]{8}\]/.exec(args.input)?.[1];
}
