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

export const EVIDENCE_BENCHMARK_COPY = Object.freeze({
  attribution: "OPENAI-REPORTED / VENDOR-REPORTED",
  comparison: "GPT-LIVE-1 VS ADVANCED VOICE MODE",
  benchmark: "ON GPQA",
  statement:
    "OpenAI reports GPT-Live-1 substantially outperforms Advanced Voice Mode on GPQA.",
  qualification: "Not independent validation."
});

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
  readonly layout: "kinetic_full_frame" | "anchored_host_rail";
  readonly motion: "editorial_cuts" | "responsive_voice_rail";
}

const RESERVED_TOP_RIGHT: SceneRect = Object.freeze({
  x: 1920 - 198,
  y: 0,
  width: 198,
  height: 198
});

const DYNAMIC_PALETTE: ScenePalette = Object.freeze({
  background: "#0B0C0E",
  foreground: "#F7F4EE",
  paper: "#E9E6DF",
  signal: "#FF625B",
  accent: "#32DED0",
  support: "#C8F75A",
  muted: "#8E9694"
});

const HOST_PALETTE: ScenePalette = Object.freeze({
  background: "#F1F3F0",
  foreground: "#101315",
  paper: "#FFFFFF",
  signal: "#D94B44",
  accent: "#007C75",
  support: "#5E8500",
  muted: "#69726F"
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
  const persistentHost = variant === "aimh_visual_host";
  const mainRegion: SceneRect = persistentHost
    ? { x: 250, y: 90, width: 1400, height: 900 }
    : { x: 72, y: 90, width: 1580, height: 900 };
  const contentRegions: SceneRect[] = persistentHost
    ? [mainRegion, { x: 42, y: 224, width: 138, height: 786 }]
    : [mainRegion];

  return {
    variant,
    scene,
    persistentHost,
    reservedTopRight: { ...RESERVED_TOP_RIGHT },
    contentRegions,
    maxStaticFrames: 180,
    beatFrames: [...BEATS[scene]],
    palette: { ...(persistentHost ? HOST_PALETTE : DYNAMIC_PALETTE) },
    layout: persistentHost ? "anchored_host_rail" : "kinetic_full_frame",
    motion: persistentHost ? "responsive_voice_rail" : "editorial_cuts"
  };
}
