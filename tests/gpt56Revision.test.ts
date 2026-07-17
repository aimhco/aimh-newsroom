import { describe, expect, it } from "vitest";
import { evaluateMotionCadence } from "../src/qa/motionCadence";
import {
  allocateBeatFrames,
  buildRevisionPlateJobs,
  buildRevisionSceneWindows,
  GPT56_REVISION,
  parseGpt56RevisionCommand,
  SUPPORTED_GPT56_REVISION_COMMANDS,
  revisionPaths,
  validateGpt56Revision
} from "../src/production/gpt56Revision";

describe("GPT-5.6 two-cut revision", () => {
  it("defines evidence and demo variants using the top film and live Saltwind", () => {
    expect(() => validateGpt56Revision(GPT56_REVISION)).not.toThrow();
    expect(GPT56_REVISION.variants.map((variant) => variant.id)).toEqual([
      "a-evidence",
      "b-demo"
    ]);

    for (const variant of GPT56_REVISION.variants) {
      const beats = variant.scenes.flatMap((scene) => scene.beats);
      expect(
        beats.some((beat) => beat.assetPath.endsWith("openai-hero-excerpt.mp4"))
      ).toBe(true);
      expect(
        beats.some(
          (beat) =>
            beat.kind === "interactive_capture" && beat.assetPath.includes("saltwind")
        )
      ).toBe(true);
      expect(
        beats.some(
          (beat) => beat.kind === "video" && beat.assetPath.includes("spirograph")
        )
      ).toBe(true);
    }
  });

  it("uses readable zooms and materially selected independent evidence", () => {
    const evidenceVariant = GPT56_REVISION.variants[0]!;
    const beats = evidenceVariant.scenes.flatMap((scene) => scene.beats);

    expect(beats.some((beat) => beat.kind === "source_zoom")).toBe(true);
    expect(beats.some((beat) => beat.assetPath.includes("coderabbit"))).toBe(true);
    expect(beats.some((beat) => beat.assetPath.includes("simon"))).toBe(true);
  });

  it("phrase-locks Programmatic Tool Calling in both scripts", () => {
    for (const variant of GPT56_REVISION.variants) {
      const practical = variant.script.narration.find((paragraph) =>
        paragraph.text.includes("Programmatic Tool Calling")
      );
      expect(practical?.speech_text).toContain("tool-calling");
      expect(practical?.critical_phrases).toContain("Programmatic Tool Calling");
    }
  });

  it("uses the selected Version A cost pronunciation and corrected evidence targets", () => {
    const evidenceVariant = GPT56_REVISION.variants[0]!;
    const cost = evidenceVariant.script.narration.find((paragraph) => paragraph.id === "a_cost");
    const costScene = evidenceVariant.scenes.find((scene) => scene.narrationId === "a_cost");
    const caveatScene = evidenceVariant.scenes.find((scene) => scene.narrationId === "a_caveat");
    const pricingScene = evidenceVariant.scenes.find((scene) => scene.narrationId === "a_availability");
    const takeawayScene = evidenceVariant.scenes.find((scene) => scene.narrationId === "a_takeaway");

    expect(cost?.speech_text).toContain("forty-eight point five five cents");
    expect(costScene?.beats.map((beat) => beat.assetPath)).toEqual([
      "evidence/10-simon-low-none.png",
      "evidence/10-simon-high-max.png"
    ]);
    for (const beat of costScene?.beats ?? []) {
      expect(beat.kind).toBe("source_zoom");
      if (beat.kind === "source_zoom") {
        expect(beat.sourceAspectRatio).toBeCloseTo(16 / 9);
        expect(beat.maxScale).toBeLessThanOrEqual(1.4);
      }
    }
    const systemCard = caveatScene?.beats.find((beat) => beat.id === "system-card");
    expect(systemCard?.kind).toBe("source_zoom");
    if (systemCard?.kind === "source_zoom") {
      expect(systemCard.maxScale).toBeLessThanOrEqual(1.1);
      expect(systemCard.focalRect).toEqual({ x: 0, y: 0, width: 1, height: 1 });
    }
    const pricing = pricingScene?.beats.find((beat) => beat.id === "pricing");
    expect(pricing?.kind).toBe("source_zoom");
    if (pricing?.kind === "source_zoom") {
      expect(pricing.maxScale).toBeLessThanOrEqual(1.4);
      expect(pricing.focalRect.y).toBeGreaterThan(0.7);
    }
    expect(takeawayScene?.beats.some((beat) => beat.assetPath.includes("saltwind"))).toBe(false);
  });

  it("rejects nominal 30 fps interactive footage with a low meaningful-frame cadence", () => {
    expect(evaluateMotionCadence({ meaningfulFrames: 61, durationSeconds: 17.5, minimumFps: 8 }))
      .toMatchObject({ pass: false, meaningfulFramesPerSecond: 61 / 17.5 });
    expect(evaluateMotionCadence({ meaningfulFrames: 181, durationSeconds: 16.5, minimumFps: 8 }))
      .toMatchObject({ pass: true, meaningfulFramesPerSecond: 181 / 16.5 });
    expect(evaluateMotionCadence({ meaningfulFrames: 80, durationSeconds: 10, minimumFps: 8 }).pass)
      .toBe(true);
    expect(() => evaluateMotionCadence({ meaningfulFrames: 0, durationSeconds: 10, minimumFps: 8 }))
      .toThrow(/meaningfulFrames/);
  });

  it("allocates exact integer beat frames from editorial weights", () => {
    expect(allocateBeatFrames(101, [{ weight: 1 }, { weight: 2 }, { weight: 1 }])).toEqual([
      25,
      51,
      25
    ]);
    expect(() => allocateBeatFrames(3, [{ weight: 1 }, { weight: 1 }, { weight: 1 }, { weight: 1 }]))
      .toThrow(/at least one frame/);
  });

  it("exposes no upload command", () => {
    expect(SUPPORTED_GPT56_REVISION_COMMANDS).toEqual(["voice", "render", "qa", "all"]);
    expect(() => parseGpt56RevisionCommand("upload")).toThrow(/Unsupported/);
  });

  it("builds duration-bound plate jobs whose beat frames exactly fill each narration chunk", () => {
    const variant = GPT56_REVISION.variants[0]!;
    const voice = variant.script.narration.map((paragraph, index) => ({
      id: paragraph.id,
      text: paragraph.text,
      file: `/voice/${paragraph.id}.mp3`,
      durationSeconds: 10 + index,
      provider: "elevenlabs" as const,
      cached: false
    }));

    const jobs = buildRevisionPlateJobs(variant, voice, "/episode");

    expect(jobs).toHaveLength(variant.script.narration.length);
    for (const job of jobs) {
      expect(job.inputProps.beats.reduce((sum, beat) => sum + beat.durationFrames, 0)).toBe(
        Math.ceil(job.durationSeconds * 30)
      );
      expect(job.narrationPath).toMatch(/^\/voice\//);
      expect(job.outputPath).toContain("/render/revision/a-evidence/plates/");
    }
  });

  it("keeps baseline and final variant outputs at separate stable paths", () => {
    const paths = revisionPaths("/episode", "b-demo");

    expect(paths.baselineVideo).toBe("/episode/render/final-baseline.mp4");
    expect(paths.finalVideo).toBe("/episode/render/final-b-demo.mp4");
    expect(paths.variantRoot).toBe("/episode/render/revision/b-demo");
    expect(paths.script).toBe("/episode/script-b.json");
  });

  it("builds contiguous scene and beat windows for targeted media QA", () => {
    const variant = GPT56_REVISION.variants[1]!;
    const voice = variant.script.narration.map((paragraph) => ({
      id: paragraph.id,
      text: paragraph.text,
      file: `/voice/${paragraph.id}.mp3`,
      durationSeconds: 10,
      provider: "elevenlabs" as const,
      cached: false
    }));

    const windows = buildRevisionSceneWindows(variant, voice);

    expect(windows[0]).toMatchObject({ narrationId: "b_launch", startSeconds: 0, endSeconds: 10 });
    expect(windows.at(-1)).toMatchObject({ narrationId: "b_takeaway", startSeconds: 80, endSeconds: 90 });
    expect(windows.flatMap((scene) => scene.beats).some((beat) => beat.id === "saltwind-gameplay"))
      .toBe(true);
    for (const [index, scene] of windows.entries()) {
      expect(scene.beats[0]?.startSeconds).toBeCloseTo(scene.startSeconds, 6);
      expect(scene.beats.at(-1)?.endSeconds).toBeCloseTo(scene.endSeconds, 6);
      if (index > 0) expect(scene.startSeconds).toBeCloseTo(windows[index - 1]!.endSeconds, 6);
    }
  });
});
