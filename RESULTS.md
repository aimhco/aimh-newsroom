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
