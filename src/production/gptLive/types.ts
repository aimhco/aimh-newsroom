export type GptLiveVariant = "dynamic_editorial" | "aimh_visual_host";

export type GptLiveScene =
  | "hook"
  | "full_duplex"
  | "use_cases"
  | "evidence"
  | "availability"
  | "future"
  | "cta";

export type TimelineKind = "source_clip" | "narration";

export type EvidenceBandPlacement = "left" | "right" | "top" | "bottom";

export interface EvidenceFocalRect {
  readonly x: number;
  readonly y: number;
  readonly width: number;
  readonly height: number;
}

export interface EvidenceSpec {
  readonly id: string;
  readonly scene: GptLiveScene;
  readonly sourceId: string;
  readonly assetPath: string;
  readonly canonicalUrl: string;
  readonly mediaUrl?: string;
  readonly displayUrl: string;
  readonly publisher: string;
  readonly sourceType: "primary" | "reporting" | "social" | "third_party_video";
  readonly playbackDecision: "full_screen_original_audio" | "captured_source";
  readonly placement: EvidenceBandPlacement;
  readonly takeaway: string;
  readonly detail: string;
  readonly focalRect: EvidenceFocalRect;
  readonly youtubeDescription: boolean;
}

export interface AudioPolicy {
  readonly introMusic: false;
  readonly bodyMusic: false;
  readonly outroMusicPath: string;
  readonly outroDurationSeconds: number;
}

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
  readonly scene: GptLiveScene;
}

interface VisualSceneBase<TScene extends GptLiveScene> {
  readonly scene: TScene;
  readonly sectionNumber: string;
  readonly header: string;
  readonly seriesLabel?: string;
  readonly headline: string;
  readonly narrationId: string;
  readonly narrationText: string;
  readonly claimIds: readonly string[];
  readonly sourceLabels: readonly string[];
}

export interface HookSceneContent extends VisualSceneBase<"hook"> {
  readonly listeningLabel: string;
  readonly listeningValue: string;
  readonly speakingLabel: string;
  readonly speakingValue: string;
  readonly inputLabel: string;
  readonly simultaneousLabel: string;
}

export interface FullDuplexSceneContent extends VisualSceneBase<"full_duplex"> {
  readonly legacyLabel: string;
  readonly legacySteps: readonly string[];
  readonly concurrentLabel: string;
  readonly tracks: readonly string[];
  readonly interruptionLabel: string;
}

export interface UseCasesSceneContent extends VisualSceneBase<"use_cases"> {
  readonly progressLabel: string;
  readonly items: readonly {
    readonly number: string;
    readonly label: string;
    readonly detail: string;
  }[];
}

export interface EvidenceSceneContent extends VisualSceneBase<"evidence"> {
  readonly worldCupAttribution: string;
  readonly worldCupHeadline: string;
  readonly worldCupDetail: string;
  readonly benchmarkAttribution: string;
  readonly benchmarkComparison: string;
  readonly benchmarkName: string;
  readonly benchmarkStatement: string;
  readonly qualification: string;
}

export interface AvailabilitySceneContent extends VisualSceneBase<"availability"> {
  readonly tiers: readonly { readonly label: string; readonly value: string }[];
  readonly limitsLabel: string;
  readonly limits: readonly string[];
}

export interface FutureSceneContent extends VisualSceneBase<"future"> {
  readonly flows: readonly { readonly from: string; readonly to: string }[];
  readonly summary: string;
}

export interface CtaSceneContent extends VisualSceneBase<"cta"> {
  readonly prompts: readonly string[];
  readonly audiencePrompt: string;
}

export type SceneContent =
  | HookSceneContent
  | FullDuplexSceneContent
  | UseCasesSceneContent
  | EvidenceSceneContent
  | AvailabilitySceneContent
  | FutureSceneContent
  | CtaSceneContent;

export type GptLiveVisualContent = {
  readonly [TScene in GptLiveScene]: Extract<SceneContent, { readonly scene: TScene }>;
};

export type TimelineItem = SourceClipSpec | NarrationSpec;

export interface GptLiveProduction {
  readonly id: string;
  readonly variants: readonly GptLiveVariant[];
  readonly sources: readonly ProductionSource[];
  readonly claims: readonly ProductionClaim[];
  readonly narration: readonly NarrationSpec[];
  readonly timeline: readonly TimelineItem[];
  readonly evidence: readonly EvidenceSpec[];
  readonly audio: AudioPolicy;
  readonly branding: {
    readonly logoPath: string;
    readonly width: number;
    readonly marginTop: number;
    readonly marginRight: number;
    readonly opacity: number;
  };
}

export interface TellaProductionState {
  masterVideoId?: string;
  variantVideoIds: Partial<Record<GptLiveVariant, string>>;
  clipIds: Record<string, string>;
  sourceIds: Record<string, string>;
  exportPaths: Partial<Record<GptLiveVariant, string>>;
}
