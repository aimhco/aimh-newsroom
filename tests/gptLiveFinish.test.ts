import {
  mkdtemp,
  mkdir,
  readFile,
  readdir,
  rename as fsRename,
  rm,
  symlink,
  writeFile
} from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it, vi } from "vitest";
import {
  assertFinalMediaContract,
  assertSourceOutputLoudness,
  assertVariantDurationParity,
  buildFinishFfmpegArgs,
  buildLogoCornerSampleArgs,
  buildLogoFilter,
  buildMusicVolumeExpression,
  buildPostProductionManifest,
  buildSourceDialogueGainExpression,
  deriveSharedSourceGains,
  deriveSourceDuckIntervals,
  finishGptLiveProduction,
  parseEbur128IntegratedLufs,
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
    framesPerSecond: 30,
    durationSeconds,
    pixelFormat: "yuv420p",
    colorSpace: "bt709",
    colorTransfer: "bt709",
    colorPrimaries: "bt709"
  },
  audio: {
    codecName: "aac",
    sampleRate: 48_000,
    channels: 2,
    durationSeconds: durationSeconds - 0.01,
    bitRate: 192_000
  }
});

const sourceGains = deriveSharedSourceGains(
  deriveSourceDuckIntervals(plan()),
  [-20, -25],
  [-20, -25]
);

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
    const expression = buildMusicVolumeExpression(deriveSourceDuckIntervals(plan()));
    expect(expression).toContain("between(t,0.000,3.000)");
    expect(expression).toContain("between(t,3.000,3.100)");
    expect(expression).toContain("between(t,8.400,8.500)");
    expect(expression).toContain("between(t,10.750,10.850)");
    expect(expression).toContain("0.020");
    expect(expression).toContain("0.070");
  });

  it("derives one clamped shared gain policy from A/B interval measurements", () => {
    expect(sourceGains).toEqual([
      expect.objectContaining({
        startSeconds: 0,
        endSeconds: 3,
        measuredLufsA: -20,
        measuredLufsB: -20,
        averageMeasuredLufs: -20,
        targetLufs: -23,
        gainDb: -3
      }),
      expect.objectContaining({
        startSeconds: 8.5,
        endSeconds: 10.75,
        gainDb: 2
      })
    ]);
    expect(deriveSharedSourceGains([{ startSeconds: 0, endSeconds: 1 }], [-50], [-50])[0]?.gainDb)
      .toBe(12);
  });

  it("ramps source gain only inside source intervals", () => {
    const expression = buildSourceDialogueGainExpression(sourceGains);
    expect(expression).toContain("between(t,0.000,3.000)");
    expect(expression).toContain("0.707946");
    expect(expression).toContain("between(t,8.500,10.750)");
    expect(expression).toContain("1.258925");
    expect(expression).toContain("1.000000");
  });

  it("parses the final integrated ebur128 summary value", () => {
    expect(
      parseEbur128IntegratedLufs("I: -18.2 LUFS\nIntegrated loudness:\n  I: -22.9 LUFS\n")
    ).toBe(-22.9);
  });

  it("uses exact input ordering, shared graph, maps, and encoding settings", () => {
    const args = buildFinishFfmpegArgs({
        inputPath: "/episode/exports/tella-a.mp4",
        logoPath: "/assets/logo.png",
        musicPath: "/assets/Body_Komorebi_Futuremono.mp3",
        outputPath: "/episode/final/version-a.tmp.mp4",
        durationSeconds: 10.75,
        duckIntervals: deriveSourceDuckIntervals(plan()),
        sourceGains
      });
    expect(args.slice(0, 9)).toEqual([
      "-y",
      "-i",
      "/episode/exports/tella-a.mp4",
      "-i",
      "/assets/logo.png",
      "-stream_loop",
      "-1",
      "-i",
      "/assets/Body_Komorebi_Futuremono.mp3"
    ]);
    const graph = args[args.indexOf("-filter_complex") + 1]!;
    expect(graph).toContain("apad=whole_dur=10.750");
    expect(graph).toContain("atrim=duration=10.750");
    expect(graph).toContain("amix=inputs=2:duration=longest");
    expect(graph).toContain("alimiter=limit=0.95:attack=5:release=50:level=false:latency=true");
    expect(args.slice(args.indexOf("-map"))).toEqual([
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
      "-colorspace",
      "bt709",
      "-color_primaries",
      "bt709",
      "-color_trc",
      "bt709",
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
      duckIntervals: deriveSourceDuckIntervals(plan()),
      sourceGains
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

  it("samples the fixed top-right logo corner as a SHA-256 frame hash", () => {
    expect(buildLogoCornerSampleArgs("/episode/final/version-a.mp4", 5.25)).toEqual([
      "-v",
      "error",
      "-ss",
      "5.250",
      "-i",
      "/episode/final/version-a.mp4",
      "-frames:v",
      "1",
      "-vf",
      "crop=198:198:iw-198:0",
      "-f",
      "hash",
      "-hash",
      "sha256",
      "-"
    ]);
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
    ["pixel format", { video: { pixelFormat: "yuv444p" } }, "yuv420p"],
    ["color tags", { video: { colorSpace: "unknown" } }, "BT.709"],
    ["audio bitrate", { audio: { bitRate: 128_000 } }, "bitrate"],
    ["audio duration", { audio: { durationSeconds: 9.94 } }, "audio duration"],
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

  it("rejects source excerpts outside the target loudness or A/B parity tolerance", () => {
    expect(() => assertSourceOutputLoudness(sourceGains, [-22.5, -23.5], [-22.4, -23.4]))
      .not.toThrow();
    expect(() => assertSourceOutputLoudness(sourceGains, [-20.9, -23], [-23, -23]))
      .toThrow("source loudness");
    expect(() => assertSourceOutputLoudness(sourceGains, [-22, -23], [-24.1, -23]))
      .toThrow("A/B source loudness");
  });
});

describe("GPT-Live post-production publication", () => {
  const createContainedEpisode = async () => {
    const episodeDir = await mkdtemp(join(tmpdir(), "gpt-live-finish-contained-"));
    await Promise.all(
      ["tella", "exports", "final", "reports"].map((directory) =>
        mkdir(join(episodeDir, directory), { recursive: true })
      )
    );
    await Promise.all([
      writeFile(join(episodeDir, "tella", "plan.json"), JSON.stringify(plan()), "utf8"),
      writeFile(join(episodeDir, "exports", "tella-a.mp4"), "export-a", "utf8"),
      writeFile(join(episodeDir, "exports", "tella-b.mp4"), "export-b", "utf8"),
      writeFile(join(episodeDir, "final", "version-a.mp4"), "approved-a", "utf8"),
      writeFile(join(episodeDir, "final", "version-b.mp4"), "approved-b", "utf8"),
      writeFile(join(episodeDir, "reports", "post-production.json"), "{}\n", "utf8")
    ]);
    return episodeDir;
  };

  const finishOptions = (episodeDir: string) => ({
    episodeDir,
    env: {
      AIMH_LOGO_PATH: "/assets/logo.png",
      AIMH_BODY_MUSIC_PATH: "/assets/music.mp3"
    },
    ffmpegPath: "ffmpeg",
    ffprobePath: "ffprobe"
  });

  it.each([
    {
      name: "exports directory",
      replace: async (episodeDir: string, outsideDir: string) => {
        await rm(join(episodeDir, "exports"), { recursive: true });
        await symlink(outsideDir, join(episodeDir, "exports"), "dir");
      }
    },
    {
      name: "export file",
      replace: async (episodeDir: string, outsideDir: string) => {
        const outsideFile = join(outsideDir, "outside-export.mp4");
        await writeFile(outsideFile, "outside", "utf8");
        await rm(join(episodeDir, "exports", "tella-a.mp4"));
        await symlink(outsideFile, join(episodeDir, "exports", "tella-a.mp4"));
      }
    },
    {
      name: "final directory",
      replace: async (episodeDir: string, outsideDir: string) => {
        await rm(join(episodeDir, "final"), { recursive: true });
        await symlink(outsideDir, join(episodeDir, "final"), "dir");
      }
    },
    {
      name: "final file",
      replace: async (episodeDir: string, outsideDir: string) => {
        const outsideFile = join(outsideDir, "outside-final.mp4");
        await writeFile(outsideFile, "outside", "utf8");
        await rm(join(episodeDir, "final", "version-a.mp4"));
        await symlink(outsideFile, join(episodeDir, "final", "version-a.mp4"));
      }
    },
    {
      name: "reports directory",
      replace: async (episodeDir: string, outsideDir: string) => {
        await rm(join(episodeDir, "reports"), { recursive: true });
        await symlink(outsideDir, join(episodeDir, "reports"), "dir");
      }
    },
    {
      name: "report file",
      replace: async (episodeDir: string, outsideDir: string) => {
        const outsideFile = join(outsideDir, "outside-report.json");
        await writeFile(outsideFile, "outside", "utf8");
        await rm(join(episodeDir, "reports", "post-production.json"));
        await symlink(outsideFile, join(episodeDir, "reports", "post-production.json"));
      }
    }
  ])("rejects a symlinked $name before running commands or writing reports", async ({ replace }) => {
    const episodeDir = await createContainedEpisode();
    const outsideDir = await mkdtemp(join(tmpdir(), "gpt-live-finish-outside-"));
    const runCommand = vi.fn(async () => ({ stdout: "", stderr: "" }));
    const writeJsonAtomic = vi.fn(async () => undefined);
    await replace(episodeDir, outsideDir);

    try {
      await expect(
        finishGptLiveProduction(finishOptions(episodeDir), {
          access: async () => undefined,
          inspectFinalMediaFile: async () => validInspection(10.75),
          runCommand,
          writeJsonAtomic
        })
      ).rejects.toThrow(/symlink/i);
      expect(runCommand).not.toHaveBeenCalled();
      expect(writeJsonAtomic).not.toHaveBeenCalled();
    } finally {
      await rm(episodeDir, { recursive: true, force: true });
      await rm(outsideDir, { recursive: true, force: true });
    }
  });

  it("creates a secret-free manifest with only safe relative asset and media paths", () => {
    const manifest = buildPostProductionManifest({
      productionId: "test-production",
      logoPath: "/Users/editor/private/logo.png",
      musicPath: "/Users/editor/private/Body_Komorebi_Futuremono.mp3",
      logoSha256: "a".repeat(64),
      duckIntervals: deriveSourceDuckIntervals(plan()),
      sourceGains: sourceGains.map((gain, index) => ({
        ...gain,
        outputLufsA: [-22.9, -23.1][index]!,
        outputLufsB: [-22.8, -23.0][index]!
      })),
      logoEvidence: [
        {
          name: "version-a",
          samples: [{ timeSeconds: 1, inputSha256: "b".repeat(64), outputSha256: "c".repeat(64) }]
        },
        {
          name: "version-b",
          samples: [{ timeSeconds: 1, inputSha256: "d".repeat(64), outputSha256: "e".repeat(64) }]
        }
      ],
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
        logoSha256: "a".repeat(64),
        music: "Body_Komorebi_Futuremono.mp3"
      },
      sourceDialogue: {
        targetLufs: -23,
        gainClampDb: 12,
        rampSeconds: 0.1,
        intervals: expect.arrayContaining([
          expect.objectContaining({ gainDb: -3, outputLufsA: -22.9, outputLufsB: -22.8 })
        ])
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
            readFileBytes: async () => new Uint8Array([1, 2, 3]),
            readFile: async () => JSON.stringify(plan()),
            inspectFinalMediaFile: async (_ffprobePath, path) =>
              validInspection(path.includes("tella-b") ? 10.75 : 10.75),
            measureIntervalLoudness: async () => -23,
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

  it.each([
    { name: "version A", failPattern: "version-a.tmp-" },
    { name: "version B", failPattern: "version-b.tmp-" },
    { name: "post-production manifest", failPattern: "post-production.tmp-" }
  ])("keeps canonical targets present and restores them when $name promotion fails", async ({ failPattern }) => {
    const transactionId = "00000000-0000-4000-8000-000000000000";
    const episodeDir = await createContainedEpisode();
    const finalDirectory = join(episodeDir, "final");
    const versionAPath = join(finalDirectory, "version-a.mp4");
    const versionBPath = join(finalDirectory, "version-b.mp4");
    const reportPath = join(episodeDir, "reports", "post-production.json");
    const canonicalPaths = [versionAPath, versionBPath, reportPath];
    const renameCalls: Array<[string, string]> = [];
    let missingCanonicalObserved = false;

    try {
      await expect(
        finishGptLiveProduction(
          finishOptions(episodeDir),
          {
            access: async () => undefined,
            randomUUID: () => transactionId,
            readFileBytes: async () => new Uint8Array([1, 2, 3]),
            inspectFinalMediaFile: async () => validInspection(10.75),
            measureIntervalLoudness: async () => -23,
            sampleLogoCornerFrameHash: async (_ffmpeg, path) =>
              path.includes("exports") ? "a".repeat(64) : "b".repeat(64),
            runCommand: async (_command, args) => {
              await writeFile(args.at(-1)!, "new-final", "utf8");
              return { stdout: "", stderr: "" };
            },
            rename: async (from, to) => {
              renameCalls.push([String(from), String(to)]);
              if (String(from).includes(".tmp-")) {
                const presence = await Promise.all(
                  canonicalPaths.map(async (path) => {
                    try {
                      await readFile(path);
                      return true;
                    } catch {
                      return false;
                    }
                  })
                );
                missingCanonicalObserved ||= presence.includes(false);
              }
              if (String(from).includes(failPattern)) {
                throw new Error("injected promotion failure");
              }
              await fsRename(from, to);
            }
          }
        )
      ).rejects.toThrow("injected promotion failure");

      expect(await readFile(versionAPath, "utf8")).toBe("approved-a");
      expect(await readFile(versionBPath, "utf8")).toBe("approved-b");
      expect(await readFile(reportPath, "utf8")).toBe("{}\n");
      expect(missingCanonicalObserved).toBe(false);
      expect(renameCalls.some(([from]) => canonicalPaths.includes(from))).toBe(false);
      expect((await readdir(finalDirectory)).some((name) => name.includes(".backup-"))).toBe(false);
      expect((await readdir(finalDirectory)).some((name) => name.includes(".rollback-"))).toBe(false);
      expect((await readdir(join(episodeDir, "reports"))).some((name) => name.includes(".rollback-")))
        .toBe(false);
    } finally {
      await rm(episodeDir, { recursive: true, force: true });
    }
  });

  it("preserves deterministic A recovery bytes when B promotion and A restore fail", async () => {
    const transactionId = "00000000-0000-4000-8000-000000000000";
    const episodeDir = await createContainedEpisode();
    const versionAPath = join(episodeDir, "final", "version-a.mp4");
    const versionBPath = join(episodeDir, "final", "version-b.mp4");
    const reportPath = join(episodeDir, "reports", "post-production.json");
    const recoveryPath = `${versionAPath}.rollback-${transactionId}`;

    try {
      let failure: Error | undefined;
      try {
        await finishGptLiveProduction(finishOptions(episodeDir), {
          access: async () => undefined,
          randomUUID: () => transactionId,
          readFileBytes: async () => new Uint8Array([1, 2, 3]),
          inspectFinalMediaFile: async () => validInspection(10.75),
          measureIntervalLoudness: async () => -23,
          sampleLogoCornerFrameHash: async (_ffmpeg, path) =>
            path.includes("exports") ? "a".repeat(64) : "b".repeat(64),
          runCommand: async (_command, args) => {
            await writeFile(args.at(-1)!, "new-final", "utf8");
            return { stdout: "", stderr: "" };
          },
          rename: async (from, to) => {
            if (String(from).includes("version-b.tmp-")) {
              throw new Error("injected B promotion failure");
            }
            if (String(from) === recoveryPath && String(to) === versionAPath) {
              throw new Error("injected A restore failure");
            }
            await fsRename(from, to);
          }
        });
      } catch (error) {
        failure = error as Error;
      }

      expect(failure?.message).toContain("rollback incomplete");
      expect(failure?.message).toContain(recoveryPath);
      expect(failure?.message).toContain("injected A restore failure");
      expect(await readFile(recoveryPath, "utf8")).toBe("approved-a");
      expect(await readFile(versionAPath, "utf8")).toBe("new-final");
      expect(await readFile(versionBPath, "utf8")).toBe("approved-b");
      expect(await readFile(reportPath, "utf8")).toBe("{}\n");
    } finally {
      await rm(episodeDir, { recursive: true, force: true });
    }
  });
});
