# GPT-5.6 Two-Cut and Newsroom Workflow Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build reusable media-rich, evidence-first newsroom capabilities and use them to produce two locally reviewable GPT-5.6 cuts without uploading.

**Architecture:** Add small reusable modules for editorial materiality, primary-page media manifests, speech overrides, and deterministic episode music. Add a generic Remotion evidence plate that can sequence source videos, interactive captures, and animated screenshot crops, then drive it through a GPT-5.6 revision manifest with two edit variants. Preserve the existing render, synthesize changed narration through ElevenLabs, render both cuts, and give each its own QA package.

**Tech Stack:** TypeScript, Vitest, Playwright, Remotion 4, ElevenLabs, FFmpeg/FFprobe, JSON episode manifests.

---

## File Structure

- Create `src/editorial/researchManifest.ts` — validate independent-source search effort and material inclusion decisions.
- Create `src/capture/mediaManifest.ts` — describe and validate all primary-page motion, interactive, and static evidence.
- Modify `src/types.ts` — add optional speech overrides and motion-aware shot kinds without breaking the MVP package.
- Modify `src/voice/elevenLabsAdapter.ts` — synthesize and cache `speech_text` while preserving display text.
- Create `src/render/outroMusic.ts` — discover, choose, and persist an episode-level outro.
- Create `src/production/newsroom/motion/types.ts` — generic evidence-beat and plate props.
- Create `src/production/newsroom/motion/NewsroomEvidencePlate.tsx` — video playback, context-to-crop screenshots, source labels, and beat timing.
- Create `src/production/newsroom/motion/Root.tsx` — Remotion composition registration and metadata.
- Create `src/production/gpt56Revision.ts` — two-variant manifest, narration, staging, rendering, and QA orchestration.
- Modify `package.json` — local-only GPT-5.6 revision commands with no upload command.
- Create `tests/newsroomEditorial.test.ts` — research and media manifest behavior.
- Modify `tests/voice.test.ts` — speech override and cache provenance.
- Create `tests/outroMusic.test.ts` — candidate filtering, stable selection, and previous-track avoidance.
- Create `tests/newsroomMotion.test.ts` — zoom geometry and beat timing.
- Create `tests/gpt56Revision.test.ts` — two-cut contract, hero/demo use, phrase locks, and no-upload command surface.
- Create `episodes/2026-07-13-gpt-5-6/research-manifest.json` — source candidates and materiality decisions.
- Create `episodes/2026-07-13-gpt-5-6/media-manifest.json` — complete primary media inventory.
- Create `episodes/2026-07-13-gpt-5-6/script-a.json` and `script-b.json` — approved variant scripts.
- Create captured motion/source assets under `episodes/2026-07-13-gpt-5-6/source/` and `evidence/`.
- Modify `docs/source-policy.md` — make search effort mandatory and inclusion materiality-based.
- Modify `RESULTS.md` and `REVIEW.md` — builder evidence and critic findings.

### Task 1: Research materiality gate

**Files:**
- Create: `src/editorial/researchManifest.ts`
- Create: `tests/newsroomEditorial.test.ts`
- Modify: `docs/source-policy.md`

- [ ] **Step 1: Write failing research-manifest tests**

```ts
import { describe, expect, it } from "vitest";
import { validateResearchManifest } from "../src/editorial/researchManifest";

describe("newsroom related-source research", () => {
  it("allows fewer than two selected sources when rejected candidates have materiality reasons", () => {
    expect(() => validateResearchManifest({
      schema_version: "0.1.0",
      primary_source_id: "primary",
      candidates: [
        { id: "hands-on", independent: true, evidence_type: "hands_on", novelty: 3, story_impact: 3, decision: "selected", rationale: "Tests a real task." },
        { id: "repeat", independent: true, evidence_type: "reporting", novelty: 0, story_impact: 0, decision: "rejected", rationale: "Repeats the announcement." }
      ]
    })).not.toThrow();
  });

  it("rejects an unrecorded independent-source search", () => {
    expect(() => validateResearchManifest({ schema_version: "0.1.0", primary_source_id: "primary", candidates: [] }))
      .toThrow(/at least two independent candidates/);
  });

  it("rejects a selected source that has no material contribution", () => {
    expect(() => validateResearchManifest({
      schema_version: "0.1.0",
      primary_source_id: "primary",
      candidates: [
        { id: "a", independent: true, evidence_type: "hands_on", novelty: 0, story_impact: 0, decision: "selected", rationale: "Repeats release." },
        { id: "b", independent: true, evidence_type: "reporting", novelty: 0, story_impact: 0, decision: "rejected", rationale: "No new evidence." }
      ]
    })).toThrow(/material contribution/);
  });
});
```

