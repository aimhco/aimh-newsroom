import type { CSSProperties } from "react";
import {
  AbsoluteFill,
  Img,
  interpolate,
  OffthreadVideo,
  Sequence,
  staticFile,
  useCurrentFrame,
  useVideoConfig
} from "remotion";
import { MOTION_MONO_FONT, MOTION_SANS_FONT } from "../../gptLive/motion/fonts";
import { zoomTransformAtFrame } from "./timing";
import type {
  EvidenceBeat,
  MotionEvidenceBeat,
  NewsroomEvidencePlateProps,
  StillEvidenceBeat
} from "./types";

const sourceChipStyle: CSSProperties = {
  background: "rgba(17, 19, 21, 0.92)",
  color: "#FFFFFF",
  fontFamily: MOTION_MONO_FONT,
  fontSize: 22,
  fontWeight: 800,
  lineHeight: 1.15,
  padding: "13px 18px",
  maxWidth: 760
};

const BeatChrome = ({ beat, seriesLabel }: {
  readonly beat: EvidenceBeat;
  readonly seriesLabel: string;
}) => (
  <>
    <div
      style={{
        position: "absolute",
        left: 32,
        top: 28,
        zIndex: 5,
        display: "flex",
        alignItems: "center",
        gap: 14,
        maxWidth: 1300
      }}
    >
      <div
        style={{
          background: "#E85B50",
          color: "#FFFFFF",
          fontFamily: MOTION_MONO_FONT,
          fontSize: 20,
          fontWeight: 900,
          padding: "10px 13px"
        }}
      >
        {seriesLabel}
      </div>
      <div
        style={{
          background: "rgba(255,255,255,0.94)",
          color: "#111315",
          fontFamily: MOTION_SANS_FONT,
          fontSize: 36,
          fontWeight: 850,
          lineHeight: 1.08,
          padding: "12px 18px"
        }}
      >
        {beat.headline}
      </div>
    </div>
    <div style={{ position: "absolute", left: 32, bottom: 28, zIndex: 5, ...sourceChipStyle }}>
      SOURCE · {beat.sourceLabel}
    </div>
  </>
);

const BeatFade = ({ children, durationFrames }: {
  readonly children: React.ReactNode;
  readonly durationFrames: number;
}) => {
  const frame = useCurrentFrame();
  const fadeFrames = Math.min(8, Math.max(1, Math.floor(durationFrames / 4)));
  const opacity = Math.min(
    interpolate(frame, [0, fadeFrames], [0, 1], { extrapolateLeft: "clamp", extrapolateRight: "clamp" }),
    interpolate(
      frame,
      [Math.max(0, durationFrames - fadeFrames - 1), durationFrames - 1],
      [1, 0],
      { extrapolateLeft: "clamp", extrapolateRight: "clamp" }
    )
  );
  return <AbsoluteFill style={{ opacity }}>{children}</AbsoluteFill>;
};

const MotionBeat = ({ beat }: { readonly beat: MotionEvidenceBeat }) => (
  <AbsoluteFill style={{ background: "#111315" }}>
    <OffthreadVideo
      src={staticFile(beat.assetPath)}
      muted
      startFrom={beat.startFromFrames ?? 0}
      style={{ width: "100%", height: "100%", objectFit: beat.fit ?? "cover" }}
    />
  </AbsoluteFill>
);

const isMotionBeat = (beat: EvidenceBeat): beat is MotionEvidenceBeat =>
  beat.kind === "video" || beat.kind === "interactive_capture";

const StillBeat = ({ beat }: { readonly beat: StillEvidenceBeat }) => {
  const frame = useCurrentFrame();
  const zoom =
    beat.kind === "source_zoom"
      ? zoomTransformAtFrame({ frame, durationFrames: beat.durationFrames, focalRect: beat.focalRect })
      : { scale: 1, translateXPercent: 0, translateYPercent: 0 };
  return (
    <AbsoluteFill style={{ background: "#F2F3F1", overflow: "hidden" }}>
      <Img
        src={staticFile(beat.assetPath)}
        style={{
          width: "100%",
          height: "100%",
          objectFit: beat.fit ?? "contain",
          transformOrigin: "center center",
          transform: `translate(${zoom.translateXPercent}%, ${zoom.translateYPercent}%) scale(${zoom.scale})`
        }}
      />
    </AbsoluteFill>
  );
};

const EvidenceBeatView = ({ beat, seriesLabel }: {
  readonly beat: EvidenceBeat;
  readonly seriesLabel: string;
}) => (
  <BeatFade durationFrames={beat.durationFrames}>
    {isMotionBeat(beat) ? (
      <MotionBeat beat={beat} />
    ) : (
      <StillBeat beat={beat} />
    )}
    <BeatChrome beat={beat} seriesLabel={seriesLabel} />
  </BeatFade>
);

export const NewsroomEvidencePlate = (props: NewsroomEvidencePlateProps) => {
  const { width, height } = useVideoConfig();
  let cursor = 0;
  return (
    <AbsoluteFill
      style={{
        width,
        height,
        background: "#111315",
        color: "#111315",
        fontFamily: MOTION_SANS_FONT,
        overflow: "hidden"
      }}
    >
      {props.beats.map((beat) => {
        const from = cursor;
        cursor += beat.durationFrames;
        return (
          <Sequence key={beat.id} from={from} durationInFrames={beat.durationFrames} premountFor={30}>
            <EvidenceBeatView beat={beat} seriesLabel={props.seriesLabel} />
          </Sequence>
        );
      })}
    </AbsoluteFill>
  );
};
