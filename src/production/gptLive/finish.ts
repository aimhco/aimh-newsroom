import { randomUUID as defaultRandomUUID } from "node:crypto";
import {
  access as defaultAccess,
  constants,
  mkdir as defaultMkdir,
  readFile as defaultReadFile,
  rename as defaultRename,
  rm as defaultRm
} from "node:fs/promises";
import { basename, join } from "node:path";
import { runCommand as defaultRunCommand } from "../../render/process";
import { writeJsonAtomic as defaultWriteJsonAtomic } from "./atomicFiles";

const NORMAL_MUSIC_VOLUME = 0.07;
const DUCKED_MUSIC_VOLUME = 0.02;
const DIALOGUE_VOLUME = 1;
const DURATION_TOLERANCE_SECONDS = 0.25;
const VARIANT_DURATION_TOLERANCE_SECONDS = 0.5;
const FRAME_RATE_TOLERANCE = 0.001;

export interface FinishPlanClip {
  readonly id: string;
  readonly kind: "source_clip" | "narration";
  readonly durationSeconds: number;
}

export interface FinishPlan {
  readonly schemaVersion: "0.1.0";
  readonly productionId: string;
  readonly clips: readonly FinishPlanClip[];
}

export interface DuckInterval {
  readonly startSeconds: number;
  readonly endSeconds: number;
}

export interface FinalMediaInspection {
  readonly durationSeconds: number;
  readonly video: {
    readonly codecName: string;
    readonly width: number;
    readonly height: number;
    readonly framesPerSecond: number;
  };
  readonly audio: {
    readonly codecName: string;
    readonly sampleRate: number;
    readonly channels: number;
  };
}

export interface BuildFinishFfmpegArgsOptions {
  readonly inputPath: string;
  readonly logoPath: string;
  readonly musicPath: string;
  readonly outputPath: string;
  readonly durationSeconds: number;
  readonly duckIntervals: readonly DuckInterval[];
}

export interface PostProductionVariant {
  readonly name: "version-a" | "version-b";
  readonly inputPath: string;
  readonly outputPath: string;
  readonly inputDurationSeconds: number;
  readonly outputDurationSeconds: number;
}

export interface BuildPostProductionManifestOptions {
  readonly productionId: string;
  readonly logoPath: string;
  readonly musicPath: string;
  readonly duckIntervals: readonly DuckInterval[];
  readonly variants: readonly PostProductionVariant[];
}

export interface FinishGptLiveProductionOptions {
  readonly episodeDir: string;
  readonly env: Record<string, string>;
  readonly ffmpegPath: string;
  readonly ffprobePath: string;
}

export interface FinishGptLiveProductionResult {
  readonly episodeDir: string;
  readonly finalPaths: readonly [string, string];
  readonly reportPath: string;
  readonly manifest: ReturnType<typeof buildPostProductionManifest>;
}

type ReadText = (path: string, encoding: "utf8") => Promise<string>;
type InspectFinalMediaFile = (
  ffprobePath: string,
  file: string
) => Promise<FinalMediaInspection>;

export interface FinishGptLiveDependencies {
  readonly access?: typeof defaultAccess;
  readonly inspectFinalMediaFile?: InspectFinalMediaFile;
  readonly mkdir?: typeof defaultMkdir;
  readonly randomUUID?: typeof defaultRandomUUID;
  readonly readFile?: ReadText;
  readonly rename?: typeof defaultRename;
  readonly rm?: typeof defaultRm;
  readonly runCommand?: typeof defaultRunCommand;
  readonly writeJsonAtomic?: typeof defaultWriteJsonAtomic;
}

interface ProbeStream {
  readonly codec_type?: unknown;
  readonly codec_name?: unknown;
  readonly width?: unknown;
  readonly height?: unknown;
  readonly r_frame_rate?: unknown;
  readonly sample_rate?: unknown;
  readonly channels?: unknown;
}

const fixedSeconds = (seconds: number): string => seconds.toFixed(3);

const roundedSeconds = (seconds: number): number => Number(seconds.toFixed(6));