- [ ] **Step 2: Run the research tests and verify RED**

Run: `pnpm vitest run tests/newsroomEditorial.test.ts`

Expected: FAIL because `src/editorial/researchManifest.ts` does not exist.

- [ ] **Step 3: Implement the research manifest validator**

```ts
export type ResearchDecision = "selected" | "rejected";
export type EvidenceType = "hands_on" | "real_world_example" | "reporting" | "analysis";

export interface ResearchCandidate {
  id: string;
  independent: boolean;
  evidence_type: EvidenceType;
  novelty: 0 | 1 | 2 | 3;
  story_impact: 0 | 1 | 2 | 3;
  decision: ResearchDecision;
  rationale: string;
}

export interface ResearchManifest {
  schema_version: "0.1.0";
  primary_source_id: string;
  candidates: ResearchCandidate[];
}

export function validateResearchManifest(manifest: ResearchManifest): void {
  const independent = manifest.candidates.filter((candidate) => candidate.independent);
  if (independent.length < 2) throw new Error("Research must record at least two independent candidates");
  if (!independent.some((candidate) => candidate.evidence_type === "hands_on" || candidate.evidence_type === "real_world_example")) {
    throw new Error("Research must include a hands-on test or concrete real-world example when available");
  }
  for (const candidate of manifest.candidates) {
    if (!candidate.rationale.trim()) throw new Error(`Research candidate ${candidate.id} needs a rationale`);
    if (candidate.decision === "selected" && candidate.novelty + candidate.story_impact < 2) {
      throw new Error(`Selected source ${candidate.id} has no material contribution`);
    }
  }
}
```

- [ ] **Step 4: Run the research tests and verify GREEN**

Run: `pnpm vitest run tests/newsroomEditorial.test.ts`

Expected: PASS.

- [ ] **Step 5: Update source policy and commit**

Add the search-effort/materiality rule from the approved spec to `docs/source-policy.md`, then run `git diff --check` and commit:

```bash
git add src/editorial/researchManifest.ts tests/newsroomEditorial.test.ts docs/source-policy.md
git commit -m "feat: require material newsroom source research"
```

### Task 2: Primary-page media inventory gate

**Files:**
- Create: `src/capture/mediaManifest.ts`
- Modify: `tests/newsroomEditorial.test.ts`

- [ ] **Step 1: Add failing media-manifest tests**

```ts
import { validateMediaManifest } from "../src/capture/mediaManifest";

it("accepts selected and explicitly rejected videos, embeds, and interactives", () => {
  expect(() => validateMediaManifest({
    schema_version: "0.1.0",
    primary_url: "https://example.com/story",
    audit_complete: true,
    items: [
      { id: "hero", kind: "video", source_url: "https://example.com/hero.mp4", decision: "selected", rationale: "Opening motion evidence." },
      { id: "demo", kind: "interactive", source_url: "https://example.com/demo", decision: "selected", rationale: "Shows the built result." },
      { id: "repeat", kind: "iframe", source_url: "https://example.com/repeat", decision: "rejected", rationale: "Duplicates the demo." }
    ]
  })).not.toThrow();
});

it("rejects present media without a decision rationale", () => {
  expect(() => validateMediaManifest({
    schema_version: "0.1.0",
    primary_url: "https://example.com/story",
    audit_complete: true,
    items: [{ id: "hero", kind: "video", source_url: "https://example.com/hero.mp4", decision: "rejected", rationale: "" }]
  })).toThrow(/rationale/);
});
```

