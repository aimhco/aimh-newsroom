import { createHash, randomUUID as defaultRandomUUID } from "node:crypto";
import {
  access as defaultAccess,
  constants,
  copyFile as defaultCopyFile,
  lstat as defaultLstat,
  mkdir as defaultMkdir,
  readFile as defaultReadFile,
  realpath as defaultRealpath,
  rename as defaultRename,
  rm as defaultRm
} from "node:fs/promises";
import { basename, join, relative, resolve, sep } from "node:path";
import { runCommand as defaultRunCommand } from "../../render/process";
import { writeJsonAtomic as defaultWriteJsonAtomic } from "./atomicFiles";
import { validateContainedEpisodePaths } from "./qa/paths";

const NORMAL_MUSIC_VOLUME = 0.07;
const DUCKED_MUSIC_VOLUME = 0.02;
const DIALOGUE_VOLUME = 1;
const DURATION_TOLERANCE_SECONDS = 0.25;
const VARIANT_DURATION_TOLERANCE_SECONDS = 0.5;
const FRAME_RATE_TOLERANCE = 0.001;
const AUDIO_DURATION_TOLERANCE_SECONDS = 0.05;
const AUDIO_BITRATE_TARGET = 192_000;
const AUDIO_BITRATE_TOLERANCE = 32_000;
const SOURCE_TARGET_LUFS = -23;
const SOURCE_GAIN_CLAMP_DB = 12;
const SOURCE_LOUDNESS_TOLERANCE_LU = 2;
const GAIN_RAMP_SECONDS = 0.1;

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

export interface SourceIntervalGain extends DuckInterval {
  readonly measuredLufsA: number;
  readonly measuredLufsB: number;
  readonly averageMeasuredLufs: number;
  readonly targetLufs: number;
  readonly gainDb: number;
}

export interface SourceIntervalResult extends SourceIntervalGain {
  readonly outputLufsA: number;
  readonly outputLufsB: number;
}

export interface LogoEvidence {
  readonly name: "version-a" | "version-b";
  readonly samples: readonly {
    readonly timeSeconds: number;
    readonly inputSha256: string;
    readonly outputSha256: string;
  }[];
}

export interface FinalMediaInspection {
  readonly durationSeconds: number;
  readonly video: {
    readonly codecName: string;
    readonly width: number;
    readonly height: number;
    readonly framesPerSecond: number;
    readonly durationSeconds: number;
    readonly pixelFormat: string;
    readonly colorSpace: string;
    readonly colorTransfer: string;
    readonly colorPrimaries: string;
  };
  readonly audio: {
    readonly codecName: string;
    readonly sampleRate: number;
    readonly channels: number;
    readonly durationSeconds: number;
    readonly bitRate: number;
  };
}

export interface BuildFinishFfmpegArgsOptions {
  readonly inputPath: string;
  readonly logoPath: string;
  readonly musicPath: string;
  readonly outputPath: string;
  readonly durationSeconds: number;
  readonly duckIntervals: readonly DuckInterval[];
  readonly sourceGains: readonly SourceIntervalGain[];
}

export interface PostProductionVariant {
  readonly name: "version-a" | "version-b";
  readonly inputPath: string;
  readonly outputPath: string;
  readonly inputDurationSeconds: number;
  readonly outputDurationSeconds: number;
  readonly sha256: string;
  readonly byteSize: number;
}

export interface BuildPostProductionManifestOptions {
  readonly productionId: string;
  readonly generationId: string;
  readonly logoPath: string;
  readonly musicPath: string;
  readonly logoSha256: string;
  readonly duckIntervals: readonly DuckInterval[];
  readonly sourceGains: readonly SourceIntervalResult[];
  readonly logoEvidence: readonly LogoEvidence[];
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
  readonly cleanupWarnings: readonly string[];
}

export interface PublishedGenerationPaths {
  readonly episodeDir: string;
  readonly finalPaths?: readonly [string, string];
  readonly reportPath?: string;
}

export interface PublishedGenerationValidation {
  readonly generationId: string;
  readonly variants: readonly {
    readonly name: "version-a" | "version-b";
    readonly sha256: string;
    readonly byteSize: number;
  }[];
  readonly finalPaths: readonly [string, string];
  readonly reportPath: string;
}

type ReadText = (path: string, encoding: "utf8") => Promise<string>;
type InspectFinalMediaFile = (
  ffprobePath: string,
  file: string
) => Promise<FinalMediaInspection>;
type MeasureIntervalLoudness = (
  ffmpegPath: string,
  file: string,
  interval: DuckInterval
) => Promise<number>;
type SampleLogoCornerFrameHash = (
  ffmpegPath: string,
  file: string,
  timeSeconds: number
) => Promise<string>;
type ReadBytes = (path: string) => Promise<Uint8Array>;
type ValidatePublishedGeneration = (
  input: string | PublishedGenerationPaths
) => Promise<PublishedGenerationValidation>;
interface PathStat {
  isDirectory(): boolean;
  isSymbolicLink(): boolean;
}
type Lstat = (path: string) => Promise<PathStat>;
type Realpath = (path: string) => Promise<string>;

