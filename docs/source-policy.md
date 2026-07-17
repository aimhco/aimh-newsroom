# Source Policy

Official/canonical sources are the truth layer for factual claims. Newsletters and social/community sources can discover stories or show velocity, but the pipeline must not make hard factual claims from them without canonical support.

MVP source handling:

- `official`, `repo`, and `model` sources can verify claims.
- `newsletter` and `social` sources are labeled as context unless corroborated.
- Every claim must map to at least one source.
- Every source must include `accessed_at`.
- Copyright-sensitive text should be summarized, not copied verbatim.

Automated browser capture is restricted to allowlisted public domains and must not bypass paywalls, CAPTCHAs, or private account protections.

## Related-source research

Every article-driven episode must complete and record an independent-source search before the script is sealed. The search should seek at least two credible candidates when coverage exists, including one hands-on test or concrete real-world example.

This is a research target, not an inclusion quota. A related source belongs in the episode only when it adds new evidence, a practical consequence, a credible limitation, or a concrete example that makes the primary story easier to understand. Sources that only repeat the announcement are rejected. An episode may use fewer than two—or no—related sources when the research manifest explains why the candidates did not materially improve the story.

Every candidate must record its decision and a short materiality rationale. Selected related-source claims remain attributed and must map to their own saved evidence.

## Primary-page media

The primary article is audited for videos, video sources, iframes, interactive demos, tabbed embeds, galleries, and static text evidence before shot selection. Every discovered video is watched and every interactive is operated before a selection decision. The manifest records review status and notes for both selected and rejected items, and validation blocks scripting or rendering when that review is missing. Motion and interactive media are evaluated as evidence, not decoration. Inclusion is materiality-based: if reviewed media does not add evidence, consequence, limitation, or a useful example, the manifest records why it was rejected.
