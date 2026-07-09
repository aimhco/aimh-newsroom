# AIMH Newsroom Morning Handoff - 2026-07-09

## Summary

Built the first local-first AIMH Newsroom MVP spine. The current run produced a reviewable episode package, deterministic script, shot list, fallback cards, QA report, review artifacts, a local final MP4, and video-engine integration status. Upload remained disabled by policy.

## Finished artifacts

- Episode package: `/Users/dennywii/Documents/dev/aimh-newsroom-pipeline/episodes/2026-07-09-daily-ai-briefing`
- QA report: `/Users/dennywii/Documents/dev/aimh-newsroom-pipeline/episodes/2026-07-09-daily-ai-briefing/qa.json`
- Review markdown: `/Users/dennywii/Documents/dev/aimh-newsroom-pipeline/episodes/2026-07-09-daily-ai-briefing/episode-review.md`
- Review HTML: `/Users/dennywii/Documents/dev/aimh-newsroom-pipeline/episodes/2026-07-09-daily-ai-briefing/review.html`
- Final video: `/Users/dennywii/Documents/dev/aimh-newsroom-pipeline/episodes/2026-07-09-daily-ai-briefing/render/final.mp4`
- Captions: `/Users/dennywii/Documents/dev/aimh-newsroom-pipeline/episodes/2026-07-09-daily-ai-briefing/render/captions.srt`
- Questions: `/Users/dennywii/Documents/dev/aimh-newsroom-pipeline/episodes/2026-07-09-daily-ai-briefing/reports/questions-for-denny.md`

## Commands run

- `runOvernight`: completed with passing package QA

## What worked

- Fixture collection, normalization, verification labeling, ranking, episode planning, fallback card generation, QA, and handoff reporting completed.
- Local fallback rendering completed with elevenlabs voice audio.
- YouTube metadata defaults to private.
- Video-engine repo was inspected without mutating it.

## What used fixtures/mocks

- Story collection used deterministic fixture raw items.
- Voice generation used ElevenLabs from configured credentials.
- Browser capture used generated fallback cards.

## What failed or is incomplete

- Live source collectors, live Playwright MCP capture, full video-engine package integration, and YouTube upload are still adapter skeletons or policy-disabled in this slice.
- Existing video engine currently expects a screen-recording-first input folder, so this run used the newsroom local fallback renderer when rendering was requested.

## Questions for Denny

## Question 001: YouTube private upload disabled

- Needed for: automatic private YouTube upload
- Default used overnight: skipped upload and kept local episode package
- Impact: video can be reviewed locally but was not uploaded
- To resolve: set YOUTUBE_UPLOAD_ENABLED=true and provide YOUTUBE_CLIENT_ID, YOUTUBE_CLIENT_SECRET, and YOUTUBE_REFRESH_TOKEN
- Pipeline command to resume: `pnpm newsroom:upload --episode 2026-07-09-daily-ai-briefing --private`

## Credentials/config needed

- OPENAI_API_KEY or another LLM provider key for live script generation.
- ELEVENLABS_API_KEY and ELEVENLABS_VOICE_ID for real narration.
- YOUTUBE_CLIENT_ID, YOUTUBE_CLIENT_SECRET, YOUTUBE_REFRESH_TOKEN, and YOUTUBE_UPLOAD_ENABLED=true for private upload.
- Sandbox account details only for any logged-in browser demos.

## Rate limits encountered

None in fixture dry-run mode.

## Video-engine integration status

- Path: `/Users/dennywii/Documents/dev/aimh-video-engine`
- Exists: true
- Package manager: bun
- Package name: aimh-video-engine
- Adapter mode used: package_only
- Env variable names detected: ELEVENLABS_API_KEY, ELEVENLABS_VOICE_ID, FFMPEG, FFPROBE, YOUTUBE_CLIENT_ID, YOUTUBE_CLIENT_SECRET, YOUTUBE_REFRESH_TOKEN
- Notes: Detected make-video CLI, but it currently expects videos/<slug>/script.json plus recording.mp4 rather than a newsroom episode package. Detected private YouTube publishing helper; newsroom upload remains disabled unless explicitly configured. No changes were made to the sibling video engine.

## QA status

- Overall: pass
- PASS claim_coverage: all narration claims exist; all claims map to sources; all sources have accessed_at
- PASS visual_coverage: all narration paragraphs map to shots; all shots have assets or fallbacks
- PASS private_upload_policy: privacyStatus=private
- PASS metadata_valid: title and description present
- PASS secret_scan: no secret-like text in package JSON
- PASS local_render: rendered /Users/dennywii/Documents/dev/aimh-newsroom-pipeline/episodes/2026-07-09-daily-ai-briefing/render/final.mp4

## Next recommended command

```bash
pnpm newsroom:dry-run
```

To render a local preview without upload:

```bash
pnpm newsroom:render --fixtures --no-upload
```
