import { Composition, registerRoot, type CalculateMetadataFunction } from "remotion";
import "./fonts";
import { GPT_LIVE_VISUAL_CONTENT } from "../content";
import type { EvidenceSpec, GptLiveVariant, SceneContent } from "../types";
import { GptLivePlate } from "./GptLivePlate";

export { resolveEvidenceAssetUrl } from "./evidenceAsset";

export interface RenderedEvidenceSpec extends EvidenceSpec {
  readonly assetWidth: number;
  readonly assetHeight: number;
}

export interface GptLivePlateProps extends Record<string, unknown> {
  readonly variant: GptLiveVariant;
  readonly durationSeconds: number;
  readonly sceneContent: SceneContent;
  readonly evidences?: readonly RenderedEvidenceSpec[];
}

const DEFAULT_PROPS: GptLivePlateProps = {
  variant: "dynamic_editorial",
  durationSeconds: 6,
  sceneContent: GPT_LIVE_VISUAL_CONTENT.hook
};

export const calculateGptLivePlateMetadata = async ({ props }: { props: GptLivePlateProps }) => {
  if (!Number.isFinite(props.durationSeconds) || props.durationSeconds <= 0) {
    throw new Error("durationSeconds must be finite and positive");
  }
  return {
    durationInFrames: Math.max(1, Math.ceil(props.durationSeconds * 30)),
    fps: 30,
    width: 1920,
    height: 1080,
    props
  };
};

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
