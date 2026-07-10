import { useEffect, useState } from "react";
import {
  AbsoluteFill,
  Sequence,
  spring,
  useCurrentFrame,
  useDelayRender,
  useVideoConfig
} from "remotion";
import type { GptLivePlateProps } from "./Root";
import { SceneRenderer } from "./SceneRenderer";
import { sceneStateIndex } from "./beatState";
import { MOTION_SANS_FONT } from "./fonts";
import { HostRail, labelStyle } from "./scenePrimitives";
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
  const entrance = spring({ frame, fps, config: { damping: 18, stiffness: 130, mass: 0.8 } });
  const contentLeft = style.persistentHost ? 250 : 72;
  const contentWidth = style.persistentHost ? 1400 : 1580;
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
          left: contentLeft,
          top: 90,
          width: contentWidth,
          height: 900,
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
        />
      </div>
      {style.persistentHost ? <HostRail palette={style.palette} frame={frame} /> : null}
      <Sequence from={Math.min(45, Math.max(0, durationInFrames - 1))}>
        <div
          style={{
            position: "absolute",
            left: contentLeft,
            bottom: 28,
            width: contentWidth,
            display: "flex",
            justifyContent: "space-between",
            ...labelStyle(style.palette)
          }}
        >
          <span>{content.narrationId.replace("narration_", "PLATE / ")}</span>
          <span>{style.persistentHost ? "AIMH VISUAL HOST" : "DYNAMIC EDITORIAL"}</span>
        </div>
      </Sequence>
    </AbsoluteFill>
  );
};
