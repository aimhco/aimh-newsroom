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
import { evidenceStage, type EvidenceStage } from "./evidenceStages";
import { MOTION_SANS_FONT } from "./fonts";
import { sceneStyle, type SceneRect } from "./sceneStyle";

export const evidencePlateLayout = (
  stage: EvidenceStage,
  frameRect: SceneRect,
  contentRect: SceneRect
): {
  readonly rect: SceneRect;
  readonly animateEntrance: boolean;
  readonly maskReservedTopRight: boolean;
} => ({
  rect: stage === "establish" ? frameRect : contentRect,
  animateEntrance: false,
  maskReservedTopRight: stage === "establish"
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
  const evidence =
    props.evidence?.playbackDecision === "captured_source"
      ? { ...props.evidence, assetUrl: resolveEvidenceAssetUrl(props.evidence.assetPath) }
      : undefined;
  const frameRect = { x: 0, y: 0, width, height };
  const plateLayout = evidence
    ? evidencePlateLayout(evidenceStage(frame, durationInFrames), frameRect, contentRegion)
    : { rect: contentRegion, animateEntrance: true, maskReservedTopRight: false };
  const entrance = plateLayout.animateEntrance
    ? spring({ frame, fps, config: { damping: 18, stiffness: 130, mass: 0.8 } })
    : 1;
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
          left: plateLayout.rect.x,
          top: plateLayout.rect.y,
          width: plateLayout.rect.width,
          height: plateLayout.rect.height,
          boxSizing: "border-box",
          transform: plateLayout.animateEntrance
            ? `translateX(${(1 - entrance) * -28}px)`
            : "none",
          opacity: entrance
        }}
      >
        <SceneRenderer
          content={content}
          palette={style.palette}
          frame={frame}
          stateIndex={stateIndex}
          durationInFrames={durationInFrames}
          evidence={evidence}
          viewportWidth={plateLayout.rect.width}
          viewportHeight={plateLayout.rect.height}
        />
      </div>
      {plateLayout.maskReservedTopRight ? (
        <div
          style={{
            position: "absolute",
            left: style.reservedTopRight.x,
            top: style.reservedTopRight.y,
            width: style.reservedTopRight.width,
            height: style.reservedTopRight.height,
            zIndex: 3,
            background: style.palette.background
          }}
        />
      ) : null}
    </AbsoluteFill>
  );
};
