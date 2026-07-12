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
  buildHumanPlaybackReviewTemplate,
  deriveQaStatus,
  parseHumanPlaybackReview,
  qaReportPaths,
  runGptLiveQa,
  validateGptLiveQaSnapshot,
  type GptLiveQaSnapshot,
  type RunGptLiveQaDependencies
} from "../src/production/gptLive/qa";
import type { QaProduction } from "../src/production/gptLive/qa";
import {
  publishQaReportSet,
  withQaStagingDirectory
} from "../src/production/gptLive/qa/publication";
import {
  validateSerializedQaPaths,
  withValidatedQaArtifactPaths
} from "../src/production/gptLive/qa/paths";
import {
  assertMeaningfulFrameContent,
  renderComparisonMarkdown
} from "../src/production/gptLive/qa/visual";
import { assertSafeSourceManifestUrl } from "../src/production/gptLive/qa/validation";
import { buildTellaPlan } from "../src/production/gptLive/tellaPlan";
import { buildVoiceCacheKey } from "../src/voice/elevenLabsAdapter";

const EPISODE_DIR = "/episode";
const sha = (character: string): string => character.repeat(64);

const canonicalSourceManifest = () => ({
  schemaVersion: "0.1.0" as const,
  productionId: GPT_LIVE_CONTENT.id,
  sources: GPT_LIVE_CONTENT.sources.map((source) => {
    const evidence = GPT_LIVE_CONTENT.evidence.filter((item) => item.sourceId === source.id);
    const mediaUrls = [
      ...new Set(evidence.flatMap((item) => "mediaUrl" in item ? [item.mediaUrl] : []))
    ];
    return {
      sourceId: source.id,
      publisher: source.publisher,
      title: source.title,
      canonicalUrl: source.url,
      mediaUrls,
      scenes: [...new Set(evidence.map((item) => item.scene))],
      claims: GPT_LIVE_CONTENT.claims.filter((claim) =>
        claim.sourceIds.some((sourceId) => sourceId === source.id)
      ).map(
        (claim) => claim.id
      ),
      onScreenAttribution: [...new Set(evidence.map((item) => item.displayUrl))],
      playbackDecisions: [...new Set(evidence.map((item) => item.playbackDecision))],
      youtubeDescription: evidence.length > 0
    };
  })
});

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

