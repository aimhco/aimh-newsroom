import { interpolate } from "remotion";
import type { EvidenceSceneContent, UseCasesSceneContent } from "../../types";
import {
  factLabelStyle,
  Header,
  type SceneFrameProps,
  SourceLabel,
  sourceLine
} from "../scenePrimitives";

export const UseCasesScene = ({
  palette,
  stateIndex,
  content
}: SceneFrameProps & { readonly content: UseCasesSceneContent }) => {
  const active = stateIndex;
  return (
    <div>
      <Header palette={palette} content={content} />
      <div style={{ marginTop: 52, display: "grid", gridTemplateColumns: "1.3fr 0.7fr", gap: 68 }}>
        <div>
          <div style={{ ...factLabelStyle(palette), color: palette.accent }}>
            {content.progressLabel} / {active + 1} OF {content.items.length}
          </div>
          <div style={{ marginTop: 34, fontSize: 104, lineHeight: 0.96, fontWeight: 880, maxWidth: 950 }}>
            {content.items[active]!.label}
          </div>
          <div style={{ marginTop: 30, fontSize: 40, lineHeight: 1.2, maxWidth: 900 }}>
            {content.items[active]!.detail}
          </div>
        </div>
        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 14 }}>
          {content.items.map(({ number, label }, index) => (
            <div
              key={number}
              style={{
                minHeight: 150,
                borderTop: `5px solid ${index === active ? palette.signal : palette.muted}`,
                padding: "16px 4px",
                opacity: index === active ? 1 : 0.38,
                boxSizing: "border-box"
              }}
            >
              <div style={{ ...factLabelStyle(palette), color: index === active ? palette.signal : palette.muted }}>
                {number}
              </div>
              <div style={{ fontSize: 30, lineHeight: 1.12, fontWeight: 800, marginTop: 10 }}>{label}</div>
            </div>
          ))}
        </div>
      </div>
      <SourceLabel palette={palette}>{sourceLine(content)}</SourceLabel>
    </div>
  );
};

export const EvidenceScene = ({
  palette,
  frame,
  stateIndex,
  content
}: SceneFrameProps & { readonly content: EvidenceSceneContent }) => {
  const reveal = interpolate(frame, [0, 80], [0, 1], { extrapolateRight: "clamp" });
  return (
    <div>
      <Header palette={palette} content={content} />
      <div style={{ marginTop: 62, display: "grid", gridTemplateColumns: "1.1fr 0.9fr", gap: 66 }}>
        <div
          style={{
            borderTop: `8px solid ${palette.signal}`,
            paddingTop: 26,
            opacity: stateIndex === 0 ? 1 : 0.72,
            transform: `translateY(${stateIndex === 0 ? 0 : 10}px)`
          }}
        >
          <div style={{ ...factLabelStyle(palette), color: palette.signal }}>{content.worldCupAttribution}</div>
          <div style={{ marginTop: 24, fontSize: 60, lineHeight: 1.04, fontWeight: 850 }}>
            {content.worldCupHeadline}
          </div>
          <div style={{ marginTop: 24, fontSize: 32, lineHeight: 1.28, maxWidth: 760 }}>
            {content.worldCupDetail}
          </div>
          <SourceLabel palette={palette}>SOURCE / {content.sourceLabels[0]}</SourceLabel>
        </div>
        <div
          style={{
            borderTop: `8px solid ${palette.accent}`,
            paddingTop: 26,
            opacity: reveal * (stateIndex === 1 ? 1 : 0.72),
            transform: `translateY(${(1 - reveal) * 28 + (stateIndex === 1 ? 0 : 10)}px)`
          }}
        >
          <div style={{ ...factLabelStyle(palette), color: palette.accent }}>
            {content.benchmarkAttribution}
          </div>
          <div style={{ marginTop: 20, fontSize: 43, lineHeight: 1.02, fontWeight: 850 }}>
            {content.benchmarkComparison}
          </div>
          <div style={{ marginTop: 12, fontSize: 40, lineHeight: 1, fontWeight: 850, color: palette.accent }}>
            {content.benchmarkName}
          </div>
          <div style={{ marginTop: 20, fontSize: 30, lineHeight: 1.25 }}>
            {content.benchmarkStatement}
          </div>
          <div style={{ marginTop: 16, fontSize: 34, lineHeight: 1.15, fontWeight: 800, color: palette.signal }}>
            {content.qualification}
          </div>
          <SourceLabel palette={palette}>SOURCE / {content.sourceLabels[1]}</SourceLabel>
        </div>
      </div>
    </div>
  );
};
