import type { GptLiveScene } from "./sceneStyle";

export const SCENE_STATE_COUNTS: Readonly<Record<GptLiveScene, number>> = Object.freeze({
  hook: 2,
  full_duplex: 3,
  use_cases: 6,
  evidence: 2,
  availability: 3,
  future: 3,
  cta: 3
});

export interface NormalizedBeatOptions {
  readonly durationInFrames: number;
  readonly itemCount: number;
  readonly maxStaticFrames: number;
}

export interface NormalizedBeatPlan {
  readonly holdFrames: number;
  readonly firstPassFrames: number;
}

const positiveInteger = (value: number, label: string): number => {
  if (!Number.isInteger(value) || value <= 0) {
    throw new Error(`${label} must be a positive integer`);
  }
  return value;
};

export function normalizedBeatPlan(options: NormalizedBeatOptions): NormalizedBeatPlan {
  const durationInFrames = positiveInteger(options.durationInFrames, "durationInFrames");
  const itemCount = positiveInteger(options.itemCount, "itemCount");
  const maxStaticFrames = positiveInteger(options.maxStaticFrames, "maxStaticFrames");
  const holdFrames = Math.max(
    1,
    Math.min(maxStaticFrames, Math.floor(durationInFrames / itemCount))
  );

  return {
    holdFrames,
    firstPassFrames: holdFrames * itemCount
  };
}

export function normalizedBeatIndex(frame: number, options: NormalizedBeatOptions): number {
  const plan = normalizedBeatPlan(options);
  const normalizedFrame = Math.max(0, Math.floor(Number.isFinite(frame) ? frame : 0));
  return Math.floor(normalizedFrame / plan.holdFrames) % options.itemCount;
}

export function sceneStateIndex(
  scene: GptLiveScene,
  frame: number,
  durationInFrames: number,
  maxStaticFrames: number
): number {
  return normalizedBeatIndex(frame, {
    durationInFrames,
    itemCount: SCENE_STATE_COUNTS[scene],
    maxStaticFrames
  });
}
