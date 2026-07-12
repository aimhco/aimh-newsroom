import { GPT_LIVE_CONTENT, GPT_LIVE_VISUAL_CONTENT } from "../content";
import {
  evidencePublicAssetPath,
  type EvidenceAssetDimensions,
  type EvidenceAssetDimensionsByPath
} from "../evidence";
import type { EvidenceSpec, GptLiveVariant, SceneContent } from "../types";
import { normalizedBeatPlan, SCENE_STATE_COUNTS } from "./beatState";
import {
  evidenceStageFrames,
  type EvidenceStage
} from "./evidenceStages";
import { GPT_LIVE_SCENES } from "./sceneStyle";

export interface SmokeFramePlanItem {
  readonly variant: GptLiveVariant;
  readonly sceneContent: SceneContent;
  readonly evidence?: EvidenceSpec;
  readonly stage?: EvidenceStage;
  readonly frame: number;
  readonly outputName: string;
  readonly verifyContentfulFrame?: true;
}

export const resolveSmokeEvidenceDimensions = (
  evidence: EvidenceSpec,
  dimensions: EvidenceAssetDimensionsByPath
): EvidenceAssetDimensions | undefined => dimensions[evidencePublicAssetPath(evidence)];

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
    GPT_LIVE_SCENES.flatMap((scene): readonly SmokeFramePlanItem[] => {
      const sceneContent = GPT_LIVE_VISUAL_CONTENT[scene];
      const evidence = GPT_LIVE_CONTENT.evidence.find(
        (item) => item.scene === scene && item.playbackDecision === "captured_source"
      );
      if (evidence) {
        const stageFrames = evidenceStageFrames(durationInFrames);
        return (["establish", "explain", "spotlight"] as const).map((stage) => ({
          variant,
          sceneContent,
          evidence,
          stage,
          frame: stageFrames[stage],
          outputName: `${variant}-${scene}-${stage}.png`
        }));
      }
      return [
        {
          variant,
          sceneContent,
          frame: 0,
          outputName: `${variant}-${scene}-start.png`,
          verifyContentfulFrame: true as const
        },
        {
          variant,
          sceneContent,
          frame: representativeFrame(sceneContent, durationInFrames),
          outputName: `${variant}-${scene}.png`
        }
      ];
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

export function assertContentfulFrameMetadata(metadata: string): void {
  const minimum = metadata.match(/lavfi\.signalstats\.YMIN=(\d+)/)?.[1];
  const maximum = metadata.match(/lavfi\.signalstats\.YMAX=(\d+)/)?.[1];
  if (minimum === undefined || maximum === undefined) {
    throw new Error("Rendered frame metadata is incomplete");
  }
  if (minimum === maximum) {
    throw new Error(
      `Rendered frame has no visible luma variation: YMIN=${minimum}, YMAX=${maximum}`
    );
  }
}
