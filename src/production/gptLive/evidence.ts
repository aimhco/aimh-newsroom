import { constants } from "node:fs";
import {
  access as defaultAccess,
  lstat as defaultLstat,
  realpath as defaultRealpath
} from "node:fs/promises";
import { extname, isAbsolute, relative, resolve, sep } from "node:path";
import { GPT_LIVE_CONTENT } from "./content";
import { validateContainedEpisodePaths } from "./qa/paths";
import type { EvidenceSpec, GptLiveScene } from "./types";

interface EvidenceAssetStat {
  readonly size: number;
  isDirectory(): boolean;
  isFile(): boolean;
  isSymbolicLink(): boolean;
}

export interface EvidenceAssetDependencies {
  readonly access?: (path: string, mode?: number) => Promise<void>;
  readonly lstat?: (path: string) => Promise<EvidenceAssetStat>;
  readonly realpath?: (path: string) => Promise<string>;
}

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
  const access = dependencies.access ?? defaultAccess;
  const lstat = dependencies.lstat ?? defaultLstat;
  const realpath = dependencies.realpath ?? defaultRealpath;
  const captures = evidenceItems.filter(
    (item) => item.playbackDecision === "captured_source"
  );

  for (const evidence of captures) {
    if (extname(evidence.assetPath).toLowerCase() !== ".png") {
      throw new Error(`Evidence capture must be a PNG: ${evidence.id}`);
    }
  }
  if (captures.length === 0) return;

  const capturePaths = captures.map((evidence) =>
    resolveEvidenceAssetPath(episodeDir, evidence)
  );
  await validateContainedEpisodePaths(episodeDir, capturePaths, {
    lstat,
    realpath,
    context: "GPT-Live evidence"
  });

  for (const [index, evidence] of captures.entries()) {
    const evidencePath = capturePaths[index]!;
    let stat: EvidenceAssetStat;
    try {
      stat = await lstat(evidencePath);
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === "ENOENT") {
        throw new Error(`Evidence asset is missing: ${evidence.id}`);
      }
      throw new Error(`Evidence asset could not be inspected: ${evidence.id}`, { cause: error });
    }
    if (stat.isSymbolicLink()) {
      throw new Error(`Evidence asset must not be a symlink: ${evidence.id}`);
    }
    if (!stat.isFile()) {
      throw new Error(`Evidence asset must be a regular file: ${evidence.id}`);
    }
    if (stat.size <= 0) {
      throw new Error(`Evidence asset must not be empty: ${evidence.id}`);
    }
    try {
      await access(evidencePath, constants.R_OK);
    } catch (error) {
      throw new Error(`Evidence asset is not readable: ${evidence.id}`, { cause: error });
    }
  }
}
