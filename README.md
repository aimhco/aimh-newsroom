# AIMH Newsroom

AIMH Newsroom is a local-first TypeScript pipeline that turns verified AI news into a portable, video-native episode package for AIMH video production.

The first MVP is intentionally fixture-capable. It can run without credentials, create an episode package, generate fallback visual cards, run QA, detect the sibling `aimh-video-engine`, and write a morning handoff describing what is real, mocked, missing, or ready to resume.

## Quick Start

```bash
pnpm install
pnpm newsroom:dry-run
```

Render a local preview video without uploading:

```bash
pnpm newsroom:render --fixtures --no-upload
```

Capture source screenshots, attach them to `shotlist.json`, then render without uploading:

```bash
pnpm newsroom:render --fixtures --capture --no-upload
```

## Article-driven evidence workflow

Article episodes use two sealing gates before narration or rendering:

- `research-manifest.json` records the independent-source search, including a hands-on or real-world test when one can be found. Related sources are included only when they materially add evidence, consequence, limitation, or a clarifying example; there is no inclusion quota.
- `media-manifest.json` inventories the primary page's videos, embeds, interactive demos, galleries, and text evidence. Selected motion must have a captured episode-relative asset before it can enter the edit.

The reusable newsroom compositor supports `source_video`, `interactive_capture`, and animated `source_zoom` beats. Paragraph evidence must move from page context into a readable focal crop. Critical narration terms can keep official display text while using `speech_text` for ElevenLabs prosody. At render time, an outro is chosen from `Outro_*.mp3`, persisted for reproducible rerenders, and rotated by episode seed instead of using one global hard-coded track.

The GPT-5.6 two-cut workflow is local-only and deliberately exposes no upload command:

```bash
pnpm gpt56:revision:voice -- --variant both
pnpm gpt56:revision:render -- --variant both
pnpm gpt56:revision:qa -- --variant both
```

## GPT-Live Tella Exports

After both Tella exports have been downloaded to `exports/tella-a.mp4` and
`exports/tella-b.mp4`, seal their bytes and remote provenance before finishing:

```bash
read -r -s 'GPT_LIVE_TELLA_VERSION_A_DOWNLOAD_URL?Tella A signed URL: '
printf '\n'
read -r -s 'GPT_LIVE_TELLA_VERSION_B_DOWNLOAD_URL?Tella B signed URL: '
printf '\n'

GPT_LIVE_TELLA_VERSION_A_DOWNLOAD_URL="$GPT_LIVE_TELLA_VERSION_A_DOWNLOAD_URL" \
GPT_LIVE_TELLA_VERSION_B_DOWNLOAD_URL="$GPT_LIVE_TELLA_VERSION_B_DOWNLOAD_URL" \
pnpm gpt-live:seal-exports -- \
  --episode-dir episodes/2026-07-10-gpt-live-tella-ab \
  --version-a-source-variant dynamic_editorial \
  --version-a-video-id vid_example_a \
  --version-a-workflow-id Export-Story-vid_example_a/2026-07-12T17:23:26.147Z/Story/1920x1080/30FPS \
  --version-b-source-variant aimh_visual_host \
  --version-b-video-id vid_example_b \
  --version-b-workflow-id Export-Story-vid_example_b/2026-07-12T17:24:26.147Z/Story/1920x1080/30FPS

unset GPT_LIVE_TELLA_VERSION_A_DOWNLOAD_URL GPT_LIVE_TELLA_VERSION_B_DOWNLOAD_URL

pnpm gpt-live:finish -- --episode-dir episodes/2026-07-10-gpt-live-tella-ab
pnpm gpt-live:qa -- --episode-dir episodes/2026-07-10-gpt-live-tella-ab
```

Each workflow ID must exactly match
`Export-Story-${remoteVideoId}/${timestamp}/Story/1920x1080/30FPS`. Its one-time
download URL must use HTTPS on `prod-compose.tella.tv` with the exact pathname
`/${remoteVideoId}/${timestamp}/video/1920x1080/30FPS/video.mp4`. The query is
required and treated as opaque secret material. Download URLs have no CLI
flags and must come from the live shell environment; values loaded from `.env`,
`.env.local`, or the video-engine fallback are rejected. Use silent shell input
as above, never put a signed URL directly in command history, and unset the
shell variables afterward. The seal
streams at most 2 GiB per remote export, rejects non-2xx responses and unsafe
redirects, and writes receipt schema `0.2.0` only when remote SHA-256 and byte
size match the fixed local export.

For the approved compatibility copy, set both source variants and video IDs to
the `dynamic_editorial` values. Both records may use the same workflow ID and
either the same or distinct valid one-time URLs when both local files are copies
of that export; the remote bytes are fetched once by validated workflow identity
and checked against both files. The nonsecret provenance flags also have
`GPT_LIVE_TELLA_VERSION_A_*` or `GPT_LIVE_TELLA_VERSION_B_*` environment
equivalents: `SOURCE_VARIANT`, `VIDEO_ID`, and `WORKFLOW_ID`.

Finishing and QA independently remeasure source fullscreen evidence at 10%,
50%, and 90% of each source clip for both versions. The current two-source plan
therefore requires exactly 12 ordered records with `sampleFraction` and SSIM at
or above `0.90`. Post-production report schema `0.4.0` and QA report schema
`0.2.0` reject legacy midpoint-only evidence. Timeline audit schema `0.2.0`
must contain the queried source-clip duration plus both the narration clip and
its media-layout duration for each compatibility variant. Source and narration
clip durations must reconstruct the queried story duration; the separately
audited layout duration must exactly equal its containing narration clip
duration, including at hard-cut boundaries. Export sample times use the remote
clip clock, while source sample times use the prepared source clip duration.

Legacy timeline audit and export receipt files must be regenerated before
finishing: query the current per-variant clip durations into timeline audit
`0.2.0`, then reseal receipt `0.2.0` with fresh one-time signed download URLs.

Default dry-run output:

```text
episodes/2026-07-09-daily-ai-briefing/
  raw_items.jsonl
  clusters.json
  rankings.json
  episode.json
  script.json
  shotlist.json
  sources.json
  metadata.json
  qa.json
  render/final.mp4       # only after newsroom:render
  render/captions.srt    # only after newsroom:render
  assets/screenshots/    # after --capture
  assets/cards/
  reports/
```

## Safety Defaults

- Uploads are disabled unless `YOUTUBE_UPLOAD_ENABLED=true`.
- YouTube privacy is forced to `private`.
- Missing credentials become questions in `reports/questions-for-denny.md`.
- Secret-like strings are redacted in reports.
- Fixture mode is the default for dry-runs.

## Playwright MCP

Current official Playwright MCP docs support:

```bash
npx @playwright/mcp@latest --headless
npx @playwright/mcp@latest --port 8931 --host 0.0.0.0
npx @playwright/mcp@latest --user-data-dir .state/playwright-profile
npx @playwright/mcp@latest --caps core,storage,devtools,network,testing
```

HTTP clients should connect to:

```text
http://localhost:8931/mcp
```