- [ ] **Step 2: Run the test and verify RED**

Run: `pnpm vitest run tests/newsroomEditorial.test.ts`

Expected: FAIL because `validateMediaManifest` is missing.

- [ ] **Step 3: Implement the media manifest types and validation**

```ts
export type MediaKind = "video" | "interactive" | "iframe" | "gallery" | "image" | "text_evidence";

export interface MediaItem {
  id: string;
  kind: MediaKind;
  source_url: string;
  local_asset?: string;
  decision: "selected" | "rejected";
  rationale: string;
}

export interface MediaManifest {
  schema_version: "0.1.0";
  primary_url: string;
  audit_complete: boolean;
  items: MediaItem[];
}

export function validateMediaManifest(manifest: MediaManifest): void {
  if (!manifest.audit_complete) throw new Error("Primary-page media audit is incomplete");
  if (manifest.items.length === 0) throw new Error("Primary-page media audit recorded no items");
  const seen = new Set<string>();
  for (const item of manifest.items) {
    if (seen.has(item.id)) throw new Error(`Duplicate media item: ${item.id}`);
    seen.add(item.id);
    if (!item.rationale.trim()) throw new Error(`Media item ${item.id} needs a decision rationale`);
    new URL(item.source_url);
  }
}
```

- [ ] **Step 4: Run the test and verify GREEN**

Run: `pnpm vitest run tests/newsroomEditorial.test.ts`

Expected: PASS.

- [ ] **Step 5: Commit the media gate**

```bash
git add src/capture/mediaManifest.ts tests/newsroomEditorial.test.ts
git commit -m "feat: add primary article media inventory"
```

### Task 3: Phrase-locked narration

**Files:**
- Modify: `src/types.ts`
- Modify: `src/voice/elevenLabsAdapter.ts`
- Modify: `tests/voice.test.ts`

- [ ] **Step 1: Add a failing speech override test**

```ts
it("uses speech_text for synthesis and cache identity while preserving display text", () => {
  const paragraph = {
    ...scriptWithText("Programmatic Tool Calling").narration[0]!,
    speech_text: "Programmatic tool-calling",
    critical_phrases: ["Programmatic Tool Calling"]
  };
  const request = buildSpeechRequestBodyForParagraph(paragraph, env());
  expect(request.text).toBe("Programmatic tool-calling");
  expect(buildVoiceCacheKeyForParagraph({ paragraph, env: env() }))
    .not.toBe(buildVoiceCacheKey({ text: paragraph.text, env: env() }));
});
```

- [ ] **Step 2: Run the test and verify RED**

Run: `pnpm vitest run tests/voice.test.ts -t "speech_text"`

Expected: FAIL because paragraph-aware speech helpers do not exist.

- [ ] **Step 3: Add the optional fields and paragraph-aware request**

```ts
// src/types.ts narration entry
speech_text?: string;
critical_phrases?: string[];

export function buildSpeechRequestBodyForParagraph(
  paragraph: ScriptFile["narration"][number],
  env: Env
): Record<string, unknown> {
  return buildSpeechRequestBody(paragraph.speech_text ?? paragraph.text, env);
}

export function buildVoiceCacheKeyForParagraph(options: {
  paragraph: ScriptFile["narration"][number];
  env: Env;
}): string {
  return buildVoiceCacheKey({ text: options.paragraph.speech_text ?? options.paragraph.text, env: options.env });
}
```

Use these helpers inside `synthesizeElevenLabsChunk`; keep `VoiceChunkResult.text` equal to display text.

- [ ] **Step 4: Run voice tests and verify GREEN**

Run: `pnpm vitest run tests/voice.test.ts`

Expected: PASS with no extra ElevenLabs request.

- [ ] **Step 5: Commit phrase locking**

```bash
git add src/types.ts src/voice/elevenLabsAdapter.ts tests/voice.test.ts
git commit -m "feat: support phrase-locked narration text"
```

### Task 4: Episode-level randomized outro selection

**Files:**
- Create: `src/render/outroMusic.ts`
- Create: `tests/outroMusic.test.ts`

