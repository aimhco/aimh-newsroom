import { createHash } from "node:crypto";
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
  runGptLiveQa,
  validateGptLiveQaSnapshot,
  type GptLiveQaSnapshot
} from "../src/production/gptLive/qa";
import type { QaProduction } from "../src/production/gptLive/qa";
import { buildTellaPlan } from "../src/production/gptLive/tellaPlan";

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
    env: { YOUTUBE_UPLOAD_ENABLED: "false" },
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
        { schemaVersion: "0.1.0", cacheKey: sha("f"), modelId: "eleven_multilingual_v2" }
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
      "version-a": { tailPeakDb: -2, endPeakDb: -8 },
      "version-b": { tailPeakDb: -2, endPeakDb: -8 }
    }
  };
};

describe("GPT-Live full production QA", () => {
  it("accepts a complete editorial, media, Tella, and A/B snapshot", () => {
    expect(() => validateGptLiveQaSnapshot(validSnapshot())).not.toThrow();
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

  it("rejects a truncated or silent final audio tail", () => {
    const snapshot = validSnapshot();
    snapshot.tailAudio["version-a"].endPeakDb = Number.NEGATIVE_INFINITY;
    expect(() => validateGptLiveQaSnapshot(snapshot)).toThrow(/truncated|silent/i);
  });
});
