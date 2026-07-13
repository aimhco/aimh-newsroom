# GPT-Live Evidence-First Revision Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Produce one approved GPT-Live video revision with white evidence-led visuals, correctly framed article sources, full-screen official video, outro-only music, clean cuts, no experimental chrome, and source-complete QA.

**Architecture:** Keep the current Remotion to Tella to FFmpeg production path for this revision. Remotion owns the approved evidence treatment, Tella preserves the existing remote timeline and original source audio, and FFmpeg adds the logo, mixes only the outro, and encodes the final output. Existing Tella variant identifiers remain compatibility keys, but both render the same approved evidence-editorial visual system and no visual-host UI.

**Tech Stack:** TypeScript, React 19, Remotion 4, Playwright capture, Tella MCP, FFmpeg/FFprobe, Vitest, pnpm

---

## File Map

- `src/production/gptLive/types.ts`: Evidence, attribution, placement, and outro contracts.
- `src/production/gptLive/content.ts`: Canonical GPT-Live source/evidence decisions and approved visual copy.
- `src/production/gptLive/evidence.ts`: Evidence asset validation and Remotion asset-path planning.
- `src/production/gptLive/prepare.ts`: Evidence preflight, source manifest generation, and production fingerprinting.
- `src/production/gptLive/renderPlates.ts`: Remotion public-directory binding and evidence props.
- `src/production/gptLive/motion/Root.tsx`: Evidence asset props and frame-covering duration metadata.
- `src/production/gptLive/motion/GptLivePlate.tsx`: White full-frame composition without footer or host rail.
- `src/production/gptLive/motion/sceneStyle.ts`: Single approved light palette and layout geometry.
- `src/production/gptLive/motion/scenePrimitives.tsx`: Editorial band, evidence viewport, spotlight, and compact attribution primitives.
- `src/production/gptLive/motion/SceneRenderer.tsx`: Three-stage evidence sequence routing.
- `src/production/gptLive/finish.ts`: Outro-only audio graph and final report.
- `src/config/env.ts`: `AIMH_OUTRO_MUSIC_PATH` defaulting and compatibility behavior.
- `src/production/gptLive/qa/visual.ts`: Boundary-frame extraction and blank/base-frame rejection.
- `src/production/gptLive/qa/types.ts`: Transition QA result contract.
- `src/production/gptLive/qa/validation.ts`: Transition and evidence-manifest acceptance gates.
- `tests/gptLiveContent.test.ts`: Manifest, source, environment, and evidence contract tests.
- `tests/gptLiveMotion.test.ts`: White palette, no-host/no-footer, evidence placement, and duration coverage tests.
- `tests/gptLiveFinish.test.ts`: Outro-only filter graph and report tests.
- `tests/gptLiveQa.test.ts`: Boundary-frame and source-manifest QA tests.
- `episodes/2026-07-10-gpt-live-tella-ab/evidence/`: Purpose-captured source images, generated and ignored by Git.
- `episodes/2026-07-10-gpt-live-tella-ab/reports/source-manifest.json`: Machine-readable source and YouTube-description manifest.

### Task 1: Add Evidence and Outro Contracts

**Files:**
- Modify: `src/production/gptLive/types.ts`
- Modify: `src/production/gptLive/content.ts`
- Modify: `src/config/env.ts`
- Test: `tests/gptLiveContent.test.ts`

- [ ] **Step 1: Write failing manifest and environment tests**

Add tests that require each evidence decision to identify the source, asset path, canonical URL, display URL, placement, takeaway, supporting detail, and focal rectangle. Pin the outro-only policy and the default dedicated outro path.

```ts
expect(GPT_LIVE_CONTENT.audio).toEqual({
  introMusic: false,
  bodyMusic: false,
  outroMusicPath:
    "/Users/dennywii/Documents/dev/aimh-video-engine/assets/music/Outro_Much_Higher_Causmic.mp3",
  outroDurationSeconds: 7
});

expect(GPT_LIVE_CONTENT.evidence).toEqual(expect.arrayContaining([
  expect.objectContaining({
    id: "evidence_openai_full_duplex",
    scene: "full_duplex",
    sourceId: "src_openai_article",
    assetPath: "evidence/openai-gpt-live-full-duplex.png",
    canonicalUrl: "https://openai.com/index/introducing-gpt-live/",
    displayUrl: "OPENAI.COM / GPT-LIVE",
    placement: "left",
    takeaway: "Listen and speak at the same time.",
    focalRect: expect.objectContaining({ x: expect.any(Number), y: expect.any(Number) })
  })
]));

expect(snapshot.values.AIMH_OUTRO_MUSIC_PATH).toBe(
  "/opt/aimh-video-engine/assets/music/Outro_Much_Higher_Causmic.mp3"
);
```

