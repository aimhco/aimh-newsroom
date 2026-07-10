import { pathToFileURL } from "node:url";
import { resolve } from "node:path";
import {
  loadEnvSnapshotFromFiles as defaultLoadEnvSnapshotFromFiles,
  type EnvSnapshot
} from "../../config/env";
import { GPT_LIVE_CONTENT } from "./content";
import {
  prepareGptLiveProduction as defaultPrepareGptLiveProduction,
  type PrepareGptLiveProductionResult
} from "./prepare";

const DEFAULT_VIDEO_ENGINE_PATH = "/Users/dennywii/Documents/dev/aimh-video-engine";

export interface GptLiveCliDependencies {
  readonly cwd?: () => string;
  readonly loadEnvSnapshotFromFiles?: (
    projectRoot: string,
    videoEnginePath: string
  ) => Promise<EnvSnapshot>;
  readonly prepareGptLiveProduction?: typeof defaultPrepareGptLiveProduction;
}

const optionValue = (args: readonly string[], name: string): string | undefined => {
  const exactIndex = args.indexOf(name);
  if (exactIndex >= 0) {
    const value = args[exactIndex + 1];
    if (!value || value.startsWith("--")) throw new Error(`Missing value for ${name}`);
    return value;
  }

  const prefix = `${name}=`;
  const inline = args.find((argument) => argument.startsWith(prefix));
  if (inline !== undefined) {
    const value = inline.slice(prefix.length);
    if (!value) throw new Error(`Missing value for ${name}`);
    return value;
  }
  return undefined;
};

const loadCliEnv = async (
  projectRoot: string,
  loadEnvSnapshotFromFiles: GptLiveCliDependencies["loadEnvSnapshotFromFiles"]
): Promise<EnvSnapshot> => {
  const load = loadEnvSnapshotFromFiles ?? defaultLoadEnvSnapshotFromFiles;
  const initialVideoEnginePath = process.env.AIMH_VIDEO_ENGINE_PATH ?? DEFAULT_VIDEO_ENGINE_PATH;
  const initial = await load(projectRoot, initialVideoEnginePath);
  const configuredVideoEnginePath = initial.values.AIMH_VIDEO_ENGINE_PATH;

  if (configuredVideoEnginePath && configuredVideoEnginePath !== initialVideoEnginePath) {
    return load(projectRoot, configuredVideoEnginePath);
  }
  return initial;
};

export async function runGptLiveCli(
  rawArgs: readonly string[],
  dependencies: GptLiveCliDependencies = {}
): Promise<PrepareGptLiveProductionResult | unknown> {
  const args = rawArgs.filter((argument) => argument !== "--");
  const command = args[0];

  if (command === "finish" || command === "qa") {
    throw new Error(`Command not yet implemented: ${command}`);
  }
  if (command !== "prepare") {
    throw new Error(`Unknown command: ${command ?? "<missing>"}`);
  }

  const episodeDirOption = optionValue(args.slice(1), "--episode-dir");
  const projectRoot = resolve((dependencies.cwd ?? process.cwd)());
  const episodeDir = resolve(
    projectRoot,
    episodeDirOption ?? joinDefaultEpisodeDirectory(GPT_LIVE_CONTENT.id)
  );
  const env = await loadCliEnv(projectRoot, dependencies.loadEnvSnapshotFromFiles);
  const prepareGptLiveProduction =
    dependencies.prepareGptLiveProduction ?? defaultPrepareGptLiveProduction;

  return prepareGptLiveProduction({
    episodeDir,
    env: env.values,
    ffmpegPath: env.values.FFMPEG_PATH ?? "ffmpeg",
    ffprobePath: env.values.FFPROBE_PATH ?? "ffprobe"
  });
}

const joinDefaultEpisodeDirectory = (productionId: string): string =>
  `episodes/${productionId}`;

const isDirectExecution = (): boolean => {
  const entrypoint = process.argv[1];
  return Boolean(entrypoint && pathToFileURL(resolve(entrypoint)).href === import.meta.url);
};

if (isDirectExecution()) {
  runGptLiveCli(process.argv.slice(2))
    .then((result) => {
      if (
        result &&
        typeof result === "object" &&
        "episodeDir" in result &&
        typeof result.episodeDir === "string"
      ) {
        console.log(`episode: ${result.episodeDir}`);
      }
    })
    .catch((error: unknown) => {
      console.error(error instanceof Error ? error.message : String(error));
      process.exitCode = 1;
    });
}
