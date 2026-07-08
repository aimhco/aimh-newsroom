# Questions for Denny

## Question 001: LLM provider key missing

- Needed for: live story summarization and script generation
- Default used overnight: deterministic fixture script planner
- Impact: dry-run package is reviewable, but live editorial writing is not enabled
- To resolve: add OPENAI_API_KEY, ANTHROPIC_API_KEY, or GOOGLE_API_KEY to .env and set AIMH_LLM_PROVIDER
- Pipeline command to resume: `pnpm newsroom:resume --episode 2026-07-09-daily-ai-briefing --from-stage plan`

## Question 002: YouTube private upload disabled

- Needed for: automatic private YouTube upload
- Default used overnight: skipped upload and kept local episode package
- Impact: video can be reviewed locally but was not uploaded
- To resolve: set YOUTUBE_UPLOAD_ENABLED=true and provide YOUTUBE_CLIENT_ID, YOUTUBE_CLIENT_SECRET, and YOUTUBE_REFRESH_TOKEN
- Pipeline command to resume: `pnpm newsroom:upload --episode 2026-07-09-daily-ai-briefing --private`