- [ ] **Step 2: Run the focused test and verify failure**

Run:

```bash
corepack pnpm vitest run tests/gptLiveContent.test.ts
```

Expected: FAIL because `audio`, `evidence`, and `AIMH_OUTRO_MUSIC_PATH` are not defined.

- [ ] **Step 3: Add the explicit contracts**

Add these contracts to `types.ts`:

```ts
export type EvidenceBandPlacement = "left" | "right" | "top" | "bottom";

export interface EvidenceFocalRect {
  readonly x: number;
  readonly y: number;
  readonly width: number;
  readonly height: number;
}

export interface EvidenceSpec {
  readonly id: string;
  readonly scene: GptLiveScene;
  readonly sourceId: string;
  readonly assetPath: string;
  readonly canonicalUrl: string;
  readonly mediaUrl?: string;
  readonly displayUrl: string;
  readonly publisher: string;
  readonly sourceType: "primary" | "reporting" | "social" | "third_party_video";
  readonly playbackDecision: "full_screen_original_audio" | "captured_source";
  readonly placement: EvidenceBandPlacement;
  readonly takeaway: string;
  readonly detail: string;
  readonly focalRect: EvidenceFocalRect;
  readonly youtubeDescription: boolean;
}

export interface AudioPolicy {
  readonly introMusic: false;
  readonly bodyMusic: false;
  readonly outroMusicPath: string;
  readonly outroDurationSeconds: number;
}
```

Replace `musicPath` on `GptLiveProduction` with:

```ts
readonly evidence: readonly EvidenceSpec[];
readonly audio: AudioPolicy;
```

Extend validation so evidence IDs are unique, evidence sources resolve, `canonicalUrl` equals the declared source URL, optional `mediaUrl` values are HTTPS URLs on the same publisher domain, captured-source asset paths are relative and remain below `evidence/`, source-video asset paths remain below `source/`, focal values are within `0..1`, and every narration scene named by an evidence item exists.

- [ ] **Step 4: Define approved GPT-Live evidence and audio**

Add four captured-source decisions and retain the two official timeline videos as `full_screen_original_audio` evidence in `content.ts`:

```ts
const GPT_LIVE_EVIDENCE = [
  {
    id: "evidence_translation_video",
    scene: "hook",
    sourceId: "src_openai_article",
    assetPath: "source/clip_translation.mp4",
    canonicalUrl: "https://openai.com/index/introducing-gpt-live/",
    mediaUrl: "https://openai.com/index/introducing-gpt-live/?video=1208096618",
    displayUrl: "OPENAI.COM / GPT-LIVE",
    publisher: "OpenAI",
    sourceType: "primary",
    playbackDecision: "full_screen_original_audio",
    placement: "left",
    takeaway: "Live translation without waiting for turns.",
    detail: "Official GPT-Live demonstration.",
    focalRect: { x: 0, y: 0, width: 1, height: 1 },
    youtubeDescription: true
  },
  {
    id: "evidence_openai_full_duplex",
    scene: "full_duplex",
    sourceId: "src_openai_article",
    assetPath: "evidence/openai-gpt-live-full-duplex.png",
    canonicalUrl: "https://openai.com/index/introducing-gpt-live/",
    displayUrl: "OPENAI.COM / GPT-LIVE",
    publisher: "OpenAI",
    sourceType: "primary",
    playbackDecision: "captured_source",
    placement: "left",
    takeaway: "Listen and speak at the same time.",
    detail: "This is why GPT-Live feels like a call instead of a walkie-talkie.",
    focalRect: { x: 0.18, y: 0.18, width: 0.64, height: 0.34 },
    youtubeDescription: true
  },
  {
    id: "evidence_toms_guide_translation",
    scene: "evidence",
    sourceId: "src_toms_guide",
    assetPath: "evidence/toms-guide-world-cup-translation.png",
    canonicalUrl:
      "https://www.tomsguide.com/ai/i-used-chatgpts-new-voice-mode-to-translate-the-world-cup-in-real-time-heres-what-happened",
    displayUrl: "TOMSGUIDE.COM / AI",
    publisher: "Tom's Guide",
    sourceType: "reporting",
    playbackDecision: "captured_source",
    placement: "right",
    takeaway: "A live broadcast became continuous interpretation.",
    detail: "Tom's Guide reported English interpretation over rapid Spanish commentary.",
    focalRect: { x: 0.08, y: 0.22, width: 0.78, height: 0.46 },
    youtubeDescription: true
  },
  {
    id: "evidence_openai_availability",
    scene: "availability",
    sourceId: "src_openai_help",
    assetPath: "evidence/openai-chatgpt-voice-availability.png",
    canonicalUrl: "https://help.openai.com/en/articles/20001274/",
    displayUrl: "HELP.OPENAI.COM / CHATGPT VOICE",
    publisher: "OpenAI Help Center",
    sourceType: "primary",
    playbackDecision: "captured_source",
    placement: "left",
    takeaway: "Free gets mini. Paid plans get GPT-Live-1.",
    detail: "Launch access and limitations remain visible beside the explanation.",
    focalRect: { x: 0.12, y: 0.18, width: 0.76, height: 0.5 },
    youtubeDescription: true
  },
  {
    id: "evidence_openai_realtime",
    scene: "future",
    sourceId: "src_openai_realtime",
    assetPath: "evidence/openai-realtime-future.png",
    canonicalUrl: "https://openai.com/index/advancing-voice-intelligence-with-new-models-in-the-api/",
    displayUrl: "OPENAI.COM / REALTIME",
    publisher: "OpenAI",
    sourceType: "primary",
    playbackDecision: "captured_source",
    placement: "right",
    takeaway: "Voice becomes an interface for action.",
    detail: "Realtime tools point toward scheduling, support, travel changes, and multilingual work.",
    focalRect: { x: 0.08, y: 0.2, width: 0.82, height: 0.48 },
    youtubeDescription: true
  }
] as const satisfies readonly EvidenceSpec[];
```

