import { interpolate } from "remotion";
import type {
  AvailabilitySceneContent,
  CtaSceneContent,
  FutureSceneContent
} from "../../types";
import {
  factLabelStyle,
  Header,
  type SceneFrameProps,
  SourceLabel,
  sourceLine
} from "../scenePrimitives";

export const AvailabilityScene = ({
  palette,
  stateIndex,
  content
}: SceneFrameProps & { readonly content: AvailabilitySceneContent }) => (
  <div>
    <Header palette={palette} content={content} />
    <div style={{ marginTop: 46, fontSize: 64, lineHeight: 1, fontWeight: 880 }}>{content.headline}</div>
    <div style={{ marginTop: 34 }}>
      {content.tiers.map(({ label, value }, index) => (
        <div
          key={label}
          style={{
            display: "grid",
            gridTemplateColumns: "340px 1fr",
            height: 92,
            alignItems: "center",
            borderTop: `2px solid ${palette.muted}`,
            color: index === stateIndex ? palette.foreground : palette.muted
          }}
        >
          <div style={{ ...factLabelStyle(palette), color: index === stateIndex ? palette.signal : palette.muted }}>
            {label}
          </div>
          <div style={{ fontSize: 40, fontWeight: 850 }}>{value}</div>
        </div>
      ))}
    </div>
    <div style={{ marginTop: 26, borderTop: `5px solid ${palette.signal}`, paddingTop: 18 }}>
      <div style={{ ...factLabelStyle(palette), color: palette.signal }}>{content.limitsLabel}</div>
      <div style={{ marginTop: 12, fontSize: 30, lineHeight: 1.2, fontWeight: 720 }}>
        {content.limits.join(" · ")}
      </div>
    </div>
    <SourceLabel palette={palette}>{sourceLine(content)}</SourceLabel>
  </div>
);

export const FutureScene = ({
  palette,
  frame,
  stateIndex,
  content
}: SceneFrameProps & { readonly content: FutureSceneContent }) => (
  <div>
    <Header palette={palette} content={content} />
    <div style={{ marginTop: 74, display: "flex", alignItems: "center", gap: 20 }}>
      {content.flows.map(({ from, to }, index) => {
        const pulse = interpolate((frame + index * 25) % 120, [0, 60, 120], [0.25, 1, 0.25]);
        return (
          <div key={`${from}-${to}`} style={{ display: "flex", alignItems: "center", gap: 20 }}>
            <div
              style={{
                width: 410,
                borderTop: `7px solid ${index === stateIndex ? palette.signal : palette.accent}`,
                paddingTop: 24,
                opacity: index === stateIndex ? 1 : 0.62
              }}
            >
              <div style={{ ...factLabelStyle(palette), color: palette.muted }}>{`0${index + 1}`}</div>
              <div style={{ marginTop: 16, fontSize: 56, fontWeight: 880 }}>{from}</div>
              <div style={{ marginTop: 18, height: 13, background: palette.muted }}>
                <div style={{ width: `${pulse * 100}%`, height: "100%", background: palette.signal }} />
              </div>
              <div style={{ marginTop: 18, fontSize: 56, fontWeight: 880, color: palette.signal }}>{to}</div>
            </div>
            {index < content.flows.length - 1 ? <div style={{ fontSize: 44, color: palette.muted }}>&gt;</div> : null}
          </div>
        );
      })}
    </div>
    <div style={{ marginTop: 66, fontSize: 35, lineHeight: 1.25, maxWidth: 1300 }}>{content.summary}</div>
    <SourceLabel palette={palette}>{sourceLine(content)}</SourceLabel>
  </div>
);

export const CtaScene = ({
  palette,
  stateIndex,
  content
}: SceneFrameProps & { readonly content: CtaSceneContent }) => (
  <div>
    <Header palette={palette} content={content} />
    <div style={{ marginTop: 64, maxWidth: 1370, fontSize: 96, lineHeight: 0.98, fontWeight: 900 }}>
      {content.headline}
    </div>
    <div style={{ marginTop: 52, display: "flex", gap: 14 }}>
      {content.prompts.map((prompt, index) => (
        <div
          key={prompt}
          style={{
            width: 445,
            minHeight: 108,
            borderTop: `5px solid ${index === stateIndex ? palette.accent : palette.muted}`,
            paddingTop: 16,
            color: index === stateIndex ? palette.foreground : palette.muted,
            fontSize: 30,
            fontWeight: 820,
            lineHeight: 1.15
          }}
        >
          {prompt}
        </div>
      ))}
    </div>
    <div style={{ marginTop: 42, fontSize: 35, lineHeight: 1.25, fontWeight: 720 }}>
      {content.audiencePrompt}
    </div>
    <SourceLabel palette={palette}>{sourceLine(content)}</SourceLabel>
  </div>
);
