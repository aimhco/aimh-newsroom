# German GPT-Live Evidence-First Video Design

Date: 2026-07-13
Status: Approved for implementation planning

## Objective

Produce one German-language AIMH Newsroom video about OpenAI's GPT-Live release by rebuilding the approved evidence-first Version A at source level. The result must preserve the approved story structure, official source footage, white editorial presentation, AIMH branding, and evidence discipline while replacing the narration and editorial copy with natural German.

The deliverable is a local review video only. YouTube upload and publication are prohibited until the user explicitly approves a later upload request.

## Approved Baseline

The production baseline is the approved 179.53-second Version A:

`/Users/dennywii/Documents/dev/aimh-newsroom-pipeline/.worktrees/gpt-live-tella-ab/episodes/2026-07-10-gpt-live-tella-ab/final/version-a.mp4`

That file is byte-equivalent to:

`/Users/dennywii/Documents/dev/aimh-video-engine/videos/gpt-live-explained/final.mp4`

The German version will reuse the approved episode's source clips, evidence captures, scene sequence, renderer primitives, typography, logo treatment, and outro. It will not modify or overwrite either approved English video or the original episode directory.

## Editorial Decisions

- Use informal German address consistently: `du`, `dich`, and `dein`.
- Translate for natural spoken German rather than matching the English sentence structure literally.
- Preserve the meaning, attribution, uncertainty, and source coverage of every approved claim.
- Retain English product and model names where they are proper names, including ChatGPT, GPT-Live, GPT-Live-1, GPT-Live-1 mini, Advanced Voice Mode, GPQA, and API.
- Keep official OpenAI dialogue in its original English audio to preserve evidence authenticity.
- Add German subtitles to the official OpenAI dialogue clips so the complete video remains understandable to a German-speaking audience.
- Translate every AIMH-authored heading, label, takeaway, explanatory detail, use-case card, limitation, and call to action.
- Keep official article screenshots in their original language and pixels. German editorial bands will explain the evidence without altering the source itself.
- Use the configured AIMH ElevenLabs voice with the multilingual model. Silent placeholders or a fallback voice are not acceptable.

## Production Approaches Considered

### Source-Level Localized Rebuild — Selected

Create a separate German content manifest and episode, render German narration scenes from the existing evidence-first components, preserve the official clips, and assemble a new local master from measured media durations.

This approach gives the cleanest typography, the strongest provenance, and the most reliable QA while keeping the English production immutable.

### Tella Project Duplication

Duplicate the remote Tella project and replace every narrated scene. This would retain remote editability but would add upload, timing, export, and provenance dependencies that do not improve this single-version tryout.

### Finished-MP4 Retrofit

Replace the narration track and cover English screen text in the approved MP4. This would be faster initially, but German text lengths would not fit reliably, the original pacing would fight the new narration, and covered text would create visual artifacts.

## Architecture

### Isolated Episode

Create a new episode at:

`episodes/2026-07-13-gpt-live-de/`

The episode will own its German manifest, narration assets, localized scene renders, subtitled source clips, assembled export, final video, and reports. Approved English assets may be copied into the new episode as immutable inputs, but no command may write into the original worktree episode.

### Localized Content Layer

Add a German content module that implements the existing GPT-Live production and visual-content contracts. Shared source URLs, clip timings, evidence asset geometry, branding, and audio policy remain common. Narration text and AIMH-authored visual strings become German-specific data.

The English manifest remains the default and must continue passing its existing tests. The German manifest receives its own validation coverage so localization cannot weaken source-to-claim mappings, evidence provenance, or timeline completeness.

### Evidence Reuse

Reuse these approved evidence categories:

- Official OpenAI translation demonstration with original audio.
- Official OpenAI interruption demonstration with original audio.
- OpenAI full-duplex article evidence.
- Tom's Guide live-translation report.
- OpenAI vendor-reported evaluation evidence.
- OpenAI Help Center availability and limitation evidence.
- OpenAI Realtime direction evidence.
- OpenAI GPT-Live API availability evidence.

Research must refresh the source access date and recheck time-sensitive availability claims before narration synthesis. If a current primary source contradicts the approved script, the German copy must follow the current source and record the change in the source matrix.

### German Narration

The seven narration scenes remain:

1. Hook
2. Full duplex
3. Use cases
4. Evidence
5. Availability
6. Future direction
7. Takeaway and call to action

Each scene will be translated and edited as spoken German, then synthesized separately through ElevenLabs. Scene durations come from the generated MP3 files rather than estimated translation ratios. The visual scene render for each segment must match its measured narration duration exactly.

Pronunciation review must explicitly cover `GPT-Live`, `ChatGPT`, `Tom's Guide`, `Full Duplex`, `GPQA`, and `API`. If the configured voice mispronounces a term, adjust only the speech-preparation text or pronunciation configuration; keep the visible German script readable and correct.

### Official Clip Subtitles

The two official source clips retain their original English audio and full-screen framing. German subtitles will be timed to the spoken dialogue and placed inside a bottom safe area that avoids faces, existing source graphics, and the permanent top-right AIMH logo.