Add the interruption source video as a second `full_screen_original_audio` item and define the audio policy with `Outro_Much_Higher_Causmic.mp3` as the calibration default.

- [ ] **Step 5: Add outro environment resolution**

Add `AIMH_OUTRO_MUSIC_PATH` to `DEFAULT_ENV_KEYS`, derive its default from `AIMH_VIDEO_ENGINE_PATH`, and stop requiring `AIMH_BODY_MUSIC_PATH` in GPT-Live preparation and finishing. Do not remove the old key globally because other newsroom paths may still use it.

- [ ] **Step 6: Run focused tests**

Run:

```bash
corepack pnpm vitest run tests/gptLiveContent.test.ts
corepack pnpm lint
```

Expected: PASS.

- [ ] **Step 7: Commit**

```bash
git add src/production/gptLive/types.ts src/production/gptLive/content.ts src/config/env.ts tests/gptLiveContent.test.ts
git commit -m "feat: define GPT-Live evidence and outro policy"
```

### Task 2: Capture and Validate Purpose-Framed Evidence

**Files:**
- Create: `src/production/gptLive/evidence.ts`
- Modify: `src/production/gptLive/prepare.ts`
- Modify: `src/production/gptLive/renderPlates.ts`
- Test: `tests/gptLiveContent.test.ts`
- Test: `tests/gptLiveMotion.test.ts`

- [ ] **Step 1: Write failing evidence-path and preflight tests**

Require captured evidence to resolve under the episode directory, reject missing or symlinked evidence, and require the Remotion bundle to expose the episode directory as its public asset directory.

```ts
expect(resolveEvidenceAssetPath("/episode", {
  assetPath: "evidence/openai.png"
} as EvidenceSpec)).toBe("/episode/evidence/openai.png");

expect(() => resolveEvidenceAssetPath("/episode", {
  assetPath: "../outside.png"
} as EvidenceSpec)).toThrow("Evidence asset must remain inside the episode directory");

expect(bundle).toHaveBeenCalledWith({
  entryPoint: expect.stringContaining("motion/Root.tsx"),
  publicDir: "/episode"
});
```

- [ ] **Step 2: Run focused tests and verify failure**

```bash
corepack pnpm vitest run tests/gptLiveContent.test.ts tests/gptLiveMotion.test.ts
```

Expected: FAIL because the evidence helper and public directory are absent.

- [ ] **Step 3: Add evidence validation helpers**

Implement:

```ts
export function resolveEvidenceAssetPath(episodeDir: string, evidence: EvidenceSpec): string {
  const resolvedEpisode = resolve(episodeDir);
  const resolvedAsset = resolve(resolvedEpisode, evidence.assetPath);
  if (relative(resolvedEpisode, resolvedAsset).startsWith("..") || isAbsolute(relative(resolvedEpisode, resolvedAsset))) {
    throw new Error("Evidence asset must remain inside the episode directory");
  }
  return resolvedAsset;
}

export function evidenceForScene(scene: GptLiveScene): EvidenceSpec | undefined {
  return GPT_LIVE_CONTENT.evidence.find(
    (item) => item.scene === scene && item.playbackDecision === "captured_source"
  );
}
```

