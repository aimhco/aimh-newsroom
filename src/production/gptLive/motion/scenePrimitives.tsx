import type { CSSProperties, ReactNode } from "react";
import { Img } from "remotion";
import type {
  EvidenceBandPlacement,
  EvidenceFocalRect,
  EvidenceSpec,
  SceneContent
} from "../types";
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

export type RenderableEvidence = EvidenceSpec & { readonly assetUrl: string };

export interface EvidencePlacementGeometry {
  readonly gridTemplateColumns: string;
  readonly gridTemplateRows: string;
  readonly bandGridArea: string;
  readonly viewportGridArea: string;
}

export const evidencePlacementGeometry = (
  placement: EvidenceBandPlacement
): EvidencePlacementGeometry => {
  switch (placement) {
    case "left":
      return {
        gridTemplateColumns: "36% 64%",
        gridTemplateRows: "100%",
        bandGridArea: "1 / 1",
        viewportGridArea: "1 / 2"
      };
    case "right":
      return {
        gridTemplateColumns: "64% 36%",
        gridTemplateRows: "100%",
        bandGridArea: "1 / 2",
        viewportGridArea: "1 / 1"
      };
    case "top":
      return {
        gridTemplateColumns: "100%",
        gridTemplateRows: "28% 72%",
        bandGridArea: "1 / 1",
        viewportGridArea: "2 / 1"
      };
    case "bottom":
      return {
        gridTemplateColumns: "100%",
        gridTemplateRows: "72% 28%",
        bandGridArea: "2 / 1",
        viewportGridArea: "1 / 1"
      };
  }
};

const percentage = (value: number): string => `${Number((value * 100).toFixed(6))}%`;

export const focalRectStyle = (
  focalRect: EvidenceFocalRect
): Pick<CSSProperties, "left" | "top" | "width" | "height"> => ({
  left: percentage(focalRect.x),
  top: percentage(focalRect.y),
  width: percentage(focalRect.width),
  height: percentage(focalRect.height)
});

export const EditorialBand = ({ evidence }: { readonly evidence: EvidenceSpec }) => {
  const isSideBand = evidence.placement === "left" || evidence.placement === "right";
  return (
    <div
      style={{
        width: "100%",
        height: "100%",
        background: "#FFFFFF",
        color: "#111315",
        padding: isSideBand ? "64px 54px" : "26px 54px",
        display: "flex",
        flexDirection: "column",
        justifyContent: "center",
        boxSizing: "border-box",
        borderRight: evidence.placement === "left" ? "4px solid #111315" : undefined,
        borderLeft: evidence.placement === "right" ? "4px solid #111315" : undefined,
        borderBottom: evidence.placement === "top" ? "4px solid #111315" : undefined,
        borderTop: evidence.placement === "bottom" ? "4px solid #111315" : undefined
      }}
    >
      <div
        style={{
          color: "#E85B50",
          fontFamily: MOTION_MONO_FONT,
          fontSize: isSideBand ? 24 : 20,
          fontWeight: 800,
          lineHeight: 1.1
        }}
      >
        THE EVIDENCE
      </div>
      <div
        style={{
          fontSize: isSideBand ? 54 : 40,
          lineHeight: 1.04,
          fontWeight: 850,
          marginTop: isSideBand ? 24 : 12
        }}
      >
        {evidence.takeaway}
      </div>
      <div
        style={{
          color: "#4E5552",
          fontSize: isSideBand ? 28 : 24,
          lineHeight: 1.25,
          marginTop: isSideBand ? 28 : 12
        }}
      >
        {evidence.detail}
      </div>
    </div>
  );
};

export const CompactAttribution = ({ evidence }: { readonly evidence: EvidenceSpec }) => (
  <div
    style={{
      position: "absolute",
      right: 24,
      bottom: 22,
      zIndex: 2,
      maxWidth: "calc(100% - 48px)",
      background: "#111315",
      color: "#FFFFFF",
      padding: "12px 16px",
      boxSizing: "border-box",
      fontFamily: MOTION_MONO_FONT,
      fontSize: 22,
      fontWeight: 800,
      lineHeight: 1.12
    }}
  >
    <div style={{ fontSize: 18, color: "#C7CECA" }}>{evidence.publisher}</div>
    <div style={{ marginTop: 4 }}>{evidence.displayUrl}</div>
  </div>
);

export const EvidenceViewport = ({
  evidence,
  spotlight
}: {
  readonly evidence: RenderableEvidence;
  readonly spotlight: boolean;
}) => (
  <div
    style={{
      position: "relative",
      width: "100%",
      height: "100%",
      overflow: "hidden",
      background: "#F2F3F1"
    }}
  >
    <Img
      src={evidence.assetUrl}
      style={{ width: "100%", height: "100%", display: "block", objectFit: "contain" }}
    />
    {spotlight ? (
      <div
        style={{
          position: "absolute",
          ...focalRectStyle(evidence.focalRect),
          zIndex: 1,
          border: "6px solid #E85B50",
          boxShadow: "0 0 0 9999px rgba(255,255,255,0.4)",
          boxSizing: "border-box"
        }}
      />
    ) : null}
    <CompactAttribution evidence={evidence} />
  </div>
);

export const EvidenceLayout = ({
  evidence,
  spotlight
}: {
  readonly evidence: RenderableEvidence;
  readonly spotlight: boolean;
}) => {
  const geometry = evidencePlacementGeometry(evidence.placement);
  return (
    <div
      style={{
        position: "relative",
        width: "100%",
        height: "100%",
        display: "grid",
        gridTemplateColumns: geometry.gridTemplateColumns,
        gridTemplateRows: geometry.gridTemplateRows
      }}
    >
      <div style={{ gridArea: geometry.bandGridArea, minWidth: 0, minHeight: 0 }}>
        <EditorialBand evidence={evidence} />
      </div>
      <div style={{ gridArea: geometry.viewportGridArea, minWidth: 0, minHeight: 0 }}>
        <EvidenceViewport evidence={evidence} spotlight={spotlight} />
      </div>
    </div>
  );
};

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