export interface FinishGptLiveDependencies {
  readonly access?: typeof defaultAccess;
  readonly copyFile?: typeof defaultCopyFile;
  readonly inspectFinalMediaFile?: InspectFinalMediaFile;
  readonly lstat?: Lstat;
  readonly measureIntervalLoudness?: MeasureIntervalLoudness;
  readonly mkdir?: typeof defaultMkdir;
  readonly randomUUID?: typeof defaultRandomUUID;
  readonly readFile?: ReadText;
  readonly readFileBytes?: ReadBytes;
  readonly realpath?: Realpath;
  readonly rename?: typeof defaultRename;
  readonly rm?: typeof defaultRm;
  readonly runCommand?: typeof defaultRunCommand;
  readonly sampleLogoCornerFrameHash?: SampleLogoCornerFrameHash;
  readonly validatePublishedGeneration?: ValidatePublishedGeneration;
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
  readonly duration?: unknown;
  readonly bit_rate?: unknown;
  readonly pix_fmt?: unknown;
  readonly color_space?: unknown;
  readonly color_transfer?: unknown;
  readonly color_primaries?: unknown;
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

const validateContainedPaths = async (
  episodeDir: string,
  candidates: readonly string[],
  lstat: Lstat,
  realpath: Realpath
): Promise<void> => {
  await validateContainedEpisodePaths(episodeDir, candidates, {
    lstat,
    realpath,
    context: "GPT-Live finish"
  });
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

const clamp = (value: number, minimum: number, maximum: number): number =>
  Math.min(maximum, Math.max(minimum, value));

export function deriveSharedSourceGains(
  intervals: readonly DuckInterval[],
  measurementsA: readonly number[],
  measurementsB: readonly number[]
): SourceIntervalGain[] {
  if (measurementsA.length !== intervals.length || measurementsB.length !== intervals.length) {
    throw new Error("Source loudness measurement count mismatch");
  }
  return intervals.map((interval, index) => {
    const measuredLufsA = measurementsA[index]!;
    const measuredLufsB = measurementsB[index]!;
    if (!Number.isFinite(measuredLufsA) || !Number.isFinite(measuredLufsB)) {
      throw new Error("Invalid source loudness measurement");
    }
    const averageMeasuredLufs = roundedSeconds((measuredLufsA + measuredLufsB) / 2);
    return {
      ...interval,
      measuredLufsA,
      measuredLufsB,
      averageMeasuredLufs,
      targetLufs: SOURCE_TARGET_LUFS,
      gainDb: roundedSeconds(
        clamp(SOURCE_TARGET_LUFS - averageMeasuredLufs, -SOURCE_GAIN_CLAMP_DB, SOURCE_GAIN_CLAMP_DB)
      )
    };
  });
}

const musicIntervalExpression = ({ startSeconds, endSeconds }: DuckInterval): string => {
  const rampStart = Math.max(0, startSeconds - GAIN_RAMP_SECONDS);
  const rampEnd = endSeconds + GAIN_RAMP_SECONDS;
  const afterRamp =
    `if(between(t,${fixedSeconds(endSeconds)},${fixedSeconds(rampEnd)}),` +
    `${DUCKED_MUSIC_VOLUME.toFixed(3)}+(${NORMAL_MUSIC_VOLUME.toFixed(3)}-${DUCKED_MUSIC_VOLUME.toFixed(3)})*` +
    `(t-${fixedSeconds(endSeconds)})/${GAIN_RAMP_SECONDS.toFixed(3)},${NORMAL_MUSIC_VOLUME.toFixed(3)})`;
  const beforeRamp = startSeconds > 0
    ? `if(between(t,${fixedSeconds(rampStart)},${fixedSeconds(startSeconds)}),` +
      `${NORMAL_MUSIC_VOLUME.toFixed(3)}+(${DUCKED_MUSIC_VOLUME.toFixed(3)}-${NORMAL_MUSIC_VOLUME.toFixed(3)})*` +
      `(t-${fixedSeconds(rampStart)})/${GAIN_RAMP_SECONDS.toFixed(3)},${afterRamp})`
    : afterRamp;
  return `if(between(t,${fixedSeconds(startSeconds)},${fixedSeconds(endSeconds)}),${DUCKED_MUSIC_VOLUME.toFixed(3)},${beforeRamp})`;
};

export function buildMusicVolumeExpression(intervals: readonly DuckInterval[]): string {
  if (intervals.length === 0) return NORMAL_MUSIC_VOLUME.toFixed(3);
  return intervals
    .map(musicIntervalExpression)
    .reduce((combined, expression) => `min(${combined},${expression})`);
}

export function buildSourceDialogueGainExpression(
  sourceGains: readonly SourceIntervalGain[]
): string {
  if (sourceGains.length === 0) return DIALOGUE_VOLUME.toFixed(6);
  return sourceGains
    .map(({ startSeconds, endSeconds, gainDb }) => {
      const factor = 10 ** (gainDb / 20);
      const rampSeconds = Math.min(GAIN_RAMP_SECONDS, (endSeconds - startSeconds) / 2);
      const rampInEnd = startSeconds + rampSeconds;
      const rampOutStart = endSeconds - rampSeconds;
      const factorText = factor.toFixed(6);
      const unity = DIALOGUE_VOLUME.toFixed(6);
      return `if(between(t,${fixedSeconds(startSeconds)},${fixedSeconds(endSeconds)}),` +
        `if(lt(t,${fixedSeconds(rampInEnd)}),${unity}+(${factorText}-${unity})*` +
        `(t-${fixedSeconds(startSeconds)})/${fixedSeconds(rampSeconds)},` +
        `if(gt(t,${fixedSeconds(rampOutStart)}),${unity}+(${factorText}-${unity})*` +
        `(${fixedSeconds(endSeconds)}-t)/${fixedSeconds(rampSeconds)},${factorText})),${unity})`;
    })
    .join("*");
}

export function buildFinishFilterGraph(
  durationSeconds: number,
  intervals: readonly DuckInterval[],
  sourceGains: readonly SourceIntervalGain[]
): string {
  const volumeExpression = buildMusicVolumeExpression(intervals);
  const dialogueGainExpression = buildSourceDialogueGainExpression(sourceGains);
  const duration = fixedSeconds(durationSeconds);
  return [
    `${buildLogoFilter()}[vout]`,
    `[0:a]apad=whole_dur=${duration},atrim=duration=${duration},asetpts=PTS-STARTPTS,` +
      `volume='${dialogueGainExpression}':eval=frame[dialogue]`,
    `[2:a]volume='${volumeExpression}':eval=frame,atrim=duration=${duration},` +
      "asetpts=PTS-STARTPTS[music]",
    `[dialogue][music]amix=inputs=2:duration=longest:dropout_transition=0:normalize=0,` +
      `alimiter=limit=0.95:attack=5:release=50:level=false:latency=true,` +
      `atrim=duration=${duration},asetpts=PTS-STARTPTS[aout]`
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
    buildFinishFilterGraph(options.durationSeconds, options.duckIntervals, options.sourceGains),
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

export const buildLoudnessMeasurementArgs = (
  file: string,
  interval: DuckInterval
): string[] => [
  "-hide_banner",
  "-nostats",
  "-ss",
  fixedSeconds(interval.startSeconds),
  "-t",
  fixedSeconds(interval.endSeconds - interval.startSeconds),
  "-i",
  file,
  "-map",
  "0:a:0",
  "-af",
  "ebur128=peak=true",
  "-f",
  "null",
  "-"
];

export function parseEbur128IntegratedLufs(text: string): number {
  const values = [...text.matchAll(/I:\s*(-?\d+(?:\.\d+)?)\s+LUFS/g)].map((match) =>
    Number(match[1])
  );
  const value = values.at(-1);
  if (!Number.isFinite(value)) throw new Error("Could not measure integrated source loudness");
  return value!;
}

export async function measureIntervalLoudness(
  ffmpegPath: string,
  file: string,
  interval: DuckInterval,
  runCommand: typeof defaultRunCommand = defaultRunCommand
): Promise<number> {
  const result = await runCommand(ffmpegPath, buildLoudnessMeasurementArgs(file, interval));
  return parseEbur128IntegratedLufs(`${result.stdout}\n${result.stderr}`);
}

export const buildLogoCornerSampleArgs = (file: string, timeSeconds: number): string[] => [
  "-v",
  "error",
  "-ss",
  fixedSeconds(timeSeconds),
  "-i",
  file,
  "-frames:v",
  "1",
  "-vf",
  "crop=198:198:iw-198:0",
  "-f",
  "hash",
  "-hash",
  "sha256",
  "-"
];

const parseSha256Output = (text: string): string => {
  const match = text.match(/SHA256=([a-f0-9]{64})/i);
  if (!match) throw new Error("Could not sample logo corner frame hash");
  return match[1]!.toLowerCase();
};

export async function sampleLogoCornerFrameHash(
  ffmpegPath: string,
  file: string,
  timeSeconds: number,
  runCommand: typeof defaultRunCommand = defaultRunCommand
): Promise<string> {
  const result = await runCommand(ffmpegPath, buildLogoCornerSampleArgs(file, timeSeconds));
  return parseSha256Output(`${result.stdout}\n${result.stderr}`);
}

export const buildFinalFfprobeArgs = (file: string): string[] => [
  "-v",
  "error",
  "-show_entries",
  "stream=codec_type,codec_name,width,height,r_frame_rate,sample_rate,channels,duration,bit_rate,pix_fmt,color_space,color_transfer,color_primaries:format=duration",
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
      framesPerSecond: frameRate(video?.r_frame_rate),
      durationSeconds: Number(video?.duration),
      pixelFormat: typeof video?.pix_fmt === "string" ? video.pix_fmt : "",
      colorSpace: typeof video?.color_space === "string" ? video.color_space : "",
      colorTransfer: typeof video?.color_transfer === "string" ? video.color_transfer : "",
      colorPrimaries: typeof video?.color_primaries === "string" ? video.color_primaries : ""
    },
    audio: {
      codecName: typeof audio?.codec_name === "string" ? audio.codec_name : "",
      sampleRate: Number(audio?.sample_rate),
      channels: Number(audio?.channels),
      durationSeconds: Number(audio?.duration),
      bitRate: Number(audio?.bit_rate)
    }
  };

  if (
    !video ||
    !audio ||
    !Number.isFinite(inspection.durationSeconds) ||
    !Number.isFinite(inspection.video.width) ||
    !Number.isFinite(inspection.video.height) ||
    !Number.isFinite(inspection.video.framesPerSecond) ||
    !Number.isFinite(inspection.video.durationSeconds) ||
    !Number.isFinite(inspection.audio.sampleRate) ||
    !Number.isFinite(inspection.audio.channels) ||
    !Number.isFinite(inspection.audio.durationSeconds) ||
    !Number.isFinite(inspection.audio.bitRate)
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
  if (inspection.video.pixelFormat !== "yuv420p") throw new Error("Final must use yuv420p");
  if (
    inspection.video.colorSpace !== "bt709" ||
    inspection.video.colorTransfer !== "bt709" ||
    inspection.video.colorPrimaries !== "bt709"
  ) {
    throw new Error("Final must use BT.709 color tags");
  }
  if (inspection.audio.codecName !== "aac") throw new Error("Final must use AAC audio");
  if (inspection.audio.sampleRate !== 48_000) throw new Error("Final audio must be 48kHz");
  if (inspection.audio.channels !== 2) throw new Error("Final audio must be stereo");
  if (Math.abs(inspection.audio.bitRate - AUDIO_BITRATE_TARGET) > AUDIO_BITRATE_TOLERANCE) {
    throw new Error("Final audio bitrate is outside AAC 192k tolerance");
  }
  if (
    !Number.isFinite(inspection.durationSeconds) ||
    Math.abs(inspection.durationSeconds - inputDurationSeconds) > DURATION_TOLERANCE_SECONDS
  ) {
    throw new Error(
      `Final duration mismatch: input ${inputDurationSeconds.toFixed(3)}s, output ${inspection.durationSeconds.toFixed(3)}s`
    );
  }
  if (
    Math.abs(inspection.audio.durationSeconds - inspection.durationSeconds) >
      AUDIO_DURATION_TOLERANCE_SECONDS ||
    Math.abs(inspection.video.durationSeconds - inspection.durationSeconds) >
      AUDIO_DURATION_TOLERANCE_SECONDS
  ) {
    throw new Error("Final audio duration must be within 0.050s of video/container duration");
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

export function assertSourceOutputLoudness(
  sourceGains: readonly SourceIntervalGain[],
  outputLufsA: readonly number[],
  outputLufsB: readonly number[]
): void {
  if (outputLufsA.length !== sourceGains.length || outputLufsB.length !== sourceGains.length) {
    throw new Error("Output source loudness measurement count mismatch");
  }
  for (const [index, gain] of sourceGains.entries()) {
    const a = outputLufsA[index]!;
    const b = outputLufsB[index]!;
    if (
      !Number.isFinite(a) ||
      !Number.isFinite(b) ||
      Math.abs(a - gain.targetLufs) > SOURCE_LOUDNESS_TOLERANCE_LU ||
      Math.abs(b - gain.targetLufs) > SOURCE_LOUDNESS_TOLERANCE_LU
    ) {
      throw new Error(`Output source loudness misses ${gain.targetLufs} LUFS target`);
    }
    if (Math.abs(a - b) > SOURCE_LOUDNESS_TOLERANCE_LU) {
      throw new Error("A/B source loudness treatment differs by more than 2 LU");
    }
  }
}

const safeVariantPath = (directory: "exports" | "final", file: string): string =>
  `${directory}/${basename(file)}`;

export function buildPostProductionManifest(options: BuildPostProductionManifestOptions) {
  return {
    schemaVersion: "0.2.0" as const,
    status: "finished" as const,
    productionId: options.productionId,
    generationId: options.generationId,
    assets: {
      logo: basename(options.logoPath),
      logoSha256: options.logoSha256,
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
      audioMixDuration: "longest" as const,
      exactAudioDuration: true,
      limiter: "limit=0.95:attack=5:release=50:level=false:latency=true" as const,
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
    sourceDialogue: {
      targetLufs: SOURCE_TARGET_LUFS,
      gainClampDb: SOURCE_GAIN_CLAMP_DB,
      rampSeconds: GAIN_RAMP_SECONDS,
      toleranceLu: SOURCE_LOUDNESS_TOLERANCE_LU,
      intervals: options.sourceGains.map((gain) => ({ ...gain }))
    },
    logoEvidence: options.logoEvidence.map((evidence) => ({
      name: evidence.name,
      samples: evidence.samples.map((sample) => ({ ...sample }))
    })),
    variants: options.variants.map((variant) => ({
      name: variant.name,
      inputPath: safeVariantPath("exports", variant.inputPath),
      outputPath: safeVariantPath("final", variant.outputPath),
      inputDurationSeconds: variant.inputDurationSeconds,
      outputDurationSeconds: variant.outputDurationSeconds,
      sha256: variant.sha256,
      byteSize: variant.byteSize
    }))
  };
}

interface PublishedVariantRecord {
  readonly name: "version-a" | "version-b";
  readonly outputPath: string;
  readonly sha256: string;
  readonly byteSize: number;
}

interface PublishedGenerationManifest {
  readonly schemaVersion: "0.2.0";
  readonly status: "finished";
  readonly generationId: string;
  readonly variants: readonly PublishedVariantRecord[];
}

const parsePublishedGenerationManifest = (text: string): PublishedGenerationManifest => {
  let value: unknown;
  try {
    value = JSON.parse(text);
  } catch {
    throw new Error("Invalid published generation manifest JSON");
  }
  if (!value || typeof value !== "object") {
    throw new Error("Invalid published generation manifest");
  }
  const candidate = value as Partial<PublishedGenerationManifest>;
  if (
    candidate.schemaVersion !== "0.2.0" ||
    candidate.status !== "finished" ||
    typeof candidate.generationId !== "string" ||
    !candidate.generationId ||
    !Array.isArray(candidate.variants) ||
    candidate.variants.length !== 2
  ) {
    throw new Error("Invalid published generation manifest");
  }
  const expected = [
    { name: "version-a", outputPath: "final/version-a.mp4" },
    { name: "version-b", outputPath: "final/version-b.mp4" }
  ] as const;
  for (const expectation of expected) {
    const variant = candidate.variants.find(({ name }) => name === expectation.name);
    if (
      !variant ||
      variant.outputPath !== expectation.outputPath ||
      typeof variant.sha256 !== "string" ||
      !/^[a-f0-9]{64}$/.test(variant.sha256) ||
      !Number.isSafeInteger(variant.byteSize) ||
      variant.byteSize <= 0
    ) {
      throw new Error(`Invalid published generation manifest variant: ${expectation.name}`);
    }
  }
  return candidate as PublishedGenerationManifest;
};

export async function validatePublishedGeneration(
  input: string | PublishedGenerationPaths,
  dependencies: Pick<
    FinishGptLiveDependencies,
    "lstat" | "readFile" | "readFileBytes" | "realpath"
  > = {}
): Promise<PublishedGenerationValidation> {
  const options = typeof input === "string" ? { episodeDir: input } : input;
  const episodeDir = resolve(options.episodeDir);
  const finalPaths = options.finalPaths ?? [
    join(episodeDir, "final", "version-a.mp4"),
    join(episodeDir, "final", "version-b.mp4")
  ];
  const reportPath = options.reportPath ?? join(episodeDir, "reports", "post-production.json");
  const lstat = dependencies.lstat ?? defaultLstat;
  const realpath = dependencies.realpath ?? defaultRealpath;
  const readFile = dependencies.readFile ?? (defaultReadFile as ReadText);
  const readFileBytes = dependencies.readFileBytes ??
    ((path: string) => defaultReadFile(path) as Promise<Uint8Array>);

  await validateContainedPaths(
    episodeDir,
    [finalPaths[0], finalPaths[1], reportPath],
    lstat,
    realpath
  );
  let manifestText: string;
  try {
    manifestText = await readFile(reportPath, "utf8");
  } catch (error) {
    throw new Error(
      `Published generation manifest is missing or unreadable: ${error instanceof Error ? error.message : String(error)}`
    );
  }
  const manifest = parsePublishedGenerationManifest(manifestText);

  await validateContainedPaths(episodeDir, [finalPaths[0], finalPaths[1]], lstat, realpath);
  for (const [index, name] of (["version-a", "version-b"] as const).entries()) {
    let bytes: Uint8Array;
    try {
      bytes = await readFileBytes(finalPaths[index]!);
    } catch (error) {
      throw new Error(
        `Published generation file is missing: ${name} (${error instanceof Error ? error.message : String(error)})`
      );
    }
    const expected = manifest.variants.find((variant) => variant.name === name)!;
    const actualSha256 = createHash("sha256").update(bytes).digest("hex");
    if (bytes.byteLength !== expected.byteSize || actualSha256 !== expected.sha256) {
      throw new Error(
        `Published generation mismatch for ${name}: expected ${expected.byteSize} bytes/${expected.sha256}, ` +
        `received ${bytes.byteLength} bytes/${actualSha256}`
      );
    }
  }

  return {
    generationId: manifest.generationId,
    variants: (["version-a", "version-b"] as const).map((name) => {
      const variant = manifest.variants.find((record) => record.name === name)!;
      return { name, sha256: variant.sha256, byteSize: variant.byteSize };
    }),
    finalPaths: [finalPaths[0], finalPaths[1]],
    reportPath
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
  readonly rollbackPath: string;
}

const isMissingPathError = (error: unknown): boolean =>
  (error as NodeJS.ErrnoException).code === "ENOENT";

const safeCleanupPath = (episodeDir: string, path: string): string =>
  relative(episodeDir, path).split(sep).join("/");

const publishGenerationAtomically = async (
  episodeDir: string,
  mediaPromotions: readonly Promotion[],
  markerPromotion: Promotion,
  commitMarker: () => Promise<void>,
  copyFile: typeof defaultCopyFile,
  rename: typeof defaultRename,
  rm: typeof defaultRm
): Promise<string[]> => {
  const allPromotions = [...mediaPromotions, markerPromotion];
  const rollbackCopies = new Set<Promotion>();
  const promoted: Promotion[] = [];
  let markerAttempted = false;
  try {
    for (const promotion of allPromotions) {
      await rm(promotion.rollbackPath, { force: true });
      try {
        await copyFile(promotion.targetPath, promotion.rollbackPath);
        rollbackCopies.add(promotion);
      } catch (error) {
        if (!isMissingPathError(error)) throw error;
      }
    }
    for (const promotion of mediaPromotions) {
      await rename(promotion.stagedPath, promotion.targetPath);
      promoted.push(promotion);
    }
    markerAttempted = true;
    await commitMarker();
  } catch (error) {
    const failedRestorations: Array<{ promotion: Promotion; error: unknown }> = [];
    const restorations = [
      ...(markerAttempted ? [markerPromotion] : []),
      ...promoted.reverse()
    ];
    for (const promotion of restorations) {
      try {
        if (rollbackCopies.has(promotion)) {
          await rename(promotion.rollbackPath, promotion.targetPath);
          rollbackCopies.delete(promotion);
        } else {
          await rm(promotion.targetPath, { force: true });
        }
      } catch (restoreError) {
        failedRestorations.push({ promotion, error: restoreError });
      }
    }
    for (const promotion of rollbackCopies) {
      if (failedRestorations.some(({ promotion: failed }) => failed === promotion)) continue;
      await rm(promotion.rollbackPath, { force: true });
    }
    if (failedRestorations.length > 0) {
      const recoveryDetails = failedRestorations
        .map(({ promotion, error: restoreError }) =>
          `${promotion.rollbackPath} (${restoreError instanceof Error ? restoreError.message : String(restoreError)})`
        )
        .join(", ");
      const promotionError = error instanceof Error ? error.message : String(error);
      throw new Error(
        `Promotion rollback incomplete; new canonical state is incomplete. ` +
        `Recovery preserved at ${recoveryDetails}. Promotion failure: ${promotionError}`
      );
    }
    throw error;
  }

  const cleanupWarnings: string[] = [];
  for (const promotion of rollbackCopies) {
    try {
      await rm(promotion.rollbackPath, { force: true });
    } catch (error) {
      cleanupWarnings.push(
        `${safeCleanupPath(episodeDir, promotion.rollbackPath)}: ` +
        `${error instanceof Error ? error.message : String(error)}`
      );
    }
  }
  return cleanupWarnings;
};

export async function finishGptLiveProduction(
  options: FinishGptLiveProductionOptions,
  dependencies: FinishGptLiveDependencies = {}
): Promise<FinishGptLiveProductionResult> {
  const access = dependencies.access ?? defaultAccess;
  const copyFile = dependencies.copyFile ?? defaultCopyFile;
  const lstat = dependencies.lstat ?? defaultLstat;
  const mkdir = dependencies.mkdir ?? defaultMkdir;
  const randomUUID = dependencies.randomUUID ?? defaultRandomUUID;
  const readFile = dependencies.readFile ?? (defaultReadFile as ReadText);
  const readFileBytes = dependencies.readFileBytes ??
    ((path: string) => defaultReadFile(path) as Promise<Uint8Array>);
  const realpath = dependencies.realpath ?? defaultRealpath;
  const rename = dependencies.rename ?? defaultRename;
  const rm = dependencies.rm ?? defaultRm;
  const runCommand = dependencies.runCommand ?? defaultRunCommand;
  const measure = dependencies.measureIntervalLoudness ??
    ((ffmpeg: string, file: string, interval: DuckInterval) =>
      measureIntervalLoudness(ffmpeg, file, interval, runCommand));
  const sampleCornerHash = dependencies.sampleLogoCornerFrameHash ??
    ((ffmpeg: string, file: string, timeSeconds: number) =>
      sampleLogoCornerFrameHash(ffmpeg, file, timeSeconds, runCommand));
  const writeJsonAtomic = dependencies.writeJsonAtomic ?? defaultWriteJsonAtomic;
  const inspect = dependencies.inspectFinalMediaFile ??
    ((ffprobePath: string, file: string) => inspectFinalMediaFile(ffprobePath, file));
  const validateGeneration = dependencies.validatePublishedGeneration ??
    ((input: string | PublishedGenerationPaths) =>
      validatePublishedGeneration(input, { lstat, readFile, readFileBytes, realpath }));

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
  const exportsDirectory = join(options.episodeDir, "exports");
  const finalDirectory = join(options.episodeDir, "final");
  const reportsDirectory = join(options.episodeDir, "reports");
  const inputPaths = [join(exportsDirectory, "tella-a.mp4"), join(exportsDirectory, "tella-b.mp4")];
  const finalPaths = [join(finalDirectory, "version-a.mp4"), join(finalDirectory, "version-b.mp4")];
  const reportPath = join(reportsDirectory, "post-production.json");
  const priorQaPaths = [
    join(reportsDirectory, "qa.json"),
    join(reportsDirectory, "comparison.md"),
    join(reportsDirectory, "visual"),
    join(reportsDirectory, "human-playback.json")
  ];
  await validateContainedPaths(
    options.episodeDir,
    [
      planPath,
      exportsDirectory,
      ...inputPaths,
      finalDirectory,
      ...finalPaths,
      reportsDirectory,
      reportPath
    ],
    lstat,
    realpath
  );
  const plan = parseFinishPlan(await readFile(planPath, "utf8"));
  const duckIntervals = deriveSourceDuckIntervals(plan);
  await mkdir(finalDirectory, { recursive: true });
  await mkdir(reportsDirectory, { recursive: true });
  await validateContainedPaths(
    options.episodeDir,
    [exportsDirectory, ...inputPaths, finalDirectory, ...finalPaths, reportsDirectory, reportPath],
    lstat,
    realpath
  );
  const logoSha256 = createHash("sha256").update(await readFileBytes(logoPath)).digest("hex");

  const transactionId = randomUUID();
  const definitions = [
    {
      name: "version-a" as const,
      inputPath: inputPaths[0]!,
      outputPath: finalPaths[0]!
    },
    {
      name: "version-b" as const,
      inputPath: inputPaths[1]!,
      outputPath: finalPaths[1]!
    }
  ];
  const stagedPaths = definitions.map((definition) =>
    join(finalDirectory, `${definition.name}.tmp-${transactionId}.mp4`)
  );
  const stagedReportPath = join(reportsDirectory, `post-production.tmp-${transactionId}.json`);
  const temporaryPaths = [...stagedPaths, stagedReportPath];
  const rollbackPaths = [
    ...definitions.map((definition) => `${definition.outputPath}.rollback-${transactionId}`),
    `${reportPath}.rollback-${transactionId}`
  ];
  const cleanupWarnings: string[] = [];
  let generationCommitted = false;

  try {
    await validateContainedPaths(
      options.episodeDir,
      [exportsDirectory, ...inputPaths, finalDirectory, ...finalPaths, reportsDirectory, reportPath],
      lstat,
      realpath
    );
    const inputInspections = await Promise.all(
      definitions.map((definition) => inspect(ffprobePath, definition.inputPath))
    );
    for (const inspection of inputInspections) {
      requirePositiveDuration(inspection.durationSeconds, "Tella export");
    }
    const inputLoudness = await Promise.all(
      definitions.map((definition) =>
        Promise.all(duckIntervals.map((interval) => measure(ffmpegPath, definition.inputPath, interval)))
      )
    );
    const sourceGains = deriveSharedSourceGains(
      duckIntervals,
      inputLoudness[0]!,
      inputLoudness[1]!
    );

    for (const [index, definition] of definitions.entries()) {
      await validateContainedPaths(
        options.episodeDir,
        [definition.inputPath, finalDirectory, stagedPaths[index]!],
        lstat,
        realpath
      );
      await runCommand(
        ffmpegPath,
        buildFinishFfmpegArgs({
          inputPath: definition.inputPath,
          logoPath,
          musicPath,
          outputPath: stagedPaths[index]!,
          durationSeconds: inputInspections[index]!.durationSeconds,
          duckIntervals,
          sourceGains
        })
      );
    }

    await validateContainedPaths(
      options.episodeDir,
      [finalDirectory, ...stagedPaths],
      lstat,
      realpath
    );
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
    const outputLoudness = await Promise.all(
      stagedPaths.map((path) =>
        Promise.all(duckIntervals.map((interval) => measure(ffmpegPath, path, interval)))
      )
    );
    assertSourceOutputLoudness(sourceGains, outputLoudness[0]!, outputLoudness[1]!);
    const sourceResults: SourceIntervalResult[] = sourceGains.map((gain, index) => ({
      ...gain,
      outputLufsA: outputLoudness[0]![index]!,
      outputLufsB: outputLoudness[1]![index]!
    }));

    const logoEvidence: LogoEvidence[] = [];
    for (const [index, definition] of definitions.entries()) {
      const durationSeconds = outputInspections[index]!.durationSeconds;
      const sampleTimes = [
        Math.min(0.5, durationSeconds / 4),
        durationSeconds / 2,
        Math.max(0, durationSeconds - 0.5)
      ].map(roundedSeconds);
      const samples = [];
      for (const timeSeconds of sampleTimes) {
        const [inputSha256, outputSha256] = await Promise.all([
          sampleCornerHash(ffmpegPath, definition.inputPath, timeSeconds),
          sampleCornerHash(ffmpegPath, stagedPaths[index]!, timeSeconds)
        ]);
        if (inputSha256 === outputSha256) {
          throw new Error(`AIMH logo corner evidence is unchanged: ${definition.name}`);
        }
        samples.push({ timeSeconds, inputSha256, outputSha256 });
      }
      logoEvidence.push({ name: definition.name, samples });
    }

    const variantMetadata = definitions.map((definition, index) => ({
      ...definition,
      inputDurationSeconds: inputInspections[index]!.durationSeconds,
      outputDurationSeconds: outputInspections[index]!.durationSeconds
    }));
    const mediaPromotions: Promotion[] = definitions.map((definition, index) => ({
        stagedPath: stagedPaths[index]!,
        targetPath: definition.outputPath,
        rollbackPath: rollbackPaths[index]!
      }));
    const markerPromotion: Promotion = {
      stagedPath: stagedReportPath,
      targetPath: reportPath,
      rollbackPath: rollbackPaths[2]!
    };
    let manifest: ReturnType<typeof buildPostProductionManifest> | undefined;
    await validateContainedPaths(
      options.episodeDir,
      [...mediaPromotions, markerPromotion].flatMap(({ stagedPath, targetPath, rollbackPath }) => [
        stagedPath,
        targetPath,
        rollbackPath
      ]),
      lstat,
      realpath
    );
    cleanupWarnings.push(
      ...await publishGenerationAtomically(
        options.episodeDir,
        mediaPromotions,
        markerPromotion,
        async () => {
          await validateContainedPaths(
            options.episodeDir,
            [finalDirectory, ...finalPaths, reportsDirectory, stagedReportPath, reportPath],
            lstat,
            realpath
          );
          const canonicalBytes = await Promise.all(finalPaths.map((path) => readFileBytes(path)));
          const variants: PostProductionVariant[] = variantMetadata.map((variant, index) => ({
            ...variant,
            sha256: createHash("sha256").update(canonicalBytes[index]!).digest("hex"),
            byteSize: canonicalBytes[index]!.byteLength
          }));
          manifest = buildPostProductionManifest({
            productionId: plan.productionId,
            generationId: transactionId,
            logoPath,
            musicPath,
            logoSha256,
            duckIntervals,
            sourceGains: sourceResults,
            logoEvidence,
            variants
          });
          await writeJsonAtomic(stagedReportPath, manifest);
          await validateContainedPaths(
            options.episodeDir,
            [stagedReportPath, reportPath, ...priorQaPaths],
            lstat,
            realpath
          );
          for (const path of priorQaPaths) {
            await rm(path, { recursive: true, force: true });
          }
          await rename(stagedReportPath, reportPath);
          const validation = await validateGeneration(options.episodeDir);
          if (validation.generationId !== transactionId) {
            throw new Error(
              `Published generation validator returned stale generation: ${validation.generationId}`
            );
          }
          generationCommitted = true;
        },
        copyFile,
        rename,
        rm
      )
    );
    if (!manifest) throw new Error("Post-production manifest was not committed");

    return {
      episodeDir: options.episodeDir,
      finalPaths: [definitions[0]!.outputPath, definitions[1]!.outputPath],
      reportPath,
      manifest,
      cleanupWarnings
    };
  } finally {
    for (const path of temporaryPaths) {
      try {
        await rm(path, { force: true });
      } catch (error) {
        if (generationCommitted) {
          cleanupWarnings.push(
            `${safeCleanupPath(options.episodeDir, path)}: ` +
            `${error instanceof Error ? error.message : String(error)}`
          );
        }
      }
    }
  }
}
