export interface FocalRect {
  readonly x: number;
  readonly y: number;
  readonly width: number;
  readonly height: number;
}

interface EvidenceBeatBase {
  readonly id: string;
  readonly assetPath: string;
  readonly durationFrames: number;
  readonly sourceLabel: string;
  readonly headline: string;
}

export interface MotionEvidenceBeat extends EvidenceBeatBase {
  readonly kind: "video" | "interactive_capture";
  readonly startFromFrames?: number;
  readonly fit?: "cover" | "contain";
}

export interface StillEvidenceBeat extends EvidenceBeatBase {
  readonly kind: "source_zoom" | "image";
  readonly focalRect: FocalRect;
  readonly sourceAspectRatio: number;
  readonly maxScale?: number;
  readonly fit?: "cover" | "contain";
}

export type EvidenceBeat = MotionEvidenceBeat | StillEvidenceBeat;

export interface NewsroomEvidencePlateProps extends Record<string, unknown> {
  readonly durationSeconds: number;
  readonly beats: readonly EvidenceBeat[];
  readonly seriesLabel: string;
}
