# GPT-5.6 AIMH Newsroom Video Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Produce one local, evidence-first AIMH Newsroom video about GPT-5.6 with verified sources, ElevenLabs narration, AIMH finishing, and complete QA, without uploading.

**Architecture:** Keep the work episode-scoped. A typed manifest supplies claims, narration, evidence, and scene copy to the existing GPT-Live Remotion plate composition. A narrow CLI synthesizes voice, renders and muxes eight scenes, assembles the final video, and produces machine and visual QA artifacts.

**Tech Stack:** TypeScript, React 19, Remotion 4, ElevenLabs Multilingual v2, FFmpeg/FFprobe, Vitest, pnpm

---

## File Map

- `src/production/gpt56Episode.ts`: typed story manifest, validation, voice/render/assembly/QA orchestration, and a no-upload CLI.
- `tests/gpt56Episode.test.ts`: manifest, validation, render-plan, finishing, and no-upload contracts.
- `package.json`: `gpt56:voice`, `gpt56:render`, `gpt56:qa`, and `gpt56:all` scripts only.
- `episodes/2026-07-13-gpt-5-6/`: research, script, evidence, voice, render, and QA artifacts.
- `RESULTS.md`: verified builder results.
- `REVIEW.md`: critic pass.

### Task 1: Lock the editorial package

**Files:**
- Create: `episodes/2026-07-13-gpt-5-6/sources.json`
- Create: `episodes/2026-07-13-gpt-5-6/script.json`
- Create: `episodes/2026-07-13-gpt-5-6/shotlist.json`
- Create: `episodes/2026-07-13-gpt-5-6/metadata.json`
- Create: `episodes/2026-07-13-gpt-5-6/episode-review.md`

- [ ] Save the official article, system-card, model-documentation, and Programmatic Tool Calling source records with access date `2026-07-13`.
- [ ] Save claims for model tiers, efficiency, `max`, four-agent `ultra`, Programmatic Tool Calling, design/computer use, knowledge work, benchmark caveats, safety, availability, and pricing.
- [ ] Save the eight exact narration chunks and map each one to claim and shot IDs.
- [ ] Save one evidence shot per source-backed segment and one branded closing shot.
- [ ] Run package QA and fix every missing claim, source, or shot mapping.

### Task 2: Add the episode production contract under TDD

**Files:**
- Create: `tests/gpt56Episode.test.ts`
- Create: `src/production/gpt56Episode.ts`
- Modify: `package.json`

- [ ] Write a failing test that imports the story manifest and requires eight ordered narration scenes, unique IDs, relative evidence paths, and complete claim/source coverage.
- [ ] Run `pnpm vitest run tests/gpt56Episode.test.ts` and confirm failure because the module does not exist.
- [ ] Implement the minimal manifest and validator.
- [ ] Write and verify failing tests for measured voice records, plate jobs, mux arguments, final logo/outro arguments, and rejection of the command `upload`.
- [ ] Implement the minimal helpers and CLI stages to pass those tests.
- [ ] Run the focused test after each red-green cycle, then run `pnpm lint`.

### Task 3: Synthesize measured narration

**Files:**
- Create: `episodes/2026-07-13-gpt-5-6/voice/*.mp3`
- Create: `episodes/2026-07-13-gpt-5-6/voice/*.mp3.json`
- Create: `episodes/2026-07-13-gpt-5-6/voice/narration.json`

- [ ] Load the existing project `.env` without printing any credential values.
- [ ] Run `pnpm gpt56:voice` and require all eight chunks to report provider `elevenlabs` with no warnings.
- [ ] Probe every MP3 for a positive duration and record the measured value.
- [ ] Regenerate only an affected chunk if pronunciation or wording QA requires a correction.

### Task 4: Render evidence-first scenes and assemble the final

**Files:**
- Create: `episodes/2026-07-13-gpt-5-6/plates/*.mp4`
- Create: `episodes/2026-07-13-gpt-5-6/render/segments/*.mp4`
- Create: `episodes/2026-07-13-gpt-5-6/render/captions.srt`
- Create: `episodes/2026-07-13-gpt-5-6/render/final.mp4`
- Create: `episodes/2026-07-13-gpt-5-6/render/render-status.json`

- [ ] Stage only the selected evidence PNGs into a temporary Remotion public directory.
- [ ] Bundle the existing `GptLivePlate` composition once.
- [ ] Render eight H.264, 1920x1080, 30 fps plates using measured voice durations.
- [ ] Mux each plate with its matching narration as stereo AAC at 48 kHz.
- [ ] Concatenate the eight segments in script order.
- [ ] Overlay the approved AIMH logo at 150 pixels, 24-pixel margins, and 85 percent opacity.
- [ ] Mix the existing seven-second AIMH outro beneath the final scene and fade it cleanly.
- [ ] Write captions from measured durations and a render receipt with source hashes and duration totals.

### Task 5: Run machine, visual, and editorial QA

**Files:**
- Create: `episodes/2026-07-13-gpt-5-6/qa.json`
- Create: `episodes/2026-07-13-gpt-5-6/reports/contact-sheet.png`
- Create: `episodes/2026-07-13-gpt-5-6/reports/frames/*.png`
- Create: `episodes/2026-07-13-gpt-5-6/reports/tail.wav`

- [ ] Run `pnpm gpt56:qa` and require the final video and all narration/evidence contracts to pass.
- [ ] Probe video codec, size, frame rate, pixel format, audio codec, sample rate, channels, and duration.
- [ ] Sample the start, midpoint, and end of every scene and reject blank or uniform frames.
- [ ] Generate a contact sheet and inspect evidence legibility, spotlight placement, text wrapping, logo clearance, and scene boundaries.
- [ ] Run loudness/peak analysis and extract the final ten seconds as a tail-audio sample.
- [ ] Confirm that no upload receipt or uploaded status exists.

### Task 6: Close the builder and critic loops

**Files:**
- Create or append: `RESULTS.md`
- Create or replace: `REVIEW.md`

- [ ] Run `pnpm test`, `pnpm lint`, and `pnpm build` fresh.
- [ ] Run the full story flow with `pnpm gpt56:all`, then run `pnpm gpt56:qa` again against the published local artifact.
- [ ] Write `RESULTS.md` with what works, brittle areas, known gaps, and assumptions.
- [ ] Review every changed file and generated report as a critic; write severity-tagged findings and a verdict in `REVIEW.md` without changing code.
- [ ] Hand off the local final MP4 and QA artifacts for user approval. Do not upload.
