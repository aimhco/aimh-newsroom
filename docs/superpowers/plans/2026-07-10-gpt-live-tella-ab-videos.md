# GPT-Live Tella A/B Videos Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Produce two fact-checked, 2-3 minute GPT-Live videos with identical audio and timing, assembled through Tella MCP, differing only in Dynamic Editorial versus AIMH Visual Host treatments.

**Architecture:** A tracked GPT-Live production manifest defines sources, claims, source excerpts, narration blocks, visual scenes, and shared branding. Local TypeScript tools acquire public Vimeo streams through their official player config, trim source excerpts, synthesize one ElevenLabs narration set, and render silent A/B motion plates with Remotion. Tella holds the shared audio/content master and applies each variant's motion plates; deterministic local post-production then adds one shared music mix and the established AIMH logo treatment.

**Tech Stack:** TypeScript, Node.js, Vitest, FFmpeg/FFprobe, ElevenLabs, Remotion 4, React 19, Tella MCP, Chrome browser asset verification.

---

## File Map

- `src/production/gptLive/types.ts`: Production-manifest and Tella-state contracts.
- `src/production/gptLive/content.ts`: Approved source records, claims, timeline, script, clip ranges, and branding constants.
- `src/production/gptLive/vimeo.ts`: Official Vimeo player-config lookup and HLS selection.
- `src/production/gptLive/media.ts`: FFmpeg source-clip extraction and narration-slate creation.
- `src/production/gptLive/motion/Root.tsx`: Remotion composition registration.
- `src/production/gptLive/motion/GptLivePlate.tsx`: Shared scene renderer with A/B visual treatments.
- `src/production/gptLive/motion/sceneStyle.ts`: Pure style/layout decisions that can be unit tested.
- `src/production/gptLive/renderPlates.ts`: Remotion bundling and per-segment plate rendering.
- `src/production/gptLive/prepare.ts`: End-to-end local asset preparation and Tella manifest generation.
- `src/production/gptLive/tellaPlan.ts`: Deterministic clip order and variant media mapping.
- `src/production/gptLive/finish.ts`: Shared music mix, AIMH logo overlay, and final A/B media checks.
- `src/production/gptLive/qa.ts`: Editorial, source, duration, media, and controlled-comparison QA.
- `src/production/gptLive/cli.ts`: `prepare`, `finish`, and `qa` command entry point.
- `tests/gptLiveContent.test.ts`: Timeline, claim, script, and A/B invariants.
- `tests/gptLiveMedia.test.ts`: Vimeo config selection and FFmpeg command planning.
- `tests/gptLiveMotion.test.ts`: Variant visual contract and logo-safe-area tests.
- `tests/gptLiveFinish.test.ts`: Post-production command and duration-parity tests.
- `package.json`: Remotion/React dependencies and production commands.
- `tsconfig.json`: TSX/JSX compilation support.
- `.gitignore`: Ignore visual-companion state and generated production files.

Generated output lives under `episodes/2026-07-10-gpt-live-tella-ab/` and stays ignored by git.

### Task 1: Add Motion Runtime And Production Commands

**Files:**
- Modify: `package.json`
- Modify: `tsconfig.json`
- Modify: `.gitignore`

- [ ] **Step 1: Add the pinned motion dependencies**

Run:

```bash
corepack pnpm add remotion@4.0.487 @remotion/bundler@4.0.487 @remotion/renderer@4.0.487 react@19.2.7 react-dom@19.2.7
corepack pnpm add -D @types/react @types/react-dom
```

Expected: `package.json` and `pnpm-lock.yaml` record matching Remotion package versions.

- [ ] **Step 2: Add GPT-Live scripts**

Add these entries under `scripts` in `package.json`:

```json
"gpt-live:prepare": "tsx src/production/gptLive/cli.ts prepare",
"gpt-live:finish": "tsx src/production/gptLive/cli.ts finish",
"gpt-live:qa": "tsx src/production/gptLive/cli.ts qa"
```

- [ ] **Step 3: Enable TSX**

Add to `compilerOptions` in `tsconfig.json`:

```json
"jsx": "react-jsx"
```

Change `include` to:

```json
["src/**/*.ts", "src/**/*.tsx", "tests/**/*.ts", "vitest.config.ts"]
```

- [ ] **Step 4: Ignore generated companion and production state**

Add to `.gitignore`:

```gitignore
.superpowers/
```

