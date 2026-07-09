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