- [ ] **Step 1: Write failing selection tests**

```ts
import { describe, expect, it } from "vitest";
import { chooseEpisodeOutro, filterOutroCandidates } from "../src/render/outroMusic";

describe("episode outro music", () => {
  const files = ["Body_A.mp3", "Outro_A.mp3", "Outro_B.mp3", ".DS_Store"];
  it("uses only Outro MP3 files", () => expect(filterOutroCandidates(files)).toEqual(["Outro_A.mp3", "Outro_B.mp3"]));
  it("is stable for the same episode seed", () => expect(chooseEpisodeOutro("episode-a", files)).toBe(chooseEpisodeOutro("episode-a", files)));
  it("avoids the previous track when another candidate exists", () => expect(chooseEpisodeOutro("episode-a", files, "Outro_A.mp3")).toBe("Outro_B.mp3"));
  it("fails with no outro candidates", () => expect(() => chooseEpisodeOutro("episode-a", ["Body_A.mp3"])).toThrow(/No outro music/));
});
```

- [ ] **Step 2: Run the test and verify RED**

Run: `pnpm vitest run tests/outroMusic.test.ts`

Expected: FAIL because the selector module does not exist.

- [ ] **Step 3: Implement filtering and seeded selection**

```ts
import { createHash } from "node:crypto";

export const filterOutroCandidates = (files: readonly string[]): string[] =>
  files.filter((file) => /^Outro_.*\.mp3$/i.test(file)).sort();

export function chooseEpisodeOutro(seed: string, files: readonly string[], previous?: string): string {
  const candidates = filterOutroCandidates(files);
  if (candidates.length === 0) throw new Error("No outro music candidates found");
  const eligible = candidates.length > 1 && previous ? candidates.filter((item) => item !== previous) : candidates;
  const hash = createHash("sha256").update(seed).digest();
  return eligible[hash.readUInt32BE(0) % eligible.length]!;
}
```

- [ ] **Step 4: Run tests and verify GREEN**

Run: `pnpm vitest run tests/outroMusic.test.ts`

Expected: PASS.

- [ ] **Step 5: Commit outro selection**

```bash
git add src/render/outroMusic.ts tests/outroMusic.test.ts
git commit -m "feat: rotate newsroom outro music by episode"
```

### Task 5: Generic motion, interactive, and zoom evidence plate

**Files:**
- Create: `src/production/newsroom/motion/types.ts`
- Create: `src/production/newsroom/motion/NewsroomEvidencePlate.tsx`
- Create: `src/production/newsroom/motion/Root.tsx`
- Create: `tests/newsroomMotion.test.ts`

- [ ] **Step 1: Write failing beat and zoom tests**

```ts
import { describe, expect, it } from "vitest";
import { beatAtFrame, zoomTransformAtFrame } from "../src/production/newsroom/motion/NewsroomEvidencePlate";

describe("newsroom evidence motion", () => {
  it("maps exact frame boundaries to the next visual beat", () => {
    const beats = [{ durationFrames: 30 }, { durationFrames: 60 }];
    expect(beatAtFrame(beats, 29)).toEqual({ index: 0, localFrame: 29 });
    expect(beatAtFrame(beats, 30)).toEqual({ index: 1, localFrame: 0 });
  });

  it("moves from contained page context to a focal crop", () => {
    const start = zoomTransformAtFrame({ frame: 0, durationFrames: 90, focalRect: { x: .35, y: .2, width: .4, height: .25 } });
    const end = zoomTransformAtFrame({ frame: 89, durationFrames: 90, focalRect: { x: .35, y: .2, width: .4, height: .25 } });
    expect(start.scale).toBeCloseTo(1);
    expect(end.scale).toBeGreaterThanOrEqual(1.6);
  });
});
```

- [ ] **Step 2: Run the test and verify RED**

Run: `pnpm vitest run tests/newsroomMotion.test.ts`

Expected: FAIL because the generic motion plate does not exist.

- [ ] **Step 3: Define generic motion types**

