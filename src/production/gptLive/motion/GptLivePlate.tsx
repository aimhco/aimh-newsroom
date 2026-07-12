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
  const entrance = evidence
    ? 1
    : spring({ frame, fps, config: { damping: 18, stiffness: 130, mass: 0.8 } });
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
          transform: `translateX(${(1 - entrance) * -28}px)`,
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
        />
      </div>
    </AbsoluteFill>
  );
};
