import { createHash } from "node:crypto";
import {
  lstat as defaultLstat,
  mkdir as defaultMkdir,
  mkdtemp as defaultMkdtemp,
  readFile as defaultReadFile,
  realpath as defaultRealpath,
  rm as defaultRm,
  stat as defaultStat
} from "node:fs/promises";
import { join, relative, sep } from "node:path";
import { runCommand as defaultRunCommand } from "../../render/process";
import { writeJsonAtomic as defaultWriteJsonAtomic, writeTextAtomic as defaultWriteTextAtomic } from "./atomicFiles";
import { GPT_LIVE_CONTENT } from "./content";
import {
  inspectFinalMediaFile as defaultInspectFinalMediaFile,
  validatePublishedGeneration as defaultValidatePublishedGeneration,
  type FinalMediaInspection,
  type PublishedGenerationValidation
} from "./finish";
import { GPT_LIVE_SCENES, sceneStyle } from "./motion/sceneStyle";
import type { TellaPlan } from "./tellaPlan";
import type {
  GptLiveQaResult,
  GptLiveQaSnapshot,
  QaProduction,
  QaPreparedMediaInspection,
  QaTailAudioCheck,
  QaVariantName,
  QaVoice,
  QaVoiceCacheMetadata,
  HumanPlayback,
  VisualArtifacts
} from "./qa/types";
import { validateGptLiveQaSnapshot } from "./qa/validation";
import { generateVisualArtifacts, renderComparisonMarkdown } from "./qa/visual";
import { publishQaReportSet } from "./qa/publication";
import { validateNoSymlinkPaths, withValidatedQaArtifactPaths } from "./qa/paths";

export { validateGptLiveQaSnapshot } from "./qa/validation";
export type {
  GptLiveQaResult,
  GptLiveQaSnapshot,
  QaProduction,
  QaPreparedMediaInspection,
  QaSafeArea,
  QaTailAudioCheck,
  QaVariantName,
  QaVoice,
  QaVoiceCacheMetadata,
  VisualArtifacts
} from "./qa/types";

const VARIANTS = ["version-a", "version-b"] as const;
const PLATE_VARIANTS = ["dynamic_editorial", "aimh_visual_host"] as const;

export const qaReportPaths = (episodeDir: string) => {
  const reportsDirectory = join(episodeDir, "reports");
  const visualDirectory = join(reportsDirectory, "visual");
  return {
    reportPath: join(reportsDirectory, "qa.json"),
    comparisonPath: join(reportsDirectory, "comparison.md"),
    staleComparisonPath: join(visualDirectory, "comparison.md"),
    visualDirectory
  };
};

export async function clearStaleQaOutputs(
  episodeDir: string,
  remove: (path: string, options: { force: true }) => Promise<void> =
    (path, options) => defaultRm(path, options)
): Promise<void> {
  const paths = qaReportPaths(episodeDir);
  for (const path of [paths.reportPath, paths.comparisonPath, paths.staleComparisonPath]) {
    await remove(path, { force: true });
  }
}

export interface RunGptLiveQaOptions {
  episodeDir: string;
  env: Record<string, string | undefined>;
  ffmpegPath: string;
  ffprobePath: string;
}

type ReadText = (path: string, encoding: "utf8") => Promise<string>;
type ReadBytes = (path: string) => Promise<Uint8Array>;
type StatFile = (path: string) => Promise<{ isFile(): boolean; size: number }>;

export interface RunGptLiveQaDependencies {
  validatePublishedGeneration?: (episodeDir: string) => Promise<PublishedGenerationValidation>;
  readFile?: ReadText;
  readFileBytes?: ReadBytes;
  stat?: StatFile;
  mkdir?: typeof defaultMkdir;
  mkdtemp?: typeof defaultMkdtemp;
  lstat?: typeof defaultLstat;
  realpath?: typeof defaultRealpath;
  rm?: typeof defaultRm;
  runCommand?: typeof defaultRunCommand;
  inspectMediaFile?: (ffprobePath: string, path: string) => Promise<QaPreparedMediaInspection>;
  inspectFinalMediaFile?: (ffprobePath: string, path: string) => Promise<FinalMediaInspection>;
  generateVisualArtifacts?: typeof generateVisualArtifacts;
  writeJsonAtomic?: typeof defaultWriteJsonAtomic;
  writeTextAtomic?: typeof defaultWriteTextAtomic;
}

const parseJson = <T>(text: string, label: string): T => {
  try {
    return JSON.parse(text) as T;
  } catch {
    throw new Error(`GPT-Live QA failed: invalid ${label} JSON`);
  }
};

