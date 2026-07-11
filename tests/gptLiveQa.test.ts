import { createHash } from "node:crypto";
import {
  mkdir,
  mkdtemp,
  readFile,
  rename as fsRename,
  rm,
  writeFile
} from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it, vi } from "vitest";
import { GPT_LIVE_CONTENT } from "../src/production/gptLive/content";
import {
  buildPostProductionManifest,
  deriveSharedSourceGains,
  deriveSourceDuckIntervals,
  type FinalMediaInspection
} from "../src/production/gptLive/finish";
import type { MediaInspection } from "../src/production/gptLive/mediaInspection";
import { GPT_LIVE_SCENES, sceneStyle } from "../src/production/gptLive/motion/sceneStyle";
import {
  clearStaleQaOutputs,
  deriveQaStatus,
  parseHumanPlaybackReview,
  qaReportPaths,
  runGptLiveQa,
  validateGptLiveQaSnapshot,
  type GptLiveQaSnapshot
} from "../src/production/gptLive/qa";
import type { QaProduction } from "../src/production/gptLive/qa";
import { publishQaReportSet } from "../src/production/gptLive/qa/publication";
import { withValidatedQaArtifactPaths } from "../src/production/gptLive/qa/paths";
import {
  assertMeaningfulFrameContent,
  renderComparisonMarkdown
} from "../src/production/gptLive/qa/visual";
import { buildTellaPlan } from "../src/production/gptLive/tellaPlan";
import { buildVoiceCacheKey } from "../src/voice/elevenLabsAdapter";

const EPISODE_DIR = "/episode";
const sha = (character: string): string => character.repeat(64);

interface PreparedMediaInspection extends MediaInspection {
  video: MediaInspection["video"] & { pixelFormat: string };
  audio?: { codecName: string; sampleRate: number; channels: number };
}

interface MutableFinalInspection {
  durationSeconds: number;
  video: {
    codecName: string;
    width: number;
    framesPerSecond: number;
  };
  audio: {
    codecName: string;
    sampleRate: number;
  };
}

const genericInspection = (
  durationSeconds: number,
  audio = true
): PreparedMediaInspection => ({
  durationSeconds,
  video: {
    codecName: "h264",
    width: 1920,
    height: 1080,
    framesPerSecond: 30,
    pixelFormat: "yuv420p"
  },
  ...(audio ? { audio: { codecName: "aac", sampleRate: 48_000, channels: 2 } } : {})
});

const finalInspection = (durationSeconds: number): FinalMediaInspection => ({
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
    durationSeconds,
    bitRate: 192_000
  }
});

