import { GPT_LIVE_CONTENT, GPT_LIVE_VISUAL_CONTENT } from "../content";
import type { GptLiveVariant, SceneContent } from "../types";
import { normalizedBeatPlan, SCENE_STATE_COUNTS } from "./beatState";
import { GPT_LIVE_SCENES } from "./sceneStyle";

export interface SmokeFramePlanItem {
  readonly variant: GptLiveVariant;
  readonly sceneContent: SceneContent;
  readonly frame: number;
  readonly outputName: string;
}

const representativeFrame = (content: SceneContent, durationInFrames: number): number => {
  const itemCount = SCENE_STATE_COUNTS[content.scene];
  const beat = normalizedBeatPlan({ durationInFrames, itemCount, maxStaticFrames: 180 });
  const representativeState = Math.floor(itemCount / 2);
  return Math.min(
    durationInFrames - 1,
    representativeState * beat.holdFrames + Math.floor(beat.holdFrames / 2)
  );
};

export function buildSmokeFramePlan(durationInFrames: number): readonly SmokeFramePlanItem[] {
  return GPT_LIVE_CONTENT.variants.flatMap((variant) =>
    GPT_LIVE_SCENES.map((scene) => {
      const sceneContent = GPT_LIVE_VISUAL_CONTENT[scene];
      return {
        variant,
        sceneContent,
        frame: representativeFrame(sceneContent, durationInFrames),
        outputName: `${variant}-${scene}.png`
      };
    })
  );
}

export function useCaseTemporalFrames(durationInFrames: number): readonly number[] {
  const itemCount = SCENE_STATE_COUNTS.use_cases;
  const beat = normalizedBeatPlan({ durationInFrames, itemCount, maxStaticFrames: 180 });
  return Array.from({ length: itemCount }, (_, index) =>
    Math.min(durationInFrames - 1, index * beat.holdFrames + Math.floor(beat.holdFrames / 2))
  );
}

export function assertUniformSafeAreaMetadata(metadata: string): void {
  for (const channel of ["Y", "U", "V"] as const) {
    const minimum = metadata.match(new RegExp(`lavfi\\.signalstats\\.${channel}MIN=(\\d+)`))?.[1];
    const maximum = metadata.match(new RegExp(`lavfi\\.signalstats\\.${channel}MAX=(\\d+)`))?.[1];
    if (minimum === undefined || maximum === undefined) {
      throw new Error("Rendered safe area metadata is incomplete");
    }
    if (minimum !== maximum) {
      throw new Error(
        `Rendered safe area is not uniform: ${channel}MIN=${minimum}, ${channel}MAX=${maximum}`
      );
    }
  }
}
