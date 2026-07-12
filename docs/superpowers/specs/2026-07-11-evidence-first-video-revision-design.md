# Evidence-First Newsroom Video Revision Design

**Date:** 2026-07-11  
**Status:** Approved  
**Applies to:** GPT-Live revision and the next three newsroom calibration episodes

## Purpose

Revise the GPT-Live production so it feels like a concise, evidence-led technology news video rather than a narrated slide deck. The revision keeps the strongest parts of the existing production, fixes the seven issues found during playback review, and establishes a controlled visual system that can become autonomous after three calibrated episodes.

This design also defines two bounded architecture experiments:

1. Compare Remotion and HyperFrames as the code-native composition layer.
2. Evaluate a future pipeline in which Tella is optional rather than required.

Neither experiment may delay or destabilize the immediate GPT-Live revision.

## Decisions

### Visual Direction

Use the content logic of Version A, Dynamic Editorial, with a predominantly white background and the approved Editorial Band Over Source evidence treatment.

The old Version B AIMH Visual Host treatment is retired. Its persistent `AIMH / LIVE SIGNAL` rail did not explain the story, consumed source area, and added branding without useful information. The existing AIMH logo remains fixed in the top-right corner throughout the finished video.

The terms `Dynamic Editorial`, `AIMH Visual Host`, scene counters, plate names, and other experiment labels are production metadata only. None may appear in the finished program.

### Evidence-First Hierarchy

The visual hierarchy is:

1. Full-screen source video when motion or dialogue proves the claim.
2. Purpose-captured article, report, product page, or social post when the source itself is the evidence.
3. Editorial explanation that tells a non-technical viewer why that evidence matters.
4. Motion graphics only when they clarify a concept that source media cannot show directly.

The system must not fill long narrated sections with static text on a blank background when relevant source evidence is available.

## The Seven Playback Fixes

### 1. Git Delivery Model

All revision work remains on the existing feature branch. Commits are local snapshots on that branch. Pushing sends the branch to `aimhco/aimh-newsroom`; opening a draft pull request creates a review and integration surface but does not merge the branch.

The draft pull request remains open while the video is revised. Merge into `main` only after the revised video and implementation are approved.

### 2. White Dynamic Editorial System

Keep Version A's evidence-led scene rhythm, but replace the dark or blue narrated-scene base with white or near-white surfaces. Use black typography, restrained coral and teal accents, and the existing AIMH logo treatment.

This is not a conversion to the old Version B host system. It is Version A's editorial logic with a lighter visual foundation.

### 3. Remove the Visual Host Rail

Delete the persistent side rail, waveform, `LIVE SIGNAL` label, and other non-informational host chrome. Recurring identity comes from:

- The AIMH logo in the top-right safe area.
- Consistent typography, source labels, color accents, and motion behavior.
- A repeatable evidence treatment rather than a permanent decorative panel.

### 4. Music Policy

For the GPT-Live revision:

- Do not play intro music because the program opens with compelling official source video and original audio.
- Do not play music under the narrated body.
- Use one 5 to 7 second track from the dedicated `Outro_` library under the closing call to action.
- Fade the outro track cleanly to silence.
- Do not use the deleted or rejected body track.

For future episodes, intro music is allowed only when the episode does not open with source video or another strong natural-audio hook. Body music is off by default. Outro music remains the repeatable channel signature, with final track selection calibrated during the first three episodes.

### 5. Eliminate Blue Transition Frames

Narration plates and source clips must meet on exact frame boundaries. A transition may be:

- A hard cut, which is the default.
- A deliberately authored transition with no exposed base layer.

The compositor or Tella layout must cover every frame in its declared interval. Timing cushions, rounded duration overruns, or gaps may not reveal the blue project background between clips.

Frame-level QA must sample the final frame before and first frame after every scene boundary and reject unexpected blue, blank, or base-background frames.

### 6. Remove the Experimental Footer

Remove the entire footer used for A/B evaluation, including:

- `Dynamic Editorial`.
- Plate or scene counters.
- Internal mode labels.
- Decorative lines whose only purpose was experiment identification.

Source attribution is content, not experiment chrome, and remains visible through the source-label system described below.

