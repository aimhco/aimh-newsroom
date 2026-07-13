import { join } from "node:path";
import { GPT_LIVE_CONTENT } from "./content";
import type { GptLiveVariant } from "./types";

export interface NarrationAsset {
  readonly id: string;
  readonly audioPath: string;
  readonly durationSeconds: number;
}

export interface TellaVariantPlate {
  readonly platePath: string;
  readonly narrationAudioPath: string;
}

export interface TellaSourceClipPlan {
  readonly id: string;
  readonly kind: "source_clip";
  readonly mediaPath: string;
  readonly durationSeconds: number;
  readonly preserveOriginalAudio: true;
}

export interface TellaNarrationClipPlan {
  readonly id: string;
  readonly kind: "narration";
  readonly masterPath: string;
  readonly durationSeconds: number;
  readonly variants: Record<GptLiveVariant, TellaVariantPlate>;
}

export type TellaClipPlan = TellaSourceClipPlan | TellaNarrationClipPlan;

export interface TellaPlan {
  readonly schemaVersion: "0.1.0";
  readonly productionId: string;
  readonly clips: readonly TellaClipPlan[];
}

export interface BuildTellaPlanOptions {
  readonly episodeDir: string;
  readonly narrationAssets: readonly NarrationAsset[];
}

const narrationAssetMap = (
  episodeDir: string,
  assets: readonly NarrationAsset[]
): ReadonlyMap<string, NarrationAsset> => {
  const expectedIds = new Set<string>(GPT_LIVE_CONTENT.narration.map(({ id }) => id));
  const byId = new Map<string, NarrationAsset>();

  for (const asset of assets) {
    if (!expectedIds.has(asset.id)) {
      throw new Error(`Unknown narration asset: ${asset.id}`);
    }
    if (byId.has(asset.id)) {
      throw new Error(`Duplicate narration asset: ${asset.id}`);
    }
    if (!Number.isFinite(asset.durationSeconds) || asset.durationSeconds <= 0) {
      throw new Error(`Invalid narration duration: ${asset.id}`);
    }
    const expectedAudioPath = join(episodeDir, "voice", `${asset.id}.mp3`);
    if (asset.audioPath !== expectedAudioPath) {
      throw new Error(`Unexpected narration audio path: ${asset.id}`);
    }
    byId.set(asset.id, asset);
  }

  for (const id of expectedIds) {
    if (!byId.has(id)) throw new Error(`Missing narration asset: ${id}`);
  }

  return byId;
};

export function buildTellaPlan(options: BuildTellaPlanOptions): TellaPlan {
  const assets = narrationAssetMap(options.episodeDir, options.narrationAssets);
  const clips: TellaClipPlan[] = GPT_LIVE_CONTENT.timeline.map((item) => {
    if (item.kind === "source_clip") {
      return {
        id: item.id,
        kind: item.kind,
        mediaPath: join(options.episodeDir, "source", `${item.id}.mp4`),
        durationSeconds: item.endSeconds - item.startSeconds,
        preserveOriginalAudio: true
      };
    }

    const asset = assets.get(item.id)!;
    const variant = (name: GptLiveVariant): TellaVariantPlate => ({
      platePath: join(options.episodeDir, "plates", name, `${item.id}.mp4`),
      narrationAudioPath: asset.audioPath
    });

    return {
      id: item.id,
      kind: item.kind,
      masterPath: join(options.episodeDir, "master", `${item.id}.mp4`),
      durationSeconds: asset.durationSeconds,
      variants: {
        dynamic_editorial: variant("dynamic_editorial"),
        aimh_visual_host: variant("aimh_visual_host")
      }
    };
  });

  return {
    schemaVersion: "0.1.0",
    productionId: GPT_LIVE_CONTENT.id,
    clips
  };
}