Add `validateEvidenceAssets()` that checks each captured asset is a regular readable file and is not a symlink before expensive narration or rendering work starts.

- [ ] **Step 4: Bind evidence assets into Remotion**

Change the bundle dependency contract to accept `publicDir`, call:

```ts
const serveUrl = await bundle({ entryPoint, publicDir: options.episodeDir });
```

Extend `GptLivePlateProps` with:

```ts
readonly evidence?: EvidenceSpec & { readonly assetUrl: string };
```

Set `assetUrl` to `/${evidence.assetPath}` in `buildPlateRenderJobs()`.

- [ ] **Step 5: Materialize current source captures**

Create the episode evidence directory and capture these exact pages at a 1920x1080-safe viewport:

```text
evidence/openai-gpt-live-full-duplex.png
evidence/toms-guide-world-cup-translation.png
evidence/openai-chatgpt-voice-availability.png
evidence/openai-realtime-future.png
```

Use browser-assisted capture when a site blocks headless Playwright. Do not bypass challenge pages. Capture the viewport containing the relevant headline, passage, chart, or availability section rather than the page top by default.

- [ ] **Step 6: Inspect all four captures**

Use `view_image` on every capture and reject:

- Login, CAPTCHA, access-denied, or challenge pages.
- Cookie dialogs covering evidence.
- Captures where the focal passage cannot remain legible in the 64 percent source viewport.
- Crops that remove publisher identity.

- [ ] **Step 7: Run preparation and motion tests**

```bash
corepack pnpm vitest run tests/gptLiveContent.test.ts tests/gptLiveMotion.test.ts
corepack pnpm lint
```

Expected: PASS.

- [ ] **Step 8: Commit**

```bash
git add src/production/gptLive/evidence.ts src/production/gptLive/prepare.ts src/production/gptLive/renderPlates.ts tests/gptLiveContent.test.ts tests/gptLiveMotion.test.ts
git commit -m "feat: validate GPT-Live evidence captures"
```

Do not add generated episode screenshots to Git.

### Task 3: Implement the Approved White Editorial Treatment

**Files:**
- Modify: `src/production/gptLive/motion/sceneStyle.ts`
- Modify: `src/production/gptLive/motion/scenePrimitives.tsx`
- Modify: `src/production/gptLive/motion/GptLivePlate.tsx`
- Modify: `src/production/gptLive/motion/SceneRenderer.tsx`
- Modify: `src/production/gptLive/motion/Root.tsx`
- Test: `tests/gptLiveMotion.test.ts`

- [ ] **Step 1: Write failing style and component-contract tests**

Require every compatibility variant to use the same white palette, full-width content region, no persistent host, no host layout, no experimental footer strings, and frame-covering duration metadata.

```ts
for (const variant of VARIANTS) {
  expect(sceneStyle(variant, "full_duplex")).toMatchObject({
    persistentHost: false,
    layout: "evidence_editorial",
    motion: "editorial_cuts",
    palette: {
      background: "#F7F8F6",
      foreground: "#111315",
      paper: "#FFFFFF"
    }
  });
}

expect(readFileSync(GPT_LIVE_PLATE_PATH, "utf8")).not.toMatch(
  /DYNAMIC EDITORIAL|AIMH VISUAL HOST|PLATE \/|HostRail/
);

await expect(calculateGptLivePlateMetadata({
  props: { ...props, durationSeconds: 22.941315 }
})).resolves.toMatchObject({ durationInFrames: 689 });
```

- [ ] **Step 2: Run the motion tests and verify failure**

```bash
corepack pnpm vitest run tests/gptLiveMotion.test.ts
```

Expected: FAIL because the dynamic palette is dark, host mode exists, footer text exists, and metadata rounds down.

- [ ] **Step 3: Collapse both compatibility variants onto the approved style**

Use one palette:

```ts
const EVIDENCE_PALETTE: ScenePalette = Object.freeze({
  background: "#F7F8F6",
  foreground: "#111315",
  paper: "#FFFFFF",
  signal: "#E85B50",
  accent: "#3E8F86",
  support: "#5E8500",
  muted: "#6E7472"
});
```

Return `persistentHost: false`, `layout: "evidence_editorial"`, one content region beginning at `x: 72`, and `motion: "editorial_cuts"` for both compatibility keys. Remove `anchored_host_rail` and `responsive_voice_rail` from the type union.

- [ ] **Step 4: Add evidence primitives**

Create these primitives in `scenePrimitives.tsx`:

