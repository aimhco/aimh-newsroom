import { createHash } from "node:crypto";
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
import { GPT_LIVE_CONTENT } from "../src/production/gptLive/content";
import {
  assertFinalMediaContract,
  assertSourceOutputLoudness,
  assertVariantDurationParity,
  buildProgramAudioPlan,
  buildFinishFfmpegArgs,
  buildLogoCornerSampleArgs,
  buildLogoFilter,
  buildPostProductionManifest,
  buildSourceDialogueGainExpression,
  deriveSharedSourceGains,
  deriveSourceDuckIntervals,
  finishGptLiveProduction,
  parseEbur128IntegratedLufs,
  validatePublishedGeneration,
  type FinalMediaInspection,
  type FinishPlan
} from "../src/production/gptLive/finish";
import {
  buildPreparationFingerprint,
  derivePreparedArtifactDescriptors,
  hashPreparedArtifactDescriptors,
  parsePreparedGenerationRecord,
  validatePreparedGeneration
} from "../src/production/gptLive/preparation";
import { buildTellaPlan, type TellaPlan } from "../src/production/gptLive/tellaPlan";
import { buildTellaTimelineAudit } from "../src/production/gptLive/tellaState";
import { sealTellaExports } from "../src/production/gptLive/tellaExportReceipt";
import {
  SOURCE_FULLSCREEN_SSIM_THRESHOLD,
  deriveSourceFullscreenExpectations
} from "../src/production/gptLive/sourceFullscreen";
import { runCommand } from "../src/render/process";

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

const canonicalProgramAudio = () => {
  const episodeDir = "/episode";
  const tellaPlan = buildTellaPlan({
    episodeDir,
    narrationAssets: GPT_LIVE_CONTENT.narration.map(({ id }, index) => ({
      id,
      audioPath: join(episodeDir, "voice", `${id}.mp3`),
      durationSeconds: index + 1
    }))
  });
  return buildProgramAudioPlan(episodeDir, tellaPlan);
};

const fakeProgramAudioBindings = () => canonicalProgramAudio().inputs.map((input, index) => ({
  clipId: input.clipId,
  kind: input.kind,
  path: input.relativePath,
  sha256: String(index).padStart(64, "0"),
  byteSize: index + 1,
  durationSeconds: input.durationSeconds
}));

const fakeTellaExports = () => [
  {
    version: "version-a" as const,
    sourceVariant: "dynamic_editorial" as const,
    remoteVideoId: "video-a",
    workflowId: "Export-Story-video-a/Story",
    exportPath: "exports/tella-a.mp4" as const,
    sha256: "1".repeat(64),
    byteSize: 90
  },
  {
    version: "version-b" as const,
    sourceVariant: "aimh_visual_host" as const,
    remoteVideoId: "video-b",
    workflowId: "Export-Story-video-b/Story",
    exportPath: "exports/tella-b.mp4" as const,
    sha256: "1".repeat(64),
    byteSize: 90
  }
] as const;

const fakeSourceFullscreen = (value: TellaPlan = plan() as unknown as TellaPlan) =>
  deriveSourceFullscreenExpectations(value).map((sample) => ({
    ...sample,
    ssim: 0.93,
    threshold: SOURCE_FULLSCREEN_SSIM_THRESHOLD
  }));

const passingSourceFullscreen = async ({ plan: value }: { plan: TellaPlan }) =>
  fakeSourceFullscreen(value);

const preparedArtifact = (logicalId = "source:clip_translation") => ({
  logicalId,
  path: `${logicalId.replaceAll(":", "/")}.bin`,
  sha256: "a".repeat(64),
  byteSize: 17
});

const evidenceInspectionsFor = (
  artifacts: readonly { logicalId: string; sha256: string; byteSize: number }[]
) => GPT_LIVE_CONTENT.evidence
  .filter((evidence) => evidence.playbackDecision === "captured_source")
  .map((evidence, index) => {
    const source = GPT_LIVE_CONTENT.sources.find((item) => item.id === evidence.sourceId)!;
    const artifact = artifacts.find((item) => item.logicalId === `evidence:${evidence.id}`)!;
    return {
      evidenceId: evidence.id,
      sourceId: evidence.sourceId,
      canonicalUrl: source.url,
      assetPath: evidence.assetPath,
      sha256: artifact.sha256,
      byteSize: artifact.byteSize,
      width: 1280,
      height: 720,
      lumaRange: 200 - index,
      lumaVariance: 900 + index,
      normalizedEntropy: 0.2 + index / 100
    };
  });

describe("GPT-Live prepared artifact bindings", () => {
  const fingerprintInput = () => {
    const artifacts = [
      ...GPT_LIVE_CONTENT.evidence
        .filter((evidence) => evidence.playbackDecision === "captured_source")
        .map((evidence) => preparedArtifact(`evidence:${evidence.id}`)),
      preparedArtifact(),
      preparedArtifact("voice:narration_hook")
    ];
    return {
      production: { id: GPT_LIVE_CONTENT.id },
      voice: { provider: "elevenlabs" },
      plan: { productionId: GPT_LIVE_CONTENT.id },
      sourceMatrix: "matrix",
      sourceManifest: { productionId: GPT_LIVE_CONTENT.id },
      artifacts,
      evidenceInspections: evidenceInspectionsFor(artifacts)
    };
  };

  const preparedRecord = () => {
    const input = fingerprintInput();
    return {
      schemaVersion: "0.1.0",
      status: "prepared",
      productionId: GPT_LIVE_CONTENT.id,
      artifacts: input.artifacts,
      evidenceInspections: input.evidenceInspections,
      manifestFingerprint: buildPreparationFingerprint(input as any)
    };
  };

  it("accepts an exact prepared artifact binding schema", () => {
    const record = preparedRecord();
    expect(parsePreparedGenerationRecord(record, GPT_LIVE_CONTENT.id)).toEqual(record);
    expect(validatePreparedGeneration(
      record,
      GPT_LIVE_CONTENT.id,
      fingerprintInput() as any
    )).toEqual(record);
  });

  it.each([
    ["missing binding field", (record: any) => { delete record.artifacts[0].byteSize; }],
    ["extra binding field", (record: any) => { record.artifacts[0].durationSeconds = 1; }],
    ["invalid logical ID", (record: any) => { record.artifacts[0].logicalId = "../clip"; }],
    ["invalid path", (record: any) => { record.artifacts[0].path = ""; }],
    ["invalid hash", (record: any) => { record.artifacts[0].sha256 = "bad"; }],
    ["invalid byte size", (record: any) => { record.artifacts[0].byteSize = 0; }],
    ["extra top-level key", (record: any) => { record.untrustedPath = "/tmp/media"; }]
  ])("rejects a prepared record with $name", (_name, mutate) => {
    const record: any = preparedRecord();
    mutate(record);
    expect(() => parsePreparedGenerationRecord(record, GPT_LIVE_CONTENT.id))
      .toThrow(/prepared generation record/i);
  });

  it.each([
    ["missing", (artifacts: any[]) => artifacts.slice(1)],
    ["extra", (artifacts: any[]) => [...artifacts, preparedArtifact("branding:logo")]]
  ])("rejects $name prepared artifact coverage even with a matching forged fingerprint", (_name, mutate) => {
    const input = fingerprintInput();
    const artifacts = mutate(input.artifacts);
    const record = {
      ...preparedRecord(),
      artifacts,
      manifestFingerprint: buildPreparationFingerprint({ ...input, artifacts } as any)
    };
    expect(() => validatePreparedGeneration(record, GPT_LIVE_CONTENT.id, input as any))
      .toThrow(/prepared artifact|fingerprint/i);
  });
});

