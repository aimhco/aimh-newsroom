# Source Policy

Official/canonical sources are the truth layer for factual claims. Newsletters and social/community sources can discover stories or show velocity, but the pipeline must not make hard factual claims from them without canonical support.

MVP source handling:

- `official`, `repo`, and `model` sources can verify claims.
- `newsletter` and `social` sources are labeled as context unless corroborated.
- Every claim must map to at least one source.
- Every source must include `accessed_at`.
- Copyright-sensitive text should be summarized, not copied verbatim.

Automated browser capture is restricted to allowlisted public domains and must not bypass paywalls, CAPTCHAs, or private account protections.