### 7. Show the Evidence, Not Just Commentary

Narrated claims must be accompanied by the strongest available supporting visual. For the GPT-Live episode this includes:

- Full-screen OpenAI grandma conversation excerpt with original audio.
- Full-screen OpenAI translation excerpt with original audio.
- The OpenAI GPT-Live article when explaining full-duplex behavior, model behavior, availability, or limitations.
- Purpose-captured third-party reporting when it contributes a distinct fact or real-world example.
- Selective attributed social evidence when it materially demonstrates a use case that official sources do not.

Third-party video playback requires a higher editorial and rights threshold than a screenshot or attributed post. When playback rights or usefulness are uncertain, use a captured post or article excerpt instead of playing the third-party video.

## Article and Source Treatment

### Editorial Band Over Source

Use the approved three-stage sequence for article, report, and social evidence:

1. **Establish:** Show the source full-screen long enough for the viewer to recognize the publisher and subject.
2. **Explain:** Introduce a white editorial band containing one concise takeaway that explains why the source is on screen.
3. **Prove:** Reframe the source into the remaining area and spotlight the exact passage, chart, quote, or media element supporting the narration.

The source capture must be created for the final viewport. Do not use `object-fit: cover` or another arbitrary crop on a full-page screenshot. Do not stretch the source. If the important region cannot remain legible beside the band, capture or crop the correct article viewport upstream.

### Placement Grammar

Band placement is content-driven:

- Place the band on the left when the important evidence is strongest on the right.
- Place the band on the right when the important evidence is strongest on the left.
- If the source is balanced or centered, use the left as the stable default.
- Reserve top or bottom bands for unusually wide evidence such as horizontal charts, timelines, or wide social cards.
- Never alternate placement mechanically just to create variety.

Full-screen videos never use an editorial band. They may show only the AIMH logo and a concise attribution that does not cover faces, subtitles, or critical UI.

### Attribution and Source Manifest

Every external source must have:

- Publisher or creator name.
- Canonical URL.
- Source type: primary, reporting, social post, or third-party video.
- Claim or scene supported.
- On-screen attribution text.
- Rights and playback decision when video is involved.
- Intended YouTube-description citation.

The canonical URL should be visible on screen in a compact, readable form when the source is introduced. The full canonical URL remains in the episode source manifest for the eventual YouTube description.

## Three-Episode Editorial Calibration

For the next three articles, the pipeline researches and ranks candidate evidence, but the user confirms the final source set before full production. Each candidate receives an editorial rationale based on:

- Direct support for the narrated claim.
- Viewer usefulness and novelty.
- Visual clarity at 1920x1080.
- Source authority.
- Rights and attribution risk.
- Redundancy with evidence already selected.

Research is bounded to prevent unnecessary agent usage:

- Always inspect the primary article and its official embedded media.
- Add no more than two or three external proof sources unless the story clearly requires more.
- Prefer one strong example over a montage of weak examples.
- Use one primary production agent and one final QA review by default.

After three approved episodes, high-confidence choices may become autonomous. Low-confidence, rights-sensitive, or editorially ambiguous choices continue to require confirmation.

## Current Production Architecture

The immediate revision retains the existing hybrid path:

```text
Episode content and evidence manifest
        |
Remotion narration and evidence plates
        |
Tella clip ordering, source-audio preservation, and export
        |
FFmpeg logo, outro mix, loudness treatment, and final encoding
        |
Final MP4 and QA reports
```

Responsibilities remain explicit:

- **Composition layer:** Owns editorial bands, typography, article framing, motion graphics, and scene-level visual continuity.
- **Tella:** Owns the current remote timeline and assembled export during this revision.
- **FFmpeg:** Owns deterministic post-production and verification, not slide design.

## Remotion Versus HyperFrames Calibration

HyperFrames is evaluated as a potential replacement for Remotion, not as a fourth permanent production layer.

Create the same 15 to 20 second approved evidence sequence in both systems using identical source assets, fonts, copy, duration, and output settings. The sequence must include:

- Full-screen source establishment.
- Content-driven left or right editorial band.
- Correctly reframed article evidence.
- Exact-evidence spotlight.
- AIMH safe-area compliance.

