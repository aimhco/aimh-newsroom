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
  readonly viewportWidth: number;
  readonly viewportHeight: number;
  readonly sourceAspectRatio: number;
  readonly maxScale?: number;
}): {
  readonly scale: number;
  readonly translateXPixels: number;
  readonly translateYPixels: number;
  readonly displayWidth: number;
  readonly displayHeight: number;
} {
  assertFocalRect(options.focalRect);
  if (!Number.isInteger(options.durationFrames) || options.durationFrames <= 1) {
    throw new Error("Evidence zoom durationFrames must be an integer greater than one");
  }
  if (
    !Number.isFinite(options.viewportWidth) ||
    options.viewportWidth <= 0 ||
    !Number.isFinite(options.viewportHeight) ||
    options.viewportHeight <= 0
  ) {
    throw new Error("Evidence zoom viewport dimensions must be finite and positive");
  }
  if (!Number.isFinite(options.sourceAspectRatio) || options.sourceAspectRatio <= 0) {
    throw new Error("Evidence zoom sourceAspectRatio must be finite and positive");
  }
  if (options.maxScale !== undefined && (!Number.isFinite(options.maxScale) || options.maxScale < 1)) {
    throw new Error("Evidence zoom maxScale must be finite and at least one");
  }

  const viewportAspectRatio = options.viewportWidth / options.viewportHeight;
  const displayWidth = options.sourceAspectRatio >= viewportAspectRatio
    ? options.viewportWidth
    : options.viewportHeight * options.sourceAspectRatio;
  const displayHeight = options.sourceAspectRatio >= viewportAspectRatio
    ? options.viewportWidth / options.sourceAspectRatio
    : options.viewportHeight;
  const normalizedFrame = clamp01(options.frame / (options.durationFrames - 1));
  const zoomProgress = smoothstep(clamp01((normalizedFrame - 0.18) / 0.72));
  const targetScale = Math.max(
    1,
    Math.min(
      options.maxScale ?? 2,
      (options.viewportWidth * 0.88) / (options.focalRect.width * displayWidth),
      (options.viewportHeight * 0.82) / (options.focalRect.height * displayHeight)
    )
  );
  const centerX = options.focalRect.x + options.focalRect.width / 2;
  const centerY = options.focalRect.y + options.focalRect.height / 2;
  const scale = 1 + (targetScale - 1) * zoomProgress;
  return {
    scale,
    translateXPixels: -(centerX - 0.5) * displayWidth * scale * zoomProgress,
    translateYPixels: -(centerY - 0.5) * displayHeight * scale * zoomProgress,
    displayWidth,
    displayHeight
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
