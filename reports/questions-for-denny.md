# Questions for Denny

## Question 001: YouTube private upload disabled

- Needed for: automatic private YouTube upload
- Default used overnight: skipped upload and kept local episode package
- Impact: video can be reviewed locally but was not uploaded
- To resolve: set YOUTUBE_UPLOAD_ENABLED=true and provide YOUTUBE_CLIENT_ID, YOUTUBE_CLIENT_SECRET, and YOUTUBE_REFRESH_TOKEN
- Pipeline command to resume: `pnpm newsroom:upload --episode 2026-07-09-daily-ai-briefing --private`
