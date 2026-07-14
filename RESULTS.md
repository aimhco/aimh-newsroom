## GPT-5.6 AIMH Newsroom video — 2026-07-13

### What works

- The episode package maps eight narration scenes to fourteen reviewed claims and four official OpenAI sources.
- Eight ElevenLabs narration chunks were synthesized with no fallback and no warnings; measured narration totals 184.877 seconds.
- Eight 1920x1080, 30 fps evidence-first Remotion plates were rendered and muxed to measured narration durations.
- The final video includes the approved 150-pixel AIMH logo at 24-pixel margins and 85 percent opacity, plus the existing seven-second outro treatment.
- Machine QA passed for package integrity, ElevenLabs provenance, H.264/AAC media contract, duration, 48 kHz stereo audio, audio levels, 24 sampled frames, and no-upload policy.
- The visual pass checked the contact sheet and full-resolution launch, practical-work, safety, pricing, and CTA frames. A stale `GPT-LIVE` CTA label was caught, regression-tested, changed to `GPT-5.6`, narrowly rerendered, and re-QA'd.
- Fresh verification: `pnpm test` passed 688/688 tests; `pnpm lint`, `pnpm build`, and `git diff --check` all exited successfully.
- End-to-end smoke commands succeeded: `pnpm gpt56:voice`, `pnpm gpt56:render`, and `pnpm gpt56:qa`.

### What's brittle or incomplete

- Evidence focal rectangles are calibrated to OpenAI's July 13, 2026 page layout. New captures from a redesigned page could need recalibration.
- The story-specific production entry point deliberately reuses the approved GPT-Live motion system; adding a ninth scene or changing the scene taxonomy requires updating the manifest and plate-job mapping together.
- Narration QA verifies the exact submitted text, provider, file presence, duration, and final audio levels, but does not perform an independent ASR pass for pronunciation.

### Known gaps

- The video has not been uploaded or published. This is intentional pending user approval.
- Captions are delivered as a sidecar SRT and are not burned into the picture.
- The downloaded OpenAI hero excerpt is retained as source provenance but is not used in the edit because the evidence-first still treatment communicates the story more clearly.

### Assumptions made

- The approved GPT-Live evidence-first format means the existing white editorial/evidence system, English narration, no intro or body music, and the existing AIMH logo/outro treatment.
- Official OpenAI sources are sufficient for this launch analysis as long as vendor-reported benchmarks are explicitly qualified and the system-card limitation is visibly included.
- A roughly three-minute finished duration is acceptable because measured ElevenLabs narration totals 184.877 seconds.

## GPT-5.6 two-cut revision and reusable article workflow — 2026-07-14

### What works

- Version A (`final-a-evidence.mp4`) renders as a 3:36.6 evidence documentary with 23.3 percent moving footage, nine animated source zooms, and three independent-source beats.
- Version B (`final-b-demo.mp4`) renders as a 3:27.3 demo-led review with 43.9 percent moving footage, eight animated source zooms, and three independent-source beats.
- Both versions use the actual top-of-article greenhouse film, live Saltwind gameplay, a moving spirograph build, CodeRabbit's hands-on repository result, and Simon Willison's same-prompt cost example with persistent on-screen attribution.
- The source paragraph used around 0:32 moves from page context into a readable crop. Full-resolution targeted frames and both 27-frame contact sheets passed visual inspection.
- The ElevenLabs speech override keeps the official display text while synthesizing “Programmatic tool-calling.” Local Whisper timing measured gaps of 0.15 seconds and 0.00 seconds in both versions, with no pause between “tool” and “calling.”
- Article narration/rendering now refuses an incomplete independent-source search, incomplete primary-page media audit, selected motion without a local capture, or motion used by the edit without a selected media decision. Inclusion remains materiality-based rather than quota-based.
- The reusable compositor supports primary video, interactive captures, and animated context-to-crop source evidence. The reusable episode selector scans `Outro_*.mp3`, avoids the previous track when possible, and persists a seeded choice for reproducible rerenders.
- Both versions use the same newly selected `Outro_Dreaming_in_432Hz_Unicorn_Heads.mp3`. The original and protected baseline remain byte-identical at SHA-256 `09da8de677cd7e8c281bca0975d77d1f18928f8b4f7fdb3eab7244279557dc3d`.
- Fresh repository verification passed: 722/722 tests, TypeScript lint, TypeScript build, and `git diff --check`.
- End-to-end smoke commands completed with real ElevenLabs audio: the two-cut voice runner, render runner, and QA runner. Both masters passed H.264 1920×1080 30 fps video, stereo AAC 48 kHz audio, measured runtime, audio level, scene-frame, required-motion, pacing, phrase-lock, baseline, persisted-outro, and no-upload checks.

### What's brittle or incomplete

- Source focal rectangles are calibrated to the captured July 2026 page layouts. Material page redesigns require new captures and crop calibration.
- `src/production/gpt56Revision.ts` intentionally keeps the two scripts, edit manifests, render orchestration, and QA in one story-specific entry point; more article productions should extract the generic orchestration before this grows further.
- Runtime environment discovery retains workstation-specific fallback paths for the newsroom root, video engine, logo, and music directory. Environment overrides exist, but another workstation must configure them.
- The automated legibility check proves a zoom exists and saves the final crop; final reading quality still requires the human visual pass recorded here.

### Known gaps

- Neither version has been uploaded or published. This is intentional and required until the user approves one cut.
- Captions remain scene-level sidecar SRT cues rather than accessibility-grade phrase segmentation or burned-in captions.
- Version B is about 2.3 seconds longer than the upper edge of its approximate 3:05–3:25 design target.
- Episode assets, narration, QA artifacts, and rendered MP4s are intentionally under the repository's ignored `episodes/**` local-output path rather than committed to Git.

### Assumptions made

- The two versions should share the narrator, factual spine, independent sources, conclusion, and outro so the comparison primarily tests visual allocation and pacing.
- The directly accessible Simon Willison experiment is stronger evidence than Axios's secondhand summary of the same example, so Axios remains researched but rejected with a recorded rationale.
- No intro or body music should be added; only the existing seven-second outro treatment should change tracks.
- The actual top article film means the greenhouse/work-in-the-world Vimeo hero, while the separate square ChatGPT Work clip is additional product footage used primarily by Version B.
