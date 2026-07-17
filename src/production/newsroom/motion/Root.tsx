import { Composition, registerRoot, type CalculateMetadataFunction } from "remotion";
import { NewsroomEvidencePlate } from "./NewsroomEvidencePlate";
import type { NewsroomEvidencePlateProps } from "./types";

const DEFAULT_PROPS: NewsroomEvidencePlateProps = {
  durationSeconds: 3,
  seriesLabel: "AIMH NEWSROOM",
  beats: [
    {
      id: "default",
      kind: "image",
      assetPath: "default.png",
      durationFrames: 90,
      sourceLabel: "AIMH",
      headline: "Evidence-first",
      focalRect: { x: 0, y: 0, width: 1, height: 1 },
      sourceAspectRatio: 16 / 9
    }
  ]
};

export const calculateNewsroomEvidenceMetadata = async ({
  props
}: {
  readonly props: NewsroomEvidencePlateProps;
}) => {
  if (!Number.isFinite(props.durationSeconds) || props.durationSeconds <= 0) {
    throw new Error("durationSeconds must be finite and positive");
  }
  if (props.beats.length === 0) throw new Error("Evidence plate requires at least one beat");
  const durationInFrames = Math.max(1, Math.ceil(props.durationSeconds * 30));
  const beatFrames = props.beats.reduce((sum, beat) => sum + beat.durationFrames, 0);
  if (beatFrames !== durationInFrames) {
    throw new Error(`Evidence beat frames ${beatFrames} must equal composition frames ${durationInFrames}`);
  }
  return {
    durationInFrames,
    fps: 30,
    width: 1920,
    height: 1080,
    props
  };
};

const calculateMetadata: CalculateMetadataFunction<NewsroomEvidencePlateProps> =
  calculateNewsroomEvidenceMetadata;

export const NewsroomEvidenceRoot = () => (
  <Composition
    id="NewsroomEvidencePlate"
    component={NewsroomEvidencePlate}
    defaultProps={DEFAULT_PROPS}
    calculateMetadata={calculateMetadata}
  />
);

registerRoot(NewsroomEvidenceRoot);
