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
import { basename, isAbsolute, join, relative, resolve, sep } from "node:path";
import { runCommand as defaultRunCommand } from "../../render/process";
import { writeJsonAtomic as defaultWriteJsonAtomic } from "./atomicFiles";
import { GPT_LIVE_CONTENT } from "./content";
import {
  derivePreparedArtifactDescriptors,
  hashPreparedArtifactDescriptors,
  validatePreparedGeneration,
  type PreparedArtifactBinding,
  type PreparedGenerationRecord
} from "./preparation";
import { withEpisodeProductionLock } from "./productionLock";
import { validateContainedEpisodePaths } from "./qa/paths";
import {
  assertSourceFullscreenEvidence,
  verifySourceFullscreen as defaultVerifySourceFullscreen,
  type SourceFullscreenEvidence
} from "./sourceFullscreen";
import {
  tellaExportReceiptPath,
  validateSealedTellaExports as defaultValidateSealedTellaExports,
  type TellaExportReceipt
} from "./tellaExportReceipt";
import { assertTellaProgramDuration, validateTellaTimelineAudit } from "./tellaState";
import type { TellaPlan } from "./tellaPlan";

const DIALOGUE_VOLUME = 1;
const OUTRO_MUSIC_VOLUME = 0.16;
const OUTRO_FADE_IN_SECONDS = 0.25;
const OUTRO_FADE_OUT_SECONDS = 0.75;
const OUTRO_TIMING_SERIALIZATION_EPSILON_SECONDS = 0.001;
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
  readonly programAudio: ProgramAudioPlan;
  readonly outroMusicPath: string;
  readonly outroDurationSeconds: number;
  readonly outputPath: string;
  readonly durationSeconds: number;
  readonly sourceGains: readonly SourceIntervalGain[];
}

export interface ProgramAudioInput {
  readonly inputIndex: number;
  readonly clipId: string;
  readonly kind: "source_clip" | "narration";
  readonly path: string;
  readonly relativePath: string;
  readonly durationSeconds: number;
}

export interface ProgramAudioPlan {
  readonly source: "audited_plan_media";
  readonly tellaInputAudioUsed: false;
  readonly clipOrder: readonly string[];
  readonly inputs: readonly ProgramAudioInput[];
}

export interface ProgramAudioBinding {
  readonly clipId: string;
  readonly kind: "source_clip" | "narration";
  readonly path: string;
  readonly sha256: string;
  readonly byteSize: number;
  readonly durationSeconds: number;
}

export interface PostProductionVariant {
  readonly name: "version-a" | "version-b";
  readonly inputPath: string;
  readonly outputPath: string;
  readonly inputDurationSeconds: number;
  readonly outputDurationSeconds: number;
  readonly inputSha256: string;
  readonly inputByteSize: number;
  readonly sha256: string;
  readonly byteSize: number;
}

