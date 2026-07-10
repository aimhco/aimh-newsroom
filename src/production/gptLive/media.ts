import { mkdir as defaultMkdir } from "node:fs/promises";
import { dirname } from "node:path";
import {
  ffprobeDurationSeconds as defaultFfprobeDurationSeconds,
  runCommand as defaultRunCommand
} from "../../render/process";
import { redactText } from "../../utils/redact";
import {
  VimeoHlsError,
  resolveVimeoHlsUrl as defaultResolveVimeoHlsUrl
} from "./vimeo";

const DURATION_TOLERANCE_SECONDS = 0.25;
const DURATION_COMPARISON_EPSILON_SECONDS = 1e-9;
const SAFE_ERROR_CODE = /^[A-Z][A-Z0-9_-]{0,31}$/;

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
  readonly mkdir?: (path: string, options: { readonly recursive: true }) => Promise<unknown>;
  readonly runCommand?: typeof defaultRunCommand;
  readonly ffprobeDurationSeconds?: typeof defaultFfprobeDurationSeconds;
}

const asErrorRecord = (error: unknown): Record<string, unknown> | undefined =>
  error !== null && typeof error === "object" ? (error as Record<string, unknown>) : undefined;

const safeErrorCode = (error: unknown): string | undefined => {
  const code = asErrorRecord(error)?.code;
  const value = typeof code === "number" ? String(code) : code;
  return typeof value === "string" && SAFE_ERROR_CODE.test(value) ? value : undefined;
};

const knownSensitiveValues = (urls: readonly string[]): string[] => {
  const values = new Set<string>();
  for (const url of urls) {
    if (url) values.add(url);
    try {
      const parsed = new URL(url);
      if (parsed.search) values.add(parsed.search);
      for (const value of parsed.searchParams.values()) {
        if (value) values.add(value);
      }
    } catch {
      // The full value is still removed even if it is not a valid URL.
    }
  }
  return [...values].sort((left, right) => right.length - left.length);
};

const sanitizedDiagnostic = (error: unknown, knownUrls: readonly string[]): string | undefined => {
  if (!(error instanceof Error) || !error.message) return undefined;

  const sensitiveValues = knownSensitiveValues(knownUrls);
  let message = error.message;
  for (const value of sensitiveValues) {
    message = message.split(value).join("***");
  }
  message = message.replace(/https?:\/\/[^\s"'<>]+/gi, "[redacted URL]");
  message = redactText(message, sensitiveValues);
  message = message.replace(
    /\b[A-Za-z0-9_.-]*(?:token|secret|password|signature|expires)[A-Za-z0-9_.-]*\s*=\s*\S+/gi,
    "[redacted]"
  );
  message = message.replace(/\?[^\s]+/g, "?[redacted]").replace(/\s+/g, " ").trim();
  return message ? message.slice(0, 240) : undefined;
};

const contextualError = (
  context: string,
  error: unknown,
  knownUrls: readonly string[] = []
): Error => {
  const code = safeErrorCode(error);
  if (code) return new Error(`${context} (code ${code})`);

  const message = error instanceof Error ? error.message : "";
  const exitCode = message.match(/\bexited\s+(-?\d+)\b/i)?.[1];
  if (exitCode) return new Error(`${context} (exit ${exitCode})`);

  const diagnostic = sanitizedDiagnostic(error, knownUrls);
  if (!diagnostic && error instanceof VimeoHlsError) {
    return new Error(`${context} (${error.category})`);
  }
  return new Error(diagnostic ? `${context}: ${diagnostic}` : context);
};

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
  const mkdir = dependencies.mkdir ?? defaultMkdir;
  const runCommand = dependencies.runCommand ?? defaultRunCommand;
  const ffprobeDurationSeconds =
    dependencies.ffprobeDurationSeconds ?? defaultFfprobeDurationSeconds;
  let inputUrl: string;
  try {
    inputUrl = await resolveVimeoHlsUrl(options.playerConfigUrl);
  } catch (error) {
    throw contextualError("Source clip playlist resolution failed", error, [options.playerConfigUrl]);
  }

  try {
    await mkdir(dirname(options.outputPath), { recursive: true });
  } catch (error) {
    throw contextualError("Source clip output directory creation failed", error, [inputUrl]);
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
  } catch (error) {
    throw contextualError("Source clip extraction command failed", error, [inputUrl]);
  }

  let actualDuration: number;
  try {
    actualDuration = await ffprobeDurationSeconds(options.ffprobePath, options.outputPath);
  } catch (error) {
    throw contextualError("Source clip duration verification failed", error, [inputUrl]);
  }

  const expectedDurationText = (options.endSeconds - options.startSeconds).toFixed(3);
  const expectedDuration = Number(expectedDurationText);
  if (
    !Number.isFinite(actualDuration) ||
    Math.abs(actualDuration - expectedDuration) >
      DURATION_TOLERANCE_SECONDS + DURATION_COMPARISON_EPSILON_SECONDS
  ) {
    throw new Error(
      `Source clip duration mismatch: expected ${expectedDurationText}s, received ${actualDuration.toFixed(3)}s (tolerance ${DURATION_TOLERANCE_SECONDS.toFixed(3)}s)`
    );
  }
}
