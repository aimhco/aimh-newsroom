import { runCommand as defaultRunCommand } from "../../render/process";
import type { TellaPlan } from "./tellaPlan";

export const SOURCE_FULLSCREEN_SSIM_THRESHOLD = 0.9 as const;

export type SourceFullscreenVersion = "version-a" | "version-b";

export interface SourceFullscreenExpectation {
  readonly version: SourceFullscreenVersion;
  readonly clipId: string;
  readonly exportTimeSeconds: number;
  readonly sourceTimeSeconds: number;
}

export interface SourceFullscreenEvidence extends SourceFullscreenExpectation {
  readonly ssim: number;
  readonly threshold: typeof SOURCE_FULLSCREEN_SSIM_THRESHOLD;
}

export interface BuildSourceFullscreenSsimArgsOptions {
  readonly exportPath: string;
  readonly sourcePath: string;
  readonly exportTimeSeconds: number;
  readonly sourceTimeSeconds: number;
}

export interface VerifySourceFullscreenOptions {
  readonly ffmpegPath: string;
  readonly plan: TellaPlan;
  readonly exportPaths: Record<SourceFullscreenVersion, string>;
}

export interface SourceFullscreenDependencies {
  readonly runCommand?: typeof defaultRunCommand;
}

const VERSIONS = ["version-a", "version-b"] as const;
const EVIDENCE_KEYS = [
  "version",
  "clipId",
  "exportTimeSeconds",
  "sourceTimeSeconds",
  "ssim",
  "threshold"
] as const;

const roundedSeconds = (value: number): number => Number(value.toFixed(6));
const frameIndexAt30Fps = (timeSeconds: number): number =>
  Math.max(0, Math.round(roundedSeconds(timeSeconds) * 30));

const fail = (detail: string): never => {
  throw new Error(`Invalid source fullscreen evidence: ${detail}`);
};

const isRecord = (value: unknown): value is Record<string, unknown> =>
  value !== null && typeof value === "object" && !Array.isArray(value);

export function deriveSourceFullscreenExpectations(
  plan: TellaPlan
): SourceFullscreenExpectation[] {
  let startSeconds = 0;
  const sourceSamples: Omit<SourceFullscreenExpectation, "version">[] = [];
  for (const clip of plan.clips) {
    if (!Number.isFinite(clip.durationSeconds) || clip.durationSeconds <= 0) {
      fail(`plan duration is invalid for ${clip.id}`);
    }
    if (clip.kind === "source_clip") {
      sourceSamples.push({
        clipId: clip.id,
        exportTimeSeconds: roundedSeconds(startSeconds + clip.durationSeconds / 2),
        sourceTimeSeconds: roundedSeconds(clip.durationSeconds / 2)
      });
    }
    startSeconds += clip.durationSeconds;
  }
  if (sourceSamples.length === 0) fail("plan has no source clips");
  return VERSIONS.flatMap((version) => sourceSamples.map((sample) => ({ version, ...sample })));
}

export function buildSourceFullscreenSsimArgs(
  options: BuildSourceFullscreenSsimArgsOptions
): string[] {
  const exportFrameIndex = frameIndexAt30Fps(options.exportTimeSeconds);
  const sourceFrameIndex = frameIndexAt30Fps(options.sourceTimeSeconds);
  return [
    "-hide_banner", "-loglevel", "info",
    "-i", options.exportPath,
    "-i", options.sourcePath,
    "-filter_complex",
    `[0:v]select='eq(n,${exportFrameIndex})',scale=1920:1080:force_original_aspect_ratio=disable,format=yuv420p,setpts=PTS-STARTPTS[export];` +
      `[1:v]select='eq(n,${sourceFrameIndex})',scale=1920:1080:force_original_aspect_ratio=disable,format=yuv420p,setpts=PTS-STARTPTS[source];` +
      "[export][source]ssim",
    "-frames:v", "1", "-an", "-f", "null", "-"
  ];
}

export function parseSourceFullscreenSsim(text: string): number {
  const matches = [...text.matchAll(/\bAll:([0-9]+(?:\.[0-9]+)?)/g)];
  const score = Number(matches.at(-1)?.[1]);
  if (!Number.isFinite(score) || score < 0 || score > 1) {
    throw new Error("Could not parse a valid FFmpeg SSIM All score");
  }
  return score;
}

export async function measureSourceFullscreenSsim(
  ffmpegPath: string,
  exportPath: string,
  sourcePath: string,
  exportTimeSeconds: number,
  sourceTimeSeconds: number,
  runCommand: typeof defaultRunCommand = defaultRunCommand
): Promise<number> {
  const result = await runCommand(ffmpegPath, buildSourceFullscreenSsimArgs({
    exportPath,
    sourcePath,
    exportTimeSeconds,
    sourceTimeSeconds
  }));
  return parseSourceFullscreenSsim(`${result.stdout}\n${result.stderr}`);
}

export function assertSourceFullscreenEvidence(
  plan: TellaPlan,
  value: unknown
): SourceFullscreenEvidence[] {
  const expected = deriveSourceFullscreenExpectations(plan);
  if (!Array.isArray(value) || value.length !== expected.length) {
    fail("coverage must contain every version/source pair exactly once");
  }
  const records = value as unknown[];
  return expected.map((expectation, index) => {
    const candidate = records[index];
    if (!isRecord(candidate)) return fail(`record ${index + 1} must be an object`);
    const keys = Object.keys(candidate);
    if (
      keys.length !== EVIDENCE_KEYS.length ||
      !EVIDENCE_KEYS.every((key) => Object.hasOwn(candidate, key)) ||
      candidate.version !== expectation.version ||
      candidate.clipId !== expectation.clipId ||
      candidate.exportTimeSeconds !== expectation.exportTimeSeconds ||
      candidate.sourceTimeSeconds !== expectation.sourceTimeSeconds ||
      candidate.threshold !== SOURCE_FULLSCREEN_SSIM_THRESHOLD ||
      !Number.isFinite(candidate.ssim) ||
      (candidate.ssim as number) < SOURCE_FULLSCREEN_SSIM_THRESHOLD ||
      (candidate.ssim as number) > 1
    ) {
      fail(`record ${index + 1} does not match the plan or SSIM threshold`);
    }
    return candidate as unknown as SourceFullscreenEvidence;
  });
}

export async function verifySourceFullscreen(
  options: VerifySourceFullscreenOptions,
  dependencies: SourceFullscreenDependencies = {}
): Promise<SourceFullscreenEvidence[]> {
  const runCommand = dependencies.runCommand ?? defaultRunCommand;
  const sources = new Map(
    options.plan.clips
      .filter((clip) => clip.kind === "source_clip")
      .map((clip) => [clip.id, clip.mediaPath])
  );
  const records: SourceFullscreenEvidence[] = [];
  for (const expectation of deriveSourceFullscreenExpectations(options.plan)) {
    const sourcePath = sources.get(expectation.clipId);
    if (!sourcePath) return fail(`source path is missing for ${expectation.clipId}`);
    const ssim = await measureSourceFullscreenSsim(
      options.ffmpegPath,
      options.exportPaths[expectation.version],
      sourcePath,
      expectation.exportTimeSeconds,
      expectation.sourceTimeSeconds,
      runCommand
    );
    records.push({ ...expectation, ssim, threshold: SOURCE_FULLSCREEN_SSIM_THRESHOLD });
  }
  return assertSourceFullscreenEvidence(options.plan, records);
}
