import { mkdtemp, mkdir, readFile, rename as fsRename, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it, vi } from "vitest";
import {
  assertFinalMediaContract,
  assertVariantDurationParity,
  buildFinishFfmpegArgs,
  buildLogoFilter,
  buildMusicVolumeExpression,
  buildPostProductionManifest,
  deriveSourceDuckIntervals,
  finishGptLiveProduction,
  type FinalMediaInspection,
  type FinishPlan
} from "../src/production/gptLive/finish";

const plan = (durations = [3, 5.5, 2.25, 1]): FinishPlan => ({
  schemaVersion: "0.1.0",
  productionId: "test-production",
  clips: [
    { id: "source-one", kind: "source_clip", durationSeconds: durations[0]! },
    { id: "hook", kind: "narration", durationSeconds: durations[1]! },
    { id: "source-two", kind: "source_clip", durationSeconds: durations[2]! },
    { id: "body", kind: "narration", durationSeconds: durations[3]! }
  ]
});

const validInspection = (durationSeconds: number): FinalMediaInspection => ({
  durationSeconds,
  video: {
    codecName: "h264",
    width: 1920,
    height: 1080,
    framesPerSecond: 30
  },
  audio: {
    codecName: "aac",
    sampleRate: 48_000,
    channels: 2
  }
});

describe("GPT-Live finishing filters", () => {
  it("returns the exact AIMH logo treatment", () => {
    expect(buildLogoFilter()).toBe(
      "[1:v]scale=150:-1,format=rgba,colorchannelmixer=aa=0.85[lg];[0:v][lg]overlay=W-w-24:24"
    );
  });

  it("derives every source interval from arbitrary shared timeline durations", () => {
    expect(deriveSourceDuckIntervals(plan())).toEqual([
      { startSeconds: 0, endSeconds: 3 },
      { startSeconds: 8.5, endSeconds: 10.75 }
    ]);
  });

  it("builds a conservative music expression covering both source intervals", () => {
    expect(buildMusicVolumeExpression(deriveSourceDuckIntervals(plan()))).toBe(
      "if(between(t,0.000,3.000)+between(t,8.500,10.750),0.020,0.070)"
    );
  });

  it("uses exact input ordering, shared graph, maps, and encoding settings", () => {
    expect(
      buildFinishFfmpegArgs({
        inputPath: "/episode/exports/tella-a.mp4",
        logoPath: "/assets/logo.png",
        musicPath: "/assets/Body_Komorebi_Futuremono.mp3",
        outputPath: "/episode/final/version-a.tmp.mp4",
        durationSeconds: 10.75,
        duckIntervals: deriveSourceDuckIntervals(plan())
      })
    ).toEqual([
      "-y",
      "-i",
      "/episode/exports/tella-a.mp4",
      "-i",
      "/assets/logo.png",
      "-stream_loop",
      "-1",
      "-i",
      "/assets/Body_Komorebi_Futuremono.mp3",
      "-filter_complex",
      "[1:v]scale=150:-1,format=rgba,colorchannelmixer=aa=0.85[lg];[0:v][lg]overlay=W-w-24:24[vout];[0:a]volume=1.0[dialogue];[2:a]volume='if(between(t,0.000,3.000)+between(t,8.500,10.750),0.020,0.070)':eval=frame[music];[dialogue][music]amix=inputs=2:duration=first:dropout_transition=0:normalize=0,alimiter=limit=0.95[aout]",
      "-map",
      "[vout]",
      "-map",
      "[aout]",
      "-c:v",
      "libx264",
      "-crf",
      "18",
      "-preset",
      "medium",
      "-pix_fmt",
      "yuv420p",
      "-r",
      "30",
      "-c:a",
      "aac",
      "-b:a",
      "192k",
      "-ar",
      "48000",
      "-ac",
      "2",
      "-t",
      "10.750",
      "-movflags",
      "+faststart",
      "/episode/final/version-a.tmp.mp4"
    ]);
  });

  it("builds identical finishing settings for both variants", () => {
    const shared = {
      logoPath: "/assets/logo.png",
      musicPath: "/assets/music.mp3",
      durationSeconds: 10.75,
      duckIntervals: deriveSourceDuckIntervals(plan())
    };
    const a = buildFinishFfmpegArgs({
      ...shared,
      inputPath: "/episode/exports/tella-a.mp4",
      outputPath: "/episode/final/version-a.tmp.mp4"
    });
    const b = buildFinishFfmpegArgs({
      ...shared,
      inputPath: "/episode/exports/tella-b.mp4",
      outputPath: "/episode/final/version-b.tmp.mp4"
    });

    expect(a.slice(a.indexOf("-filter_complex"), -1)).toEqual(
      b.slice(b.indexOf("-filter_complex"), -1)
    );
  });
});

describe("GPT-Live final validation", () => {
  it.each([
    ["dimensions", { video: { width: 1280 } }, "1920x1080"],
    ["frame rate", { video: { framesPerSecond: 29.97 } }, "30fps"],
    ["video codec", { video: { codecName: "hevc" } }, "H.264"],
    ["audio codec", { audio: { codecName: "mp3" } }, "AAC"],
    ["sample rate", { audio: { sampleRate: 44_100 } }, "48kHz"],
    ["channels", { audio: { channels: 1 } }, "stereo"],
    ["duration", { durationSeconds: 10.3 }, "duration mismatch"]
  ])("rejects wrong final %s", (_name, mutation, error) => {
    const valid = validInspection(10);
    const candidate = {
      ...valid,
      ...mutation,
      video: "video" in mutation ? { ...valid.video, ...mutation.video } : valid.video,
      audio: "audio" in mutation ? { ...valid.audio, ...mutation.audio } : valid.audio
    } as FinalMediaInspection;

    expect(() => assertFinalMediaContract(candidate, 10)).toThrow(error);
  });

  it("rejects A/B duration drift above half a second", () => {
    expect(() => assertVariantDurationParity(20, 20.501)).toThrow("A/B duration delta");
    expect(() => assertVariantDurationParity(20, 20.5)).not.toThrow();
  });
});