The repository already ignores `episodes/**` while retaining `episodes/.gitkeep`; leave those existing rules unchanged.

- [ ] **Step 5: Verify the dependency setup**

Run:

```bash
corepack pnpm lint
corepack pnpm test
```

Expected: existing type-check and test suite pass.

- [ ] **Step 6: Commit**

```bash
git add package.json pnpm-lock.yaml tsconfig.json .gitignore
git commit -m "build: add GPT-Live motion production runtime"
```

### Task 2: Define The Controlled Production Contract

**Files:**
- Create: `src/production/gptLive/types.ts`
- Create: `src/production/gptLive/content.ts`
- Create: `tests/gptLiveContent.test.ts`

- [ ] **Step 1: Write the failing production-contract test**

Create `tests/gptLiveContent.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import { GPT_LIVE_CONTENT } from "../src/production/gptLive/content";

describe("GPT-Live controlled production", () => {
  it("uses one shared timeline for both visual variants", () => {
    expect(GPT_LIVE_CONTENT.variants).toEqual(["dynamic_editorial", "aimh_visual_host"]);
    expect(GPT_LIVE_CONTENT.timeline.map((item) => item.kind)).toEqual([
      "source_clip", "narration", "source_clip", "narration", "narration",
      "narration", "narration", "narration", "narration"
    ]);
  });

  it("pins the AIMH watermark to the video-engine treatment", () => {
    expect(GPT_LIVE_CONTENT.branding).toMatchObject({
      width: 150,
      marginTop: 24,
      marginRight: 24,
      opacity: 0.85
    });
  });

  it("maps every narration claim to a source", () => {
    const sourceIds = new Set(GPT_LIVE_CONTENT.sources.map((source) => source.id));
    for (const claim of GPT_LIVE_CONTENT.claims) {
      expect(claim.sourceIds.length).toBeGreaterThan(0);
      expect(claim.sourceIds.every((id) => sourceIds.has(id))).toBe(true);
    }
  });

  it("ends with the approved audience prompt", () => {
    expect(GPT_LIVE_CONTENT.narration.at(-1)?.text).toContain(
      "tell me what GPT-Live enabled for you, or what you think it is going to enable for you"
    );
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run:

```bash
corepack pnpm vitest run tests/gptLiveContent.test.ts
```

Expected: FAIL because `src/production/gptLive/content.ts` does not exist.

- [ ] **Step 3: Add the manifest types**

Create `src/production/gptLive/types.ts` with these public contracts:

```ts
export type GptLiveVariant = "dynamic_editorial" | "aimh_visual_host";
export type TimelineKind = "source_clip" | "narration";

export interface ProductionSource {
  id: string;
  title: string;
  url: string;
  publisher: string;
  accessedAt: string;
}

export interface ProductionClaim {
  id: string;
  text: string;
  sourceIds: readonly string[];
}

export interface SourceClipSpec {
  id: string;
  kind: "source_clip";
  playerConfigUrl: string;
  startSeconds: number;
  endSeconds: number;
  sourceId: string;
}

export interface NarrationSpec {
  id: string;
  kind: "narration";
  text: string;
  claimIds: readonly string[];
  scene: "hook" | "full_duplex" | "use_cases" | "evidence" | "availability" | "future" | "cta";
}

export type TimelineItem = SourceClipSpec | NarrationSpec;

export interface GptLiveProduction {
  id: string;
  variants: readonly GptLiveVariant[];
  sources: readonly ProductionSource[];
  claims: readonly ProductionClaim[];
  narration: readonly NarrationSpec[];
  timeline: readonly TimelineItem[];
  branding: {
    logoPath: string;
    width: number;
    marginTop: number;
    marginRight: number;
    opacity: number;
  };
  musicPath: string;
}

export interface TellaProductionState {
  masterVideoId?: string;
  variantVideoIds: Partial<Record<GptLiveVariant, string>>;
  clipIds: Record<string, string>;
  sourceIds: Record<string, string>;
  exportPaths: Partial<Record<GptLiveVariant, string>>;
}
```

- [ ] **Step 4: Add the approved sources, claims, and timeline**

Create `src/production/gptLive/content.ts`. Use `satisfies GptLiveProduction`, these exact clip specs, and the approved CTA:

```ts
import type { GptLiveProduction } from "./types";

