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
import type { EvidenceInspection } from "../src/production/gptLive/evidence";
import {
  buildPostProductionManifest,
  buildProgramAudioPlan,
  deriveSharedSourceGains,
  deriveSourceDuckIntervals,
  type FinalMediaInspection,
  type PublishedGenerationValidation
} from "../src/production/gptLive/finish";
import type { MediaInspection } from "../src/production/gptLive/mediaInspection";
import { derivePreparedArtifactDescriptors } from "../src/production/gptLive/preparation";
import { GPT_LIVE_SCENES, sceneStyle } from "../src/production/gptLive/motion/sceneStyle";
import { runCommand } from "../src/render/process";
import {
  clearStaleQaOutputs,
  buildHumanPlaybackReviewTemplate,
  deriveQaStatus,
  parseHumanPlaybackReview,
  qaReportPaths,
  runGptLiveQa,
  validateGptLiveQaSnapshot,
  type GptLiveQaSnapshot,
  type RunGptLiveQaDependencies,
  type VisualArtifacts
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
  assertTransitionFrameHasContent,
  generateVisualArtifacts,
  inspectTransitionFrameContent,
  parseTransitionSignalStats,
  planTransitionBoundarySamples,
  renderComparisonMarkdown
} from "../src/production/gptLive/qa/visual";
import { assertSafeSourceManifestUrl } from "../src/production/gptLive/qa/validation";
import { buildTellaPlan } from "../src/production/gptLive/tellaPlan";
import {
  SOURCE_FULLSCREEN_SSIM_THRESHOLD,
  buildSourceFullscreenTiming,
  deriveSourceFullscreenExpectations,
  type SourceFullscreenTiming
} from "../src/production/gptLive/sourceFullscreen";
import {
  buildTellaTimelineAudit,
  validateTellaTimelineAudit,
  type TellaStateForTimelineAudit,
  type TellaTimelineAudit
} from "../src/production/gptLive/tellaState";
import { buildVoiceCacheKey } from "../src/voice/elevenLabsAdapter";

const EPISODE_DIR = "/episode";
const sha = (character: string): string => character.repeat(64);
const evidenceInspectionsFor = (
  artifacts: readonly { logicalId: string; sha256: string; byteSize: number }[]
): EvidenceInspection[] => GPT_LIVE_CONTENT.evidence
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
      lumaRange: 208 - index,
      lumaVariance: 1024 + index,
      normalizedEntropy: 0.25 + index / 100
    };
  });