describe("GPT-Live post-production publication", () => {
  it("creates a secret-free manifest with only safe relative asset and media paths", () => {
    const manifest = buildPostProductionManifest({
      productionId: "test-production",
      logoPath: "/Users/editor/private/logo.png",
      musicPath: "/Users/editor/private/Body_Komorebi_Futuremono.mp3",
      duckIntervals: deriveSourceDuckIntervals(plan()),
      variants: [
        {
          name: "version-a",
          inputPath: "/private/episode/exports/tella-a.mp4",
          outputPath: "/private/episode/final/version-a.mp4",
          inputDurationSeconds: 10.75,
          outputDurationSeconds: 10.75
        },
        {
          name: "version-b",
          inputPath: "/private/episode/exports/tella-b.mp4",
          outputPath: "/private/episode/final/version-b.mp4",
          inputDurationSeconds: 10.75,
          outputDurationSeconds: 10.75
        }
      ]
    });
    const serialized = JSON.stringify(manifest);

    expect(manifest).toMatchObject({
      status: "finished",
      assets: {
        logo: "logo.png",
        music: "Body_Komorebi_Futuremono.mp3"
      },
      settings: {
        dialogueVolume: 1,
        normalMusicVolume: 0.07,
        duckedMusicVolume: 0.02,
        videoCodec: "libx264",
        audioCodec: "aac"
      }
    });
    expect(manifest.variants.map(({ inputPath, outputPath }) => ({ inputPath, outputPath }))).toEqual([
      { inputPath: "exports/tella-a.mp4", outputPath: "final/version-a.mp4" },
      { inputPath: "exports/tella-b.mp4", outputPath: "final/version-b.mp4" }
    ]);
    expect(serialized).not.toMatch(/\/Users|\/private|secret|token|api.?key/i);
  });

  it("does not replace an existing final when rendering fails", async () => {
    const episodeDir = await mkdtemp(join(tmpdir(), "gpt-live-finish-failure-"));
    const finalPath = join(episodeDir, "final", "version-a.mp4");
    await mkdir(join(episodeDir, "final"), { recursive: true });
    await writeFile(finalPath, "approved-final", "utf8");
    const rename = vi.fn(async () => undefined);

    try {
      await expect(
        finishGptLiveProduction(
          {
            episodeDir,
            env: {
              AIMH_LOGO_PATH: "/assets/logo.png",
              AIMH_BODY_MUSIC_PATH: "/assets/music.mp3"
            },
            ffmpegPath: "ffmpeg",
            ffprobePath: "ffprobe"
          },
          {
            access: async () => undefined,
            readFile: async () => JSON.stringify(plan()),
            inspectFinalMediaFile: async (_ffprobePath, path) =>
              validInspection(path.includes("tella-b") ? 10.75 : 10.75),
            runCommand: async () => {
              throw new Error("injected ffmpeg failure");
            },
            rename
          }
        )
      ).rejects.toThrow("injected ffmpeg failure");

      expect(await readFile(finalPath, "utf8")).toBe("approved-final");
      expect(rename).not.toHaveBeenCalled();
    } finally {
      await rm(episodeDir, { recursive: true, force: true });
    }
  });

  it("retains the previous final backup if promotion and rollback both fail", async () => {
    const transactionId = "00000000-0000-4000-8000-000000000000";
    const episodeDir = await mkdtemp(join(tmpdir(), "gpt-live-finish-rollback-"));
    const finalDirectory = join(episodeDir, "final");
    const versionAPath = join(finalDirectory, "version-a.mp4");
    const versionBPath = join(finalDirectory, "version-b.mp4");
    const versionABackupPath = `${versionAPath}.backup-${transactionId}`;
    await mkdir(finalDirectory, { recursive: true });
    await writeFile(versionAPath, "approved-a", "utf8");
    await writeFile(versionBPath, "approved-b", "utf8");

    try {
      await expect(
        finishGptLiveProduction(
          {
            episodeDir,
            env: {
              AIMH_LOGO_PATH: "/assets/logo.png",
              AIMH_BODY_MUSIC_PATH: "/assets/music.mp3"
            },
            ffmpegPath: "ffmpeg",
            ffprobePath: "ffprobe"
          },
          {
            access: async () => undefined,
            randomUUID: () => transactionId,
            readFile: async () => JSON.stringify(plan()),
            inspectFinalMediaFile: async () => validInspection(10.75),
            runCommand: async (_command, args) => {
              await writeFile(args.at(-1)!, "new-final", "utf8");
              return { stdout: "", stderr: "" };
            },
            rename: async (from, to) => {
              if (String(from).includes(`version-b.tmp-${transactionId}`)) {
                throw new Error("injected promotion failure");
              }
              if (from === versionABackupPath) {
                throw new Error("injected rollback failure");
              }
              await fsRename(from, to);
            }
          }
        )
      ).rejects.toThrow("injected rollback failure");

      expect(await readFile(versionABackupPath, "utf8")).toBe("approved-a");
      expect(await readFile(versionBPath, "utf8")).toBe("approved-b");
    } finally {
      await rm(episodeDir, { recursive: true, force: true });
    }
  });
});