Subtitle copy should convey meaning naturally and concisely. It does not need to preserve every English filler word. Subtitle timing and line breaks must remain readable at normal playback speed.

### Visual Rendering

Reuse the approved white Dynamic Editorial scene system and its existing motion grammar. German copy may require responsive font sizing or line wrapping, but it must not change the visual hierarchy or introduce a new presentation style.

Narrated scenes will continue to use:

- Evidence-first source framing.
- German editorial takeaways beside unaltered source captures.
- The approved section numbering and scene progression.
- The AIMH logo at 150 pixels wide, 24 pixels from the top and right, at 85 percent opacity.
- No intro music or body music.
- The approved outro-only music treatment.

### Timeline Assembly

Assemble one deterministic local timeline in the approved order:

```text
translation clip with German subtitles
German hook
interruption clip with German subtitles
German full-duplex explanation
German use cases
German evidence
German availability
German future direction
German takeaway and call to action
```

German speech length may change the total runtime. Preserve the approved pacing and scene order, but do not time-stretch the voice merely to hit 179.53 seconds. The target remains approximately 2:40 to 3:10, with any variance explained in the QA report.

The local assembly path must preserve full-screen source clips and original source audio. FFmpeg finishing applies the logo, outro mix, and final encoding after the ordered timeline is assembled.

## Data and Artifact Flow

```text
Current primary-source check
        |
German claims, narration, and visual copy
        |
ElevenLabs narration in configured AIMH voice
        |
German evidence-first narration scenes
        |
Approved OpenAI clips plus German subtitles
        |
Deterministic local timeline assembly
        |
Logo and outro finishing
        |
Automated and playback QA
        |
Local final MP4 for user approval
```

Generated assets remain recoverable by stage. A narration correction should regenerate only the affected MP3 and downstream scene. A subtitle correction should regenerate only the affected source clip and downstream assembly.

## Failure Handling

- Fail before rendering if the ElevenLabs credentials or configured voice are unavailable.
- Fail rather than substitute silent narration or a different voice.
- Preserve completed narration chunks when a later chunk fails.
- Reject evidence paths that escape the German episode directory or resolve through unsafe symlinks.
- If German text overflows, adjust line breaking or responsive typography within the existing scene system; do not shrink important copy below readable size.
- If a subtitle obscures important source content, change its line break, safe-area position, or timing and rerender only that clip.
- If current research changes an approved fact, update the German manifest, source matrix, and narration together before synthesis.
- Never run an upload command during this production.

## Verification and Acceptance Criteria

### Editorial QA

- Every German factual statement maps to a saved source and approved claim ID.
- Availability and limitation statements match current primary sources at production time.
- German narration is idiomatic, concise, and consistently uses informal address.
- Vendor-reported evaluations remain clearly attributed to OpenAI.
- Realtime API examples remain directional evidence rather than claims about current consumer features.
- The final call to action retains the approved human-behavior takeaway.

### Narration and Audio QA

- Every narration segment reports `elevenlabs` as its provider.
- The configured AIMH voice is used for all seven German segments.
- Pronunciation checks cover the named technical and brand terms.
- Source dialogue remains audible and is not covered by narration.
- No clicks, clipped words, abrupt silence, or unintended long gaps are present.
- Outro music begins only during the closing section and fades cleanly.
- Final audio is stereo AAC at 48 kHz with acceptable loudness and no clipping.

### Subtitle QA

- Both official English clips have synchronized German subtitles.
- Subtitle lines are readable, remain inside safe bounds, and do not collide with the AIMH logo.
- Subtitles contain no untranslated editorial instructions or placeholder text.

### Visual QA

- Output is 1920x1080 H.264 at 30 fps and is visually nonblank.
- All AIMH-authored presentation copy is German.
- English is allowed only inside original source footage, original source screenshots, proper names, and source labels where translation would reduce provenance.
- Evidence screenshots remain unaltered and legible within the approved editorial-band layout.
- No German text overflows or collides with the logo safe area.
- Scene boundaries contain no blank, blue, or base-background flashes.
- Contact-sheet and boundary-frame review confirm the approved evidence-first visual system throughout.

### Integrity and Delivery QA

- Approved English inputs remain byte-identical after production.
- The German episode has a source matrix, narration manifest, render report, QA report, contact sheet, and final MP4.
- The final MP4 passes duration, stream, frame-sampling, tail-audio, and source-fullscreen checks.
- A complete playback review confirms pacing, subtitle readability, German pronunciation, and clean audio transitions.
- YouTube upload remains disabled and no upload command is executed.

## Deliverables

- Refreshed German source matrix and research notes.
- Approved-meaning German narration script.
- German visual-copy manifest.
- Seven ElevenLabs narration MP3 files using the configured AIMH voice.
- Two official source clips with German subtitles and original English audio.
- German narration scene renders and evidence plates.
- German contact sheet and QA reports.
- One local final MP4 under `episodes/2026-07-13-gpt-live-de/final/`.

## Out of Scope

- German voice dubbing or lip synchronization for the people in OpenAI's official footage.
- A second A/B visual variant.
- Changes to the approved English video.
- YouTube upload, metadata creation, thumbnail production, or publication.
- A general-purpose localization framework for unrelated newsroom stories.