const transitionSampleRecords = (clips: readonly { id: string }[]) =>
  clips.slice(0, -1).flatMap((clip, index) => {
    const boundaryId = `boundary-${String(index + 1).padStart(2, "0")}-${clip.id}-to-${clips[index + 1]!.id}`;
    return (["before", "after"] as const).map((side, sideIndex) => ({
      boundaryId,
      side,
      timeSeconds: (index * 2 + sideIndex) / 30,
      frameIndex: index * 2 + sideIndex
    }));
  });

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
    AIMH_LOGO_PATH: GPT_LIVE_CONTENT.branding.logoPath,
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
  const tellaExports = [
    {
      version: "version-a" as const,
      sourceVariant: "dynamic_editorial" as const,
      remoteVideoId: "video-a",
      workflowId: "Export-Story-video-a/2026-07-12T17:23:26.147Z/Story/1920x1080/30FPS",
      exportPath: "exports/tella-a.mp4" as const,
      sha256: sha("6"),
      byteSize: 900
    },
    {
      version: "version-b" as const,
      sourceVariant: "aimh_visual_host" as const,
      remoteVideoId: "video-b",
      workflowId: "Export-Story-video-b/2026-07-12T17:24:26.147Z/Story/1920x1080/30FPS",
      exportPath: "exports/tella-b.mp4" as const,
      sha256: sha("7"),
      byteSize: 901
    }
  ] as const;
  const sourceFullscreenTiming: SourceFullscreenTiming = {
    narrationDurationMs: {
      "version-a": plan.clips.filter((clip) => clip.kind === "narration")
        .map((clip) => Math.round(clip.durationSeconds * 1_000)),
      "version-b": plan.clips.filter((clip) => clip.kind === "narration")
        .map((clip) => Math.round(clip.durationSeconds * 1_000))
    },
    sourceDurationMs: {
      "version-a": plan.clips.filter((clip) => clip.kind === "source_clip")
        .map((clip) => Math.round(clip.durationSeconds * 1_000)),
      "version-b": plan.clips.filter((clip) => clip.kind === "source_clip")
        .map((clip) => Math.round(clip.durationSeconds * 1_000))
    }
  };
  const sourceFullscreen = deriveSourceFullscreenExpectations(
    plan,
    sourceFullscreenTiming
  ).map((sample) => ({
    ...sample,
    ssim: 0.93,
    threshold: SOURCE_FULLSCREEN_SSIM_THRESHOLD
  }));
  const postProduction = buildPostProductionManifest({
    productionId: GPT_LIVE_CONTENT.id,
    generationId: "00000000-0000-4000-8000-000000000000",
    preparationFingerprint: sha("f"),
    logoPath: GPT_LIVE_CONTENT.branding.logoPath,
    outroMusicPath: GPT_LIVE_CONTENT.audio.outroMusicPath,
    outroDurationSeconds: GPT_LIVE_CONTENT.audio.outroDurationSeconds,
    logoSha256: sha("a"),
    programAudio: buildProgramAudioPlan(EPISODE_DIR, plan).inputs.map((input, index) => ({
      clipId: input.clipId,
      kind: input.kind,
      path: input.relativePath,
      sha256: String(index).padStart(64, "0"),
      byteSize: index + 1,
      durationSeconds: input.durationSeconds
    })),
    sourceGains,
    logoEvidence: (["version-a", "version-b"] as const).map((name) => ({
      name,
      samples: [0.5, durationSeconds / 2, durationSeconds - 0.5].map((timeSeconds) => ({
        timeSeconds,
        inputSha256: sha("b"),
        outputSha256: sha("c")
      }))
    })),
    tellaExports,
    sourceFullscreen,
    variants: [
      {
        name: "version-a",
        inputPath: join(EPISODE_DIR, "exports", "tella-a.mp4"),
        outputPath: join(EPISODE_DIR, "final", "version-a.mp4"),
        inputDurationSeconds: durationSeconds,
        outputDurationSeconds,
        inputSha256: sha("6"),
        inputByteSize: 900,
        sha256: sha("d"),
        byteSize: 1_000
      },
      {
        name: "version-b",
        inputPath: join(EPISODE_DIR, "exports", "tella-b.mp4"),
        outputPath: join(EPISODE_DIR, "final", "version-b.mp4"),
        inputDurationSeconds: durationSeconds,
        outputDurationSeconds,
        inputSha256: sha("7"),
        inputByteSize: 901,
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
  (state as Record<string, unknown>).timelineAudit = {
    schemaVersion: "0.2.0",
    compatibilityVideoIds: structuredClone(state.variantVideoIds),
    orderedClipIds: Object.fromEntries(
      GPT_LIVE_CONTENT.variants.map((variant) => [
        variant,
        plan.clips.map((clip) => state.variantClipIds[variant][clip.id])
      ])
    ),
    remoteStoryDurationMs: Object.fromEntries(
      GPT_LIVE_CONTENT.variants.map((variant) => [variant, Math.round(durationSeconds * 1_000)])
    ),
    narrationLayouts: Object.fromEntries(
      GPT_LIVE_CONTENT.variants.map((variant) => [
        variant,
        plan.clips.filter((clip) => clip.kind === "narration").map((clip) => ({
          clipId: state.variantClipIds[variant][clip.id],
          layoutId: state.layoutIds[`${variant}:${clip.id}`],
          sourceId: state.sourceIds[`plate:${variant}:${clip.id}`],
          startTimeMs: 0,
          clipDurationMs: Math.round(clip.durationSeconds * 1_000),
          durationMs: Math.round(clip.durationSeconds * 1_000),
          transitionStyle: "hardCut"
        }))
      ])
    ),
    sourceClips: Object.fromEntries(
      GPT_LIVE_CONTENT.variants.map((variant) => [
        variant,
        plan.clips.filter((clip) => clip.kind === "source_clip").map((clip) => ({
          clipId: state.variantClipIds[variant][clip.id],
          durationMs: Math.round(clip.durationSeconds * 1_000)
        }))
      ])
    ),
    soundEffectIds: Object.fromEntries(
      GPT_LIVE_CONTENT.variants.map((variant) => [variant, []])
    )
  };
  const sourceMatrix = "canonical source matrix";
  const sourceManifest = canonicalSourceManifest();
  const preparedArtifacts = derivePreparedArtifactDescriptors({
    episodeDir: EPISODE_DIR,
    production,
    voice,
    plan
  }).map((artifact, index) => ({
    logicalId: artifact.logicalId,
    path: artifact.path,
    sha256: createHash("sha256").update(`artifact-${index}`).digest("hex"),
    byteSize: index + 1
  }));
  const evidenceInspections = evidenceInspectionsFor(preparedArtifacts);
  const manifestFingerprint = createHash("sha256")
    .update(JSON.stringify({
      production,
      voice,
      plan,
      sourceMatrix,
      sourceManifest,
      artifacts: preparedArtifacts,
      evidenceInspections
    }))
    .digest("hex");
  (postProduction as { preparationFingerprint: string }).preparationFingerprint = manifestFingerprint;
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
      preparationFingerprint: manifestFingerprint,
      preparedArtifacts,
      reportSha256: sha("f"),
      variants: postProduction.variants.map((variant) => ({
        name: variant.name,
        inputSha256: variant.inputSha256,
        inputByteSize: variant.inputByteSize,
        sha256: variant.sha256,
        byteSize: variant.byteSize
      })),
      programAudio: postProduction.programAudio.inputs.map((input) => ({ ...input })),
      tellaExports,
      sourceFullscreen,
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
      artifacts: preparedArtifacts,
      evidenceInspections,
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
    tellaExportReceipt: {
      schemaVersion: "0.2.0",
      productionId: GPT_LIVE_CONTENT.id,
      exports: tellaExports
    },
    tellaState: state,
    postProduction,
    observedSourceFullscreen: structuredClone(sourceFullscreen),
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
      exports: {
        "version-a": finalInspection(durationSeconds),
        "version-b": finalInspection(durationSeconds)
      },
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
    },
    observedEvidenceInspections: structuredClone(evidenceInspections)
  } as unknown as GptLiveQaSnapshot;
};

const refreshPreparedFingerprint = (snapshot: GptLiveQaSnapshot): void => {
  const manifestFingerprint = createHash("sha256")
    .update(
      JSON.stringify({
        production: snapshot.production,
        voice: snapshot.voice,
        plan: snapshot.plan,
        sourceMatrix: snapshot.sourceMatrix,
        sourceManifest: snapshot.sourceManifest,
        artifacts: snapshot.prepared.artifacts,
        evidenceInspections: snapshot.prepared.evidenceInspections
      })
    )
    .digest("hex");
  snapshot.prepared.manifestFingerprint = manifestFingerprint;
  (snapshot.generation as { preparationFingerprint: string }).preparationFingerprint =
    manifestFingerprint;
  snapshot.postProduction.preparationFingerprint = manifestFingerprint;
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
      sourceManifest: snapshot.sourceManifest,
      artifacts: snapshot.prepared.artifacts,
      evidenceInspections: snapshot.prepared.evidenceInspections
    }))
    .digest("hex");
  (snapshot.generation as { preparationFingerprint: string }).preparationFingerprint =
    String(snapshot.prepared.manifestFingerprint);
  snapshot.postProduction.preparationFingerprint = snapshot.prepared.manifestFingerprint;

  const postVariants = snapshot.postProduction.variants as Array<{
    name: "version-a" | "version-b";
    inputSha256: string;
    inputByteSize: number;
    sha256: string;
    byteSize: number;
  }>;
  const generation = {
    ...snapshot.generation,
    variants: postVariants.map(({
      name,
      inputSha256,
      inputByteSize,
      sha256,
      byteSize
    }) => ({ name, inputSha256, inputByteSize, sha256, byteSize }))
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
    [
      join(episodeDir, "reports", "tella-export-receipt.json"),
      JSON.stringify(snapshot.tellaExportReceipt)
    ],
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
  const artifacts: VisualArtifacts = {
    contactSheets: { "version-a": "reports/visual/a.png", "version-b": "reports/visual/b.png" },
    transitionFrames: { "version-a": [], "version-b": [] },
    tailAudio: { "version-a": "reports/visual/a.wav", "version-b": "reports/visual/b.wav" },
    contactSampleTimesSeconds: { "version-a": [], "version-b": [] },
    transitionContent: {
      "version-a": {
        sampledFrames: 16,
        samples: transitionSampleRecords(snapshot.plan.clips),
        blankFrames: []
      },
      "version-b": {
        sampledFrames: 16,
        samples: transitionSampleRecords(snapshot.plan.clips),
        blankFrames: []
      }
    },
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
      inspectEvidenceAssets: async () => structuredClone(snapshot.observedEvidenceInspections),
      runCommand: async () => ({ stdout: "", stderr: "max_volume: -8.0 dB" }),
      inspectMediaFile: async (_ffprobePath: string, path: string) => preparedInspections.get(path)!,
      inspectFinalMediaFile: async (_ffprobePath: string, path: string) =>
        path.endsWith("tella-a.mp4")
          ? snapshot.media.exports["version-a"]
          : path.endsWith("tella-b.mp4")
            ? snapshot.media.exports["version-b"]
            : path.endsWith("version-a.mp4")
              ? snapshot.media.finals["version-a"]
              : snapshot.media.finals["version-b"],
      validateSealedTellaExports: async () => snapshot.tellaExportReceipt,
      verifySourceFullscreen: async () => snapshot.observedSourceFullscreen,
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

  it("parses transition signalstats component ranges", () => {
    expect(parseTransitionSignalStats([
      "showinfo stdev:[85.4 0.0 0.0]",
      "lavfi.signalstats.YMIN=16",
      "lavfi.signalstats.YMAX=235",
      "lavfi.signalstats.UMIN=90",
      "lavfi.signalstats.UMAX=140",
      "lavfi.signalstats.VMIN=101",
      "lavfi.signalstats.VMAX=155",
      "lavfi.entropy.normalized_entropy.normal.Y=0.109035"
    ].join("\n"))).toEqual({
      yRange: 219,
      uRange: 50,
      vRange: 54,
      lumaVariance: 7293.16,
      normalizedEntropy: 0.109035
    });
  });

  it.each([
    ["missing", "lavfi.signalstats.YMIN=16\nlavfi.signalstats.YMAX=235"],
    ["non-finite", [
      "lavfi.signalstats.YMIN=NaN",
      "lavfi.signalstats.YMAX=235",
      "lavfi.signalstats.UMIN=90",
      "lavfi.signalstats.UMAX=140",
      "lavfi.signalstats.VMIN=101",
      "lavfi.signalstats.VMAX=155",
      "showinfo stdev:[85.4 0.0 0.0]",
      "lavfi.entropy.normalized_entropy.normal.Y=0.109035"
    ].join("\n")]
  ])("rejects %s transition signalstats metadata", (_name, text) => {
    expect(() => parseTransitionSignalStats(text)).toThrow(/signalstats|metadata/i);
  });

  it.each([
    { yRange: 2, uRange: 2, vRange: 10 },
    { yRange: 3, uRange: 3, vRange: 8 },
    { yRange: 4, uRange: 3, vRange: 8 }
  ])("rejects compressed near-black chroma noise $yRange/$uRange/$vRange", (ranges) => {
    expect(() => assertTransitionFrameHasContent({
      ...ranges,
      lumaVariance: 100,
      normalizedEntropy: 0.5
    })).toThrow(/transition.*content|blank|base/i);
  });

  it.each([
    { yRange: 220, uRange: 0, vRange: 0, lumaVariance: 7293.16, normalizedEntropy: 0.109035 },
    { yRange: 180, uRange: 120, vRange: 120, lumaVariance: 3340.84, normalizedEntropy: 0.72 }
  ])("accepts representative article and official-video luma structure", (stats) => {
    expect(() => assertTransitionFrameHasContent(stats)).not.toThrow();
  });

  it.each([
    { yRange: 6, uRange: 40, vRange: 40, lumaVariance: 100, normalizedEntropy: 0.5 },
    { yRange: 220, uRange: 0, vRange: 0, lumaVariance: 24.9, normalizedEntropy: 0.5 },
    { yRange: 220, uRange: 0, vRange: 0, lumaVariance: 100, normalizedEntropy: 0.019 }
  ])("rejects transition frames without meaningful luma structure", (stats) => {
    expect(() => assertTransitionFrameHasContent(stats)).toThrow(/transition.*content|blank|base/i);
  });

  it("probes real encoded CFR frames and rejects uniform base colors", async () => {
    const directory = await mkdtemp(join(tmpdir(), "gpt-live-transition-cfr-"));
    const videoPath = join(directory, "transition-content.mp4");
    try {
      await runCommand("ffmpeg", [
        "-hide_banner", "-loglevel", "error", "-y",
        "-f", "lavfi", "-i", "color=c=black:s=320x180:r=30:d=0.2",
        "-f", "lavfi", "-i", "color=c=white:s=320x180:r=30:d=0.2",
        "-f", "lavfi", "-i", "color=c=blue:s=320x180:r=30:d=0.2",
        "-f", "lavfi", "-i", "color=c=0x05060d:s=320x180:r=30:d=0.2",
        "-f", "lavfi", "-i",
        "color=c=white:s=320x180:r=30:d=0.2,drawbox=x=20:y=25:w=260:h=18:color=black:t=fill,drawbox=x=20:y=65:w=220:h=8:color=black:t=fill,drawbox=x=20:y=85:w=270:h=8:color=black:t=fill,drawbox=x=20:y=105:w=190:h=8:color=black:t=fill",
        "-f", "lavfi", "-i", "testsrc2=s=320x180:r=30:d=0.2",
        "-filter_complex",
        "[0:v][1:v][2:v][3:v][4:v][5:v]concat=n=6:v=1:a=0,format=yuv420p[v]",
        "-map", "[v]", "-c:v", "libx264", "-preset", "ultrafast", "-crf", "18",
        "-g", "1", "-r", "30", "-an", videoPath
      ]);

      for (const timeSeconds of [0.9, 1.1]) {
        await expect(inspectTransitionFrameContent("ffmpeg", videoPath, timeSeconds))
          .resolves.toMatchObject({ yRange: expect.any(Number) });
      }
      for (const timeSeconds of [0.1, 0.3, 0.5, 0.7]) {
        await expect(inspectTransitionFrameContent("ffmpeg", videoPath, timeSeconds))
          .rejects.toThrow(/blank|base layer|content/i);
      }
    } finally {
      await rm(directory, { recursive: true, force: true });
    }
  }, 30_000);

  it("fails closed when a boundary cannot resolve to three distinct consecutive 30fps frames", () => {
    const plan = {
      schemaVersion: "0.1.0" as const,
      productionId: "transition-test",
      clips: [
        { id: "clip-one", kind: "source_clip" as const, durationSeconds: 0.01 },
        { id: "clip-two", kind: "source_clip" as const, durationSeconds: 0.01 }
      ]
    } as any;
    expect(() => planTransitionBoundarySamples(plan, 0.02))
      .toThrow(/three distinct consecutive 30fps frames/i);
  });

  it("fails closed when a final boundary cannot provide three distinct consecutive frames", () => {
    const plan = {
      schemaVersion: "0.1.0" as const,
      productionId: "transition-test",
      clips: [
        { id: "clip-one", kind: "source_clip" as const, durationSeconds: 0.02 },
        { id: "clip-two", kind: "source_clip" as const, durationSeconds: 0.06 },
        { id: "clip-three", kind: "source_clip" as const, durationSeconds: 0.02 }
      ]
    } as any;

    expect(() => planTransitionBoundarySamples(plan, 0.1))
      .toThrow(/three distinct consecutive 30fps frames/i);
  });

  it("samples the exact cut frame between the immediately previous and next frames", () => {
    const plan = {
      schemaVersion: "0.1.0" as const,
      productionId: "transition-test",
      clips: [
        { id: "clip-one", kind: "source_clip" as const, durationSeconds: 1 },
        { id: "clip-two", kind: "source_clip" as const, durationSeconds: 1 }
      ]
    } as any;

    expect(planTransitionBoundarySamples(plan, 2).map((sample) => ({
      label: sample.label,
      position: sample.position,
      timeSeconds: sample.timeSeconds,
      frameIndex: sample.frameIndex
    }))).toEqual([
      {
        label: "boundary-01-clip-one-to-clip-two-before",
        position: "before",
        timeSeconds: 0.966666,
        frameIndex: 29
      },
      {
        label: "boundary-01-clip-one-to-clip-two-exact",
        position: "exact",
        timeSeconds: 1,
        frameIndex: 30
      },
      {
        label: "boundary-01-clip-one-to-clip-two-after",
        position: "after",
        timeSeconds: 1.033333,
        frameIndex: 31
      }
    ]);
  });

  it("samples before, exact, and after at every clip boundary with consecutive indices", async () => {
    const episodeDir = await mkdtemp(join(tmpdir(), "gpt-live-transition-content-"));
    const calls: Array<{ command: string; args: string[] }> = [];
    const plan = {
      schemaVersion: "0.1.0" as const,
      productionId: "transition-test",
      clips: [
        { id: "clip-one", kind: "source_clip" as const, durationSeconds: 0.05 },
        { id: "clip-two", kind: "source_clip" as const, durationSeconds: 0.05 },
        { id: "clip-three", kind: "source_clip" as const, durationSeconds: 0.05 }
      ]
    } as any;
    try {
      const artifacts = await generateVisualArtifacts({
        episodeDir,
        finalPaths: { "version-a": "/final-a.mp4", "version-b": "/final-b.mp4" },
        durations: { "version-a": 0.15, "version-b": 0.15 },
        plan,
        ffmpegPath: "ffmpeg"
      }, {
        runCommand: async (command, args) => {
          calls.push({ command, args });
          if (args.some((arg) => arg.includes("signalstats") && arg.endsWith("metadata=print"))) {
            return {
              stdout: "",
              stderr: [
                "showinfo stdev:[20.0 0.0 0.0]",
                "lavfi.signalstats.YMIN=16",
                "lavfi.signalstats.YMAX=40",
                "lavfi.signalstats.UMIN=100",
                "lavfi.signalstats.UMAX=110",
                "lavfi.signalstats.VMIN=120",
                "lavfi.signalstats.VMAX=128",
                "lavfi.entropy.normalized_entropy.normal.Y=0.1"
              ].join("\n")
            };
          }
          return {
            stdout: "",
            stderr: "lavfi.blackframe.pblack=0\nshowinfo stdev:[20.0 0.0 0.0]\nlavfi.entropy.normalized_entropy.normal.Y=0.1"
          };
        }
      });

      const signalCalls = calls.filter(({ args }) =>
        args.some((arg) => arg.includes("signalstats") && arg.endsWith("metadata=print"))
      );
      expect(signalCalls).toHaveLength(12);
      expect(signalCalls.every(({ args }) =>
        args.includes("crop=iw*0.85:ih*0.92:iw*0.02:ih*0.04,signalstats,entropy,showinfo,metadata=print")
      )).toBe(true);
      expect(signalCalls.map(({ args }) => ({
        input: args[args.indexOf("-i") + 1],
        time: args[args.indexOf("-ss") + 1]
      }))).toEqual([
        { input: "/final-a.mp4", time: "0.016666" },
        { input: "/final-a.mp4", time: "0.050000" },
        { input: "/final-a.mp4", time: "0.083333" },
        { input: "/final-a.mp4", time: "0.066666" },
        { input: "/final-a.mp4", time: "0.100000" },
        { input: "/final-a.mp4", time: "0.133333" },
        { input: "/final-b.mp4", time: "0.016666" },
        { input: "/final-b.mp4", time: "0.050000" },
        { input: "/final-b.mp4", time: "0.083333" },
        { input: "/final-b.mp4", time: "0.066666" },
        { input: "/final-b.mp4", time: "0.100000" },
        { input: "/final-b.mp4", time: "0.133333" }
      ]);
      expect(artifacts.transitionContent).toEqual({
        "version-a": {
          sampledFrames: 4,
          samples: [
            { boundaryId: "boundary-01-clip-one-to-clip-two", side: "before", timeSeconds: 0.016666, frameIndex: 1 },
            { boundaryId: "boundary-01-clip-one-to-clip-two", side: "after", timeSeconds: 0.083333, frameIndex: 3 },
            { boundaryId: "boundary-02-clip-two-to-clip-three", side: "before", timeSeconds: 0.066666, frameIndex: 2 },
            { boundaryId: "boundary-02-clip-two-to-clip-three", side: "after", timeSeconds: 0.133333, frameIndex: 4 }
          ],
          blankFrames: []
        },
        "version-b": {
          sampledFrames: 4,
          samples: [
            { boundaryId: "boundary-01-clip-one-to-clip-two", side: "before", timeSeconds: 0.016666, frameIndex: 1 },
            { boundaryId: "boundary-01-clip-one-to-clip-two", side: "after", timeSeconds: 0.083333, frameIndex: 3 },
            { boundaryId: "boundary-02-clip-two-to-clip-three", side: "before", timeSeconds: 0.066666, frameIndex: 2 },
            { boundaryId: "boundary-02-clip-two-to-clip-three", side: "after", timeSeconds: 0.133333, frameIndex: 4 }
          ],
          blankFrames: []
        }
      });
      for (const content of Object.values(artifacts.transitionContent)) {
        for (const sample of content.samples) {
          expect(Math.max(0, Math.ceil(sample.timeSeconds * 30 - 1e-9)))
            .toBe(sample.frameIndex);
        }
      }
    } finally {
      await rm(episodeDir, { recursive: true, force: true });
    }
  });

  it("rejects a uniform blue exact-cut frame during visual artifact generation", async () => {
    const episodeDir = await mkdtemp(join(tmpdir(), "gpt-live-transition-exact-blank-"));
    const transitionTimes: string[] = [];
    const plan = {
      schemaVersion: "0.1.0" as const,
      productionId: "transition-test",
      clips: [
        { id: "clip-one", kind: "source_clip" as const, durationSeconds: 1 },
        { id: "clip-two", kind: "source_clip" as const, durationSeconds: 1 }
      ]
    } as any;
    try {
      await expect(generateVisualArtifacts({
        episodeDir,
        finalPaths: { "version-a": "/final-a.mp4", "version-b": "/final-b.mp4" },
        durations: { "version-a": 2, "version-b": 2 },
        plan,
        ffmpegPath: "ffmpeg"
      }, {
        runCommand: async (_command, args) => {
          if (args.some((arg) => arg.includes("signalstats") && arg.endsWith("metadata=print"))) {
            const time = args[args.indexOf("-ss") + 1]!;
            transitionTimes.push(time);
            const exactCut = time === "1.000000";
            return {
              stdout: "",
              stderr: [
                `showinfo stdev:[${exactCut ? "0.0" : "20.0"} 0.0 0.0]`,
                `lavfi.signalstats.YMIN=${exactCut ? 41 : 16}`,
                `lavfi.signalstats.YMAX=${exactCut ? 41 : 40}`,
                `lavfi.signalstats.UMIN=${exactCut ? 240 : 100}`,
                `lavfi.signalstats.UMAX=${exactCut ? 240 : 110}`,
                `lavfi.signalstats.VMIN=${exactCut ? 110 : 120}`,
                `lavfi.signalstats.VMAX=${exactCut ? 110 : 128}`,
                `lavfi.entropy.normalized_entropy.normal.Y=${exactCut ? "0" : "0.1"}`
              ].join("\n")
            };
          }
          return {
            stdout: "",
            stderr: "lavfi.blackframe.pblack=0\nshowinfo stdev:[20.0 0.0 0.0]\nlavfi.entropy.normalized_entropy.normal.Y=0.1"
          };
        }
      })).rejects.toThrow(/transition frame is blank|base layer/i);
      expect(transitionTimes).toContain("1.000000");
    } finally {
      await rm(episodeDir, { recursive: true, force: true });
    }
  });

  it("reports blank transition frames with deterministic clip-pair IDs", async () => {
    const episodeDir = await mkdtemp(join(tmpdir(), "gpt-live-transition-blank-"));
    const plan = {
      schemaVersion: "0.1.0" as const,
      productionId: "transition-test",
      clips: [
        { id: "clip-one", kind: "source_clip" as const, durationSeconds: 1 },
        { id: "clip-two", kind: "source_clip" as const, durationSeconds: 1 }
      ]
    } as any;
    try {
      const artifacts = await generateVisualArtifacts({
        episodeDir,
        finalPaths: { "version-a": "/final-a.mp4", "version-b": "/final-b.mp4" },
        durations: { "version-a": 2, "version-b": 2 },
        plan,
        ffmpegPath: "ffmpeg"
      }, {
        runCommand: async (_command, args) => {
          if (args.some((arg) => arg.includes("signalstats") && arg.endsWith("metadata=print"))) {
            const input = args[args.indexOf("-i") + 1];
            const time = args[args.indexOf("-ss") + 1];
            const blank = input === "/final-b.mp4" && time === "1.033333";
            return {
              stdout: "",
              stderr: [
                `showinfo stdev:[${blank ? "1.0" : "20.0"} 0.0 0.0]`,
                "lavfi.signalstats.YMIN=16",
                `lavfi.signalstats.YMAX=${blank ? 22 : 40}`,
                "lavfi.signalstats.UMIN=100",
                `lavfi.signalstats.UMAX=${blank ? 106 : 110}`,
                "lavfi.signalstats.VMIN=120",
                `lavfi.signalstats.VMAX=${blank ? 126 : 128}`,
                `lavfi.entropy.normalized_entropy.normal.Y=${blank ? "0.01" : "0.1"}`
              ].join("\n")
            };
          }
          return {
            stdout: "",
            stderr: "lavfi.blackframe.pblack=0\nshowinfo stdev:[20.0 0.0 0.0]\nlavfi.entropy.normalized_entropy.normal.Y=0.1"
          };
        }
      });

      expect(artifacts.transitionContent["version-b"]).toEqual({
        sampledFrames: 2,
        samples: [
          { boundaryId: "boundary-01-clip-one-to-clip-two", side: "before", timeSeconds: 0.966666, frameIndex: 29 },
          { boundaryId: "boundary-01-clip-one-to-clip-two", side: "after", timeSeconds: 1.033333, frameIndex: 31 }
        ],
        blankFrames: [{
          boundaryId: "boundary-01-clip-one-to-clip-two",
          side: "after",
          timeSeconds: 1.033333
        }]
      });
    } finally {
      await rm(episodeDir, { recursive: true, force: true });
    }
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

  it("rejects a published generation bound to a different preparation fingerprint", () => {
    const snapshot = validSnapshot();
    (snapshot.generation as { preparationFingerprint: string }).preparationFingerprint = sha("9");

    expect(() => validateGptLiveQaSnapshot(snapshot)).toThrow(/prepar|fingerprint/i);
  });

  it.each([
    ["missing", (artifacts: any[]) => artifacts.slice(1)],
    ["extra", (artifacts: any[]) => [...artifacts, {
      logicalId: "source:unexpected",
      path: "source/unexpected.mp4",
      sha256: sha("8"),
      byteSize: 8
    }]]
  ])("rejects $name prepared artifact coverage hidden behind recomputed metadata", (_name, mutate) => {
    const snapshot = validSnapshot();
    const artifacts = mutate(structuredClone(snapshot.prepared.artifacts) as any[]);
    snapshot.prepared.artifacts = artifacts;
    const forgedFingerprint = createHash("sha256").update(JSON.stringify({
      production: snapshot.production,
      voice: snapshot.voice,
      plan: snapshot.plan,
      sourceMatrix: snapshot.sourceMatrix,
      sourceManifest: snapshot.sourceManifest,
      artifacts
    })).digest("hex");
    snapshot.prepared.manifestFingerprint = forgedFingerprint;
    (snapshot.generation as { preparationFingerprint: string }).preparationFingerprint =
      forgedFingerprint;
    snapshot.postProduction.preparationFingerprint = forgedFingerprint;

    expect(() => validateGptLiveQaSnapshot(snapshot)).toThrow(/prepared artifact|generation/i);
  });

  it("rejects a generation whose validated prepared artifact bytes differ", () => {
    const snapshot = validSnapshot();
    const artifacts = snapshot.generation.preparedArtifacts as Array<
      (typeof snapshot.generation.preparedArtifacts)[number]
    >;
    artifacts[0] = { ...artifacts[0]!, sha256: sha("9") };

    expect(() => validateGptLiveQaSnapshot(snapshot)).toThrow(/prepared artifact|generation/i);
  });

  it.each([
    ["missing", (inspections: any[]) => inspections.slice(1)],
    ["reordered", (inspections: any[]) => [inspections[1], inspections[0], ...inspections.slice(2)]],
    ["extra", (inspections: any[]) => [...inspections, { ...inspections[0] }]],
    ["source-rebound", (inspections: any[]) => [
      { ...inspections[0], sourceId: GPT_LIVE_CONTENT.sources[1]!.id },
      ...inspections.slice(1)
    ]]
  ])("rejects $name prepared evidence inspection coverage", (_name, mutate) => {
    const snapshot = validSnapshot();
    snapshot.prepared.evidenceInspections = mutate(
      structuredClone(snapshot.prepared.evidenceInspections) as any[]
    );
    refreshPreparedFingerprint(snapshot);

    expect(() => validateGptLiveQaSnapshot(snapshot)).toThrow(/evidence inspection/i);
  });

  it("rejects published Tella input lineage that differs from the post-production report", () => {
    const snapshot = validSnapshot();
    const variants = snapshot.generation.variants as Array<
      (typeof snapshot.generation.variants)[number]
    >;
    variants[0] = {
      ...snapshot.generation.variants[0]!,
      inputSha256: sha("9"),
      inputByteSize: snapshot.generation.variants[0]!.inputByteSize + 1
    };

    expect(() => validateGptLiveQaSnapshot(snapshot)).toThrow(/Tella input|generation/i);
  });

  it.each([
    ["missing receipt record", (snapshot: any) => { snapshot.tellaExportReceipt.exports.pop(); }],
    ["extra receipt record", (snapshot: any) => {
      snapshot.tellaExportReceipt.exports.push({ ...snapshot.tellaExportReceipt.exports[1] });
    }],
    ["receipt/report drift", (snapshot: any) => {
      snapshot.postProduction.tellaExports[0].workflowId = "export-video-a-other-job";
    }],
    ["missing fullscreen score", (snapshot: any) => { snapshot.postProduction.sourceFullscreen.pop(); }],
    ["extra fullscreen score", (snapshot: any) => {
      snapshot.postProduction.sourceFullscreen.push({ ...snapshot.postProduction.sourceFullscreen[0] });
    }],
    ["reordered fullscreen scores", (snapshot: any) => {
      snapshot.postProduction.sourceFullscreen.reverse();
    }],
    ["wrong fullscreen version", (snapshot: any) => {
      snapshot.postProduction.sourceFullscreen[0].version = "version-b";
    }],
    ["wrong fullscreen source", (snapshot: any) => {
      snapshot.postProduction.sourceFullscreen[0].clipId = "unexpected";
    }],
    ["tampered fullscreen sample fraction", (snapshot: any) => {
      snapshot.postProduction.sourceFullscreen[0].sampleFraction = 0.2;
    }],
    ["fullscreen score below threshold", (snapshot: any) => {
      snapshot.postProduction.sourceFullscreen[0].ssim = 0.87;
    }],
    ["generation fullscreen drift", (snapshot: any) => {
      snapshot.generation.sourceFullscreen[0].ssim = 0.99;
    }]
  ])("rejects %s in export/fullscreen QA coverage", (_name, mutate) => {
    const snapshot = validSnapshot();
    mutate(snapshot);
    expect(() => validateGptLiveQaSnapshot(snapshot)).toThrow(/receipt|Tella export|fullscreen/i);
  });

  it("rejects a fullscreen score forged identically in both persisted copies", () => {
    const snapshot = validSnapshot();
    (snapshot.postProduction.sourceFullscreen as any[])[0].ssim = 0.91;
    (snapshot.generation.sourceFullscreen as any[])[0].ssim = 0.91;

    expect(() => validateGptLiveQaSnapshot(snapshot)).toThrow(/fresh|measured|fullscreen/i);
  });

  it("rejects fullscreen lineage bound to stale audited remote timing", () => {
    const snapshot = validSnapshot();
    (snapshot.tellaState as any).timelineAudit
      .sourceClips.dynamic_editorial[0].durationMs += 50;
    (snapshot.tellaState as any).timelineAudit
      .sourceClips.dynamic_editorial[1].durationMs -= 50;

    expect(() => validateGptLiveQaSnapshot(snapshot)).toThrow(/fullscreen|timing/i);
  });

  it("revalidates receipt bytes before rejecting changed visual evidence", async () => {
    const harness = await createQaRunHarness();
    const events: string[] = [];
    const validateSealedTellaExports = vi.fn(async () => {
      events.push("receipt");
      return harness.snapshot.tellaExportReceipt;
    });
    const changedVisual = structuredClone(harness.snapshot.observedSourceFullscreen) as any[];
    changedVisual[0] = { ...changedVisual[0]!, ssim: 0.91 };
    const verifySourceFullscreen = vi.fn(async () => {
      events.push("fullscreen");
      return changedVisual;
    });
    const generateVisualArtifacts = vi.fn(harness.dependencies.generateVisualArtifacts!);

    try {
      await expect(runGptLiveQa({
        episodeDir: harness.episodeDir,
        env: harness.snapshot.env,
        ffmpegPath: "ffmpeg",
        ffprobePath: "ffprobe"
      }, {
        ...harness.dependencies,
        validatePublishedGeneration: async () => harness.generation,
        validateSealedTellaExports,
        verifySourceFullscreen,
        generateVisualArtifacts
      } as any)).rejects.toThrow(/fresh|measured|fullscreen/i);

      expect(events).toEqual(["receipt", "fullscreen"]);
      expect(validateSealedTellaExports).toHaveBeenCalledOnce();
      expect(verifySourceFullscreen).toHaveBeenCalledOnce();
      expect(generateVisualArtifacts).not.toHaveBeenCalled();
    } finally {
      await rm(harness.episodeDir, { recursive: true, force: true });
    }
  });

  it("uses narration clip duration rather than a shorter layout for QA timing", async () => {
    const harness = await createQaRunHarness();
    const statePath = join(harness.episodeDir, "tella", "state.json");
    const state = structuredClone(harness.snapshot.tellaState) as any;
    state.timelineAudit.narrationLayouts.dynamic_editorial[0].durationMs -= 50;
    state.timelineAudit.narrationLayouts.aimh_visual_host[0].durationMs -= 25;
    const readSnapshotFile = harness.dependencies.readFile!;
    const verifySourceFullscreen = vi.fn(async (options: any) => {
      const preparedDuration = Math.round(
        harness.snapshot.plan.clips.find((clip) => clip.kind === "narration")!.durationSeconds *
          1_000
      );
      expect(options.timing.narrationDurationMs["version-a"][0])
        .toBe(preparedDuration);
      expect(options.timing.narrationDurationMs["version-b"][0])
        .toBe(preparedDuration);
      throw new Error("captured audited QA fullscreen timing");
    });

    try {
      await expect(runGptLiveQa({
        episodeDir: harness.episodeDir,
        env: harness.snapshot.env,
        ffmpegPath: "ffmpeg",
        ffprobePath: "ffprobe"
      }, {
        ...harness.dependencies,
        readFile: async (path: string, encoding: "utf8") => path === statePath
          ? JSON.stringify(state)
          : readSnapshotFile(path, encoding),
        validatePublishedGeneration: async () => harness.generation,
        verifySourceFullscreen
      } as any)).rejects.toThrow("captured audited QA fullscreen timing");
      expect(verifySourceFullscreen).toHaveBeenCalledOnce();
    } finally {
      await rm(harness.episodeDir, { recursive: true, force: true });
    }
  });

  it("rejects evidence bytes mutated after prepare before generating visual QA artifacts", async () => {
    const harness = await createQaRunHarness();
    const changedInspections = structuredClone(
      harness.snapshot.observedEvidenceInspections
    ) as EvidenceInspection[];
    changedInspections[0] = { ...changedInspections[0]!, sha256: sha("9") };
    const inspectEvidenceAssets = vi.fn(async () => changedInspections);
    const generateVisualArtifacts = vi.fn(harness.dependencies.generateVisualArtifacts!);

    try {
      await expect(runGptLiveQa({
        episodeDir: harness.episodeDir,
        env: harness.snapshot.env,
        ffmpegPath: "ffmpeg",
        ffprobePath: "ffprobe"
      }, {
        ...harness.dependencies,
        validatePublishedGeneration: async () => harness.generation,
        inspectEvidenceAssets,
        generateVisualArtifacts
      })).rejects.toThrow(/evidence inspection|evidence.*hash/i);

      expect(inspectEvidenceAssets).toHaveBeenCalledOnce();
      expect(generateVisualArtifacts).not.toHaveBeenCalled();
    } finally {
      await rm(harness.episodeDir, { recursive: true, force: true });
    }
  });

  it("rejects a Tella export duration outside one 30fps frame of the audited plan", () => {
    const snapshot = validSnapshot();
    snapshot.media.exports["version-a"] = finalInspection(
      snapshot.media.exports["version-a"].durationSeconds + 0.034
    );

    expect(() => validateGptLiveQaSnapshot(snapshot)).toThrow(/Tella|export|30fps frame/i);
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

  it("rejects any report implying that Tella input audio was used", () => {
    const snapshot = validSnapshot();
    (snapshot.postProduction.programAudio as Record<string, unknown>).tellaInputAudioUsed = true;

    expect(() => validateGptLiveQaSnapshot(snapshot)).toThrow(/Tella.*audio|program audio/i);
  });

  it("rejects any serialized program-audio graph implying Tella audio use", () => {
    const snapshot = validSnapshot();
    (snapshot.postProduction.programAudio as Record<string, unknown>).filterGraph =
      "[0:a]anull[program]";

    expect(() => validateGptLiveQaSnapshot(snapshot)).toThrow(/program audio|Tella.*audio/i);
  });

  it("rejects program-audio bindings that differ from publication validation", () => {
    const snapshot = validSnapshot();
    const inputs = (snapshot.postProduction.programAudio as {
      inputs: Array<Record<string, unknown>>;
    }).inputs;
    inputs[0] = { ...inputs[0], sha256: sha("9"), byteSize: 999 };

    expect(() => validateGptLiveQaSnapshot(snapshot)).toThrow(/program audio|generation/i);
  });

  it("rejects QA without a resolved outro path", () => {
    const snapshot = validSnapshot();
    delete snapshot.env.AIMH_OUTRO_MUSIC_PATH;

    expect(() => validateGptLiveQaSnapshot(snapshot)).toThrow(/resolved QA environment/i);
  });

  it("accepts the exact resolved production logo path outside the canonical development checkout", () => {
    const snapshot = validSnapshot();
    const logoPath = "/opt/aimh-video-engine/assets/logo.png";
    snapshot.env.AIMH_LOGO_PATH = logoPath;
    snapshot.production.branding = {
      ...snapshot.production.branding,
      logoPath
    };
    snapshot.logo.path = logoPath;
    refreshPreparedFingerprint(snapshot);

    expect(() => validateGptLiveQaSnapshot(snapshot)).not.toThrow();
    expect(() => validateSerializedQaPaths({
      episodeDir: snapshot.episodeDir,
      env: snapshot.env,
      production: snapshot.production,
      voice: snapshot.voice,
      plan: snapshot.plan,
      generation: snapshot.generation,
      tellaState: snapshot.tellaState,
      postProduction: snapshot.postProduction
    })).not.toThrow();
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
        state.timelineAudit.compatibilityVideoIds.dynamic_editorial = state.masterVideoId;
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
        state.timelineAudit.narrationLayouts.dynamic_editorial[1].sourceId =
          state.sourceIds["plate:dynamic_editorial:narration_hook"];
      }
    },
    {
      name: "variant clip IDs",
      mutate: (state: Record<string, any>) => {
        state.variantClipIds.dynamic_editorial.narration_hook =
          state.variantClipIds.dynamic_editorial.clip_translation;
        state.timelineAudit.orderedClipIds.dynamic_editorial[1] =
          state.variantClipIds.dynamic_editorial.clip_translation;
        state.timelineAudit.narrationLayouts.dynamic_editorial[0].clipId =
          state.variantClipIds.dynamic_editorial.clip_translation;
      }
    },
    {
      name: "layout IDs",
      mutate: (state: Record<string, any>) => {
        state.layoutIds["dynamic_editorial:narration_full_duplex"] =
          state.layoutIds["dynamic_editorial:narration_hook"];
        state.timelineAudit.narrationLayouts.dynamic_editorial[1].layoutId =
          state.layoutIds["dynamic_editorial:narration_hook"];
      }
    }
  ])("rejects duplicate Tella $name", ({ mutate }) => {
    const snapshot = validSnapshot();
    mutate(snapshot.tellaState as Record<string, any>);
    expect(() => validateGptLiveQaSnapshot(snapshot)).toThrow(/unique|distinct|duplicate/i);
  });

  it("requires a serialized Tella timeline audit", () => {
    const snapshot = validSnapshot();
    delete (snapshot.tellaState as Record<string, unknown>).timelineAudit;

    expect(() => validateGptLiveQaSnapshot(snapshot)).toThrow(/timeline audit/i);
  });

  it.each([
    {
      name: "extra top-level key",
      mutate: (audit: Record<string, any>) => { audit.unexpected = true; }
    },
    {
      name: "mismatched compatibility video ID",
      mutate: (audit: Record<string, any>) => {
        audit.compatibilityVideoIds.dynamic_editorial = "different-video";
      }
    },
    {
      name: "shifted clip order",
      mutate: (audit: Record<string, any>) => {
        audit.orderedClipIds.dynamic_editorial.reverse();
      }
    },
    {
      name: "extra clip",
      mutate: (audit: Record<string, any>) => {
        audit.orderedClipIds.aimh_visual_host.push("extra-clip");
      }
    },
    {
      name: "missing queried source clip",
      mutate: (audit: Record<string, any>) => {
        audit.sourceClips.dynamic_editorial.pop();
      }
    },
    {
      name: "reordered queried source clips",
      mutate: (audit: Record<string, any>) => {
        audit.sourceClips.aimh_visual_host.reverse();
      }
    },
    {
      name: "source clip duration outside tolerance",
      mutate: (audit: Record<string, any>) => {
        audit.sourceClips.dynamic_editorial[0].durationMs += 251;
      }
    },
    {
      name: "clip durations that do not reconstruct the story",
      mutate: (audit: Record<string, any>) => {
        audit.sourceClips.dynamic_editorial[0].durationMs += 34;
      }
    },
    {
      name: "shifted narration layout",
      mutate: (audit: Record<string, any>) => {
        audit.narrationLayouts.dynamic_editorial[0].startTimeMs = 1;
      }
    },
    {
      name: "wrong narration source",
      mutate: (audit: Record<string, any>) => {
        audit.narrationLayouts.dynamic_editorial[0].sourceId = "old-plate-source";
      }
    },
    {
      name: "non-hard-cut transition",
      mutate: (audit: Record<string, any>) => {
        audit.narrationLayouts.aimh_visual_host[0].transitionStyle = "dissolve";
      }
    },
    {
      name: "narration duration outside tolerance",
      mutate: (audit: Record<string, any>) => {
        audit.narrationLayouts.aimh_visual_host[0].durationMs += 101;
      }
    },
    {
      name: "narration clip duration outside tolerance",
      mutate: (audit: Record<string, any>) => {
        audit.narrationLayouts.aimh_visual_host[0].clipDurationMs += 2;
      }
    },
    {
      name: "story duration outside one frame",
      mutate: (audit: Record<string, any>) => {
        audit.remoteStoryDurationMs.dynamic_editorial += 34;
      }
    },
    {
      name: "sound effect",
      mutate: (audit: Record<string, any>) => {
        audit.soundEffectIds.dynamic_editorial.push("sound-effect");
      }
    }
  ])("rejects a Tella timeline audit with $name", ({ mutate }) => {
    const snapshot = validSnapshot();
    mutate((snapshot.tellaState as Record<string, any>).timelineAudit);

    expect(() => validateGptLiveQaSnapshot(snapshot)).toThrow(/timeline audit/i);
  });

  it("accepts the documented 100ms narration layout duration tolerance", () => {
    const snapshot = validSnapshot();
    const audit = (snapshot.tellaState as Record<string, any>).timelineAudit;
    audit.narrationLayouts.dynamic_editorial[0].durationMs += 100;
    const refreshedFullscreen = deriveSourceFullscreenExpectations(
      snapshot.plan,
      buildSourceFullscreenTiming(snapshot.tellaExportReceipt, audit)
    ).map((sample) => ({
      ...sample,
      ssim: 0.93,
      threshold: SOURCE_FULLSCREEN_SSIM_THRESHOLD
    }));
    snapshot.postProduction.sourceFullscreen = structuredClone(refreshedFullscreen);
    (snapshot.generation as any).sourceFullscreen = structuredClone(refreshedFullscreen);
    snapshot.observedSourceFullscreen = structuredClone(refreshedFullscreen);

    expect(() => validateGptLiveQaSnapshot(snapshot)).not.toThrow();
  });

  it("builds and validates the exact timeline audit from queried Tella state maps", () => {
    const snapshot = validSnapshot();
    const state = snapshot.tellaState as TellaStateForTimelineAudit & Record<string, any>;
    const expected = structuredClone(state.timelineAudit) as TellaTimelineAudit;
    const audit = buildTellaTimelineAudit({
      plan: snapshot.plan,
      state,
      remoteStoryDurationMs: expected.remoteStoryDurationMs,
      narrationClipDurationMs: Object.fromEntries(
        GPT_LIVE_CONTENT.variants.map((variant) => [
          variant,
          Object.fromEntries(
            snapshot.plan.clips.filter((clip) => clip.kind === "narration").map((clip, index) => [
              clip.id,
              expected.narrationLayouts[variant][index]!.clipDurationMs
            ])
          )
        ])
      ) as Record<(typeof GPT_LIVE_CONTENT.variants)[number], Record<string, number>>,
      narrationLayoutDurationMs: Object.fromEntries(
        GPT_LIVE_CONTENT.variants.map((variant) => [
          variant,
          Object.fromEntries(
            snapshot.plan.clips.filter((clip) => clip.kind === "narration").map((clip, index) => [
              clip.id,
              expected.narrationLayouts[variant][index]!.durationMs
            ])
          )
        ])
      ) as Record<(typeof GPT_LIVE_CONTENT.variants)[number], Record<string, number>>,
      sourceClipDurationMs: Object.fromEntries(
        GPT_LIVE_CONTENT.variants.map((variant) => [
          variant,
          Object.fromEntries(snapshot.plan.clips
            .filter((clip) => clip.kind === "source_clip")
            .map((clip, index) => [clip.id, expected.sourceClips[variant][index]!.durationMs]))
        ])
      ) as Record<(typeof GPT_LIVE_CONTENT.variants)[number], Record<string, number>>
    });

    expect(audit).toEqual(expected);
    expect(validateTellaTimelineAudit(snapshot.plan, { ...state, timelineAudit: audit }))
      .toEqual(expected);
  });

  it("preserves queried remote narration layout durations in the built audit", () => {
    const snapshot = validSnapshot();
    const state = snapshot.tellaState as TellaStateForTimelineAudit;
    const narrationLayoutDurationMs = Object.fromEntries(
      GPT_LIVE_CONTENT.variants.map((variant) => [
        variant,
        Object.fromEntries(
          snapshot.plan.clips.filter((clip) => clip.kind === "narration").map((clip) => [
            clip.id,
            Math.round(clip.durationSeconds * 1_000) - 50
          ])
        )
      ])
    ) as Record<(typeof GPT_LIVE_CONTENT.variants)[number], Record<string, number>>;
    const audit = buildTellaTimelineAudit({
      plan: snapshot.plan,
      state,
      remoteStoryDurationMs: {
        dynamic_editorial: 129_310,
        aimh_visual_host: 129_310
      },
      narrationClipDurationMs: Object.fromEntries(
        GPT_LIVE_CONTENT.variants.map((variant) => [
          variant,
          Object.fromEntries(snapshot.plan.clips
            .filter((clip) => clip.kind === "narration")
            .map((clip) => [clip.id, Math.round(clip.durationSeconds * 1_000)]))
        ])
      ) as Record<(typeof GPT_LIVE_CONTENT.variants)[number], Record<string, number>>,
      narrationLayoutDurationMs,
      sourceClipDurationMs: Object.fromEntries(
        GPT_LIVE_CONTENT.variants.map((variant) => [
          variant,
          Object.fromEntries(snapshot.plan.clips
            .filter((clip) => clip.kind === "source_clip")
            .map((clip) => [clip.id, Math.round(clip.durationSeconds * 1_000)]))
        ])
      ) as Record<(typeof GPT_LIVE_CONTENT.variants)[number], Record<string, number>>
    });

    expect(audit.narrationLayouts.dynamic_editorial.map(({ durationMs }) => durationMs))
      .toEqual(Object.values(narrationLayoutDurationMs.dynamic_editorial));
  });

  it("keeps queried narration clip and shorter layout durations distinct", () => {
    const snapshot = validSnapshot();
    const state = snapshot.tellaState as TellaStateForTimelineAudit;
    const narrationClips = snapshot.plan.clips.filter((clip) => clip.kind === "narration");
    const sourceClips = snapshot.plan.clips.filter((clip) => clip.kind === "source_clip");
    const narrationClipDurationMs = Object.fromEntries(
      GPT_LIVE_CONTENT.variants.map((variant) => [
        variant,
        Object.fromEntries(narrationClips.map((clip) => [
          clip.id,
          Math.floor(clip.durationSeconds * 1_000)
        ]))
      ])
    ) as Record<(typeof GPT_LIVE_CONTENT.variants)[number], Record<string, number>>;
    const narrationLayoutDurationMs = Object.fromEntries(
      GPT_LIVE_CONTENT.variants.map((variant) => [
        variant,
        Object.fromEntries(narrationClips.map((clip, index) => [
          clip.id,
          Math.floor(clip.durationSeconds * 1_000) - (index % 2 === 0 ? 50 : 0)
        ]))
      ])
    ) as Record<(typeof GPT_LIVE_CONTENT.variants)[number], Record<string, number>>;
    const sourceClipDurationMs = Object.fromEntries(
      GPT_LIVE_CONTENT.variants.map((variant) => [
        variant,
        Object.fromEntries(sourceClips.map((clip) => [
          clip.id,
          Math.floor(clip.durationSeconds * 1_000)
        ]))
      ])
    ) as Record<(typeof GPT_LIVE_CONTENT.variants)[number], Record<string, number>>;
    const remoteStoryDurationMs = Object.fromEntries(
      GPT_LIVE_CONTENT.variants.map((variant) => [
        variant,
        Object.values(narrationClipDurationMs[variant]).reduce((total, value) => total + value, 0) +
          Object.values(sourceClipDurationMs[variant]).reduce((total, value) => total + value, 0)
      ])
    ) as Record<(typeof GPT_LIVE_CONTENT.variants)[number], number>;

    const audit = buildTellaTimelineAudit({
      plan: snapshot.plan,
      state,
      remoteStoryDurationMs,
      narrationClipDurationMs,
      narrationLayoutDurationMs,
      sourceClipDurationMs
    } as any);

    expect(audit.narrationLayouts.dynamic_editorial.map((layout) => ({
      clipDurationMs: (layout as any).clipDurationMs,
      durationMs: layout.durationMs
    }))).toEqual(narrationClips.map((clip, index) => ({
      clipDurationMs: Math.floor(clip.durationSeconds * 1_000),
      durationMs: Math.floor(clip.durationSeconds * 1_000) - (index % 2 === 0 ? 50 : 0)
    })));
    expect(validateTellaTimelineAudit(snapshot.plan, { ...state, timelineAudit: audit }))
      .toEqual(audit);
  });

  it("rejects a remote URL nested in the timeline audit", () => {
    const snapshot = validSnapshot();
    const audit = (snapshot.tellaState as Record<string, any>).timelineAudit;
    audit.compatibilityVideoIds.dynamic_editorial = "https://tella.example/video/signed";

    expect(() => validateGptLiveQaSnapshot(snapshot)).toThrow(/remote URL|non-URL ID/i);
  });

  it.each([
    "ftp://tella.example/video",
    "data:text/plain,secret",
    "file:///private/export.mp4",
    "//tella.example/video",
    " https://tella.example/video"
  ])("rejects unsafe timeline audit identifier %s", (unsafeId) => {
    const snapshot = validSnapshot();
    const audit = (snapshot.tellaState as Record<string, any>).timelineAudit;
    audit.compatibilityVideoIds.dynamic_editorial = unsafeId;

    expect(() => validateGptLiveQaSnapshot(snapshot)).toThrow(/remote URL|non-URL ID/i);
  });

  it.each(["variantClipIds", "layoutIds", "sourceIds"])(
    "rejects an extra Tella state ID in %s at the pure audit boundary",
    (mapName) => {
      const snapshot = validSnapshot();
      const state = structuredClone(snapshot.tellaState) as Record<string, any>;
      if (mapName === "variantClipIds") {
        state.variantClipIds.dynamic_editorial.extra_clip = "extra-clip-id";
      } else {
        state[mapName].extra_key = `extra-${mapName}-id`;
      }

      expect(() => validateTellaTimelineAudit(snapshot.plan, state)).toThrow(/timeline audit/i);
    }
  );

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

  it("rejects a shifted timeline audit before QA media or audio probes", async () => {
    const harness = await createQaRunHarness();
    const statePath = join(harness.episodeDir, "tella", "state.json");
    const state = structuredClone(harness.snapshot.tellaState) as Record<string, any>;
    state.timelineAudit.orderedClipIds.dynamic_editorial.reverse();
    const originalReadFile = harness.dependencies.readFile!;
    const inspectMediaFile = vi.fn(harness.dependencies.inspectMediaFile!);
    const inspectFinalMediaFile = vi.fn(harness.dependencies.inspectFinalMediaFile!);
    const runCommand = vi.fn(harness.dependencies.runCommand!);

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
          validatePublishedGeneration: async () => harness.generation,
          readFile: async (path, encoding) => path === statePath
            ? JSON.stringify(state)
            : originalReadFile(path, encoding),
          inspectMediaFile,
          inspectFinalMediaFile,
          runCommand
        }
      )).rejects.toThrow(/timeline audit|clip order/i);

      expect(inspectMediaFile).not.toHaveBeenCalled();
      expect(inspectFinalMediaFile).not.toHaveBeenCalled();
      expect(runCommand).not.toHaveBeenCalled();
    } finally {
      await rm(harness.episodeDir, { recursive: true, force: true });
    }
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

  it.each([
    {
      name: "prepared fingerprint",
      mutate: (generation: PublishedGenerationValidation) => ({
        ...generation,
        preparationFingerprint: sha("9")
      })
    },
    {
      name: "prepared artifact hash",
      mutate: (generation: PublishedGenerationValidation) => ({
        ...generation,
        preparedArtifacts: generation.preparedArtifacts.map((artifact, index) => index === 0
          ? { ...artifact, sha256: sha("9") }
          : artifact)
      })
    },
    {
      name: "Tella input hash",
      mutate: (generation: PublishedGenerationValidation) => ({
          ...generation,
          variants: generation.variants.map((variant, index) => index === 0
            ? { ...variant, inputSha256: sha("9"), inputByteSize: variant.inputByteSize + 1 }
            : variant)
        })
    },
    {
      name: "program audio hash",
      mutate: (generation: PublishedGenerationValidation) => ({
        ...generation,
        programAudio: generation.programAudio.map((input, index) => index === 0
          ? { ...input, sha256: sha("9"), byteSize: input.byteSize + 1 }
          : input)
      })
    }
  ])("aborts when the $name changes before QA publication", async ({ mutate }) => {
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
            currentGeneration = mutate(harness.generation as any) as typeof currentGeneration;
            await writeFile(path, `${JSON.stringify(value, null, 2)}\n`, "utf8");
          }
        }
      )).rejects.toThrow(/generation.*changed|changed.*generation/i);
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
      expect(report.schemaVersion).toBe("0.2.0");
      expect(report.generation.sourceFullscreen).toHaveLength(12);
      expect(report.generation).toEqual({
        generationId: harness.generation.generationId,
        preparationFingerprint: harness.generation.preparationFingerprint,
        variants: harness.generation.variants,
        programAudio: harness.generation.programAudio,
        tellaExports: harness.generation.tellaExports,
        sourceFullscreen: harness.generation.sourceFullscreen
      });
      expect(report.checks.preparedEvidenceIntegrity).toBe(true);
      expect(report.evidenceInspections).toEqual(
        harness.snapshot.observedEvidenceInspections
      );
      expect(report.evidenceInspections.map(({ evidenceId }: EvidenceInspection) => evidenceId))
        .toEqual(
          GPT_LIVE_CONTENT.evidence
            .filter((evidence) => evidence.playbackDecision === "captured_source")
            .map(({ id }) => id)
        );
      expect(report.evidenceOriginLimitation).toMatch(
        /not cryptographic URL origin.*browser capture.*human review.*trust boundaries/i
      );
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
        transitionContent: {
          "version-a": {
            sampledFrames: 16,
            samples: transitionSampleRecords(validSnapshot().plan.clips),
            blankFrames: []
          },
          "version-b": {
            sampledFrames: 16,
            samples: transitionSampleRecords(validSnapshot().plan.clips),
            blankFrames: []
          }
        },
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
    expect(comparison).toContain(
      "Both compatibility outputs use the same evidence-editorial treatment"
    );
    expect(comparison).toContain("boundary content checks passed");
    expect(comparison).toContain("outro-only tail signal does not prove CTA completion");
    expect(comparison).not.toMatch(/visual[- ]host|host usefulness/i);
    expect(comparison).not.toContain("Music is present");
    expect(comparison).toContain(
      "No intro or body music is mixed because program audio is reconstructed from audited source and narration assets."
    );
    expect(comparison).toContain("Subjective clarity still requires full real-time playback.");
    expect(comparison).toContain("Full real-time listening");
  });

  it("rejects QA when a transition boundary sample is blank", async () => {
    const harness = await createQaRunHarness();
    try {
      harness.artifacts.transitionContent["version-b"] = {
        sampledFrames: 16,
        samples: harness.artifacts.transitionContent["version-b"].samples,
        blankFrames: [{
          boundaryId: "boundary-01-narration-hook-to-clip-translation",
          side: "after",
          timeSeconds: 15.033333
        }]
      };
      await expect(runGptLiveQa(
        { episodeDir: harness.episodeDir, env: harness.snapshot.env, ffmpegPath: "ffmpeg", ffprobePath: "ffprobe" },
        { ...harness.dependencies, validatePublishedGeneration: async () => harness.generation }
      )).rejects.toThrow(/transition.*blank|blank.*transition/i);
    } finally {
      await rm(harness.episodeDir, { recursive: true, force: true });
    }
  });

  it("rejects QA unless each variant samples exactly twice per interior boundary", async () => {
    const harness = await createQaRunHarness();
    try {
      harness.artifacts.transitionContent["version-a"].sampledFrames = 15;
      await expect(runGptLiveQa(
        { episodeDir: harness.episodeDir, env: harness.snapshot.env, ffmpegPath: "ffmpeg", ffprobePath: "ffprobe" },
        { ...harness.dependencies, validatePublishedGeneration: async () => harness.generation }
      )).rejects.toThrow(/expected 16 transition.*samples|transition.*received 15/i);
    } finally {
      await rm(harness.episodeDir, { recursive: true, force: true });
    }
  });

  it("rejects QA when transition sample identities are duplicated", async () => {
    const harness = await createQaRunHarness();
    try {
      const samples = harness.artifacts.transitionContent["version-a"].samples;
      samples[1] = { ...samples[0]! };
      await expect(runGptLiveQa(
        { episodeDir: harness.episodeDir, env: harness.snapshot.env, ffmpegPath: "ffmpeg", ffprobePath: "ffprobe" },
        { ...harness.dependencies, validatePublishedGeneration: async () => harness.generation }
      )).rejects.toThrow(/duplicate.*boundary|unique.*boundary|sample identit/i);
    } finally {
      await rm(harness.episodeDir, { recursive: true, force: true });
    }
  });

  it("rejects QA when boundary sides resolve to the same 30fps frame", async () => {
      const harness = await createQaRunHarness();
    try {
      const samples = harness.artifacts.transitionContent["version-a"].samples;
      samples[1] = {
        ...samples[1]!,
        timeSeconds: samples[0]!.timeSeconds,
        frameIndex: samples[0]!.frameIndex
      };
      await expect(runGptLiveQa(
        { episodeDir: harness.episodeDir, env: harness.snapshot.env, ffmpegPath: "ffmpeg", ffprobePath: "ffprobe" },
        { ...harness.dependencies, validatePublishedGeneration: async () => harness.generation }
      )).rejects.toThrow(/distinct 30fps frames|same 30fps frame/i);
    } finally {
      await rm(harness.episodeDir, { recursive: true, force: true });
    }
  });

  it("rejects QA when sample records replace a planned boundary ID", async () => {
    const harness = await createQaRunHarness();
    try {
      const samples = harness.artifacts.transitionContent["version-a"].samples;
      samples[0] = { ...samples[0]!, boundaryId: "boundary-01-fake-to-boundary" };
      samples[1] = { ...samples[1]!, boundaryId: "boundary-01-fake-to-boundary" };
      await expect(runGptLiveQa(
        { episodeDir: harness.episodeDir, env: harness.snapshot.env, ffmpegPath: "ffmpeg", ffprobePath: "ffprobe" },
        { ...harness.dependencies, validatePublishedGeneration: async () => harness.generation }
      )).rejects.toThrow(/unexpected.*boundary|planned boundary|boundary identit/i);
    } finally {
      await rm(harness.episodeDir, { recursive: true, force: true });
    }
  });

  it("rejects QA when a reported frame index disagrees with its seek time", async () => {
    const harness = await createQaRunHarness();
    try {
      const samples = harness.artifacts.transitionContent["version-a"].samples;
      samples[1] = { ...samples[1]!, timeSeconds: samples[0]!.timeSeconds };
      await expect(runGptLiveQa(
        { episodeDir: harness.episodeDir, env: harness.snapshot.env, ffmpegPath: "ffmpeg", ffprobePath: "ffprobe" },
        { ...harness.dependencies, validatePublishedGeneration: async () => harness.generation }
      )).rejects.toThrow(/frame index.*seek time|seek time.*frame index|reported frame index/i);
    } finally {
      await rm(harness.episodeDir, { recursive: true, force: true });
    }
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

  it.each([
    "ftp://signed.example/video",
    "data:text/plain,secret",
    "file:///private/export.mp4",
    "//signed.example/video",
    " https://signed.example/video"
  ])("rejects a nested unsafe Tella state URI %s", (unsafeUri) => {
    const snapshot = validSnapshot();
    (snapshot.tellaState as Record<string, unknown>).remoteReference = unsafeUri;
    expect(() => validateGptLiveQaSnapshot(snapshot)).toThrow(/presigned or remote URL/i);
  });

  it("rejects a final without tail signal", () => {
    const snapshot = validSnapshot();
    snapshot.tailAudio["version-a"].endPeakDb = Number.NEGATIVE_INFINITY;
    snapshot.tailAudio["version-a"].tailSignalPresent = false;
    expect(() => validateGptLiveQaSnapshot(snapshot)).toThrow(/tail signal/i);
  });
});
