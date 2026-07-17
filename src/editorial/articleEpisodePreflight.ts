import { lstat, readFile, realpath } from "node:fs/promises";
import { join, relative } from "node:path";
import type { MediaManifest } from "../capture/mediaManifest";
import { validateArticleEditorialGate } from "./articleEditorialGate";
import type { ResearchManifest } from "./researchManifest";

export interface ArticleEpisodePreflightInput {
  readonly episodeDir: string;
  readonly usedPrimaryMotionAssets: readonly string[];
}

export interface ArticleEpisodePreflightResult {
  readonly researchManifest: ResearchManifest;
  readonly mediaManifest: MediaManifest;
  readonly selectedMotionAssets: readonly string[];
}

const readJson = async <T>(path: string): Promise<T> =>
  JSON.parse(await readFile(path, "utf8")) as T;

const isMotionKind = (kind: MediaManifest["items"][number]["kind"]): boolean =>
  kind === "video" || kind === "interactive" || kind === "iframe";

const requireContainedRegularFile = async (
  episodeDir: string,
  assetPath: string
): Promise<void> => {
  const episodeRealPath = await realpath(episodeDir);
  const candidate = join(episodeDir, assetPath);
  try {
    const [candidateRealPath, status] = await Promise.all([realpath(candidate), lstat(candidate)]);
    const fromEpisode = relative(episodeRealPath, candidateRealPath);
    if (
      status.isSymbolicLink() ||
      !status.isFile() ||
      fromEpisode === "" ||
      fromEpisode.startsWith("..")
    ) {
      throw new Error("unsafe or not a regular file");
    }
  } catch {
    throw new Error(`Selected primary motion asset is unavailable: ${assetPath}`);
  }
};

export async function validateArticleEpisodePreflight(
  input: ArticleEpisodePreflightInput
): Promise<ArticleEpisodePreflightResult> {
  const [researchManifest, mediaManifest] = await Promise.all([
    readJson<ResearchManifest>(join(input.episodeDir, "research-manifest.json")),
    readJson<MediaManifest>(join(input.episodeDir, "media-manifest.json"))
  ]);
  validateArticleEditorialGate({
    researchManifest,
    mediaManifest,
    usedPrimaryMotionAssets: input.usedPrimaryMotionAssets
  });
  const selectedMotionAssets = mediaManifest.items.flatMap((item) =>
    item.decision === "selected" && isMotionKind(item.kind) && item.local_asset
      ? [item.local_asset]
      : []
  );
  await Promise.all(
    selectedMotionAssets.map((assetPath) =>
      requireContainedRegularFile(input.episodeDir, assetPath)
    )
  );
  return { researchManifest, mediaManifest, selectedMotionAssets };
}
