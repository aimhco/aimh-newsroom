import { runCommand as defaultRunCommand } from "../../render/process";
import type { TellaExportReceipt } from "./tellaExportReceipt";
import type { TellaPlan } from "./tellaPlan";
import type { TellaTimelineAudit } from "./tellaState";

export const SOURCE_FULLSCREEN_SSIM_THRESHOLD = 0.9 as const;

export type SourceFullscreenVersion = "version-a" | "version-b";

export interface SourceFullscreenExpectation {
  readonly version: SourceFullscreenVersion;
  readonly clipId: string;
  readonly sampleFraction: 0.1 | 0.5 | 0.9;
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
  readonly sourceFrameOffset?: -2 | -1 | 0 | 1 | 2;
}

export interface VerifySourceFullscreenOptions {
  readonly ffmpegPath: string;
  readonly plan: TellaPlan;
  readonly exportPaths: Record<SourceFullscreenVersion, string>;
  readonly timing: SourceFullscreenTiming;
}

export interface SourceFullscreenTiming {
  readonly narrationDurationMs: Record<SourceFullscreenVersion, readonly number[]>;
  readonly sourceDurationMs: Record<SourceFullscreenVersion, readonly number[]>;
}

export interface SourceFullscreenDependencies {
  readonly runCommand?: typeof defaultRunCommand;
}

const VERSIONS = ["version-a", "version-b"] as const;
const SAMPLE_FRACTIONS = [0.1, 0.5, 0.9] as const;
const SOURCE_FRAME_OFFSETS = [-2, -1, 0, 1, 2] as const;
const EVIDENCE_KEYS = [
  "version",
  "clipId",
  "sampleFraction",
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
  plan: TellaPlan,
  timing: SourceFullscreenTiming
): SourceFullscreenExpectation[] {
  const narrationCount = plan.clips.filter((clip) => clip.kind === "narration").length;
  const sourceCount = plan.clips.filter((clip) => clip.kind === "source_clip").length;
  const samples = VERSIONS.flatMap((version) => {
    const narrationDurations = timing.narrationDurationMs[version];
    const sourceDurations = timing.sourceDurationMs[version];
    if (!Array.isArray(narrationDurations) || narrationDurations.length !== narrationCount) {
      return fail(`${version} audited narration duration coverage is invalid`);
    }
    if (!Array.isArray(sourceDurations) || sourceDurations.length !== sourceCount) {
      return fail(`${version} audited source duration coverage is invalid`);
    }
    let startSeconds = 0;
    let narrationIndex = 0;
    let sourceIndex = 0;
    const versionSamples: SourceFullscreenExpectation[] = [];
    for (const clip of plan.clips) {
      if (!Number.isFinite(clip.durationSeconds) || clip.durationSeconds <= 0) {
        fail(`plan duration is invalid for ${clip.id}`);
      }
      if (clip.kind === "source_clip") {
        const remoteDurationMs = sourceDurations[sourceIndex];
        if (!Number.isSafeInteger(remoteDurationMs) || (remoteDurationMs as number) <= 0) {
          fail(`${version} audited source duration is invalid for ${clip.id}`);
        }
        const remoteDurationSeconds = (remoteDurationMs as number) / 1_000;
        for (const sampleFraction of SAMPLE_FRACTIONS) {
          versionSamples.push({
            version,
            clipId: clip.id,
            sampleFraction,
            exportTimeSeconds: roundedSeconds(
              startSeconds + remoteDurationSeconds * sampleFraction
            ),
            sourceTimeSeconds: roundedSeconds(clip.durationSeconds * sampleFraction)
          });
        }
        startSeconds += remoteDurationSeconds;
        sourceIndex += 1;
      } else {
        const durationMs = narrationDurations[narrationIndex];
        if (!Number.isSafeInteger(durationMs) || (durationMs as number) <= 0) {
          fail(`${version} audited narration duration is invalid for ${clip.id}`);
        }
        startSeconds += (durationMs as number) / 1_000;
        narrationIndex += 1;
      }
    }
    return versionSamples;
  });
  if (samples.length === 0) fail("plan has no source clips");
  return samples;
}

export function buildSourceFullscreenTiming(
  receipt: TellaExportReceipt,
  audit: TellaTimelineAudit
): SourceFullscreenTiming {
  const durationsFor = (version: SourceFullscreenVersion): readonly number[] => {
    const record = receipt.exports.find((candidate) => candidate.version === version);
    if (!record) return fail(`${version} receipt record is missing`);
    return audit.narrationLayouts[record.sourceVariant].map(({ clipDurationMs }) => clipDurationMs);
  };
  const sourceDurationsFor = (version: SourceFullscreenVersion): readonly number[] => {
    const record = receipt.exports.find((candidate) => candidate.version === version);
    if (!record) return fail(`${version} receipt record is missing`);
    return audit.sourceClips[record.sourceVariant].map(({ durationMs }) => durationMs);
  };
  return {
    narrationDurationMs: {
      "version-a": durationsFor("version-a"),
      "version-b": durationsFor("version-b")
    },
    sourceDurationMs: {
      "version-a": sourceDurationsFor("version-a"),
      "version-b": sourceDurationsFor("version-b")
    }
  };
}

export function buildSourceFullscreenSsimArgs(
  options: BuildSourceFullscreenSsimArgsOptions
): string[] {
  const exportFrameIndex = frameIndexAt30Fps(options.exportTimeSeconds);
  const sourceFrameIndex = Math.max(
    0,
    frameIndexAt30Fps(options.sourceTimeSeconds) + (options.sourceFrameOffset ?? 0)
  );
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
  const scores = await Promise.all(SOURCE_FRAME_OFFSETS.map(async (sourceFrameOffset) => {
    const result = await runCommand(ffmpegPath, buildSourceFullscreenSsimArgs({
      exportPath,
      sourcePath,
      exportTimeSeconds,
      sourceTimeSeconds,
      sourceFrameOffset
    }));
    return parseSourceFullscreenSsim(`${result.stdout}\n${result.stderr}`);
  }));
  return Math.max(...scores);
}

export function assertSourceFullscreenEvidence(
  plan: TellaPlan,
  value: unknown,
  timing: SourceFullscreenTiming
): SourceFullscreenEvidence[] {
  const expected = deriveSourceFullscreenExpectations(plan, timing);
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
      candidate.sampleFraction !== expectation.sampleFraction ||
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
  for (const expectation of deriveSourceFullscreenExpectations(options.plan, options.timing)) {
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
  return assertSourceFullscreenEvidence(options.plan, records, options.timing);
}
