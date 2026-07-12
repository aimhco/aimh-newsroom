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

export type EvidenceStage = "establish" | "explain" | "spotlight";

export const evidenceStage = (frame: number, durationInFrames: number): EvidenceStage => {
  const establishUntil = Math.min(60, Math.floor(durationInFrames * 0.2));
  const spotlightFrom = Math.min(
    durationInFrames - 1,
    Math.max(establishUntil + 1, Math.floor(durationInFrames * 0.58))
  );
  if (frame < establishUntil) return "establish";
  return frame >= spotlightFrom ? "spotlight" : "explain";
};

export const EvidenceSequence = ({
  evidence,
  frame,
  durationInFrames
}: {
  readonly evidence: RenderableEvidence;
  readonly frame: number;
  readonly durationInFrames: number;
}) => {
  const stage = evidenceStage(frame, durationInFrames);
  if (stage === "establish") {
    return <EvidenceViewport evidence={evidence} spotlight={false} />;
  }
  return <EvidenceLayout evidence={evidence} spotlight={stage === "spotlight"} />;
};

export const SceneRenderer = ({
  content,
  palette,
  frame,
  stateIndex,
  durationInFrames,
  evidence
}: {
  readonly content: SceneContent;
  readonly palette: ScenePalette;
  readonly frame: number;
  readonly stateIndex: number;
  readonly durationInFrames: number;
  readonly evidence?: RenderableEvidence;
}) => {
  if (evidence?.playbackDecision === "captured_source") {
    return (
      <EvidenceSequence
        evidence={evidence}
        frame={frame}
        durationInFrames={durationInFrames}
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
