import type { SceneContent } from "../types";
import {
  EvidenceLayout,
  EvidenceViewport,
  type RenderableEvidence
} from "./scenePrimitives";
import type { ScenePalette } from "./sceneStyle";
import { HookScene, FullDuplexScene } from "./scenes/ConversationScenes";
import { EvidenceScene, UseCasesScene } from "./scenes/EditorialScenes";
import { AvailabilityScene, CtaScene, FutureScene } from "./scenes/ProductScenes";
import { evidenceSequenceState, evidenceStage } from "./evidenceStages";

export {
  evidenceSequenceState,
  evidenceStage,
  evidenceStageFrames,
  type EvidenceStage
} from "./evidenceStages";

export const EvidenceSequence = ({
  evidence,
  frame,
  durationInFrames,
  viewportWidth,
  viewportHeight
}: {
  readonly evidence: RenderableEvidence;
  readonly frame: number;
  readonly durationInFrames: number;
  readonly viewportWidth: number;
  readonly viewportHeight: number;
}) => {
  const stage = evidenceStage(frame, durationInFrames);
  if (stage === "establish") {
    return (
      <EvidenceViewport
        evidence={evidence}
        spotlight={false}
        viewportWidth={viewportWidth}
        viewportHeight={viewportHeight}
      />
    );
  }
  return (
    <EvidenceLayout
      evidence={evidence}
      spotlight={stage === "spotlight"}
      layoutWidth={viewportWidth}
      layoutHeight={viewportHeight}
    />
  );
};

export const SceneRenderer = ({
  content,
  palette,
  frame,
  stateIndex,
  durationInFrames,
  evidences,
  viewportWidth,
  viewportHeight
}: {
  readonly content: SceneContent;
  readonly palette: ScenePalette;
  readonly frame: number;
  readonly stateIndex: number;
  readonly durationInFrames: number;
  readonly evidences?: readonly RenderableEvidence[];
  readonly viewportWidth: number;
  readonly viewportHeight: number;
}) => {
  if (evidences && evidences.length > 0) {
    const sequence = evidenceSequenceState(frame, durationInFrames, evidences.length);
    const evidence = evidences[sequence.index]!;
    return (
      <EvidenceSequence
        evidence={evidence}
        frame={sequence.frame}
        durationInFrames={sequence.durationInFrames}
        viewportWidth={viewportWidth}
        viewportHeight={viewportHeight}
      />
    );
  }

  const sceneProps = { palette, frame, stateIndex };
  switch (content.scene) {
    case "hook":
      return <HookScene {...sceneProps} content={content} />;
    case "full_duplex":
      return <FullDuplexScene {...sceneProps} durationInFrames={durationInFrames} content={content} />;
    case "use_cases":
      return <UseCasesScene {...sceneProps} content={content} />;
    case "evidence":
      return <EvidenceScene {...sceneProps} content={content} />;
    case "availability":
      return <AvailabilityScene {...sceneProps} content={content} />;
    case "future":
      return <FutureScene {...sceneProps} content={content} />;
    case "cta":
      return <CtaScene {...sceneProps} content={content} />;
  }
};
