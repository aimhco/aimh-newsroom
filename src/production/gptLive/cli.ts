import { pathToFileURL } from "node:url";
import {
  lstat as defaultLstat,
  realpath as defaultRealpath
} from "node:fs/promises";
import { isAbsolute, join, relative, resolve, sep } from "node:path";
import {
  loadEnvSnapshotFromFiles as defaultLoadEnvSnapshotFromFiles,
  type EnvSnapshot
} from "../../config/env";
import { GPT_LIVE_CONTENT } from "./content";
import {
  prepareGptLiveProduction as defaultPrepareGptLiveProduction,
  type PrepareGptLiveProductionResult
} from "./prepare";
import {
  finishGptLiveProduction as defaultFinishGptLiveProduction,
  type FinishGptLiveProductionResult
} from "./finish";
import {
  runGptLiveQa as defaultRunGptLiveQa,
  type GptLiveQaResult
} from "./qa";
import {
  sealTellaExports as defaultSealTellaExports,
  type TellaExportSealIdentity
} from "./tellaExportReceipt";

const DEFAULT_VIDEO_ENGINE_PATH = "/Users/dennywii/Documents/dev/aimh-video-engine";

type PrepareGptLiveProductionFunction<TResult> = (
  options: Parameters<typeof defaultPrepareGptLiveProduction>[0]
) => Promise<TResult>;
type FinishGptLiveProductionFunction<TResult> = (
  options: Parameters<typeof defaultFinishGptLiveProduction>[0]
) => Promise<TResult>;
type QaGptLiveProductionFunction<TResult> = (
  options: Parameters<typeof defaultRunGptLiveQa>[0]
) => Promise<TResult>;
type SealTellaExportsFunction<TResult> = (
  options: Parameters<typeof defaultSealTellaExports>[0]
) => Promise<TResult>;
interface PathStat {
  isDirectory(): boolean;
  isSymbolicLink(): boolean;
}
type Lstat = (path: string) => Promise<PathStat>;
type Realpath = (path: string) => Promise<string>;