Compare:

- Visual quality at 1920x1080.
- Time required to make one editorial revision.
- Text and source-layout reliability.
- Frame-accurate playback and transition behavior.
- Render time and repeatability.
- Ease of automated inspection and regression testing.
- Complexity added to the repository and production process.

Adopt HyperFrames only if it materially improves authoring, iteration, or reliability. If it wins, it replaces Remotion for new newsroom compositions. Do not retain both as parallel mandatory renderers.

## Future Tella-Optional Architecture

Tella remains in the GPT-Live revision to avoid changing multiple production variables at once. During the three-episode calibration, evaluate whether the winning compositor can own the complete timeline:

```text
Research and evidence capture
        |
Episode manifest and editorial decisions
        |
Winning compositor
source video + article layouts + narration + transitions + outro
        |
FFmpeg finishing and automated QA
        |
Final MP4
```

The target state makes Tella optional:

- Use Tella when a human-editable project or screen-recording workflow adds value.
- Do not require Tella merely to sequence programmatically generated newsroom clips.
- Preserve an export or adapter path into Tella for exceptional manual intervention.

The Tella-free decision must be based on measured calibration results, not preference alone. Compare total production time, iteration time, source-audio synchronization, visual quality, failure recovery, and external-service dependence.

## Data Flow and Ownership

The episode manifest is the source of truth. It should describe:

- Narration and timing.
- Source clips and original-audio intervals.
- Evidence captures and focal regions.
- Editorial-band copy and placement.
- Attribution and canonical URLs.
- Scene transition type.
- Music policy and outro selection.
- Logo safe area.

Renderers consume this manifest and produce artifacts. Renderer-specific project IDs, upload URLs, or temporary paths must not become editorial source data.

Generated artifacts remain recoverable by stage so a failed Tella export, compositor render, or FFmpeg finish can be retried without repeating research, source capture, or voice synthesis.

## Failure Handling

- If an article cannot fit beside an editorial band, recapture the relevant viewport rather than cropping blindly.
- If official source video cannot retain original audio through a layout, use it as a standalone full-screen clip.
- If a third-party social source cannot be captured reliably, retain its citation in the source manifest and use a stronger article or official source visual.
- If a transition exposes the base layer, fail QA and render the affected boundary again.
- If the selected outro track is missing, fail preflight before modifying approved outputs.
- If Tella is unavailable, retain all local assets and manifests; do not repeat expensive upstream steps.
- Never upload to YouTube during this revision.

## Verification and Acceptance Criteria

The revised GPT-Live video is acceptable only when:

- It is 2 to 3 minutes long and uses the approved narration.
- Official demonstration videos play full-screen with intelligible original audio.
- Narrated scenes use the white Dynamic Editorial system.
- The AIMH logo remains correctly placed at top-right.
- No visual-host rail or experimental footer is visible.
- No body or intro music is present.
- A 5 to 7 second outro track supports the closing call to action and fades cleanly.
- No blue, blank, or base-background flash appears at any scene boundary.
- Every factual section has meaningful source evidence or a justified explanatory motion graphic.
- Article evidence uses the approved three-stage editorial-band treatment.
- Band placement follows source composition rather than arbitrary alternation.
- Source labels and canonical links are readable and included in the source manifest.
- The final frame, audio tail, loudness, dimensions, frame rate, logo placement, and scene boundaries pass automated QA.
- A human playback review confirms pacing, relevance, legibility, and source-audio transitions.

## Out of Scope

- YouTube upload or publication.
- A permanent HyperFrames migration before the comparison is complete.
- Removing Tella from the current GPT-Live production.
- Avatar or presenter generation.
- Unlimited social-media research.
- Rewriting the approved story unless evidence review finds a factual error.

## Delivery Sequence

1. Commit this approved design specification.
2. Write the implementation plan for the seven fixes and calibration work.
3. Implement the immediate GPT-Live revision on the feature branch.
4. Render, run automated QA, and complete human playback review.
5. Push the feature branch and open a draft pull request against `main`.
6. Merge only after the revised video and code are approved.

