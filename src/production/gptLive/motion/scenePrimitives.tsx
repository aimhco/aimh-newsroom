import type { CSSProperties, ReactNode } from "react";
import type { SceneContent } from "../types";
import { MOTION_MONO_FONT } from "./fonts";
import type { ScenePalette } from "./sceneStyle";

export interface SceneFrameProps {
  readonly palette: ScenePalette;
  readonly frame: number;
  readonly stateIndex: number;
}

export const labelStyle = (palette: ScenePalette): CSSProperties => ({
  color: palette.muted,
  fontFamily: MOTION_MONO_FONT,
  fontSize: 26,
  fontWeight: 700,
  letterSpacing: 0,
  lineHeight: 1.2,
  textTransform: "uppercase"
});

export const factLabelStyle = (palette: ScenePalette): CSSProperties => ({
  ...labelStyle(palette),
  fontSize: 30
});

export const SourceLabel = ({
  children,
  palette
}: {
  readonly children: ReactNode;
  readonly palette: ScenePalette;
}) => (
  <div style={{ ...factLabelStyle(palette), marginTop: 24 }}>{children}</div>
);

export const Waveform = ({ palette, frame }: { palette: ScenePalette; frame: number }) => (
  <div style={{ display: "flex", alignItems: "center", gap: 9, height: 116 }}>
    {Array.from({ length: 28 }, (_, index) => {
      const height = 18 + Math.abs(Math.sin(frame * 0.2 + index * 0.82)) * 82;
      return (
        <div
          key={index}
          style={{
            width: 8,
            height,
            background: index % 5 === 0 ? palette.signal : palette.accent
          }}
        />
      );
    })}
  </div>
);

export const HostRail = ({ palette, frame }: { palette: ScenePalette; frame: number }) => (
  <div
    style={{
      position: "absolute",
      left: 42,
      top: 224,
      width: 138,
      height: 786,
      borderLeft: `2px solid ${palette.foreground}`,
      borderRight: `1px solid ${palette.muted}`,
      display: "flex",
      flexDirection: "column",
      alignItems: "center",
      justifyContent: "space-between",
      padding: "20px 0",
      boxSizing: "border-box"
    }}
  >
    <div style={{ ...labelStyle(palette), color: palette.foreground, writingMode: "vertical-rl" }}>
      AIMH / LIVE SIGNAL
    </div>
    <div style={{ display: "flex", alignItems: "center", gap: 7, height: 420 }}>
      {Array.from({ length: 5 }, (_, index) => (
        <div
          key={index}
          style={{
            width: 7,
            height: 46 + Math.abs(Math.sin(frame * 0.16 + index)) * 230,
            background: index === 2 ? palette.signal : palette.accent
          }}
        />
      ))}
    </div>
    <div
      style={{
        width: 18,
        height: 18,
        borderRadius: "50%",
        background: palette.signal,
        boxShadow: `0 0 ${18 + Math.abs(Math.sin(frame / 8)) * 18}px ${palette.signal}`
      }}
    />
  </div>
);

export const Header = ({
  palette,
  content
}: {
  readonly palette: ScenePalette;
  readonly content: SceneContent;
}) => (
  <div style={{ display: "flex", alignItems: "center", gap: 20, ...labelStyle(palette) }}>
    <span style={{ color: palette.signal }}>{content.sectionNumber}</span>
    <span>{content.header}</span>
    <span style={{ width: 110, height: 2, background: palette.muted }} />
    <span>GPT-LIVE</span>
  </div>
);

export const sourceLine = (content: SceneContent): string =>
  `SOURCE / ${content.sourceLabels.join(" + ")}`;