const requirePositiveDuration = (durationSeconds: number, label: string): void => {
  if (!Number.isFinite(durationSeconds) || durationSeconds <= 0) {
    throw new Error(`Invalid ${label} duration`);
  }
};

const requireConfiguredValue = (value: string | undefined, label: string): string => {
  if (!value?.trim()) throw new Error(`Missing ${label}`);
  return value;
};

export function buildLogoFilter(): string {
  return "[1:v]scale=150:-1,format=rgba,colorchannelmixer=aa=0.85[lg];[0:v][lg]overlay=W-w-24:24";
}

export function deriveSourceDuckIntervals(plan: FinishPlan): DuckInterval[] {
  let cursorSeconds = 0;
  const intervals: DuckInterval[] = [];

  for (const clip of plan.clips) {
    requirePositiveDuration(clip.durationSeconds, `timeline clip ${clip.id}`);
    const startSeconds = roundedSeconds(cursorSeconds);
    cursorSeconds += clip.durationSeconds;
    if (clip.kind === "source_clip") {
      intervals.push({
        startSeconds,
        endSeconds: roundedSeconds(cursorSeconds)
      });
    }
  }

  return intervals;
}

export function buildMusicVolumeExpression(intervals: readonly DuckInterval[]): string {
  if (intervals.length === 0) return NORMAL_MUSIC_VOLUME.toFixed(3);
  const condition = intervals
    .map(
      ({ startSeconds, endSeconds }) =>
        `between(t,${fixedSeconds(startSeconds)},${fixedSeconds(endSeconds)})`
    )
    .join("+");
  return `if(${condition},${DUCKED_MUSIC_VOLUME.toFixed(3)},${NORMAL_MUSIC_VOLUME.toFixed(3)})`;
}

export function buildFinishFilterGraph(intervals: readonly DuckInterval[]): string {
  const volumeExpression = buildMusicVolumeExpression(intervals);
  return [
    `${buildLogoFilter()}[vout]`,
    `[0:a]volume=${DIALOGUE_VOLUME.toFixed(1)}[dialogue]`,
    `[2:a]volume='${volumeExpression}':eval=frame[music]`,
    "[dialogue][music]amix=inputs=2:duration=first:dropout_transition=0:normalize=0,alimiter=limit=0.95[aout]"
  ].join(";");
}

export function buildFinishFfmpegArgs(options: BuildFinishFfmpegArgsOptions): string[] {
  requirePositiveDuration(options.durationSeconds, "input video");
  return [
    "-y",
    "-i",
    options.inputPath,
    "-i",
    options.logoPath,
    "-stream_loop",
    "-1",
    "-i",
    options.musicPath,
    "-filter_complex",
    buildFinishFilterGraph(options.duckIntervals),
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
    fixedSeconds(options.durationSeconds),
    "-movflags",
    "+faststart",
    options.outputPath
  ];
}

const frameRate = (value: unknown): number => {
  if (typeof value !== "string") return Number.NaN;
  const [numeratorText, denominatorText = "1"] = value.split("/");
  const numerator = Number(numeratorText);
  const denominator = Number(denominatorText);
  return denominator === 0 ? Number.NaN : numerator / denominator;
};

export const buildFinalFfprobeArgs = (file: string): string[] => [
  "-v",
  "error",
  "-show_entries",
  "stream=codec_type,codec_name,width,height,r_frame_rate,sample_rate,channels:format=duration",
  "-of",
  "json",
  file
];

