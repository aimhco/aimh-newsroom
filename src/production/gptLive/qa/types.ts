import type { FinalMediaInspection, PublishedGenerationValidation } from "../finish";
import type { MediaInspection } from "../mediaInspection";
import type { TellaPlan } from "../tellaPlan";

export type QaVariantName = "version-a" | "version-b";

export interface QaProduction {
  schemaVersion: string;
  id: string;
  variants: string[];
  sources: Array<{ id: string; title: string; url: string; publisher: string; accessedAt: string }>;
  claims: Array<{ id: string; text: string; sourceIds: string[] }>;
  narration: Array<{
    id: string;
    kind: "narration";
    text: string;
    claimIds: string[];
    scene: string;
  }>;
  timeline: Array<Record<string, unknown> & { id: string; kind: "source_clip" | "narration" }>;
  branding: {
    logoPath: string;
    width: number;
    marginTop: number;
    marginRight: number;
    opacity: number;
  };
  musicPath: string;
}

export interface QaVoiceChunk {
  id: string;
  text: string;
  file: string;
  durationSeconds: number;
  provider: string;
  cached: boolean;
}

export interface QaVoice {
  provider: string;
  chunks: QaVoiceChunk[];
  warnings: string[];
}

export interface QaVoiceCacheMetadata {
  schemaVersion: string;
  cacheKey: string;
  modelId: string;
}

export interface QaSafeArea {
  variant: string;
  scene: string;
  x: number;
  y: number;
  width: number;
  height: number;
}

export interface QaTailAudioCheck {
  tailPeakDb: number;
  endPeakDb: number;
}

export interface QaPreparedMediaInspection extends MediaInspection {
  video: MediaInspection["video"] & { pixelFormat: string };
  audio?: { codecName: string; sampleRate: number; channels: number };
}

export interface GptLiveQaSnapshot {
  episodeDir: string;
  env: Record<string, string | undefined>;
  generation: PublishedGenerationValidation;
  production: QaProduction;
  sourceMatrix: string;
  prepared: Record<string, unknown>;
  voice: QaVoice;
  voiceCacheMetadata: Record<string, QaVoiceCacheMetadata | null>;
  plan: TellaPlan;
  tellaState: unknown;
  postProduction: Record<string, unknown>;
  logo: { path: string; sha256: string };
  filePresence: Record<string, boolean>;
  media: {
    sources: Record<string, QaPreparedMediaInspection>;
    masters: Record<string, QaPreparedMediaInspection>;
    plates: Record<string, QaPreparedMediaInspection>;
    finals: Record<QaVariantName, FinalMediaInspection>;
  };
  safeAreas: QaSafeArea[];
  tailAudio: Record<QaVariantName, QaTailAudioCheck>;
}

export interface VisualArtifacts {
  contactSheets: Record<QaVariantName, string>;
  transitionFrames: Record<QaVariantName, string[]>;
  tailAudio: Record<QaVariantName, string>;
  contactSampleTimesSeconds: Record<QaVariantName, number[]>;
  checkedFrameCount: number;
}

export interface GptLiveQaResult {
  episodeDir: string;
  ok: true;
  reportPath: string;
  comparisonPath: string;
  visualDirectory: string;
  visualArtifacts: VisualArtifacts;
}
