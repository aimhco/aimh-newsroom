import {
  lstat as defaultLstat,
  realpath as defaultRealpath
} from "node:fs/promises";
import { isAbsolute, join, relative, resolve, sep } from "node:path";
import { GPT_LIVE_CONTENT } from "../content";
import type { PublishedGenerationValidation } from "../finish";
import { buildTellaPlan, type TellaPlan } from "../tellaPlan";
import type { QaProduction, QaVoice } from "./types";

interface PathStat {
  isDirectory(): boolean;
  isSymbolicLink(): boolean;
}

export interface QaSerializedPathInput {
  episodeDir: string;
  production: QaProduction;
  voice: QaVoice;
  plan: TellaPlan;
  generation: PublishedGenerationValidation;
  tellaState?: unknown;
  postProduction?: Record<string, unknown>;
}

export interface QaPathDependencies {
  lstat?: (path: string) => Promise<PathStat>;
  realpath?: (path: string) => Promise<string>;
}

export interface EpisodePathValidationOptions extends QaPathDependencies {
  context?: string;
  allowMissingEpisodeDir?: boolean;
}

const isWithin = (root: string, candidate: string, allowRoot = false): boolean => {
  const child = relative(root, candidate);
  if (!child) return allowRoot;
  return child !== ".." && !child.startsWith(`..${sep}`) && !isAbsolute(child);
};

const exact = (actual: unknown, expected: unknown, label: string): void => {
  if (JSON.stringify(actual) !== JSON.stringify(expected)) {
    throw new Error(`GPT-Live QA path validation failed: ${label}`);
  }
};

export function validateSerializedQaPaths(input: QaSerializedPathInput): string[] {
  const episodeDir = resolve(input.episodeDir);
  if (input.production.branding.logoPath !== GPT_LIVE_CONTENT.branding.logoPath) {
    throw new Error("GPT-Live QA path validation failed: logo path");
  }
  exact(input.production.audio, GPT_LIVE_CONTENT.audio, "audio path");
  for (const narration of GPT_LIVE_CONTENT.narration) {
    const chunk = input.voice.chunks.find(({ id }) => id === narration.id);
    if (chunk?.file !== join(episodeDir, "voice", `${narration.id}.mp3`)) {
      throw new Error(`GPT-Live QA path validation failed: voice path ${narration.id}`);
    }
  }
  const expectedPlan = buildTellaPlan({
    episodeDir,
    narrationAssets: input.voice.chunks.map((chunk) => ({
      id: chunk.id,
      audioPath: chunk.file,
      durationSeconds: chunk.durationSeconds
    }))
  });
  exact(input.plan, expectedPlan, "serialized plan contains an outside or unexpected path");
  exact(input.generation.finalPaths, [
    join(episodeDir, "final", "version-a.mp4"),
    join(episodeDir, "final", "version-b.mp4")
  ], "final paths");
  if (input.generation.reportPath !== join(episodeDir, "reports", "post-production.json")) {
    throw new Error("GPT-Live QA path validation failed: generation report path");
  }
  if (input.tellaState !== undefined) {
    const state = input.tellaState as Record<string, unknown>;
    exact(state.exportPaths, {
      dynamic_editorial: join(episodeDir, "exports", "tella-a.mp4"),
      aimh_visual_host: join(episodeDir, "exports", "tella-b.mp4")
    }, "Tella export paths");
  }
  if (input.postProduction !== undefined) {
    const variants = input.postProduction.variants as Array<Record<string, unknown>>;
    exact(variants?.map(({ name, inputPath, outputPath }) => ({ name, inputPath, outputPath })), [
      { name: "version-a", inputPath: "exports/tella-a.mp4", outputPath: "final/version-a.mp4" },
      { name: "version-b", inputPath: "exports/tella-b.mp4", outputPath: "final/version-b.mp4" }
    ], "post-production paths");
  }

  return [
    ...input.voice.chunks.flatMap((chunk) => [chunk.file, `${chunk.file}.json`]),
    ...input.plan.clips.flatMap((clip) => clip.kind === "source_clip"
      ? [clip.mediaPath]
      : [clip.masterPath, ...Object.values(clip.variants).map((variant) => variant.platePath)]),
    ...input.generation.finalPaths,
    input.generation.reportPath
  ];
}

export async function validateContainedEpisodePaths(
  episodeDir: string,
  paths: readonly string[],
  options: EpisodePathValidationOptions = {}
): Promise<void> {
  const lstat = options.lstat ?? defaultLstat;
  const realpath = options.realpath ?? defaultRealpath;
  const context = options.context ?? "GPT-Live QA";
  const root = resolve(episodeDir);
  let rootStat: PathStat;
  try {
    rootStat = await lstat(root);
  } catch (error) {
    if (options.allowMissingEpisodeDir && (error as NodeJS.ErrnoException).code === "ENOENT") {
      return;
    }
    throw error;
  }
  if (rootStat.isSymbolicLink()) {
    throw new Error(`${context} path contains a symlink: ${root}`);
  }
  if (!rootStat.isDirectory()) {
    throw new Error(`${context} episode path is not a directory: ${root}`);
  }
  const realRoot = await realpath(root);
  for (const path of paths) {
    const candidate = resolve(path);
    if (!isWithin(root, candidate)) {
      throw new Error(`${context} path escapes episode directory: ${candidate}`);
    }
    let current = root;
    for (const component of relative(root, candidate).split(sep).filter(Boolean)) {
      current = join(current, component);
      try {
        const stat = await lstat(current);
        if (stat.isSymbolicLink()) throw new Error(`${context} path contains a symlink: ${current}`);
        const real = await realpath(current);
        if (!isWithin(realRoot, real, true)) {
          throw new Error(`${context} path escapes episode directory: ${current}`);
        }
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code === "ENOENT") break;
        throw error;
      }
    }
  }
}

export async function validateNoSymlinkPaths(
  episodeDir: string,
  paths: readonly string[],
  dependencies: QaPathDependencies = {}
): Promise<void> {
  await validateContainedEpisodePaths(episodeDir, paths, dependencies);
}

export async function withValidatedQaArtifactPaths<T>(
  input: QaSerializedPathInput,
  dependencies: QaPathDependencies,
  action: () => Promise<T>
): Promise<T> {
  const paths = validateSerializedQaPaths(input);
  await validateNoSymlinkPaths(input.episodeDir, paths, dependencies);
  return action();
}
