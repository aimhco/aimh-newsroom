# AIMH Newsroom Architecture

AIMH Newsroom is a staged file-producing pipeline:

```text
collect -> normalize -> verify -> rank -> plan -> capture -> voice -> render -> qa -> upload -> handoff
```

The MVP runs this spine from deterministic fixtures so missing credentials do not block development. Every stage writes artifacts under `episodes/<episode-id>/` and reports under `episodes/<episode-id>/reports/`. The first storage layer is JSON/JSONL; SQLite is reserved for the next slice once resumable job scheduling needs a richer query model.

The sibling `aimh-video-engine` remains separate. This repo produces an episode package and detects the engine, but it does not mutate or tightly couple to that project.
