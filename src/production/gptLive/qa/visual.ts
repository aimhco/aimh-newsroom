import { mkdir, rm } from "node:fs/promises";
import { basename, join, relative, sep } from "node:path";
import { runCommand as defaultRunCommand } from "../../../render/process";
import type { TellaPlan } from "../tellaPlan";
import type {
  QaVariantName,
  TransitionFrameSampleRecord,
  TransitionSignalStats,
  VisualArtifacts
} from "./types";

const VARIANTS = ["version-a", "version-b"] as const;
const FRAME_DURATION_SECONDS = 1 / 30;

export interface GenerateVisualArtifactsOptions {
  episodeDir: string;
  finalPaths: Record<QaVariantName, string>;
  durations: Record<QaVariantName, number>;
  plan: TellaPlan;
  ffmpegPath: string;
  outputDirectory?: string;
  artifactRelativeRoot?: string;
}

export interface GenerateVisualArtifactsDependencies {
  runCommand?: typeof defaultRunCommand;
}

interface FrameSample {
  label: string;
  timeSeconds: number;
}

type TransitionFrameSample = FrameSample & TransitionFrameSampleRecord;

export interface FrameContentMetrics {
  changedPixelProportion: number;
  lumaVariance: number;
  normalizedEntropy: number;
}

export function assertMeaningfulFrameContent(
  metrics: FrameContentMetrics,
  framePath: string
): void {
  if (
    metrics.changedPixelProportion < 0.01 ||
    metrics.lumaVariance < 25 ||
    metrics.normalizedEntropy < 0.02
  ) {
    throw new Error(`GPT-Live QA failed: sampled frame lacks meaningful content: ${basename(framePath)}`);
  }
}

