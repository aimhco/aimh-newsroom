import type { EpisodePackage, QaCheck, QaReport } from "../types";
import { scanTextForSecretLeaks } from "../utils/redact";

const check = (name: string, pass: boolean, detail: string): QaCheck => ({ name, pass, detail });

export function runPackageQa(pkg: EpisodePackage): QaReport {
  const sourceIds = new Set(pkg.sources.sources.map((source) => source.id));
  const claimIds = new Set(pkg.sources.claims.map((claim) => claim.id));
  const shotIds = new Set(pkg.shotlist.shots.map((shot) => shot.id));

  const missingClaimRefs = pkg.script.narration.flatMap((paragraph) =>
    paragraph.claim_ids.length === 0
      ? [`${paragraph.id}: no claim_ids`]
      : paragraph.claim_ids.filter((claimId) => !claimIds.has(claimId)).map((claimId) => `${paragraph.id}: ${claimId}`)
  );
  const claimsWithoutSources = pkg.sources.claims.flatMap((claim) =>
    claim.source_ids.length === 0
      ? [`${claim.id}: no source_ids`]
      : claim.source_ids.filter((sourceId) => !sourceIds.has(sourceId)).map((sourceId) => `${claim.id}: ${sourceId}`)
  );
  const sourcesWithoutAccessedAt = pkg.sources.sources
    .filter((source) => !source.accessed_at)
    .map((source) => source.id);

  const missingShotRefs = pkg.script.narration.flatMap((paragraph) =>
    paragraph.shot_ids.length === 0
      ? [`${paragraph.id}: no shot_ids`]
      : paragraph.shot_ids.filter((shotId) => !shotIds.has(shotId)).map((shotId) => `${paragraph.id}: ${shotId}`)
  );
  const shotsWithoutVisualPlan = pkg.shotlist.shots
    .filter((shot) => !shot.asset_path && !shot.fallback?.card_text)
    .map((shot) => shot.id);

  const secretFindings = scanTextForSecretLeaks(JSON.stringify(pkg));

  const checks = [
    check(
      "claim_coverage",
      missingClaimRefs.length === 0 && claimsWithoutSources.length === 0 && sourcesWithoutAccessedAt.length === 0,
      [
        missingClaimRefs.length ? `missing claim refs: ${missingClaimRefs.join(", ")}` : "all narration claims exist",
        claimsWithoutSources.length ? `claims missing sources: ${claimsWithoutSources.join(", ")}` : "all claims map to sources",
        sourcesWithoutAccessedAt.length ? `sources missing accessed_at: ${sourcesWithoutAccessedAt.join(", ")}` : "all sources have accessed_at"
      ].join("; ")
    ),
    check(
      "visual_coverage",
      missingShotRefs.length === 0 && shotsWithoutVisualPlan.length === 0,
      [
        missingShotRefs.length ? `missing shot refs: ${missingShotRefs.join(", ")}` : "all narration paragraphs map to shots",
        shotsWithoutVisualPlan.length ? `shots missing asset/fallback: ${shotsWithoutVisualPlan.join(", ")}` : "all shots have assets or fallbacks"
      ].join("; ")
    ),
    check(
      "private_upload_policy",
      pkg.metadata.youtube.privacyStatus === "private",
      `privacyStatus=${pkg.metadata.youtube.privacyStatus}`
    ),
    check("metadata_valid", Boolean(pkg.metadata.youtube.title && pkg.metadata.youtube.description), "title and description present"),
    check(
      "secret_scan",
      secretFindings.length === 0,
      secretFindings.length ? `possible secret-like text: ${secretFindings.map((finding) => finding.pattern).join(", ")}` : "no secret-like text in package JSON"
    )
  ];

  return {
    ok: checks.every((item) => item.pass),
    checks,
    warnings: []
  };
}
