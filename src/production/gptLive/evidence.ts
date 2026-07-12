import { constants } from "node:fs";
import {
  lstat as defaultLstat,
  mkdir as defaultMkdir,
  mkdtemp as defaultMakeTempDirectory,
  open as defaultOpen,
  realpath as defaultRealpath,
  rm as defaultRemoveDirectory,
  stat as defaultStat,
  type FileHandle
} from "node:fs/promises";
import { tmpdir } from "node:os";
import { basename, extname, isAbsolute, join, relative, resolve, sep } from "node:path";
import { GPT_LIVE_CONTENT } from "./content";
import { validateContainedEpisodePaths } from "./qa/paths";
import type { EvidenceSpec, GptLiveScene } from "./types";

interface EvidenceAssetStat {
  readonly dev: number;
  readonly ino: number;
  readonly size: number;
  isDirectory(): boolean;
  isFile(): boolean;
  isSymbolicLink(): boolean;
}

type OpenFile = (path: string, flags: number, mode?: number) => Promise<FileHandle>;

export interface EvidenceAssetDependencies {
  readonly lstat?: (path: string) => Promise<EvidenceAssetStat>;
  readonly open?: OpenFile;
  readonly realpath?: (path: string) => Promise<string>;
  readonly stat?: (path: string) => Promise<EvidenceAssetStat>;
}

export interface StageEvidencePublicAssetsDependencies extends EvidenceAssetDependencies {
  readonly makeTempDirectory?: (prefix: string) => Promise<string>;
  readonly mkdir?: (path: string, options: { recursive: true }) => Promise<unknown>;
  readonly removeDirectory?: (path: string) => Promise<void>;
}

export interface StagedEvidencePublicAssets {
  readonly publicDir: string;
  readonly dimensions: EvidenceAssetDimensionsByPath;
  cleanup(): Promise<void>;
}

export interface EvidenceAssetDimensions {
  readonly width: number;
  readonly height: number;
}

export type EvidenceAssetDimensionsByPath = Readonly<
  Record<string, EvidenceAssetDimensions>
>;

const PNG_SIGNATURE = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
const READ_ONLY_NOFOLLOW =
  constants.O_RDONLY |
  (typeof constants.O_NOFOLLOW === "number" ? constants.O_NOFOLLOW : 0);

interface CapturedEvidenceRoots {
  readonly episodeRoot: string;
  readonly evidenceRoot: string;
  readonly evidenceDirectory: string;
  readonly evidenceDirectoryStat: EvidenceAssetStat;
}

interface ValidatedCapturePaths {
  readonly capturePaths: readonly string[];
  readonly roots: CapturedEvidenceRoots;
}

const isWithinRoot = (root: string, candidate: string, allowRoot = false): boolean => {
  const descendant = relative(root, candidate);
  if (!descendant) return allowRoot;
  return (
    descendant !== ".." &&
    !descendant.startsWith(`..${sep}`) &&
    !isAbsolute(descendant)
  );
};

const capturedEvidence = (evidenceItems: readonly EvidenceSpec[]): readonly EvidenceSpec[] => {
  const captures = evidenceItems.filter(
    (item) => item.playbackDecision === "captured_source"
  );
  for (const evidence of captures) {
    if (extname(evidence.assetPath).toLowerCase() !== ".png") {
      throw new Error(`Evidence capture must be a PNG: ${evidence.id}`);
    }
  }
  return captures;
};

const assertPngHeader = (
  contents: Buffer,
  evidence: EvidenceSpec
): EvidenceAssetDimensions => {
  if (!contents.subarray(0, PNG_SIGNATURE.length).equals(PNG_SIGNATURE)) {
    throw new Error(`Evidence capture has an invalid PNG signature: ${evidence.id}`);
  }
  if (
    contents.length < 24 ||
    contents.readUInt32BE(8) !== 13 ||
    contents.toString("ascii", 12, 16) !== "IHDR" ||
    contents.readUInt32BE(16) === 0 ||
    contents.readUInt32BE(20) === 0
  ) {
    throw new Error(`Evidence capture has an invalid PNG IHDR: ${evidence.id}`);
  }
  return {
    width: contents.readUInt32BE(16),
    height: contents.readUInt32BE(20)
  };
};

