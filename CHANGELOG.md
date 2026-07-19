# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/), and this project adheres to Semantic Versioning.

## [Unreleased]

## [0.1.1] - 2026-07-20

### Added

- Added a create-only `write` override that atomically publishes fully written UTF-8 text files inside existing real parent directories, returns a fresh tag, and refuses existing targets without overwriting them.

### Changed

- Reduced expanded `read` output to the visible window boundaries and edit diff context to one line around each hunk.
- Replaced hard-coded `Ctrl+O` text with Pi's active expand key hint and added the shared two-layer projection to `write`.
- Added an actionable `offset` continuation hint when model-visible `read` output is truncated.

### Security

- Prevented native `write` from bypassing DHashline tag and seen-line protections on existing files.
- Reject oversized, binary-like, malformed Unicode, symlink, and raced create targets; target files are published only after complete temporary-file verification.
- Reset and persist empty seen-line state for fresh edit/write snapshots, including recreated content that matches an older tag.

## [0.1.0] - 2026-07-20

### Added

- Zero-runtime-dependency Pi extension overriding `read` and `edit` with file-tagged workflows.
- Anchor-producing `search` tool backed by Pi's native search capability.
- Session snapshots persisted across resume/fork/reload, conservative stale recovery, atomic writes, and fresh post-edit tags.
- Strict `dhashline.json` capacity configuration.

### Changed

- Added compact Pi-native projections for `read`, `edit`, and `search`, with shared call/result state, theme-aware text, native diff rendering, and `Ctrl+O` anchor/action details.
- Published the complete edit grammar and reality-first guidance in model prompts and actionable errors.
- Rejected already-satisfied `SWAP` operations before any sibling operation can write duplicate content.

### Security

- Reject unseen post-edit anchors, anchorless stale edits, tag collisions, invalid UTF-8, and hard-linked mutation targets.
- Sanitize terminal control characters before native diff rendering.
