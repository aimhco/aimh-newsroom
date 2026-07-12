# AIMH Newsroom Architecture

AIMH Newsroom is a staged file-producing pipeline:

```text
collect -> normalize -> verify -> rank -> plan -> capture -> voice -> render -> qa -> upload -> handoff
```

The MVP runs this spine from deterministic fixtures so missing credentials do not block development. Every stage writes artifacts under `episodes/<episode-id>/` and reports under `episodes/<episode-id>/reports/`. The first storage layer is JSON/JSONL; SQLite is reserved for the next slice once resumable job scheduling needs a richer query model.

The sibling `aimh-video-engine` remains separate. This repo produces an episode package and detects the engine, but it does not mutate or tightly couple to that project.

## GPT-Live Integrity Gates

GPT-Live finishing starts from two fixed local Tella export paths. Receipt seal
schema `0.2.0` binds each path to an exact remote video/workflow identity and
requires a one-time signed URL whose remote bytes independently match the local
SHA-256 and byte size. Download URLs are input-only secrets: receipts, reports,
return values, and errors do not include them. Network access is limited to
HTTPS on `prod-compose.tella.tv`, including redirects, and response size and
time are bounded.

After receipt validation and export inspection, fullscreen verification decodes
deterministic 30fps frame indices at source-clip fractions `0.1`, `0.5`, and
`0.9`. Timeline audit schema `0.2.0` binds the per-variant queried source and
narration durations and requires their sum to reconstruct the queried story
duration. Export frame indices use this remote cumulative timeline; comparison
source frame indices retain the prepared source clip fractions. Finish persists the exact ordered evidence in post-production schema
`0.4.0`; QA remeasures it and persists the validated generation in QA schema
`0.2.0`. With two versions and two source clips, missing, extra, reordered, or
tampered evidence fails unless all 12 SSIM values meet the `0.90` threshold.