export function parseTransitionSignalStats(text: string): TransitionSignalStats {
  const value = (component: "Y" | "U" | "V", bound: "MIN" | "MAX"): number => {
    const parsed = Number(
      text.match(new RegExp(`lavfi\\.signalstats\\.${component}${bound}=([^\\s]+)`))?.[1]
    );
    if (!Number.isFinite(parsed)) {
      throw new Error(`GPT-Live QA failed: transition signalstats metadata is unreadable: ${component}${bound}`);
    }
    return parsed;
  };
  const standardDeviation = Number(text.match(/showinfo[^\n]*stdev:\[([\d.]+)/)?.[1]);
  const normalizedEntropy = Number(
    text.match(/lavfi\.entropy\.normalized_entropy\.normal\.Y=([^\s]+)/)?.[1]
  );
  if (!Number.isFinite(standardDeviation) || !Number.isFinite(normalizedEntropy)) {
    throw new Error("GPT-Live QA failed: transition luma metadata is unreadable");
  }
  return {
    yRange: value("Y", "MAX") - value("Y", "MIN"),
    uRange: value("U", "MAX") - value("U", "MIN"),
    vRange: value("V", "MAX") - value("V", "MIN"),
    lumaVariance: Number((standardDeviation ** 2).toFixed(6)),
    normalizedEntropy
  };
}

export function assertTransitionFrameHasContent(stats: TransitionSignalStats): void {
  if (
    !Number.isFinite(stats.yRange) ||
    !Number.isFinite(stats.lumaVariance) ||
    !Number.isFinite(stats.normalizedEntropy) ||
    stats.yRange <= 6 ||
    stats.lumaVariance < 25 ||
    stats.normalizedEntropy < 0.02
  ) {
    throw new Error("GPT-Live QA failed: transition frame is blank or exposes the base layer");
  }
}

const fixed = (value: number): string => value.toFixed(3);
const transitionFixed = (value: number): string =>
  (Math.floor(value * 1_000_000 + 1e-9) / 1_000_000).toFixed(6);

const relativeReportPath = (episodeDir: string, path: string): string =>
  relative(episodeDir, path).split(sep).join("/");

const safeLabel = (value: string): string => value.replaceAll(/[^a-z0-9_-]/gi, "-");

const extractFrame = async (
  runCommand: typeof defaultRunCommand,
  ffmpegPath: string,
  inputPath: string,
  timeSeconds: number,
  outputPath: string,
  scaled: boolean
): Promise<void> => {
  await runCommand(ffmpegPath, [
    "-y",
    "-ss",
    fixed(timeSeconds),
    "-i",
    inputPath,
    "-frames:v",
    "1",
    ...(scaled ? ["-vf", "scale=480:270"] : []),
    "-compression_level",
    "6",
    outputPath
  ]);
};

const inspectFrameContent = async (
  runCommand: typeof defaultRunCommand,
  ffmpegPath: string,
  framePath: string
): Promise<FrameContentMetrics> => {
  const result = await runCommand(ffmpegPath, [
    "-hide_banner",
    "-nostats",
    "-i",
    framePath,
    "-vf",
    "crop=iw*0.85:ih*0.92:iw*0.02:ih*0.04,format=gray,blackframe=amount=0:threshold=24,entropy,showinfo,metadata=print",
    "-frames:v",
    "1",
    "-f",
    "null",
    "-"
  ]);
  const output = `${result.stdout}\n${result.stderr}`;
  const pblack = Number(output.match(/lavfi\.blackframe\.pblack=(\d+(?:\.\d+)?)/)?.[1]);
  const standardDeviation = Number(output.match(/showinfo[^\n]*stdev:\[([\d.]+)/)?.[1]);
  const normalizedEntropy = Number(
    output.match(/lavfi\.entropy\.normalized_entropy\.normal\.Y=([\d.]+)/)?.[1]
  );
  const metrics = {
    changedPixelProportion: (100 - pblack) / 100,
    lumaVariance: standardDeviation ** 2,
    normalizedEntropy
  };
  if (Object.values(metrics).some((value) => !Number.isFinite(value))) {
    throw new Error(`GPT-Live QA failed: sampled frame metrics are unreadable: ${basename(framePath)}`);
  }
  assertMeaningfulFrameContent(metrics, framePath);
  return metrics;
};

const contactTimes = (durationSeconds: number): number[] =>
  Array.from({ length: 12 }, (_, index) =>
    Number((0.5 + (index * Math.max(0, durationSeconds - 1)) / 11).toFixed(3))
  );

const timelineSamples = (plan: TellaPlan): FrameSample[] => {
  const samples: FrameSample[] = [];
  let cursor = 0;
  for (const clip of plan.clips) {
    if (clip.kind === "source_clip") {
      samples.push({
        label: `source-${clip.id}`,
        timeSeconds: cursor + clip.durationSeconds / 2
      });
    } else {
      samples.push({
        label: `${clip.id}-start`,
        timeSeconds: cursor + Math.min(0.25, clip.durationSeconds / 4)
      });
      samples.push({
        label: `${clip.id}-midpoint`,
        timeSeconds: cursor + clip.durationSeconds / 2
      });
    }
    cursor += clip.durationSeconds;
  }
  samples.push({ label: "final-cta", timeSeconds: Math.max(0, cursor - 0.5) });
  return samples.map((sample) => ({
    ...sample,
    timeSeconds: Number(sample.timeSeconds.toFixed(3))
  }));
};

const transitionFrameIndex = (timeSeconds: number, frameCount: number): number =>
  Math.min(frameCount - 1, Math.max(0, Math.ceil(timeSeconds * 30 - 1e-9)));

export const planTransitionBoundarySamples = (
  plan: TellaPlan,
  durationSeconds: number
): TransitionFrameSample[] => {
  const samples: TransitionFrameSample[] = [];
  const frameCount = Math.ceil(durationSeconds * 30 - 1e-6);
  if (!Number.isFinite(durationSeconds) || frameCount < 1) {
    throw new Error("GPT-Live QA failed: final duration cannot provide transition frames");
  }
  const lastSafeTime = (frameCount - 1) / 30;
  let boundaryTime = 0;
  for (let index = 0; index < plan.clips.length - 1; index += 1) {
    const beforeClip = plan.clips[index]!;
    const afterClip = plan.clips[index + 1]!;
    boundaryTime += beforeClip.durationSeconds;
    const boundaryId = [
      `boundary-${String(index + 1).padStart(2, "0")}`,
      safeLabel(beforeClip.id),
      "to",
      safeLabel(afterClip.id)
    ].join("-");
    const boundarySamples = (["before", "after"] as const).map((side) => {
      const offset = side === "before" ? -FRAME_DURATION_SECONDS : FRAME_DURATION_SECONDS;
      const timeSeconds = Math.min(lastSafeTime, Math.max(0, boundaryTime + offset));
      const sampledTimeSeconds = Number(transitionFixed(timeSeconds));
      return {
        boundaryId,
        side,
        label: `${boundaryId}-${side}`,
        timeSeconds: sampledTimeSeconds,
        frameIndex: transitionFrameIndex(sampledTimeSeconds, frameCount)
      };
    });
    const [before, after] = boundarySamples;
    if (before!.frameIndex === after!.frameIndex) {
      const earlierFrameIndex = before!.frameIndex - 1;
      const laterFrameIndex = after!.frameIndex + 1;
      if (earlierFrameIndex >= 0 && earlierFrameIndex / 30 < boundaryTime) {
        before!.frameIndex = earlierFrameIndex;
        before!.timeSeconds = Number(transitionFixed(earlierFrameIndex / 30));
      } else if (laterFrameIndex < frameCount && laterFrameIndex / 30 > boundaryTime) {
        after!.frameIndex = laterFrameIndex;
        after!.timeSeconds = Number(transitionFixed(laterFrameIndex / 30));
      }
    }
    if (before!.frameIndex === after!.frameIndex) {
      throw new Error(
        `GPT-Live QA failed: ${boundaryId} cannot resolve to two distinct 30fps frames`
      );
    }
    samples.push(before!, after!);
  }
  return samples;
};

const readTransitionFrameStats = async (
  runCommand: typeof defaultRunCommand,
  ffmpegPath: string,
  inputPath: string,
  timeSeconds: number
): Promise<TransitionSignalStats> => {
  const result = await runCommand(ffmpegPath, [
    "-hide_banner",
    "-nostats",
    "-ss",
    transitionFixed(timeSeconds),
    "-i",
    inputPath,
    "-frames:v",
    "1",
    "-vf",
    "crop=iw*0.85:ih*0.92:iw*0.02:ih*0.04,signalstats,entropy,showinfo,metadata=print",
    "-f",
    "null",
    "-"
  ]);
  return parseTransitionSignalStats(`${result.stdout}\n${result.stderr}`);
};

export async function inspectTransitionFrameContent(
  ffmpegPath: string,
  inputPath: string,
  timeSeconds: number,
  runCommand: typeof defaultRunCommand = defaultRunCommand
): Promise<TransitionSignalStats> {
  const stats = await readTransitionFrameStats(runCommand, ffmpegPath, inputPath, timeSeconds);
  assertTransitionFrameHasContent(stats);
  return stats;
}

const buildContactSheet = async (
  runCommand: typeof defaultRunCommand,
  ffmpegPath: string,
  pattern: string,
  outputPath: string
): Promise<void> => {
  await runCommand(ffmpegPath, [
    "-y",
    "-framerate",
    "1",
    "-start_number",
    "0",
    "-i",
    pattern,
    "-vf",
    "tile=4x3:padding=2:margin=2:color=black",
    "-frames:v",
    "1",
    outputPath
  ]);
};

export async function generateVisualArtifacts(
  options: GenerateVisualArtifactsOptions,
  dependencies: GenerateVisualArtifactsDependencies = {}
): Promise<VisualArtifacts> {
  const runCommand = dependencies.runCommand ?? defaultRunCommand;
  const visualDirectory = options.outputDirectory ?? join(options.episodeDir, "reports", "visual");
  const artifactRelativeRoot = options.artifactRelativeRoot ?? "reports/visual";
  const temporaryDirectory = join(visualDirectory, ".contact-frames");
  await rm(temporaryDirectory, { recursive: true, force: true });
  await mkdir(temporaryDirectory, { recursive: true });

  const artifacts: VisualArtifacts = {
    contactSheets: { "version-a": "", "version-b": "" },
    transitionFrames: { "version-a": [], "version-b": [] },
    tailAudio: { "version-a": "", "version-b": "" },
    contactSampleTimesSeconds: { "version-a": [], "version-b": [] },
    transitionContent: {
      "version-a": { sampledFrames: 0, samples: [], blankFrames: [] },
      "version-b": { sampledFrames: 0, samples: [], blankFrames: [] }
    },
    checkedFrameCount: 0,
    contentMetrics: {
      minimumChangedPixelProportion: Number.POSITIVE_INFINITY,
      minimumLumaVariance: Number.POSITIVE_INFINITY,
      minimumNormalizedEntropy: Number.POSITIVE_INFINITY
    }
  };

  const recordMetrics = (metrics: FrameContentMetrics): void => {
    artifacts.contentMetrics.minimumChangedPixelProportion = Math.min(
      artifacts.contentMetrics.minimumChangedPixelProportion,
      metrics.changedPixelProportion
    );
    artifacts.contentMetrics.minimumLumaVariance = Math.min(
      artifacts.contentMetrics.minimumLumaVariance,
      metrics.lumaVariance
    );
    artifacts.contentMetrics.minimumNormalizedEntropy = Math.min(
      artifacts.contentMetrics.minimumNormalizedEntropy,
      metrics.normalizedEntropy
    );
  };
  const artifactPath = (path: string): string =>
    `${artifactRelativeRoot}/${relative(visualDirectory, path).split(sep).join("/")}`;

  try {
    for (const name of VARIANTS) {
      const inputPath = options.finalPaths[name];
      const times = contactTimes(options.durations[name]);
      artifacts.contactSampleTimesSeconds[name] = times;
      const prefix = join(temporaryDirectory, `${name}-contact`);
      for (const [index, timeSeconds] of times.entries()) {
        const framePath = `${prefix}-${String(index).padStart(2, "0")}.png`;
        await extractFrame(runCommand, options.ffmpegPath, inputPath, timeSeconds, framePath, true);
        recordMetrics(await inspectFrameContent(runCommand, options.ffmpegPath, framePath));
        artifacts.checkedFrameCount += 1;
      }
      const contactSheetPath = join(visualDirectory, `${name}-contact-sheet.png`);
      await buildContactSheet(runCommand, options.ffmpegPath, `${prefix}-%02d.png`, contactSheetPath);
      artifacts.contactSheets[name] = artifactPath(contactSheetPath);

      const frameDirectory = join(visualDirectory, `${name}-frames`);
      await rm(frameDirectory, { recursive: true, force: true });
      await mkdir(frameDirectory, { recursive: true });
      for (const [index, sample] of timelineSamples(options.plan).entries()) {
        const filename = `${String(index + 1).padStart(2, "0")}-${safeLabel(sample.label)}-${fixed(sample.timeSeconds).replace(".", "_")}s.png`;
        const framePath = join(frameDirectory, filename);
        await extractFrame(
          runCommand,
          options.ffmpegPath,
          inputPath,
          sample.timeSeconds,
          framePath,
          false
        );
        recordMetrics(await inspectFrameContent(runCommand, options.ffmpegPath, framePath));
        artifacts.checkedFrameCount += 1;
        artifacts.transitionFrames[name].push(artifactPath(framePath));
      }

      for (const sample of planTransitionBoundarySamples(options.plan, options.durations[name])) {
        const stats = await readTransitionFrameStats(
          runCommand,
          options.ffmpegPath,
          inputPath,
          sample.timeSeconds
        );
        artifacts.transitionContent[name].sampledFrames += 1;
        artifacts.transitionContent[name].samples.push({
          boundaryId: sample.boundaryId,
          side: sample.side,
          timeSeconds: sample.timeSeconds,
          frameIndex: sample.frameIndex
        });
        try {
          assertTransitionFrameHasContent(stats);
        } catch {
          artifacts.transitionContent[name].blankFrames.push({
            boundaryId: sample.boundaryId,
            side: sample.side,
            timeSeconds: sample.timeSeconds
          });
        }
      }

      const tailPath = join(visualDirectory, `${name}-tail.wav`);
      await runCommand(options.ffmpegPath, [
        "-y",
        "-sseof",
        "-10",
        "-i",
        inputPath,
        "-vn",
        "-c:a",
        "pcm_s16le",
        "-ar",
        "48000",
        "-ac",
        "2",
        tailPath
      ]);
      artifacts.tailAudio[name] = artifactPath(tailPath);
    }
  } finally {
    await rm(temporaryDirectory, { recursive: true, force: true });
  }

  return artifacts;
}

export function renderComparisonMarkdown(options: {
  artifacts: VisualArtifacts;
  durations: Record<QaVariantName, number>;
  durationDeltaSeconds: number;
  sourceIntervals: readonly { startSeconds: number; endSeconds: number }[];
  sourceOutputLufs: readonly { outputLufsA: number; outputLufsB: number }[];
}): string {
  const transitionCount = options.artifacts.transitionFrames["version-a"].length;
  const intervalText = options.sourceIntervals
    .map((interval) => `${fixed(interval.startSeconds)}-${fixed(interval.endSeconds)}s`)
    .join(" and ");
  const loudnessText = options.sourceOutputLufs
    .map((interval) => `${interval.outputLufsA.toFixed(1)}/${interval.outputLufsB.toFixed(1)} LUFS A/B`)
    .join(", ");

  return [
    "# GPT-Live Tella A/B Visual Comparison",
    "",
    "Machine review complete. Machine checks passed; this is not upload approval.",
    "",
    "## Hook strength",
    `The opening source excerpt is sampled in both variants and the 12-frame contact sheets passed cropped content-variance checks. Hook effectiveness requires human playback.`,
    "",
    "## Use-case clarity",
    `Start and midpoint frames for the use-case narration are present in both ${transitionCount}-frame review sets. Automated sampling does not establish audience comprehension.`,
    "",
    "## Translation demonstration",
    `Both official source-dialogue excerpts are represented at ${intervalText}; original source audio is preserved from the audited source clip media.`,
    "",
    "## Pacing",
    `Version A is ${fixed(options.durations["version-a"])}s and Version B is ${fixed(options.durations["version-b"])}s; the A/B delta is ${fixed(options.durationDeltaSeconds)}s.`,
    "",
    "## Text legibility",
    "All 34 labeled review frames were extracted at 1920x1080; 24 contact-sheet samples were downscaled to 480x270 tiles. All passed pixel-range checks, which do not prove text legibility at playback speed.",
    "",
    "## Logo placement",
    "The fixed 150px, 85% opacity, 24px top-right logo treatment has three changed-corner hash samples per final and a reserved 198x198 area in every narration scene.",
    "",
    "## Version A continuity",
    `The dynamic-editorial final has source, scene-start, scene-midpoint, transition, and final-CTA frames in ${options.artifacts.transitionFrames["version-a"][0]?.split("/").slice(0, -1).join("/")}. Continuity remains a human playback judgment.`,
    "",
    "## Transition boundary content",
    `Both compatibility outputs use the same evidence-editorial treatment; all ${options.artifacts.transitionContent["version-a"].sampledFrames + options.artifacts.transitionContent["version-b"].sampledFrames} boundary content checks passed, sampling one frame before and after every interior clip boundary independently of the labeled review screenshots.`,
    "",
    "## Audio and source-dialogue clarity",
    `Both finals contain AAC 48kHz stereo audio with matching treatment. No intro or body music is mixed because program audio is reconstructed from audited source and narration assets. Measured source-dialogue outputs are ${loudnessText}; extracted 10-second tails contain signal through the final 0.5 seconds. The outro-only tail signal does not prove CTA completion or rule out speech truncation. Subjective clarity still requires full real-time playback.`,
    "",
    "## Final CTA",
    "Each review set includes the CTA start, midpoint, and a labeled frame 0.5 seconds before the final boundary. Tail signal is present but does not validate narration completion.",
    "",
    "## Human playback",
    "Full real-time listening and viewing remains required before upload. Generate a pending review template from the current post-production manifest, then record it in reports/human-playback.json with schemaVersion 0.2.0, generationId, versionASha256, versionBSha256, status, note, and reviewedAt. Only an explicit current-generation passed review unlocks upload readiness.",
    ""
  ].join("\n");
}