export interface BuildPostProductionManifestOptions {
  readonly productionId: string;
  readonly generationId: string;
  readonly preparationFingerprint: string;
  readonly logoPath: string;
  readonly outroMusicPath: string;
  readonly outroDurationSeconds: number;
  readonly logoSha256: string;
  readonly programAudio: readonly ProgramAudioBinding[];
  readonly sourceGains: readonly SourceIntervalResult[];
  readonly logoEvidence: readonly LogoEvidence[];
  readonly tellaExports: TellaExportReceipt["exports"];
  readonly sourceFullscreen: readonly SourceFullscreenEvidence[];
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
  readonly preparationFingerprint: string;
  readonly preparedArtifacts: readonly PreparedArtifactBinding[];
  readonly reportSha256: string;
  readonly variants: readonly {
    readonly name: "version-a" | "version-b";
    readonly inputSha256: string;
    readonly inputByteSize: number;
    readonly sha256: string;
    readonly byteSize: number;
  }[];
  readonly programAudio: readonly ProgramAudioBinding[];
  readonly tellaExports: TellaExportReceipt["exports"];
  readonly sourceFullscreen: readonly SourceFullscreenEvidence[];
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
  readonly validateSealedTellaExports?: typeof defaultValidateSealedTellaExports;
  readonly verifySourceFullscreen?: typeof defaultVerifySourceFullscreen;
  readonly writeJsonAtomic?: typeof defaultWriteJsonAtomic;
  readonly withProductionLock?: typeof withEpisodeProductionLock;
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

interface OutroTiming {
  readonly startSeconds: number;
  readonly durationSeconds: number;
  readonly fadeOutStartSeconds: number;
  readonly fadeOutSeconds: number;
  readonly delayMilliseconds: number;
}

const deriveOutroTiming = (
  programDurationSeconds: number,
  configuredOutroDurationSeconds: number
): OutroTiming => {
  requirePositiveDuration(programDurationSeconds, "program");
  requirePositiveDuration(configuredOutroDurationSeconds, "outro music");
  const durationSeconds = roundedSeconds(
    Math.min(configuredOutroDurationSeconds, programDurationSeconds)
  );
  const startSeconds = roundedSeconds(Math.max(0, programDurationSeconds - durationSeconds));
  const fadeOutSeconds = roundedSeconds(Math.min(OUTRO_FADE_OUT_SECONDS, durationSeconds));
  return {
    startSeconds,
    durationSeconds,
    fadeOutStartSeconds: roundedSeconds(Math.max(0, durationSeconds - fadeOutSeconds)),
    fadeOutSeconds,
    delayMilliseconds: Math.round(startSeconds * 1000)
  };
};

const timingDiffers = (left: number, right: number): boolean =>
  roundedSeconds(Math.abs(left - right)) > OUTRO_TIMING_SERIALIZATION_EPSILON_SECONDS;

const assertSharedOutroTiming = (
  programDurations: readonly number[],
  configuredOutroDurationSeconds: number,
  context: string
): void => {
  const [firstDuration, ...remainingDurations] = programDurations;
  if (firstDuration === undefined) throw new Error(`${context}: missing input duration`);
  const expected = deriveOutroTiming(firstDuration, configuredOutroDurationSeconds);
  for (const duration of remainingDurations) {
    const actual = deriveOutroTiming(duration, configuredOutroDurationSeconds);
    if (
      timingDiffers(actual.startSeconds, expected.startSeconds) ||
      timingDiffers(actual.durationSeconds, expected.durationSeconds) ||
      timingDiffers(actual.fadeOutSeconds, expected.fadeOutSeconds)
    ) {
      throw new Error(`${context}: A/B input durations cannot share one outro policy`);
    }
  }
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

interface ValidateCurrentPreparationOptions {
  readonly episodeDir: string;
  readonly production: unknown;
  readonly voice: unknown;
  readonly plan: unknown;
  readonly sourceMatrix: string;
  readonly sourceManifest: unknown;
  readonly prepared: unknown;
  readonly lstat: Lstat;
  readonly readFileBytes: ReadBytes;
  readonly realpath: Realpath;
}

const validateCurrentPreparation = async (
  options: ValidateCurrentPreparationOptions
): Promise<PreparedGenerationRecord> => {
  const descriptors = derivePreparedArtifactDescriptors({
    episodeDir: options.episodeDir,
    production: options.production,
    voice: options.voice,
    plan: options.plan
  });
  const containedPaths = descriptors
    .filter((artifact) => !isAbsolute(artifact.path))
    .map((artifact) => artifact.absolutePath);
  await validateContainedPaths(options.episodeDir, containedPaths, options.lstat, options.realpath);
  for (const artifact of descriptors.filter((candidate) => isAbsolute(candidate.path))) {
    const file = await options.lstat(artifact.absolutePath);
    if (file.isSymbolicLink() || file.isDirectory()) {
      throw new Error(`Prepared artifact path is not a regular file: ${artifact.logicalId}`);
    }
  }
  const artifacts = await hashPreparedArtifactDescriptors(descriptors, options.readFileBytes);
  return validatePreparedGeneration(options.prepared, GPT_LIVE_CONTENT.id, {
    production: options.production,
    voice: options.voice,
    plan: options.plan,
    sourceMatrix: options.sourceMatrix,
    sourceManifest: options.sourceManifest,
    artifacts
  });
};

export function buildLogoFilter(): string {
  return "[1:v]scale=150:-1,format=rgba,colorchannelmixer=aa=0.85[lg];[0:v][lg]overlay=W-w-24:24";
}

export function buildProgramAudioPlan(episodeDir: string, plan: TellaPlan): ProgramAudioPlan {
  const root = resolve(episodeDir);
  if (
    plan.schemaVersion !== "0.1.0" ||
    plan.productionId !== GPT_LIVE_CONTENT.id ||
    plan.clips.length !== GPT_LIVE_CONTENT.timeline.length
  ) {
    throw new Error("Invalid GPT-Live program audio plan count or production");
  }

  const inputs = plan.clips.map((clip, index): ProgramAudioInput => {
    const expected = GPT_LIVE_CONTENT.timeline[index]!;
    if (clip.id !== expected.id || clip.kind !== expected.kind) {
      throw new Error(`Invalid GPT-Live program audio plan order or kind at index ${index}`);
    }
    requirePositiveDuration(clip.durationSeconds, `program audio clip ${clip.id}`);
    const expectedPath = clip.kind === "source_clip"
      ? join(root, "source", `${clip.id}.mp4`)
      : join(root, "master", `${clip.id}.mp4`);
    const path = clip.kind === "source_clip" ? clip.mediaPath : clip.masterPath;
    if (
      typeof path !== "string" ||
      !path ||
      (clip.kind === "source_clip" && clip.preserveOriginalAudio !== true) ||
      resolve(path) !== expectedPath
    ) {
      throw new Error(`Invalid GPT-Live program audio path: ${clip.id}`);
    }
    return {
      inputIndex: index + 2,
      clipId: clip.id,
      kind: clip.kind,
      path,
      relativePath: relative(root, path).split(sep).join("/"),
      durationSeconds: clip.durationSeconds
    };
  });

  return {
    source: "audited_plan_media",
    tellaInputAudioUsed: false,
    clipOrder: inputs.map(({ clipId }) => clipId),
    inputs
  };
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
  outroDurationSeconds: number,
  sourceGains: readonly SourceIntervalGain[],
  programAudio: ProgramAudioPlan
): string {
  const outroTiming = deriveOutroTiming(durationSeconds, outroDurationSeconds);
  const duration = fixedSeconds(durationSeconds);
  let sourceIndex = 0;
  const programInputs = programAudio.inputs.map((input, index) => {
    const clipDuration = fixedSeconds(input.durationSeconds);
    let gainFilter = "";
    if (input.kind === "source_clip") {
      const gain = sourceGains[sourceIndex++];
      if (!gain) throw new Error("Source gain count does not match program audio");
      const localGain = buildSourceDialogueGainExpression([{
        ...gain,
        startSeconds: 0,
        endSeconds: input.durationSeconds
      }]);
      gainFilter = `,volume='${localGain}':eval=frame`;
    }
    return `[${input.inputIndex}:a]aresample=48000,` +
      "aformat=sample_fmts=fltp:channel_layouts=stereo," +
      `apad=whole_dur=${clipDuration},atrim=duration=${clipDuration},` +
      `asetpts=PTS-STARTPTS${gainFilter}[program-${index}]`;
  });
  if (sourceIndex !== sourceGains.length) {
    throw new Error("Source gain count does not match program audio");
  }
  const concatInputs = programAudio.inputs.map((_, index) => `[program-${index}]`).join("");
  const outroInputIndex = programAudio.inputs.length + 2;
  return [
    `${buildLogoFilter()}[vout]`,
    ...programInputs,
    `${concatInputs}concat=n=${programAudio.inputs.length}:v=0:a=1,` +
      `apad=whole_dur=${duration},atrim=duration=${duration},asetpts=PTS-STARTPTS[program]`,
    `[${outroInputIndex}:a]aresample=48000,` +
      "aformat=sample_fmts=fltp:channel_layouts=stereo," +
      `atrim=duration=${fixedSeconds(outroTiming.durationSeconds)},asetpts=PTS-STARTPTS,` +
      `afade=t=in:st=0:d=${fixedSeconds(OUTRO_FADE_IN_SECONDS)},` +
      `afade=t=out:st=${fixedSeconds(outroTiming.fadeOutStartSeconds)}:` +
      `d=${fixedSeconds(outroTiming.fadeOutSeconds)},` +
      `volume=${OUTRO_MUSIC_VOLUME.toFixed(3)},` +
      `adelay=${outroTiming.delayMilliseconds}:all=1[outro]`,
    `[program][outro]amix=inputs=2:duration=longest:dropout_transition=0:normalize=0,` +
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
    ...options.programAudio.inputs.flatMap(({ path }) => ["-i", path]),
    "-i",
    options.outroMusicPath,
    "-filter_complex",
    buildFinishFilterGraph(
      options.durationSeconds,
      options.outroDurationSeconds,
      options.sourceGains,
      options.programAudio
    ),
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
  const programDurationSeconds = options.variants[0]?.inputDurationSeconds ?? 0;
  const outroTiming = deriveOutroTiming(programDurationSeconds, options.outroDurationSeconds);
  return {
    schemaVersion: "0.3.0" as const,
    status: "finished" as const,
    productionId: options.productionId,
    generationId: options.generationId,
    preparationFingerprint: options.preparationFingerprint,
    assets: {
      logo: basename(options.logoPath),
      logoSha256: options.logoSha256
    },
    audioPolicy: {
      introMusic: false as const,
      bodyMusic: false as const,
      outro: {
        file: basename(options.outroMusicPath),
        startSeconds: outroTiming.startSeconds,
        durationSeconds: outroTiming.durationSeconds,
        fadeInSeconds: OUTRO_FADE_IN_SECONDS,
        fadeOutSeconds: outroTiming.fadeOutSeconds
      }
    },
    programAudio: {
      source: "audited_plan_media" as const,
      tellaInputAudioUsed: false as const,
      clipOrder: options.programAudio.map(({ clipId }) => clipId),
      inputs: options.programAudio.map((input) => ({ ...input }))
    },
    settings: {
      logoFilter: buildLogoFilter(),
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
    tellaExports: options.tellaExports.map((record) => ({ ...record })),
    sourceFullscreen: options.sourceFullscreen.map((record) => ({ ...record })),
    variants: options.variants.map((variant) => ({
      name: variant.name,
      inputPath: safeVariantPath("exports", variant.inputPath),
      outputPath: safeVariantPath("final", variant.outputPath),
      inputDurationSeconds: variant.inputDurationSeconds,
      outputDurationSeconds: variant.outputDurationSeconds,
      inputSha256: variant.inputSha256,
      inputByteSize: variant.inputByteSize,
      sha256: variant.sha256,
      byteSize: variant.byteSize
    }))
  };
}

interface PublishedVariantRecord {
  readonly name: "version-a" | "version-b";
  readonly inputPath: string;
  readonly outputPath: string;
  readonly inputDurationSeconds: number;
  readonly outputDurationSeconds: number;
  readonly inputSha256: string;
  readonly inputByteSize: number;
  readonly sha256: string;
  readonly byteSize: number;
}

interface PublishedGenerationManifest {
  readonly schemaVersion: "0.3.0";
  readonly status: "finished";
  readonly generationId: string;
  readonly preparationFingerprint: string;
  readonly audioPolicy: {
    readonly introMusic: false;
    readonly bodyMusic: false;
    readonly outro: {
      readonly file: string;
      readonly startSeconds: number;
      readonly durationSeconds: number;
      readonly fadeInSeconds: 0.25;
      readonly fadeOutSeconds: number;
    };
  };
  readonly programAudio: {
    readonly source: "audited_plan_media";
    readonly tellaInputAudioUsed: false;
    readonly clipOrder: readonly string[];
    readonly inputs: readonly ProgramAudioBinding[];
  };
  readonly tellaExports: TellaExportReceipt["exports"];
  readonly sourceFullscreen: readonly SourceFullscreenEvidence[];
  readonly variants: readonly PublishedVariantRecord[];
}

interface PublishedAudioContract {
  readonly productionId: string;
  readonly logoPath: string;
  readonly logoFile: string;
  readonly logoSha256?: string;
  readonly outroMusicPath: string;
  readonly outroFile: string;
  readonly outroDurationSeconds: number;
}

const PUBLISHED_MANIFEST_KEYS = [
  "schemaVersion",
  "status",
  "productionId",
  "generationId",
  "preparationFingerprint",
  "assets",
  "audioPolicy",
  "programAudio",
  "settings",
  "sourceDialogue",
  "logoEvidence",
  "tellaExports",
  "sourceFullscreen",
  "variants"
] as const;

const PUBLISHED_SETTINGS_KEYS = [
  "logoFilter",
  "exactAudioDuration",
  "limiter",
  "videoCodec",
  "crf",
  "preset",
  "pixelFormat",
  "framesPerSecond",
  "audioCodec",
  "audioBitrate",
  "audioSampleRate",
  "audioChannels",
  "faststart",
  "durationToleranceSeconds",
  "variantDurationToleranceSeconds"
] as const;

const isRecord = (value: unknown): value is Record<string, unknown> =>
  value !== null && typeof value === "object" && !Array.isArray(value);

const hasExactKeys = (
  value: Record<string, unknown>,
  expectedKeys: readonly string[]
): boolean => {
  const actualKeys = Object.keys(value);
  return actualKeys.length === expectedKeys.length &&
    expectedKeys.every((key) => Object.hasOwn(value, key));
};

const portableBasename = (file: string): string => basename(file.replaceAll("\\", "/"));

const isSafeBasename = (file: string): boolean =>
  file.length > 0 && portableBasename(file) === file && file !== "." && file !== "..";

const parsePublishedAudioContract = (text: string): PublishedAudioContract => {
  let value: unknown;
  try {
    value = JSON.parse(text);
  } catch {
    throw new Error("Invalid canonical production manifest JSON");
  }
  if (
    !isRecord(value) ||
    value.id !== GPT_LIVE_CONTENT.id ||
    !isRecord(value.audio) ||
    !isRecord(value.branding) ||
    typeof value.branding.logoPath !== "string" ||
    !value.branding.logoPath.trim()
  ) {
    throw new Error("Invalid canonical production audio contract");
  }
  const audio = value.audio;
  if (
    !hasExactKeys(audio, [
      "introMusic",
      "bodyMusic",
      "outroMusicPath",
      "outroDurationSeconds"
    ]) ||
    audio.introMusic !== false ||
    audio.bodyMusic !== false ||
    typeof audio.outroMusicPath !== "string" ||
    !audio.outroMusicPath.trim() ||
    audio.outroDurationSeconds !== GPT_LIVE_CONTENT.audio.outroDurationSeconds
  ) {
    throw new Error("Invalid canonical production audio contract");
  }
  return {
    productionId: value.id,
    logoPath: value.branding.logoPath,
    logoFile: portableBasename(value.branding.logoPath),
    outroMusicPath: audio.outroMusicPath,
    outroFile: portableBasename(audio.outroMusicPath),
    outroDurationSeconds: audio.outroDurationSeconds
  };
};

const parsePublishedGenerationManifest = (
  text: string,
  expectedAudio: PublishedAudioContract,
  expectedProgramAudio: ProgramAudioPlan,
  expectedSourceIntervals: readonly DuckInterval[],
  expectedTellaExports: TellaExportReceipt,
  expectedPlan: TellaPlan,
  expectedPreparationFingerprint: string
): PublishedGenerationManifest => {
  let value: unknown;
  try {
    value = JSON.parse(text);
  } catch {
    throw new Error("Invalid published generation manifest JSON");
  }
  if (!isRecord(value) || !hasExactKeys(value, PUBLISHED_MANIFEST_KEYS)) {
    throw new Error("Invalid published generation manifest");
  }
  const candidate = value;
  const audioPolicy = candidate.audioPolicy;
  const programAudio = candidate.programAudio;
  const assets = candidate.assets;
  const settings = candidate.settings;
  const expectedSettings = {
    logoFilter: buildLogoFilter(),
    exactAudioDuration: true,
    limiter: "limit=0.95:attack=5:release=50:level=false:latency=true",
    videoCodec: "libx264",
    crf: 18,
    preset: "medium",
    pixelFormat: "yuv420p",
    framesPerSecond: 30,
    audioCodec: "aac",
    audioBitrate: "192k",
    audioSampleRate: 48_000,
    audioChannels: 2,
    faststart: true,
    durationToleranceSeconds: DURATION_TOLERANCE_SECONDS,
    variantDurationToleranceSeconds: VARIANT_DURATION_TOLERANCE_SECONDS
  } as const;
  if (
    candidate.schemaVersion !== "0.3.0" ||
    candidate.status !== "finished" ||
    candidate.productionId !== expectedAudio.productionId ||
    typeof candidate.generationId !== "string" ||
    !candidate.generationId ||
    candidate.preparationFingerprint !== expectedPreparationFingerprint ||
    !isRecord(assets) ||
    !hasExactKeys(assets, ["logo", "logoSha256"]) ||
    assets.logo !== expectedAudio.logoFile ||
    typeof assets.logoSha256 !== "string" ||
    !/^[a-f0-9]{64}$/.test(assets.logoSha256) ||
    assets.logoSha256 !== expectedAudio.logoSha256 ||
    !isRecord(settings) ||
    !hasExactKeys(settings, PUBLISHED_SETTINGS_KEYS) ||
    !Object.entries(expectedSettings).every(([key, expected]) => settings[key] === expected) ||
    !isRecord(candidate.sourceDialogue) ||
    !Array.isArray(candidate.logoEvidence) ||
    !Array.isArray(candidate.tellaExports) ||
    !Array.isArray(candidate.sourceFullscreen) ||
    !Array.isArray(candidate.variants) ||
    candidate.variants.length !== 2
  ) {
    throw new Error("Invalid published generation manifest");
  }
  if (JSON.stringify(candidate.tellaExports) !== JSON.stringify(expectedTellaExports.exports)) {
    throw new Error("Invalid published generation manifest Tella export provenance");
  }
  try {
    assertSourceFullscreenEvidence(expectedPlan, candidate.sourceFullscreen);
  } catch {
    throw new Error("Invalid published generation manifest source fullscreen evidence");
  }
  if (
    !isRecord(audioPolicy) ||
    !hasExactKeys(audioPolicy, ["introMusic", "bodyMusic", "outro"]) ||
    audioPolicy.introMusic !== false ||
    audioPolicy.bodyMusic !== false ||
    !isRecord(audioPolicy.outro) ||
    !hasExactKeys(audioPolicy.outro, [
      "file",
      "startSeconds",
      "durationSeconds",
      "fadeInSeconds",
      "fadeOutSeconds"
    ])
  ) {
    throw new Error("Invalid published generation manifest audio policy");
  }
  if (
    !isRecord(programAudio) ||
    !hasExactKeys(programAudio, ["source", "tellaInputAudioUsed", "clipOrder", "inputs"]) ||
    programAudio.source !== "audited_plan_media" ||
    programAudio.tellaInputAudioUsed !== false ||
    !Array.isArray(programAudio.clipOrder) ||
    !Array.isArray(programAudio.inputs) ||
    programAudio.inputs.length !== expectedProgramAudio.inputs.length ||
    programAudio.clipOrder.length !== expectedProgramAudio.inputs.length
  ) {
    throw new Error("Invalid published generation manifest program audio policy");
  }
  for (const [index, expectedInput] of expectedProgramAudio.inputs.entries()) {
    const binding = programAudio.inputs[index];
    if (
      programAudio.clipOrder[index] !== expectedInput.clipId ||
      !isRecord(binding) ||
      !hasExactKeys(binding, [
        "clipId",
        "kind",
        "path",
        "sha256",
        "byteSize",
        "durationSeconds"
      ]) ||
      binding.clipId !== expectedInput.clipId ||
      binding.kind !== expectedInput.kind ||
      binding.path !== expectedInput.relativePath ||
      typeof binding.path !== "string" ||
      resolve("/", binding.path) !== join("/", expectedInput.relativePath) ||
      typeof binding.sha256 !== "string" ||
      !/^[a-f0-9]{64}$/.test(binding.sha256) ||
      !Number.isSafeInteger(binding.byteSize) ||
      (binding.byteSize as number) <= 0 ||
      binding.durationSeconds !== expectedInput.durationSeconds
    ) {
      throw new Error(`Invalid published generation program audio binding: ${expectedInput.clipId}`);
    }
  }
  const outro = audioPolicy.outro;
  if (
    typeof outro.file !== "string" ||
    !isSafeBasename(outro.file) ||
    outro.file !== expectedAudio.outroFile ||
    !Number.isFinite(outro.startSeconds) ||
    (outro.startSeconds as number) < 0 ||
    !Number.isFinite(outro.durationSeconds) ||
    (outro.durationSeconds as number) <= 0 ||
    outro.fadeInSeconds !== OUTRO_FADE_IN_SECONDS ||
    !Number.isFinite(outro.fadeOutSeconds) ||
    (outro.fadeOutSeconds as number) <= 0
  ) {
    throw new Error("Invalid published generation manifest audio policy");
  }
  const expected = [
    {
      name: "version-a",
      inputPath: "exports/tella-a.mp4",
      outputPath: "final/version-a.mp4"
    },
    {
      name: "version-b",
      inputPath: "exports/tella-b.mp4",
      outputPath: "final/version-b.mp4"
    }
  ] as const;
  const variants: PublishedVariantRecord[] = [];
  for (const expectation of expected) {
    const variant = candidate.variants.find(
      (record) => isRecord(record) && record.name === expectation.name
    );
    if (
      !isRecord(variant) ||
      !hasExactKeys(variant, [
        "name",
        "inputPath",
        "outputPath",
        "inputDurationSeconds",
        "outputDurationSeconds",
        "inputSha256",
        "inputByteSize",
        "sha256",
        "byteSize"
      ]) ||
      variant.inputPath !== expectation.inputPath ||
      variant.outputPath !== expectation.outputPath ||
      !Number.isFinite(variant.inputDurationSeconds) ||
      (variant.inputDurationSeconds as number) <= 0 ||
      !Number.isFinite(variant.outputDurationSeconds) ||
      (variant.outputDurationSeconds as number) <= 0 ||
      Math.abs(
        (variant.inputDurationSeconds as number) - (variant.outputDurationSeconds as number)
      ) > DURATION_TOLERANCE_SECONDS ||
      typeof variant.inputSha256 !== "string" ||
      !/^[a-f0-9]{64}$/.test(variant.inputSha256) ||
      !Number.isSafeInteger(variant.inputByteSize) ||
      (variant.inputByteSize as number) <= 0 ||
      typeof variant.sha256 !== "string" ||
      !/^[a-f0-9]{64}$/.test(variant.sha256) ||
      !Number.isSafeInteger(variant.byteSize) ||
      (variant.byteSize as number) <= 0
    ) {
      throw new Error(`Invalid published generation manifest variant: ${expectation.name}`);
    }
    variants.push(variant as unknown as PublishedVariantRecord);
  }
  for (const [index, variant] of variants.entries()) {
    const sealed = expectedTellaExports.exports[index]!;
    if (variant.inputSha256 !== sealed.sha256 || variant.inputByteSize !== sealed.byteSize) {
      throw new Error("Invalid published generation manifest Tella export binding");
    }
  }
  assertVariantDurationParity(
    variants[0]!.outputDurationSeconds,
    variants[1]!.outputDurationSeconds
  );
  const sourceDialogue = candidate.sourceDialogue;
  if (
    !hasExactKeys(sourceDialogue, [
      "targetLufs",
      "gainClampDb",
      "rampSeconds",
      "toleranceLu",
      "intervals"
    ]) ||
    sourceDialogue.targetLufs !== SOURCE_TARGET_LUFS ||
    sourceDialogue.gainClampDb !== SOURCE_GAIN_CLAMP_DB ||
    sourceDialogue.rampSeconds !== GAIN_RAMP_SECONDS ||
    sourceDialogue.toleranceLu !== SOURCE_LOUDNESS_TOLERANCE_LU ||
    !Array.isArray(sourceDialogue.intervals) ||
    sourceDialogue.intervals.length === 0
  ) {
    throw new Error("Invalid published generation manifest source dialogue");
  }
  const sourceResults: SourceIntervalResult[] = [];
  for (const interval of sourceDialogue.intervals) {
    if (
      !isRecord(interval) ||
      !hasExactKeys(interval, [
        "startSeconds",
        "endSeconds",
        "measuredLufsA",
        "measuredLufsB",
        "averageMeasuredLufs",
        "targetLufs",
        "gainDb",
        "outputLufsA",
        "outputLufsB"
      ]) ||
      ![
        interval.startSeconds,
        interval.endSeconds,
        interval.measuredLufsA,
        interval.measuredLufsB,
        interval.averageMeasuredLufs,
        interval.gainDb,
        interval.outputLufsA,
        interval.outputLufsB
      ].every(Number.isFinite) ||
      (interval.startSeconds as number) < 0 ||
      (interval.endSeconds as number) <= (interval.startSeconds as number) ||
      interval.targetLufs !== SOURCE_TARGET_LUFS
    ) {
      throw new Error("Invalid published generation manifest source dialogue interval");
    }
    sourceResults.push(interval as unknown as SourceIntervalResult);
  }
  const expectedSourceGains = deriveSharedSourceGains(
    sourceResults.map(({ startSeconds, endSeconds }) => ({ startSeconds, endSeconds })),
    sourceResults.map(({ measuredLufsA }) => measuredLufsA),
    sourceResults.map(({ measuredLufsB }) => measuredLufsB)
  );
  if (sourceResults.length !== expectedSourceIntervals.length) {
    throw new Error("Invalid published generation manifest source dialogue interval count");
  }
  for (const [index, expectedGain] of expectedSourceGains.entries()) {
    const actual = sourceResults[index]!;
    const expectedInterval = expectedSourceIntervals[index]!;
    if (
      timingDiffers(actual.startSeconds, expectedInterval.startSeconds) ||
      timingDiffers(actual.endSeconds, expectedInterval.endSeconds)
    ) {
      throw new Error("Invalid published generation manifest source dialogue interval timing");
    }
    for (const key of [
      "startSeconds",
      "endSeconds",
      "measuredLufsA",
      "measuredLufsB",
      "averageMeasuredLufs",
      "targetLufs",
      "gainDb"
    ] as const) {
      if (actual[key] !== expectedGain[key]) {
        throw new Error("Invalid published generation manifest source dialogue gain");
      }
    }
  }
  try {
    assertSourceOutputLoudness(
      expectedSourceGains,
      sourceResults.map(({ outputLufsA }) => outputLufsA),
      sourceResults.map(({ outputLufsB }) => outputLufsB)
    );
  } catch {
    throw new Error("Invalid published generation manifest source dialogue output");
  }

  if (candidate.logoEvidence.length !== 2) {
    throw new Error("Invalid published generation manifest logo evidence");
  }
  for (const variant of variants) {
    const evidence = candidate.logoEvidence.find(
      (record) => isRecord(record) && record.name === variant.name
    );
    const expectedTimes = [
      Math.min(0.5, variant.outputDurationSeconds / 4),
      variant.outputDurationSeconds / 2,
      Math.max(0, variant.outputDurationSeconds - 0.5)
    ].map(roundedSeconds);
    if (
      !isRecord(evidence) ||
      !hasExactKeys(evidence, ["name", "samples"]) ||
      !Array.isArray(evidence.samples) ||
      evidence.samples.length !== expectedTimes.length
    ) {
      throw new Error("Invalid published generation manifest logo evidence");
    }
    for (const [index, sample] of evidence.samples.entries()) {
      if (
        !isRecord(sample) ||
        !hasExactKeys(sample, ["timeSeconds", "inputSha256", "outputSha256"]) ||
        !Number.isFinite(sample.timeSeconds) ||
        timingDiffers(sample.timeSeconds as number, expectedTimes[index]!) ||
        typeof sample.inputSha256 !== "string" ||
        !/^[a-f0-9]{64}$/.test(sample.inputSha256) ||
        typeof sample.outputSha256 !== "string" ||
        !/^[a-f0-9]{64}$/.test(sample.outputSha256) ||
        sample.inputSha256 === sample.outputSha256
      ) {
        throw new Error("Invalid published generation manifest logo evidence sample");
      }
    }
  }
  for (const variant of variants) {
    const expectedTiming = deriveOutroTiming(
      variant.inputDurationSeconds,
      expectedAudio.outroDurationSeconds
    );
    if (
      timingDiffers(outro.durationSeconds as number, expectedTiming.durationSeconds) ||
      timingDiffers(outro.startSeconds as number, expectedTiming.startSeconds) ||
      timingDiffers(outro.fadeOutSeconds as number, expectedTiming.fadeOutSeconds)
    ) {
      throw new Error("Invalid published generation manifest outro timing");
    }
  }
  return value as unknown as PublishedGenerationManifest;
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
  const productionPath = join(episodeDir, "production.json");
  const voicePath = join(episodeDir, "voice", "narration.json");
  const planPath = join(episodeDir, "tella", "plan.json");
  const statePath = join(episodeDir, "tella", "state.json");
  const preparedPath = join(episodeDir, "reports", "prepared.json");
  const sourceMatrixPath = join(episodeDir, "reports", "source-matrix.md");
  const sourceManifestPath = join(episodeDir, "reports", "source-manifest.json");
  const exportReceiptPath = tellaExportReceiptPath(episodeDir);
  const inputPaths = [
    join(episodeDir, "exports", "tella-a.mp4"),
    join(episodeDir, "exports", "tella-b.mp4")
  ] as const;
  const reportPath = options.reportPath ?? join(episodeDir, "reports", "post-production.json");
  const lstat = dependencies.lstat ?? defaultLstat;
  const realpath = dependencies.realpath ?? defaultRealpath;
  const readFile = dependencies.readFile ?? (defaultReadFile as ReadText);
  const readFileBytes = dependencies.readFileBytes ??
    ((path: string) => defaultReadFile(path) as Promise<Uint8Array>);

  await validateContainedPaths(
    episodeDir,
    [
      productionPath,
      voicePath,
      planPath,
      statePath,
      preparedPath,
      sourceMatrixPath,
      sourceManifestPath,
      exportReceiptPath,
      ...inputPaths,
      finalPaths[0],
      finalPaths[1],
      reportPath
    ],
    lstat,
    realpath
  );
  let productionText: string;
  let voiceText: string;
  let planText: string;
  let stateText: string;
  let preparedText: string;
  let sourceMatrix: string;
  let sourceManifestText: string;
  let manifestText: string;
  let exportReceiptText: string;
  try {
    [
      productionText,
      voiceText,
      planText,
      stateText,
      preparedText,
      sourceMatrix,
      sourceManifestText,
      exportReceiptText,
      manifestText
    ] = await Promise.all([
      readFile(productionPath, "utf8"),
      readFile(voicePath, "utf8"),
      readFile(planPath, "utf8"),
      readFile(statePath, "utf8"),
      readFile(preparedPath, "utf8"),
      readFile(sourceMatrixPath, "utf8"),
      readFile(sourceManifestPath, "utf8"),
      readFile(exportReceiptPath, "utf8"),
      readFile(reportPath, "utf8")
    ]);
  } catch (error) {
    throw new Error(
      `Published generation manifest is missing or unreadable: ${error instanceof Error ? error.message : String(error)}`
    );
  }
  const parseJson = (text: string, label: string): unknown => {
    try {
      return JSON.parse(text);
    } catch {
      throw new Error(`Invalid ${label} JSON`);
    }
  };
  const productionValue = parseJson(productionText, "production manifest");
  const voiceValue = parseJson(voiceText, "voice manifest");
  const planValue = parseJson(planText, "Tella plan");
  const sourceManifestValue = parseJson(sourceManifestText, "source manifest");
  const tellaStateValue = parseJson(stateText, "Tella state");
  const plan = parseFinishPlan(planText);
  const expectedProgramAudio = buildProgramAudioPlan(episodeDir, plan as TellaPlan);
  const prepared = await validateCurrentPreparation({
    episodeDir,
    production: productionValue,
    voice: voiceValue,
    plan: planValue,
    sourceMatrix,
    sourceManifest: sourceManifestValue,
    prepared: parseJson(preparedText, "prepared generation"),
    lstat,
    readFileBytes,
    realpath
  });
  validateTellaTimelineAudit(plan, tellaStateValue);
  const tellaExportReceipt = await defaultValidateSealedTellaExports({
    episodeDir,
    receipt: parseJson(exportReceiptText, "Tella export receipt"),
    tellaState: tellaStateValue
  }, { readFileBytes });
  const productionContract = parsePublishedAudioContract(productionText);
  let logoBytes: Uint8Array;
  try {
    logoBytes = await readFileBytes(productionContract.logoPath);
  } catch (error) {
    throw new Error(
      `Published generation logo is missing or unreadable: ${error instanceof Error ? error.message : String(error)}`
    );
  }
  const expectedAudio: PublishedAudioContract = {
    ...productionContract,
    logoSha256: createHash("sha256").update(logoBytes).digest("hex")
  };
  const expectedSourceIntervals = deriveSourceDuckIntervals(plan);
  const manifest = parsePublishedGenerationManifest(
    manifestText,
    expectedAudio,
    expectedProgramAudio,
    expectedSourceIntervals,
    tellaExportReceipt,
    plan as TellaPlan,
    prepared.manifestFingerprint
  );

  await validateContainedPaths(
    episodeDir,
    [
      ...inputPaths,
      ...expectedProgramAudio.inputs.map(({ path }) => path),
      finalPaths[0],
      finalPaths[1]
    ],
    lstat,
    realpath
  );
  for (const [index, name] of (["version-a", "version-b"] as const).entries()) {
    const bytes = await readFileBytes(inputPaths[index]!);
    const expected = manifest.variants.find((variant) => variant.name === name)!;
    const actualSha256 = createHash("sha256").update(bytes).digest("hex");
    if (bytes.byteLength !== expected.inputByteSize || actualSha256 !== expected.inputSha256) {
      throw new Error(
        `Published Tella input mismatch for ${name}: expected ` +
        `${expected.inputByteSize} bytes/${expected.inputSha256}, received ` +
        `${bytes.byteLength} bytes/${actualSha256}`
      );
    }
  }
  const programAudioBindings = manifest.programAudio.inputs;
  for (const [index, expected] of programAudioBindings.entries()) {
    const input = expectedProgramAudio.inputs[index]!;
    const bytes = await readFileBytes(input.path);
    const actualSha256 = createHash("sha256").update(bytes).digest("hex");
    if (bytes.byteLength !== expected.byteSize || actualSha256 !== expected.sha256) {
      throw new Error(
        `Published program audio mismatch for ${expected.clipId}: expected ` +
        `${expected.byteSize} bytes/${expected.sha256}, received ` +
        `${bytes.byteLength} bytes/${actualSha256}`
      );
    }
  }
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
    preparationFingerprint: manifest.preparationFingerprint,
    preparedArtifacts: prepared.artifacts.map((artifact) => ({ ...artifact })),
    reportSha256: createHash("sha256").update(manifestText).digest("hex"),
    variants: (["version-a", "version-b"] as const).map((name) => {
      const variant = manifest.variants.find((record) => record.name === name)!;
      return {
        name,
        inputSha256: variant.inputSha256,
        inputByteSize: variant.inputByteSize,
        sha256: variant.sha256,
        byteSize: variant.byteSize
      };
    }),
    programAudio: programAudioBindings.map((input) => ({ ...input })),
    tellaExports: [
      { ...tellaExportReceipt.exports[0] },
      { ...tellaExportReceipt.exports[1] }
    ],
    sourceFullscreen: manifest.sourceFullscreen.map((record) => ({ ...record })),
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

async function finishGptLiveProductionUnlocked(
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
  const validateSealedExports = dependencies.validateSealedTellaExports ??
    ((input: Parameters<typeof defaultValidateSealedTellaExports>[0]) =>
      defaultValidateSealedTellaExports(input, { readFileBytes }));
  const verifySourceFullscreen = dependencies.verifySourceFullscreen ??
    ((input: Parameters<typeof defaultVerifySourceFullscreen>[0]) =>
      defaultVerifySourceFullscreen(input, { runCommand }));

  const ffmpegPath = requireConfiguredValue(options.ffmpegPath, "ffmpeg path");
  const ffprobePath = requireConfiguredValue(options.ffprobePath, "ffprobe path");
  const logoPath = requireConfiguredValue(options.env.AIMH_LOGO_PATH, "AIMH logo path");
  const outroMusicPath = requireConfiguredValue(
    options.env.AIMH_OUTRO_MUSIC_PATH,
    "AIMH outro music path"
  );
  try {
    await access(logoPath, constants.R_OK);
  } catch {
    throw new Error("GPT-Live finish preflight failed: AIMH logo is not readable");
  }
  try {
    await access(outroMusicPath, constants.R_OK);
  } catch {
    throw new Error("GPT-Live finish preflight failed: AIMH outro music is not readable");
  }

  const planPath = join(options.episodeDir, "tella", "plan.json");
  const statePath = join(options.episodeDir, "tella", "state.json");
  const productionPath = join(options.episodeDir, "production.json");
  const voicePath = join(options.episodeDir, "voice", "narration.json");
  const exportsDirectory = join(options.episodeDir, "exports");
  const finalDirectory = join(options.episodeDir, "final");
  const reportsDirectory = join(options.episodeDir, "reports");
  const inputPaths = [join(exportsDirectory, "tella-a.mp4"), join(exportsDirectory, "tella-b.mp4")];
  const finalPaths = [join(finalDirectory, "version-a.mp4"), join(finalDirectory, "version-b.mp4")];
  const reportPath = join(reportsDirectory, "post-production.json");
  const preparedPath = join(reportsDirectory, "prepared.json");
  const sourceMatrixPath = join(reportsDirectory, "source-matrix.md");
  const sourceManifestPath = join(reportsDirectory, "source-manifest.json");
  const exportReceiptPath = tellaExportReceiptPath(options.episodeDir);
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
      statePath,
      productionPath,
      voicePath,
      preparedPath,
      sourceMatrixPath,
      sourceManifestPath,
      exportReceiptPath,
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
  const [productionText, voiceText, planText, stateText, preparedText, sourceMatrix, sourceManifestText, exportReceiptText] =
    await Promise.all([
      readFile(productionPath, "utf8"),
      readFile(voicePath, "utf8"),
      readFile(planPath, "utf8"),
      readFile(statePath, "utf8"),
      readFile(preparedPath, "utf8"),
      readFile(sourceMatrixPath, "utf8"),
      readFile(sourceManifestPath, "utf8"),
      readFile(exportReceiptPath, "utf8")
    ]);
  const parseJson = (text: string, label: string): unknown => {
    try {
      return JSON.parse(text);
    } catch {
      throw new Error(`Invalid ${label} JSON`);
    }
  };
  const productionValue = parseJson(productionText, "production manifest");
  const voiceValue = parseJson(voiceText, "voice manifest");
  const planValue = parseJson(planText, "Tella plan");
  const sourceManifestValue = parseJson(sourceManifestText, "source manifest");
  const tellaStateValue = parseJson(stateText, "Tella state");
  const exportReceiptValue = parseJson(exportReceiptText, "Tella export receipt");
  const plan = parseFinishPlan(planText);
  const preparedAudioContract = parsePublishedAudioContract(productionText);
  if (logoPath !== preparedAudioContract.logoPath) {
    throw new Error("Runtime logo path does not match the prepared production asset path");
  }
  if (outroMusicPath !== preparedAudioContract.outroMusicPath) {
    throw new Error("Runtime outro path does not match the prepared production asset path");
  }
  const prepared = await validateCurrentPreparation({
    episodeDir: options.episodeDir,
    production: productionValue,
    voice: voiceValue,
    plan: planValue,
    sourceMatrix,
    sourceManifest: sourceManifestValue,
    prepared: parseJson(preparedText, "prepared generation"),
    lstat,
    readFileBytes,
    realpath
  });
  validateTellaTimelineAudit(plan, tellaStateValue);
  const tellaExportReceipt: TellaExportReceipt = await validateSealedExports({
    episodeDir: options.episodeDir,
    receipt: exportReceiptValue,
    tellaState: tellaStateValue
  });
  const programAudio = buildProgramAudioPlan(options.episodeDir, plan as TellaPlan);
  const duckIntervals = deriveSourceDuckIntervals(plan);
  await mkdir(finalDirectory, { recursive: true });
  await mkdir(reportsDirectory, { recursive: true });
  await validateContainedPaths(
    options.episodeDir,
    [
      exportsDirectory,
      ...inputPaths,
      ...programAudio.inputs.map(({ path }) => path),
      finalDirectory,
      ...finalPaths,
      reportsDirectory,
      reportPath
    ],
    lstat,
    realpath
  );
  const inputBytes = await Promise.all(inputPaths.map((path) => readFileBytes(path)));
  const inputIntegrity = inputBytes.map((bytes) => ({
    inputSha256: createHash("sha256").update(bytes).digest("hex"),
    inputByteSize: bytes.byteLength
  }));
  const programAudioBindings = await Promise.all(programAudio.inputs.map(async (input) => {
    const bytes = await readFileBytes(input.path);
    return {
      clipId: input.clipId,
      kind: input.kind,
      path: input.relativePath,
      sha256: createHash("sha256").update(bytes).digest("hex"),
      byteSize: bytes.byteLength,
      durationSeconds: input.durationSeconds
    };
  }));
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
    inputInspections.forEach((inspection, index) =>
      assertTellaProgramDuration(plan, inspection.durationSeconds, `version ${index === 0 ? "A" : "B"} export`)
    );
    assertSharedOutroTiming(
      inputInspections.map(({ durationSeconds }) => durationSeconds),
      GPT_LIVE_CONTENT.audio.outroDurationSeconds,
      "GPT-Live finish preflight failed"
    );
    const sourceFullscreen: SourceFullscreenEvidence[] = await verifySourceFullscreen({
      ffmpegPath,
      plan: plan as TellaPlan,
      exportPaths: {
        "version-a": inputPaths[0]!,
        "version-b": inputPaths[1]!
      }
    });
    const sourceInputs = programAudio.inputs.filter((input) => input.kind === "source_clip");
    const sourceLoudness = await Promise.all(
      sourceInputs.map((input) =>
        measure(ffmpegPath, input.path, {
          startSeconds: 0,
          endSeconds: input.durationSeconds
        }))
    );
    const sourceGains = deriveSharedSourceGains(
      duckIntervals,
      sourceLoudness,
      sourceLoudness
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
          programAudio,
          outroMusicPath,
          outroDurationSeconds: GPT_LIVE_CONTENT.audio.outroDurationSeconds,
          outputPath: stagedPaths[index]!,
          durationSeconds: inputInspections[index]!.durationSeconds,
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
      ...inputIntegrity[index]!,
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
            preparationFingerprint: prepared.manifestFingerprint,
            logoPath,
            outroMusicPath,
            outroDurationSeconds: GPT_LIVE_CONTENT.audio.outroDurationSeconds,
            logoSha256,
            programAudio: programAudioBindings,
            sourceGains: sourceResults,
            logoEvidence,
            tellaExports: tellaExportReceipt.exports,
            sourceFullscreen,
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

export async function finishGptLiveProduction(
  options: FinishGptLiveProductionOptions,
  dependencies: FinishGptLiveDependencies = {}
): Promise<FinishGptLiveProductionResult> {
  const withProductionLock = dependencies.withProductionLock ?? withEpisodeProductionLock;
  return withProductionLock(options.episodeDir, "finish", () =>
    finishGptLiveProductionUnlocked(options, dependencies));
}
