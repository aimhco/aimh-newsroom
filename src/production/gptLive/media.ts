import {
  ffprobeDurationSeconds as defaultFfprobeDurationSeconds,
  runCommand as defaultRunCommand
} from "../../render/process";
import { resolveVimeoHlsUrl as defaultResolveVimeoHlsUrl } from "./vimeo";

const DURATION_TOLERANCE_SECONDS = 0.25;

export interface ClipArgsOptions {
  readonly inputUrl: string;
  readonly startSeconds: number;
  readonly endSeconds: number;
  readonly outputPath: string;
}

export interface ExtractSourceClipOptions {
  readonly playerConfigUrl: string;
  readonly startSeconds: number;
  readonly endSeconds: number;
  readonly outputPath: string;
  readonly ffmpegPath: string;
  readonly ffprobePath: string;
}

export interface ExtractSourceClipDependencies {
  readonly resolveVimeoHlsUrl?: typeof defaultResolveVimeoHlsUrl;
  readonly runCommand?: typeof defaultRunCommand;
  readonly ffprobeDurationSeconds?: typeof defaultFfprobeDurationSeconds;
}

const validateClipRange = (startSeconds: number, endSeconds: number): void => {
  if (!Number.isFinite(startSeconds) || startSeconds < 0) {
    throw new Error("Invalid clip range: startSeconds must be finite and nonnegative");
  }
  if (!Number.isFinite(endSeconds) || endSeconds <= startSeconds) {
    throw new Error("Invalid clip range: endSeconds must be finite and greater than startSeconds");
  }
};

export function buildClipArgs(options: ClipArgsOptions): string[] {
  validateClipRange(options.startSeconds, options.endSeconds);

  return [
    "-y",
    "-i",
    options.inputUrl,
    "-ss",
    options.startSeconds.toFixed(3),
    "-t",
    (options.endSeconds - options.startSeconds).toFixed(3),
    "-vf",
    "scale=1920:1080:force_original_aspect_ratio=decrease,pad=1920:1080:(ow-iw)/2:(oh-ih)/2,setsar=1",
    "-r",
    "30",
    "-c:v",
    "libx264",
    "-crf",
    "18",
    "-preset",
    "medium",
    "-c:a",
    "aac",
    "-b:a",
    "192k",
    "-ar",
    "48000",
    "-ac",
    "2",
    options.outputPath
  ];
}

export async function extractSourceClip(
  options: ExtractSourceClipOptions,
  dependencies: ExtractSourceClipDependencies = {}
): Promise<void> {
  validateClipRange(options.startSeconds, options.endSeconds);

  const resolveVimeoHlsUrl = dependencies.resolveVimeoHlsUrl ?? defaultResolveVimeoHlsUrl;
  const runCommand = dependencies.runCommand ?? defaultRunCommand;
  const ffprobeDurationSeconds =
    dependencies.ffprobeDurationSeconds ?? defaultFfprobeDurationSeconds;
  let inputUrl: string;
  try {
    inputUrl = await resolveVimeoHlsUrl(options.playerConfigUrl);
  } catch {
    throw new Error("Source clip playlist resolution failed");
  }

  try {
    await runCommand(
      options.ffmpegPath,
      buildClipArgs({
        inputUrl,
        startSeconds: options.startSeconds,
        endSeconds: options.endSeconds,
        outputPath: options.outputPath
      })
    );
  } catch {
    throw new Error("Source clip extraction command failed");
  }

  let actualDuration: number;
  try {
    actualDuration = await ffprobeDurationSeconds(options.ffprobePath, options.outputPath);
  } catch {
    throw new Error("Source clip duration verification failed");
  }

  const expectedDuration = options.endSeconds - options.startSeconds;
  if (
    !Number.isFinite(actualDuration) ||
    Math.abs(actualDuration - expectedDuration) > DURATION_TOLERANCE_SECONDS
  ) {
    throw new Error(
      `Source clip duration mismatch: expected ${expectedDuration.toFixed(3)}s, received ${actualDuration.toFixed(3)}s (tolerance ${DURATION_TOLERANCE_SECONDS.toFixed(3)}s)`
    );
  }
}