```ts
export interface FocalRect { x: number; y: number; width: number; height: number; }
export type EvidenceBeat =
  | { id: string; kind: "video" | "interactive_capture"; assetPath: string; durationFrames: number; sourceLabel: string; headline: string; startFromFrames?: number }
  | { id: string; kind: "source_zoom" | "image"; assetPath: string; durationFrames: number; sourceLabel: string; headline: string; focalRect: FocalRect };

export interface NewsroomEvidencePlateProps extends Record<string, unknown> {
  durationSeconds: number;
  beats: EvidenceBeat[];
  seriesLabel: string;
}
```

- [ ] **Step 4: Implement beat sequencing and motion rendering**

`NewsroomEvidencePlate.tsx` uses `OffthreadVideo` for motion beats and `Img` plus an interpolated translate/scale for static evidence. It places a high-contrast source chip at lower left, a concise headline at upper left, and uses a short dissolve between beats. `Root.tsx` registers `NewsroomEvidencePlate` at 1920×1080, 30 fps.

Core pure helpers:

```ts
export function beatAtFrame(beats: readonly Pick<EvidenceBeat, "durationFrames">[], frame: number) {
  let cursor = 0;
  for (const [index, beat] of beats.entries()) {
    if (frame < cursor + beat.durationFrames) return { index, localFrame: frame - cursor };
    cursor += beat.durationFrames;
  }
  return { index: beats.length - 1, localFrame: Math.max(0, frame - cursor) };
}
```

- [ ] **Step 5: Run motion tests and verify GREEN**

Run: `pnpm vitest run tests/newsroomMotion.test.ts`

Expected: PASS.

- [ ] **Step 6: Render a five-second smoke plate**

Run the composition against one PNG and one local MP4; inspect with FFprobe for H.264, 1920×1080, 30 fps, and no audio.

- [ ] **Step 7: Commit the reusable motion plate**

```bash
git add src/production/newsroom/motion tests/newsroomMotion.test.ts
git commit -m "feat: render moving and zoomed newsroom evidence"
```

### Task 6: GPT-5.6 revision contract and two local commands

**Files:**
- Create: `src/production/gpt56Revision.ts`
- Create: `tests/gpt56Revision.test.ts`
- Modify: `package.json`

- [ ] **Step 1: Write failing two-cut contract tests**

```ts
import { describe, expect, it } from "vitest";
import { GPT56_REVISION, parseGpt56RevisionCommand, validateGpt56Revision } from "../src/production/gpt56Revision";

describe("GPT-5.6 two-cut revision", () => {
  it("defines evidence and demo variants using the top film and live Saltwind", () => {
    expect(() => validateGpt56Revision(GPT56_REVISION)).not.toThrow();
    expect(GPT56_REVISION.variants.map((item) => item.id)).toEqual(["a-evidence", "b-demo"]);
    for (const variant of GPT56_REVISION.variants) {
      expect(variant.beats.some((beat) => beat.assetPath.endsWith("openai-launch.mp4"))).toBe(true);
      expect(variant.beats.some((beat) => beat.kind === "interactive_capture" && beat.assetPath.includes("saltwind"))).toBe(true);
    }
  });

  it("phrase-locks Programmatic Tool Calling", () => {
    const chunks = GPT56_REVISION.variants.flatMap((variant) => variant.script.narration);
    const practical = chunks.find((chunk) => chunk.text.includes("Programmatic Tool Calling"));
    expect(practical?.speech_text).toContain("tool-calling");
    expect(practical?.critical_phrases).toContain("Programmatic Tool Calling");
  });

  it("has no upload command", () => {
    expect(() => parseGpt56RevisionCommand("upload")).toThrow(/Unsupported/);
  });
});
```

- [ ] **Step 2: Run the contract test and verify RED**

Run: `pnpm vitest run tests/gpt56Revision.test.ts`

Expected: FAIL because `gpt56Revision.ts` does not exist.

- [ ] **Step 3: Implement the revision manifest and validators**

Create two variant definitions with separate narration and beat maps. Require the launch film, at least one live interactive capture, at least one embedded build clip, independent evidence, source zoom geometry, and critical phrase locks in both variants. Supported commands are exactly `voice`, `render`, `qa`, and `all` with an optional `--variant` of `a-evidence`, `b-demo`, or `both`.

