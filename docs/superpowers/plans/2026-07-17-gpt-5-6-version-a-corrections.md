# GPT-5.6 Version A Corrections Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Correct the selected GPT-5.6 Version A master, discard Version B review output, and make article-media review plus motion-cadence QA enforceable newsroom behavior.

**Architecture:** Keep the existing story runner and generic Remotion evidence plate. Add aspect-aware still transforms, explicit per-shot zoom limits, review status in the generic media manifest, and a pure cadence parser used by GPT-5.6 QA. Use pre-cropped 16:9 Pelican evidence and a new hardware capture so story-specific geometry stays simple while generic validation prevents the same failures.

**Tech Stack:** TypeScript, Vitest, Remotion 4, FFmpeg/FFprobe, ElevenLabs, Playwright/browser capture.

---

## File Structure

- Modify `src/production/newsroom/motion/types.ts` — carry source aspect ratio and optional zoom limit.
- Modify `src/production/newsroom/motion/timing.ts` — compute contained-image geometry and aspect-aware transforms.
- Modify `src/production/newsroom/motion/NewsroomEvidencePlate.tsx` — render the calculated contained-image transform.
- Modify `src/capture/mediaManifest.ts` — require watched/operated media review evidence.
- Create `src/qa/motionCadence.ts` — parse and validate meaningful-frame cadence.
- Modify `src/production/gpt56Revision.ts` — corrected A script, beats, assets, and cadence QA.
- Modify `tests/newsroomMotion.test.ts`, `tests/newsroomEditorial.test.ts`, and `tests/gpt56Revision.test.ts` — regression coverage.
- Modify `README.md`, `docs/source-policy.md`, `RESULTS.md`, and `REVIEW.md` — durable workflow and verified handoff.

### Task 1: Aspect-aware conservative zooms

**Files:**
- Modify: `tests/newsroomMotion.test.ts`
- Modify: `src/production/newsroom/motion/types.ts`
- Modify: `src/production/newsroom/motion/timing.ts`
- Modify: `src/production/newsroom/motion/NewsroomEvidencePlate.tsx`

- [ ] **Step 1: Write failing transform tests**

Add tests proving a portrait source is letterboxed before zooming, its focal center lands at the viewport center at the final frame, `maxScale` caps the move, and values below 1 are rejected.

- [ ] **Step 2: Run the focused test and verify RED**

Run: `pnpm vitest run tests/newsroomMotion.test.ts`
Expected: FAIL because the current transform has no source aspect ratio or per-shot cap.

- [ ] **Step 3: Implement contained-image geometry**

Add `sourceAspectRatio` and `maxScale` to still beats. Return display width/height and pixel translation from `zoomTransformAtFrame`; cap the default at 2.0 and use 1.2 as the minimum useful move.

- [ ] **Step 4: Render through nested translate/scale layers**

Center the contained image at frame zero, translate its scaled focal center to the viewport center, and retain a no-motion path for `image` beats.

- [ ] **Step 5: Run the focused test and verify GREEN**

Run: `pnpm vitest run tests/newsroomMotion.test.ts`
Expected: PASS.

### Task 2: Mandatory primary-media review evidence

**Files:**
- Modify: `tests/newsroomEditorial.test.ts`
- Modify: `src/capture/mediaManifest.ts`
- Modify: `README.md`
- Modify: `docs/source-policy.md`

- [ ] **Step 1: Write failing review-status tests**

Require `video` to be `watched`, `interactive` to be `operated`, iframe motion to be watched or operated, and every item to contain nonempty review notes.

- [ ] **Step 2: Run the editorial test and verify RED**

Run: `pnpm vitest run tests/newsroomEditorial.test.ts`
Expected: FAIL because review evidence is not currently represented.

- [ ] **Step 3: Implement the media review contract**

Add `review_status: "watched" | "operated" | "inspected"` and `review_notes`. Reject a completed audit whose status does not match its media kind.

- [ ] **Step 4: Document watch-first, include-by-materiality behavior**

State that media inspection is mandatory but editorial inclusion is not.

- [ ] **Step 5: Run the editorial test and verify GREEN**

Run: `pnpm vitest run tests/newsroomEditorial.test.ts`
Expected: PASS.

### Task 3: Meaningful-frame cadence gate

**Files:**
- Create: `src/qa/motionCadence.ts`
- Modify: `tests/gpt56Revision.test.ts`
- Modify: `src/production/gpt56Revision.ts`

- [ ] **Step 1: Write failing cadence tests**

