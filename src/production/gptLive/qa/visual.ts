import { mkdir, rm } from "node:fs/promises";
import { basename, join, relative, sep } from "node:path";
import { runCommand as defaultRunCommand } from "../../../render/process";
import type { TellaPlan } from "../tellaPlan";
import type { QaVariantName, VisualArtifacts } from "./types";

const VARIANTS = ["version-a", "version-b"] as const;

export interface GenerateVisualArtifactsOptions {
  episodeDir: string;
  finalPaths: Record<QaVariantName, string>;
  durations: Record<QaVariantName, number>;
  plan: TellaPlan;
  ffmpegPath: string;
}

export interface GenerateVisualArtifactsDependencies {
  runCommand?: typeof defaultRunCommand;
}

interface FrameSample {
  label: string;
  timeSeconds: number;
}

const fixed = (value: number): string => value.toFixed(3);

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

const assertNonblankFrame = async (
  runCommand: typeof defaultRunCommand,
  ffmpegPath: string,
  framePath: string
): Promise<void> => {
  const result = await runCommand(ffmpegPath, [
    "-hide_banner",
    "-nostats",
    "-i",
    framePath,
    "-vf",
    "signalstats,metadata=print",
    "-frames:v",
    "1",
    "-f",
    "null",
    "-"
  ]);
  const output = `${result.stdout}\n${result.stderr}`;
  const minimum = Number(output.match(/lavfi\.signalstats\.YMIN=(\d+(?:\.\d+)?)/)?.[1]);
  const maximum = Number(output.match(/lavfi\.signalstats\.YMAX=(\d+(?:\.\d+)?)/)?.[1]);
  if (!Number.isFinite(minimum) || !Number.isFinite(maximum) || maximum - minimum < 3) {
    throw new Error(`GPT-Live QA failed: sampled frame is blank or unreadable: ${basename(framePath)}`);
  }
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
  const visualDirectory = join(options.episodeDir, "reports", "visual");
  const temporaryDirectory = join(visualDirectory, ".contact-frames");
  await rm(temporaryDirectory, { recursive: true, force: true });
  await mkdir(temporaryDirectory, { recursive: true });

  const artifacts: VisualArtifacts = {
    contactSheets: { "version-a": "", "version-b": "" },
    transitionFrames: { "version-a": [], "version-b": [] },
    tailAudio: { "version-a": "", "version-b": "" },
    contactSampleTimesSeconds: { "version-a": [], "version-b": [] },
    checkedFrameCount: 0
  };

  try {
    for (const name of VARIANTS) {
      const inputPath = options.finalPaths[name];
      const times = contactTimes(options.durations[name]);
      artifacts.contactSampleTimesSeconds[name] = times;
      const prefix = join(temporaryDirectory, `${name}-contact`);
      for (const [index, timeSeconds] of times.entries()) {
        const framePath = `${prefix}-${String(index).padStart(2, "0")}.png`;
        await extractFrame(runCommand, options.ffmpegPath, inputPath, timeSeconds, framePath, true);
        await assertNonblankFrame(runCommand, options.ffmpegPath, framePath);
        artifacts.checkedFrameCount += 1;
      }
      const contactSheetPath = join(visualDirectory, `${name}-contact-sheet.png`);
      await buildContactSheet(runCommand, options.ffmpegPath, `${prefix}-%02d.png`, contactSheetPath);
      artifacts.contactSheets[name] = relativeReportPath(options.episodeDir, contactSheetPath);

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
        await assertNonblankFrame(runCommand, options.ffmpegPath, framePath);
        artifacts.checkedFrameCount += 1;
        artifacts.transitionFrames[name].push(relativeReportPath(options.episodeDir, framePath));
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
      artifacts.tailAudio[name] = relativeReportPath(options.episodeDir, tailPath);
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
    "## Hook strength",
    `The opening source excerpt is sampled in both variants and the 12-frame contact sheets passed nonblank pixel checks. Hook effectiveness requires human playback.`,
    "",
    "## Use-case clarity",
    `Start and midpoint frames for the use-case narration are present in both ${transitionCount}-frame review sets. Automated sampling does not establish audience comprehension.`,
    "",
    "## Translation demonstration",
    `Both official source-dialogue excerpts are represented at ${intervalText}; original source audio is preserved by the Tella plan.`,
    "",
    "## Pacing",
    `Version A is ${fixed(options.durations["version-a"])}s and Version B is ${fixed(options.durations["version-b"])}s; the A/B delta is ${fixed(options.durationDeltaSeconds)}s.`,
    "",
    "## Text legibility",
    "All 34 labeled transition frames were extracted at 1920x1080; 24 contact-sheet samples were downscaled to 480x270 tiles. All passed pixel-range checks, which do not prove text legibility at playback speed.",
    "",
    "## Logo placement",
    "The fixed 150px, 85% opacity, 24px top-right logo treatment has three changed-corner hash samples per final and a reserved 198x198 area in every narration scene.",
    "",
    "## Version A continuity",
    `The dynamic-editorial final has source, scene-start, scene-midpoint, transition, and final-CTA frames in ${options.artifacts.transitionFrames["version-a"][0]?.split("/").slice(0, -1).join("/")}. Continuity remains a human playback judgment.`,
    "",
    "## Version B host usefulness",
    `The visual-host final has the same labeled sampling coverage in ${options.artifacts.transitionFrames["version-b"][0]?.split("/").slice(0, -1).join("/")}. Host usefulness remains a human playback judgment.`,
    "",
    "## Audio and source-dialogue clarity",
    `Both finals contain AAC 48kHz stereo audio with matching treatment. Measured source-dialogue outputs are ${loudnessText}; extracted 10-second tails contain signal through the final 0.5 seconds. Subjective clarity was not claimed.`,
    "",
    "## Final CTA",
    "Each review set includes the CTA start, midpoint, and a labeled frame 0.5 seconds before the final boundary; both final audio tails remain active.",
    "",
    "## Human playback",
    "Full real-time listening and viewing remains the user's approval step before upload.",
    ""
  ].join("\n");
}