describe("GPT-Live finishing filters", () => {
  it("reconstructs real output audio from plan media and excludes continuous Tella audio", async () => {
    const fixtureDir = await mkdtemp(join(tmpdir(), "gpt-live-program-audio-"));
    const episodeDir = join(fixtureDir, "episode");
    const tellaPath = join(episodeDir, "exports", "tella-a.mp4");
    const logoPath = join(fixtureDir, "logo.png");
    const outroPath = join(fixtureDir, "outro.m4a");
    const outputPath = join(fixtureDir, "finished.mp4");
    const pcmPath = join(fixtureDir, "finished.f32le");
    const durationSeconds = 4.5;
    await Promise.all(["exports", "source", "master", "voice"].map((directory) =>
      mkdir(join(episodeDir, directory), { recursive: true })
    ));

    try {
      await runCommand("ffmpeg", [
        "-y",
        "-f", "lavfi", "-i", `color=c=0x202020:s=320x180:r=30:d=${durationSeconds}`,
        "-f", "lavfi", "-i", `sine=frequency=1000:sample_rate=48000:duration=${durationSeconds}`,
        "-shortest", "-c:v", "libx264", "-pix_fmt", "yuv420p", "-c:a", "aac", tellaPath
      ]);
      await runCommand("ffmpeg", [
        "-y", "-f", "lavfi", "-i", "color=c=white:s=32x16:d=0.1",
        "-frames:v", "1", "-update", "1", logoPath
      ]);
      await runCommand("ffmpeg", [
        "-y", "-f", "lavfi", "-i", "sine=frequency=1500:sample_rate=48000:duration=1",
        "-c:a", "aac", outroPath
      ]);

      const basePlan = buildTellaPlan({
        episodeDir,
        narrationAssets: GPT_LIVE_CONTENT.narration.map(({ id }) => ({
          id,
          audioPath: join(episodeDir, "voice", `${id}.mp3`),
          durationSeconds: 0.5
        }))
      });
      const testPlan = {
        ...basePlan,
        clips: basePlan.clips.map((clip) => ({ ...clip, durationSeconds: 0.5 }))
      };
      const tones = [300, 500, 400, 600, 0, 700, 0, 800, 0];
      await Promise.all(testPlan.clips.map((clip, index) => {
        const path = clip.kind === "source_clip" ? clip.mediaPath : clip.masterPath;
        const tone = tones[index]!;
        const source = tone === 0
          ? "anullsrc=r=48000:cl=stereo:d=0.5"
          : `sine=frequency=${tone}:sample_rate=48000:duration=0.5`;
        return runCommand("ffmpeg", [
          "-y", "-f", "lavfi", "-i", source, "-c:a", "aac", path
        ]);
      }));

      const programAudio = buildProgramAudioPlan(episodeDir, testPlan);
      const sourceIntervals = deriveSourceDuckIntervals(testPlan);
      const unitySourceGains = deriveSharedSourceGains(
        sourceIntervals,
        [-23, -23],
        [-23, -23]
      );
      const args = buildFinishFfmpegArgs({
        inputPath: tellaPath,
        logoPath,
        programAudio,
        outroMusicPath: outroPath,
        outroDurationSeconds: 1,
        outputPath,
        durationSeconds,
        sourceGains: unitySourceGains
      });
      const graph = args[args.indexOf("-filter_complex") + 1]!;
      expect(graph).not.toContain("[0:a]");
      await runCommand("ffmpeg", args);
      await runCommand("ffmpeg", [
        "-y", "-i", outputPath, "-map", "0:a:0", "-ac", "1", "-ar", "48000",
        "-f", "f32le", pcmPath
      ]);

      const pcmBytes = await readFile(pcmPath);
      const samples = new Float32Array(
        pcmBytes.buffer,
        pcmBytes.byteOffset,
        Math.floor(pcmBytes.byteLength / Float32Array.BYTES_PER_ELEMENT)
      );
      expect(Math.abs(samples.length / 48_000 - durationSeconds)).toBeLessThan(0.05);
      const amplitude = (frequency: number, startSeconds: number, endSeconds: number) => {
        const start = Math.floor(startSeconds * 48_000);
        const end = Math.min(samples.length, Math.floor(endSeconds * 48_000));
        let sine = 0;
        let cosine = 0;
        for (let index = start; index < end; index += 1) {
          const phase = 2 * Math.PI * frequency * index / 48_000;
          sine += samples[index]! * Math.sin(phase);
          cosine += samples[index]! * Math.cos(phase);
        }
        return 2 * Math.hypot(sine, cosine) / (end - start);
      };

      expect(amplitude(1000, 0.1, 3.4)).toBeLessThan(0.002);
      expect(amplitude(300, 0.1, 0.4)).toBeGreaterThan(0.03);
      expect(amplitude(500, 0.6, 0.9)).toBeGreaterThan(0.03);
      expect(amplitude(400, 1.1, 1.4)).toBeGreaterThan(0.03);
      expect(amplitude(1500, 3.7, 4.2)).toBeGreaterThan(0.005);
    } finally {
      await rm(fixtureDir, { recursive: true, force: true });
    }
  }, 30_000);


  it("binds exactly nine plan-owned audio inputs in timeline order", () => {
    const programAudio = canonicalProgramAudio();

    expect(programAudio).toMatchObject({
      source: "audited_plan_media",
      tellaInputAudioUsed: false,
      clipOrder: GPT_LIVE_CONTENT.timeline.map(({ id }) => id)
    });
    expect(programAudio.inputs).toHaveLength(9);
    expect(programAudio.inputs.map(({ inputIndex, clipId, kind, path }) => ({
      inputIndex,
      clipId,
      kind,
      path
    }))).toEqual(programAudio.inputs.map((input, index) => ({
      inputIndex: index + 2,
      clipId: GPT_LIVE_CONTENT.timeline[index]!.id,
      kind: GPT_LIVE_CONTENT.timeline[index]!.kind,
      path: input.kind === "source_clip"
        ? join("/episode", "source", `${input.clipId}.mp4`)
        : join("/episode", "master", `${input.clipId}.mp4`)
    })));
  });

  it.each([
    ["count", (clips: any[]) => clips.slice(0, -1)],
    ["order", (clips: any[]) => [clips[1], clips[0], ...clips.slice(2)]],
    ["kind", (clips: any[]) => [{ ...clips[0], kind: "narration" }, ...clips.slice(1)]],
    ["path", (clips: any[]) => [{ ...clips[0], mediaPath: "/outside/source.mp4" }, ...clips.slice(1)]],
    ["duration", (clips: any[]) => [{ ...clips[0], durationSeconds: 0 }, ...clips.slice(1)]]
  ])("rejects invalid program-audio plan %s", (_name, mutate) => {
    const episodeDir = "/episode";
    const tellaPlan = buildTellaPlan({
      episodeDir,
      narrationAssets: GPT_LIVE_CONTENT.narration.map(({ id }) => ({
        id,
        audioPath: join(episodeDir, "voice", `${id}.mp3`),
        durationSeconds: 1
      }))
    });

    expect(() => buildProgramAudioPlan(episodeDir, {
      ...tellaPlan,
      clips: mutate([...tellaPlan.clips])
    })).toThrow(/program audio/i);
  });

  it("rejects a program-audio plan with the wrong schema or source preservation contract", () => {
    const episodeDir = "/episode";
    const tellaPlan = buildTellaPlan({
      episodeDir,
      narrationAssets: GPT_LIVE_CONTENT.narration.map(({ id }) => ({
        id,
        audioPath: join(episodeDir, "voice", `${id}.mp3`),
        durationSeconds: 1
      }))
    });

    expect(() => buildProgramAudioPlan(episodeDir, {
      ...tellaPlan,
      schemaVersion: "9.9.9"
    } as any)).toThrow(/program audio/i);
    expect(() => buildProgramAudioPlan(episodeDir, {
      ...tellaPlan,
      clips: tellaPlan.clips.map((clip, index) => index === 0
        ? { ...clip, preserveOriginalAudio: false }
        : clip)
    } as any)).toThrow(/program audio/i);
  });

  it("uses Tella only for video and maps plan audio before the final outro input", () => {
    const programAudio = canonicalProgramAudio();
    const args = buildFinishFfmpegArgs({
      inputPath: "/episode/exports/tella-a.mp4",
      logoPath: "/assets/logo.png",
      programAudio,
      outroMusicPath: "/assets/outro.mp3",
      outroDurationSeconds: 2,
      outputPath: "/episode/final/version-a.mp4",
      durationSeconds: 30,
      sourceGains
    });
    const inputPaths = args.flatMap((arg, index) => arg === "-i" ? [args[index + 1]!] : []);
    const graph = args[args.indexOf("-filter_complex") + 1]!;

    expect(inputPaths).toEqual([
      "/episode/exports/tella-a.mp4",
      "/assets/logo.png",
      ...programAudio.inputs.map(({ path }) => path),
      "/assets/outro.mp3"
    ]);
    expect(graph).not.toContain("[0:a]");
    expect(graph).toContain("[2:a]");
    expect(graph).toContain("[10:a]");
    expect(graph).toContain("[11:a]aresample=48000");
    expect(graph).toContain("atrim=duration=2.000");
    expect(graph).toContain("concat=n=9:v=0:a=1");
  });

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

  it("mixes only a seven-second outro at the end of a 150-second program", () => {
    const args = buildFinishFfmpegArgs({
        inputPath: "/episode/exports/tella-a.mp4",
        logoPath: "/assets/logo.png",
        programAudio: canonicalProgramAudio(),
        outroMusicPath: "/assets/Outro_Much_Higher_Causmic.mp3",
        outroDurationSeconds: 7,
        outputPath: "/episode/final/version-a.tmp.mp4",
        durationSeconds: 150,
        sourceGains
      });
    expect(args).not.toContain("-stream_loop");
    expect(args.slice(0, 5)).toEqual([
      "-y",
      "-i",
      "/episode/exports/tella-a.mp4",
      "-i",
      "/assets/logo.png"
    ]);
    const graph = args[args.indexOf("-filter_complex") + 1]!;
    expect(graph).toContain(buildLogoFilter());
    expect(graph).toContain("apad=whole_dur=150.000");
    expect(graph).toContain("atrim=duration=150.000");
    expect(graph).toContain("between(t,0.000,12.350)");
    expect(graph).toContain("[11:a]aresample=48000");
    expect(graph).toContain("atrim=duration=7.000,asetpts=PTS-STARTPTS");
    expect(graph).toContain("afade=t=in:st=0:d=0.250");
    expect(graph).toContain("afade=t=out:st=6.250:d=0.750");
    expect(graph).toContain("volume=0.160");
    expect(graph).toContain("adelay=143000:all=1");
    expect(graph).toContain("amix=inputs=2:duration=longest:dropout_transition=0:normalize=0");
    expect(graph).toContain("alimiter=limit=0.95:attack=5:release=50:level=false:latency=true");
    expect(graph).not.toContain("0.070");
    expect(graph).not.toContain("0.020");
    expect(graph).not.toContain("volume='min(");
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
      "150.000",
      "-movflags",
      "+faststart",
      "/episode/final/version-a.tmp.mp4"
    ]);
  });

  it("clamps the outro to a short program without negative fade or delay times", () => {
    const args = buildFinishFfmpegArgs({
      inputPath: "/episode/exports/tella-a.mp4",
      logoPath: "/assets/logo.png",
      programAudio: canonicalProgramAudio(),
      outroMusicPath: "/assets/outro.mp3",
      outroDurationSeconds: 7,
      outputPath: "/episode/final/version-a.tmp.mp4",
      durationSeconds: 0.5,
      sourceGains
    });
    const graph = args[args.indexOf("-filter_complex") + 1]!;

    expect(graph).toContain("[11:a]aresample=48000");
    expect(graph).toContain("atrim=duration=0.500");
    expect(graph).toContain("afade=t=out:st=0.000:d=0.500");
    expect(graph).toContain("adelay=0:all=1");
    expect(graph).not.toContain("st=-");
    expect(graph).not.toContain("adelay=-");
    expect(args).not.toContain("-stream_loop");
  });

  it("builds identical finishing settings for both variants", () => {
    const shared = {
      logoPath: "/assets/logo.png",
      programAudio: canonicalProgramAudio(),
      outroMusicPath: "/assets/music.mp3",
      outroDurationSeconds: 7,
      durationSeconds: 10.75,
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
      [
        "assets",
        "evidence",
        "voice",
        "tella",
        "exports",
        "final",
        "reports",
        "source",
        "master",
        "plates/dynamic_editorial",
        "plates/aimh_visual_host"
      ].map((directory) =>
        mkdir(join(episodeDir, directory), { recursive: true })
      )
    );
    const production = {
      id: GPT_LIVE_CONTENT.id,
      branding: {
        ...GPT_LIVE_CONTENT.branding,
        logoPath: join(episodeDir, "assets", "logo.png")
      },
      audio: {
        introMusic: false,
        bodyMusic: false,
        outroMusicPath: join(episodeDir, "assets", "outro.mp3"),
        outroDurationSeconds: 7
      }
    };
    const baseEpisodePlan = buildTellaPlan({
      episodeDir,
      narrationAssets: GPT_LIVE_CONTENT.narration.map(({ id }, index) => ({
        id,
        audioPath: join(episodeDir, "voice", `${id}.mp3`),
        durationSeconds: index === 0 ? 5.5 : 1 / 6
      }))
    });
    const episodePlan = {
      ...baseEpisodePlan,
      clips: baseEpisodePlan.clips.map((clip) => ({
        ...clip,
        durationSeconds: clip.id === "clip_translation"
          ? 3
          : clip.id === "clip_interruption"
            ? 2.25
            : clip.durationSeconds
      }))
    };
    const voice = {
      provider: "elevenlabs",
      chunks: GPT_LIVE_CONTENT.narration.map(({ id }, index) => ({
        id,
        text: `narration-${id}`,
        file: join(episodeDir, "voice", `${id}.mp3`),
        durationSeconds: index === 0 ? 5.5 : 1 / 6,
        provider: "elevenlabs",
        cached: true
      })),
      warnings: []
    };
    const sourceMatrix = "test source matrix";
    const sourceManifest = { schemaVersion: "0.1.0", productionId: GPT_LIVE_CONTENT.id, sources: [] };
    const variantVideoIds = {
      dynamic_editorial: "video-a",
      aimh_visual_host: "video-b"
    };
    const sourceIds = Object.fromEntries([
      ...episodePlan.clips.map((clip) => [clip.id, `source-${clip.id}`]),
      ...episodePlan.clips.filter((clip) => clip.kind === "narration").flatMap((clip) =>
        GPT_LIVE_CONTENT.variants.map((variant) => [
          `plate:${variant}:${clip.id}`,
          `plate-${variant}-${clip.id}`
        ])
      )
    ]);
    const variantClipIds = Object.fromEntries(
      GPT_LIVE_CONTENT.variants.map((variant) => [
        variant,
        Object.fromEntries(episodePlan.clips.map((clip) => [clip.id, `${variant}-${clip.id}`]))
      ])
    ) as Record<(typeof GPT_LIVE_CONTENT.variants)[number], Record<string, string>>;
    const layoutIds = Object.fromEntries(
      episodePlan.clips.filter((clip) => clip.kind === "narration").flatMap((clip) =>
        GPT_LIVE_CONTENT.variants.map((variant) => [
          `${variant}:${clip.id}`,
          `layout-${variant}-${clip.id}`
        ])
      )
    );
    const state = {
      masterVideoId: "video-master",
      variantVideoIds,
      clipIds: Object.fromEntries(episodePlan.clips.map((clip) => [clip.id, `clip-${clip.id}`])),
      sourceIds,
      variantClipIds,
      layoutIds,
      exportPaths: {
        dynamic_editorial: join(episodeDir, "exports", "tella-a.mp4"),
        aimh_visual_host: join(episodeDir, "exports", "tella-b.mp4")
      }
    };
    const durationMs = Math.round(
      episodePlan.clips.reduce((total, clip) => total + clip.durationSeconds, 0) * 1_000
    );
    const timelineAudit = buildTellaTimelineAudit({
      plan: episodePlan,
      state,
      remoteStoryDurationMs: {
        dynamic_editorial: durationMs,
        aimh_visual_host: durationMs
      },
      narrationLayoutDurationMs: Object.fromEntries(
        GPT_LIVE_CONTENT.variants.map((variant) => [
          variant,
          Object.fromEntries(
            episodePlan.clips.filter((clip) => clip.kind === "narration").map((clip) => [
              clip.id,
              Math.round(clip.durationSeconds * 1_000)
            ])
          )
        ])
      ) as Record<(typeof GPT_LIVE_CONTENT.variants)[number], Record<string, number>>
    });
    await Promise.all([
      writeFile(join(episodeDir, "production.json"), JSON.stringify(production), "utf8"),
      writeFile(join(episodeDir, "assets", "logo.png"), "logo-bytes", "utf8"),
      writeFile(join(episodeDir, "assets", "outro.mp3"), "outro-bytes", "utf8"),
      writeFile(join(episodeDir, "voice", "narration.json"), JSON.stringify(voice), "utf8"),
      writeFile(join(episodeDir, "tella", "plan.json"), JSON.stringify(episodePlan), "utf8"),
      writeFile(join(episodeDir, "tella", "state.json"), JSON.stringify({ ...state, timelineAudit }), "utf8"),
      writeFile(join(episodeDir, "exports", "tella-a.mp4"), "export-a", "utf8"),
      writeFile(join(episodeDir, "exports", "tella-b.mp4"), "export-b", "utf8"),
      ...episodePlan.clips.map((clip) => writeFile(
        clip.kind === "source_clip" ? clip.mediaPath : clip.masterPath,
        `program-audio-${clip.id}`,
        "utf8"
      )),
      ...voice.chunks.map((chunk) => writeFile(chunk.file, `voice-audio-${chunk.id}`, "utf8")),
      ...episodePlan.clips.flatMap((clip) => clip.kind === "narration"
        ? Object.values(clip.variants).map((variant) => writeFile(
            variant.platePath,
            `plate-video-${clip.id}-${variant.platePath.includes("dynamic_editorial") ? "a" : "b"}`,
            "utf8"
          ))
        : []),
      ...GPT_LIVE_CONTENT.evidence
        .filter((evidence) => evidence.playbackDecision === "captured_source")
        .map((evidence) => writeFile(
          join(episodeDir, evidence.assetPath),
          `evidence-capture-${evidence.id}`,
          "utf8"
        )),
      writeFile(join(episodeDir, "final", "version-a.mp4"), "approved-a", "utf8"),
      writeFile(join(episodeDir, "final", "version-b.mp4"), "approved-b", "utf8"),
      writeFile(join(episodeDir, "reports", "post-production.json"), "{}\n", "utf8"),
      writeFile(join(episodeDir, "reports", "source-matrix.md"), sourceMatrix, "utf8"),
      writeFile(join(episodeDir, "reports", "source-manifest.json"), JSON.stringify(sourceManifest), "utf8")
    ]);
    const artifacts = await hashPreparedArtifactDescriptors(
      derivePreparedArtifactDescriptors({
        episodeDir,
        production,
        voice,
        plan: episodePlan
      }),
      async (path) => readFile(path)
    );
    const evidenceInspections = evidenceInspectionsFor(artifacts);
    const preparationFingerprint = buildPreparationFingerprint({
      production,
      voice,
      plan: episodePlan,
      sourceMatrix,
      sourceManifest,
      artifacts,
      evidenceInspections
    });
    await writeFile(join(episodeDir, "reports", "prepared.json"), JSON.stringify({
      schemaVersion: "0.1.0",
      status: "prepared",
      productionId: GPT_LIVE_CONTENT.id,
      artifacts,
      evidenceInspections,
      manifestFingerprint: preparationFingerprint
    }), "utf8");
    await sealTellaExports({
      episodeDir,
      exports: [
        {
          version: "version-a",
          sourceVariant: "dynamic_editorial",
          remoteVideoId: "video-a",
          workflowId: "Export-Story-video-a/Story"
        },
        {
          version: "version-b",
          sourceVariant: "aimh_visual_host",
          remoteVideoId: "video-b",
          workflowId: "Export-Story-video-b/Story"
        }
      ]
    });
    return episodeDir;
  };

  const finishOptions = (episodeDir: string) => ({
    episodeDir,
    env: {
      AIMH_LOGO_PATH: join(episodeDir, "assets", "logo.png"),
      AIMH_OUTRO_MUSIC_PATH: join(episodeDir, "assets", "outro.mp3")
    },
    ffmpegPath: "ffmpeg",
    ffprobePath: "ffprobe"
  });

  const sha256 = (value: string): string => createHash("sha256").update(value).digest("hex");
  const publishedVariants = [
    {
      name: "version-a" as const,
      inputSha256: "1".repeat(64),
      inputByteSize: 1,
      sha256: "a".repeat(64),
      byteSize: 1
    },
    {
      name: "version-b" as const,
      inputSha256: "2".repeat(64),
      inputByteSize: 1,
      sha256: "b".repeat(64),
      byteSize: 1
    }
  ];

  it("binds the prepared fingerprint and exact Tella inputs in the post-production manifest", () => {
    const preparationFingerprint = sha256("prepared-generation");
    const programAudio = canonicalProgramAudio();
    const programAudioBindings = programAudio.inputs.map((input, index) => ({
      clipId: input.clipId,
      kind: input.kind,
      path: input.relativePath,
      sha256: String(index).padStart(64, "0"),
      byteSize: index + 1,
      durationSeconds: input.durationSeconds
    }));
    const tellaExports = [
      {
        version: "version-a" as const,
        sourceVariant: "dynamic_editorial" as const,
        remoteVideoId: "vid_dynamic",
        workflowId: "Export-Story-vid_dynamic/Story",
        exportPath: "exports/tella-a.mp4" as const,
        sha256: sha256("export-a"),
        byteSize: 8
      },
      {
        version: "version-b" as const,
        sourceVariant: "aimh_visual_host" as const,
        remoteVideoId: "vid_host",
        workflowId: "Export-Story-vid_host/Story",
        exportPath: "exports/tella-b.mp4" as const,
        sha256: sha256("export-b"),
        byteSize: 8
      }
    ] as const;
    const sourceFullscreen = deriveSourceFullscreenExpectations(
      plan() as unknown as TellaPlan
    ).map((sample) => ({
      ...sample,
      ssim: 0.93,
      threshold: SOURCE_FULLSCREEN_SSIM_THRESHOLD
    }));
    const manifest = buildPostProductionManifest({
      productionId: GPT_LIVE_CONTENT.id,
      generationId: "00000000-0000-4000-8000-000000000000",
      preparationFingerprint,
      logoPath: "/assets/logo.png",
      outroMusicPath: "/assets/outro.mp3",
      outroDurationSeconds: 7,
      logoSha256: sha256("logo"),
      programAudio: programAudioBindings,
      sourceGains: [],
      logoEvidence: [],
      tellaExports,
      sourceFullscreen,
      variants: [
        {
          name: "version-a",
          inputPath: "/episode/exports/tella-a.mp4",
          outputPath: "/episode/final/version-a.mp4",
          inputDurationSeconds: 10,
          outputDurationSeconds: 10,
          inputSha256: sha256("export-a"),
          inputByteSize: 8,
          sha256: sha256("final-a"),
          byteSize: 7
        },
        {
          name: "version-b",
          inputPath: "/episode/exports/tella-b.mp4",
          outputPath: "/episode/final/version-b.mp4",
          inputDurationSeconds: 10,
          outputDurationSeconds: 10,
          inputSha256: sha256("export-b"),
          inputByteSize: 8,
          sha256: sha256("final-b"),
          byteSize: 7
        }
      ]
    } as Parameters<typeof buildPostProductionManifest>[0] & {
      preparationFingerprint: string;
    });

    expect(manifest).toMatchObject({
      preparationFingerprint,
      programAudio: {
        source: "audited_plan_media",
        tellaInputAudioUsed: false,
        clipOrder: programAudio.clipOrder,
        inputs: programAudioBindings
      },
      variants: [
        { inputSha256: sha256("export-a"), inputByteSize: 8 },
        { inputSha256: sha256("export-b"), inputByteSize: 8 }
      ],
      tellaExports,
      sourceFullscreen
    });
  });

  const writeGenerationMarker = async (
    episodeDir: string,
    expectedA: string,
    expectedB: string,
    generationId = "00000000-0000-4000-8000-000000000000"
  ) => {
    const prepared = JSON.parse(
      await readFile(join(episodeDir, "reports", "prepared.json"), "utf8")
    ) as { manifestFingerprint: string };
    const episodePlan = JSON.parse(
      await readFile(join(episodeDir, "tella", "plan.json"), "utf8")
    );
    const programAudio = await Promise.all(
      buildProgramAudioPlan(episodeDir, episodePlan).inputs.map(async (input) => {
        const bytes = await readFile(input.path);
        return {
          clipId: input.clipId,
          kind: input.kind,
          path: input.relativePath,
          sha256: createHash("sha256").update(bytes).digest("hex"),
          byteSize: bytes.byteLength,
          durationSeconds: input.durationSeconds
        };
      })
    );
    const report = buildPostProductionManifest({
      productionId: GPT_LIVE_CONTENT.id,
      generationId,
      preparationFingerprint: prepared.manifestFingerprint,
      logoPath: join(episodeDir, "assets", "logo.png"),
      outroMusicPath: "/assets/outro.mp3",
      outroDurationSeconds: 7,
      logoSha256: sha256("logo-bytes"),
      programAudio,
      sourceGains: sourceGains.map((gain) => ({
        ...gain,
        outputLufsA: -23,
        outputLufsB: -23
      })),
      logoEvidence: (["version-a", "version-b"] as const).map((name, index) => ({
        name,
        samples: [0.5, 5.875, 11.25].map((timeSeconds) => ({
          timeSeconds,
          inputSha256: (index === 0 ? "b" : "d").repeat(64),
          outputSha256: (index === 0 ? "c" : "e").repeat(64)
        }))
      })),
      tellaExports: JSON.parse(
        await readFile(join(episodeDir, "reports", "tella-export-receipt.json"), "utf8")
      ).exports,
      sourceFullscreen: fakeSourceFullscreen(episodePlan),
      variants: [
        {
          name: "version-a",
          inputPath: "exports/tella-a.mp4",
          outputPath: "final/version-a.mp4",
          inputDurationSeconds: 11.75,
          outputDurationSeconds: 11.75,
          inputSha256: sha256("export-a"),
          inputByteSize: Buffer.byteLength("export-a"),
          sha256: sha256(expectedA),
          byteSize: Buffer.byteLength(expectedA)
        },
        {
          name: "version-b",
          inputPath: "exports/tella-b.mp4",
          outputPath: "final/version-b.mp4",
          inputDurationSeconds: 11.75,
          outputDurationSeconds: 11.75,
          inputSha256: sha256("export-b"),
          inputByteSize: Buffer.byteLength("export-b"),
          sha256: sha256(expectedB),
          byteSize: Buffer.byteLength(expectedB)
        }
      ]
    });
    await writeFile(
      join(episodeDir, "reports", "post-production.json"),
      `${JSON.stringify(report, null, 2)}\n`,
      "utf8"
    );
    return report;
  };

  const mutateGenerationMarker = async (
    episodeDir: string,
    mutate: (report: Record<string, any>) => void
  ) => {
    const reportPath = join(episodeDir, "reports", "post-production.json");
    const report = JSON.parse(await readFile(reportPath, "utf8")) as Record<string, any>;
    mutate(report);
    await writeFile(reportPath, `${JSON.stringify(report, null, 2)}\n`, "utf8");
  };

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
    },
    {
      name: "program audio file",
      replace: async (episodeDir: string, outsideDir: string) => {
        const outsideFile = join(outsideDir, "outside-program.mp4");
        const sourcePath = join(episodeDir, "source", "clip_translation.mp4");
        await writeFile(outsideFile, "outside", "utf8");
        await rm(sourcePath);
        await symlink(outsideFile, sourcePath);
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
          inspectFinalMediaFile: async () => validInspection(11.75),
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

  it("rejects missing program audio before loudness measurement or FFmpeg", async () => {
    const episodeDir = await createContainedEpisode();
    const measureIntervalLoudness = vi.fn(async (_ffmpeg: string, _file: string) => -23);
    const runCommand = vi.fn(async () => ({ stdout: "", stderr: "" }));
    await rm(join(episodeDir, "master", "narration_hook.mp4"));

    try {
      await expect(finishGptLiveProduction(finishOptions(episodeDir), {
        access: async () => undefined,
        inspectFinalMediaFile: async () => validInspection(11.75),
        measureIntervalLoudness,
        runCommand
      })).rejects.toThrow(/missing|not found|ENOENT|program audio/i);
      expect(measureIntervalLoudness).not.toHaveBeenCalled();
      expect(runCommand).not.toHaveBeenCalled();
    } finally {
      await rm(episodeDir, { recursive: true, force: true });
    }
  });

  it("creates a secret-free manifest with only safe relative asset and media paths", () => {
    const manifest = buildPostProductionManifest({
      productionId: "test-production",
      generationId: "00000000-0000-4000-8000-000000000000",
      preparationFingerprint: "8".repeat(64),
      logoPath: "/Users/editor/private/logo.png",
      outroMusicPath: "/Users/editor/private/Outro_Much_Higher_Causmic.mp3",
      outroDurationSeconds: 7,
      logoSha256: "a".repeat(64),
      programAudio: fakeProgramAudioBindings(),
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
      tellaExports: fakeTellaExports(),
      sourceFullscreen: fakeSourceFullscreen(),
      variants: [
        {
          name: "version-a",
          inputPath: "/private/episode/exports/tella-a.mp4",
          outputPath: "/private/episode/final/version-a.mp4",
          inputDurationSeconds: 11.75,
          outputDurationSeconds: 10.5,
          inputSha256: "1".repeat(64),
          inputByteSize: 900,
          sha256: "f".repeat(64),
          byteSize: 1000
        },
        {
          name: "version-b",
          inputPath: "/private/episode/exports/tella-b.mp4",
          outputPath: "/private/episode/final/version-b.mp4",
          inputDurationSeconds: 11.75,
          outputDurationSeconds: 10.5,
          inputSha256: "2".repeat(64),
          inputByteSize: 901,
          sha256: "9".repeat(64),
          byteSize: 1001
        }
      ]
    });
    const serialized = JSON.stringify(manifest);

    expect(manifest).toMatchObject({
      schemaVersion: "0.3.0",
      status: "finished",
      generationId: "00000000-0000-4000-8000-000000000000",
      assets: {
        logo: "logo.png",
        logoSha256: "a".repeat(64)
      },
      audioPolicy: {
        introMusic: false,
        bodyMusic: false,
        outro: {
          file: "Outro_Much_Higher_Causmic.mp3",
          startSeconds: 4.75,
          durationSeconds: 7,
          fadeInSeconds: 0.25,
          fadeOutSeconds: 0.75
        }
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
        videoCodec: "libx264",
        audioCodec: "aac"
      }
    });
    expect(manifest).not.toHaveProperty("duckIntervals");
    expect(manifest.settings).not.toHaveProperty("normalMusicVolume");
    expect(manifest.settings).not.toHaveProperty("duckedMusicVolume");
    expect(manifest.settings).not.toHaveProperty("musicLoop");
    expect(manifest.variants.map(({ inputPath, outputPath }) => ({ inputPath, outputPath }))).toEqual([
      { inputPath: "exports/tella-a.mp4", outputPath: "final/version-a.mp4" },
      { inputPath: "exports/tella-b.mp4", outputPath: "final/version-b.mp4" }
    ]);
    expect(manifest.variants.map(({ sha256, byteSize }) => ({ sha256, byteSize }))).toEqual([
      { sha256: "f".repeat(64), byteSize: 1000 },
      { sha256: "9".repeat(64), byteSize: 1001 }
    ]);
    expect(serialized).not.toMatch(/\/Users|\/private|secret|token|api.?key/i);
  });

  it("reports the actual fade-out duration for a short program", () => {
    const manifest = buildPostProductionManifest({
      productionId: "test-production",
      generationId: "00000000-0000-4000-8000-000000000000",
      preparationFingerprint: "8".repeat(64),
      logoPath: "/assets/logo.png",
      outroMusicPath: "/assets/outro.mp3",
      outroDurationSeconds: 7,
      logoSha256: "a".repeat(64),
      programAudio: fakeProgramAudioBindings(),
      sourceGains: [],
      logoEvidence: [],
      tellaExports: fakeTellaExports(),
      sourceFullscreen: fakeSourceFullscreen(),
      variants: (["version-a", "version-b"] as const).map((name) => ({
        name,
        inputPath: `/episode/exports/${name}.mp4`,
        outputPath: `/episode/final/${name}.mp4`,
        inputDurationSeconds: 0.5,
        outputDurationSeconds: 0.5,
        inputSha256: "1".repeat(64),
        inputByteSize: 90,
        sha256: "b".repeat(64),
        byteSize: 100
      }))
    });

    expect(manifest.audioPolicy.outro).toMatchObject({
      startSeconds: 0,
      durationSeconds: 0.5,
      fadeOutSeconds: 0.5
    });
  });

  it("rejects a published generation marker without the outro audio policy", async () => {
    const episodeDir = await createContainedEpisode();
    await writeFile(join(episodeDir, "final", "version-a.mp4"), "current-a", "utf8");
    await writeFile(join(episodeDir, "final", "version-b.mp4"), "current-b", "utf8");
    const report = await writeGenerationMarker(episodeDir, "current-a", "current-b");
    const { audioPolicy: _audioPolicy, ...legacyReport } = report;
    await writeFile(
      join(episodeDir, "reports", "post-production.json"),
      `${JSON.stringify(legacyReport, null, 2)}\n`,
      "utf8"
    );

    try {
      await expect(validatePublishedGeneration(episodeDir)).rejects.toThrow(/audio policy|manifest/i);
    } finally {
      await rm(episodeDir, { recursive: true, force: true });
    }
  });

  it.each([
    {
      name: "wrong outro file",
      mutate: (report: Record<string, any>) => {
        report.audioPolicy.outro.file = "wrong-outro.mp3";
      }
    },
    {
      name: "wrong outro start",
      mutate: (report: Record<string, any>) => {
        report.audioPolicy.outro.startSeconds = 2;
      }
    },
    {
      name: "wrong outro duration",
      mutate: (report: Record<string, any>) => {
        report.audioPolicy.outro.durationSeconds = 6;
      }
    },
    {
      name: "enabled body music",
      mutate: (report: Record<string, any>) => {
        report.audioPolicy.bodyMusic = true;
      }
    },
    {
      name: "legacy top-level duck intervals",
      mutate: (report: Record<string, any>) => {
        report.duckIntervals = [];
      }
    },
    {
      name: "legacy music loop setting",
      mutate: (report: Record<string, any>) => {
        report.settings.musicLoop = true;
      }
    },
    {
      name: "legacy music asset",
      mutate: (report: Record<string, any>) => {
        report.assets.music = "outro.mp3";
      }
    },
    {
      name: "private Windows outro path",
      mutate: (report: Record<string, any>) => {
        report.audioPolicy.outro.file = "C:\\Users\\editor\\private\\outro.mp3";
      }
    }
  ])("rejects a published generation with $name", async ({ mutate }) => {
    const episodeDir = await createContainedEpisode();
    await writeFile(join(episodeDir, "final", "version-a.mp4"), "current-a", "utf8");
    await writeFile(join(episodeDir, "final", "version-b.mp4"), "current-b", "utf8");
    await writeGenerationMarker(episodeDir, "current-a", "current-b");
    await mutateGenerationMarker(episodeDir, mutate);

    try {
      await expect(validatePublishedGeneration(episodeDir)).rejects.toThrow(/audio|manifest/i);
    } finally {
      await rm(episodeDir, { recursive: true, force: true });
    }
  });

  it.each([
    {
      name: "mutated video codec",
      mutate: (report: Record<string, any>) => {
        report.settings.videoCodec = "hevc";
      }
    },
    {
      name: "mutated exact-duration setting",
      mutate: (report: Record<string, any>) => {
        report.settings.exactAudioDuration = false;
      }
    },
    {
      name: "wrong logo asset",
      mutate: (report: Record<string, any>) => {
        report.assets.logo = "other-logo.png";
      }
    },
    {
      name: "wrong logo asset hash",
      mutate: (report: Record<string, any>) => {
        report.assets.logoSha256 = "9".repeat(64);
      }
    },
    {
      name: "mutated source-dialogue policy",
      mutate: (report: Record<string, any>) => {
        report.sourceDialogue.targetLufs = -14;
      }
    },
    {
      name: "malformed source-dialogue interval",
      mutate: (report: Record<string, any>) => {
        delete report.sourceDialogue.intervals[0].outputLufsA;
      }
    },
    {
      name: "source-dialogue interval moved off the plan",
      mutate: (report: Record<string, any>) => {
        report.sourceDialogue.intervals[0].startSeconds = 0.2;
      }
    },
    {
      name: "missing logo evidence",
      mutate: (report: Record<string, any>) => {
        delete report.logoEvidence;
      }
    },
    {
      name: "empty logo evidence",
      mutate: (report: Record<string, any>) => {
        report.logoEvidence = [];
      }
    }
  ])("rejects a published generation with $name", async ({ mutate }) => {
    const episodeDir = await createContainedEpisode();
    await writeFile(join(episodeDir, "final", "version-a.mp4"), "current-a", "utf8");
    await writeFile(join(episodeDir, "final", "version-b.mp4"), "current-b", "utf8");
    await writeGenerationMarker(episodeDir, "current-a", "current-b");
    await mutateGenerationMarker(episodeDir, mutate);

    try {
      await expect(validatePublishedGeneration(episodeDir)).rejects.toThrow(
        /asset|evidence|logo|manifest|setting|source/i
      );
    } finally {
      await rm(episodeDir, { recursive: true, force: true });
    }
  });

  it("rejects serialized outro timing that drifts from the expected policy", async () => {
    const episodeDir = await createContainedEpisode();
    await writeFile(join(episodeDir, "final", "version-a.mp4"), "current-a", "utf8");
    await writeFile(join(episodeDir, "final", "version-b.mp4"), "current-b", "utf8");
    await writeGenerationMarker(episodeDir, "current-a", "current-b");
    await mutateGenerationMarker(episodeDir, (report) => {
      report.audioPolicy.outro.startSeconds = 3.5;
      report.audioPolicy.outro.durationSeconds = 6.6;
    });

    try {
      await expect(validatePublishedGeneration(episodeDir)).rejects.toThrow(/outro|timing/i);
    } finally {
      await rm(episodeDir, { recursive: true, force: true });
    }
  });

  it("accepts serialized outro timing at the 0.001-second epsilon boundary", async () => {
    const episodeDir = await createContainedEpisode();
    await writeFile(join(episodeDir, "final", "version-a.mp4"), "current-a", "utf8");
    await writeFile(join(episodeDir, "final", "version-b.mp4"), "current-b", "utf8");
    await writeGenerationMarker(episodeDir, "current-a", "current-b");
    await mutateGenerationMarker(episodeDir, (report) => {
      report.audioPolicy.outro.startSeconds = 4.751;
      report.audioPolicy.outro.durationSeconds = 7.001;
    });

    try {
      await expect(validatePublishedGeneration(episodeDir)).resolves.toMatchObject({
        generationId: "00000000-0000-4000-8000-000000000000"
      });
    } finally {
      await rm(episodeDir, { recursive: true, force: true });
    }
  });

  it("rejects input program timings that cannot share one serialized outro policy", async () => {
    const episodeDir = await createContainedEpisode();
    await writeFile(join(episodeDir, "final", "version-a.mp4"), "current-a", "utf8");
    await writeFile(join(episodeDir, "final", "version-b.mp4"), "current-b", "utf8");
    await writeGenerationMarker(episodeDir, "current-a", "current-b");
    await mutateGenerationMarker(episodeDir, (report) => {
      report.variants[1].inputDurationSeconds = 11.752;
    });

    try {
      await expect(validatePublishedGeneration(episodeDir)).rejects.toThrow(
        /audio|outro|timing|manifest/i
      );
    } finally {
      await rm(episodeDir, { recursive: true, force: true });
    }
  });

  it("exports the Task 10 QA validator for current generation and explicit paths", async () => {
    const episodeDir = await createContainedEpisode();
    const versionAPath = join(episodeDir, "final", "version-a.mp4");
    const versionBPath = join(episodeDir, "final", "version-b.mp4");
    const reportPath = join(episodeDir, "reports", "post-production.json");
    await writeFile(versionAPath, "current-a", "utf8");
    await writeFile(versionBPath, "current-b", "utf8");
    await writeGenerationMarker(episodeDir, "current-a", "current-b");
    const reportSha256 = sha256(await readFile(reportPath, "utf8"));

    try {
      await expect(validatePublishedGeneration(episodeDir)).resolves.toMatchObject({
        generationId: "00000000-0000-4000-8000-000000000000",
        reportSha256
      });
      await expect(
        validatePublishedGeneration({
          episodeDir,
          finalPaths: [versionAPath, versionBPath],
          reportPath
        })
      ).resolves.toMatchObject({
        finalPaths: [versionAPath, versionBPath]
      });
    } finally {
      await rm(episodeDir, { recursive: true, force: true });
    }
  });

  it("rejects a Tella export mutated after the generation was published", async () => {
    const episodeDir = await createContainedEpisode();
    await writeFile(join(episodeDir, "final", "version-a.mp4"), "current-a", "utf8");
    await writeFile(join(episodeDir, "final", "version-b.mp4"), "current-b", "utf8");
    await writeGenerationMarker(episodeDir, "current-a", "current-b");

    try {
      await expect(validatePublishedGeneration(episodeDir)).resolves.toMatchObject({
        variants: [
          expect.objectContaining({ inputSha256: sha256("export-a"), inputByteSize: 8 }),
          expect.objectContaining({ inputSha256: sha256("export-b"), inputByteSize: 8 })
        ]
      });
      await writeFile(join(episodeDir, "exports", "tella-a.mp4"), "mutated-export-a", "utf8");

      await expect(validatePublishedGeneration(episodeDir)).rejects.toThrow(/Tella|input|export/i);
    } finally {
      await rm(episodeDir, { recursive: true, force: true });
    }
  });

  it("rejects plan-owned program audio mutated after publication", async () => {
    const episodeDir = await createContainedEpisode();
    await writeFile(join(episodeDir, "final", "version-a.mp4"), "current-a", "utf8");
    await writeFile(join(episodeDir, "final", "version-b.mp4"), "current-b", "utf8");
    await writeGenerationMarker(episodeDir, "current-a", "current-b");
    const sourcePath = join(episodeDir, "source", "clip_translation.mp4");

    try {
      const validation = await validatePublishedGeneration(episodeDir);
      expect(validation.programAudio[0]).toMatchObject({
        clipId: "clip_translation",
        path: "source/clip_translation.mp4"
      });
      await writeFile(sourcePath, "mutated-program-audio", "utf8");

      await expect(validatePublishedGeneration(episodeDir)).rejects.toThrow(
        /prepared artifact|program audio|clip_translation/i
      );
    } finally {
      await rm(episodeDir, { recursive: true, force: true });
    }
  });

  it("rejects a published generation after its prepared inputs become stale", async () => {
    const episodeDir = await createContainedEpisode();
    await writeFile(join(episodeDir, "final", "version-a.mp4"), "current-a", "utf8");
    await writeFile(join(episodeDir, "final", "version-b.mp4"), "current-b", "utf8");
    await writeGenerationMarker(episodeDir, "current-a", "current-b");

    try {
      await expect(validatePublishedGeneration(episodeDir)).resolves.toBeDefined();
      const productionPath = join(episodeDir, "production.json");
      const production = JSON.parse(await readFile(productionPath, "utf8"));
      production.unrelatedPreparation = true;
      await writeFile(productionPath, JSON.stringify(production), "utf8");

      await expect(validatePublishedGeneration(episodeDir)).rejects.toThrow(/prepar|fingerprint/i);
    } finally {
      await rm(episodeDir, { recursive: true, force: true });
    }
  });

  it.each([
    {
      name: "new A with old B and old report",
      arrange: async (episodeDir: string) => {
        await writeFile(join(episodeDir, "final", "version-a.mp4"), "old-a", "utf8");
        await writeFile(join(episodeDir, "final", "version-b.mp4"), "old-b", "utf8");
        await writeGenerationMarker(episodeDir, "old-a", "old-b", "old-generation");
        await writeFile(join(episodeDir, "final", "version-a.mp4"), "new-a", "utf8");
      }
    },
    {
      name: "new A with old B and new report",
      arrange: async (episodeDir: string) => {
        await writeFile(join(episodeDir, "final", "version-a.mp4"), "new-a", "utf8");
        await writeFile(join(episodeDir, "final", "version-b.mp4"), "old-b", "utf8");
        await writeGenerationMarker(episodeDir, "new-a", "new-b", "new-generation");
      }
    },
    {
      name: "tampered canonical file",
      arrange: async (episodeDir: string) => {
        await writeFile(join(episodeDir, "final", "version-a.mp4"), "current-a", "utf8");
        await writeFile(join(episodeDir, "final", "version-b.mp4"), "current-b", "utf8");
        await writeGenerationMarker(episodeDir, "current-a", "current-b");
        await writeFile(join(episodeDir, "final", "version-b.mp4"), "tampered-b", "utf8");
      }
    },
    {
      name: "missing commit marker",
      arrange: async (episodeDir: string) => {
        await rm(join(episodeDir, "reports", "post-production.json"));
      }
    }
  ])("rejects $name", async ({ arrange }) => {
    const episodeDir = await createContainedEpisode();
    await arrange(episodeDir);
    try {
      await expect(validatePublishedGeneration(episodeDir)).rejects.toThrow(/generation|manifest/i);
    } finally {
      await rm(episodeDir, { recursive: true, force: true });
    }
  });

  it("rejects symlinked canonical generation files", async () => {
    const episodeDir = await createContainedEpisode();
    const outsideDir = await mkdtemp(join(tmpdir(), "gpt-live-generation-outside-"));
    const outsideFile = join(outsideDir, "outside.mp4");
    await writeFile(outsideFile, "outside", "utf8");
    await rm(join(episodeDir, "final", "version-a.mp4"));
    await symlink(outsideFile, join(episodeDir, "final", "version-a.mp4"));

    try {
      await expect(validatePublishedGeneration(episodeDir)).rejects.toThrow(/symlink/i);
    } finally {
      await rm(episodeDir, { recursive: true, force: true });
      await rm(outsideDir, { recursive: true, force: true });
    }
  });

  it("rejects incompatible A/B input timing before loudness measurement or rendering", async () => {
    const episodeDir = await createContainedEpisode();
    const measureIntervalLoudness = vi.fn(async () => -23);
    const runCommand = vi.fn(async () => ({ stdout: "", stderr: "" }));

    try {
      await expect(finishGptLiveProduction(finishOptions(episodeDir), {
        access: async () => undefined,
        readFileBytes: async (path) => readFile(path),
        inspectFinalMediaFile: async (_ffprobePath, path) =>
          validInspection(path.includes("tella-b") ? 11.752 : 11.75),
        measureIntervalLoudness,
        runCommand
      })).rejects.toThrow(/duration|outro|30fps frame/i);

      expect(measureIntervalLoudness).not.toHaveBeenCalled();
      expect(runCommand).not.toHaveBeenCalled();
    } finally {
      await rm(episodeDir, { recursive: true, force: true });
    }
  });

  it("rejects a stale prepared record before media inspection, loudness, or rendering", async () => {
    const episodeDir = await createContainedEpisode();
    const preparedPath = join(episodeDir, "reports", "prepared.json");
    const prepared = JSON.parse(await readFile(preparedPath, "utf8"));
    prepared.manifestFingerprint = "0".repeat(64);
    await writeFile(preparedPath, JSON.stringify(prepared), "utf8");
    const inspectFinalMediaFile = vi.fn(async () => validInspection(11.75));
    const measureIntervalLoudness = vi.fn(async () => -23);
    const runCommand = vi.fn(async () => ({ stdout: "", stderr: "" }));

    try {
      await expect(finishGptLiveProduction(finishOptions(episodeDir), {
        access: async () => undefined,
        inspectFinalMediaFile,
        measureIntervalLoudness,
        runCommand
      })).rejects.toThrow(/prepar|fingerprint/i);

      expect(inspectFinalMediaFile).not.toHaveBeenCalled();
      expect(measureIntervalLoudness).not.toHaveBeenCalled();
      expect(runCommand).not.toHaveBeenCalled();
    } finally {
      await rm(episodeDir, { recursive: true, force: true });
    }
  });

  it("rejects a same-duration Tella export substitution after sealing before FFmpeg", async () => {
    const episodeDir = await createContainedEpisode();
    await writeFile(join(episodeDir, "exports", "tella-a.mp4"), "changed!");
    const inspectFinalMediaFile = vi.fn(async () => validInspection(11.75));
    const measureIntervalLoudness = vi.fn(async () => -23);
    const runCommand = vi.fn(async () => {
      throw new Error("FFmpeg must not run for a substituted sealed export");
    });

    try {
      await expect(finishGptLiveProduction(finishOptions(episodeDir), {
        access: async () => undefined,
        inspectFinalMediaFile,
        measureIntervalLoudness,
        runCommand
      })).rejects.toThrow(/Tella export receipt.*version-a|receipt mismatch.*version-a/i);
      expect(inspectFinalMediaFile).not.toHaveBeenCalled();
      expect(measureIntervalLoudness).not.toHaveBeenCalled();
      expect(runCommand).not.toHaveBeenCalled();
    } finally {
      await rm(episodeDir, { recursive: true, force: true });
    }
  });

  it("rejects failed source fullscreen evidence before loudness or finishing FFmpeg", async () => {
    const episodeDir = await createContainedEpisode();
    const measureIntervalLoudness = vi.fn(async () => -23);
    const runCommand = vi.fn(async () => ({ stdout: "", stderr: "" }));
    const verifySourceFullscreen = vi.fn(async () => {
      throw new Error("Invalid source fullscreen evidence: SSIM below 0.90");
    });

    try {
      await expect(finishGptLiveProduction(finishOptions(episodeDir), {
        access: async () => undefined,
        inspectFinalMediaFile: async () => validInspection(11.75),
        measureIntervalLoudness,
        runCommand,
        verifySourceFullscreen
      } as any)).rejects.toThrow(/source fullscreen.*0\.90/i);
      expect(verifySourceFullscreen).toHaveBeenCalledOnce();
      expect(measureIntervalLoudness).not.toHaveBeenCalled();
      expect(runCommand).not.toHaveBeenCalled();
    } finally {
      await rm(episodeDir, { recursive: true, force: true });
    }
  });

  it.each([
    {
      name: "source clip",
      path: (episodeDir: string) => join(episodeDir, "source", "clip_translation.mp4")
    },
    {
      name: "ElevenLabs narration chunk",
      path: (episodeDir: string) => join(episodeDir, "voice", "narration_hook.mp3")
    },
    {
      name: "rendered narration plate",
      path: (episodeDir: string) =>
        join(episodeDir, "plates", "dynamic_editorial", "narration_hook.mp4")
    },
    {
      name: "captured evidence PNG",
      path: (episodeDir: string) => join(
        episodeDir,
        GPT_LIVE_CONTENT.evidence.find((item) => item.playbackDecision === "captured_source")!
          .assetPath
      )
    },
    {
      name: "AIMH logo",
      path: (episodeDir: string) => join(episodeDir, "assets", "logo.png")
    },
    {
      name: "outro audio",
      path: (episodeDir: string) => join(episodeDir, "assets", "outro.mp3")
    }
  ])("rejects a same-size mutated prepared $name before FFmpeg", async ({ path }) => {
    const episodeDir = await createContainedEpisode();
    const targetPath = path(episodeDir);
    const original = await readFile(targetPath);
    const replacement = Buffer.from(original);
    replacement[0] = replacement[0]! ^ 0xff;
    await writeFile(targetPath, replacement);
    const inspectFinalMediaFile = vi.fn(async () => validInspection(11.75));
    const measureIntervalLoudness = vi.fn(async () => -23);
    const runCommand = vi.fn(async () => {
      throw new Error("FFmpeg must not run for stale prepared media");
    });

    try {
      await expect(finishGptLiveProduction(finishOptions(episodeDir), {
        access: async () => undefined,
        inspectFinalMediaFile,
        measureIntervalLoudness,
        runCommand
      })).rejects.toThrow(/prepared artifact.*(mismatch|changed)|prepared.*fingerprint/i);

      expect(inspectFinalMediaFile).not.toHaveBeenCalled();
      expect(measureIntervalLoudness).not.toHaveBeenCalled();
      expect(runCommand).not.toHaveBeenCalled();
    } finally {
      await rm(episodeDir, { recursive: true, force: true });
    }
  });

  it.each([
    ["logo", "AIMH_LOGO_PATH"],
    ["outro", "AIMH_OUTRO_MUSIC_PATH"]
  ] as const)("rejects a substituted runtime %s path before FFmpeg", async (_name, envKey) => {
    const episodeDir = await createContainedEpisode();
    const replacementPath = join(episodeDir, "assets", `replacement-${envKey}.bin`);
    await writeFile(replacementPath, "replacement-asset", "utf8");
    const options = finishOptions(episodeDir);
    options.env[envKey] = replacementPath;
    const runCommand = vi.fn(async () => {
      throw new Error("FFmpeg must not run with substituted prepared assets");
    });

    try {
      await expect(finishGptLiveProduction(options, {
        access: async () => undefined,
        inspectFinalMediaFile: async () => validInspection(11.75),
        measureIntervalLoudness: async () => -23,
        runCommand
      })).rejects.toThrow(/prepared production|asset path|logo path|outro path/i);
      expect(runCommand).not.toHaveBeenCalled();
    } finally {
      await rm(episodeDir, { recursive: true, force: true });
    }
  });

  it("rejects a shifted Tella audit before media inspection, loudness, or rendering", async () => {
    const episodeDir = await createContainedEpisode();
    const statePath = join(episodeDir, "tella", "state.json");
    const state = JSON.parse(await readFile(statePath, "utf8"));
    state.timelineAudit.orderedClipIds.dynamic_editorial.reverse();
    await writeFile(statePath, JSON.stringify(state), "utf8");
    const inspectFinalMediaFile = vi.fn(async () => validInspection(11.75));
    const measureIntervalLoudness = vi.fn(async () => -23);
    const runCommand = vi.fn(async () => ({ stdout: "", stderr: "" }));

    try {
      await expect(finishGptLiveProduction(finishOptions(episodeDir), {
        access: async () => undefined,
        inspectFinalMediaFile,
        measureIntervalLoudness,
        runCommand
      })).rejects.toThrow(/timeline audit|clip order/i);

      expect(inspectFinalMediaFile).not.toHaveBeenCalled();
      expect(measureIntervalLoudness).not.toHaveBeenCalled();
      expect(runCommand).not.toHaveBeenCalled();
    } finally {
      await rm(episodeDir, { recursive: true, force: true });
    }
  });

  it("promotes A and B before hashing and atomically publishing the manifest last", async () => {
    const transactionId = "00000000-0000-4000-8000-000000000000";
    const episodeDir = await createContainedEpisode();
    const events: string[] = [];
    const finishArgs: string[][] = [];
    const measureIntervalLoudness = vi.fn(async (_ffmpeg: string, _file: string) => -23);
    const validateGeneration = vi.fn(async () => {
      events.push("validate");
      return {
        generationId: transactionId,
        preparationFingerprint: "c".repeat(64),
        reportSha256: "c".repeat(64),
        preparedArtifacts: [],
        variants: publishedVariants,
        programAudio: fakeProgramAudioBindings(),
        tellaExports: fakeTellaExports(),
        sourceFullscreen: fakeSourceFullscreen(),
        finalPaths: [
          join(episodeDir, "final", "version-a.mp4"),
          join(episodeDir, "final", "version-b.mp4")
        ] as const,
        reportPath: join(episodeDir, "reports", "post-production.json")
      };
    });

    try {
      await finishGptLiveProduction(finishOptions(episodeDir), {
        access: async () => undefined,
        randomUUID: () => transactionId,
        verifySourceFullscreen: passingSourceFullscreen,
        readFileBytes: async (path) => {
          if (path === "/assets/logo.png") return new Uint8Array([1, 2, 3]);
          if (path.endsWith("version-a.mp4")) events.push("hash-a");
          if (path.endsWith("version-b.mp4")) events.push("hash-b");
          return readFile(path);
        },
        inspectFinalMediaFile: async () => validInspection(11.75),
        measureIntervalLoudness,
        sampleLogoCornerFrameHash: async (_ffmpeg, path) =>
          path.includes("exports") ? "a".repeat(64) : "b".repeat(64),
        runCommand: async (_command, args) => {
          finishArgs.push([...args]);
          await writeFile(args.at(-1)!, "new-final", "utf8");
          return { stdout: "", stderr: "" };
        },
        writeJsonAtomic: async (path, value) => {
          events.push("report-write");
          await writeFile(path, `${JSON.stringify(value)}\n`, "utf8");
        },
        rename: async (from, to) => {
          if (String(from).includes("version-a.tmp-")) events.push("publish-a");
          if (String(from).includes("version-b.tmp-")) events.push("publish-b");
          if (String(from).includes("post-production.tmp-")) events.push("publish-report");
          await fsRename(from, to);
        },
        validatePublishedGeneration: validateGeneration
      });

      expect(events).toEqual([
        "publish-a",
        "publish-b",
        "hash-a",
        "hash-b",
        "report-write",
        "publish-report",
        "validate"
      ]);
      expect(finishArgs).toHaveLength(2);
      expect(measureIntervalLoudness.mock.calls.slice(0, 2).map((call) => call[1])).toEqual([
        join(episodeDir, "source", "clip_translation.mp4"),
        join(episodeDir, "source", "clip_interruption.mp4")
      ]);
      for (const args of finishArgs) {
        expect(args).not.toContain("-stream_loop");
        expect(args.flatMap((arg, index) => arg === "-i" ? [args[index + 1]!] : [])).toEqual([
          expect.stringMatching(/exports\/tella-[ab]\.mp4$/),
          join(episodeDir, "assets", "logo.png"),
          ...GPT_LIVE_CONTENT.timeline.map((clip) => join(
            episodeDir,
            clip.kind === "source_clip" ? "source" : "master",
            `${clip.id}.mp4`
          )),
          join(episodeDir, "assets", "outro.mp3")
        ]);
        const graph = args[args.indexOf("-filter_complex") + 1]!;
        expect(graph).not.toContain("[0:a]");
        expect(graph.match(/volume='/g)).toHaveLength(2);
        expect(graph).toContain("[11:a]aresample=48000");
        expect(graph).toContain("atrim=duration=7.000");
        expect(graph).toContain("adelay=4750:all=1");
      }
      expect(validateGeneration).toHaveBeenCalledWith(episodeDir);
    } finally {
      await rm(episodeDir, { recursive: true, force: true });
    }
  });

  it("invalidates prior QA evidence and human approval before committing a new generation", async () => {
    const transactionId = "11111111-1111-4111-8111-111111111111";
    const episodeDir = await createContainedEpisode();
    const stalePaths = [
      join(episodeDir, "reports", "qa.json"),
      join(episodeDir, "reports", "comparison.md"),
      join(episodeDir, "reports", "visual", "old-frame.png"),
      join(episodeDir, "reports", "human-playback.json")
    ];
    await mkdir(join(episodeDir, "reports", "visual"), { recursive: true });
    await Promise.all([
      writeFile(stalePaths[0]!, '{"readyForUpload":true,"ok":true}\n', "utf8"),
      writeFile(stalePaths[1]!, "old comparison", "utf8"),
      writeFile(stalePaths[2]!, "old visual", "utf8"),
      writeFile(stalePaths[3]!, '{"status":"passed"}\n', "utf8")
    ]);

    try {
      await finishGptLiveProduction(finishOptions(episodeDir), {
        access: async () => undefined,
        randomUUID: () => transactionId,
        verifySourceFullscreen: passingSourceFullscreen,
        readFileBytes: async (path) =>
          path === "/assets/logo.png" ? new Uint8Array([1, 2, 3]) : readFile(path),
        inspectFinalMediaFile: async () => validInspection(11.75),
        measureIntervalLoudness: async () => -23,
        sampleLogoCornerFrameHash: async (_ffmpeg, path) =>
          path.includes("exports") ? "a".repeat(64) : "b".repeat(64),
        runCommand: async (_command, args) => {
          await writeFile(args.at(-1)!, "new-final", "utf8");
          return { stdout: "", stderr: "" };
        },
        validatePublishedGeneration: async () => ({
          generationId: transactionId,
          preparationFingerprint: "c".repeat(64),
          reportSha256: "c".repeat(64),
          preparedArtifacts: [],
          variants: publishedVariants,
          programAudio: fakeProgramAudioBindings(),
          tellaExports: fakeTellaExports(),
          sourceFullscreen: fakeSourceFullscreen(),
          finalPaths: [
            join(episodeDir, "final", "version-a.mp4"),
            join(episodeDir, "final", "version-b.mp4")
          ] as const,
          reportPath: join(episodeDir, "reports", "post-production.json")
        })
      });

      for (const path of stalePaths) {
        await expect(readFile(path, "utf8")).rejects.toMatchObject({ code: "ENOENT" });
      }
      await expect(readFile(join(episodeDir, "reports", "qa.json"), "utf8"))
        .rejects.toMatchObject({ code: "ENOENT" });
    } finally {
      await rm(episodeDir, { recursive: true, force: true });
    }
  });

  it("does not restore stale upload approval when generation commit fails", async () => {
    const transactionId = "22222222-2222-4222-8222-222222222222";
    const episodeDir = await createContainedEpisode();
    const qaPath = join(episodeDir, "reports", "qa.json");
    const humanPlaybackPath = join(episodeDir, "reports", "human-playback.json");
    await Promise.all([
      writeFile(qaPath, '{"readyForUpload":true,"ok":true}\n', "utf8"),
      writeFile(humanPlaybackPath, '{"status":"passed"}\n', "utf8")
    ]);

    try {
      await expect(
        finishGptLiveProduction(finishOptions(episodeDir), {
          access: async () => undefined,
          randomUUID: () => transactionId,
          verifySourceFullscreen: passingSourceFullscreen,
          readFileBytes: async (path) =>
            path === "/assets/logo.png" ? new Uint8Array([1, 2, 3]) : readFile(path),
          inspectFinalMediaFile: async () => validInspection(11.75),
          measureIntervalLoudness: async () => -23,
          sampleLogoCornerFrameHash: async (_ffmpeg, path) =>
            path.includes("exports") ? "a".repeat(64) : "b".repeat(64),
          runCommand: async (_command, args) => {
            await writeFile(args.at(-1)!, "new-final", "utf8");
            return { stdout: "", stderr: "" };
          },
          rename: async (from, to) => {
            if (String(from).includes("post-production.tmp-")) {
              throw new Error("injected marker promotion failure");
            }
            await fsRename(from, to);
          }
        })
      ).rejects.toThrow("injected marker promotion failure");

      await expect(readFile(qaPath, "utf8")).rejects.toMatchObject({ code: "ENOENT" });
      await expect(readFile(humanPlaybackPath, "utf8")).rejects.toMatchObject({ code: "ENOENT" });
      expect(await readFile(join(episodeDir, "reports", "post-production.json"), "utf8"))
        .toBe("{}\n");
    } finally {
      await rm(episodeDir, { recursive: true, force: true });
    }
  });

  it("reports cleanup debt after a committed generation without failing success", async () => {
    const transactionId = "00000000-0000-4000-8000-000000000000";
    const episodeDir = await createContainedEpisode();
    let markerPublished = false;
    let cleanupFailed = false;

    try {
      const result = await finishGptLiveProduction(finishOptions(episodeDir), {
        access: async () => undefined,
        randomUUID: () => transactionId,
        verifySourceFullscreen: passingSourceFullscreen,
        readFileBytes: async (path) =>
          path === "/assets/logo.png" ? new Uint8Array([1, 2, 3]) : readFile(path),
        inspectFinalMediaFile: async () => validInspection(11.75),
        measureIntervalLoudness: async () => -23,
        sampleLogoCornerFrameHash: async (_ffmpeg, path) =>
          path.includes("exports") ? "a".repeat(64) : "b".repeat(64),
        runCommand: async (_command, args) => {
          await writeFile(args.at(-1)!, "new-final", "utf8");
          return { stdout: "", stderr: "" };
        },
        rename: async (from, to) => {
          await fsRename(from, to);
          if (String(from).includes("post-production.tmp-")) markerPublished = true;
        },
        rm: async (path, options) => {
          if (
            markerPublished &&
            !cleanupFailed &&
            String(path).includes("version-a.mp4.rollback-")
          ) {
            cleanupFailed = true;
            throw new Error("injected committed cleanup failure");
          }
          await rm(path, options);
        },
        validatePublishedGeneration: async () => ({
          generationId: transactionId,
          preparationFingerprint: "c".repeat(64),
          reportSha256: "c".repeat(64),
          preparedArtifacts: [],
          variants: publishedVariants,
          programAudio: fakeProgramAudioBindings(),
          tellaExports: fakeTellaExports(),
          sourceFullscreen: fakeSourceFullscreen(),
          finalPaths: [
            join(episodeDir, "final", "version-a.mp4"),
            join(episodeDir, "final", "version-b.mp4")
          ] as const,
          reportPath: join(episodeDir, "reports", "post-production.json")
        })
      });

      expect(result.cleanupWarnings).toHaveLength(1);
      expect(result.cleanupWarnings[0]).toContain("final/version-a.mp4.rollback-");
      expect(result.cleanupWarnings[0]).not.toContain(episodeDir);
      expect(await readFile(join(episodeDir, "reports", "post-production.json"), "utf8"))
        .toContain(transactionId);
    } finally {
      await rm(episodeDir, { recursive: true, force: true });
    }
  });

  it("does not replace an existing final when rendering fails", async () => {
    const episodeDir = await createContainedEpisode();
    const finalPath = join(episodeDir, "final", "version-a.mp4");
    await writeFile(finalPath, "approved-final", "utf8");
    const rename = vi.fn(async () => undefined);

    try {
      await expect(
        finishGptLiveProduction(
          finishOptions(episodeDir),
          {
            access: async () => undefined,
            verifySourceFullscreen: passingSourceFullscreen,
            readFileBytes: async (path) =>
              path === "/assets/logo.png" ? new Uint8Array([1, 2, 3]) : readFile(path),
            inspectFinalMediaFile: async () => validInspection(11.75),
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
            verifySourceFullscreen: passingSourceFullscreen,
            readFileBytes: async (path) => readFile(path),
            inspectFinalMediaFile: async () => validInspection(11.75),
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
          verifySourceFullscreen: passingSourceFullscreen,
          readFileBytes: async (path) => readFile(path),
          inspectFinalMediaFile: async () => validInspection(11.75),
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
