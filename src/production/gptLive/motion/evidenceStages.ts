export type EvidenceStage = "explain" | "spotlight";

const evidenceStageBoundaries = (durationInFrames: number) => {
  const spotlightFrom = Math.min(
    durationInFrames - 1,
    Math.max(1, Math.floor(durationInFrames * 0.58))
  );
  return { spotlightFrom };
};

export const evidenceStage = (frame: number, durationInFrames: number): EvidenceStage => {
  const { spotlightFrom } = evidenceStageBoundaries(durationInFrames);
  return frame >= spotlightFrom ? "spotlight" : "explain";
};

export const evidenceStageFrames = (
  durationInFrames: number
): Readonly<Record<EvidenceStage, number>> => {
  const { spotlightFrom } = evidenceStageBoundaries(durationInFrames);
  return {
    explain: 0,
    spotlight: spotlightFrom
  };
};

export interface EvidenceSequenceState {
  readonly index: number;
  readonly startFrame: number;
  readonly frame: number;
  readonly durationInFrames: number;
  readonly stage: EvidenceStage;
}

export const evidenceSequenceState = (
  frame: number,
  durationInFrames: number,
  evidenceCount: number
): EvidenceSequenceState => {
  if (!Number.isSafeInteger(durationInFrames) || durationInFrames <= 0) {
    throw new Error("Evidence sequence duration must be a positive integer");
  }
  if (!Number.isSafeInteger(evidenceCount) || evidenceCount <= 0) {
    throw new Error("Evidence sequence count must be a positive integer");
  }
  const boundedFrame = Math.max(0, Math.min(durationInFrames - 1, Math.floor(frame)));
  const index = Math.min(
    evidenceCount - 1,
    Math.floor((boundedFrame * evidenceCount) / durationInFrames)
  );
  const startFrame = Math.floor((index * durationInFrames) / evidenceCount);
  const endFrame = Math.floor(((index + 1) * durationInFrames) / evidenceCount);
  const sequenceDurationInFrames = Math.max(1, endFrame - startFrame);
  const localFrame = Math.min(sequenceDurationInFrames - 1, boundedFrame - startFrame);
  return {
    index,
    startFrame,
    frame: localFrame,
    durationInFrames: sequenceDurationInFrames,
    stage: evidenceStage(localFrame, sequenceDurationInFrames)
  };
};