const validSnapshot = (): GptLiveQaSnapshot => {
  const production = ({
    schemaVersion: "0.1.0" as const,
    ...structuredClone(GPT_LIVE_CONTENT),
    branding: structuredClone(GPT_LIVE_CONTENT.branding),
    musicPath: GPT_LIVE_CONTENT.musicPath
  }) as unknown as QaProduction;
  const env = {
    YOUTUBE_UPLOAD_ENABLED: "false",
    ELEVENLABS_VOICE_ID: "qa-test-voice",
    ELEVENLABS_MODEL_ID: "eleven_multilingual_v2"
  };
  const voice = {
    provider: "elevenlabs" as const,
    chunks: GPT_LIVE_CONTENT.narration.map((narration) => ({
      id: narration.id,
      text: narration.text,
      file: join(EPISODE_DIR, "voice", `${narration.id}.mp3`),
      durationSeconds: 15,
      provider: "elevenlabs" as const,
      cached: true
    })),
    warnings: []
  };
  const plan = buildTellaPlan({
    episodeDir: EPISODE_DIR,
    narrationAssets: voice.chunks.map((chunk) => ({
      id: chunk.id,
      audioPath: chunk.file,
      durationSeconds: chunk.durationSeconds
    }))
  });
  const durationSeconds = plan.clips.reduce((total, clip) => total + clip.durationSeconds, 0);
  const duckIntervals = deriveSourceDuckIntervals(plan);
  const sourceGains = deriveSharedSourceGains(duckIntervals, [-20, -20], [-20, -20]).map(
    (gain) => ({ ...gain, outputLufsA: -23, outputLufsB: -23 })
  );
  const postProduction = buildPostProductionManifest({
    productionId: GPT_LIVE_CONTENT.id,
    generationId: "00000000-0000-4000-8000-000000000000",
    logoPath: GPT_LIVE_CONTENT.branding.logoPath,
    musicPath: GPT_LIVE_CONTENT.musicPath,
    logoSha256: sha("a"),
    duckIntervals,
    sourceGains,
    logoEvidence: (["version-a", "version-b"] as const).map((name) => ({
      name,
      samples: [0.5, durationSeconds / 2, durationSeconds - 0.5].map((timeSeconds) => ({
        timeSeconds,
        inputSha256: sha("b"),
        outputSha256: sha("c")
      }))
    })),
    variants: [
      {
        name: "version-a",
        inputPath: join(EPISODE_DIR, "exports", "tella-a.mp4"),
        outputPath: join(EPISODE_DIR, "final", "version-a.mp4"),
        inputDurationSeconds: durationSeconds,
        outputDurationSeconds: durationSeconds,
        sha256: sha("d"),
        byteSize: 1_000
      },
      {
        name: "version-b",
        inputPath: join(EPISODE_DIR, "exports", "tella-b.mp4"),
        outputPath: join(EPISODE_DIR, "final", "version-b.mp4"),
        inputDurationSeconds: durationSeconds,
        outputDurationSeconds: durationSeconds,
        sha256: sha("e"),
        byteSize: 1_001
      }
    ]
  });
  const sourceIds = Object.fromEntries([
    ...plan.clips.map((clip) => [clip.id, `source-${clip.id}`]),
    ...GPT_LIVE_CONTENT.narration.flatMap((narration) =>
      GPT_LIVE_CONTENT.variants.map((variant) => [
        `plate:${variant}:${narration.id}`,
        `plate-${variant}-${narration.id}`
      ])
    )
  ]);
  const state = {
    sourceIds,
    clipIds: Object.fromEntries(plan.clips.map((clip) => [clip.id, `clip-${clip.id}`])),
    variantVideoIds: {
      dynamic_editorial: "video-a",
      aimh_visual_host: "video-b"
    },
    exportPaths: {
      dynamic_editorial: join(EPISODE_DIR, "exports", "tella-a.mp4"),
      aimh_visual_host: join(EPISODE_DIR, "exports", "tella-b.mp4")
    },
    masterVideoId: "video-master",
    variantClipIds: Object.fromEntries(
      GPT_LIVE_CONTENT.variants.map((variant) => [
        variant,
        Object.fromEntries(plan.clips.map((clip) => [clip.id, `${variant}-${clip.id}`]))
      ])
    ),
    layoutIds: Object.fromEntries(
      GPT_LIVE_CONTENT.narration.flatMap((narration) =>
        GPT_LIVE_CONTENT.variants.map((variant) => [
          `${variant}:${narration.id}`,
          `layout-${variant}-${narration.id}`
        ])
      )
    )
  };
  const sourceMatrix = "canonical source matrix";
  const manifestFingerprint = createHash("sha256")
    .update(JSON.stringify({ production, voice, plan, sourceMatrix }))
    .digest("hex");
  const masters = Object.fromEntries(
    voice.chunks.map((chunk) => [chunk.id, genericInspection(chunk.durationSeconds)])
  );
  const plates = Object.fromEntries(
    voice.chunks.flatMap((chunk) =>
      GPT_LIVE_CONTENT.variants.map((variant) => [
        `${variant}:${chunk.id}`,
        genericInspection(chunk.durationSeconds, false)
      ])
    )
  );

  return {
    episodeDir: EPISODE_DIR,
    env,
    generation: {
      generationId: postProduction.generationId,
      finalPaths: [
        join(EPISODE_DIR, "final", "version-a.mp4"),
        join(EPISODE_DIR, "final", "version-b.mp4")
      ],
      reportPath: join(EPISODE_DIR, "reports", "post-production.json")
    },
    production,
    sourceMatrix,
    prepared: {
      schemaVersion: "0.1.0",
      status: "prepared",
      productionId: GPT_LIVE_CONTENT.id,
      manifestFingerprint
    },
    voice,
    voiceCacheMetadata: Object.fromEntries(
      voice.chunks.map((chunk) => [
        chunk.id,
        {
          schemaVersion: "0.1.0",
          cacheKey: buildVoiceCacheKey({ text: chunk.text, env }),
          modelId: "eleven_multilingual_v2"
        }
      ])
    ),
    plan,
    tellaState: state,
    postProduction,
    logo: { path: GPT_LIVE_CONTENT.branding.logoPath, sha256: sha("a") },
    filePresence: Object.fromEntries([
      ...plan.clips.flatMap((clip) =>
        clip.kind === "source_clip"
          ? [[clip.mediaPath, true] as const]
          : [
              [clip.masterPath, true] as const,
              ...Object.values(clip.variants).flatMap((variant) => [
                [variant.platePath, true] as const,
                [variant.narrationAudioPath, true] as const
              ])
            ]
      ),
      ...voice.chunks.map((chunk) => [`${chunk.file}.json`, true] as const)
    ]),
    media: {
      sources: {
        clip_translation: genericInspection(12.35),
        clip_interruption: genericInspection(11.96)
      },
      masters,
      plates,
      finals: {
        "version-a": finalInspection(durationSeconds),
        "version-b": finalInspection(durationSeconds)
      }
    },
    safeAreas: GPT_LIVE_CONTENT.variants.flatMap((variant) =>
      GPT_LIVE_SCENES.map((scene) => ({ variant, scene, ...sceneStyle(variant, scene).reservedTopRight }))
    ),
    tailAudio: {
      "version-a": { tailPeakDb: -2, endPeakDb: -8, tailSignalPresent: true },
      "version-b": { tailPeakDb: -2, endPeakDb: -8, tailSignalPresent: true }
    },
    observedIntegrityHashes: {
      sources: Object.fromEntries(
        GPT_LIVE_CONTENT.timeline
          .filter((item) => item.kind === "source_clip")
          .map((item) => [item.id, sha("1")])
      ),
      voice: Object.fromEntries(voice.chunks.map((chunk) => [chunk.id, sha("2")]))
    }
  } as unknown as GptLiveQaSnapshot;
};

