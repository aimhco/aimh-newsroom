import type { CSSProperties, ReactNode } from "react";
import {
  AbsoluteFill,
  Sequence,
  interpolate,
  spring,
  useCurrentFrame,
  useVideoConfig
} from "remotion";
import type { GptLivePlateProps } from "./Root";
import {
  EVIDENCE_BENCHMARK_COPY,
  sceneStyle,
  type ScenePalette
} from "./sceneStyle";

const FONT = "Inter, ui-sans-serif, -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif";
const MONO = "'SFMono-Regular', Consolas, 'Liberation Mono', monospace";

const labelStyle = (palette: ScenePalette): CSSProperties => ({
  color: palette.muted,
  fontFamily: MONO,
  fontSize: 23,
  fontWeight: 700,
  letterSpacing: 0,
  lineHeight: 1.2,
  textTransform: "uppercase"
});

const SourceLabel = ({ children, palette }: { children: ReactNode; palette: ScenePalette }) => (
  <div style={{ ...labelStyle(palette), marginTop: 28 }}>{children}</div>
);

const Waveform = ({
  palette,
  frame,
  quiet = false
}: {
  palette: ScenePalette;
  frame: number;
  quiet?: boolean;
}) => (
  <div style={{ display: "flex", alignItems: "center", gap: 9, height: 116 }}>
    {Array.from({ length: 28 }, (_, index) => {
      const wave = Math.sin(frame * 0.2 + index * 0.82);
      const height = 18 + Math.abs(wave) * (quiet ? 44 : 82);
      return (
        <div
          key={index}
          style={{
            width: 8,
            height,
            background: index % 5 === 0 ? palette.signal : palette.accent,
            opacity: quiet ? 0.68 : 1
          }}
        />
      );
    })}
  </div>
);

