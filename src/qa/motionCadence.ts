export interface MotionCadenceInput {
  readonly meaningfulFrames: number;
  readonly durationSeconds: number;
  readonly minimumFps: number;
}

export interface MotionCadenceResult extends MotionCadenceInput {
  readonly meaningfulFramesPerSecond: number;
  readonly pass: boolean;
}

export function evaluateMotionCadence(input: MotionCadenceInput): MotionCadenceResult {
  if (!Number.isInteger(input.meaningfulFrames) || input.meaningfulFrames <= 0) {
    throw new Error("Motion cadence meaningfulFrames must be a positive integer");
  }
  if (!Number.isFinite(input.durationSeconds) || input.durationSeconds <= 0) {
    throw new Error("Motion cadence durationSeconds must be finite and positive");
  }
  if (!Number.isFinite(input.minimumFps) || input.minimumFps <= 0) {
    throw new Error("Motion cadence minimumFps must be finite and positive");
  }
  const meaningfulFramesPerSecond = input.meaningfulFrames / input.durationSeconds;
  return {
    ...input,
    meaningfulFramesPerSecond,
    pass: meaningfulFramesPerSecond >= input.minimumFps
  };
}

export function parseMpdecimateFrameCount(diagnostic: string): number {
  const matches = [...diagnostic.matchAll(/frame=\s*(\d+)/g)];
  const parsed = Number(matches.at(-1)?.[1]);
  if (!Number.isInteger(parsed) || parsed <= 0) {
    throw new Error("Could not parse a positive mpdecimate frame count");
  }
  return parsed;
}
