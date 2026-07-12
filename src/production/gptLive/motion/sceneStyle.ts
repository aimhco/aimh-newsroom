import type { GptLiveVariant, NarrationSpec } from "../types";

export type GptLiveScene = NarrationSpec["scene"];

export const GPT_LIVE_SCENES = [
  "hook",
  "full_duplex",
  "use_cases",
  "evidence",
  "availability",
  "future",
  "cta"
] as const satisfies readonly GptLiveScene[];

export interface SceneRect {
  readonly x: number;
  readonly y: number;
  readonly width: number;
  readonly height: number;
}

export interface ScenePalette {
  readonly background: string;
  readonly foreground: string;
  readonly paper: string;
  readonly signal: string;
  readonly accent: string;
  readonly support: string;
  readonly muted: string;
}

export interface GptLiveSceneStyle {
  readonly variant: GptLiveVariant;
  readonly scene: GptLiveScene;
  readonly persistentHost: boolean;
  readonly reservedTopRight: SceneRect;
  readonly contentRegions: readonly SceneRect[];
  readonly maxStaticFrames: number;
  readonly beatFrames: readonly number[];
  readonly palette: ScenePalette;
  readonly layout: "evidence_editorial";
  readonly motion: "editorial_cuts";
}

const RESERVED_TOP_RIGHT: SceneRect = Object.freeze({
  x: 1920 - 198,
  y: 0,
  width: 198,
  height: 198
});

const EVIDENCE_PALETTE: ScenePalette = Object.freeze({
  background: "#F7F8F6",
  foreground: "#111315",
  paper: "#FFFFFF",
  signal: "#E85B50",
  accent: "#3E8F86",
  support: "#5E8500",
  muted: "#6E7472"
});

const BEATS: Readonly<Record<GptLiveScene, readonly number[]>> = Object.freeze({
  hook: Object.freeze([0, 90, 180, 300]),
  full_duplex: Object.freeze([0, 120, 240, 360]),
  use_cases: Object.freeze([0, 90, 180, 270, 360, 450]),
  evidence: Object.freeze([0, 150, 300]),
  availability: Object.freeze([0, 120, 240, 360]),
  future: Object.freeze([0, 120, 240, 360]),
  cta: Object.freeze([0, 150, 300])
});

export function sceneStyle(
  variant: GptLiveVariant,
  scene: GptLiveScene
): GptLiveSceneStyle {
  const mainRegion: SceneRect = { x: 72, y: 90, width: 1580, height: 900 };

  return {
    variant,
    scene,
    persistentHost: false,
    reservedTopRight: { ...RESERVED_TOP_RIGHT },
    contentRegions: [mainRegion],
    maxStaticFrames: 180,
    beatFrames: [...BEATS[scene]],
    palette: { ...EVIDENCE_PALETTE },
    layout: "evidence_editorial",
    motion: "editorial_cuts"
  };
}
