# Video Engine Integration

Detected sibling path:

```text
/Users/dennywii/Documents/dev/aimh-video-engine
```

Current findings:

- Package manager: Bun.
- Language: TypeScript.
- Useful scripts: `make-video`, `qa`, `publish`, `youtube-login`.
- Useful env variable names: `ELEVENLABS_API_KEY`, `ELEVENLABS_VOICE_ID`, `FFMPEG`, `FFPROBE`, `YOUTUBE_CLIENT_ID`, `YOUTUBE_CLIENT_SECRET`, `YOUTUBE_REFRESH_TOKEN`.
- Current renderer shape: `videos/<slug>/script.json` plus `recording.mp4`.

MVP adapter mode is `package_only` because the newsroom package does not yet include a screen recording. Future integration should add an engine command that accepts an episode package folder and consumes `episode.json`, `script.json`, `shotlist.json`, `sources.json`, and `metadata.json`.
