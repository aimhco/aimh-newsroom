import { mkdir, rm } from "node:fs/promises";
import { join, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { bundle } from "@remotion/bundler";
import { renderStill, selectComposition } from "@remotion/renderer";
import { runCommand } from "../../../render/process";
import { GPT_LIVE_VISUAL_CONTENT } from "../content";
import { evidenceForScene, stageEvidencePublicAssets } from "../evidence";
import type { GptLivePlateProps } from "./Root";
import {
  assertContentfulFrameMetadata,
  assertUniformSafeAreaMetadata,
  buildSmokeFramePlan,
  resolveSmokeEvidenceDimensions,
  useCaseTemporalFrames
} from "./smokePlan";

const DURATION_SECONDS = 8;
const DURATION_IN_FRAMES = DURATION_SECONDS * 30;
const DEFAULT_OUTPUT_DIR = "/tmp/gpt-live-motion-acceptance";
const DEFAULT_EPISODE_DIR = fileURLToPath(
  new URL("../../../../episodes/2026-07-10-gpt-live-tella-ab/", import.meta.url)
);

const assertRenderedSafeArea = async (ffmpegPath: string, file: string): Promise<void> => {
  const result = await runCommand(ffmpegPath, [
    "-hide_banner",
    "-i",
    file,
    "-vf",
    "crop=198:198:1722:0,signalstats,metadata=print",
    "-frames:v",
    "1",
    "-f",
    "null",
    "-"
  ]);
  assertUniformSafeAreaMetadata(`${result.stdout}\n${result.stderr}`);
};

const assertRenderedContent = async (ffmpegPath: string, file: string): Promise<void> => {
  const result = await runCommand(ffmpegPath, [
    "-hide_banner",
    "-i",
    file,
    "-vf",
    "signalstats,metadata=print",
    "-frames:v",
    "1",
    "-f",
    "null",
    "-"
  ]);
  assertContentfulFrameMetadata(`${result.stdout}\n${result.stderr}`);
};

const renderFrame = async (
  serveUrl: string,
  output: string,
  frame: number,
  props: GptLivePlateProps
): Promise<void> => {
  const composition = await selectComposition({
    serveUrl,
    id: "GptLivePlate",
    inputProps: props
  });
  await renderStill({
    composition,
    serveUrl,
    inputProps: props,
    frame,
    output,
    imageFormat: "png",
    overwrite: true
  });
};

const createContactSheet = async (ffmpegPath: string, outputDir: string): Promise<string> => {
  const output = join(outputDir, "contact-sheet-1500.png");
  await runCommand(ffmpegPath, [
    "-y",
    "-loglevel",
    "error",
    "-pattern_type",
    "glob",
    "-i",
    join(outputDir, "frames", "aimh*.png"),
    "-pattern_type",
    "glob",
    "-i",
    join(outputDir, "frames", "dynamic*.png"),
    "-filter_complex",
    "[0:v][1:v]concat=n=2:v=1:a=0,scale=320:180,tile=6x6:nb_frames=36:padding=8:margin=8:color=0x242424,scale=1500:-1",
    "-frames:v",
    "1",
    "-update",
    "1",
    output
  ]);
  return output;
};

const createTemporalStrip = async (ffmpegPath: string, outputDir: string): Promise<string> => {
  const output = join(outputDir, "use-cases-8s-strip.png");
  await runCommand(ffmpegPath, [
    "-y",
    "-loglevel",
    "error",
    "-pattern_type",
    "glob",
    "-i",
    join(outputDir, "use-cases", "*.png"),
    "-vf",
    "scale=320:180,tile=6x1:nb_frames=6:padding=8:margin=8:color=0x242424,scale=1920:-1",
    "-frames:v",
    "1",
    "-update",
    "1",
    output
  ]);
  return output;
};

export async function renderGptLiveMotionSmoke(
  outputDir = DEFAULT_OUTPUT_DIR,
  ffmpegPath = process.env.FFMPEG_PATH ?? "ffmpeg",
  episodeDir = DEFAULT_EPISODE_DIR
): Promise<{ readonly contactSheetPath: string; readonly temporalStripPath: string }> {
  const framesDir = join(outputDir, "frames");
  const useCasesDir = join(outputDir, "use-cases");
  await rm(outputDir, { recursive: true, force: true });
  await mkdir(framesDir, { recursive: true });
  await mkdir(useCasesDir, { recursive: true });
  const stagedEvidence = await stageEvidencePublicAssets(episodeDir);
  try {
    const serveUrl = await bundle({
      entryPoint: new URL("./Root.tsx", import.meta.url).pathname,
      publicDir: stagedEvidence.publicDir
    });

    for (const item of buildSmokeFramePlan(DURATION_IN_FRAMES)) {
      const output = join(framesDir, item.outputName);
      const evidences = evidenceForScene(item.sceneContent.scene).map((evidence) => {
        const dimensions = resolveSmokeEvidenceDimensions(evidence, stagedEvidence.dimensions);
        if (!dimensions) {
          throw new Error(`Missing smoke evidence dimensions: ${evidence.id}`);
        }
        return { ...evidence, assetWidth: dimensions.width, assetHeight: dimensions.height };
      });
      await renderFrame(serveUrl, output, item.frame, {
        variant: item.variant,
        durationSeconds: DURATION_SECONDS,
        sceneContent: item.sceneContent,
        ...(evidences.length > 0 ? { evidences } : {})
      });
      await assertRenderedSafeArea(ffmpegPath, output);
      if (item.verifyContentfulFrame) {
        await assertRenderedContent(ffmpegPath, output);
      }
    }

    for (const [index, frame] of useCaseTemporalFrames(DURATION_IN_FRAMES).entries()) {
      const output = join(useCasesDir, `${String(index + 1).padStart(2, "0")}.png`);
      await renderFrame(serveUrl, output, frame, {
        variant: "dynamic_editorial",
        durationSeconds: DURATION_SECONDS,
        sceneContent: GPT_LIVE_VISUAL_CONTENT.use_cases
      });
      await assertRenderedSafeArea(ffmpegPath, output);
    }

    return {
      contactSheetPath: await createContactSheet(ffmpegPath, outputDir),
      temporalStripPath: await createTemporalStrip(ffmpegPath, outputDir)
    };
  } finally {
    await stagedEvidence.cleanup();
  }
}

const isDirectExecution = (): boolean => {
  const entrypoint = process.argv[1];
  return Boolean(entrypoint && pathToFileURL(resolve(entrypoint)).href === import.meta.url);
};

if (isDirectExecution()) {
  renderGptLiveMotionSmoke(process.argv[2])
    .then(({ contactSheetPath, temporalStripPath }) => {
      console.log(`contact sheet: ${contactSheetPath}`);
      console.log(`temporal strip: ${temporalStripPath}`);
    })
    .catch((error: unknown) => {
      console.error(error instanceof Error ? error.message : String(error));
      process.exitCode = 1;
    });
}