const inspectOpenedEvidence = async (
  evidencePath: string,
  evidence: EvidenceSpec,
  lstat: (path: string) => Promise<EvidenceAssetStat>,
  open: OpenFile,
  realpath: (path: string) => Promise<string>,
  stat: (path: string) => Promise<EvidenceAssetStat>,
  roots: CapturedEvidenceRoots,
  action?: (handle: FileHandle, dimensions: EvidenceAssetDimensions) => Promise<void>
): Promise<EvidenceAssetDimensions> => {
  let pathStat: EvidenceAssetStat;
  try {
    pathStat = await lstat(evidencePath);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") {
      throw new Error(`Evidence asset is missing: ${evidence.id}`);
    }
    throw new Error(`Evidence asset could not be inspected: ${evidence.id}`, { cause: error });
  }
  if (pathStat.isSymbolicLink()) {
    throw new Error(`Evidence asset must not be a symlink: ${evidence.id}`);
  }

  let handle: FileHandle;
  try {
    handle = await open(evidencePath, READ_ONLY_NOFOLLOW);
  } catch (error) {
    const code = (error as NodeJS.ErrnoException).code;
    if (code === "ELOOP") {
      throw new Error(`Evidence asset must not be a symlink: ${evidence.id}`);
    }
    if (code === "ENOENT") {
      throw new Error(`Evidence asset is missing: ${evidence.id}`);
    }
    throw new Error(`Evidence asset is not readable: ${evidence.id}`, { cause: error });
  }

  try {
    const openedStat = await handle.stat();
    if (!openedStat.isFile()) {
      throw new Error(`Evidence asset must be a regular file: ${evidence.id}`);
    }
    if (openedStat.dev !== pathStat.dev || openedStat.ino !== pathStat.ino) {
      throw new Error(`Evidence asset changed during validation: ${evidence.id}`);
    }
    let currentEvidenceRoot: string;
    let resolvedEvidencePath: string;
    try {
      [currentEvidenceRoot, resolvedEvidencePath] = await Promise.all([
        realpath(roots.evidenceDirectory),
        realpath(evidencePath)
      ]);
    } catch (error) {
      throw new Error(`Evidence asset changed during validation: ${evidence.id}`, { cause: error });
    }
    if (
      currentEvidenceRoot !== roots.evidenceRoot ||
      !isWithinRoot(roots.episodeRoot, resolvedEvidencePath) ||
      !isWithinRoot(roots.evidenceRoot, resolvedEvidencePath)
    ) {
      throw new Error(`Evidence asset is outside captured evidence root: ${evidence.id}`);
    }
    const [currentDirectoryStat, resolvedPathStat] = await Promise.all([
      stat(currentEvidenceRoot),
      stat(resolvedEvidencePath)
    ]);
    if (
      currentDirectoryStat.dev !== roots.evidenceDirectoryStat.dev ||
      currentDirectoryStat.ino !== roots.evidenceDirectoryStat.ino ||
      resolvedPathStat.dev !== openedStat.dev ||
      resolvedPathStat.ino !== openedStat.ino
    ) {
      throw new Error(`Evidence asset changed during validation: ${evidence.id}`);
    }
    if (openedStat.size <= 0) {
      throw new Error(`Evidence asset must not be empty: ${evidence.id}`);
    }
    const header = Buffer.alloc(24);
    const { bytesRead } = await handle.read(header, 0, header.length, 0);
    const dimensions = assertPngHeader(header.subarray(0, bytesRead), evidence);
    await action?.(handle, dimensions);
    return dimensions;
  } finally {
    await handle.close();
  }
};

const validateCapturePaths = async (
  episodeDir: string,
  captures: readonly EvidenceSpec[],
  dependencies: EvidenceAssetDependencies
): Promise<ValidatedCapturePaths> => {
  const realpath = dependencies.realpath ?? defaultRealpath;
  const stat = dependencies.stat ?? defaultStat;
  const episodeRoot = await realpath(resolve(episodeDir));
  const evidenceDirectory = resolve(episodeDir, "evidence");
  let evidenceRoot: string;
  try {
    evidenceRoot = await realpath(evidenceDirectory);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") {
      throw new Error(`Evidence asset is missing: ${captures[0]!.id}`);
    }
    throw error;
  }
  if (!isWithinRoot(episodeRoot, evidenceRoot)) {
    throw new Error("Evidence directory is outside captured episode root");
  }
  const evidenceDirectoryStat = await stat(evidenceRoot);
  if (!evidenceDirectoryStat.isDirectory()) {
    throw new Error("Evidence path is not a directory");
  }
  const capturePaths = captures.map((evidence) =>
    resolveEvidenceAssetPath(episodeDir, evidence)
  );
  await validateContainedEpisodePaths(episodeDir, capturePaths, {
    lstat: dependencies.lstat ?? defaultLstat,
    realpath,
    context: "GPT-Live evidence"
  });
  return {
    capturePaths,
    roots: { episodeRoot, evidenceRoot, evidenceDirectory, evidenceDirectoryStat }
  };
};