export interface GptLiveCliDependencies<TResult = PrepareGptLiveProductionResult> {
  readonly cwd?: () => string;
  readonly lstat?: Lstat;
  readonly loadEnvSnapshotFromFiles?: (
    projectRoot: string,
    videoEnginePath: string
  ) => Promise<EnvSnapshot>;
  readonly finishGptLiveProduction?: FinishGptLiveProductionFunction<TResult>;
  readonly prepareGptLiveProduction?: PrepareGptLiveProductionFunction<TResult>;
  readonly qaGptLiveProduction?: QaGptLiveProductionFunction<TResult>;
  readonly realpath?: Realpath;
  readonly sealTellaExports?: SealTellaExportsFunction<TResult>;
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

const SEAL_OPTIONS = [
  "version-a-source-variant",
  "version-a-video-id",
  "version-a-workflow-id",
  "version-b-source-variant",
  "version-b-video-id",
  "version-b-workflow-id"
] as const;
type SealOption = (typeof SEAL_OPTIONS)[number];

const parseSealArgs = (
  rawArgs: readonly string[]
): { readonly episodeDir?: string; readonly values: Partial<Record<SealOption, string>> } => {
  const args = [...rawArgs];
  if (args[0] === "--") args.shift();
  if (args.includes("--")) throw new Error("Unexpected or excess -- separator");
  let episodeDir: string | undefined;
  const values: Partial<Record<SealOption, string>> = {};

  for (let index = 0; index < args.length; index += 1) {
    const argument = args[index]!;
    const equalsIndex = argument.indexOf("=");
    const rawName = equalsIndex === -1 ? argument : argument.slice(0, equalsIndex);
    const inlineValue = equalsIndex === -1 ? undefined : argument.slice(equalsIndex + 1);
    if (!rawName.startsWith("--")) throw new Error(`Unexpected positional argument: ${argument}`);
    const name = rawName.slice(2);
    if (name !== "episode-dir" && !SEAL_OPTIONS.includes(name as SealOption)) {
      throw new Error(`Unknown option: ${rawName}`);
    }
    const key = name === "episode-dir" ? name : name as SealOption;
    const existing = key === "episode-dir" ? episodeDir : values[key];
    if (existing !== undefined) throw new Error(`Duplicate option: --${name}`);
    const value = inlineValue ?? args[index + 1];
    if (!value || value.startsWith("--")) throw new Error(`Missing value for --${name}`);
    if (inlineValue === undefined) index += 1;
    if (key === "episode-dir") episodeDir = value;
    else values[key] = value;
  }
  return episodeDir === undefined ? { values } : { episodeDir, values };
};

const buildSealIdentities = (
  flags: Partial<Record<SealOption, string>>,
  env: EnvSnapshot
): readonly [TellaExportSealIdentity, TellaExportSealIdentity] => {
  const required = (flag: SealOption, envName: string): string => {
    const value = flags[flag] ?? env.values[envName];
    if (!value?.trim()) throw new Error(`Missing --${flag} or ${envName}`);
    return value;
  };
  const requiredShellDownloadUrl = (prefix: "A" | "B"): string => {
    const envName = `GPT_LIVE_TELLA_VERSION_${prefix}_DOWNLOAD_URL`;
    const status = env.status[envName];
    const value = env.values[envName];
    if (status?.present !== true || status.source !== "shell" || !value?.trim()) {
      throw new Error(`${envName} must be set in the live shell environment`);
    }
    return value;
  };
  const identity = (version: "version-a" | "version-b", prefix: "A" | "B") => {
    const sourceVariant = required(
      `${version}-source-variant` as SealOption,
      `GPT_LIVE_TELLA_VERSION_${prefix}_SOURCE_VARIANT`
    );
    if (sourceVariant !== "dynamic_editorial" && sourceVariant !== "aimh_visual_host") {
      throw new Error(`Invalid --${version}-source-variant: ${sourceVariant}`);
    }
    return {
      version,
      sourceVariant,
      remoteVideoId: required(
        `${version}-video-id` as SealOption,
        `GPT_LIVE_TELLA_VERSION_${prefix}_VIDEO_ID`
      ),
      workflowId: required(
        `${version}-workflow-id` as SealOption,
        `GPT_LIVE_TELLA_VERSION_${prefix}_WORKFLOW_ID`
      ),
      downloadUrl: requiredShellDownloadUrl(prefix)
    } as const;
  };
  return [identity("version-a", "A"), identity("version-b", "B")];
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

const isWithin = (root: string, candidate: string, allowRoot: boolean): boolean => {
  const childPath = relative(root, candidate);
  if (!childPath) return allowRoot;
  return childPath !== ".." && !childPath.startsWith(`..${sep}`) && !isAbsolute(childPath);
};

const validateRealEpisodeDirectory = async (
  projectRoot: string,
  episodeDir: string,
  lstat: Lstat,
  realpath: Realpath
): Promise<void> => {
  const episodesRoot = resolve(projectRoot, "episodes");
  const realProjectRoot = await realpath(projectRoot);
  const episodesRootStat = await lstat(episodesRoot);
  if (episodesRootStat.isSymbolicLink()) {
    throw new Error(`Episode directory path contains a symlink: ${episodesRoot}`);
  }
  if (!episodesRootStat.isDirectory()) {
    throw new Error(`Episodes root is not a directory: ${episodesRoot}`);
  }

  const realEpisodesRoot = await realpath(episodesRoot);
  if (!isWithin(realProjectRoot, realEpisodesRoot, false)) {
    throw new Error(`Real episodes root escapes the project: ${realEpisodesRoot}`);
  }

  const childPath = relative(episodesRoot, episodeDir);
  let currentPath = episodesRoot;
  let nearestExistingRealPath = realEpisodesRoot;
  for (const component of childPath.split(sep)) {
    currentPath = join(currentPath, component);
    let componentStat: PathStat;
    try {
      componentStat = await lstat(currentPath);
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === "ENOENT") break;
      throw error;
    }

    if (componentStat.isSymbolicLink()) {
      throw new Error(`Episode directory path contains a symlink: ${currentPath}`);
    }
    if (!componentStat.isDirectory()) {
      throw new Error(`Episode directory path component is not a directory: ${currentPath}`);
    }
    nearestExistingRealPath = await realpath(currentPath);
    if (!isWithin(realEpisodesRoot, nearestExistingRealPath, false)) {
      throw new Error(`Episode directory real path escapes episodes root: ${currentPath}`);
    }
  }

  if (!isWithin(realEpisodesRoot, nearestExistingRealPath, true)) {
    throw new Error(`Episode directory ancestor escapes episodes root: ${episodeDir}`);
  }
};

export async function runGptLiveCli<
  TResult = PrepareGptLiveProductionResult | FinishGptLiveProductionResult | GptLiveQaResult
>(
  rawArgs: readonly string[],
  dependencies: GptLiveCliDependencies<TResult> = {}
): Promise<TResult> {
  const command = rawArgs[0];

  if (command !== "prepare" && command !== "finish" && command !== "qa" && command !== "seal-exports") {
    throw new Error(`Unknown command: ${command ?? "<missing>"}`);
  }

  const sealArgs = command === "seal-exports" ? parseSealArgs(rawArgs.slice(1)) : undefined;
  const parsed = sealArgs ?? parsePrepareArgs(rawArgs.slice(1));
  const projectRoot = resolve((dependencies.cwd ?? process.cwd)());
  const episodeDir = resolveEpisodeDirectory(
    projectRoot,
    parsed.episodeDir ?? joinDefaultEpisodeDirectory(GPT_LIVE_CONTENT.id)
  );
  const env = await loadCliEnv(projectRoot, dependencies.loadEnvSnapshotFromFiles);
  const lstat = dependencies.lstat ?? defaultLstat;
  const realpath = dependencies.realpath ?? defaultRealpath;

  await validateRealEpisodeDirectory(projectRoot, episodeDir, lstat, realpath);

  if (command === "seal-exports") {
    const sealTellaExports = dependencies.sealTellaExports ??
      (defaultSealTellaExports as SealTellaExportsFunction<TResult>);
    return sealTellaExports({
      episodeDir,
      exports: buildSealIdentities(sealArgs!.values, env)
    });
  }

  const productionOptions = {
    episodeDir,
    env: env.values,
    ffmpegPath: env.values.FFMPEG_PATH ?? "ffmpeg",
    ffprobePath: env.values.FFPROBE_PATH ?? "ffprobe"
  };
  if (command === "finish") {
    const finishGptLiveProduction = dependencies.finishGptLiveProduction ??
      (defaultFinishGptLiveProduction as FinishGptLiveProductionFunction<TResult>);
    return finishGptLiveProduction(productionOptions);
  }
  if (command === "qa") {
    const qaGptLiveProduction = dependencies.qaGptLiveProduction ??
      (defaultRunGptLiveQa as QaGptLiveProductionFunction<TResult>);
    return qaGptLiveProduction(productionOptions);
  }
  const prepareGptLiveProduction = dependencies.prepareGptLiveProduction ??
    (defaultPrepareGptLiveProduction as PrepareGptLiveProductionFunction<TResult>);
  return prepareGptLiveProduction(productionOptions);
}

const joinDefaultEpisodeDirectory = (productionId: string): string =>
  `episodes/${productionId}`;

export function formatGptLiveCliResult(result: {
  episodeDir: string;
  machineOk?: true;
  humanPlayback?: { status: "pending" | "passed" | "failed"; note: string };
  readyForUpload?: boolean;
  ok?: boolean;
  reportPath?: string;
  receiptPath?: string;
  comparisonPath?: string;
  visualDirectory?: string;
}): string[] {
  const lines = [`episode: ${result.episodeDir}`];
  if (result.receiptPath) lines.push(`receipt: ${result.receiptPath}`);
  if (
    result.machineOk === true &&
    result.humanPlayback &&
    typeof result.readyForUpload === "boolean" &&
    typeof result.ok === "boolean" &&
    result.reportPath &&
    result.comparisonPath &&
    result.visualDirectory
  ) {
    lines.push(
      "machineOk: true",
      `humanPlayback: ${result.humanPlayback.status}`,
      `readyForUpload: ${result.readyForUpload}`,
      `ok: ${result.ok}`,
      `qa: ${result.reportPath}`,
      `comparison: ${result.comparisonPath}`,
      `visual: ${result.visualDirectory}`
    );
  }
  return lines;
}

const isDirectExecution = (): boolean => {
  const entrypoint = process.argv[1];
  return Boolean(entrypoint && pathToFileURL(resolve(entrypoint)).href === import.meta.url);
};

if (isDirectExecution()) {
  runGptLiveCli(process.argv.slice(2))
    .then((result) => {
      for (const line of formatGptLiveCliResult(result)) console.log(line);
    })
    .catch((error: unknown) => {
      console.error(error instanceof Error ? error.message : String(error));
      process.exitCode = 1;
    });
}