const validSnapshot = (outputDurationDeltaSeconds = 0): GptLiveQaSnapshot => {
  const production = ({
    schemaVersion: "0.1.0" as const,
    ...structuredClone(GPT_LIVE_CONTENT),
    branding: structuredClone(GPT_LIVE_CONTENT.branding)
  }) as unknown as QaProduction;
  const env = {
    YOUTUBE_UPLOAD_ENABLED: "false",
    ELEVENLABS_VOICE_ID: "qa-test-voice",
    ELEVENLABS_MODEL_ID: "eleven_multilingual_v2",
    AIMH_OUTRO_MUSIC_PATH: GPT_LIVE_CONTENT.audio.outroMusicPath
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
  const outputDurationSeconds = durationSeconds + outputDurationDeltaSeconds;
  const duckIntervals = deriveSourceDuckIntervals(plan);
  const sourceGains = deriveSharedSourceGains(duckIntervals, [-20, -20], [-20, -20]).map(
    (gain) => ({ ...gain, outputLufsA: -23, outputLufsB: -23 })
  );
  const postProduction = buildPostProductionManifest({
    productionId: GPT_LIVE_CONTENT.id,
    generationId: "00000000-0000-4000-8000-000000000000",
    logoPath: GPT_LIVE_CONTENT.branding.logoPath,
    outroMusicPath: GPT_LIVE_CONTENT.audio.outroMusicPath,
    outroDurationSeconds: GPT_LIVE_CONTENT.audio.outroDurationSeconds,
    logoSha256: sha("a"),
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
        outputDurationSeconds,
        sha256: sha("d"),
        byteSize: 1_000
      },
      {
        name: "version-b",
        inputPath: join(EPISODE_DIR, "exports", "tella-b.mp4"),
        outputPath: join(EPISODE_DIR, "final", "version-b.mp4"),
        inputDurationSeconds: durationSeconds,
        outputDurationSeconds,
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
  const sourceManifest = canonicalSourceManifest();
  const manifestFingerprint = createHash("sha256")
    .update(JSON.stringify({ production, voice, plan, sourceMatrix, sourceManifest }))
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
      reportSha256: sha("f"),
      finalPaths: [
        join(EPISODE_DIR, "final", "version-a.mp4"),
        join(EPISODE_DIR, "final", "version-b.mp4")
      ],
      reportPath: join(EPISODE_DIR, "reports", "post-production.json")
    },
    production,
    sourceMatrix,
    sourceManifest,
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
        "version-a": finalInspection(outputDurationSeconds),
        "version-b": finalInspection(outputDurationSeconds)
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

const refreshPreparedFingerprint = (snapshot: GptLiveQaSnapshot): void => {
  snapshot.prepared.manifestFingerprint = createHash("sha256")
    .update(
      JSON.stringify({
        production: snapshot.production,
        voice: snapshot.voice,
        plan: snapshot.plan,
        sourceMatrix: snapshot.sourceMatrix,
        sourceManifest: snapshot.sourceManifest
      })
    )
    .digest("hex");
};

const createQaRunHarness = async () => {
  const episodeDir = await mkdtemp(join(tmpdir(), "gpt-live-qa-race-"));
  const snapshot = JSON.parse(
    JSON.stringify(validSnapshot()).replaceAll(EPISODE_DIR, episodeDir)
  ) as GptLiveQaSnapshot;
  const logoBytes = new TextEncoder().encode("qa-logo");
  const logoSha256 = createHash("sha256").update(logoBytes).digest("hex");
  (snapshot.postProduction.assets as Record<string, unknown>).logoSha256 = logoSha256;
  snapshot.logo.sha256 = logoSha256;
  snapshot.prepared.manifestFingerprint = createHash("sha256")
    .update(JSON.stringify({
      production: snapshot.production,
      voice: snapshot.voice,
      plan: snapshot.plan,
      sourceMatrix: snapshot.sourceMatrix,
      sourceManifest: snapshot.sourceManifest
    }))
    .digest("hex");

  const postVariants = snapshot.postProduction.variants as Array<{
    name: "version-a" | "version-b";
    sha256: string;
    byteSize: number;
  }>;
  const generation = {
    ...snapshot.generation,
    variants: postVariants.map(({ name, sha256, byteSize }) => ({ name, sha256, byteSize }))
  };
  snapshot.generation = generation as typeof snapshot.generation;

  const paths = qaReportPaths(episodeDir);
  await mkdir(paths.visualDirectory, { recursive: true });
  await Promise.all([
    writeFile(paths.reportPath, "old-qa", "utf8"),
    writeFile(paths.comparisonPath, "old-comparison", "utf8"),
    writeFile(join(paths.visualDirectory, "old-frame.png"), "old-visual", "utf8")
  ]);

  const serializedFiles = new Map<string, string>([
    [join(episodeDir, "production.json"), JSON.stringify(snapshot.production)],
    [join(episodeDir, "voice", "narration.json"), JSON.stringify(snapshot.voice)],
    [join(episodeDir, "tella", "plan.json"), JSON.stringify(snapshot.plan)],
    [join(episodeDir, "tella", "state.json"), JSON.stringify(snapshot.tellaState)],
    [generation.reportPath, JSON.stringify(snapshot.postProduction)],
    [join(episodeDir, "reports", "prepared.json"), JSON.stringify(snapshot.prepared)],
    [join(episodeDir, "reports", "source-matrix.md"), snapshot.sourceMatrix],
    [join(episodeDir, "reports", "source-manifest.json"), JSON.stringify(snapshot.sourceManifest)],
    ...snapshot.voice.chunks.map((chunk) => [
      `${chunk.file}.json`,
      JSON.stringify(snapshot.voiceCacheMetadata[chunk.id])
    ] as [string, string])
  ]);
  const preparedInspections = new Map<string, PreparedMediaInspection>([
    ...Object.entries(snapshot.media.sources).map(([id, inspection]) => [
      join(episodeDir, "source", `${id}.mp4`),
      inspection
    ] as [string, PreparedMediaInspection]),
    ...snapshot.plan.clips.flatMap((clip) => clip.kind === "narration"
      ? [
          [clip.masterPath, snapshot.media.masters[clip.id]] as [string, PreparedMediaInspection],
          ...Object.entries(clip.variants).map(([variant, record]) => [
            record.platePath,
            snapshot.media.plates[`${variant}:${clip.id}`]
          ] as [string, PreparedMediaInspection])
        ]
      : [])
  ]);
  const artifacts = {
    contactSheets: { "version-a": "reports/visual/a.png", "version-b": "reports/visual/b.png" },
    transitionFrames: { "version-a": [], "version-b": [] },
    tailAudio: { "version-a": "reports/visual/a.wav", "version-b": "reports/visual/b.wav" },
    contactSampleTimesSeconds: { "version-a": [], "version-b": [] },
    checkedFrameCount: 58,
    contentMetrics: {
      minimumChangedPixelProportion: 0.07,
      minimumLumaVariance: 100,
      minimumNormalizedEntropy: 0.1
    }
  };

  return {
    episodeDir,
    snapshot,
    generation,
    paths,
    artifacts,
    dependencies: {
      readFile: async (path: string) => {
        const value = serializedFiles.get(path);
        if (value !== undefined) return value;
        throw Object.assign(new Error(`missing ${path}`), { code: "ENOENT" });
      },
      readFileBytes: async (path: string) =>
        path === snapshot.production.branding.logoPath
          ? logoBytes
          : new TextEncoder().encode(path),
      stat: async () => ({ isFile: () => true, size: 100 }),
      lstat: async () => ({ isDirectory: () => true, isSymbolicLink: () => false }) as any,
      realpath: async (path: any) => String(path),
      runCommand: async () => ({ stdout: "", stderr: "max_volume: -8.0 dB" }),
      inspectMediaFile: async (_ffprobePath: string, path: string) => preparedInspections.get(path)!,
      inspectFinalMediaFile: async (_ffprobePath: string, path: string) =>
        path.endsWith("version-a.mp4")
          ? snapshot.media.finals["version-a"]
          : snapshot.media.finals["version-b"],
      generateVisualArtifacts: async () => artifacts
    } as unknown as RunGptLiveQaDependencies
  };
};

describe("GPT-Live full production QA", () => {
  it("keeps machine success separate from pending human playback", () => {
    const humanPlayback = parseHumanPlaybackReview(undefined, validSnapshot().postProduction);
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
    const snapshot = validSnapshot();
    const template = buildHumanPlaybackReviewTemplate(
      snapshot.postProduction,
      "2026-07-11T12:00:00.000Z"
    );
    expect(template).toMatchObject({
      generationId: snapshot.generation.generationId,
      versionASha256: (snapshot.postProduction.variants as any[])[0].sha256,
      versionBSha256: (snapshot.postProduction.variants as any[])[1].sha256,
      status: "pending",
      reviewedAt: "2026-07-11T12:00:00.000Z"
    });
    const humanPlayback = parseHumanPlaybackReview(JSON.stringify({
      ...template,
      status: "passed",
      note: "Full A/B playback reviewed."
    }), snapshot.postProduction);
    expect(deriveQaStatus(humanPlayback)).toMatchObject({
      machineOk: true,
      humanPlayback: { status: "passed" },
      readyForUpload: true,
      ok: true
    });
  });

  it("keeps a passed review for a stale generation pending", () => {
    const snapshot = validSnapshot();
    const review = buildHumanPlaybackReviewTemplate(snapshot.postProduction);
    const humanPlayback = parseHumanPlaybackReview(JSON.stringify({
      ...review,
      generationId: "11111111-1111-4111-8111-111111111111",
      status: "passed"
    }), snapshot.postProduction);
    expect(deriveQaStatus(humanPlayback)).toMatchObject({
      humanPlayback: { status: "pending" },
      readyForUpload: false,
      ok: false
    });
  });

  it("keeps a passed review with a mismatched final hash pending", () => {
    const snapshot = validSnapshot();
    const review = buildHumanPlaybackReviewTemplate(snapshot.postProduction);
    const humanPlayback = parseHumanPlaybackReview(JSON.stringify({
      ...review,
      versionASha256: sha("9"),
      status: "passed"
    }), snapshot.postProduction);
    expect(deriveQaStatus(humanPlayback)).toMatchObject({
      humanPlayback: { status: "pending" },
      readyForUpload: false,
      ok: false
    });
  });

  it.each(["early", "late"])('cleans QA staging after a %s lifecycle failure', async (phase) => {
    const reportsDirectory = await mkdtemp(join(tmpdir(), "gpt-live-qa-lifecycle-"));
    let stagingDirectory = "";
    try {
      await expect(withQaStagingDirectory(reportsDirectory, {}, async (directory) => {
        stagingDirectory = directory;
        await writeFile(join(directory, `${phase}.tmp`), phase, "utf8");
        throw new Error(`${phase} lifecycle failure`);
      })).rejects.toThrow(`${phase} lifecycle failure`);
      await expect(readFile(stagingDirectory, "utf8")).rejects.toMatchObject({ code: "ENOENT" });
    } finally {
      await rm(reportsDirectory, { recursive: true, force: true });
    }
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

  it("accepts a generated report with an allowed final output duration drift", () => {
    expect(() => validateGptLiveQaSnapshot(validSnapshot(-0.2))).not.toThrow();
  });

  it("accepts the approved video query parameter in canonical declared media URLs", () => {
    const snapshot = validSnapshot();
    expect(snapshot.sourceManifest.sources[0]!.mediaUrls).toContain(
      "https://openai.com/index/introducing-gpt-live/?video=1208096618"
    );
    expect(() => validateGptLiveQaSnapshot(snapshot)).not.toThrow();
  });

  it.each([
    ["canonical", "https://openai.com/index/introducing-gpt-live/"],
    ["media", "https://cdn.example.com/video.mp4"],
    ["media", "https://openai.com/index/introducing-gpt-live/?video=1208096618"]
  ] as const)("accepts a safe %s URL at the independent allowlist gate", (kind, url) => {
    expect(() => assertSafeSourceManifestUrl(url, kind)).not.toThrow();
  });

  it.each([
    ["missing source", (sources: any[]) => sources.slice(1)],
    ["duplicate source", (sources: any[]) => [...sources, structuredClone(sources[0])]],
    ["extra source", (sources: any[]) => [...sources, { ...structuredClone(sources[0]), sourceId: "src_extra" }]]
  ])("rejects a source manifest with a %s", (_name, mutate) => {
    const snapshot = validSnapshot();
    snapshot.sourceManifest.sources = mutate(snapshot.sourceManifest.sources);
    expect(() => validateGptLiveQaSnapshot(snapshot)).toThrow(/source manifest/i);
  });

  it.each([
    ["missing entry field", (entry: any) => { delete entry.publisher; }],
    ["duplicate scene", (entry: any) => { entry.scenes.push(entry.scenes[0]); }],
    ["duplicate claim", (entry: any) => { entry.claims.push(entry.claims[0]); }],
    ["duplicate attribution", (entry: any) => {
      entry.onScreenAttribution.push(entry.onScreenAttribution[0]);
    }],
    ["duplicate playback decision", (entry: any) => {
      entry.playbackDecisions.push(entry.playbackDecisions[0]);
    }]
  ])("rejects a malformed source manifest entry with a %s", (_name, mutate) => {
    const snapshot = validSnapshot();
    mutate(snapshot.sourceManifest.sources[0]);
    expect(() => validateGptLiveQaSnapshot(snapshot)).toThrow(/source manifest/i);
  });

  it("rejects a missing mediaUrls field when the source has no declared media", () => {
    const snapshot = validSnapshot();
    delete (snapshot.sourceManifest.sources[1] as { mediaUrls?: string[] }).mediaUrls;

    expect(() => validateGptLiveQaSnapshot(snapshot)).toThrow(/source manifest/i);
  });

  it.each([
    ["HTTP", "http://openai.com/index/introducing-gpt-live/"],
    ["credentials", "https://user:password@openai.com/index/introducing-gpt-live/"],
    ["fragment", "https://openai.com/index/introducing-gpt-live/#source"],
    ...["sig", "h", "auth", "policy", "jwt", "token", "expires", "credential", "key", "Token"]
      .map((parameter) => [
        `${parameter} query parameter`,
        `https://openai.com/index/introducing-gpt-live/?${parameter}=secret`
      ])
  ])("rejects a canonical source URL containing %s at the URL safety gate", (_name, url) => {
      const snapshot = validSnapshot();
      snapshot.sourceManifest.sources[0]!.canonicalUrl = url;
      expect(() => validateGptLiveQaSnapshot(snapshot)).toThrow(
        /source manifest canonical URL.*(?:HTTPS|credentials|fragment|query parameters)/i
      );
  });

  it.each([
    ["local file URL", "file:///tmp/source.mp4"],
    ["local path", "/tmp/source.mp4"],
    ["HTTP", "http://openai.com/index/introducing-gpt-live/?video=1208096618"],
    ["credentials", "https://user:password@openai.com/index/introducing-gpt-live/?video=1208096618"],
    ["fragment", "https://openai.com/index/introducing-gpt-live/?video=1208096618#source"],
    ["mixed-case parameter", "https://openai.com/index/introducing-gpt-live/?Video=1208096618"],
    ["duplicate video parameters", "https://openai.com/index/introducing-gpt-live/?video=1208096618&video=1208152658"],
    ["empty video ID", "https://openai.com/index/introducing-gpt-live/?video="],
    ["non-decimal video ID", "https://openai.com/index/introducing-gpt-live/?video=abc"],
    ...["sig", "h", "auth", "policy", "jwt", "token", "expires", "credential", "key"]
      .map((parameter) => [
        `${parameter} query parameter`,
        `https://openai.com/index/introducing-gpt-live/?${parameter}=secret`
      ])
  ])("rejects a source-manifest media URL containing %s at the URL safety gate", (_name, mediaUrl) => {
    const snapshot = validSnapshot();
    snapshot.sourceManifest.sources[0]!.mediaUrls![0] = mediaUrl;
    expect(() => validateGptLiveQaSnapshot(snapshot)).toThrow(
      /source manifest media URL.*(?:HTTPS|credentials|fragment|only.*video|decimal media ID)/i
    );
  });

  it("rejects a safe but undeclared decimal media ID during exact manifest validation", () => {
    const snapshot = validSnapshot();
    snapshot.sourceManifest.sources[0]!.mediaUrls[0] =
      "https://openai.com/index/introducing-gpt-live/?video=9999999999";

    expect(() => validateGptLiveQaSnapshot(snapshot)).toThrow(/does not match the approved contract/i);
  });

  it.each([
    ["evidence scene", (entry: any) => { entry.scenes = []; }],
    ["on-screen attribution", (entry: any) => { entry.onScreenAttribution = []; }],
    ["playback decision", (entry: any) => { entry.playbackDecisions = []; }],
    ["full-screen media URL", (entry: any) => { entry.mediaUrls = []; }],
    ["YouTube-description flag", (entry: any) => { entry.youtubeDescription = false; }]
  ])("rejects source manifest drift in %s", (_name, mutate) => {
    const snapshot = validSnapshot();
    mutate(snapshot.sourceManifest.sources[0]);
    expect(() => validateGptLiveQaSnapshot(snapshot)).toThrow(/source manifest/i);
  });

  it("rejects a visible evidence item excluded from the YouTube description", () => {
    const snapshot = validSnapshot();
    snapshot.production.evidence[0] = {
      ...snapshot.production.evidence[0]!,
      youtubeDescription: false
    };

    expect(() => validateGptLiveQaSnapshot(snapshot)).toThrow(
      /visible evidence.*must be included in the YouTube description/i
    );
  });

  it("rejects a source with evidence excluded from the YouTube description", () => {
    const snapshot = validSnapshot();
    snapshot.sourceManifest.sources[0]!.youtubeDescription = false;

    expect(() => validateGptLiveQaSnapshot(snapshot)).toThrow(
      /source manifest.*must be included in the YouTube description/i
    );
  });

  it.each([
    ["missing claim", (claims: string[]) => claims.slice(1)],
    ["claim from another source", (claims: string[]) => [...claims, "claim_direction"]]
  ])("rejects source manifest claims with a %s", (_name, mutate) => {
    const snapshot = validSnapshot();
    snapshot.sourceManifest.sources[0]!.claims = mutate(
      snapshot.sourceManifest.sources[0]!.claims
    );
    expect(() => validateGptLiveQaSnapshot(snapshot)).toThrow(/source manifest.*claim/i);
  });

  it("rejects a prepared fingerprint that omits the source manifest", () => {
    const snapshot = validSnapshot();
    snapshot.prepared.manifestFingerprint = createHash("sha256")
      .update(JSON.stringify({
        production: snapshot.production,
        voice: snapshot.voice,
        plan: snapshot.plan,
        sourceMatrix: snapshot.sourceMatrix
      }))
      .digest("hex");

    expect(() => validateGptLiveQaSnapshot(snapshot)).toThrow(/prepared generation fingerprint/i);
  });

  it("accepts a prepared production using the resolved non-default outro path", () => {
    const snapshot = validSnapshot();
    const resolvedOutroPath = "/assets/Outro_Alternate.mp3";
    snapshot.env.AIMH_OUTRO_MUSIC_PATH = resolvedOutroPath;
    snapshot.production.audio = {
      ...snapshot.production.audio,
      outroMusicPath: resolvedOutroPath
    };
    const audioPolicy = snapshot.postProduction.audioPolicy as {
      outro: Record<string, unknown>;
    };
    audioPolicy.outro.file = "Outro_Alternate.mp3";
    refreshPreparedFingerprint(snapshot);

    expect(() => validateGptLiveQaSnapshot(snapshot)).not.toThrow();
  });

  it("rejects a production with altered immutable audio policy", () => {
    const snapshot = validSnapshot();
    snapshot.production.audio = {
      ...snapshot.production.audio,
      bodyMusic: true
    } as unknown as typeof snapshot.production.audio;
    refreshPreparedFingerprint(snapshot);

    expect(() => validateGptLiveQaSnapshot(snapshot)).toThrow(/audio policy|production manifest/i);
  });

  it("rejects post-production outro timing that does not match the final duration", () => {
    const snapshot = validSnapshot();
    const audioPolicy = snapshot.postProduction.audioPolicy as {
      outro: Record<string, unknown>;
    };
    audioPolicy.outro.startSeconds = 0;

    expect(() => validateGptLiveQaSnapshot(snapshot)).toThrow(/outro|audio policy/i);
  });

  it("rejects QA without a resolved outro path", () => {
    const snapshot = validSnapshot();
    delete snapshot.env.AIMH_OUTRO_MUSIC_PATH;

    expect(() => validateGptLiveQaSnapshot(snapshot)).toThrow(/resolved QA environment/i);
  });

  it("rejects an unexpected serialized outro path", () => {
    const snapshot = validSnapshot();
    snapshot.production.audio = {
      ...snapshot.production.audio,
      outroMusicPath: "/outside/outro.mp3"
    };

    expect(() =>
      validateSerializedQaPaths({
        episodeDir: snapshot.episodeDir,
        env: snapshot.env,
        production: snapshot.production,
        voice: snapshot.voice,
        plan: snapshot.plan,
        generation: snapshot.generation
      })
    ).toThrow(/audio path/i);
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
      env: snapshot.env,
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

  it("aborts when the published generation changes during visual sampling", async () => {
    const harness = await createQaRunHarness();
    const changedGeneration = {
      ...harness.generation,
      generationId: "33333333-3333-4333-8333-333333333333"
    };
    let currentGeneration = harness.generation;

    try {
      await expect(runGptLiveQa(
        {
          episodeDir: harness.episodeDir,
          env: harness.snapshot.env,
          ffmpegPath: "ffmpeg",
          ffprobePath: "ffprobe"
        },
        {
          ...harness.dependencies,
          validatePublishedGeneration: async () => currentGeneration,
          generateVisualArtifacts: async () => {
            currentGeneration = changedGeneration;
            return harness.artifacts;
          }
        }
      )).rejects.toThrow(/generation.*changed|changed.*generation/i);

      await expect(readFile(harness.paths.reportPath, "utf8")).resolves.toBe("old-qa");
      await expect(readFile(harness.paths.comparisonPath, "utf8")).resolves.toBe("old-comparison");
      await expect(readFile(join(harness.paths.visualDirectory, "old-frame.png"), "utf8"))
        .resolves.toBe("old-visual");
    } finally {
      await rm(harness.episodeDir, { recursive: true, force: true });
    }
  });

  it("aborts when generation hashes change immediately before QA publication", async () => {
    const harness = await createQaRunHarness();
    let currentGeneration = harness.generation;

    try {
      await expect(runGptLiveQa(
        {
          episodeDir: harness.episodeDir,
          env: harness.snapshot.env,
          ffmpegPath: "ffmpeg",
          ffprobePath: "ffprobe"
        },
        {
          ...harness.dependencies,
          validatePublishedGeneration: async () => currentGeneration,
          writeJsonAtomic: async (path, value) => {
            currentGeneration = {
              ...harness.generation,
              variants: harness.generation.variants.map((variant, index) => index === 0
                ? { ...variant, sha256: sha("9"), byteSize: variant.byteSize + 1 }
                : variant)
            };
            await writeFile(path, `${JSON.stringify(value, null, 2)}\n`, "utf8");
          }
        }
      )).rejects.toThrow(/generation.*changed|changed.*generation/i);

      await expect(readFile(harness.paths.reportPath, "utf8")).resolves.toBe("old-qa");
      await expect(readFile(harness.paths.comparisonPath, "utf8")).resolves.toBe("old-comparison");
      await expect(readFile(join(harness.paths.visualDirectory, "old-frame.png"), "utf8"))
        .resolves.toBe("old-visual");
    } finally {
      await rm(harness.episodeDir, { recursive: true, force: true });
    }
  });

  it("aborts when only the post-production report hash changes before QA publication", async () => {
    const harness = await createQaRunHarness();
    let currentGeneration = harness.generation;

    try {
      await expect(runGptLiveQa(
        {
          episodeDir: harness.episodeDir,
          env: harness.snapshot.env,
          ffmpegPath: "ffmpeg",
          ffprobePath: "ffprobe"
        },
        {
          ...harness.dependencies,
          validatePublishedGeneration: async () => currentGeneration,
          writeJsonAtomic: async (path, value) => {
            currentGeneration = { ...harness.generation, reportSha256: sha("9") };
            await writeFile(path, `${JSON.stringify(value, null, 2)}\n`, "utf8");
          }
        }
      )).rejects.toThrow(/generation.*changed|changed.*generation/i);

      await expect(readFile(harness.paths.reportPath, "utf8")).resolves.toBe("old-qa");
    } finally {
      await rm(harness.episodeDir, { recursive: true, force: true });
    }
  });

  it("records the stable validated generation identity in qa.json", async () => {
    const harness = await createQaRunHarness();

    try {
      await runGptLiveQa(
        {
          episodeDir: harness.episodeDir,
          env: harness.snapshot.env,
          ffmpegPath: "ffmpeg",
          ffprobePath: "ffprobe"
        },
        {
          ...harness.dependencies,
          validatePublishedGeneration: async () => harness.generation
        }
      );

      const report = JSON.parse(await readFile(harness.paths.reportPath, "utf8"));
      expect(report.generation).toEqual({
        generationId: harness.generation.generationId,
        variants: harness.generation.variants
      });
    } finally {
      await rm(harness.episodeDir, { recursive: true, force: true });
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
          readFile,
          withProductionLock: async (_episodeDir, _operation, action) => action()
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
