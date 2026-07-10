# GPT-Live Tella A/B Video Design

Date: 2026-07-10
Status: Approved for implementation planning

## Objective

Produce two polished, upload-ready YouTube videos about OpenAI's GPT-Live release. Both versions must use the same script, ElevenLabs narration, official source clips, timing, music, and factual claims. Only the recurring visual system changes:

- Version A: Dynamic Editorial
- Version B: AIMH Visual Host

The comparison should reveal which visual treatment is more compelling without confounding the result with different writing or pacing. YouTube upload is out of scope for this iteration.

## Audience And Editorial Standard

The audience is non-technical and interested in useful changes to everyday AI products. The video must explain what GPT-Live enables before explaining its architecture.

The final piece should be between two and three minutes, with a target runtime of about 2:40. It should remain useful and concise: no generic futurism, repetitive model praise, or technical detail that does not clarify a practical capability.

The central editorial idea is:

> GPT-Live matters because people no longer have to speak like a machine to use voice AI. They can interrupt it, pause, redirect it, and keep talking while it responds or works in the background.

## Working Packaging

Working title:

> ChatGPT Can Finally Listen While It Talks

Working thumbnail message:

> YOU CAN INTERRUPT IT

These are provisional production targets. Final title and thumbnail selection should happen after the two exports are reviewed.

## Shared Story Timeline

Both versions use the same timeline and audio.

### 0:00-0:13: Translation Cold Open

Use the official OpenAI translation demo with original audio, approximately 00:50.8-01:03.2 from Vimeo video `1208096618`. The excerpt shows French speech followed almost immediately by English translation.

No narration should compete with the source audio. Music should duck or stop during the excerpt.

### 0:13-0:27: Hook

Establish that the translation was happening as the person spoke, then widen the promise: simultaneous translation is only one behavior enabled by GPT-Live.

Suggested idea, to be polished during scripting:

> That was not a prepared translation. ChatGPT was listening in French and speaking in English almost at the same time. And that is only one thing GPT-Live suddenly makes possible.

### 0:27-0:43: Interruption Demonstration

Use the official OpenAI grandma footage with original audio, approximately 00:31.96-00:43.92 from Vimeo video `1208152658`. The excerpt includes the request to simplify the explanation and the comparison to a normal phone call.

### 0:43-1:02: What Changed

Explain full duplex in plain language using a walkie-talkie-versus-phone-call comparison. Keep the architecture explanation below 20 seconds.

The video may briefly show the previous three-stage voice pipeline, but it should not dwell on model names or implementation details.

### 1:02-1:38: What This Enables

Use a fast montage of concrete behaviors:

- Translate a live conversation, broadcast, or travel interaction.
- Brain-dump with natural pauses without triggering a premature answer.
- Correct or redirect ChatGPT while it is speaking.
- Practice a language through quick, realistic role-play.
- Keep talking while ChatGPT searches, reasons, or handles another request.
- Receive visual cards for weather, sports, maps, stocks, and similar answers while speaking.

The narration should not present every example as equally proven. Official OpenAI demonstrations, reported third-party tests, and forward-looking examples must be labeled distinctly.

### 1:38-1:58: Evidence

Use two concise evidence points:

- A Tom's Guide test used rapid Spanish World Cup commentary and reported continuous English interpretation over the broadcast.
- OpenAI reports that GPT-Live-1 substantially improves expert-level science reasoning over Advanced Voice Mode. The `84.2% versus 45.3%` GPQA figures may be used only after confirming the values against the visual data in the official release or another reliable reproduction, and must be attributed to OpenAI's evaluation.

Avoid presenting vendor benchmarks as independent proof of overall product quality.

### 1:58-2:17: Availability And Limits

Keep spoken availability language short:

- Free users receive GPT-Live-1 mini.
- Go, Plus, and Pro users receive GPT-Live-1.
- Users can check Settings -> Voice for the Live option.
- Launch availability is on consumer web and mobile.

Show additional limitations visually instead of reading a long list:

- No Live video or screen sharing at launch.
- No connected apps or plugins at launch.
- Not initially available in Business, Enterprise, Edu, Temporary Chats, the desktop app, Work, Codex, or custom GPTs.
- Overlapping speech, background noise, network conditions, microphone quality, and long pauses can still cause errors.
- Some languages may have non-native accents or fluency gaps.

### 2:17-2:31: Where This Goes

Connect GPT-Live to three broader patterns described by OpenAI's related Realtime API work:

- Voice-to-action: spoken requests trigger tools and complete tasks.
- Systems-to-voice: software proactively speaks relevant context.
- Voice-to-voice: conversations continue across languages and changing contexts.

Make clear that GPT-Live API availability is planned, while the related Realtime API examples illustrate the likely direction rather than current GPT-Live consumer features.

### 2:31-2:45: Takeaway And Action

The takeaway should focus on human behavior rather than anthropomorphism:

> The breakthrough is not that ChatGPT sounds more human. It is that you no longer have to speak like a machine to use it.

End with a concrete invitation to try Voice and a comment prompt:

> In the comments, tell me what GPT-Live enabled for you, or what you think it is going to enable for you.

The final script may smooth the wording for spoken delivery but must preserve that meaning.

## Source Policy

Primary sources:

- OpenAI GPT-Live announcement: https://openai.com/index/introducing-gpt-live/
- OpenAI translation demo selector: https://openai.com/index/introducing-gpt-live/?video=1208096618
- OpenAI ChatGPT Voice Help Center: https://help.openai.com/en/articles/20001274/
- OpenAI related Realtime API use cases: https://openai.com/index/advancing-voice-intelligence-with-new-models-in-the-api/

