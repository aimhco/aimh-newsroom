import type { EvidenceBeat, FocalRect } from "./types";

interface BeatDuration {
  readonly durationFrames: number;
}

const assertBeatDurations = (beats: readonly BeatDuration[]): void => {
  if (beats.length === 0) throw new Error("Evidence timeline requires at least one beat");
  for (const beat of beats) {
    if (!Number.isInteger(beat.durationFrames) || beat.durationFrames <= 0) {
      throw new Error("Evidence beat durationFrames must be a positive integer");
    }
  }
};

export function beatAtFrame(
  beats: readonly BeatDuration[],
  frame: number
): { readonly index: number; readonly localFrame: number } {
  assertBeatDurations(beats);
  const safeFrame = Math.max(0, Math.floor(Number.isFinite(frame) ? frame : 0));
  let cursor = 0;
  for (const [index, beat] of beats.entries()) {
    if (safeFrame < cursor + beat.durationFrames) {
      return { index, localFrame: safeFrame - cursor };
    }
    cursor += beat.durationFrames;
  }
  const index = beats.length - 1;
  return { index, localFrame: beats[index]!.durationFrames - 1 };
}

const assertFocalRect = (rect: FocalRect): void => {
  const values = [rect.x, rect.y, rect.width, rect.height];
  if (!values.every((value) => Number.isFinite(value)) || rect.width <= 0 || rect.height <= 0) {
    throw new Error("Evidence focal rectangle must have finite positive dimensions");
  }
  if (rect.x < 0 || rect.y < 0 || rect.x + rect.width > 1 || rect.y + rect.height > 1) {
    throw new Error("Evidence focal rectangle must remain inside the source");
  }
};

const clamp01 = (value: number): number => Math.max(0, Math.min(1, value));
const smoothstep = (value: number): number => value * value * (3 - 2 * value);

export function zoomTransformAtFrame(options: {
  readonly frame: number;
  readonly durationFrames: number;
  readonly focalRect: FocalRect;
}): {
  readonly scale: number;
  readonly translateXPercent: number;
  readonly translateYPercent: number;
} {
  assertFocalRect(options.focalRect);
  if (!Number.isInteger(options.durationFrames) || options.durationFrames <= 1) {
    throw new Error("Evidence zoom durationFrames must be an integer greater than one");
  }
  const normalizedFrame = clamp01(options.frame / (options.durationFrames - 1));
  const zoomProgress = smoothstep(clamp01((normalizedFrame - 0.18) / 0.72));
  const targetScale = Math.max(
    1.6,
    Math.min(3.2, 1 / options.focalRect.width, 1 / options.focalRect.height)
  );
  const centerX = options.focalRect.x + options.focalRect.width / 2;
  const centerY = options.focalRect.y + options.focalRect.height / 2;
  return {
    scale: 1 + (targetScale - 1) * zoomProgress,
    translateXPercent: (0.5 - centerX) * 100 * zoomProgress,
    translateYPercent: (0.5 - centerY) * 100 * zoomProgress
  };
}

export function findLongStaticHolds(
  beats: readonly Pick<EvidenceBeat, "id" | "kind" | "durationFrames">[],
  fps: number,
  thresholdSeconds: number
): readonly { readonly id: string; readonly durationSeconds: number }[] {
  if (!Number.isFinite(fps) || fps <= 0 || !Number.isFinite(thresholdSeconds) || thresholdSeconds <= 0) {
    throw new Error("Pacing thresholds must be finite and positive");
  }
  return beats.flatMap((beat) => {
    const durationSeconds = beat.durationFrames / fps;
    return beat.kind === "image" && durationSeconds > thresholdSeconds
      ? [{ id: beat.id, durationSeconds }]
      : [];
  });
}
