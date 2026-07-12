export type EvidenceStage = "establish" | "explain" | "spotlight";

const evidenceStageBoundaries = (durationInFrames: number) => {
  const establishUntil = Math.min(60, Math.floor(durationInFrames * 0.2));
  const spotlightFrom = Math.min(
    durationInFrames - 1,
    Math.max(establishUntil + 1, Math.floor(durationInFrames * 0.58))
  );
  return { establishUntil, spotlightFrom };
};

export const evidenceStage = (frame: number, durationInFrames: number): EvidenceStage => {
  const { establishUntil, spotlightFrom } = evidenceStageBoundaries(durationInFrames);
  if (frame < establishUntil) return "establish";
  return frame >= spotlightFrom ? "spotlight" : "explain";
};

export const evidenceStageFrames = (
  durationInFrames: number
): Readonly<Record<EvidenceStage, number>> => {
  const { establishUntil, spotlightFrom } = evidenceStageBoundaries(durationInFrames);
  return {
    establish: 0,
    explain: Math.min(durationInFrames - 1, establishUntil),
    spotlight: spotlightFrom
  };
};