```ts
export const EditorialBand = ({ evidence }: { readonly evidence: EvidenceSpec }) => (
  <div style={{
    background: "#FFFFFF",
    color: "#111315",
    padding: "64px 54px",
    display: "flex",
    flexDirection: "column",
    justifyContent: "center",
    boxSizing: "border-box",
    borderRight: evidence.placement === "left" ? "4px solid #111315" : undefined,
    borderLeft: evidence.placement === "right" ? "4px solid #111315" : undefined
  }}>
    <div style={{ color: "#E85B50", fontSize: 24, fontWeight: 800 }}>THE EVIDENCE</div>
    <div style={{ fontSize: 54, lineHeight: 1.04, fontWeight: 850, marginTop: 24 }}>
      {evidence.takeaway}
    </div>
    <div style={{ color: "#4E5552", fontSize: 28, lineHeight: 1.25, marginTop: 28 }}>
      {evidence.detail}
    </div>
  </div>
);

export const EvidenceViewport = ({ evidence, spotlight }: {
  readonly evidence: EvidenceSpec & { readonly assetUrl: string };
  readonly spotlight: boolean;
}) => (
  <div style={{ position: "relative", overflow: "hidden", background: "#F2F3F1" }}>
    <Img src={evidence.assetUrl} style={{ width: "100%", height: "100%", objectFit: "contain" }} />
    {spotlight ? (
      <div style={{
        position: "absolute",
        left: `${evidence.focalRect.x * 100}%`,
        top: `${evidence.focalRect.y * 100}%`,
        width: `${evidence.focalRect.width * 100}%`,
        height: `${evidence.focalRect.height * 100}%`,
        border: "6px solid #E85B50",
        boxShadow: "0 0 0 9999px rgba(255,255,255,0.4)",
        boxSizing: "border-box"
      }}
    ) : null}
  </div>
);

export const CompactAttribution = ({ evidence }: { readonly evidence: EvidenceSpec }) => (
  <div style={{
    position: "absolute",
    right: 24,
    bottom: 22,
    background: "#111315",
    color: "#FFFFFF",
    padding: "12px 16px",
    fontSize: 22,
    fontWeight: 800
  }}>
    {evidence.displayUrl}
  </div>
);
```

The source image must use `objectFit: "contain"`; it may scale to the remaining viewport but may not use `cover`. Band dimensions are 36/64 percent for left/right and 28/72 percent for top/bottom. The focal overlay is calculated from normalized `focalRect` values.

- [ ] **Step 5: Add the deterministic three-stage sequence**

In `SceneRenderer`, route scenes with captured evidence through an `EvidenceSequence`:

```ts
const establishUntil = Math.min(60, Math.floor(durationInFrames * 0.2));
const proveFrom = Math.min(
  durationInFrames - 1,
  Math.max(establishUntil + 1, Math.floor(durationInFrames * 0.58))
);

if (evidence && frame < establishUntil) {
  return <EvidenceViewport evidence={evidence} spotlight={false} fullScreen />;
}
if (evidence) {
  return (
    <EvidenceLayout
      evidence={evidence}
      spotlight={frame >= proveFrom}
    />
  );
}
```

Preserve existing motion scenes for `hook`, `use_cases`, and `cta`, where no captured article is assigned.

- [ ] **Step 6: Remove host and footer UI**

Delete the `HostRail` render from `GptLivePlate`, delete the bottom `Sequence` containing plate names, and remove the unused `HostRail` export. Keep the 198x198 top-right safe area clear for the final logo.

- [ ] **Step 7: Guarantee frame coverage**

Change metadata duration to:

```ts
durationInFrames: Math.max(1, Math.ceil(props.durationSeconds * 30))
```

The plate may exceed narration by less than one frame; Tella trims it to the narration clip duration, preventing a final uncovered frame.

- [ ] **Step 8: Run motion tests and a smoke render**

```bash
corepack pnpm vitest run tests/gptLiveMotion.test.ts
corepack pnpm gpt-live:motion-smoke
corepack pnpm lint
```

Expected: PASS. Inspect the generated contact sheet and temporal strip. All scenes must be light, the logo safe area must be empty, and article evidence must remain legible.

- [ ] **Step 9: Commit**

```bash
git add src/production/gptLive/motion tests/gptLiveMotion.test.ts
git commit -m "feat: render white evidence-first GPT-Live plates"
```

### Task 4: Generate a Source Manifest for On-Screen and YouTube Attribution

**Files:**
- Modify: `src/production/gptLive/prepare.ts`
- Modify: `src/production/gptLive/qa/types.ts`
- Modify: `src/production/gptLive/qa/validation.ts`
- Test: `tests/gptLiveContent.test.ts`
- Test: `tests/gptLiveQa.test.ts`

- [ ] **Step 1: Write failing source-manifest tests**

Require `reports/source-manifest.json` to include one entry per unique evidence source with canonical URL, optional media URLs, display URL, claim and scene support, on-screen attribution, playback decision, and YouTube-description inclusion.

