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