const relativePath = (episodeDir: string, path: string): string =>
  relative(episodeDir, path).split(sep).join("/");

const assertSafeReportText = (text: string, label: string): void => {
  if (
    text.includes("/Users/") ||
    /(?:uploadUrl|signedUrl|X-Amz-|[?&](?:signature|token|expires)=)/i.test(text)
  ) {
    throw new Error(`GPT-Live QA failed: ${label} contains an unsafe path or signed URL`);
  }
};

const PENDING_PLAYBACK_NOTE = "Full real-time listening and viewing is required before upload.";

export function parseHumanPlaybackReview(text: string | undefined): HumanPlayback {
  if (text === undefined) return { status: "pending", note: PENDING_PLAYBACK_NOTE };
  const parsed = parseJson<Record<string, unknown>>(text, "human playback review");
  if (
    parsed.schemaVersion !== "0.1.0" ||
    (parsed.status !== "pending" && parsed.status !== "passed" && parsed.status !== "failed") ||
    typeof parsed.note !== "string" ||
    !parsed.note.trim() ||
    parsed.note.length > 500
  ) {
    throw new Error("GPT-Live QA failed: invalid human playback review");
  }
  assertSafeReportText(parsed.note, "human playback review");
  return { status: parsed.status, note: parsed.note } as HumanPlayback;
}

export function deriveQaStatus(humanPlayback: HumanPlayback) {
  const readyForUpload = humanPlayback.status === "passed";
  return { machineOk: true as const, humanPlayback, readyForUpload, ok: readyForUpload };
}

const parsePeakDb = (text: string): number => {
  const value = text.match(/max_volume:\s*(-?(?:\d+(?:\.\d+)?|inf))\s*dB/i)?.[1];
  if (!value || value.toLowerCase() === "-inf") return Number.NEGATIVE_INFINITY;
  return Number(value);
};

const inspectPreparedMediaFile = async (
  ffprobePath: string,
  path: string,
  runCommand: typeof defaultRunCommand
): Promise<QaPreparedMediaInspection> => {
  const result = await runCommand(ffprobePath, [
    "-v", "error",
    "-show_entries",
    "stream=codec_type,codec_name,width,height,r_frame_rate,pix_fmt,sample_rate,channels:format=duration",
    "-of", "json",
    path
  ]);
  const parsed = parseJson<{
    streams: Array<Record<string, unknown>>;
    format: { duration: string };
  }>(result.stdout, "prepared media inspection");
  const video = parsed.streams.find((stream) => stream.codec_type === "video");
  const audio = parsed.streams.find((stream) => stream.codec_type === "audio");
  const [numerator, denominator = "1"] = String(video?.r_frame_rate).split("/");
  if (!video) throw new Error("GPT-Live QA failed: prepared media video stream is missing");
  return {
    durationSeconds: Number(parsed.format.duration),
    video: {
      codecName: String(video.codec_name ?? ""),
      width: Number(video.width),
      height: Number(video.height),
      framesPerSecond: Number(numerator) / Number(denominator),
      pixelFormat: String(video.pix_fmt ?? "")
    },
    ...(audio ? {
      audio: {
        codecName: String(audio.codec_name ?? ""),
        sampleRate: Number(audio.sample_rate),
        channels: Number(audio.channels)
      }
    } : {})
  };
};

const inspectTailAudio = async (
  ffmpegPath: string,
  finalPath: string,
  runCommand: typeof defaultRunCommand
): Promise<QaTailAudioCheck> => {
  const measure = async (secondsFromEnd: number): Promise<number> => {
    const result = await runCommand(ffmpegPath, [
      "-hide_banner",
      "-nostats",
      "-sseof",
      `-${secondsFromEnd}`,
      "-i",
      finalPath,
      "-vn",
      "-af",
      "volumedetect",
      "-f",
      "null",
      "-"
    ]);
    return parsePeakDb(`${result.stdout}\n${result.stderr}`);
  };
  return {
    tailPeakDb: await measure(10),
    endPeakDb: await measure(0.5),
    tailSignalPresent: true
  };
};

const readOptionalJson = async <T>(
  path: string,
  label: string,
  readFile: ReadText
): Promise<T | null> => {
  try {
    return parseJson<T>(await readFile(path, "utf8"), label);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return null;
    throw error;
  }
};

const collectFilePresence = async (
  paths: readonly string[],
  stat: StatFile
): Promise<Record<string, boolean>> => {
  const entries = await Promise.all(
    [...new Set(paths)].map(async (path) => {
      try {
        const file = await stat(path);
        return [path, file.isFile() && file.size > 0] as const;
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code === "ENOENT") return [path, false] as const;
        throw error;
      }
    })
  );
  return Object.fromEntries(entries);
};