const translation = {
  id: "clip_translation",
  kind: "source_clip" as const,
  playerConfigUrl: "https://player.vimeo.com/video/1208096618/config?h=c7dd7ef278",
  startSeconds: 50.82,
  endSeconds: 63.17,
  sourceId: "src_openai_article"
};

const interruption = {
  id: "clip_interruption",
  kind: "source_clip" as const,
  playerConfigUrl: "https://player.vimeo.com/video/1208152658/config?h=c944a411bd",
  startSeconds: 31.96,
  endSeconds: 43.92,
  sourceId: "src_openai_article"
};

const GPT_LIVE_BASE = {
  id: "2026-07-10-gpt-live-tella-ab",
  variants: ["dynamic_editorial", "aimh_visual_host"],
  branding: {
    logoPath: "/Users/dennywii/Documents/dev/aimh-video-engine/assets/logo.png",
    width: 150,
    marginTop: 24,
    marginRight: 24,
    opacity: 0.85
  },
  musicPath: "/Users/dennywii/Documents/dev/aimh-video-engine/assets/music/Body_Komorebi_Futuremono.mp3",
  sources: [
    { id: "src_openai_article", title: "Introducing GPT-Live", publisher: "OpenAI", accessedAt: "2026-07-10", url: "https://openai.com/index/introducing-gpt-live/" },
    { id: "src_openai_help", title: "ChatGPT Voice", publisher: "OpenAI Help Center", accessedAt: "2026-07-10", url: "https://help.openai.com/en/articles/20001274/" },
    { id: "src_openai_realtime", title: "Advancing voice intelligence with new models in the API", publisher: "OpenAI", accessedAt: "2026-07-10", url: "https://openai.com/index/advancing-voice-intelligence-with-new-models-in-the-api/" },
    { id: "src_toms_guide", title: "I used ChatGPT's new voice mode to translate the World Cup in real time", publisher: "Tom's Guide", accessedAt: "2026-07-10", url: "https://www.tomsguide.com/ai/i-used-chatgpts-new-voice-mode-to-translate-the-world-cup-in-real-time-heres-what-happened" }
  ],
  claims: [
    { id: "claim_full_duplex", text: "GPT-Live can listen and speak at the same time.", sourceIds: ["src_openai_article", "src_openai_help"] },
    { id: "claim_translation", text: "GPT-Live can perform live translation.", sourceIds: ["src_openai_article", "src_toms_guide"] },
    { id: "claim_world_cup", text: "Tom's Guide reported continuous English interpretation over rapid Spanish World Cup commentary.", sourceIds: ["src_toms_guide"] },
    { id: "claim_delegation", text: "GPT-Live can keep the conversation moving while deeper work runs in the background.", sourceIds: ["src_openai_article"] },
    { id: "claim_visuals", text: "Voice can show visual results for weather, sports, maps, stocks, and more.", sourceIds: ["src_openai_article", "src_openai_help"] },
    { id: "claim_benchmark", text: "OpenAI reports that GPT-Live-1 substantially outperforms Advanced Voice Mode on GPQA.", sourceIds: ["src_openai_article"] },
    { id: "claim_access", text: "Paid consumer plans use GPT-Live-1 and Free uses GPT-Live-1 mini.", sourceIds: ["src_openai_help"] },
    { id: "claim_limits", text: "Live initially excludes video, screen sharing, connected apps, plugins, and several ChatGPT surfaces.", sourceIds: ["src_openai_help"] },
    { id: "claim_direction", text: "Related realtime voice work points toward voice-to-action, systems-to-voice, and voice-to-voice products.", sourceIds: ["src_openai_realtime"] },
    { id: "claim_api_soon", text: "OpenAI plans to bring GPT-Live models to the API.", sourceIds: ["src_openai_article"] }
  ],
  narration: [
    { id: "narration_hook", kind: "narration", scene: "hook", claimIds: ["claim_translation"], text: "That was not a prepared translation. ChatGPT was listening in French and speaking in English almost at the same time. And that is only one thing GPT-Live suddenly makes possible." },
    { id: "narration_full_duplex", kind: "narration", scene: "full_duplex", claimIds: ["claim_full_duplex"], text: "The important phrase is full duplex. Old voice assistants worked like a walkie-talkie: you spoke, stopped, waited, and then the machine answered. GPT-Live works more like a phone call. It can keep listening while it talks, so you can interrupt, correct yourself, change direction, or pause to think without restarting the conversation." },
    { id: "narration_use_cases", kind: "narration", scene: "use_cases", claimIds: ["claim_translation", "claim_delegation", "claim_visuals"], text: "That enables much more than smoother small talk. You can translate a conversation while it happens, practice a language through fast role-play, talk through a messy idea without being cut off, or add another request while ChatGPT is already searching. It can keep the conversation moving, bring back harder answers from a stronger model, and show visual cards when weather, maps, sports, or stocks are easier to understand on screen." },
    { id: "narration_evidence", kind: "narration", scene: "evidence", claimIds: ["claim_world_cup", "claim_benchmark"], text: "This is already moving beyond staged demos. Tom's Guide played rapid Spanish World Cup commentary and reported that GPT-Live delivered a continuous English interpretation over the broadcast. OpenAI's own tests also show a large jump in expert science reasoning, although those remain vendor-reported results." },
    { id: "narration_availability", kind: "narration", scene: "availability", claimIds: ["claim_access", "claim_limits"], text: "You can try it now in ChatGPT Voice on consumer web and mobile. Free accounts get GPT-Live-1 mini. Go, Plus, and Pro get GPT-Live-1. Look under Settings, then Voice, for Live. It is still a launch product: no Live video or screen sharing yet, no connected apps or plugins, and some ChatGPT workspaces and tools are not supported." },
    { id: "narration_future", kind: "narration", scene: "future", claimIds: ["claim_direction", "claim_api_soon"], text: "Where this gets interesting is what comes next: voice that can take action, software that speaks useful context before you ask, and conversations that cross languages without stopping. OpenAI says GPT-Live is coming to the API, while its related realtime tools already point toward travel changes, scheduling, customer support, and multilingual work." },
    { id: "narration_cta", kind: "narration", scene: "cta", claimIds: ["claim_full_duplex"], text: "The breakthrough is not that ChatGPT sounds more human. It is that you no longer have to speak like a machine to use it. Try one real task in Voice: translate a conversation, talk through a messy problem, or interrupt it halfway through an answer. In the comments, tell me what GPT-Live enabled for you, or what you think it is going to enable for you." }
  ] as const,
  timeline: []
} as const;

