import { runCommand as defaultRunCommand } from "../../render/process";

const DURATION_TOLERANCE_SECONDS = 0.1;
const FRAME_RATE_TOLERANCE = 0.001;

export interface MediaInspection {
  readonly durationSeconds: number;
  readonly video: {
    readonly codecName: string;
    readonly width: number;
    readonly height: number;
    readonly framesPerSecond: number;
  };
  readonly audio?: {
    readonly codecName: string;
  };
}

interface FfprobeStream {
  readonly codec_type?: unknown;
  readonly codec_name?: unknown;
  readonly width?: unknown;
  readonly height?: unknown;
  readonly r_frame_rate?: unknown;
}

const frameRate = (value: unknown): number => {
  if (typeof value !== "string") return Number.NaN;
  const [numeratorText, denominatorText = "1"] = value.split("/");
  const numerator = Number(numeratorText);
  const denominator = Number(denominatorText);
  return denominator === 0 ? Number.NaN : numerator / denominator;
};

export const buildFfprobeMediaArgs = (file: string): string[] => [
  "-v",
  "error",
  "-show_entries",
  "stream=codec_type,codec_name,width,height,r_frame_rate:format=duration",
  "-of",
  "json",
  file
];

export function parseFfprobeMediaJson(text: string): MediaInspection {
  let parsed: { readonly streams?: unknown; readonly format?: { readonly duration?: unknown } };
  try {
    parsed = JSON.parse(text) as typeof parsed;
  } catch {
    throw new Error("Invalid ffprobe media JSON");
  }

  if (!Array.isArray(parsed.streams)) throw new Error("Invalid ffprobe media streams");
  const streams = parsed.streams as FfprobeStream[];
  const video = streams.find((stream) => stream.codec_type === "video");
  const audio = streams.find((stream) => stream.codec_type === "audio");
  const durationSeconds = Number(parsed.format?.duration);
  const width = Number(video?.width);
  const height = Number(video?.height);
  const framesPerSecond = frameRate(video?.r_frame_rate);
  if (
    !video ||
    typeof video.codec_name !== "string" ||
    !Number.isFinite(width) ||
    !Number.isFinite(height) ||
    !Number.isFinite(framesPerSecond) ||
    !Number.isFinite(durationSeconds)
  ) {
    throw new Error("Invalid ffprobe media values");
  }

  return {
    durationSeconds,
    video: {
      codecName: video.codec_name,
      width,
      height,
      framesPerSecond
    },
    ...(audio && typeof audio.codec_name === "string"
      ? { audio: { codecName: audio.codec_name } }
      : {})
  };
}

export function assertNarrationSlateContract(
  inspection: MediaInspection,
  expectedDurationSeconds: number
): void {
  if (inspection.video.codecName !== "h264") {
    throw new Error("Narration slate must use H.264 video");
  }
  if (inspection.video.width !== 1920 || inspection.video.height !== 1080) {
    throw new Error("Narration slate must be 1920x1080");
  }
  if (Math.abs(inspection.video.framesPerSecond - 30) > FRAME_RATE_TOLERANCE) {
    throw new Error("Narration slate must be 30fps");
  }
  if (!inspection.audio) throw new Error("Narration slate must contain an audio stream");
  if (inspection.audio.codecName !== "aac") {
    throw new Error("Narration slate must use AAC audio");
  }
  if (
    !Number.isFinite(inspection.durationSeconds) ||
    Math.abs(inspection.durationSeconds - expectedDurationSeconds) > DURATION_TOLERANCE_SECONDS
  ) {
    throw new Error(
      `Narration slate duration mismatch: expected ${expectedDurationSeconds.toFixed(3)}s, received ${inspection.durationSeconds.toFixed(3)}s`
    );
  }
}

export async function inspectMediaFile(
  ffprobePath: string,
  file: string,
  runCommand: typeof defaultRunCommand = defaultRunCommand
): Promise<MediaInspection> {
  const result = await runCommand(ffprobePath, buildFfprobeMediaArgs(file));
  return parseFfprobeMediaJson(result.stdout);
}
