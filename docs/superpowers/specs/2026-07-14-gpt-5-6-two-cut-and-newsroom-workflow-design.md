# GPT-5.6 Two-Cut Revision and Newsroom Workflow Design

Date: 2026-07-14  
Status: Proposed for final user review  
Scope: Revise the GPT-5.6 episode and make the reusable improvements part of the AIMH newsroom pipeline. No upload.

## Objective

Produce two reviewable revisions of the GPT-5.6 newsroom video:

- **Version A — Evidence documentary:** independent hands-on evidence, readable source zooms, and selected official demos.
- **Version B — Demo-led review:** more continuous official launch and product footage, with the same verified factual foundation but less time spent on source-card presentation.

The comparison must isolate editorial pacing and visual allocation. Both cuts use the same claim standards, corrected terminology, narrator, source labels, closing conclusion, and episode-level outro selection. Preserve the current render as the baseline and do not upload any version.

## Editorial Decisions

### Independent reporting is researched, not quota-filled

For each story, the newsroom researches the primary source plus at least two plausible independent candidates, including one hands-on test or concrete real-world example when available. Inclusion is earned rather than mandatory.

A candidate is included only when it adds at least one of:

1. evidence the primary source cannot supply;
2. a practical consequence for the audience;
3. a credible counterpoint or limitation;
4. a concrete example that makes an abstract claim understandable.

Sources that only paraphrase the primary announcement are excluded. The research manifest records every candidate, its material contribution, and the inclusion decision. The final episode may use fewer than two—or no—independent sources when the candidates fail this test.

For this episode, the recommended additions are:

- CodeRabbit's hands-on long-horizon coding comparison, because it tests a real implementation task and changes how nominal token price should be interpreted.
- Axios's model-selection report, because its concrete comparison of identical prompts shows how effort settings can materially change cost.

Other reviewed sources remain out unless later verification finds a direct contribution to the central work-allocation story.

### The primary article's media is evidence

The original workflow captured screenshots and the obvious hero asset but did not inventory the article's tabbed and interactive embeds. The revised workflow treats every primary page as a media source before it is treated as a screenshot source.

The GPT-5.6 media inventory includes:

- the 15-second, square, 60 fps OpenAI launch film at the top of the article;
- the playable Saltwind sailing demo;
- the other tabbed generated experiences;
- the embedded spirograph, wave-interference, and tokenizer build videos;
- static article sections and caveats that still require readable text evidence.

The top launch film is used in both versions. Version A uses a concise excerpt as opening context. Version B gives it more room as part of an official-media montage. The Saltwind regatta is captured while running, with visible race telemetry and movement; a static sailboat screenshot is not an acceptable substitute.

### Motion must explain, not decorate

Official footage and demos are selected using five checks: claim relevance, visible motion value, capture quality, source clarity, and redundancy. Every included clip receives an on-screen source label and appears under narration that explains why the viewer is seeing it. Clips are muted under narration unless their original sound is itself editorially necessary.

### Source paragraphs must become readable shots

When a paragraph is the evidence, the shot begins with enough page context to establish provenance and then animates into a crop where the quoted paragraph occupies most of the frame. The crop retains the source masthead or an explicit source label. A small highlight box on an unreadable full-page screenshot does not pass QA.

The paragraph near 0:32 in the baseline receives this treatment in both revisions.

## Version Design

### Shared factual spine

Both cuts retain the same central argument: GPT-5.6 makes model and effort selection a form of work allocation. Both cover the Luna/Terra/Sol tiers, reasoning controls, Programmatic Tool Calling, practical artifact creation, independent reality checks, caveats, availability, pricing, and an AIMH recommendation.

Both cuts also use:

- the same narrator and pronunciation rules;
- the same official and independent claim ledger;
- the same on-screen source-label format;
- the same episode-level outro track;
- no intro and no body music;
- a seven-second outro treatment;
- no upload action.

### Version A — Evidence documentary

Target duration: approximately 3:20–3:40.

Visual rhythm:

1. OpenAI launch-film excerpt and the work-allocation hook.
2. Tier claim with a context-to-crop paragraph zoom.
3. Reasoning controls with readable primary evidence.
4. Saltwind gameplay as proof of the rendered artifact.
5. CodeRabbit hands-on task and result.
6. Spirograph or tokenizer build footage as another concrete official example.
7. Axios's concrete cost/effort comparison.
8. OpenAI caveat, availability, pricing, and AIMH verdict.

No single static evidence state should dominate for more than roughly 10–12 seconds. Source cards are used only when the words or numbers are the evidence.

### Version B — Demo-led review

Target duration: approximately 3:05–3:25.

Visual rhythm:

1. Longer OpenAI launch-film montage and faster hook.
2. Condensed tier and reasoning-control evidence.
3. Extended Saltwind gameplay with visible controls and telemetry.
4. Two or three official embedded build examples.
5. A compressed independent reality-check beat using the same selected findings.
6. Short primary-source caveat and AIMH verdict.

