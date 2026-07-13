# GPT-Live Playback Corrections Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Deliver one corrected GPT-Live Version A with immediate hybrid evidence, natural availability narration, and no Tella base-frame flickers.

**Architecture:** Keep the current Remotion to Tella to FFmpeg path. Remotion owns article composition, Tella owns the remote visual clock, and FFmpeg reconstructs audio/branding. Current A/B compatibility validation may run internally, but only Version A remains in the delivery folder.

**Tech Stack:** TypeScript, React 19, Remotion 4, ElevenLabs, Tella MCP, FFmpeg/FFprobe, Vitest, pnpm

---

### Task 1: Start Evidence In Hybrid Mode

**Files:**
- Modify: `src/production/gptLive/motion/SceneRenderer.tsx`
- Modify: `src/production/gptLive/motion/evidenceStages.ts`
- Test: `tests/gptLiveMotion.test.ts`

- [ ] Add a failing test requiring frame zero of captured evidence to render `EvidenceLayout`, not a standalone `EvidenceViewport`.
- [ ] Remove the establish stage while preserving explain and spotlight timing.
- [ ] Run `corepack pnpm vitest run tests/gptLiveMotion.test.ts` and commit.

### Task 2: Correct Narration And Pronunciation Infrastructure

**Files:**
- Modify: `src/production/gptLive/content.ts`
- Modify: `src/voice/elevenLabsAdapter.ts`
- Modify: `src/config/env.ts`
- Modify: `tests/gptLiveContent.test.ts`
- Modify: `tests/voice.test.ts`
- Modify: `/Users/dennywii/Documents/dev/aimh-video-engine/house-style.md`

- [ ] Add failing tests for the approved “web, iPhone, and Android” sentence and optional pronunciation dictionary locators.
- [ ] Include dictionary locator IDs only when both environment values exist, and bind them into the voice cache key.
- [ ] Update the availability sentence and shared house-style lesson.
- [ ] Delete only the availability voice cache and rerun preparation.
- [ ] Run focused tests and commit repository changes.

### Task 3: Eliminate Tella Base-Frame Gaps

**Files:**
- Modify: `src/production/gptLive/tellaState.ts`
- Test: `tests/gptLiveQa.test.ts`
- Regenerate: `episodes/2026-07-10-gpt-live-tella-ab/tella/state.json`

- [ ] Change timeline validation to require every narration media layout duration to equal its containing clip duration.
- [ ] Add a failing regression for any positive layout gap.
- [ ] Upload changed Version A plates, replace the availability narration clip if its duration changed, and set all hard-cut layouts to the queried clip duration.
- [ ] Query Tella again and persist the exact current story, clip, and layout durations.
- [ ] Export, download, and seal current remote bytes.

### Task 4: Render, Verify, And Clean Delivery Artifacts

**Files:**
- Regenerate: `episodes/2026-07-10-gpt-live-tella-ab/final/version-a.mp4`
- Delete: `episodes/2026-07-10-gpt-live-tella-ab/final/version-b.mp4`
- Delete: `episodes/2026-07-10-gpt-live-tella-ab/final/version-a-before-evidence-revision.mp4`
- Delete: `episodes/2026-07-10-gpt-live-tella-ab/final/version-b-before-evidence-revision.mp4`

- [ ] Run finish and QA while compatibility inputs still exist.
- [ ] Extract every frame around 1:27 and the final 0.5 seconds; reject any blue base frame.
- [ ] Listen-check the corrected availability sentence during human playback review.
- [ ] Run `corepack pnpm test`, `corepack pnpm lint`, `corepack pnpm build`, and `git diff --check`.
- [ ] Remove obsolete final files, keep upload readiness false, commit, push, and update the draft PR.
