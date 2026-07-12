# Newsroom Compositor Calibration Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Compare Remotion and HyperFrames on the same approved evidence sequence, then determine whether the winning compositor can replace Tella as the required newsroom timeline.

**Architecture:** Build one isolated, identical 15 to 20 second evidence sequence in both renderers from a shared JSON fixture. Measure output correctness and iteration cost before creating a Tella-free full-timeline prototype. Record the decision instead of introducing both renderers as permanent dependencies.

**Tech Stack:** TypeScript, Remotion 4, HyperFrames CLI/producer, HTML/CSS/GSAP, FFmpeg/FFprobe, Vitest

---

## Scope

This plan begins only after the immediate GPT-Live revision is complete. It must not modify the approved GPT-Live final while the comparison is running.

### Task 1: Define a Renderer-Neutral Evidence Fixture

**Files:**
- Create: `calibration/evidence-sequence/fixture.json`
- Create: `src/calibration/evidenceFixture.ts`
- Test: `tests/compositorCalibration.test.ts`

- [ ] Define a 15-second fixture containing source establishment from 0 to 3 seconds, left editorial band from 3 to 9 seconds, spotlight from 9 to 15 seconds, 1920x1080 dimensions, 30 fps, the same source image, the same typography, and no audio.
- [ ] Validate all timing totals, normalized focal coordinates, paths, colors, and copy in a pure TypeScript parser.
- [ ] Run `corepack pnpm vitest run tests/compositorCalibration.test.ts` and require PASS.
- [ ] Commit with `git commit -m "test: define compositor calibration fixture"`.

### Task 2: Render the Fixture with Remotion

**Files:**
- Create: `src/calibration/remotion/Root.tsx`
- Create: `src/calibration/remotion/render.ts`
- Test: `tests/compositorCalibration.test.ts`

- [ ] Render the fixture to `calibration/evidence-sequence/output/remotion.mp4` using the production evidence primitives.
- [ ] Record render duration, output SHA-256, file size, frame count, dimensions, frame rate, and pixel format in `remotion-metrics.json`.
- [ ] Extract frames at 0, 3, 9, and 14.5 seconds and create a contact sheet.
- [ ] Run the focused calibration test and require the media contract to pass.
- [ ] Commit with `git commit -m "feat: add Remotion calibration render"`.

### Task 3: Render the Same Fixture with HyperFrames

**Files:**
- Create: `calibration/evidence-sequence/hyperframes/meta.json`
- Create: `calibration/evidence-sequence/hyperframes/index.html`
- Create: `src/calibration/hyperframes/render.ts`
- Test: `tests/compositorCalibration.test.ts`

- [ ] Install a pinned HyperFrames version only in this task and record it in `package.json` and `pnpm-lock.yaml`.
- [ ] Author one HTML composition that reads the shared fixture, uses data timing attributes, registers one paused GSAP timeline, uses `object-fit: contain`, and reproduces the same three stages.
- [ ] Render to `calibration/evidence-sequence/output/hyperframes.mp4`.
- [ ] Record the same metrics and contact-sheet frames as the Remotion task.
- [ ] Run HyperFrames lint, the focused Vitest file, and TypeScript lint.
- [ ] Commit with `git commit -m "feat: add HyperFrames calibration render"`.

### Task 4: Measure Revision Cost and Visual Reliability

**Files:**
- Create: `src/calibration/compareCompositors.ts`
- Create: `calibration/evidence-sequence/report.md`
- Test: `tests/compositorCalibration.test.ts`

- [ ] Apply the same controlled revision to both outputs: move the band from left to right and change the takeaway copy.
- [ ] Record elapsed edit-to-render time without including dependency installation.
- [ ] Compare text overflow, source visibility, focal-rectangle accuracy, transition timing, render repeatability, output size, and implementation complexity.
- [ ] Require both renderers to produce three repeated outputs with matching per-render SHA-256 within the same renderer.
- [ ] Generate `report.md` with one explicit recommendation: `remotion`, `hyperframes`, or `no_change`.
- [ ] Commit with `git commit -m "docs: compare newsroom compositors"`.

### Task 5: Prototype the Complete Timeline Without Tella

**Files:**
- Create: `src/calibration/fullTimeline.ts`
- Create: `calibration/tella-free/report.md`
- Test: `tests/compositorCalibration.test.ts`

- [ ] Use the winning compositor to assemble local source videos, narration audio, article scenes, hard cuts, outro music, and logo into one non-production prototype.
- [ ] Preserve original source audio and verify narration synchronization at every boundary.
- [ ] Run the existing final-media and transition QA against the prototype.
- [ ] Compare total render time, failure recovery, and human-editability against the approved Tella revision.
- [ ] Do not overwrite any production final or Tella state.
- [ ] Commit with `git commit -m "test: evaluate Tella-free newsroom timeline"`.

### Task 6: Record the Architecture Decision

**Files:**
- Create: `docs/architecture/decisions/0001-newsroom-compositor-and-tella.md`
- Modify: `README.md`

- [ ] Record measured evidence, selected compositor, licensing/deployment implications, whether Tella becomes optional, and the migration boundary.
- [ ] If the evidence is inconclusive, keep Remotion and Tella unchanged and state the next measurable trigger for reevaluation.
- [ ] Run the full test, lint, and build suite.
- [ ] Commit with `git commit -m "docs: decide newsroom rendering architecture"`.