const collectSnapshot = async (
  options: RunGptLiveQaOptions,
  generation: PublishedGenerationValidation,
  dependencies: Required<Pick<
    RunGptLiveQaDependencies,
    "readFile" | "readFileBytes" | "stat" | "runCommand" | "inspectMediaFile" | "inspectFinalMediaFile" | "lstat" | "realpath"
  >>
): Promise<GptLiveQaSnapshot> => {
  const productionPath = join(options.episodeDir, "production.json");
  const voicePath = join(options.episodeDir, "voice", "narration.json");
  const planPath = join(options.episodeDir, "tella", "plan.json");
  const statePath = join(options.episodeDir, "tella", "state.json");
  const preparedPath = join(options.episodeDir, "reports", "prepared.json");
  const sourceMatrixPath = join(options.episodeDir, "reports", "source-matrix.md");
  const humanPlaybackPath = join(options.episodeDir, "reports", "human-playback.json");

  await validateNoSymlinkPaths(options.episodeDir, [
    productionPath,
    voicePath,
    planPath,
    statePath,
    generation.reportPath,
    preparedPath,
    sourceMatrixPath,
    humanPlaybackPath
  ], dependencies);

  const [productionText, voiceText, planText, stateText, postText, preparedText, sourceMatrix] =
    await Promise.all([
      dependencies.readFile(productionPath, "utf8"),
      dependencies.readFile(voicePath, "utf8"),
      dependencies.readFile(planPath, "utf8"),
      dependencies.readFile(statePath, "utf8"),
      dependencies.readFile(generation.reportPath, "utf8"),
      dependencies.readFile(preparedPath, "utf8"),
      dependencies.readFile(sourceMatrixPath, "utf8")
    ]);
  const production = parseJson<QaProduction>(productionText, "production manifest");
  const voice = parseJson<QaVoice>(voiceText, "voice manifest");
  const plan = parseJson<TellaPlan>(planText, "Tella plan");
  const tellaState = parseJson<unknown>(stateText, "Tella state");
  const postProduction = parseJson<Record<string, unknown>>(postText, "post-production report");
  const prepared = parseJson<Record<string, unknown>>(preparedText, "prepared report");

  await withValidatedQaArtifactPaths({
    episodeDir: options.episodeDir,
    production,
    voice,
    plan,
    generation,
    tellaState,
    postProduction
  }, dependencies, async () => undefined);
  const logoStat = await dependencies.lstat(production.branding.logoPath);
  if (logoStat.isSymbolicLink()) throw new Error("GPT-Live QA path contains a symlink: logo");

  const voiceCacheEntries = await Promise.all(
    voice.chunks.map(async (chunk) => [
      chunk.id,
      await readOptionalJson<QaVoiceCacheMetadata>(
        `${chunk.file}.json`,
        `voice cache provenance ${chunk.id}`,
        dependencies.readFile
      )
    ] as const)
  );
  const expectedPaths = [
    ...voice.chunks.flatMap((chunk) => [chunk.file, `${chunk.file}.json`]),
    ...plan.clips.flatMap((clip) =>
      clip.kind === "source_clip"
        ? [clip.mediaPath]
        : [
            clip.masterPath,
            ...Object.values(clip.variants).flatMap((variant) => [
              variant.platePath,
              variant.narrationAudioPath
            ])
          ]
    ),
    ...generation.finalPaths
  ];
  const filePresence = await collectFilePresence(expectedPaths, dependencies.stat);

  const sourceClips = GPT_LIVE_CONTENT.timeline.filter((item) => item.kind === "source_clip");
  const sourceInspections = await Promise.all(
    sourceClips.map(async (clip) => [
      clip.id,
      await dependencies.inspectMediaFile(
        options.ffprobePath,
        join(options.episodeDir, "source", `${clip.id}.mp4`)
      )
    ] as const)
  );
  const narrationClips = plan.clips.filter((clip) => clip.kind === "narration");
  const masterInspections = await Promise.all(
    narrationClips.map(async (clip) => [
      clip.id,
      await dependencies.inspectMediaFile(options.ffprobePath, clip.masterPath)
    ] as const)
  );
  const plateInspections = await Promise.all(
    narrationClips.flatMap((clip) =>
      PLATE_VARIANTS.map(async (variant) => [
        `${variant}:${clip.id}`,
        await dependencies.inspectMediaFile(options.ffprobePath, clip.variants[variant].platePath)
      ] as const)
    )
  );
  const finals = await Promise.all(
    generation.finalPaths.map((path) => dependencies.inspectFinalMediaFile(options.ffprobePath, path))
  );
  const tailAudio = await Promise.all(
    generation.finalPaths.map((path) => inspectTailAudio(options.ffmpegPath, path, dependencies.runCommand))
  );
  const logoBytes = await dependencies.readFileBytes(production.branding.logoPath);
  const sourceHashEntries = await Promise.all(sourceClips.map(async (clip) => [
    clip.id,
    createHash("sha256").update(
      await dependencies.readFileBytes(join(options.episodeDir, "source", `${clip.id}.mp4`))
    ).digest("hex")
  ] as const));
  const voiceHashEntries = await Promise.all(voice.chunks.map(async (chunk) => [
    chunk.id,
    createHash("sha256").update(await dependencies.readFileBytes(chunk.file)).digest("hex")
  ] as const));

  return {
    episodeDir: options.episodeDir,
    env: options.env,
    generation,
    production,
    sourceMatrix,
    prepared,
    voice,
    voiceCacheMetadata: Object.fromEntries(voiceCacheEntries),
    plan,
    tellaState,
    postProduction,
    logo: {
      path: production.branding.logoPath,
      sha256: createHash("sha256").update(logoBytes).digest("hex")
    },
    filePresence,
    media: {
      sources: Object.fromEntries(sourceInspections),
      masters: Object.fromEntries(masterInspections),
      plates: Object.fromEntries(plateInspections),
      finals: {
        "version-a": finals[0]!,
        "version-b": finals[1]!
      }
    },
    safeAreas: PLATE_VARIANTS.flatMap((variant) =>
      GPT_LIVE_SCENES.map((scene) => ({
        variant,
        scene,
        ...sceneStyle(variant, scene).reservedTopRight
      }))
    ),
    tailAudio: {
      "version-a": tailAudio[0]!,
      "version-b": tailAudio[1]!
    },
    observedIntegrityHashes: {
      sources: Object.fromEntries(sourceHashEntries),
      voice: Object.fromEntries(voiceHashEntries)
    }
  };
};

