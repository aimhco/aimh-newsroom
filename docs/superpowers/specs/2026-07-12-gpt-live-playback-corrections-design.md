# GPT-Live Playback Corrections Design

## Goal

Revise the approved GPT-Live editorial video so article evidence begins in hybrid mode, no Tella base frame appears at clip boundaries or the ending, the availability narration is pronounced naturally, and the delivery folder contains only the selected Version A output.

## Decisions

- Version A remains the sole review deliverable. Version B may exist only as an internal compatibility input while the current Tella/QA implementation still requires it; it must not remain in `final/` after verification.
- Captured article and report evidence starts directly in `EvidenceLayout`. The standalone full-screen establish stage is retired. The later spotlight stage remains.
- Official OpenAI videos remain full-screen with original audio.
- Every Tella media layout must cover its full containing clip. A shorter layout is a production failure because it exposes Tella's blue base frame.
- Replace “on consumer web and mobile” with “on the web and in the ChatGPT app.”
- Preserve optional ElevenLabs pronunciation-dictionary locators in newsroom speech requests and cache keys. Record the observed “mobile” pronunciation issue in the shared AIMH video house style.
- The final frame must remain the `07 THE TAKEAWAY` composition through the end of the output.

## Production Flow

1. Change Remotion evidence staging and narration content under tests.
2. Regenerate the changed ElevenLabs chunk, narration masters, and editorial plates.
3. Update the existing selected Tella project with current plate media, full-length hard-cut layouts, and any replacement narration clip required by the new voice duration.
4. Export and seal the selected Tella video, render the compatibility output required by current QA, and run machine/visual QA.
5. Delete `version-b.mp4` and both `*-before-evidence-revision.mp4` files from `final/`, leaving only `version-a.mp4` for review.

## Acceptance

- No captured article appears standalone before its editorial band.
- Frame-by-frame checks around 1:27 and the final 0.5 seconds contain no blue Tella base frame.
- “ChatGPT app” is spoken naturally in the availability section.
- `final/` contains only `version-a.mp4`.
- Full tests, lint, build, finish, and QA pass before compatibility artifacts are removed.
- YouTube upload remains disabled pending human playback.