- [ ] **Step 4: Add local-only package scripts**

```json
"gpt56:revision:voice": "tsx src/production/gpt56Revision.ts voice",
"gpt56:revision:render": "tsx src/production/gpt56Revision.ts render",
"gpt56:revision:qa": "tsx src/production/gpt56Revision.ts qa",
"gpt56:revision:all": "tsx src/production/gpt56Revision.ts all"
```

- [ ] **Step 5: Run contract tests and verify GREEN**

Run: `pnpm vitest run tests/gpt56Revision.test.ts`

Expected: PASS.

- [ ] **Step 6: Commit the revision contract**

```bash
git add src/production/gpt56Revision.ts tests/gpt56Revision.test.ts package.json
git commit -m "feat: define GPT-5.6 evidence and demo cuts"
```

### Task 7: Capture and seal episode evidence

**Files:**
- Create: `episodes/2026-07-13-gpt-5-6/research-manifest.json`
- Create: `episodes/2026-07-13-gpt-5-6/media-manifest.json`
- Create: `episodes/2026-07-13-gpt-5-6/source/saltwind-gameplay.mp4`
- Create: `episodes/2026-07-13-gpt-5-6/source/spirograph-build.mp4`
- Create: independent-source evidence PNGs under `episodes/2026-07-13-gpt-5-6/evidence/`
- Create: `episodes/2026-07-13-gpt-5-6/script-a.json`
- Create: `episodes/2026-07-13-gpt-5-6/script-b.json`

- [ ] **Step 1: Preserve the approved baseline**

Copy `render/final.mp4` to `render/final-baseline.mp4` only if the baseline path does not already exist. Verify both hashes match before any render cleanup.

- [ ] **Step 2: Seal related-source research**

Record the OpenAI primary source; CodeRabbit and Simon Willison as selected candidates; and all reviewed but excluded candidates with materiality reasons. Add each selected external claim to `sources.json` with explicit attribution and access date.

- [ ] **Step 3: Seal the primary media inventory**

Record the 15-second launch film, Saltwind, other tabbed experiences, spirograph, wave interference, tokenizer, and static text evidence. Every entry gets a selected/rejected decision and rationale.

- [ ] **Step 4: Capture Saltwind gameplay**

Use Playwright at 1920×1080. Start the regatta, send steering/sail/gust controls, and record at least 18 seconds where the boat and telemetry visibly change. Convert to H.264/yuv420p/30 fps and validate duration and frame difference.

- [ ] **Step 5: Acquire one embedded build video**

Resolve the official Vimeo config to HLS using the existing safe resolver, then extract a 10–15 second spirograph section to H.264/yuv420p/30 fps. Preserve the OpenAI source URL in the media manifest.

- [ ] **Step 6: Capture related-source evidence**

Capture legible CodeRabbit and Simon Willison evidence at 1440 pixels or greater, with the relevant result visible. Do not reproduce long article text; use the screenshot as evidence under summarized narration.

- [ ] **Step 7: Create variant scripts and validate manifests**

Version A targets roughly 3:20–3:40. Version B targets roughly 3:05–3:25. Both include `speech_text: "Programmatic tool-calling"` in the practical chunk and the same selected claims.

- [ ] **Step 8: Commit sealed manifests and scripts**

```bash
git add episodes/2026-07-13-gpt-5-6/research-manifest.json episodes/2026-07-13-gpt-5-6/media-manifest.json episodes/2026-07-13-gpt-5-6/sources.json episodes/2026-07-13-gpt-5-6/script-a.json episodes/2026-07-13-gpt-5-6/script-b.json
git commit -m "content: seal GPT-5.6 revision evidence"
```

### Task 8: Synthesize and render both variants

**Files:**
- Modify: `src/production/gpt56Revision.ts`
- Modify: `tests/gpt56Revision.test.ts`
- Create: `episodes/2026-07-13-gpt-5-6/render/final-a-evidence.mp4`
- Create: `episodes/2026-07-13-gpt-5-6/render/final-b-demo.mp4`

