import { validateMediaManifest, type MediaManifest } from "../capture/mediaManifest";
import {
  validateResearchManifest,
  type ResearchManifest
} from "./researchManifest";

export interface ArticleEditorialGateInput {
  readonly researchManifest: ResearchManifest;
  readonly mediaManifest: MediaManifest;
  readonly usedPrimaryMotionAssets: readonly string[];
}

const isMotion = (kind: MediaManifest["items"][number]["kind"]): boolean =>
  kind === "video" || kind === "interactive" || kind === "iframe";

export function validateArticleEditorialGate(input: ArticleEditorialGateInput): void {
  validateResearchManifest(input.researchManifest);
  validateMediaManifest(input.mediaManifest);

  const selectedMotion = input.mediaManifest.items.filter(
    (item) => item.decision === "selected" && isMotion(item.kind)
  );
  for (const item of selectedMotion) {
    if (!item.local_asset) {
      throw new Error(`Selected primary motion ${item.id} requires a captured local_asset`);
    }
  }

  const selectedAssets = new Set(
    selectedMotion.flatMap((item) => (item.local_asset ? [item.local_asset] : []))
  );
  for (const assetPath of input.usedPrimaryMotionAssets) {
    if (!selectedAssets.has(assetPath)) {
      throw new Error(
        `Used primary motion must be selected in the media audit with a captured local_asset: ${assetPath}`
      );
    }
  }
}
