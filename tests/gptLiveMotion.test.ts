import { join, sep } from "node:path";
import { describe, expect, it, vi } from "vitest";
import { GPT_LIVE_CONTENT } from "../src/production/gptLive/content";
import {
  calculateGptLivePlateMetadata,
  type GptLivePlateProps
} from "../src/production/gptLive/motion/Root";
import {
  EVIDENCE_BENCHMARK_COPY,
  GPT_LIVE_SCENES,
  sceneStyle,
  type SceneRect
} from "../src/production/gptLive/motion/sceneStyle";
import {
  assertPlateContract,
  buildPlateRenderJobs,
  readPlateNarrationRecords,
  renderGptLivePlates,
  type PlateNarrationRecord
} from "../src/production/gptLive/renderPlates";
import type { MediaInspection } from "../src/production/gptLive/mediaInspection";
import type { GptLiveVariant } from "../src/production/gptLive/types";

const VARIANTS = ["dynamic_editorial", "aimh_visual_host"] as const satisfies readonly GptLiveVariant[];
const SAFE_AREA: SceneRect = { x: 1722, y: 0, width: 198, height: 198 };

const overlaps = (left: SceneRect, right: SceneRect): boolean =>
  left.x < right.x + right.width &&
  left.x + left.width > right.x &&
  left.y < right.y + right.height &&
  left.y + left.height > right.y;

const narrationRecords: readonly PlateNarrationRecord[] = GPT_LIVE_CONTENT.narration.map(
  (item, index) => ({
    id: item.id,
    text: item.text,
    durationSeconds: 8 + index / 10
  })
);

const validInspection = (durationSeconds = 8): MediaInspection => ({
  durationSeconds,
  video: {
    codecName: "h264",
    width: 1920,
    height: 1080,
    framesPerSecond: 30
  }
});

const validSlateInspection = (durationSeconds = 8): MediaInspection => ({
  ...validInspection(durationSeconds),
  audio: { codecName: "aac" }
});

const isMasterPath = (path: string): boolean => path.includes(`${sep}master${sep}`);