const copyOpenedFile = async (
  source: FileHandle,
  destinationPath: string,
  open: OpenFile
): Promise<void> => {
  const destination = await open(
    destinationPath,
    constants.O_WRONLY | constants.O_CREAT | constants.O_EXCL,
    0o600
  );
  try {
    const buffer = Buffer.alloc(64 * 1024);
    let position = 0;
    while (true) {
      const { bytesRead } = await source.read(buffer, 0, buffer.length, position);
      if (bytesRead === 0) break;
      let written = 0;
      while (written < bytesRead) {
        const result = await destination.write(buffer, written, bytesRead - written, position + written);
        written += result.bytesWritten;
      }
      position += bytesRead;
    }
    await destination.sync();
  } finally {
    await destination.close();
  }
};

export function resolveEvidenceAssetPath(episodeDir: string, evidence: EvidenceSpec): string {
  const resolvedEpisode = resolve(episodeDir);
  const resolvedAsset = resolve(resolvedEpisode, evidence.assetPath);
  const descendant = relative(resolvedEpisode, resolvedAsset);
  if (
    !descendant ||
    descendant === ".." ||
    descendant.startsWith(`..${sep}`) ||
    isAbsolute(descendant)
  ) {
    throw new Error("Evidence asset must remain inside the episode directory");
  }
  return resolvedAsset;
}

export function evidencePublicAssetPath(evidence: EvidenceSpec): string {
  return `evidence/${basename(evidence.assetPath)}`;
}

export function evidenceForScene(scene: GptLiveScene): EvidenceSpec | undefined {
  return GPT_LIVE_CONTENT.evidence.find(
    (item) => item.scene === scene && item.playbackDecision === "captured_source"
  );
}

export async function validateEvidenceAssets(
  episodeDir: string,
  evidenceItems: readonly EvidenceSpec[] = GPT_LIVE_CONTENT.evidence,
  dependencies: EvidenceAssetDependencies = {}
): Promise<void> {
  const captures = capturedEvidence(evidenceItems);
  if (captures.length === 0) return;
  const validatedPaths = await validateCapturePaths(episodeDir, captures, dependencies);
  const lstat = dependencies.lstat ?? defaultLstat;
  const open = dependencies.open ?? defaultOpen;
  const realpath = dependencies.realpath ?? defaultRealpath;
  const stat = dependencies.stat ?? defaultStat;
  for (const [index, evidence] of captures.entries()) {
    await inspectOpenedEvidence(
      validatedPaths.capturePaths[index]!,
      evidence,
      lstat,
      open,
      realpath,
      stat,
      validatedPaths.roots
    );
  }
}

export async function stageEvidencePublicAssets(
  episodeDir: string,
  evidenceItems: readonly EvidenceSpec[] = GPT_LIVE_CONTENT.evidence,
  dependencies: StageEvidencePublicAssetsDependencies = {}
): Promise<StagedEvidencePublicAssets> {
  const captures = capturedEvidence(evidenceItems);
  const publicPaths = captures.map(evidencePublicAssetPath);
  if (new Set(publicPaths).size !== publicPaths.length) {
    throw new Error("Evidence captures must have unique public basenames");
  }

  const makeTempDirectory = dependencies.makeTempDirectory ?? defaultMakeTempDirectory;
  const mkdir = dependencies.mkdir ?? defaultMkdir;
  const removeDirectory = dependencies.removeDirectory ??
    ((path: string) => defaultRemoveDirectory(path, { recursive: true, force: true }));
  const lstat = dependencies.lstat ?? defaultLstat;
  const open = dependencies.open ?? defaultOpen;
  const realpath = dependencies.realpath ?? defaultRealpath;
  const stat = dependencies.stat ?? defaultStat;
  const publicDir = await makeTempDirectory(join(tmpdir(), "gpt-live-evidence-public-"));
  const dimensions: Record<string, EvidenceAssetDimensions> = {};
  let cleaned = false;
  const cleanup = async (): Promise<void> => {
    if (cleaned) return;
    await removeDirectory(publicDir);
    cleaned = true;
  };

  try {
    await mkdir(join(publicDir, "evidence"), { recursive: true });
    if (captures.length > 0) {
      const validatedPaths = await validateCapturePaths(episodeDir, captures, dependencies);
      for (const [index, evidence] of captures.entries()) {
        dimensions[publicPaths[index]!] = await inspectOpenedEvidence(
          validatedPaths.capturePaths[index]!,
          evidence,
          lstat,
          open,
          realpath,
          stat,
          validatedPaths.roots,
          (handle) => copyOpenedFile(handle, join(publicDir, publicPaths[index]!), open)
        );
      }
    }
    return { publicDir, dimensions, cleanup };
  } catch (error) {
    await cleanup();
    throw error;
  }
}
