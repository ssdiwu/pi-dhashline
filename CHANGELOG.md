# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/), and this project adheres to Semantic Versioning.

## [Unreleased]

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
