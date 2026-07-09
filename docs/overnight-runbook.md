# Overnight Runbook

Run a fixture dry-run:

```bash
pnpm install
pnpm newsroom:dry-run
```

Render a finished local preview without upload:

```bash
pnpm newsroom:render --fixtures --no-upload
```

Verification commands:

```bash
pnpm lint
pnpm test
pnpm build
pnpm newsroom:dry-run
pnpm newsroom:render --fixtures --no-upload
```

Primary output:

```text
episodes/2026-07-09-daily-ai-briefing/
reports/morning-handoff-2026-07-09.md
reports/questions-for-denny.md
episodes/2026-07-09-daily-ai-briefing/render/final.mp4
```

Safe defaults:

- Upload is skipped unless explicitly enabled.
- Upload privacy must remain `private`.
- Missing live integrations become questions for Denny.
- Fixture mode uses generated fallback cards instead of live Playwright capture.
