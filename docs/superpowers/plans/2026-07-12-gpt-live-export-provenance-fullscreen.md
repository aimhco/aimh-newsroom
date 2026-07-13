# GPT-Live Export Provenance And Fullscreen Verification Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Bind each downloaded Tella export to its remote video provenance and prove every official source clip remains full-screen before GPT-Live post-production or publication.

**Architecture:** Add one exact-schema receipt module that derives the only accepted export paths, independently downloads and verifies remote bytes from one-time signed Tella URLs, seals current bytes, and validates receipt records against Tella state. Add one FFmpeg SSIM module that derives remote cumulative source intervals from queried per-variant source and narration durations, samples deterministic frames at 10%, 50%, and 90%, and returns exact ordered evidence for both compatibility outputs. Finish runs both gates before rendering, publishes their evidence in the post-production manifest, and published-generation plus full QA revalidate the complete lineage and coverage.

**Tech Stack:** TypeScript, Node.js crypto/fs/path, FFmpeg SSIM, Vitest, pnpm

---

## File Map

- `src/production/gptLive/tellaExportReceipt.ts`: receipt paths, strict parsing, byte sealing, and current-byte/state validation.
- `src/production/gptLive/sourceFullscreen.ts`: plan-derived 10/50/90 percent samples, FFmpeg SSIM parsing/execution, threshold enforcement, and exact coverage validation.
- `src/production/gptLive/cli.ts`: `seal-exports` argument/env resolution and dispatch.
- `src/production/gptLive/finish.ts`: pre-render receipt/fullscreen gates, post-production evidence, and published-generation validation.
- `src/production/gptLive/qa.ts`: receipt collection for full QA.
- `src/production/gptLive/qa/types.ts`: QA snapshot receipt contract.
- `src/production/gptLive/qa/validation.ts`: exact receipt and fullscreen evidence coverage validation.
- `package.json`: operational `gpt-live:seal-exports` script.
- `tests/gptLiveExportReceipt.test.ts`: receipt schema, sealing, CLI, compatibility, and mutation tests.
- `tests/gptLiveSourceFullscreen.test.ts`: interval derivation, SSIM parsing/orchestration, and real FFmpeg regression.
- `tests/gptLiveFinish.test.ts`: finish preflight ordering and post-production/published-generation integration.
- `tests/gptLiveQa.test.ts`: full-QA exact coverage and provenance validation.

### Task 1: Receipt Contract And Sealing

- [ ] Write tests for the exact two-record schema, derived paths, state video-ID binding, safe workflow IDs, missing/extra/malformed records, and both records using `dynamic_editorial`.
- [ ] Run `corepack pnpm vitest run tests/gptLiveExportReceipt.test.ts` and confirm failure because the module does not exist.
- [ ] Implement `sealTellaExports()` and `validateTellaExportReceipt()` with SHA-256 and positive byte sizes, atomic persistence only after both export files are read.
- [ ] Run the focused test and keep it green.

### Task 2: Seal CLI

- [ ] Add failing CLI tests for explicit flags and `GPT_LIVE_TELLA_VERSION_{A,B}_{SOURCE_VARIANT,VIDEO_ID,WORKFLOW_ID}` fallbacks.
- [ ] Run the focused CLI test and confirm the command is unknown.
- [ ] Dispatch `seal-exports` through the existing episode path/env safety gates and add `gpt-live:seal-exports` to `package.json`.
- [ ] Run the focused tests and lint.

### Task 3: Fullscreen SSIM Verification

- [ ] Write tests that derive cumulative source intervals and exact 10/50/90 percent samples from `plan.clips`, parse FFmpeg `All:` SSIM output, reject scores below `0.90`, and reject missing/extra/reordered coverage.
- [ ] Run `corepack pnpm vitest run tests/gptLiveSourceFullscreen.test.ts` and confirm failure because the verifier does not exist.
- [ ] Implement deterministic single-frame comparison after normalizing both inputs to 1920x1080 yuv420p, with export and source frame indices derived from each sample fraction.
- [ ] Add a real FFmpeg regression generating a re-encoded full-screen fixture plus inset/cropped fixtures; require full-screen pass and inset/crop failure.

### Task 4: Finish And Published Generation

- [ ] Add failing finish tests proving a same-duration post-seal substitution fails before inspection/render, mocked fullscreen checks run before FFmpeg, and post-production stores receipt provenance plus exact per-version/source scores.
- [ ] Validate the receipt immediately after preparation/Tella-state validation and before export inspection or any finishing FFmpeg command.
- [ ] Run fullscreen verification after receipt byte validation and duration inspection, still before rendering.
- [ ] Extend the post-production exact schema and `validatePublishedGeneration()` to require receipt equality/current bytes and exact fullscreen evidence coverage.
- [ ] Run focused finish tests.

### Task 5: Full QA

- [ ] Add failing snapshot tests for missing, extra, duplicated, reordered, wrong-version, wrong-source, wrong-timing, and below-threshold fullscreen records plus receipt/report drift.
- [ ] Include the parsed receipt in QA collection and validate it against state, exports, generation lineage, and post-production provenance.
- [ ] Require fullscreen evidence to equal the plan-derived version/source coverage exactly.
- [ ] Run focused QA tests.

### Task 6: Verification And Review

- [ ] Run focused tests, then `corepack pnpm test`, `corepack pnpm lint`, and `corepack pnpm build`.
- [ ] Run the seal command against a temporary fixture as the CLI smoke test.
- [ ] Inspect `git diff --check`, `git diff --stat`, and the full scoped diff.
- [ ] Record verification in `RESULTS.md`, perform a separate critic pass in `REVIEW.md`, and resolve any ship-blocking issue before commit.
- [ ] Commit all scoped changes once with the final test evidence current.