export function parseFinalFfprobeJson(text: string): FinalMediaInspection {
  let parsed: { readonly streams?: unknown; readonly format?: { readonly duration?: unknown } };
  try {
    parsed = JSON.parse(text) as typeof parsed;
  } catch {
    throw new Error("Invalid final ffprobe JSON");
  }
  if (!Array.isArray(parsed.streams)) throw new Error("Invalid final ffprobe streams");

  const streams = parsed.streams as ProbeStream[];
  const video = streams.find((stream) => stream.codec_type === "video");
  const audio = streams.find((stream) => stream.codec_type === "audio");
  const inspection: FinalMediaInspection = {
    durationSeconds: Number(parsed.format?.duration),
    video: {
      codecName: typeof video?.codec_name === "string" ? video.codec_name : "",
      width: Number(video?.width),
      height: Number(video?.height),
      framesPerSecond: frameRate(video?.r_frame_rate)
    },
    audio: {
      codecName: typeof audio?.codec_name === "string" ? audio.codec_name : "",
      sampleRate: Number(audio?.sample_rate),
      channels: Number(audio?.channels)
    }
  };

  if (
    !video ||
    !audio ||
    !Number.isFinite(inspection.durationSeconds) ||
    !Number.isFinite(inspection.video.width) ||
    !Number.isFinite(inspection.video.height) ||
    !Number.isFinite(inspection.video.framesPerSecond) ||
    !Number.isFinite(inspection.audio.sampleRate) ||
    !Number.isFinite(inspection.audio.channels)
  ) {
    throw new Error("Invalid final ffprobe values");
  }
  return inspection;
}

export async function inspectFinalMediaFile(
  ffprobePath: string,
  file: string,
  runCommand: typeof defaultRunCommand = defaultRunCommand
): Promise<FinalMediaInspection> {
  const result = await runCommand(ffprobePath, buildFinalFfprobeArgs(file));
  return parseFinalFfprobeJson(result.stdout);
}

export function assertFinalMediaContract(
  inspection: FinalMediaInspection,
  inputDurationSeconds: number
): void {
  if (inspection.video.codecName !== "h264") throw new Error("Final must use H.264 video");
  if (inspection.video.width !== 1920 || inspection.video.height !== 1080) {
    throw new Error("Final must be 1920x1080");
  }
  if (Math.abs(inspection.video.framesPerSecond - 30) > FRAME_RATE_TOLERANCE) {
    throw new Error("Final must be 30fps");
  }
  if (inspection.audio.codecName !== "aac") throw new Error("Final must use AAC audio");
  if (inspection.audio.sampleRate !== 48_000) throw new Error("Final audio must be 48kHz");
  if (inspection.audio.channels !== 2) throw new Error("Final audio must be stereo");
  if (
    !Number.isFinite(inspection.durationSeconds) ||
    Math.abs(inspection.durationSeconds - inputDurationSeconds) > DURATION_TOLERANCE_SECONDS
  ) {
    throw new Error(
      `Final duration mismatch: input ${inputDurationSeconds.toFixed(3)}s, output ${inspection.durationSeconds.toFixed(3)}s`
    );
  }
}

export function assertVariantDurationParity(
  versionADurationSeconds: number,
  versionBDurationSeconds: number
): void {
  const delta = Math.abs(versionADurationSeconds - versionBDurationSeconds);
  if (!Number.isFinite(delta) || delta > VARIANT_DURATION_TOLERANCE_SECONDS) {
    throw new Error(`A/B duration delta exceeds 0.500s: ${delta.toFixed(3)}s`);
  }
}

const safeVariantPath = (directory: "exports" | "final", file: string): string =>
  `${directory}/${basename(file)}`;

export function buildPostProductionManifest(options: BuildPostProductionManifestOptions) {
  return {
    schemaVersion: "0.1.0" as const,
    status: "finished" as const,
    productionId: options.productionId,
    assets: {
      logo: basename(options.logoPath),
      music: basename(options.musicPath)
    },
    duckIntervals: options.duckIntervals.map(({ startSeconds, endSeconds }) => ({
      startSeconds,
      endSeconds
    })),
    settings: {
      logoFilter: buildLogoFilter(),
      dialogueVolume: DIALOGUE_VOLUME,
      normalMusicVolume: NORMAL_MUSIC_VOLUME,
      duckedMusicVolume: DUCKED_MUSIC_VOLUME,
      musicLoop: true,
      audioMixDuration: "first" as const,
      videoCodec: "libx264" as const,
      crf: 18,
      preset: "medium" as const,
      pixelFormat: "yuv420p" as const,
      framesPerSecond: 30,
      audioCodec: "aac" as const,
      audioBitrate: "192k" as const,
      audioSampleRate: 48_000,
      audioChannels: 2,
      faststart: true,
      durationToleranceSeconds: DURATION_TOLERANCE_SECONDS,
      variantDurationToleranceSeconds: VARIANT_DURATION_TOLERANCE_SECONDS
    },
    variants: options.variants.map((variant) => ({
      name: variant.name,
      inputPath: safeVariantPath("exports", variant.inputPath),
      outputPath: safeVariantPath("final", variant.outputPath),
      inputDurationSeconds: variant.inputDurationSeconds,
      outputDurationSeconds: variant.outputDurationSeconds
    }))
  };
}