- [ ] **Step 1: Add failing render-command tests**

Test that each variant stages all referenced assets, assigns beat durations equal to each narration duration, writes separate segment/output directories, uses the same persisted outro path, and never deletes `final-baseline.mp4`.

- [ ] **Step 2: Run the render tests and verify RED**

Run: `pnpm vitest run tests/gpt56Revision.test.ts`

Expected: FAIL because the orchestration is incomplete.

- [ ] **Step 3: Implement variant voice/render orchestration**

For each variant: synthesize changed chunks with ElevenLabs, render one generic evidence plate per narration chunk, mux narration, concatenate segments, overlay the AIMH logo, mix the persisted seven-second outro, write variant captions, and keep the baseline untouched.

- [ ] **Step 4: Run render unit tests and verify GREEN**

Run: `pnpm vitest run tests/gpt56Revision.test.ts`

Expected: PASS.

- [ ] **Step 5: Synthesize and spot-check critical audio**

Run: `pnpm gpt56:revision:voice -- --variant both`

Listen to the practical chunk from each version. Record a pass only when “Programmatic Tool Calling” is heard without an internal pause. If it fails, change only `speech_text`, delete only the affected cached MP3 and metadata, and synthesize again.

- [ ] **Step 6: Render Version A**

Run: `pnpm gpt56:revision:render -- --variant a-evidence`

Expected: `render/final-a-evidence.mp4` plus captions and render status.

- [ ] **Step 7: Render Version B**

Run: `pnpm gpt56:revision:render -- --variant b-demo`

Expected: `render/final-b-demo.mp4` plus captions and render status.

- [ ] **Step 8: Commit implementation without generated build intermediates**

```bash
git add src/production/gpt56Revision.ts tests/gpt56Revision.test.ts package.json episodes/2026-07-13-gpt-5-6
git commit -m "feat: render two GPT-5.6 newsroom cuts"
```

### Task 9: Full QA, results, and critic review

**Files:**
- Modify: `RESULTS.md`
- Modify: `REVIEW.md`
- Create: variant QA outputs under `episodes/2026-07-13-gpt-5-6/qa/`
- Create: `episodes/2026-07-13-gpt-5-6/comparison.md`

- [ ] **Step 1: Run the complete automated suite**

Run: `pnpm test && pnpm lint && pnpm build`

Expected: all tests pass, TypeScript reports no errors, and build succeeds.

- [ ] **Step 2: Run variant media QA**

For both MP4s verify H.264, 1920×1080, 30 fps, stereo AAC 48 kHz, expected duration, no blank scene-boundary frames, valid tail audio, logo placement, and exactly one outro entrance in the final seven seconds.

- [ ] **Step 3: Run visual acceptance QA**

Generate contact sheets and targeted frames proving the top launch film moves, Saltwind gameplay moves, an embedded build moves, the 0:32-style paragraph zoom becomes legible, independent sources are attributed, and no unacknowledged static hold exceeds 12 seconds.

- [ ] **Step 4: Verify no upload occurred**

Search the episode package and run logs for upload receipts or upload-attempt flags. The only acceptable status is `uploadAttempted: false` and no new remote state.

- [ ] **Step 5: Write comparison and builder results**

`comparison.md` records each runtime, moving-footage percentage, source-zoom count, independent-source beats, selected outro, and QA status. Append a dated section to `RESULTS.md` with all required peer-review sections and exact test/smoke evidence.

- [ ] **Step 6: Perform critic pass and write REVIEW.md**

Review every changed file as an independent senior engineer. Record critical, major, minor, observations, verdict, and any conditions. Do not silently fix findings during this phase.

- [ ] **Step 7: Final verification and commit**

Run final hashes and `git diff --check`, ensure the worktree contains no accidental secrets or upload artifacts, and commit QA documentation:

```bash
git add RESULTS.md REVIEW.md episodes/2026-07-13-gpt-5-6/comparison.md episodes/2026-07-13-gpt-5-6/qa
git commit -m "test: verify GPT-5.6 two-cut revision"
```

The task ends by handing the user both local video links and the comparison. Do not call any upload command.