Version B is allowed to show fewer source cards but not to drop claim attribution or turn vendor footage into independent proof.

## Narration and Pronunciation

The baseline text contains the correct term, but ElevenLabs inserted an unwanted pause between “Tool” and “Calling.” The episode uses separate display text and speech text so the narrator receives a phrase-locked form such as “Programmatic tool-calling,” while the screen retains the official capitalization “Programmatic Tool Calling.”

The reusable voice contract supports:

- `display_text` for script and captions;
- optional `speech_text` for pronunciation and prosody;
- `critical_phrases` for terms that require an explicit audio spot-check;
- regeneration of only the affected narration chunk.

The corrected phrase must be heard as one unit in both versions before full rendering continues.

## Episode Artifacts

The episode gains two audited manifests:

### `research-manifest.json`

Each external candidate stores publisher, URL, access date, independence, evidence type, novelty, story impact, decision, and a short materiality rationale.

### `media-manifest.json`

Each primary-page media item stores source URL, embed URL or local asset, media kind, article section, duration when applicable, capture status, editorial relevance, and selection decision.

The shot list gains motion-aware shot types:

- `source_video` for official hosted clips;
- `interactive_capture` for screen-recorded demos;
- `source_zoom` for context-to-crop text evidence;
- existing cards and screenshots for appropriate static evidence.

The current final is preserved as `render/final-baseline.mp4`. New outputs are:

- `render/final-a-evidence.mp4`
- `render/final-b-demo.mp4`

Each version receives its own captions, contact sheet, sampled frames, and QA record.

## Reusable Pipeline Changes

### Research gate

Planning refuses to seal an episode until a research manifest records the primary source and the independent-source search. It validates the search effort but never enforces an inclusion count.

### Media inventory gate

Primary-page inspection collects visible videos, video sources, iframes, and common interactive/tabbed embeds. The inventory is persisted before shot selection. If media is present but every item is rejected, each rejection requires an editorial reason.

### Evidence presentation

The renderer supports moving source video, interactive-capture playback, and percentage-based context-to-crop zooms. This becomes reusable newsroom behavior rather than GPT-5.6-specific scene code.

### Visual pacing

The shot planner records visual beats and warns when a scene holds the same static evidence state too long. The warning is advisory when the static source is genuinely necessary, but it must be acknowledged in the episode review.

### Outro selection

At episode creation, the pipeline scans the configured music directory for `Outro_*.mp3`, selects one track with seeded randomness, and persists the selected absolute path in the episode manifest. Rerenders remain reproducible, while different episodes rotate among the available tracks. The selector avoids the immediately previous episode's track when history is available.

Both A and B use the same selected track so music does not bias the editorial comparison.

## Rendering Flow

1. Preserve the baseline render.
2. Seal the research and media manifests.
3. Capture the live Saltwind demo and selected embedded build footage.
4. Prepare zoom geometry for paragraph evidence.
5. Update the evidence-mapped scripts for the shared factual spine and two edit variants.
6. Synthesize only changed ElevenLabs chunks and validate the phrase-locked audio.
7. Select and persist one episode outro track.
8. Render Version A and run QA.
9. Render Version B and run QA.
10. Produce a side-by-side review note with durations, source mix, and known differences.
11. Stop for user approval. Do not upload.

## Failure Handling

- Missing or uncaptured primary media blocks a shot that depends on it; the renderer does not silently fall back to a still.
- Unverified independent claims cannot enter narration.
- A related source without a materiality rationale cannot enter the selected set.
- A source zoom without valid crop geometry fails validation.
- A critical narration phrase without an audio-review result blocks final QA.
- No valid outro candidate fails before rendering rather than silently using a hard-coded track.
- Failed work in one variant does not overwrite the baseline or the other completed variant.
- Upload commands remain outside the revision workflow.

## QA and Acceptance Criteria

Both cuts must pass the existing format, audio, duration, and boundary checks plus the following:

- the top OpenAI launch film appears as moving footage;
- Saltwind appears as captured gameplay, not a still;
- at least one embedded build example visibly changes on screen;
- the baseline paragraph at approximately 0:32 becomes legible through an animated crop;
- “Programmatic Tool Calling” is spoken continuously as a phrase;
- all independent claims map to captured sources and include attribution;
- researched-but-excluded sources are recorded with reasons;
- no unacknowledged static visual hold exceeds the pacing threshold;
- the outro track comes from the configured candidate set and is persisted;
- the baseline and both new final files remain present;
- no upload receipt or remote mutation exists.

## Review Deliverable

The user receives both local MP4s and a compact comparison table covering runtime, percentage of moving footage, independent-source beats, source-zoom count, selected outro, and QA status. The workflow stops there until the user chooses a cut or requests another revision.
