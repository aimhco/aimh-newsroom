export type ResearchDecision = "selected" | "rejected";

export type ResearchEvidenceType =
  | "hands_on"
  | "real_world_example"
  | "reporting"
  | "analysis";

export interface ResearchCandidate {
  readonly id: string;
  readonly independent: boolean;
  readonly evidence_type: ResearchEvidenceType;
  readonly novelty: 0 | 1 | 2 | 3;
  readonly story_impact: 0 | 1 | 2 | 3;
  readonly decision: ResearchDecision;
  readonly rationale: string;
}

export interface ResearchManifest {
  readonly schema_version: "0.1.0";
  readonly primary_source_id: string;
  readonly search_complete: boolean;
  readonly hands_on_sought: boolean;
  readonly search_notes: string;
  readonly candidates: readonly ResearchCandidate[];
}

export function validateResearchManifest(manifest: ResearchManifest): void {
  if (!manifest.primary_source_id.trim()) {
    throw new Error("Research manifest requires a primary source");
  }
  if (!manifest.search_complete) {
    throw new Error("Independent-source search is incomplete");
  }
  if (!manifest.hands_on_sought) {
    throw new Error("Independent-source search must seek a hands-on test or real-world example");
  }
  if (!manifest.search_notes.trim()) {
    throw new Error("Independent-source search requires notes");
  }

  const seen = new Set<string>();
  for (const candidate of manifest.candidates) {
    if (!candidate.id.trim()) throw new Error("Research candidate requires an id");
    if (seen.has(candidate.id)) throw new Error(`Duplicate research candidate: ${candidate.id}`);
    seen.add(candidate.id);
    if (!candidate.independent) {
      throw new Error(`Related research candidate ${candidate.id} must be independent`);
    }
    if (!candidate.rationale.trim()) {
      throw new Error(`Research candidate ${candidate.id} needs a rationale`);
    }
    if (
      candidate.decision === "selected" &&
      candidate.novelty + candidate.story_impact < 2
    ) {
      throw new Error(`Selected source ${candidate.id} has no material contribution`);
    }
  }
}
