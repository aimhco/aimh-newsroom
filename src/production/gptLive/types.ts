export type GptLiveVariant = "dynamic_editorial" | "aimh_visual_host";

export type TimelineKind = "source_clip" | "narration";

export interface ProductionSource {
  id: string;
  title: string;
  url: string;
  publisher: string;
  accessedAt: string;
}

export interface ProductionClaim {
  id: string;
  text: string;
  sourceIds: readonly string[];
}

export interface SourceClipSpec {
  id: string;
  kind: "source_clip";
  playerConfigUrl: string;
  startSeconds: number;
  endSeconds: number;
  sourceId: string;
}

export interface NarrationSpec {
  id: string;
  kind: "narration";
  text: string;
  claimIds: readonly string[];
  scene: "hook" | "full_duplex" | "use_cases" | "evidence" | "availability" | "future" | "cta";
}

export type TimelineItem = SourceClipSpec | NarrationSpec;

export interface GptLiveProduction {
  id: string;
  variants: readonly GptLiveVariant[];
  sources: readonly ProductionSource[];
  claims: readonly ProductionClaim[];
  narration: readonly NarrationSpec[];
  timeline: readonly TimelineItem[];
  branding: {
    logoPath: string;
    width: number;
    marginTop: number;
    marginRight: number;
    opacity: number;
  };
  musicPath: string;
}

export interface TellaProductionState {
  masterVideoId?: string;
  variantVideoIds: Partial<Record<GptLiveVariant, string>>;
  clipIds: Record<string, string>;
  sourceIds: Record<string, string>;
  exportPaths: Partial<Record<GptLiveVariant, string>>;
}