export const GPT_LIVE_TIMELINE = [
  translation,
  GPT_LIVE_BASE.narration[0],
  interruption,
  ...GPT_LIVE_BASE.narration.slice(1)
] as const;

export const GPT_LIVE_CONTENT = {
  ...GPT_LIVE_BASE,
  timeline: GPT_LIVE_TIMELINE
} as const satisfies GptLiveProduction;
```

Import `GPT_LIVE_CONTENT` as the production manifest in tests and runtime code.

- [ ] **Step 5: Run the content tests**

Run:

```bash
corepack pnpm vitest run tests/gptLiveContent.test.ts
```

Expected: PASS after the timeline is expressed immutably.

- [ ] **Step 6: Commit**

```bash
git add src/production/gptLive/types.ts src/production/gptLive/content.ts tests/gptLiveContent.test.ts
git commit -m "feat: define controlled GPT-Live A/B production"
```

### Task 3: Acquire And Trim Official Source Clips

**Files:**
- Create: `src/production/gptLive/vimeo.ts`
- Create: `src/production/gptLive/media.ts`
- Create: `tests/gptLiveMedia.test.ts`

- [ ] **Step 1: Write failing HLS and clip-command tests**

Create tests that assert:

```ts
expect(selectVimeoHlsUrl({ request: { files: { hls: { cdns: {
  fastly_skyfire: { url: "https://skyfire.example/playlist.m3u8" },
  akfire_interconnect_quic: { url: "https://ak.example/playlist.m3u8" }
} } } } })).toBe("https://skyfire.example/playlist.m3u8");

