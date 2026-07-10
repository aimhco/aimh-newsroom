import { Sequence, interpolate } from "remotion";
import type { FullDuplexSceneContent, HookSceneContent } from "../../types";
import {
  factLabelStyle,
  Header,
  type SceneFrameProps,
  SourceLabel,
  sourceLine,
  Waveform
} from "../scenePrimitives";

export const HookScene = ({
  palette,
  frame,
  stateIndex,
  content
}: SceneFrameProps & { readonly content: HookSceneContent }) => {
  const shift = interpolate(frame, [0, 90], [48, 0], { extrapolateRight: "clamp" });
  return (
    <div>
      <Header palette={palette} content={content} />
      <div style={{ marginTop: 74, transform: `translateY(${shift}px)` }}>
        <div style={{ display: "flex", gap: 24, alignItems: "baseline", opacity: stateIndex === 0 ? 1 : 0.68 }}>
          <span style={{ ...factLabelStyle(palette), color: palette.signal }}>{content.listeningLabel}</span>
          <span style={{ fontSize: 112, fontWeight: 850, lineHeight: 0.95 }}>{content.listeningValue}</span>
        </div>
        <div style={{ display: "flex", gap: 24, alignItems: "baseline", marginTop: 26, opacity: stateIndex === 1 ? 1 : 0.68 }}>
          <span style={{ ...factLabelStyle(palette), color: palette.accent }}>{content.speakingLabel}</span>
          <span style={{ fontSize: 112, fontWeight: 850, lineHeight: 0.95 }}>{content.speakingValue}</span>
        </div>
      </div>
      <div style={{ marginTop: 62, display: "flex", alignItems: "center", gap: 34 }}>
        <div style={{ ...factLabelStyle(palette), color: palette.foreground }}>{content.inputLabel}</div>
        <Waveform palette={palette} frame={frame} />
        <div style={{ fontSize: 44, color: palette.support, fontWeight: 750 }}>{content.simultaneousLabel}</div>
      </div>
      <SourceLabel palette={palette}>{sourceLine(content)}</SourceLabel>
    </div>
  );
};

export const FullDuplexScene = ({
  palette,
  frame,
  stateIndex,
  durationInFrames,
  content
}: SceneFrameProps & {
  readonly durationInFrames: number;
  readonly content: FullDuplexSceneContent;
}) => {
  const split = stateIndex === 0 ? 0 : 1;
  const interruptionAt = Math.max(1, Math.round(durationInFrames * 0.58));
  return (
    <div>
      <Header palette={palette} content={content} />
      <div style={{ marginTop: 68, display: "grid", gridTemplateColumns: "0.8fr 1.6fr", gap: 76 }}>
        <div>
          <div style={{ ...factLabelStyle(palette), marginBottom: 24 }}>{content.legacyLabel}</div>
          {content.legacySteps.map((item, index) => (
            <div
              key={item}
              style={{
                height: 82,
                marginBottom: 14,
                border: `2px solid ${palette.muted}`,
                display: "flex",
                alignItems: "center",
                padding: "0 24px",
                boxSizing: "border-box",
                opacity: 1 - split * (0.3 + index * 0.15),
                transform: `translateX(${-split * index * 22}px)`,
                fontSize: 30,
                fontWeight: 800
              }}
            >
              {item}
            </div>
          ))}
        </div>
        <div>
          <div style={{ ...factLabelStyle(palette), color: palette.accent, marginBottom: 24 }}>
            {content.concurrentLabel}
          </div>
          {content.tracks.map((item, index) => (
            <div key={item} style={{ marginBottom: 30 }}>
              <div style={{ fontSize: 52, fontWeight: 850, color: index ? palette.signal : palette.accent }}>
                {item}
              </div>
              <div style={{ marginTop: 12, width: "100%", height: 20, background: palette.muted }}>
                <div
                  style={{
                    width: `${38 + ((frame * (index + 1)) % 62)}%`,
                    height: "100%",
                    background: index ? palette.signal : palette.accent
                  }}
                />
              </div>
            </div>
          ))}
          <div style={{ fontSize: 44, lineHeight: 1.15, fontWeight: 720, maxWidth: 750 }}>
            {content.headline}
          </div>
        </div>
      </div>
      <Sequence from={Math.min(interruptionAt, Math.max(0, durationInFrames - 1))}>
        {stateIndex === 2 ? (
          <div
            style={{
              position: "absolute",
              left: 940,
              top: 670,
              borderLeft: `12px solid ${palette.support}`,
              padding: "20px 26px",
              background: palette.foreground,
              color: palette.background,
              fontSize: 32,
              fontWeight: 900
            }}
          >
            {content.interruptionLabel}
          </div>
        ) : null}
      </Sequence>
      <SourceLabel palette={palette}>{sourceLine(content)}</SourceLabel>
    </div>
  );
};
