export type SourceType = "official" | "newsletter" | "social" | "repo" | "news" | "trend" | "model" | "other";

export interface RawItem {
  id: string;
  title: string;
  url: string;
  publisher: string;
  source_type: SourceType;
  published_at?: string;
  summary: string;
  scores: StoryScores;
  tags: string[];
}

export interface StoryScores {
  freshness: number;
  trend_velocity: number;
  aimh_audience_fit: number;
  credibility: number;
  demoability: number;
  novelty: number;
  risk_or_noise: number;
  duplicate_coverage_penalty: number;
}

export interface CandidateStory {
  id: string;
  title: string;
  summary: string;
  sourceIds: string[];
  claimIds: string[];
  sourceTypes: SourceType[];
  scores: StoryScores;
}

export interface RankedStory extends CandidateStory {
  finalScore: number;
  scoreBreakdown: StoryScores & { final_score: number };
  selectionRole?: "main_story" | "practical_demo" | "tool_to_watch" | "quick_hit";
}

export interface StoryCluster {
  id: string;
  title: string;
  storyIds: string[];
  sourceIds: string[];
  claimIds: string[];
}

export type VerificationStatus = "verified" | "partially_verified" | "unverified" | "rejected";

export interface ClaimRecord {
  id: string;
  text: string;
  source_ids: string[];
  verification_status: VerificationStatus;
  risk_notes: string[];
}

export interface SourceRecord {
  id: string;
  url: string;
  title: string;
  publisher: string;
  source_type: SourceType;
  published_at?: string;
  accessed_at: string;
}

export interface SourcesFile {
  schema_version: "0.1.0";
  claims: ClaimRecord[];
  sources: SourceRecord[];
}

export interface EpisodeFile {
  schema_version: "0.1.0";
  episode_id: string;
  date: string;
  timezone: string;
  title: string;
  description: string;
  format: "daily_ai_briefing";
  target_duration_seconds: number;
  status: "planned" | "capturing" | "rendering" | "qa" | "ready" | "uploaded_private" | "needs_review";
  segments: Array<{
    id: string;
    role: string;
    title: string;
    story_id: string;
  }>;
  youtube: Record<string, unknown>;
  sources_file: "sources.json";
  script_file: "script.json";
  shotlist_file: "shotlist.json";
  metadata_file: "metadata.json";
}

export interface ScriptFile {
  schema_version: "0.1.0";
  voice: {
    provider: "elevenlabs" | "placeholder";
    voice_id_env: "ELEVENLABS_VOICE_ID";
    style: string;
  };
  narration: Array<{
    id: string;
    segment_id: string;
    text: string;
    speech_text?: string;
    critical_phrases?: string[];
    estimated_seconds: number;
    claim_ids: string[];
    shot_ids: string[];
  }>;
}

export type ShotType =
  | "headline_card"
  | "source_screenshot"
  | "source_highlight_clip"
  | "browser_demo_clip"
  | "social_card"
  | "repo_card"
  | "model_card"
  | "comparison_card"
  | "trend_card"
  | "takeaway_card"
  | "cta_card";

export interface ShotlistFile {
  schema_version: "0.1.0";
  shots: Array<{
    id: string;
    segment_id: string;
    type: ShotType;
    duration_seconds: number;
    source_url?: string;
    highlight_text?: string;
    fallback: {
      type: ShotType;
      card_text: string;
    };
    asset_path: string | null;
    status: "planned" | "captured" | "failed" | "fallback_generated";
  }>;
}

export interface MetadataFile {
  schema_version: "0.1.0";
  youtube: {
    title: string;
    description: string;
    tags: string[];
    categoryId: string;
    privacyStatus: "private";
    madeForKids: false;
    containsSyntheticMedia: boolean;
  };
  thumbnail: {
    brief: string;
    text_options: string[];
  };
}

export interface EpisodePackage {
  episode: EpisodeFile;
  script: ScriptFile;
  shotlist: ShotlistFile;
  sources: SourcesFile;
  metadata: MetadataFile;
}

export interface QaCheck {
  name: string;
  pass: boolean;
  detail: string;
}

export interface QaReport {
  ok: boolean;
  checks: QaCheck[];
  warnings: string[];
}

export interface QuestionForDenny {
  title: string;
  neededFor: string;
  defaultUsed: string;
  impact: string;
  toResolve: string;
  resumeCommand: string;
}

export interface RunEvent {
  run_id: string;
  task_id: string;
  status: "queued" | "running" | "succeeded" | "failed" | "rate_limited" | "skipped" | "fallback_used";
  started_at: string;
  finished_at?: string;
  resume_at?: string;
  attempts: number;
  error_redacted?: string;
  fallback_used?: boolean;
}