expect(buildClipArgs({ inputUrl: "https://example/playlist.m3u8", startSeconds: 50.82, endSeconds: 63.17, outputPath: "/tmp/clip.mp4" })).toContain("12.350");
```

- [ ] **Step 2: Run tests and verify failure**

```bash
corepack pnpm vitest run tests/gptLiveMedia.test.ts
```

Expected: FAIL because the media modules do not exist.

- [ ] **Step 3: Implement official-player HLS selection**

`vimeo.ts` must:

- Fetch the provided `playerConfigUrl`.
- Reject non-2xx responses.
- Read `request.files.hls.cdns` using a typed narrow parser.
- Prefer `fastly_skyfire`, then `akfire_interconnect_quic`, then the first HTTPS `.m3u8` URL.
- Never log signed playlist URLs.
- Return a redacted error when no playlist exists.

- [ ] **Step 4: Implement accurate clip extraction**

`buildClipArgs()` in `media.ts` must return:

```ts
[
  "-y", "-i", inputUrl,
  "-ss", startSeconds.toFixed(3),
  "-t", (endSeconds - startSeconds).toFixed(3),
  "-vf", "scale=1920:1080:force_original_aspect_ratio=decrease,pad=1920:1080:(ow-iw)/2:(oh-ih)/2,setsar=1",
  "-r", "30", "-c:v", "libx264", "-crf", "18", "-preset", "medium",
  "-c:a", "aac", "-b:a", "192k", "-ar", "48000", "-ac", "2",
  outputPath
]
```

Add `extractSourceClip()` that resolves a fresh HLS URL, invokes `runCommand()`, and verifies duration with `ffprobeDurationSeconds()` within 0.25 seconds of the requested range.

- [ ] **Step 5: Run tests**

```bash
corepack pnpm vitest run tests/gptLiveMedia.test.ts
corepack pnpm lint
```

Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add src/production/gptLive/vimeo.ts src/production/gptLive/media.ts tests/gptLiveMedia.test.ts
git commit -m "feat: extract official GPT-Live demo clips"
```

### Task 4: Render One Shared Narration And Neutral Tella Master Clips

**Files:**
- Create: `src/production/gptLive/prepare.ts`
- Create: `src/production/gptLive/tellaPlan.ts`
- Create: `src/production/gptLive/cli.ts`
- Modify: `src/config/env.ts`
- Test: `tests/gptLiveContent.test.ts`

- [ ] **Step 1: Add failing Tella-plan assertions**

Assert that `buildTellaPlan()`:

- Produces nine ordered clips.
- Marks source clips as `preserveOriginalAudio: true`.
- Maps each narration clip to exactly one A plate and one B plate.
- Uses identical narration audio paths for both variants.

- [ ] **Step 2: Run the test and verify failure**

```bash
corepack pnpm vitest run tests/gptLiveContent.test.ts
```

Expected: FAIL because `buildTellaPlan` is undefined.

- [ ] **Step 3: Add required environment keys**

Add these to `DEFAULT_ENV_KEYS`:

```ts
"AIMH_LOGO_PATH",
"AIMH_BODY_MUSIC_PATH"
```

Default them from `AIMH_VIDEO_ENGINE_PATH` in `loadEnvSnapshot()`:

```ts
values.AIMH_LOGO_PATH ??= `${values.AIMH_VIDEO_ENGINE_PATH}/assets/logo.png`;
values.AIMH_BODY_MUSIC_PATH ??= `${values.AIMH_VIDEO_ENGINE_PATH}/assets/music/Body_Komorebi_Futuremono.mp3`;
```

- [ ] **Step 4: Implement preparation**

`prepareGptLiveProduction()` must:

1. Create `episodes/2026-07-10-gpt-live-tella-ab/{source,voice,master,plates,tella,exports,final,reports}`.
2. Extract both official source clips.
3. Convert the seven narration records into the existing `ScriptFile` shape.
4. Call `synthesizeNarration()` with `allowElevenLabs: true`.
5. Fail if the returned provider is not exactly `elevenlabs` or if warnings are non-empty.
6. Create one 1920x1080 black H.264/AAC slate per narration MP3, using the MP3 duration and preserving the audio.
7. Write `production.json`, `voice/narration.json`, `tella/plan.json`, and `reports/source-matrix.md`.

The CLI must accept:

```bash
corepack pnpm gpt-live:prepare -- --episode-dir episodes/2026-07-10-gpt-live-tella-ab
```

- [ ] **Step 5: Run the focused tests and preparation dry check**