describe("GPT-Live scene styles", () => {
  it("pins the approved OpenAI-reported GPQA comparison for the evidence scene", () => {
    expect(EVIDENCE_BENCHMARK_COPY).toEqual({
      attribution: "OPENAI-REPORTED / VENDOR-REPORTED",
      comparison: "GPT-LIVE-1 VS ADVANCED VOICE MODE",
      benchmark: "ON GPQA",
      statement:
        "OpenAI reports GPT-Live-1 substantially outperforms Advanced Voice Mode on GPQA.",
      qualification: "Not independent validation."
    });
  });

  it("pins the exact use-case variant contracts", () => {
    expect(sceneStyle("dynamic_editorial", "use_cases")).toMatchObject({
      persistentHost: false,
      maxStaticFrames: 180,
      reservedTopRight: { width: 198, height: 198 }
    });
    expect(sceneStyle("aimh_visual_host", "use_cases")).toMatchObject({
      persistentHost: true,
      maxStaticFrames: 180,
      reservedTopRight: { width: 198, height: 198 }
    });
  });

  it.each(VARIANTS)("returns deterministic style decisions for every %s scene", (variant) => {
    for (const scene of GPT_LIVE_SCENES) {
      const first = sceneStyle(variant, scene);
      const second = sceneStyle(variant, scene);

      expect(first).toEqual(second);
      expect(first.variant).toBe(variant);
      expect(first.scene).toBe(scene);
      expect(first.palette).toEqual(
        expect.objectContaining({
          background: expect.stringMatching(/^#/),
          foreground: expect.stringMatching(/^#/),
          signal: expect.stringMatching(/^#/),
          accent: expect.stringMatching(/^#/)
        })
      );
      expect(first.layout).toEqual(expect.any(String));
      expect(first.motion).toEqual(expect.any(String));
    }
  });

  it.each(VARIANTS)("reserves the final-logo safe area for all %s scenes", (variant) => {
    for (const scene of GPT_LIVE_SCENES) {
      const style = sceneStyle(variant, scene);
      expect(style.reservedTopRight).toEqual(SAFE_AREA);
      expect(style.contentRegions.length).toBeGreaterThan(0);
      expect(style.contentRegions.every((region) => !overlaps(region, SAFE_AREA))).toBe(true);
    }
  });

  it.each(VARIANTS)("changes visual beats every 2-6 seconds for all %s scenes", (variant) => {
    for (const scene of GPT_LIVE_SCENES) {
      const style = sceneStyle(variant, scene);
      const gaps = style.beatFrames.slice(1).map((frame, index) => frame - style.beatFrames[index]!);

      expect(style.beatFrames[0]).toBe(0);
      expect(gaps.length).toBeGreaterThan(0);
      expect(gaps.every((gap) => gap >= 60 && gap <= 180)).toBe(true);
      expect(style.maxStaticFrames).toBeLessThanOrEqual(180);
      expect(Math.max(...gaps)).toBeLessThanOrEqual(style.maxStaticFrames);
    }
  });

  it("defines six distinct fast reveals for the use-cases scene", () => {
    for (const variant of VARIANTS) {
      expect(sceneStyle(variant, "use_cases").beatFrames).toHaveLength(6);
    }
  });
});

describe("GPT-Live Remotion composition metadata", () => {
  const props: GptLivePlateProps = {
    variant: "dynamic_editorial",
    scene: "hook",
    durationSeconds: 4.51,
    narrationId: "narration_hook",
    text: "Test narration",
    claimLabels: []
  };

  it("rounds measured seconds at 30fps", async () => {
    await expect(calculateGptLivePlateMetadata({ props })).resolves.toMatchObject({
      durationInFrames: 135,
      fps: 30,
      width: 1920,
      height: 1080
    });
  });

  it("never returns fewer than one frame", async () => {
    await expect(
      calculateGptLivePlateMetadata({ props: { ...props, durationSeconds: 0 } })
    ).resolves.toMatchObject({ durationInFrames: 1 });
  });
});

describe("GPT-Live plate render planning", () => {
  it("rejects malformed persisted voice data with a clear error", async () => {
    await expect(
      readPlateNarrationRecords("/tmp/gpt-live-motion", async () => "{not-json")
    ).rejects.toThrow("Invalid GPT-Live voice data");
  });

  it("builds exactly one job per narration and variant with shared measured durations", () => {
    const episodeDir = "/tmp/gpt-live-motion";
    const jobs = buildPlateRenderJobs({ episodeDir, narrationRecords });

    expect(jobs).toHaveLength(14);
    for (const [index, narration] of GPT_LIVE_CONTENT.narration.entries()) {
      const matching = jobs.filter((job) => job.narrationId === narration.id);
      expect(matching).toHaveLength(2);
      expect(matching.map(({ variant }) => variant)).toEqual(VARIANTS);
      expect(new Set(matching.map(({ durationSeconds }) => durationSeconds))).toEqual(
        new Set([narrationRecords[index]!.durationSeconds])
      );
      expect(matching.map(({ outputPath }) => outputPath)).toEqual([
        join(episodeDir, "plates", "dynamic_editorial", `${narration.id}.mp4`),
        join(episodeDir, "plates", "aimh_visual_host", `${narration.id}.mp4`)
      ]);
      expect(new Set(matching.map(({ outputPath }) => outputPath)).size).toBe(2);
    }
  });

  it("never creates plate jobs for source clips", () => {
    const jobs = buildPlateRenderJobs({ episodeDir: "/tmp/gpt-live-motion", narrationRecords });
    const sourceIds = new Set<string>(GPT_LIVE_CONTENT.timeline
      .filter((item) => item.kind === "source_clip")
      .map(({ id }) => id));

    expect(jobs.every((job) => !sourceIds.has(job.narrationId))).toBe(true);
  });

  it.each([
    ["audio", { ...validInspection(), audio: { codecName: "aac" } }, "must not contain audio"],
    ["width", { ...validInspection(), video: { ...validInspection().video, width: 1280 } }, "1920x1080"],
    ["height", { ...validInspection(), video: { ...validInspection().video, height: 720 } }, "1920x1080"],
    ["fps", { ...validInspection(), video: { ...validInspection().video, framesPerSecond: 29.97 } }, "30fps"],
    ["codec", { ...validInspection(), video: { ...validInspection().video, codecName: "hevc" } }, "H.264"],
    ["duration", validInspection(8.101), "duration mismatch"]
  ])("rejects an invalid plate %s contract", (_name, inspection, message) => {
    expect(() =>
      assertPlateContract(inspection as MediaInspection, validSlateInspection(8))
    ).toThrow(message as string);
  });

  it("accepts an inclusive 0.1s plate-versus-slate duration delta", () => {
    expect(() =>
      assertPlateContract(validInspection(20.1), validSlateInspection(20))
    ).not.toThrow();
  });

  it("bundles once, renders 14 muted H.264 plates, validates them, then atomically publishes the plan", async () => {
    const episodeDir = "/tmp/gpt-live-motion";
    const events: string[] = [];
    const bundle = vi.fn(async () => "serve-url");
    const selectComposition = vi.fn(async (_options: unknown) => ({ id: "GptLivePlate" }));
    const renderMedia = vi.fn(async (options: { outputLocation: string; muted?: boolean; codec: string }) => {
      events.push(`render:${options.outputLocation}`);
    });
    const inspectMediaFile = vi.fn(async (_ffprobe: string, outputPath: string) => {
      const narration = narrationRecords.find(({ id }) => outputPath.includes(id))!;
      events.push(`inspect:${outputPath}`);
      return isMasterPath(outputPath)
        ? validSlateInspection(narration.durationSeconds)
        : validInspection(narration.durationSeconds);
    });
    const writeJsonAtomic = vi.fn(async (path: string) => {
      events.push(`publish:${path}`);
    });

    const result = await renderGptLivePlates(
      { episodeDir, ffprobePath: "ffprobe", narrationRecords },
      {
        bundle,
        ensureDir: async () => undefined,
        inspectMediaFile,
        renderMedia,
        selectComposition,
        writeJsonAtomic
      }
    );

    expect(bundle).toHaveBeenCalledTimes(1);
    expect(renderMedia).toHaveBeenCalledTimes(14);
    expect(inspectMediaFile).toHaveBeenCalledTimes(28);
    for (const narration of narrationRecords) {
      expect(inspectMediaFile).toHaveBeenCalledWith(
        "ffprobe",
        join(episodeDir, "master", `${narration.id}.mp4`)
      );
    }
    expect(renderMedia.mock.calls.every(([options]) => options.codec === "h264")).toBe(true);
    expect(renderMedia.mock.calls.every(([options]) => options.muted === true)).toBe(true);
    expect(writeJsonAtomic).toHaveBeenCalledOnce();
    expect(writeJsonAtomic).toHaveBeenCalledWith(join(episodeDir, "tella", "plan.json"), result.plan);
    expect(events.at(-1)).toBe(`publish:${join(episodeDir, "tella", "plan.json")}`);
  });

  it("reads measured narration records from voice/narration.json when records are not supplied", async () => {
    const episodeDir = "/tmp/gpt-live-motion";
    const readFile = vi.fn(async () =>
      JSON.stringify({
        provider: "elevenlabs",
        warnings: [],
        chunks: narrationRecords
      })
    );
    const result = await renderGptLivePlates(
      { episodeDir, ffprobePath: "ffprobe" },
      {
        bundle: async () => "serve-url",
        ensureDir: async () => undefined,
        inspectMediaFile: async (_ffprobe, outputPath) => {
          const narration = narrationRecords.find(({ id }) => outputPath.includes(id))!;
          return isMasterPath(outputPath)
            ? validSlateInspection(narration.durationSeconds)
            : validInspection(narration.durationSeconds);
        },
        readFile,
        renderMedia: async () => undefined,
        selectComposition: async () => ({ id: "GptLivePlate" }),
        writeJsonAtomic: async () => undefined
      }
    );

    expect(readFile).toHaveBeenCalledWith(
      join(episodeDir, "voice", "narration.json"),
      "utf8"
    );
    expect(result.jobs).toHaveLength(14);
  });

  it("rejects plate-versus-slate drift above 0.1s even when both match voice within 0.1s", async () => {
    const episodeDir = "/tmp/gpt-live-motion";
    const records = narrationRecords.map((record) => ({ ...record, durationSeconds: 8 }));
    const inspectMediaFile = vi.fn(async (_ffprobe: string, outputPath: string) =>
      isMasterPath(outputPath)
        ? validSlateInspection(7.94)
        : validInspection(8.06)
    );
    const writeJsonAtomic = vi.fn(async () => undefined);

    await expect(
      renderGptLivePlates(
        { episodeDir, ffprobePath: "ffprobe", narrationRecords: records },
        {
          bundle: async () => "serve-url",
          ensureDir: async () => undefined,
          inspectMediaFile,
          renderMedia: async () => undefined,
          selectComposition: async () => ({ id: "GptLivePlate" }),
          writeJsonAtomic
        }
      )
    ).rejects.toThrow("plate/slate duration mismatch");
    expect(inspectMediaFile).toHaveBeenCalledWith(
      "ffprobe",
      join(episodeDir, "master", "narration_hook.mp4")
    );
    expect(writeJsonAtomic).not.toHaveBeenCalled();
  });

  it("does not publish a plan when any plate fails validation", async () => {
    const writeJsonAtomic = vi.fn(async () => undefined);
    await expect(
      renderGptLivePlates(
        { episodeDir: "/tmp/gpt-live-motion", ffprobePath: "ffprobe", narrationRecords },
        {
          bundle: async () => "serve-url",
          ensureDir: async () => undefined,
          inspectMediaFile: async (_ffprobe, outputPath) =>
            isMasterPath(outputPath)
              ? validSlateInspection()
              : { ...validInspection(), audio: { codecName: "aac" } },
          renderMedia: async () => undefined,
          selectComposition: async () => ({ id: "GptLivePlate" }),
          writeJsonAtomic
        }
      )
    ).rejects.toThrow("must not contain audio");
    expect(writeJsonAtomic).not.toHaveBeenCalled();
  });
});
