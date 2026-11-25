# pi-dhashline

English | [中文](./README-zh.md)

A zero-runtime-dependency Pi extension (扩展) that replaces the built-in `read` / `edit` with file-level content tags, takes over `write` with create-only (仅创建) semantics, and adds `search`, which outputs the same kind of anchors.

## Initial capabilities

- `read`: outputs `[PATH#TAG]` and `LINE:TEXT`, supports `offset` / `limit` and image pass-through.
- `edit`: uses a compact text protocol to execute `SWAP`, `DEL`, `INS.PRE`, `INS.POST`, `INS.HEAD`, `INS.TAIL`.
- `write`: atomically creates a non-existent UTF-8 text file only; when the target exists it refuses and changes no byte.
- `search`: reuses Pi's native search capability and returns tags plus directly editable line numbers per file.
- Session-level multi-version snapshots, Pi session entry (会话条目) persistence, strict stale tag (过期标签) rejection and conservative line-shift recovery.
- A file mutation queue, atomic create/replace, and preservation of BOM / line endings / permissions / symlink targets; hard-linked files are refused for edits so atomicity is preserved.
- The four public tools share one human-readable projection: by default only an action summary is shown, and Pi's current expand shortcut reveals the necessary anchors, one-line context diff and error-repair syntax.

## Protocol examples

`read` returns:

```text
[src/greet.ts#8E1A44C2]
1:export function greet(name: string) {
2:  return `Hello, ${name}`;
3:}
```

`edit` request:

```json
{
  "input": "[src/greet.ts#8E1A44C2]\nSWAP 2.=2:\n+  return `Hi, ${name}`;"
}
```

Deletion and insertion (model prompts and error messages list these forms in full):

```text
DEL 4.=6
INS.PRE 3:
+// before line 3
INS.POST 3:
+// after line 3
INS.HEAD:
+// file header
INS.TAIL:
+// file footer
```

All line numbers refer to the original file at the time the tag was issued. Operations in one request are validated together first, then applied back to front. The real content of `read` / `search` takes precedence over older task descriptions; an already satisfied `SWAP` is rejected before any other operation touches disk, so a combined request cannot keep inserting duplicates. On success `edit` returns a new tag; that new tag grants no seen lines, so you must `read` or `search` again before editing further.

`search` writes matching lines as `*LINE:TEXT` and context lines as ` LINE:TEXT`; only lines that were not truncated and were actually returned to the model may be used as edit anchors.

`write` keeps Pi's `path + content` parameter shape but only allows creating new files. On success it returns a fresh tag and grants no seen lines; you must `read` or `search` again before editing further. It fails closed when the target exists, is a symlink, or a creation race appears.

## Tool display

The model still receives precise tags and line numbers. The human interface shows a compact summary by default; when expanded, `read` shows only the first and last line of the current window, each `edit` hunk keeps one line before and after the change, and `write` shows creation metadata without echoing the body. The expanded error gives the reason, whether anything was written, and an actionable next step, without raw JSON or internal details.

## Installation and development

The 0.1.2 candidate requires Node.js 22.19.0 or newer and a Pi host matching `^0.80.10 || ^1.6.0`. To try it on Pi 1.6, install from the `main` branch. The older `v0.1.1` tag targets Pi 0.80.10.

```bash
pi install git:github.com/ssdiwu/pi-dhashline@main
```

Local development:

```bash
git clone https://github.com/ssdiwu/pi-dhashline.git
cd pi-dhashline
npm install
npm run check
pi --no-extensions -e .
```

## Layout

- `index.ts`: Pi extension entry point and tool registration.
- `src/`: tags, snapshots, protocol, file handling and tool implementations.
- `tests/`: unit and integration behavior tests.
- `doc/`: architecture, external evidence, terms and decision records.

## Configuration

An optional `dhashline.json` at the project root:

```json
{
  "maxFileBytes": 4194304,
  "snapshots": {
    "maxPaths": 30,
    "maxVersionsPerPath": 4,
    "maxTotalBytes": 67108864
  }
}
```

The configuration is read at session (会话) start; invalid or unknown fields fail closed. `maxFileBytes` is capped at 16 MiB and the total snapshot size at 256 MiB.

## Current boundaries

- `write` only creates new valid UTF-8 local text files in an existing, non-symlink parent directory; existing files must go through `read` + `edit`.
- The initial version accepts one file section (文件段) per `edit`.
- No file deletion, moving, syntax-block locating or cross-file transactions.
- Files larger than 4 MiB by default get no editable tag from `read`, and `write` also refuses to create them; this is configurable within safe limits.
- A patch containing only `INS.HEAD` / `INS.TAIL` cannot prove that a stale state is safe, so it is refused after the file changes.

## Verification

```bash
npm run typecheck
npm test
npm run check
```

Actual loading:

```bash
printf '' | pi --no-extensions -e . --mode rpc --no-session
```

Report pure-protocol unit tests, file/tool integration tests and real Pi loading smoke tests separately; file-safety assertions must not rely on mocks alone.

## Contributing

- Read [`AGENTS.md`](AGENTS.md) first, then [`doc/README.md`](doc/README.md) and the architecture text in [`doc/架构/初版架构.md`](doc/架构/初版架构.md).
- Behavior changes update the architecture document first, then the code and tests, then both READMEs (`README.md` in English and `README-zh.md` in Chinese) — the two versions must stay semantically in sync.
- Public protocol changes (tool parameters, tag semantics, file-safety boundaries) must land with matching behavior tests.
- User-perceivable changes go to the changelog: daily Chinese entries are kept in `CHANGELOG-zh.md` in this repository, and each released version mirrors the same user-perceivable facts into the English `CHANGELOG.md`; both changelogs and both READMEs ship in the npm package.
- One commit does one thing and follows Conventional Commits (约定式提交). Do not commit, push, tag or publish without explicit authorization.

## License

MIT. Hashline design sources and upstream MIT copyright notices are in `THIRD_PARTY_NOTICES.md`.
