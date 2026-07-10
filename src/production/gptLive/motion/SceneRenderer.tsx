import type { SceneContent } from "../types";
import type { ScenePalette } from "./sceneStyle";
import { HookScene, FullDuplexScene } from "./scenes/ConversationScenes";
import { EvidenceScene, UseCasesScene } from "./scenes/EditorialScenes";
import { AvailabilityScene, CtaScene, FutureScene } from "./scenes/ProductScenes";

export const SceneRenderer = ({
  content,
  palette,
  frame,
  stateIndex,
  durationInFrames
}: {
  readonly content: SceneContent;
  readonly palette: ScenePalette;
  readonly frame: number;
  readonly stateIndex: number;
  readonly durationInFrames: number;
}) => {
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
