# Episode Package Spec

An episode package is a portable folder under `episodes/<episode-id>/`.

Required files:

- `raw_items.jsonl`: raw collector output.
- `clusters.json`: deduplicated story clusters.
- `rankings.json`: scored story candidates.
- `episode.json`: episode identity, status, and file references.
- `script.json`: narration chunks with `claim_ids` and `shot_ids`.
- `shotlist.json`: visual plan where each shot has an asset or fallback.
- `sources.json`: claims and source records with `accessed_at`.
- `metadata.json`: YouTube metadata, always private by default.
- `qa.json`: package QA checks.

Generated assets live under `assets/`. The MVP creates fallback PNG cards under `assets/cards/`.