```ts
expect(sourceManifest.sources).toEqual(expect.arrayContaining([
  expect.objectContaining({
    sourceId: "src_openai_article",
    canonicalUrl: "https://openai.com/index/introducing-gpt-live/",
    scenes: expect.arrayContaining(["full_duplex"]),
    onScreenAttribution: "OPENAI.COM / GPT-LIVE",
    youtubeDescription: true
  })
]));
```

- [ ] **Step 2: Run focused tests and verify failure**

```bash
corepack pnpm vitest run tests/gptLiveContent.test.ts tests/gptLiveQa.test.ts
```

Expected: FAIL because no JSON source manifest is emitted or validated.

- [ ] **Step 3: Generate the source manifest**

Add a pure `buildSourceManifest()` in `prepare.ts` returning:

```ts
{
  schemaVersion: "0.1.0",
  productionId: GPT_LIVE_CONTENT.id,
  sources: GPT_LIVE_CONTENT.sources.map((source) => ({
    sourceId: source.id,
    publisher: source.publisher,
    title: source.title,
    canonicalUrl: source.url,
    mediaUrls: unique non-empty mediaUrl values for the source,
    scenes: unique evidence scenes for the source,
    claims: unique claim IDs for the source,
    onScreenAttribution: unique display labels,
    playbackDecisions: unique playback decisions,
    youtubeDescription: evidence.some(item => item.youtubeDescription)
  }))
}
```

Write it atomically to `reports/source-manifest.json`, include it in the preparation fingerprint, and return its path from `prepareGptLiveProduction()`.

- [ ] **Step 4: Add QA requirements**

Read the source manifest during QA, validate every canonical production source appears exactly once, reject signed URLs or local paths, and require every visible evidence item to map to an on-screen attribution and YouTube-description entry.

- [ ] **Step 5: Run focused tests**

```bash
corepack pnpm vitest run tests/gptLiveContent.test.ts tests/gptLiveQa.test.ts
corepack pnpm lint
```

Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add src/production/gptLive/prepare.ts src/production/gptLive/qa/types.ts src/production/gptLive/qa/validation.ts tests/gptLiveContent.test.ts tests/gptLiveQa.test.ts
git commit -m "feat: publish GPT-Live source manifest"
```

### Task 5: Replace Body Music with a Short Outro Mix

**Files:**
- Modify: `src/production/gptLive/finish.ts`
- Test: `tests/gptLiveFinish.test.ts`
- Test: `tests/gptLiveQa.test.ts`

- [ ] **Step 1: Write failing outro-only filter tests**

Replace body-music assertions with:

```ts
const args = buildFinishFfmpegArgs({
  inputPath: "/episode/exports/tella-a.mp4",
  logoPath: "/assets/logo.png",
  outroMusicPath: "/assets/Outro_Much_Higher_Causmic.mp3",
  outroDurationSeconds: 7,
  outputPath: "/episode/final/revised.tmp.mp4",
  durationSeconds: 150,
  sourceGains
});

expect(args).not.toContain("-stream_loop");
const graph = args[args.indexOf("-filter_complex") + 1]!;
expect(graph).toContain("atrim=duration=7.000");
expect(graph).toContain("adelay=143000|143000");
expect(graph).toContain("afade=t=in:st=0:d=0.250");
expect(graph).toContain("afade=t=out:st=6.250:d=0.750");
expect(graph).not.toContain("between(t,0.000");
```

Also require the post-production report to contain `introMusic: false`, `bodyMusic: false`, the outro basename, start time, duration, and fade settings.

- [ ] **Step 2: Run focused tests and verify failure**

```bash
corepack pnpm vitest run tests/gptLiveFinish.test.ts tests/gptLiveQa.test.ts
```

Expected: FAIL because finishing loops body music across the complete program.

- [ ] **Step 3: Implement the outro-only graph**

Replace `musicPath` with `outroMusicPath` and `outroDurationSeconds` in finishing options. Compute:

```ts
const outroDuration = Math.min(options.outroDurationSeconds, options.durationSeconds);
const outroStart = Math.max(0, options.durationSeconds - outroDuration);
const delayMs = Math.round(outroStart * 1000);
```

Build audio filters equivalent to:

```text
const graph = [
  `[0:a]volume='${buildSourceDialogueGainExpression(options.sourceGains)}',` +
    `apad=whole_dur=${duration}[program]`,
  `[2:a]atrim=duration=${outroDuration.toFixed(3)},asetpts=PTS-STARTPTS,` +
    `afade=t=in:st=0:d=0.250,` +
    `afade=t=out:st=${Math.max(0, outroDuration - 0.75).toFixed(3)}:d=0.750,` +
    `volume=0.16,adelay=${delayMs}|${delayMs}[outro]`,
  `[program][outro]amix=inputs=2:duration=longest:normalize=0,` +
    `atrim=duration=${duration},` +
    "alimiter=limit=0.95:attack=5:release=50:level=false:latency=true[aout]"
].join(";");
```

Do not use `-stream_loop`. Do not apply music ducking to source intervals because no music exists there.

- [ ] **Step 4: Update preflight and reports**

Require only the dedicated outro file. Report the policy without persisting private absolute paths:

```ts
audioPolicy: {
  introMusic: false,
  bodyMusic: false,
  outro: {
    file: basename(outroMusicPath),
    startSeconds: outroStart,
    durationSeconds: outroDuration,
    fadeInSeconds: 0.25,
    fadeOutSeconds: 0.75
  }
}
```

- [ ] **Step 5: Run finish tests**

```bash
corepack pnpm vitest run tests/gptLiveFinish.test.ts tests/gptLiveQa.test.ts
corepack pnpm lint
```

Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add src/production/gptLive/finish.ts tests/gptLiveFinish.test.ts tests/gptLiveQa.test.ts
git commit -m "fix: limit GPT-Live music to the outro"
```

