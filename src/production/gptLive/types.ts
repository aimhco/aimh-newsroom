export type GptLiveVariant = "dynamic_editorial" | "aimh_visual_host";

export type TimelineKind = "source_clip" | "narration";

export interface ProductionSource {
  readonly id: string;
  readonly title: string;
  readonly url: string;
  readonly publisher: string;
  readonly accessedAt: string;
}

export interface ProductionClaim {
  readonly id: string;
  readonly text: string;
  readonly sourceIds: readonly string[];
}

export interface SourceClipSpec {
  readonly id: string;
  readonly kind: "source_clip";
  readonly playerConfigUrl: string;
  readonly startSeconds: number;
  readonly endSeconds: number;
  readonly sourceId: string;
}

export interface NarrationSpec {
  readonly id: string;
  readonly kind: "narration";
  readonly text: string;
  readonly claimIds: readonly string[];
  readonly scene: "hook" | "full_duplex" | "use_cases" | "evidence" | "availability" | "future" | "cta";
}

export type TimelineItem = SourceClipSpec | NarrationSpec;

export interface GptLiveProduction {
  readonly id: string;
  readonly variants: readonly GptLiveVariant[];
  readonly sources: readonly ProductionSource[];
  readonly claims: readonly ProductionClaim[];
  readonly narration: readonly NarrationSpec[];
  readonly timeline: readonly TimelineItem[];
  readonly branding: {
    readonly logoPath: string;
    readonly width: number;
    readonly marginTop: number;
    readonly marginRight: number;
    readonly opacity: number;
  };
  readonly musicPath: string;
}

export interface TellaProductionState {
  masterVideoId?: string;
  variantVideoIds: Partial<Record<GptLiveVariant, string>>;
  clipIds: Record<string, string>;
  sourceIds: Record<string, string>;
  exportPaths: Partial<Record<GptLiveVariant, string>>;
}
