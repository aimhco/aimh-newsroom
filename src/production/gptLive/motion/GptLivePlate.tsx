import { useEffect, useState } from "react";
import {
  AbsoluteFill,
  spring,
  useCurrentFrame,
  useDelayRender,
  useVideoConfig
} from "remotion";
import type { GptLivePlateProps } from "./Root";
import { SceneRenderer } from "./SceneRenderer";
import { sceneStateIndex } from "./beatState";
import { resolveEvidenceAssetUrl } from "./evidenceAsset";
import { MOTION_SANS_FONT } from "./fonts";
import { sceneStyle } from "./sceneStyle";

export const plateEntranceStyle = (
  animateEntrance: boolean,
  entranceProgress: number
): { readonly transform: string; readonly opacity: number } => ({
  transform: animateEntrance
    ? `translateX(${(1 - entranceProgress) * -28}px)`
    : "none",
  opacity: 1
});

export const GptLivePlate = (props: GptLivePlateProps) => {
  const { delayRender, continueRender, cancelRender } = useDelayRender();
  const [fontHandle] = useState(() => delayRender("Loading bundled GPT-Live fonts"));
  useEffect(() => {
    document.fonts.ready
      .then(() => continueRender(fontHandle))
      .catch((error: unknown) => cancelRender(error));
  }, [cancelRender, continueRender, fontHandle]);
  const frame = useCurrentFrame();
  const { fps, width, height, durationInFrames } = useVideoConfig();
  const content = props.sceneContent;
  const style = sceneStyle(props.variant, content.scene);
  const contentRegion = style.contentRegions[0]!;
  const evidences = props.evidences?.map((evidence) => ({
    ...evidence,
    assetUrl: resolveEvidenceAssetUrl(evidence.assetPath)
  }));
  const animateEntrance = !evidences || evidences.length === 0;
  const entrance = animateEntrance
    ? spring({ frame, fps, config: { damping: 18, stiffness: 130, mass: 0.8 } })
    : 1;
  const entranceStyle = plateEntranceStyle(animateEntrance, entrance);
  const stateIndex = sceneStateIndex(
    content.scene,
    frame,
    durationInFrames,
    style.maxStaticFrames
  );

  return (
    <AbsoluteFill
      style={{
        width,
        height,
        background: style.palette.background,
        color: style.palette.foreground,
        fontFamily: MOTION_SANS_FONT,
        letterSpacing: 0,
        overflow: "hidden"
      }}
    >
      <div
        style={{
          position: "absolute",
          left: contentRegion.x,
          top: contentRegion.y,
          width: contentRegion.width,
          height: contentRegion.height,
          boxSizing: "border-box",
          ...entranceStyle
        }}
      >
        <SceneRenderer
          content={content}
          palette={style.palette}
          frame={frame}
          stateIndex={stateIndex}
          durationInFrames={durationInFrames}
          evidences={evidences}
          viewportWidth={contentRegion.width}
          viewportHeight={contentRegion.height}
        />
      </div>
    </AbsoluteFill>
  );
};