Secondary evidence:

- Tom's Guide World Cup translation test: https://www.tomsguide.com/ai/i-used-chatgpts-new-voice-mode-to-translate-the-world-cup-in-real-time-heres-what-happened

The source package must retain URLs, extracted claims, retrieval timestamps, and clip provenance. No claim may rely only on newsletter copy when a primary source is available.

## Shared Audio Design

- Narration provider: ElevenLabs using the configured AIMH voice.
- Script and synthesized narration are generated once and reused unchanged in both versions.
- Official OpenAI excerpts retain their original audio.
- Narration stops during source excerpts.
- Music is subtle, non-lyrical, and identical in both versions.
- Music ducks beneath narration and drops further or stops beneath source dialogue.
- Sound effects are limited to purposeful transitions and data reveals.

Both exports must have matching total duration within 0.5 seconds and identical spoken content.

## Version A: Dynamic Editorial

Version A is footage-first. The narration acts as the host.

Visual rules:

- Use full-screen official footage whenever it demonstrates the claim directly.
- Use source-page crops, product UI, motion diagrams, and kinetic captions between footage excerpts.
- Change visual state every two to six seconds unless an intentional source excerpt needs longer.
- Use large text only for the current idea, not full narration sentences.
- Animate the walkie-talkie-versus-phone-call comparison and the six-use-case montage.
- Attribute source footage and reported tests on screen.
- Avoid decorative slide cards and static 11-14 second holds.

The visual rhythm should feel like a human-edited technology news video, not a narrated presentation deck.

## Version B: AIMH Visual Host

Version B uses the same footage and motion content but adds a consistent AIMH anchor.

Visual rules:

- Maintain a restrained AIMH waveform, mark, or side rail during narrated sections.
- The host element may move between a side panel, lower corner, and compact status strip, but should remain recognizable.
- The host must not cover faces, subtitles, article evidence, or source labels.
- During official demo footage, the host reduces to a small watermark or disappears when necessary.
- Use short host labels such as `WHAT CHANGED`, `WHAT IT ENABLES`, and `TRY THIS`, not paragraph text.
- Preserve the same visual-change cadence as Version A.

Version B tests whether a persistent branded presence improves continuity and channel identity without requiring an avatar.

## Hybrid Tella Production Workflow

### Local Preproduction

1. Capture and verify official article assets and Vimeo media through supported browser access.
2. Save the source caption files and clip provenance.
3. Trim the translation and grandma excerpts locally while preserving original audio.
4. Write and fact-check the final shared script.
5. Synthesize the narration once with ElevenLabs.
6. Pre-render motion assets that Tella cannot produce cleanly, including kinetic typography, diagrams, animated comparison scenes, and the Version B visual-host plates.

### Tella Assembly

1. Upload source excerpts, narration scene videos, motion assets, stills, music, and any sound effects through `create_source`.
2. Create one shared Tella content master with the final sequence and audio timing.
3. Insert official demo excerpts as standalone clips so their original audio is preserved.
4. Duplicate the content master for Version A and Version B.
5. Apply each version's layouts, overlays, zooms, and transitions through Tella MCP.
6. Export both versions at 1920x1080 and 30 fps without burned-in full captions unless the final design explicitly calls for selective kinetic captions.

Tella is the assembly and finishing editor. It is not expected to generate every motion graphic.

## Failure Handling

- If Playwright cannot load an official source, use Chrome-based public-page capture without bypassing CAPTCHAs or access controls.
- If an official Vimeo media asset cannot be bundled directly, use the supported player asset inventory or another authorized public source representation. Do not bypass media protections.
- If Tella upload or export fails, retain the local assets and source IDs, retry the failed operation, and avoid rebuilding successful steps.
- If an original source excerpt cannot retain audio in a Tella layout, insert it as a standalone clip instead of b-roll.
- If one visual version requires timing changes, adjust visual assets only. Do not alter the shared narration or demo clip durations.
- Do not upload either version to YouTube during this iteration.

## Verification And Acceptance Criteria

### Editorial QA

- Every factual claim maps to a saved source.
- Current availability and limitations match the OpenAI Help Center at production time.
- Related Realtime API use cases are clearly identified as directional evidence, not current GPT-Live consumer functionality.
- The script is understandable without prior knowledge of full-duplex systems.
- No sentence remains solely because it sounds impressive.

### Audio QA

- ElevenLabs uses the configured AIMH voice with no fallback provider.
- Source dialogue is intelligible and not covered by narration.
- Music never competes with speech.
- No clicks, clipped words, abrupt cuts, or long silent gaps remain.

### Visual QA

- Both videos are 1920x1080, visually nonblank, and correctly framed.
- No text or overlays exceed safe bounds or cover important source content.
- No unintentional static visual state lasts longer than six seconds.
- Source attributions remain readable.
- Version B's host element is consistent but not intrusive.
- Frame sampling and a complete real-time watch confirm that animations enter on cue.

### Controlled Comparison QA

- Script, narration, source clips, music, and timing are identical between A and B.
- Total durations differ by no more than 0.5 seconds.
- Only visual-system choices differ.
- Both versions pass the same editorial, audio, and visual checks before comparison.

## Deliverables

- Shared fact-checked script and source matrix.
- Saved official source excerpts with provenance.
- ElevenLabs narration assets.
- Tella content master.
- Tella Version A project and exported MP4.
- Tella Version B project and exported MP4.
- QA report comparing timing, media properties, and visual review results.
- No YouTube upload.