const HostRail = ({ palette, frame }: { palette: ScenePalette; frame: number }) => (
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

const Header = ({
  palette,
  scene,
  index
}: {
  palette: ScenePalette;
  scene: string;
  index: number;
}) => (
  <div style={{ display: "flex", alignItems: "center", gap: 20, ...labelStyle(palette) }}>
    <span style={{ color: palette.signal }}>0{index}</span>
    <span>{scene.replaceAll("_", " ")}</span>
    <span style={{ width: 110, height: 2, background: palette.muted }} />
    <span>GPT-LIVE</span>
  </div>
);

const HookScene = ({ palette, frame }: { palette: ScenePalette; frame: number }) => {
  const shift = interpolate(frame, [0, 90], [48, 0], { extrapolateRight: "clamp" });
  return (
    <div>
      <Header palette={palette} scene="live translation" index={1} />
      <div style={{ marginTop: 88, transform: `translateY(${shift}px)` }}>
        <div style={{ display: "flex", gap: 24, alignItems: "baseline" }}>
          <span style={{ ...labelStyle(palette), color: palette.signal }}>LISTENING</span>
          <span style={{ fontSize: 116, fontWeight: 850, lineHeight: 0.95 }}>IN FRENCH</span>
        </div>
        <div style={{ display: "flex", gap: 24, alignItems: "baseline", marginTop: 30 }}>
          <span style={{ ...labelStyle(palette), color: palette.accent }}>SPEAKING</span>
          <span style={{ fontSize: 116, fontWeight: 850, lineHeight: 0.95 }}>IN ENGLISH</span>
        </div>
      </div>
      <div style={{ marginTop: 78, display: "flex", alignItems: "center", gap: 34 }}>
        <div style={{ ...labelStyle(palette), color: palette.foreground }}>LIVE INPUT</div>
        <Waveform palette={palette} frame={frame} />
        <div style={{ fontSize: 46, color: palette.support, fontWeight: 750 }}>AT THE SAME TIME</div>
      </div>
      <SourceLabel palette={palette}>CAPABILITY / OPENAI + CHATGPT VOICE</SourceLabel>
    </div>
  );
};

const FullDuplexScene = ({
  palette,
  frame,
  durationInFrames
}: {
  palette: ScenePalette;
  frame: number;
  durationInFrames: number;
}) => {
  const split = interpolate(frame, [0, durationInFrames * 0.42], [0, 1], {
    extrapolateRight: "clamp"
  });
  const interruptionAt = Math.max(1, Math.round(durationInFrames * 0.58));
  return (
    <div>
      <Header palette={palette} scene="full duplex" index={2} />
      <div style={{ marginTop: 82, display: "grid", gridTemplateColumns: "0.8fr 1.6fr", gap: 76 }}>
        <div>
          <div style={{ ...labelStyle(palette), marginBottom: 28 }}>OLD / WALKIE-TALKIE QUEUE</div>
          {["YOU SPEAK", "WAIT", "MODEL SPEAKS"].map((item, index) => (
            <div
              key={item}
              style={{
                height: 84,
                marginBottom: 14,
                border: `2px solid ${palette.muted}`,
                display: "flex",
                alignItems: "center",
                padding: "0 24px",
                boxSizing: "border-box",
                opacity: 1 - split * (0.3 + index * 0.15),
                transform: `translateX(${-split * index * 22}px)`,
                fontSize: 28,
                fontWeight: 800
              }}
            >
              {item}
            </div>
          ))}
        </div>
        <div>
          <div style={{ ...labelStyle(palette), color: palette.accent, marginBottom: 28 }}>
            NOW / CONCURRENT TRACKS
          </div>
          {["LISTEN", "SPEAK"].map((item, index) => (
            <div key={item} style={{ marginBottom: 34 }}>
              <div style={{ fontSize: 54, fontWeight: 850, color: index ? palette.signal : palette.accent }}>
                {item}
              </div>
              <div style={{ marginTop: 13, width: "100%", height: 20, background: palette.muted }}>
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
          <div style={{ fontSize: 46, lineHeight: 1.15, fontWeight: 720, maxWidth: 750 }}>
            LISTENING AND SPEAKING CAN OVERLAP.
          </div>
        </div>
      </div>
      <Sequence from={interruptionAt}>
        <div
          style={{
            position: "absolute",
            left: 940,
            top: 684,
            borderLeft: `12px solid ${palette.support}`,
            padding: "20px 26px",
            background: palette.foreground,
            color: palette.background,
            fontSize: 34,
            fontWeight: 900
          }}
        >
          INTERRUPTION ACCEPTED / COURSE CORRECTED
        </div>
      </Sequence>
      <SourceLabel palette={palette}>CAPABILITY / OPENAI + CHATGPT VOICE</SourceLabel>
    </div>
  );
};

const USE_CASES = [
  ["01", "LIVE TRANSLATION", "Language shifts without stopping."],
  ["02", "LANGUAGE ROLE-PLAY", "Practice the exchange, not the prompt."],
  ["03", "MESSY IDEA", "Think aloud before the structure exists."],
  ["04", "INTERRUPT + SEARCH", "Correct course and follow the thread."],
  ["05", "VISUAL CARDS", "Voice can surface something you can see."],
  ["06", "DEEPER WORK", "Keep talking while background work runs."]
] as const;

const UseCasesScene = ({ palette, frame }: { palette: ScenePalette; frame: number }) => {
  const active = Math.floor(frame / 90) % USE_CASES.length;
  return (
    <div>
      <Header palette={palette} scene="six things to try" index={3} />
      <div style={{ marginTop: 64, display: "grid", gridTemplateColumns: "1.3fr 0.7fr", gap: 68 }}>
        <div>
          <div style={{ ...labelStyle(palette), color: palette.accent }}>FAST REVEAL / {active + 1} OF 6</div>
          <div style={{ marginTop: 40, fontSize: 112, lineHeight: 0.96, fontWeight: 880, maxWidth: 950 }}>
            {USE_CASES[active]![1]}
          </div>
          <div style={{ marginTop: 36, fontSize: 42, lineHeight: 1.2, maxWidth: 900 }}>
            {USE_CASES[active]![2]}
          </div>
        </div>
        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 14 }}>
          {USE_CASES.map(([number, title], index) => (
            <div
              key={number}
              style={{
                minHeight: 132,
                borderTop: `5px solid ${index === active ? palette.signal : palette.muted}`,
                padding: "18px 4px",
                opacity: index === active ? 1 : 0.38,
                boxSizing: "border-box"
              }}
            >
              <div style={{ ...labelStyle(palette), color: index === active ? palette.signal : palette.muted }}>
                {number}
              </div>
              <div style={{ fontSize: 23, lineHeight: 1.15, fontWeight: 800, marginTop: 12 }}>{title}</div>
            </div>
          ))}
        </div>
      </div>
      <SourceLabel palette={palette}>CAPABILITIES / OPENAI PRODUCT MATERIALS</SourceLabel>
    </div>
  );
};

const EvidenceScene = ({ palette, frame }: { palette: ScenePalette; frame: number }) => {
  const reveal = interpolate(frame, [0, 80], [0, 1], { extrapolateRight: "clamp" });
  const activeColumn = Math.floor(frame / 150) % 2;
  return (
    <div>
      <Header palette={palette} scene="reported evidence" index={4} />
      <div style={{ marginTop: 76, display: "grid", gridTemplateColumns: "1.1fr 0.9fr", gap: 66 }}>
        <div
          style={{
            borderTop: `8px solid ${palette.signal}`,
            paddingTop: 30,
            opacity: activeColumn === 0 ? 1 : 0.72,
            transform: `translateY(${activeColumn === 0 ? 0 : 10}px)`
          }}
        >
          <div style={{ ...labelStyle(palette), color: palette.signal }}>TOM'S GUIDE REPORTED</div>
          <div style={{ marginTop: 28, fontSize: 65, lineHeight: 1.04, fontWeight: 850 }}>
            CONTINUOUS ENGLISH INTERPRETATION
          </div>
          <div style={{ marginTop: 28, fontSize: 31, lineHeight: 1.3, maxWidth: 760 }}>
            Over rapid Spanish World Cup commentary in the publication's hands-on test.
          </div>
          <SourceLabel palette={palette}>SOURCE / TOM'S GUIDE</SourceLabel>
        </div>
        <div
          style={{
            borderTop: `8px solid ${palette.accent}`,
            paddingTop: 30,
            opacity: reveal * (activeColumn === 1 ? 1 : 0.72),
            transform: `translateY(${(1 - reveal) * 28 + (activeColumn === 1 ? 0 : 10)}px)`
          }}
        >
          <div style={{ ...labelStyle(palette), color: palette.accent }}>
            {EVIDENCE_BENCHMARK_COPY.attribution}
          </div>
          <div style={{ marginTop: 24, fontSize: 46, lineHeight: 1.02, fontWeight: 850 }}>
            {EVIDENCE_BENCHMARK_COPY.comparison}
          </div>
          <div style={{ marginTop: 14, fontSize: 40, lineHeight: 1, fontWeight: 850, color: palette.accent }}>
            {EVIDENCE_BENCHMARK_COPY.benchmark}
          </div>
          <div style={{ marginTop: 24, fontSize: 27, lineHeight: 1.25 }}>
            {EVIDENCE_BENCHMARK_COPY.statement}
          </div>
          <div style={{ marginTop: 18, fontSize: 25, lineHeight: 1.2, fontWeight: 800, color: palette.signal }}>
            {EVIDENCE_BENCHMARK_COPY.qualification}
          </div>
          <SourceLabel palette={palette}>SOURCE / OPENAI'S OWN GPQA TESTS</SourceLabel>
        </div>
      </div>
    </div>
  );
};

const AvailabilityScene = ({ palette, frame }: { palette: ScenePalette; frame: number }) => {
  const active = Math.floor(frame / 120) % 3;
  const rows = [
    ["FREE", "GPT-LIVE-1 MINI"],
    ["GO / PLUS / PRO", "GPT-LIVE-1"],
    ["WHERE", "SETTINGS → VOICE → LIVE"]
  ] as const;
  return (
    <div>
      <Header palette={palette} scene="availability" index={5} />
      <div style={{ marginTop: 62, fontSize: 70, lineHeight: 1, fontWeight: 880 }}>TRY IT NOW IN CHATGPT VOICE</div>
      <div style={{ marginTop: 52 }}>
        {rows.map(([tier, model], index) => (
          <div
            key={tier}
            style={{
              display: "grid",
              gridTemplateColumns: "340px 1fr",
              height: 104,
              alignItems: "center",
              borderTop: `2px solid ${palette.muted}`,
              color: index === active ? palette.foreground : palette.muted
            }}
          >
            <div style={{ ...labelStyle(palette), color: index === active ? palette.signal : palette.muted }}>
              {tier}
            </div>
            <div style={{ fontSize: 42, fontWeight: 850 }}>{model}</div>
          </div>
        ))}
      </div>
      <div style={{ marginTop: 40, borderTop: `5px solid ${palette.signal}`, paddingTop: 22 }}>
        <div style={{ ...labelStyle(palette), color: palette.signal }}>LAUNCH LIMITS</div>
        <div style={{ marginTop: 16, fontSize: 26, fontWeight: 720 }}>
          NO LIVE VIDEO OR SCREEN SHARE · NO CONNECTED APPS OR PLUGINS · SOME WORKSPACES + TOOLS UNSUPPORTED
        </div>
      </div>
      <SourceLabel palette={palette}>SOURCE / OPENAI HELP CENTER</SourceLabel>
    </div>
  );
};

const FutureScene = ({ palette, frame }: { palette: ScenePalette; frame: number }) => {
  const items = [
    ["VOICE", "ACTION"],
    ["SYSTEMS", "VOICE"],
    ["VOICE", "VOICE"]
  ] as const;
  return (
    <div>
      <Header palette={palette} scene="what comes next" index={6} />
      <div style={{ marginTop: 94, display: "flex", alignItems: "center", gap: 20 }}>
        {items.map(([from, to], index) => {
          const pulse = interpolate((frame + index * 25) % 120, [0, 60, 120], [0.25, 1, 0.25]);
          return (
            <div key={`${from}-${to}`} style={{ display: "flex", alignItems: "center", gap: 20 }}>
              <div style={{ width: 410, borderTop: `7px solid ${palette.accent}`, paddingTop: 26 }}>
                <div style={{ ...labelStyle(palette), color: palette.muted }}>{`0${index + 1}`}</div>
                <div style={{ marginTop: 20, fontSize: 58, fontWeight: 880 }}>{from}</div>
                <div style={{ marginTop: 20, height: 13, background: palette.muted }}>
                  <div style={{ width: `${pulse * 100}%`, height: "100%", background: palette.signal }} />
                </div>
                <div style={{ marginTop: 20, fontSize: 58, fontWeight: 880, color: palette.signal }}>{to}</div>
              </div>
              {index < items.length - 1 ? <div style={{ fontSize: 44, color: palette.muted }}>→</div> : null}
            </div>
          );
        })}
      </div>
      <div style={{ marginTop: 86, fontSize: 35, lineHeight: 1.25, maxWidth: 1300 }}>
        ACTIONS, PROACTIVE CONTEXT, AND CROSS-LANGUAGE CONVERSATION WITHOUT STOPPING.
      </div>
      <SourceLabel palette={palette}>DIRECTION / OPENAI · GPT-LIVE API ANNOUNCED AS COMING</SourceLabel>
    </div>
  );
};

const CtaScene = ({ palette, frame }: { palette: ScenePalette; frame: number }) => {
  const active = Math.floor(frame / 90) % 3;
  const prompts = ["TRANSLATE A CONVERSATION", "TALK THROUGH A MESSY PROBLEM", "INTERRUPT MID-ANSWER"];
  return (
    <div>
      <Header palette={palette} scene="the takeaway" index={7} />
      <div style={{ marginTop: 78, maxWidth: 1370, fontSize: 102, lineHeight: 0.98, fontWeight: 900 }}>
        YOU NO LONGER HAVE TO SPEAK <span style={{ color: palette.signal }}>LIKE A MACHINE.</span>
      </div>
      <div style={{ marginTop: 65, display: "flex", gap: 14 }}>
        {prompts.map((prompt, index) => (
          <div
            key={prompt}
            style={{
              width: 445,
              minHeight: 104,
              borderTop: `5px solid ${index === active ? palette.accent : palette.muted}`,
              paddingTop: 18,
              color: index === active ? palette.foreground : palette.muted,
              fontSize: 25,
              fontWeight: 820,
              lineHeight: 1.15
            }}
          >
            {prompt}
          </div>
        ))}
      </div>
      <div style={{ marginTop: 58, fontSize: 35, lineHeight: 1.25, fontWeight: 720 }}>
        WHAT DID GPT-LIVE ENABLE FOR YOU — OR WHAT DO YOU THINK IT WILL ENABLE?
      </div>
    </div>
  );
};

export const GptLivePlate = (props: GptLivePlateProps) => {
  const frame = useCurrentFrame();
  const { fps, width, height, durationInFrames } = useVideoConfig();
  const style = sceneStyle(props.variant, props.scene);
  const entrance = spring({ frame, fps, config: { damping: 18, stiffness: 130, mass: 0.8 } });
  const contentLeft = style.persistentHost ? 250 : 72;
  const contentWidth = style.persistentHost ? 1400 : 1580;
  const drift = interpolate(frame, [0, Math.max(1, durationInFrames - 1)], [0, 24]);
  const sceneProps = { palette: style.palette, frame };
  const scenes = {
    hook: <HookScene {...sceneProps} />,
    full_duplex: <FullDuplexScene {...sceneProps} durationInFrames={durationInFrames} />,
    use_cases: <UseCasesScene {...sceneProps} />,
    evidence: <EvidenceScene {...sceneProps} />,
    availability: <AvailabilityScene {...sceneProps} />,
    future: <FutureScene {...sceneProps} />,
    cta: <CtaScene {...sceneProps} />
  } satisfies Record<GptLivePlateProps["scene"], ReactNode>;

  return (
    <AbsoluteFill
      style={{
        width,
        height,
        background: style.palette.background,
        color: style.palette.foreground,
        fontFamily: FONT,
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
          transform: `translateX(${(1 - entrance) * -28 + drift}px)`,
          opacity: entrance
        }}
      >
        {scenes[props.scene]}
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
          <span>{props.narrationId.replace("narration_", "PLATE / ")}</span>
          <span>{style.persistentHost ? "AIMH VISUAL HOST" : "DYNAMIC EDITORIAL"}</span>
        </div>
      </Sequence>
    </AbsoluteFill>
  );
};