Test nominal 30 fps with 61 meaningful frames over 17.5 seconds as a failure, 181 meaningful frames over 16.5 seconds as a pass, malformed diagnostics as an error, and exact threshold behavior.

- [ ] **Step 2: Run the focused test and verify RED**

Run: `pnpm vitest run tests/gpt56Revision.test.ts`
Expected: FAIL because no cadence parser exists.

- [ ] **Step 3: Implement and wire cadence QA**

Parse the `mpdecimate` frame count, compute meaningful frames per second, require at least 8 fps for interactive capture, and record the value in the QA detail.

- [ ] **Step 4: Run the focused test and verify GREEN**

Run: `pnpm vitest run tests/gpt56Revision.test.ts`
Expected: PASS.

### Task 4: Correct the selected A edit

**Files:**
- Modify: `tests/gpt56Revision.test.ts`
- Modify: `src/production/gpt56Revision.ts`
- Generate: `episodes/2026-07-13-gpt-5-6/evidence/10-simon-low-none.png`
- Generate: `episodes/2026-07-13-gpt-5-6/evidence/10-simon-high-max.png`
- Replace: `episodes/2026-07-13-gpt-5-6/source/saltwind-gameplay.mp4`

- [ ] **Step 1: Write failing selected-cut assertions**

Assert the A cost chunk contains the point-by-point speech override, Pelican beats use separate 16:9 assets with conservative limits, the system card is not aggressively zoomed, pricing targets the price line, and the closing scene contains no Saltwind repeat.

- [ ] **Step 2: Run the focused test and verify RED**

Run: `pnpm vitest run tests/gpt56Revision.test.ts`
Expected: FAIL on the old script and shot map.

- [ ] **Step 3: Generate and inspect corrected evidence**

Create full-width 16:9 top and bottom table crops; inspect them at 1920×1080 and verify the 0.71- and 48.55-cent cells are visible.

- [ ] **Step 4: Update A narration and beats**

Keep display text numeric, synthesize “forty-eight point five five cents,” use mild Pelican/pricing transforms, show the system card in context, and close on hero/spirograph evidence.

- [ ] **Step 5: Preserve the old A and replace Saltwind**

Copy the current master to `render/final-a-evidence-before-corrections.mp4`, then install the cadence-checked capture.

- [ ] **Step 6: Run the focused test and verify GREEN**

Run: `pnpm vitest run tests/gpt56Revision.test.ts`
Expected: PASS.

### Task 5: Rerender and QA only Version A

**Files:**
- Regenerate: `episodes/2026-07-13-gpt-5-6/voice/revision/a-evidence/a_cost.mp3`
- Regenerate: `episodes/2026-07-13-gpt-5-6/render/final-a-evidence.mp4`
- Regenerate: `episodes/2026-07-13-gpt-5-6/qa/a-evidence/*`

- [ ] **Step 1: Invalidate only the changed narration chunk**

Remove the A cost voice cache only, then run `pnpm gpt56:revision:voice -- --variant a-evidence`.

- [ ] **Step 2: Render and run A QA**

Run `pnpm gpt56:revision:render -- --variant a-evidence` and `pnpm gpt56:revision:qa -- --variant a-evidence`.

- [ ] **Step 3: Perform targeted visual/audio acceptance**

Inspect frames around 1:09–1:22, 2:02, 2:09, 2:16, 2:38, 2:59, and 3:15; run local ASR on the cost chunk and verify “point five five.”

- [ ] **Step 4: Discard Version B review output**

After A passes, remove B final/captions/voice/render/QA artifacts and replace the comparison note with the selected-A handoff.

### Task 6: Full verification, critic pass, merge, and push

**Files:**
- Modify: `RESULTS.md`
- Modify: `REVIEW.md`

- [ ] **Step 1: Run fresh repository verification**

Run: `pnpm test && pnpm lint && pnpm build && git diff --check`
Expected: all commands exit 0.

- [ ] **Step 2: Write RESULTS.md and the independent critic review**

Record exact test/render/QA evidence, limitations, assumptions, severity buckets, and verdict.

- [ ] **Step 3: Commit the correction**

Stage only intended source, test, and documentation changes; commit without episode media or secrets.

- [ ] **Step 4: Merge to main and verify the merged tree**

Use a clean main worktree, merge the feature branch, rerun the full suite, and preserve unrelated worktrees.

- [ ] **Step 5: Push main to origin**

Push only after merged-tree verification succeeds. Do not run any video upload or publish command.