const postSourceIntervals = (snapshot: GptLiveQaSnapshot) => {
  const sourceDialogue = snapshot.postProduction.sourceDialogue as {
    intervals: Array<{ outputLufsA: number; outputLufsB: number }>;
  };
  return sourceDialogue.intervals;
};

const buildSafeQaReport = (
  snapshot: GptLiveQaSnapshot,
  artifacts: VisualArtifacts,
  humanPlayback: HumanPlayback
) => {
  const variants = snapshot.postProduction.variants as Array<{
    name: QaVariantName;
    outputPath: string;
    sha256: string;
  }>;
  const status = deriveQaStatus(humanPlayback);
  return {
    schemaVersion: "0.1.0",
    ...status,
    productionId: GPT_LIVE_CONTENT.id,
    generationId: snapshot.generation.generationId,
    youtubeUploadEnabled: false,
    checks: {
      editorialAndSourceCoverage: true,
      clipAndVoiceProvenance: true,
      mediaStreamContracts: true,
      tellaPlanAndState: true,
      finalGenerationIntegrity: true,
      brandingAndSafeArea: true,
      audioTreatmentAndTailSignal: true,
      sampledFramesNonblank: true
    },
    finals: VARIANTS.map((name) => {
      const variant = variants.find((item) => item.name === name)!;
      return {
        name,
        path: variant.outputPath,
        sha256: variant.sha256,
        durationSeconds: snapshot.media.finals[name].durationSeconds
      };
    }),
    visual: artifacts,
    comparisonPath: "reports/comparison.md",
    tailSignalPresent: true,
    tailSignalLimitation: "Music is present; tail signal cannot prove CTA narration or exclude speech truncation.",
    observedIntegrityHashes: {
      label: "Observed SHA-256 hashes from this QA run; these are integrity evidence, not cryptographic origin proof.",
      sources: Object.entries(snapshot.observedIntegrityHashes.sources).map(([id, sha256]) => ({
        id,
        path: `source/${id}.mp4`,
        sha256
      })),
      voice: Object.entries(snapshot.observedIntegrityHashes.voice).map(([id, sha256]) => ({
        id,
        path: `voice/${id}.mp3`,
        sha256
      }))
    }
  };
};