### Task 6: Reject Blank and Base-Color Transition Frames

**Files:**
- Modify: `src/production/gptLive/qa/visual.ts`
- Modify: `src/production/gptLive/qa/types.ts`
- Modify: `src/production/gptLive/qa/validation.ts`
- Test: `tests/gptLiveQa.test.ts`

- [ ] **Step 1: Write failing transition-stat tests**

Add pure parsing tests for FFmpeg `signalstats` metadata and require low-range transition frames to fail.

```ts
expect(parseTransitionSignalStats([
  "lavfi.signalstats.YMIN=42",
  "lavfi.signalstats.YMAX=42",
  "lavfi.signalstats.UMIN=154",
  "lavfi.signalstats.UMAX=154",
  "lavfi.signalstats.VMIN=110",
  "lavfi.signalstats.VMAX=110"
].join("\n"))).toEqual({ yRange: 0, uRange: 0, vRange: 0 });

expect(() => assertTransitionFrameHasContent({ yRange: 0, uRange: 0, vRange: 0 }))
  .toThrow("transition frame is blank or exposes the base layer");
```

- [ ] **Step 2: Run the QA test and verify failure**

```bash
corepack pnpm vitest run tests/gptLiveQa.test.ts
```

Expected: FAIL because transition content statistics are not inspected.

- [ ] **Step 3: Extract both sides of every boundary**

For each timeline boundary at time `t`, sample `t - 1/30` and `t + 1/30` with:

```text
-ss 58.967 -i episodes/2026-07-10-gpt-live-tella-ab/final/version-a.mp4 -frames:v 1
-vf signalstats,metadata=print:file=- -f null -
```

Parse Y/U/V min and max values. A frame passes when at least one component range exceeds 6. This rejects uniform blue, white, black, or other uncovered base frames while allowing real article and video frames.

- [ ] **Step 4: Publish transition QA results**

Add to each variant report:

```ts
transitionContent: {
  sampledFrames: number;
  blankFrames: readonly { boundaryId: string; side: "before" | "after"; timeSeconds: number }[];
}
```

Validation requires `sampledFrames === boundaryCount * 2` and `blankFrames.length === 0`.

- [ ] **Step 5: Update comparison language**

Remove references to Version B host usefulness and body music. State that the final evidence-editorial output passed boundary content checks and that outro-only audio does not prove CTA completion.

- [ ] **Step 6: Run QA tests**

```bash
corepack pnpm vitest run tests/gptLiveQa.test.ts
corepack pnpm lint
```

Expected: PASS.

- [ ] **Step 7: Commit**

```bash
git add src/production/gptLive/qa tests/gptLiveQa.test.ts
git commit -m "test: reject blank GPT-Live transition frames"
```

### Task 7: Rebuild the Current Tella Revision and Final MP4

**Files:**
- Generated: `episodes/2026-07-10-gpt-live-tella-ab/plates/**`
- Generated: `episodes/2026-07-10-gpt-live-tella-ab/tella/plan.json`
- Generated: `episodes/2026-07-10-gpt-live-tella-ab/tella/state.json`
- Generated: `episodes/2026-07-10-gpt-live-tella-ab/exports/tella-a.mp4`
- Generated: `episodes/2026-07-10-gpt-live-tella-ab/final/version-a.mp4`
- Generated: `episodes/2026-07-10-gpt-live-tella-ab/reports/**`

