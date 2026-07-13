# AIMH Newsroom MVP Design

## Context

The handoff requests a new, separate `aimh-newsroom` project that can run overnight without blocking on credentials, unavailable APIs, or missing decisions. The sibling `/Users/dennywii/Documents/dev/aimh-video-engine` repo is a Bun/TypeScript video engine with ElevenLabs, FFmpeg, QA, and private YouTube upload helpers. Its current renderer expects a `videos/<slug>/script.json` plus screen recording inputs, so the newsroom MVP should produce a portable episode package first and keep video-engine integration behind a thin adapter.

## MVP Scope

Build a local-first TypeScript spine that can run from fixtures with one command:

```bash
pnpm newsroom:dry-run
```

The command creates `episodes/2026-07-09-daily-ai-briefing/` with raw items, clusters, rankings, `episode.json`, `script.json`, `shotlist.json`, `sources.json`, `metadata.json`, generated fallback cards, QA output, review artifacts, and reports. Missing credentials and unresolved integration choices are written as questions rather than causing a failed run.

## Architecture

The pipeline is staged: collect -> normalize -> verify -> rank -> plan -> capture/fallback cards -> voice placeholder -> render/package -> QA -> upload skip/private -> handoff. Every stage writes files and run events so a later `resume` command can continue from a checkpoint. The first storage layer is JSONL/JSON files under `.state/` and `episodes/`; SQLite is reserved for the next slice.

## Integration Strategy

The `video-engine` adapter detects the sibling repo, package manager, scripts, env variable names, and current compatibility. It does not mutate that repo. Because the existing engine is screen-recording-first, this MVP uses `package_only` or a simple local fallback render and records an integration request for a future episode-package input contract.

## Safety

The default upload policy is private-only and upload-disabled. Reports include variable names and present/missing state, never secret values. QA checks claim coverage, visual coverage, fallback availability, metadata privacy, and secret-like report text.

## Deferred

Live social APIs, complex logged-in browser demos, automatic public publishing, full thumbnail generation, and advanced trend scraping are deferred. The MVP focuses on a working end-to-end dry-run and precise handoff.