export async function runGptLiveQa(
  options: RunGptLiveQaOptions,
  dependencies: RunGptLiveQaDependencies = {}
): Promise<GptLiveQaResult> {
  const validatePublishedGeneration = dependencies.validatePublishedGeneration ??
    defaultValidatePublishedGeneration;
  const readFile = dependencies.readFile ?? (defaultReadFile as ReadText);
  const readFileBytes = dependencies.readFileBytes ??
    ((path: string) => defaultReadFile(path) as Promise<Uint8Array>);
  const stat = dependencies.stat ?? defaultStat;
  const mkdir = dependencies.mkdir ?? defaultMkdir;
  const mkdtemp = dependencies.mkdtemp ?? defaultMkdtemp;
  const lstat = dependencies.lstat ?? defaultLstat;
  const realpath = dependencies.realpath ?? defaultRealpath;
  const rm = dependencies.rm ?? defaultRm;
  const runCommand = dependencies.runCommand ?? defaultRunCommand;
  const inspectMediaFile = dependencies.inspectMediaFile ??
    ((ffprobePath: string, path: string) => inspectPreparedMediaFile(ffprobePath, path, runCommand));
  const inspectFinalMediaFile = dependencies.inspectFinalMediaFile ??
    ((ffprobePath: string, path: string) => defaultInspectFinalMediaFile(ffprobePath, path, runCommand));
  const generateArtifacts = dependencies.generateVisualArtifacts ?? generateVisualArtifacts;
  const writeJsonAtomic = dependencies.writeJsonAtomic ?? defaultWriteJsonAtomic;
  const writeTextAtomic = dependencies.writeTextAtomic ?? defaultWriteTextAtomic;
  const paths = qaReportPaths(options.episodeDir);

  let generation: PublishedGenerationValidation;
  generation = await validatePublishedGeneration(options.episodeDir);

  const snapshot = await collectSnapshot(options, generation, {
    readFile,
    readFileBytes,
    stat,
    runCommand,
    inspectMediaFile,
    inspectFinalMediaFile,
    lstat,
    realpath
  });
  validateGptLiveQaSnapshot(snapshot);

  let humanPlaybackText: string | undefined;
  try {
    humanPlaybackText = await readFile(join(options.episodeDir, "reports", "human-playback.json"), "utf8");
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
  }
  const humanPlayback = parseHumanPlaybackReview(humanPlaybackText);
  const status = deriveQaStatus(humanPlayback);

  const stagingDirectory = await mkdtemp(join(options.episodeDir, "reports", ".qa-staging-"));
  const stagingVisualDirectory = join(stagingDirectory, "visual");
  await mkdir(stagingVisualDirectory, { recursive: true });
  const visualArtifacts = await generateArtifacts({
    episodeDir: options.episodeDir,
    finalPaths: {
      "version-a": generation.finalPaths[0],
      "version-b": generation.finalPaths[1]
    },
    durations: {
      "version-a": snapshot.media.finals["version-a"].durationSeconds,
      "version-b": snapshot.media.finals["version-b"].durationSeconds
    },
    plan: snapshot.plan,
    ffmpegPath: options.ffmpegPath,
    outputDirectory: stagingVisualDirectory,
    artifactRelativeRoot: "reports/visual"
  }, { runCommand });
  if (visualArtifacts.checkedFrameCount !== 58) {
    throw new Error(`GPT-Live QA failed: expected 58 checked frames, received ${visualArtifacts.checkedFrameCount}`);
  }

  const sourceIntervals = snapshot.postProduction.duckIntervals as Array<{
    startSeconds: number;
    endSeconds: number;
  }>;
  const comparison = renderComparisonMarkdown({
    artifacts: visualArtifacts,
    durations: {
      "version-a": snapshot.media.finals["version-a"].durationSeconds,
      "version-b": snapshot.media.finals["version-b"].durationSeconds
    },
    durationDeltaSeconds: Math.abs(
      snapshot.media.finals["version-a"].durationSeconds -
      snapshot.media.finals["version-b"].durationSeconds
    ),
    sourceIntervals,
    sourceOutputLufs: postSourceIntervals(snapshot)
  });
  assertSafeReportText(comparison, "visual comparison");
  await writeTextAtomic(join(stagingDirectory, "comparison.md"), comparison);

  const report = buildSafeQaReport(snapshot, visualArtifacts, humanPlayback);
  const reportText = `${JSON.stringify(report, null, 2)}\n`;
  assertSafeReportText(reportText, "QA report");
  await writeJsonAtomic(join(stagingDirectory, "qa.json"), report);
  await publishQaReportSet({ stagingDirectory, paths });

  return {
    episodeDir: options.episodeDir,
    ...status,
    reportPath: paths.reportPath,
    comparisonPath: paths.comparisonPath,
    visualDirectory: paths.visualDirectory,
    visualArtifacts
  };
}
