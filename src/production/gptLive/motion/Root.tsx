import { Composition, registerRoot, type CalculateMetadataFunction } from "remotion";
import type { GptLiveVariant } from "../types";
import { GptLivePlate } from "./GptLivePlate";
import type { GptLiveScene } from "./sceneStyle";

export interface GptLiveClaimLabel {
  readonly label: string;
  readonly source: string;
}

export interface GptLivePlateProps extends Record<string, unknown> {
  readonly variant: GptLiveVariant;
  readonly scene: GptLiveScene;
  readonly durationSeconds: number;
  readonly narrationId: string;
  readonly text: string;
  readonly claimLabels: readonly GptLiveClaimLabel[];
}

const DEFAULT_PROPS: GptLivePlateProps = {
  variant: "dynamic_editorial",
  scene: "hook",
  durationSeconds: 6,
  narrationId: "narration_hook",
  text: "GPT-Live listens and speaks at the same time.",
  claimLabels: []
};

export const calculateGptLivePlateMetadata = async ({ props }: { props: GptLivePlateProps }) => ({
  durationInFrames: Math.max(1, Math.round(props.durationSeconds * 30)),
  fps: 30,
  width: 1920,
  height: 1080,
  props
});

const calculateMetadata: CalculateMetadataFunction<GptLivePlateProps> = calculateGptLivePlateMetadata;

export const GptLiveMotionRoot = () => (
  <Composition
    id="GptLivePlate"
    component={GptLivePlate}
    defaultProps={DEFAULT_PROPS}
    calculateMetadata={calculateMetadata}
  />
);

registerRoot(GptLiveMotionRoot);