```bash
corepack pnpm vitest run tests/gptLiveContent.test.ts tests/gptLiveMedia.test.ts
corepack pnpm lint
```

Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add src/config/env.ts src/production/gptLive/prepare.ts src/production/gptLive/tellaPlan.ts src/production/gptLive/cli.ts tests/gptLiveContent.test.ts
git commit -m "feat: prepare shared GPT-Live Tella master"
```

### Task 5: Build The Reusable A/B Motion Plate Renderer

**Files:**
- Create: `src/production/gptLive/motion/Root.tsx`
- Create: `src/production/gptLive/motion/GptLivePlate.tsx`
- Create: `src/production/gptLive/motion/sceneStyle.ts`
- Create: `src/production/gptLive/renderPlates.ts`
- Create: `tests/gptLiveMotion.test.ts`

- [ ] **Step 1: Write failing variant and safe-area tests**

Test the pure `sceneStyle()` contract:

```ts
expect(sceneStyle("dynamic_editorial", "use_cases")).toMatchObject({
  persistentHost: false,
  maxStaticFrames: 180
});
expect(sceneStyle("aimh_visual_host", "use_cases")).toMatchObject({
  persistentHost: true,
  reservedTopRight: { width: 198, height: 198 }
});
```

The 198-pixel reservation includes the 150-pixel logo plus 24-pixel edge margin and 24-pixel internal clearance.

- [ ] **Step 2: Run the test and verify failure**

```bash
corepack pnpm vitest run tests/gptLiveMotion.test.ts
```

Expected: FAIL because the motion modules do not exist.

- [ ] **Step 3: Implement the seven scene treatments**

`GptLivePlate.tsx` must use Remotion `AbsoluteFill`, `Sequence`, `interpolate`, `spring`, `useCurrentFrame`, and `useVideoConfig` to render:

- `hook`: language labels and a live translation waveform.
- `full_duplex`: animated walkie-talkie queue transforming into overlapping listen/speak tracks.
- `use_cases`: six fast use-case reveals with no card held longer than six seconds.
- `evidence`: Tom's Guide attribution and an OpenAI-reported benchmark comparison.
- `availability`: Free mini versus paid full model, with limitations shown as concise labels.
- `future`: voice-to-action, systems-to-voice, and voice-to-voice flow.
- `cta`: the final human takeaway and audience comment prompt.

Variant A uses full-frame media, large kinetic type, and scene-specific compositions. Variant B uses the same scene content with a persistent left or bottom AIMH waveform rail. Neither variant may draw inside the top-right 198x198 safe area.

- [ ] **Step 4: Register dynamic-duration composition**

`Root.tsx` must define `GptLivePlate` at 1920x1080, 30 fps, with `calculateMetadata` setting `durationInFrames` from `durationSeconds` input.

- [ ] **Step 5: Implement plate rendering**

`renderPlates.ts` must:

- Bundle `Root.tsx` once.
- Render one silent H.264 plate for each narration segment and each variant.
- Use the exact ElevenLabs duration from `voice/narration.json`.
- Write paths into `tella/plan.json`.
- Verify each output is 1920x1080, 30 fps, and within 0.1 seconds of its narration slate.

- [ ] **Step 6: Run unit and visual smoke tests**

```bash
corepack pnpm vitest run tests/gptLiveMotion.test.ts
corepack pnpm lint
corepack pnpm build
```

Render one frame per scene and inspect a contact sheet. Expected: all seven scenes are nonblank, text remains inside bounds, and the top-right logo area is clear.

- [ ] **Step 7: Commit**

```bash
git add src/production/gptLive/motion src/production/gptLive/renderPlates.ts tests/gptLiveMotion.test.ts
git commit -m "feat: render GPT-Live editorial and AIMH host plates"
```

### Task 6: Prepare Real Assets And Review The Shared Script

**Files:**
- Generated: `episodes/2026-07-10-gpt-live-tella-ab/**`

- [ ] **Step 1: Run full local preparation**

```bash
corepack pnpm gpt-live:prepare -- --episode-dir episodes/2026-07-10-gpt-live-tella-ab
```

Expected:

- Two official source clips with original audio.
- Seven ElevenLabs MP3 files with no fallback warnings.
- Seven narration slates.
- Fourteen silent A/B motion plates.
- `tella/plan.json` with nine ordered clips.

- [ ] **Step 2: Verify source excerpts**

Watch both excerpts with sound. Confirm the translation excerpt starts on French speech and reaches a complete English translation; confirm the interruption excerpt includes the simplify request and full-duplex explanation without clipped words.

- [ ] **Step 3: Verify narration and claims**

Listen to all seven MP3s in order while reading `reports/source-matrix.md`. Fix pronunciation or wording in tracked `content.ts`, delete only the affected cached MP3, and rerun preparation.

- [ ] **Step 4: Verify runtime**

Sum source-clip and narration durations from `tella/plan.json`.

Expected: total between 120 and 180 seconds, targeting approximately 160-170 seconds.

### Task 7: Assemble And Duplicate The Shared Tella Master

**Files:**
- Generated: `episodes/2026-07-10-gpt-live-tella-ab/tella/state.json`

- [ ] **Step 1: Upload all nine base clips**

For every ordered base clip in `tella/plan.json`:

1. Call `mcp__tella__create_source` with `kind: "video"`, exact duration, width `1920`, and height `1080`.
2. PUT the local MP4 bytes to the returned `uploadUrl` without remuxing.
3. Record the returned `sourceId` in `tella/state.json` without storing upload URLs.

- [ ] **Step 2: Create the shared master**

Call `mcp__tella__create_video` with the first source ID, name `GPT-Live - Shared Content Master`, dimensions `1920x1080`, `captionsEnabled: false`, and `studioSound: false`.

Upload the remaining eight clips in order with `mcp__tella__upload_clip`. Record every returned clip ID against the timeline item ID.

- [ ] **Step 3: Verify master sequence**

Use Tella clip listing and export a low-risk preview. Confirm:

- Nine clips in the expected order.
- Original audio on the two OpenAI excerpts.
- Shared ElevenLabs audio on all narration clips.
- No duplicate or missing clip.

- [ ] **Step 4: Duplicate for both variants**

Call `mcp__tella__duplicate_video` twice:

- `GPT-Live - A Dynamic Editorial`
- `GPT-Live - B AIMH Visual Host`

Record both video IDs in `tella/state.json`.

### Task 8: Apply A/B Motion Plates In Tella And Export

**Files:**
- Generated: `episodes/2026-07-10-gpt-live-tella-ab/tella/state.json`
- Generated: `episodes/2026-07-10-gpt-live-tella-ab/exports/tella-a.mp4`
- Generated: `episodes/2026-07-10-gpt-live-tella-ab/exports/tella-b.mp4`

- [ ] **Step 1: Upload fourteen motion plates**

For every A/B plate, call `mcp__tella__create_source` with its exact duration and dimensions, upload the original rendered MP4, and record its `sourceId`.

- [ ] **Step 2: Apply Version A plates**

For each of the seven narration clips in Version A, build the tool input from the persisted state:

```ts
const input = {
  id: state.clipIds[item.id],
  videoId: state.variantVideoIds.dynamic_editorial!,
  startTimeMs: 0,
  durationMs: Math.round(item.durationSeconds * 1000),
  media: {
    type: "video" as const,
    sourceId: state.sourceIds[`plate:dynamic_editorial:${item.id}`],
    slot: "screen" as const
  },
  transitionStyle: "hardCut" as const
};
```

Validate that all four state lookups are present, then call `mcp__tella__add_layout(input)`.

- [ ] **Step 3: Apply Version B plates**

Repeat with `state.variantVideoIds.aimh_visual_host` and `state.sourceIds[\`plate:aimh_visual_host:${item.id}\`]`. Do not add a second Tella watermark; the shared AIMH logo is applied after export.

- [ ] **Step 4: Export both variants**

Call `mcp__tella__export_video` with `fps: "30"`, `speed: "1"`, `granularity: "video"`, and `subtitles: false` for both variant IDs. Download the completed exports to the exact paths above.

- [ ] **Step 5: Verify controlled timing**

Run `ffprobe` on both exports.

Expected: both are 1920x1080, 30 fps, contain H.264 video plus AAC audio, and differ in duration by no more than 0.5 seconds.

### Task 9: Add Shared Music And Exact AIMH Logo Treatment

**Files:**
- Create: `src/production/gptLive/finish.ts`
- Create: `tests/gptLiveFinish.test.ts`
- Generated: `episodes/2026-07-10-gpt-live-tella-ab/final/version-a.mp4`
- Generated: `episodes/2026-07-10-gpt-live-tella-ab/final/version-b.mp4`

- [ ] **Step 1: Write failing post-production tests**

Assert that `buildLogoFilter()` returns exactly:

```text
[1:v]scale=150:-1,format=rgba,colorchannelmixer=aa=0.85[lg];[0:v][lg]overlay=W-w-24:24
```

Assert that the music plan uses the same source path and volume for both variants and mutes or sharply ducks during the two source-dialogue intervals derived from the shared timeline.

- [ ] **Step 2: Run the tests and verify failure**

```bash
corepack pnpm vitest run tests/gptLiveFinish.test.ts
```

Expected: FAIL because `finish.ts` does not exist.

- [ ] **Step 3: Implement deterministic finishing**

`finishVariant()` must:

1. Loop `Body_Komorebi_Futuremono.mp3` to the video duration.
2. Mix it below speech at a conservative level identical in both variants.
3. Apply volume envelopes that duck further during official source excerpts.
4. Overlay `/Users/dennywii/Documents/dev/aimh-video-engine/assets/logo.png` at 150 pixels wide, 24 pixels from top/right, 85% opacity.
5. Encode H.264 CRF 18, `yuv420p`, AAC 192 kbps, 48 kHz stereo.
6. Write a post-production manifest containing only paths, durations, and non-secret settings.

- [ ] **Step 4: Run focused tests**

```bash
corepack pnpm vitest run tests/gptLiveFinish.test.ts
corepack pnpm lint
```

Expected: PASS.

- [ ] **Step 5: Finish both exports**

```bash
corepack pnpm gpt-live:finish -- --episode-dir episodes/2026-07-10-gpt-live-tella-ab
```

Expected: both final MP4 files exist with identical audio treatment and logo geometry.

- [ ] **Step 6: Commit**

```bash
git add src/production/gptLive/finish.ts tests/gptLiveFinish.test.ts
git commit -m "feat: finish GPT-Live variants with AIMH branding"
```

### Task 10: Run Full Editorial, Media, And A/B QA

**Files:**
- Create: `src/production/gptLive/qa.ts`
- Modify: `src/production/gptLive/cli.ts`
- Modify: `tests/gptLiveContent.test.ts`
- Create: `episodes/2026-07-10-gpt-live-tella-ab/reports/qa.json`
- Create: `episodes/2026-07-10-gpt-live-tella-ab/reports/comparison.md`

- [ ] **Step 1: Add failing QA tests**

Test that QA fails when:

- A claim has no source.
- Either voice provider is not ElevenLabs.
- A/B duration delta exceeds 0.5 seconds.
- Resolution is not 1920x1080.
- A motion scene reserves less than 198x198 for the logo corner.
- Either final file is missing.

- [ ] **Step 2: Run the tests and verify failure**

```bash
corepack pnpm vitest run tests/gptLiveContent.test.ts tests/gptLiveFinish.test.ts
```

Expected: FAIL until the QA runner is implemented.

- [ ] **Step 3: Implement machine QA**

Write `qa.json` checks for:

- source coverage;
- clip provenance;
- ElevenLabs-only narration;
- source-audio presence;
- A/B duration parity;
- video/audio codecs;
- 1920x1080 at 30 fps;
- logo treatment and safe-area contract;
- YouTube upload disabled.

- [ ] **Step 4: Generate visual review artifacts**

For each final video:

- Create a 12-frame contact sheet spanning the runtime.
- Extract frames at both source excerpts, every visual-scene transition, and the final CTA.
- Extract the final 10 seconds of audio.
- Run a canvas-pixel/nonblank check on every sampled frame.

- [ ] **Step 5: Perform complete real-time review**

Watch both videos from start to finish with sound. Record findings in `comparison.md` under:

- Hook strength
- Use-case clarity
- Translation demonstration
- Pacing
- Text legibility
- Logo placement
- Version A continuity
- Version B host usefulness
- Audio and source-dialogue clarity
- Final CTA

Fix any issue before marking QA as passing.

- [ ] **Step 6: Run all verification**

```bash
corepack pnpm test
corepack pnpm lint
corepack pnpm build
corepack pnpm gpt-live:qa -- --episode-dir episodes/2026-07-10-gpt-live-tella-ab
git status --short
```

Expected:

- All tests pass.
- Type-check and build pass.
- QA reports `ok: true` for both videos.
- No YouTube upload occurs.
- Only intentional source changes and ignored generated episode files remain.

- [ ] **Step 7: Commit QA tooling**

```bash
git add src/production/gptLive/qa.ts src/production/gptLive/cli.ts tests/gptLiveContent.test.ts
git commit -m "test: verify GPT-Live Tella A/B productions"
```

## Execution Notes

- Run implementation in an isolated git worktree before modifying source files.
- Never print `.env`, ElevenLabs credentials, Tella upload URLs, or signed Vimeo playlist URLs.
- Persist Tella video IDs, source IDs, and clip IDs, but never persist presigned upload URLs.
- Keep the generated episode directory ignored.
- Do not upload either video to YouTube.
- Preserve the shared audio/content master so future visual variants can be tested without re-synthesizing narration.