export function parseFinishPlan(text: string): FinishPlan {
  let value: unknown;
  try {
    value = JSON.parse(text);
  } catch {
    throw new Error("Invalid Tella plan JSON");
  }
  if (!value || typeof value !== "object") throw new Error("Invalid Tella plan");
  const candidate = value as Partial<FinishPlan>;
  if (
    candidate.schemaVersion !== "0.1.0" ||
    typeof candidate.productionId !== "string" ||
    !candidate.productionId ||
    !Array.isArray(candidate.clips) ||
    candidate.clips.length === 0
  ) {
    throw new Error("Invalid Tella plan");
  }
  for (const clip of candidate.clips) {
    if (
      !clip ||
      typeof clip.id !== "string" ||
      !clip.id ||
      (clip.kind !== "source_clip" && clip.kind !== "narration")
    ) {
      throw new Error("Invalid Tella plan clip");
    }
    requirePositiveDuration(clip.durationSeconds, `timeline clip ${clip.id}`);
  }
  return candidate as FinishPlan;
}

interface Promotion {
  readonly stagedPath: string;
  readonly targetPath: string;
  readonly backupPath: string;
}

const isMissingPathError = (error: unknown): boolean =>
  (error as NodeJS.ErrnoException).code === "ENOENT";

const promoteFilesAtomically = async (
  promotions: readonly Promotion[],
  rename: typeof defaultRename,
  rm: typeof defaultRm
): Promise<void> => {
  const backedUp: Promotion[] = [];
  const promoted: Promotion[] = [];
  try {
    for (const promotion of promotions) {
      await rm(promotion.backupPath, { force: true });
      try {
        await rename(promotion.targetPath, promotion.backupPath);
        backedUp.push(promotion);
      } catch (error) {
        if (!isMissingPathError(error)) throw error;
      }
    }
    for (const promotion of promotions) {
      await rename(promotion.stagedPath, promotion.targetPath);
      promoted.push(promotion);
    }
  } catch (error) {
    for (const promotion of promoted.reverse()) {
      await rm(promotion.targetPath, { force: true });
    }
    for (const promotion of backedUp.reverse()) {
      await rename(promotion.backupPath, promotion.targetPath);
    }
    throw error;
  }

  for (const promotion of backedUp) {
    await rm(promotion.backupPath, { force: true });
  }
};

