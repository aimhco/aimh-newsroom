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

export type RenderableEvidence = EvidenceSpec & {
  readonly assetUrl: string;
  readonly assetWidth: number;
  readonly assetHeight: number;
};

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

export const calculateContainedRect = (
  viewportWidth: number,
  viewportHeight: number,
  assetWidth: number,
  assetHeight: number
): { readonly x: number; readonly y: number; readonly width: number; readonly height: number } => {
  if (
    ![viewportWidth, viewportHeight, assetWidth, assetHeight].every(
      (value) => Number.isFinite(value) && value > 0
    )
  ) {
    throw new Error("Contained evidence dimensions must be finite and positive");
  }
  const scale = Math.min(viewportWidth / assetWidth, viewportHeight / assetHeight);
  const width = assetWidth * scale;
  const height = assetHeight * scale;
  return {
    x: (viewportWidth - width) / 2,
    y: (viewportHeight - height) / 2,
    width,
    height
  };
};

export const calculateFocalRect = (
  containedRect: { readonly x: number; readonly y: number; readonly width: number; readonly height: number },
  focalRect: EvidenceFocalRect
): { readonly x: number; readonly y: number; readonly width: number; readonly height: number } => ({
  x: containedRect.x + containedRect.width * focalRect.x,
  y: containedRect.y + containedRect.height * focalRect.y,
  width: containedRect.width * focalRect.width,
  height: containedRect.height * focalRect.height
});

export const spotlightMaskRects = (
  viewportWidth: number,
  viewportHeight: number,
  spotlightRect: { readonly x: number; readonly y: number; readonly width: number; readonly height: number }
): readonly { readonly x: number; readonly y: number; readonly width: number; readonly height: number }[] => {
  const right = spotlightRect.x + spotlightRect.width;
  const bottom = spotlightRect.y + spotlightRect.height;
  return [
    { x: 0, y: 0, width: viewportWidth, height: spotlightRect.y },
    { x: 0, y: spotlightRect.y, width: spotlightRect.x, height: spotlightRect.height },
    {
      x: right,
      y: spotlightRect.y,
      width: viewportWidth - right,
      height: spotlightRect.height
    },
    { x: 0, y: bottom, width: viewportWidth, height: viewportHeight - bottom }
  ];
};

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
  spotlight,
  viewportWidth,
  viewportHeight
}: {
  readonly evidence: RenderableEvidence;
  readonly spotlight: boolean;
  readonly viewportWidth: number;
  readonly viewportHeight: number;
}) => {
  const containedRect = calculateContainedRect(
    viewportWidth,
    viewportHeight,
    evidence.assetWidth,
    evidence.assetHeight
  );
  const spotlightRect = calculateFocalRect(containedRect, evidence.focalRect);
  return (
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
        style={{
          position: "absolute",
          left: containedRect.x,
          top: containedRect.y,
          width: containedRect.width,
          height: containedRect.height,
          display: "block",
          objectFit: "contain"
        }}
      />
      {spotlight ? (
        <>
          {spotlightMaskRects(viewportWidth, viewportHeight, spotlightRect).map((rect, index) => (
            <div
              key={index}
              style={{
                position: "absolute",
                left: rect.x,
                top: rect.y,
                width: rect.width,
                height: rect.height,
                zIndex: 1,
                background: "rgba(255,255,255,0.4)"
              }}
            />
          ))}
          <div
            style={{
              position: "absolute",
              left: spotlightRect.x,
              top: spotlightRect.y,
              width: spotlightRect.width,
              height: spotlightRect.height,
              zIndex: 2,
              border: "6px solid #E85B50",
              boxSizing: "border-box"
            }}
          />
        </>
      ) : null}
      <CompactAttribution evidence={evidence} />
    </div>
  );
};

export const EvidenceLayout = ({
  evidence,
  spotlight,
  layoutWidth,
  layoutHeight
}: {
  readonly evidence: RenderableEvidence;
  readonly spotlight: boolean;
  readonly layoutWidth: number;
  readonly layoutHeight: number;
}) => {
  const geometry = evidencePlacementGeometry(evidence.placement);
  const sidePlacement = evidence.placement === "left" || evidence.placement === "right";
  const viewportWidth = sidePlacement ? layoutWidth * 0.64 : layoutWidth;
  const viewportHeight = sidePlacement ? layoutHeight : layoutHeight * 0.72;
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
        <EvidenceViewport
          evidence={evidence}
          spotlight={spotlight}
          viewportWidth={viewportWidth}
          viewportHeight={viewportHeight}
        />
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
