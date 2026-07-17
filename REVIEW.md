## Peer Review — GPT-5.6 two-cut revision and reusable article workflow — 2026-07-14
Reviewer: Codex (Critic pass)

### Critical — must fix before this ships

None.

### Major — should fix, degrades reliability or security

- Critical-phrase QA validates configuration, not rendered speech: `src/production/gpt56Revision.ts:1475` — the automated check passes when `speech_text` contains `tool-calling`, even if ElevenLabs inserts the exact one-second pause this change was meant to prevent. The current two files have a separate successful Whisper timing artifact, but the QA command deletes its variant QA directory and neither consumes nor requires an audio-review result. A future rerender can therefore regress pronunciation and still report PASS.
- The article gates are not connected to the public general planning path: `src/production/gpt56Revision.ts:770`, `src/pipeline/overnight.ts:170`, and `README.md:26` — the reusable validators are enforced by the GPT-5.6 story-specific runner, but the normal `newsroom:plan`, `newsroom:render`, and overnight flow still build and render without loading either manifest. The README's broad “Article episodes use two sealing gates” statement is therefore only true for callers that explicitly adopt the new gate. A dedicated generic article entry point or integration in the planner is still required before this can be relied on as a pipeline-wide invariant.

### Minor — worth addressing, low urgency

- A nonempty motion path is treated as a completed capture: `src/editorial/articleEditorialGate.ts:23` — the gate checks that selected motion has a `local_asset` string, but not that the file exists or matches sealed provenance. Used GPT-5.6 assets are checked later by the renderer, so this does not affect the delivered cuts; an unused selected asset can still be falsely marked captured.
- Outro QA proves selection metadata, not the audio entrance: `src/production/gpt56Revision.ts:1487` — the check confirms that render status and `revision-audio.json` name the same track, but it never analyzes the extracted tail or fingerprints the mix. The FFmpeg render graph is correct and the delivered masters passed a tail-audio inspection, but “exactly one outro entrance” is not enforced by this automated check.
- Workstation-specific defaults remain in the story runner: `src/production/gpt56Revision.ts:746` — environment overrides are supported, but the default newsroom, video-engine, logo, and music discovery paths make another checkout fail without local configuration.
- The story-specific module is large: `src/production/gpt56Revision.ts:1` — scripts, edit manifests, environment discovery, narration, rendering, frame sampling, motion analysis, and CLI dispatch occupy one file. A second article production would benefit from extracting reusable render and QA orchestration before duplicating this pattern.

### Observations (no action required)

- Both local masters passed the complete 722-test repository suite, TypeScript lint/build, media QA, human contact-sheet review, and a separate Whisper word-timing check. “Tool” to “calling” measured a 0.00-second gap in both delivered files.
- The actual top-of-article greenhouse film, Saltwind gameplay, and spirograph build all show measurable frame changes; the paragraph at 0:32 is legible in both targeted full-resolution frames.
- CodeRabbit and Simon Willison materially change the work-allocation story. Axios and the other reviewed candidates remain explicitly rejected with reasons rather than being included to fill a quota.
- The original final and protected baseline are byte-identical. The revision CLI exposes no upload command, both render records say `uploadAttempted: false`, and no remote mutation was performed.
- Episode media is intentionally ignored by Git and remains a local approval artifact; source code, tests, and review records are versioned separately.

### Verdict

SHIP WITH CONDITIONS

Conditions (if applicable): The two review videos are suitable for user comparison now. Before calling the workflow a fully enforced general article pipeline, make audio phrase review a blocking QA input and wire the research/media gate into a generic article planning entry point.

## Peer Review — GPT-5.6 selected Version A corrections — 2026-07-17
Reviewer: Codex (Critic pass)

### Critical — must fix before this ships

None.

### Major — should fix, degrades reliability or security

None.

### Minor — worth addressing, low urgency

- Rendered-speech recognition remains a recorded human-QA artifact rather than a blocking repository check: `src/production/gpt56Revision.ts:1575` — the master has successful local Whisper evidence for both `Programmatic Tool Calling` and `48.55 cents`, and the synthesis inputs are phrase-locked, but a future rerender can still pass the built-in `phrase_lock` check without regenerating ASR. Making portable ASR mandatory would require a managed model/runtime contract rather than the current workstation-local Whisper model.
- Motion cadence proves temporal change, not source identity: `src/production/gpt56Revision.ts:1269` — the rejected wrong-surface capture passed cadence because it moved smoothly. The corrected workflow caught this in full-resolution targeted-frame review and the final master visibly shows the real Saltwind game, but future article runs must retain the human evidence-content pass alongside automated cadence.
- The generic article gate is a dedicated command rather than part of the fixture-oriented daily pipeline: `src/cli/articlePreflight.ts:21` — `newsroom:article:validate` now enforces reviewed media, material research, and real captured files for article packages, while `newsroom:plan` and the generic overnight fixture flow remain a different entry path. Article orchestration must call the dedicated gate before narration/rendering.
- The media manifest's runtime checks enforce the requested video and interactive statuses but do not reject an unknown `review_status` on static evidence: `src/capture/mediaManifest.ts:54` — TypeScript callers are constrained, and untrusted JSON for video/interactive items still fails unless it has the exact required status. A schema parser would make all JSON fields equally strict.

### Observations (no action required)

- The aspect-aware transform correctly maps focal geometry inside the contained source rectangle, including portrait letterboxing, and caps each corrected Version A zoom. Full-resolution samples show the Luna/None and Sol/Max cells, system-card context, and pricing line at their intended targets.
- The final Saltwind source contains 271 meaningful frames over 16.93 seconds, about 16.00 fps, versus about 3.49 fps in the original. Three final-master samples show the genuine boat game, and the source cadence gate passes.
- The selected Version A master passes all media checks, 730 repository tests, TypeScript lint/build, article preflight, and targeted visual review. The protected baseline is unchanged and the prior A master remains available for rollback.
- Version B generated artifacts are absent from the episode delivery tree. Its implementation remains in source as reusable comparison capability and regression coverage, which does not expose or publish a second deliverable.
- The final render record says `uploadAttempted: false`; no upload or publication action occurred.

### Verdict

SHIP WITH CONDITIONS

Conditions (if applicable): Merge and push the verified implementation and retain only Version A as the local approval artifact. Do not upload until the user approves. Future article productions must run the dedicated article preflight and retain human content review because cadence alone cannot prove that the recorded surface is the intended evidence.
