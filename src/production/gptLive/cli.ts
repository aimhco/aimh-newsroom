import { pathToFileURL } from "node:url";
import { isAbsolute, relative, resolve, sep } from "node:path";
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

type PrepareGptLiveProductionFunction<TResult> = (
  options: Parameters<typeof defaultPrepareGptLiveProduction>[0]
) => Promise<TResult>;

export interface GptLiveCliDependencies<TResult = PrepareGptLiveProductionResult> {
  readonly cwd?: () => string;
  readonly loadEnvSnapshotFromFiles?: (
    projectRoot: string,
    videoEnginePath: string
  ) => Promise<EnvSnapshot>;
  readonly prepareGptLiveProduction?: PrepareGptLiveProductionFunction<TResult>;
}

const parsePrepareArgs = (rawArgs: readonly string[]): { readonly episodeDir?: string } => {
  const args = [...rawArgs];
  if (args[0] === "--") args.shift();
  if (args.includes("--")) throw new Error("Unexpected or excess -- separator");

  let episodeDir: string | undefined;
  for (let index = 0; index < args.length; index += 1) {
    const argument = args[index]!;
    if (argument === "--episode-dir") {
      if (episodeDir !== undefined) throw new Error("Duplicate option: --episode-dir");
      const value = args[index + 1];
      if (!value || value.startsWith("--")) {
        throw new Error("Missing value for --episode-dir");
      }
      episodeDir = value;
      index += 1;
      continue;
    }
    if (argument.startsWith("--episode-dir=")) {
      if (episodeDir !== undefined) throw new Error("Duplicate option: --episode-dir");
      episodeDir = argument.slice("--episode-dir=".length);
      if (!episodeDir) throw new Error("Missing value for --episode-dir");
      continue;
    }
    if (argument.startsWith("--")) throw new Error(`Unknown option: ${argument}`);
    throw new Error(`Unexpected positional argument: ${argument}`);
  }

  return episodeDir === undefined ? {} : { episodeDir };
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

const resolveEpisodeDirectory = (projectRoot: string, value: string): string => {
  const episodesRoot = resolve(projectRoot, "episodes");
  const episodeDir = resolve(projectRoot, value);
  const childPath = relative(episodesRoot, episodeDir);
  if (
    !childPath ||
    childPath === ".." ||
    childPath.startsWith(`..${sep}`) ||
    isAbsolute(childPath)
  ) {
    throw new Error(`Episode directory must be a child of ${episodesRoot}`);
  }
  return episodeDir;
};

export async function runGptLiveCli<TResult = PrepareGptLiveProductionResult>(
  rawArgs: readonly string[],
  dependencies: GptLiveCliDependencies<TResult> = {}
): Promise<TResult> {
  const command = rawArgs[0];

  if (command === "finish" || command === "qa") {
    throw new Error(`Command not yet implemented: ${command}`);
  }
  if (command !== "prepare") {
    throw new Error(`Unknown command: ${command ?? "<missing>"}`);
  }

  const parsed = parsePrepareArgs(rawArgs.slice(1));
  const projectRoot = resolve((dependencies.cwd ?? process.cwd)());
  const episodeDir = resolveEpisodeDirectory(
    projectRoot,
    parsed.episodeDir ?? joinDefaultEpisodeDirectory(GPT_LIVE_CONTENT.id)
  );
  const env = await loadCliEnv(projectRoot, dependencies.loadEnvSnapshotFromFiles);
  const prepareGptLiveProduction = dependencies.prepareGptLiveProduction ??
    (defaultPrepareGptLiveProduction as PrepareGptLiveProductionFunction<TResult>);

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
      console.log(`episode: ${result.episodeDir}`);
    })
    .catch((error: unknown) => {
      console.error(error instanceof Error ? error.message : String(error));
      process.exitCode = 1;
    });
}