- [ ] **Step 1: Run all automated tests before production**

```bash
corepack pnpm test
corepack pnpm lint
corepack pnpm build
```

Expected: all tests pass and TypeScript builds without errors.

- [ ] **Step 2: Back up the approved comparison render**

```bash
cp episodes/2026-07-10-gpt-live-tella-ab/final/version-a.mp4 \
  episodes/2026-07-10-gpt-live-tella-ab/final/version-a-before-evidence-revision.mp4
```

- [ ] **Step 3: Re-run preparation without regenerating unchanged voice**

Reuse verified ElevenLabs MP3 files and source video excerpts. Regenerate manifests, narration slates only when timing contracts changed, and all evidence-editorial plates.

```bash
corepack pnpm gpt-live:prepare -- \
  --episode-dir episodes/2026-07-10-gpt-live-tella-ab
```

Expected: evidence assets pass preflight, seven narration plates per compatibility variant are rendered, and the updated Tella plan is written.

- [ ] **Step 4: Upload and apply revised plates in Tella**

For each narration clip in the existing Version A Tella project:

1. Create a Tella source for the revised plate.
2. Upload the exact H.264 plate bytes.
3. Apply the plate as the `screen` media from `startTimeMs: 0` through the narration clip duration.
4. Use `transitionStyle: "hardCut"`.
5. Do not add a Tella watermark, footer, captions, host rail, or body music.

Preserve the two official OpenAI source clips as standalone full-screen clips with original audio.

- [ ] **Step 5: Export and download Version A**

Export at 1920x1080, 30 fps, speed 1, no subtitles. Download to:

```text
episodes/2026-07-10-gpt-live-tella-ab/exports/tella-a.mp4
```

If the finishing command still requires a compatibility Version B export, apply the same evidence-editorial plates to that project and download `tella-b.mp4`. Do not render or expose the retired host treatment.

- [ ] **Step 6: Run final finishing**

```bash
corepack pnpm gpt-live:finish -- \
  --episode-dir episodes/2026-07-10-gpt-live-tella-ab
```

Expected: final MP4 contains the fixed AIMH logo, no intro/body music, and only a 5 to 7 second outro.

- [ ] **Step 7: Run machine QA**

```bash
corepack pnpm gpt-live:qa -- \
  --episode-dir episodes/2026-07-10-gpt-live-tella-ab
```

Expected: machine checks pass; upload readiness remains false pending human playback.

- [ ] **Step 8: Inspect visual and audio evidence**

Verify:

- Opening translation and interruption excerpts are full-screen.
- Narrated scenes are white and contain no experimental footer or host rail.
- OpenAI and Tom's Guide evidence is correctly framed and readable.
- Editorial bands use the approved content-driven side.
- Every boundary is free of blue or blank frames.
- No music exists before the final 5 to 7 seconds.
- Outro fades to silence without clipping the CTA.
- AIMH logo remains top-right and does not cover source evidence.

- [ ] **Step 9: Present the final MP4 for human playback**

Provide the absolute path to `final/version-a.mp4`. Do not upload to YouTube. Record human playback only after the user reviews the complete video.

### Task 8: Final Verification and Draft Pull Request

**Files:**
- Modify only files required by QA findings.

- [ ] **Step 1: Run the complete verification suite from a clean status**

```bash
corepack pnpm test
corepack pnpm lint
corepack pnpm build
git diff --check
git status --short
```

Expected: tests, lint, build, and diff checks pass. Only intentional source and documentation changes are tracked.

- [ ] **Step 2: Review the implementation against the design**

Confirm each acceptance criterion in `docs/superpowers/specs/2026-07-11-evidence-first-video-revision-design.md` has test or playback evidence. Fix any missing requirement before publishing the branch.

- [ ] **Step 3: Commit any final QA corrections**

```bash
git add src/production/gptLive tests/gptLiveContent.test.ts tests/gptLiveFinish.test.ts tests/gptLiveMotion.test.ts tests/gptLiveQa.test.ts
git commit -m "fix: address GPT-Live revision QA"
```

Skip this commit if final QA requires no code changes.

- [ ] **Step 4: Configure the GitHub remote if still absent**

```bash
git remote add origin https://github.com/aimhco/aimh-newsroom.git
```

If `origin` already exists, verify it targets the same repository rather than replacing it.

- [ ] **Step 5: Push the feature branch**

```bash
git push -u origin feature/gpt-live-tella-ab
```

- [ ] **Step 6: Open a draft pull request**

Create a draft PR from `feature/gpt-live-tella-ab` to `main` summarizing the seven fixes, verification results, generated final-video path, and the explicit statement that YouTube upload is out of scope.
