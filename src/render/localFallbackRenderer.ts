import { mkdir, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import type { EpisodePackage, QaCheck, ScriptFile } from "../types";
import { ensureDir, writeJson, writeText } from "../utils/fs";
import { synthesizeNarration, type VoiceRenderResult } from "../voice/elevenLabsAdapter";
import { buildCaptionsSrt } from "./captions";
import { runCommand } from "./process";

export interface RenderSegmentPlan {
  id: string;
  text: string;
  imagePath: string;
  audioPath: string;
  durationSeconds: number;
  outPath: string;
}

export interface RenderPlan {
  segments: RenderSegmentPlan[];
  captionsPath: string;
  concatListPath: string;
  finalVideoPath: string;
}

export interface LocalRenderResult {
  mode: "local_fallback_render";
  status: "rendered" | "failed";
  finalVideoPath?: string;
  captionsPath?: string;
  voice: VoiceRenderResult;
  warnings: string[];
  qaCheck: QaCheck;
}

export function buildRenderPlan(options: {
  episodeDir: string;
  package: EpisodePackage;
  audioFiles: string[];
  durationsSeconds: number[];
}): RenderPlan {
  const segments = options.package.script.narration.map((paragraph, index): RenderSegmentPlan => {
    const shotId = paragraph.shot_ids[0];
    const shot = options.package.shotlist.shots.find((candidate) => candidate.id === shotId);
    if (!shot?.asset_path) throw new Error(`No visual asset found for narration paragraph ${paragraph.id}`);
    return {
      id: paragraph.id,
      text: paragraph.text,
      imagePath: join(options.episodeDir, shot.asset_path),
      audioPath: options.audioFiles[index] ?? "",
      durationSeconds: options.durationsSeconds[index] ?? paragraph.estimated_seconds,
      outPath: join(options.episodeDir, "render", "work", `segment_${String(index + 1).padStart(3, "0")}.mp4`)
    };
  });

  return {
    segments,
    captionsPath: join(options.episodeDir, "render", "captions.srt"),
    concatListPath: join(options.episodeDir, "render", "work", "segments.txt"),
    finalVideoPath: join(options.episodeDir, "render", "final.mp4")
  };
}

function concatEscape(path: string): string {
  return path.replace(/'/g, "'\\''");
}

async function renderSegment(options: {
  ffmpegPath: string;
  segment: RenderSegmentPlan;
}): Promise<void> {
  await mkdir(dirname(options.segment.outPath), { recursive: true });
  const baseArgs = [
    "-y",
    "-loop",
    "1",
    "-t",
    options.segment.durationSeconds.toFixed(3),
    "-i",
    options.segment.imagePath
  ];

  const filter =
    "scale=1920:1080:force_original_aspect_ratio=decrease," +
    "pad=1920:1080:(ow-iw)/2:(oh-ih)/2,setsar=1,format=yuv420p";

  if (options.segment.audioPath) {
    await runCommand(options.ffmpegPath, [
      ...baseArgs,
      "-i",
      options.segment.audioPath,
      "-vf",
      filter,
      "-r",
      "30",
      "-c:v",
      "libx264",
      "-preset",
      "veryfast",
      "-c:a",
      "aac",
      "-b:a",
      "160k",
      "-shortest",
      options.segment.outPath
    ]);
    return;
  }

  await runCommand(options.ffmpegPath, [
    ...baseArgs,
    "-f",
    "lavfi",
    "-t",
    options.segment.durationSeconds.toFixed(3),
    "-i",
    "anullsrc=channel_layout=stereo:sample_rate=44100",
    "-vf",
    filter,
    "-r",
    "30",
    "-c:v",
    "libx264",
    "-preset",
    "veryfast",
    "-c:a",
    "aac",
    "-b:a",
    "160k",
    "-shortest",
    options.segment.outPath
  ]);
}

export async function renderLocalFallbackVideo(options: {
  episodeDir: string;
  package: EpisodePackage;
  env: Record<string, string | undefined>;
  allowElevenLabs: boolean;
}): Promise<LocalRenderResult> {
  const ffmpegPath = options.env.FFMPEG_PATH || options.env.FFMPEG || "ffmpeg";
  const ffprobePath = options.env.FFPROBE_PATH || options.env.FFPROBE || "ffprobe";
  const voice = await synthesizeNarration({
    script: options.package.script,
    outDir: join(options.episodeDir, "voice"),
    env: options.env,
    ffprobePath,
    allowElevenLabs: options.allowElevenLabs
  });
  const plan = buildRenderPlan({
    episodeDir: options.episodeDir,
    package: options.package,
    audioFiles: voice.chunks.map((chunk) => chunk.file),
    durationsSeconds: voice.chunks.map((chunk) => chunk.durationSeconds)
  });

  await ensureDir(join(options.episodeDir, "render", "work"));
  await writeText(
    plan.captionsPath,
    buildCaptionsSrt(
      options.package.script.narration,
      voice.chunks.map((chunk) => chunk.durationSeconds)
    )
  );

  for (const segment of plan.segments) {
    await renderSegment({ ffmpegPath, segment });
  }

  await writeFile(
    plan.concatListPath,
    plan.segments.map((segment) => `file '${concatEscape(segment.outPath)}'`).join("\n") + "\n",
    "utf8"
  );
  await runCommand(ffmpegPath, [
    "-y",
    "-f",
    "concat",
    "-safe",
    "0",
    "-i",
    plan.concatListPath,
    "-c",
    "copy",
    plan.finalVideoPath
  ]);

  const result: LocalRenderResult = {
    mode: "local_fallback_render",
    status: "rendered",
    finalVideoPath: plan.finalVideoPath,
    captionsPath: plan.captionsPath,
    voice,
    warnings: voice.warnings,
    qaCheck: {
      name: "local_render",
      pass: true,
      detail: `rendered ${plan.finalVideoPath}`
    }
  };
  await writeJson(join(options.episodeDir, "voice", "narration.json"), voice);
  await writeJson(join(options.episodeDir, "render", "render-status.json"), result);
  return result;
}