export async function finishGptLiveProduction(
  options: FinishGptLiveProductionOptions,
  dependencies: FinishGptLiveDependencies = {}
): Promise<FinishGptLiveProductionResult> {
  const access = dependencies.access ?? defaultAccess;
  const mkdir = dependencies.mkdir ?? defaultMkdir;
  const randomUUID = dependencies.randomUUID ?? defaultRandomUUID;
  const readFile = dependencies.readFile ?? (defaultReadFile as ReadText);
  const rename = dependencies.rename ?? defaultRename;
  const rm = dependencies.rm ?? defaultRm;
  const runCommand = dependencies.runCommand ?? defaultRunCommand;
  const writeJsonAtomic = dependencies.writeJsonAtomic ?? defaultWriteJsonAtomic;
  const inspect = dependencies.inspectFinalMediaFile ??
    ((ffprobePath: string, file: string) => inspectFinalMediaFile(ffprobePath, file));

  const ffmpegPath = requireConfiguredValue(options.ffmpegPath, "ffmpeg path");
  const ffprobePath = requireConfiguredValue(options.ffprobePath, "ffprobe path");
  const logoPath = requireConfiguredValue(options.env.AIMH_LOGO_PATH, "AIMH logo path");
  const musicPath = requireConfiguredValue(
    options.env.AIMH_BODY_MUSIC_PATH,
    "AIMH body music path"
  );
  try {
    await access(logoPath, constants.R_OK);
  } catch {
    throw new Error("GPT-Live finish preflight failed: AIMH logo is not readable");
  }
  try {
    await access(musicPath, constants.R_OK);
  } catch {
    throw new Error("GPT-Live finish preflight failed: AIMH body music is not readable");
  }

  const planPath = join(options.episodeDir, "tella", "plan.json");
  const plan = parseFinishPlan(await readFile(planPath, "utf8"));
  const duckIntervals = deriveSourceDuckIntervals(plan);
  const finalDirectory = join(options.episodeDir, "final");
  const reportsDirectory = join(options.episodeDir, "reports");
  await mkdir(finalDirectory, { recursive: true });
  await mkdir(reportsDirectory, { recursive: true });

  const transactionId = randomUUID();
  const definitions = [
    {
      name: "version-a" as const,
      inputPath: join(options.episodeDir, "exports", "tella-a.mp4"),
      outputPath: join(finalDirectory, "version-a.mp4")
    },
    {
      name: "version-b" as const,
      inputPath: join(options.episodeDir, "exports", "tella-b.mp4"),
      outputPath: join(finalDirectory, "version-b.mp4")
    }
  ];
  const stagedPaths = definitions.map((definition) =>
    join(finalDirectory, `${definition.name}.tmp-${transactionId}.mp4`)
  );
  const reportPath = join(reportsDirectory, "post-production.json");
  const stagedReportPath = join(reportsDirectory, `post-production.tmp-${transactionId}.json`);
  const temporaryPaths = [...stagedPaths, stagedReportPath];
  const backupPaths = [
    ...definitions.map((definition) => `${definition.outputPath}.backup-${transactionId}`),
    `${reportPath}.backup-${transactionId}`
  ];

  try {
    const inputInspections = await Promise.all(
      definitions.map((definition) => inspect(ffprobePath, definition.inputPath))
    );
    for (const inspection of inputInspections) {
      requirePositiveDuration(inspection.durationSeconds, "Tella export");
    }

    for (const [index, definition] of definitions.entries()) {
      await runCommand(
        ffmpegPath,
        buildFinishFfmpegArgs({
          inputPath: definition.inputPath,
          logoPath,
          musicPath,
          outputPath: stagedPaths[index]!,
          durationSeconds: inputInspections[index]!.durationSeconds,
          duckIntervals
        })
      );
    }

    const outputInspections = await Promise.all(
      stagedPaths.map((path) => inspect(ffprobePath, path))
    );
    for (const [index, inspection] of outputInspections.entries()) {
      assertFinalMediaContract(inspection, inputInspections[index]!.durationSeconds);
    }
    assertVariantDurationParity(
      outputInspections[0]!.durationSeconds,
      outputInspections[1]!.durationSeconds
    );

    const variants: PostProductionVariant[] = definitions.map((definition, index) => ({
      ...definition,
      inputDurationSeconds: inputInspections[index]!.durationSeconds,
      outputDurationSeconds: outputInspections[index]!.durationSeconds
    }));
    const manifest = buildPostProductionManifest({
      productionId: plan.productionId,
      logoPath,
      musicPath,
      duckIntervals,
      variants
    });
    await writeJsonAtomic(stagedReportPath, manifest);

    const promotions: Promotion[] = [
      ...definitions.map((definition, index) => ({
        stagedPath: stagedPaths[index]!,
        targetPath: definition.outputPath,
        backupPath: backupPaths[index]!
      })),
      {
        stagedPath: stagedReportPath,
        targetPath: reportPath,
        backupPath: backupPaths[2]!
      }
    ];
    await promoteFilesAtomically(promotions, rename, rm);

    return {
      episodeDir: options.episodeDir,
      finalPaths: [definitions[0]!.outputPath, definitions[1]!.outputPath],
      reportPath,
      manifest
    };
  } finally {
    await Promise.all(temporaryPaths.map((path) => rm(path, { force: true })));
  }
}