describe("GPT-Live full production QA", () => {
  it("keeps machine success separate from pending human playback", () => {
    const humanPlayback = parseHumanPlaybackReview(undefined);
    expect(humanPlayback).toEqual({
      status: "pending",
      note: "Full real-time listening and viewing is required before upload."
    });
    expect(deriveQaStatus(humanPlayback)).toEqual({
      machineOk: true,
      humanPlayback,
      readyForUpload: false,
      ok: false
    });
  });

  it("accepts an explicit safe human playback status file", () => {
    const humanPlayback = parseHumanPlaybackReview(JSON.stringify({
      schemaVersion: "0.1.0",
      status: "passed",
      note: "Full A/B playback reviewed."
    }));
    expect(deriveQaStatus(humanPlayback)).toMatchObject({
      machineOk: true,
      humanPlayback: { status: "passed" },
      readyForUpload: true,
      ok: true
    });
  });

  it.each([
    {
      name: "all black plus one white pixel",
      metrics: { changedPixelProportion: 0.000001, lumaVariance: 0.05, normalizedEntropy: 0.0001 }
    },
    {
      name: "black content with only an excluded logo",
      metrics: { changedPixelProportion: 0, lumaVariance: 0, normalizedEntropy: 0 }
    }
  ])("rejects $name as a blank sampled frame", ({ metrics }) => {
    expect(() => assertMeaningfulFrameContent(metrics, "sample.png")).toThrow(/blank|content/i);
  });

  it("accepts representative real-frame content metrics", () => {
    expect(() => assertMeaningfulFrameContent({
      changedPixelProportion: 0.07,
      lumaVariance: 1156,
      normalizedEntropy: 0.14
    }, "sample.png")).not.toThrow();
  });

  it("writes comparison.md at the reports root and identifies the stale visual path", () => {
    expect(qaReportPaths(EPISODE_DIR)).toEqual({
      reportPath: join(EPISODE_DIR, "reports", "qa.json"),
      comparisonPath: join(EPISODE_DIR, "reports", "comparison.md"),
      staleComparisonPath: join(EPISODE_DIR, "reports", "visual", "comparison.md"),
      visualDirectory: join(EPISODE_DIR, "reports", "visual")
    });
  });

  it("removes stale QA and comparison reports without removing visual assets", async () => {
    const remove = vi.fn(async (_path: string, _options: { force: true }) => undefined);
    await clearStaleQaOutputs(EPISODE_DIR, remove);

    expect(remove.mock.calls.map(([path]) => path)).toEqual([
      join(EPISODE_DIR, "reports", "qa.json"),
      join(EPISODE_DIR, "reports", "comparison.md"),
      join(EPISODE_DIR, "reports", "visual", "comparison.md")
    ]);
    expect(remove).toHaveBeenCalledWith(expect.any(String), { force: true });
  });

  it("accepts a complete editorial, media, Tella, and A/B snapshot", () => {
    expect(() => validateGptLiveQaSnapshot(validSnapshot())).not.toThrow();
  });

  it.each([
    {
      name: "master and A video IDs",
      mutate: (state: Record<string, any>) => {
        state.variantVideoIds.dynamic_editorial = state.masterVideoId;
      }
    },
    {
      name: "base source IDs",
      mutate: (state: Record<string, any>) => {
        state.sourceIds.narration_hook = state.sourceIds.clip_translation;
      }
    },
    {
      name: "plate source IDs",
      mutate: (state: Record<string, any>) => {
        state.sourceIds["plate:dynamic_editorial:narration_full_duplex"] =
          state.sourceIds["plate:dynamic_editorial:narration_hook"];
      }
    },
    {
      name: "variant clip IDs",
      mutate: (state: Record<string, any>) => {
        state.variantClipIds.dynamic_editorial.narration_hook =
          state.variantClipIds.dynamic_editorial.clip_translation;
      }
    },
    {
      name: "layout IDs",
      mutate: (state: Record<string, any>) => {
        state.layoutIds["dynamic_editorial:narration_full_duplex"] =
          state.layoutIds["dynamic_editorial:narration_hook"];
      }
    }
  ])("rejects duplicate Tella $name", ({ mutate }) => {
    const snapshot = validSnapshot();
    mutate(snapshot.tellaState as Record<string, any>);
    expect(() => validateGptLiveQaSnapshot(snapshot)).toThrow(/unique|distinct|duplicate/i);
  });

  it("rejects an outside serialized path before any inspector is called", async () => {
    const snapshot = validSnapshot();
    const plan = structuredClone(snapshot.plan);
    const narration = plan.clips.find((clip) => clip.kind === "narration")!;
    if (narration.kind === "narration") {
      (narration as unknown as { masterPath: string }).masterPath = "/outside/master.mp4";
    }
    const inspector = vi.fn(async () => undefined);

    await expect(withValidatedQaArtifactPaths({
      episodeDir: EPISODE_DIR,
      production: snapshot.production,
      voice: snapshot.voice,
      plan,
      generation: snapshot.generation
    }, {}, inspector)).rejects.toThrow(/outside|escape|path/i);
    expect(inspector).not.toHaveBeenCalled();
  });

  it("restores prior complete QA evidence when report-marker promotion fails", async () => {
    const episodeDir = await mkdtemp(join(tmpdir(), "gpt-live-qa-publish-"));
    const paths = qaReportPaths(episodeDir);
    const stagingDirectory = join(episodeDir, "reports", ".qa-staging-test");
    await Promise.all([
      mkdir(paths.visualDirectory, { recursive: true }),
      mkdir(join(stagingDirectory, "visual"), { recursive: true })
    ]);
    await Promise.all([
      writeFile(paths.reportPath, "old-marker", "utf8"),
      writeFile(paths.comparisonPath, "old-comparison", "utf8"),
      writeFile(join(paths.visualDirectory, "old.png"), "old-visual", "utf8"),
      writeFile(join(stagingDirectory, "qa.json"), "new-marker", "utf8"),
      writeFile(join(stagingDirectory, "comparison.md"), "new-comparison", "utf8"),
      writeFile(join(stagingDirectory, "visual", "new.png"), "new-visual", "utf8")
    ]);

    try {
      await expect(publishQaReportSet({ stagingDirectory, paths }, {
        rename: async (from, to) => {
          if (from === join(stagingDirectory, "qa.json")) throw new Error("late marker failure");
          await fsRename(from, to);
        }
      })).rejects.toThrow("late marker failure");
      await expect(readFile(paths.reportPath, "utf8")).resolves.toBe("old-marker");
      await expect(readFile(paths.comparisonPath, "utf8")).resolves.toBe("old-comparison");
      await expect(readFile(join(paths.visualDirectory, "old.png"), "utf8"))
        .resolves.toBe("old-visual");
    } finally {
      await rm(episodeDir, { recursive: true, force: true });
    }
  });

  it("rejects a mismatched canonical ElevenLabs cache key", () => {
    const snapshot = validSnapshot();
    snapshot.voiceCacheMetadata.narration_hook!.cacheKey = sha("f");
    expect(() => validateGptLiveQaSnapshot(snapshot)).toThrow(/cache provenance|cache key/i);
  });

  it("requires observed source and voice integrity hashes", () => {
    const snapshot = validSnapshot();
    (snapshot as any).observedIntegrityHashes.sources.clip_translation = "invalid";
    expect(() => validateGptLiveQaSnapshot(snapshot)).toThrow(/observed integrity hash/i);
  });

  it("states machine review and the remaining human audio limitation", () => {
    const comparison = renderComparisonMarkdown({
      artifacts: {
        contactSheets: { "version-a": "a.png", "version-b": "b.png" },
        transitionFrames: { "version-a": ["a/1.png"], "version-b": ["b/1.png"] },
        tailAudio: { "version-a": "a.wav", "version-b": "b.wav" },
        contactSampleTimesSeconds: { "version-a": [], "version-b": [] },
        checkedFrameCount: 58,
        contentMetrics: {
          minimumChangedPixelProportion: 0.07,
          minimumLumaVariance: 100,
          minimumNormalizedEntropy: 0.1
        }
      },
      durations: { "version-a": 150, "version-b": 150 },
      durationDeltaSeconds: 0,
      sourceIntervals: [],
      sourceOutputLufs: []
    });
    expect(comparison).toContain("Machine review complete");
    expect(comparison).toContain("cannot prove CTA narration");
    expect(comparison).toContain("Full real-time listening");
  });

  it("rejects a source claim without a source", () => {
    const snapshot = validSnapshot();
    snapshot.production.claims[0]!.sourceIds = [];
    expect(() => validateGptLiveQaSnapshot(snapshot)).toThrow("must reference at least one source");
  });

  it("rejects non-ElevenLabs voice output", () => {
    const snapshot = validSnapshot();
    snapshot.voice.provider = "silent_placeholder";
    expect(() => validateGptLiveQaSnapshot(snapshot)).toThrow(/ElevenLabs/i);
  });

  it("rejects a source clip without source audio", () => {
    const snapshot = validSnapshot();
    snapshot.media.sources.clip_translation = genericInspection(12.35, false);
    expect(() => validateGptLiveQaSnapshot(snapshot)).toThrow(/source audio/i);
  });

  it("rejects a prepared source with the wrong audio rate", () => {
    const snapshot = validSnapshot();
    (snapshot.media.sources.clip_translation as PreparedMediaInspection).audio!.sampleRate = 44_100;
    expect(() => validateGptLiveQaSnapshot(snapshot)).toThrow(/48kHz/i);
  });

  it("rejects a prepared plate with the wrong pixel format", () => {
    const snapshot = validSnapshot();
    (snapshot.media.plates["dynamic_editorial:narration_hook"] as PreparedMediaInspection)
      .video.pixelFormat = "yuv444p";
    expect(() => validateGptLiveQaSnapshot(snapshot)).toThrow(/yuv420p/i);
  });

  it("rejects an A/B duration delta above half a second", () => {
    const snapshot = validSnapshot();
    (snapshot.media.finals["version-b"] as unknown as MutableFinalInspection).durationSeconds += 0.501;
    expect(() => validateGptLiveQaSnapshot(snapshot)).toThrow("A/B duration delta");
  });

  it.each([
    ["dimensions", (final: MutableFinalInspection) => { final.video.width = 1280; }, "1920x1080"],
    ["video codec", (final: MutableFinalInspection) => { final.video.codecName = "hevc"; }, "H.264"],
    ["audio codec", (final: MutableFinalInspection) => { final.audio.codecName = "mp3"; }, "AAC"],
    ["frame rate", (final: MutableFinalInspection) => { final.video.framesPerSecond = 29.97; }, "30fps"],
    ["audio rate", (final: MutableFinalInspection) => { final.audio.sampleRate = 44_100; }, "48kHz"]
  ])("rejects wrong final %s", (_name, mutate, error) => {
    const snapshot = validSnapshot();
    mutate(snapshot.media.finals["version-a"] as unknown as MutableFinalInspection);
    expect(() => validateGptLiveQaSnapshot(snapshot)).toThrow(error);
  });

  it("rejects a rendered scene safe area below 198 pixels", () => {
    const snapshot = validSnapshot();
    snapshot.safeAreas[0]!.width = 197;
    expect(() => validateGptLiveQaSnapshot(snapshot)).toThrow(/safe area/i);
  });

  it.each([
    ["missing final", new Error("Published generation file is missing: version-a")],
    ["tampered final", new Error("Published generation mismatch for version-a")],
    ["generation hash mismatch", new Error("expected hash does not match")]
  ])("calls published generation validation first and rejects a %s", async (_name, failure) => {
    const readFile = vi.fn(async () => "{}");
    await expect(
      runGptLiveQa(
        { episodeDir: EPISODE_DIR, env: {}, ffmpegPath: "ffmpeg", ffprobePath: "ffprobe" },
        {
          validatePublishedGeneration: vi.fn(async () => { throw failure; }),
          readFile
        }
      )
    ).rejects.toThrow(failure.message);
    expect(readFile).not.toHaveBeenCalled();
  });

  it("rejects QA when YouTube upload is enabled", () => {
    const snapshot = validSnapshot();
    snapshot.env.YOUTUBE_UPLOAD_ENABLED = "true";
    expect(() => validateGptLiveQaSnapshot(snapshot)).toThrow(/YouTube upload must be disabled/i);
  });

  it.each(["uploadUrl", "signedUrl"])('rejects Tella state containing a %s field', (field) => {
    const snapshot = validSnapshot();
    (snapshot.tellaState as Record<string, unknown>)[field] = "https://signed.example/video?token=secret";
    expect(() => validateGptLiveQaSnapshot(snapshot)).toThrow(/unsafe URL field/i);
  });

  it("rejects a final without tail signal", () => {
    const snapshot = validSnapshot();
    snapshot.tailAudio["version-a"].endPeakDb = Number.NEGATIVE_INFINITY;
    snapshot.tailAudio["version-a"].tailSignalPresent = false;
    expect(() => validateGptLiveQaSnapshot(snapshot)).toThrow(/tail signal/i);
  });
});
