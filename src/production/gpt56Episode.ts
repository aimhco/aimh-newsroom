import { createHash } from "node:crypto";
import {
  access,
  readFile,
  readdir,
  rm
} from "node:fs/promises";
import { basename, dirname, join, relative } from "node:path";
import { fileURLToPath } from "node:url";
import { bundle } from "@remotion/bundler";
import { renderMedia, selectComposition } from "@remotion/renderer";
import { runPackageQa } from "../qa/qaRunner";
import { buildCaptionsSrt } from "../render/captions";
import { ffprobeDurationSeconds, runCommand } from "../render/process";
import type { EpisodePackage, ScriptFile } from "../types";
import { ensureDir, writeJson, writeText } from "../utils/fs";
import {
  synthesizeNarration,
  type VoiceChunkResult,
  type VoiceRenderResult
} from "../voice/elevenLabsAdapter";
import { validateProductionManifest } from "./gptLive/content";
import {
  stageEvidencePublicAssets,
  type EvidenceAssetDimensions,
  type StagedEvidencePublicAssets
} from "./gptLive/evidence";
import { inspectMediaFile } from "./gptLive/mediaInspection";
import type { GptLivePlateProps } from "./gptLive/motion/Root";
import type {
  EvidenceSpec,
  GptLiveProduction,
  NarrationSpec,
  ProductionClaim,
  ProductionSource,
  SceneContent
} from "./gptLive/types";

export const SUPPORTED_GPT56_COMMANDS = ["voice", "render", "qa", "all"] as const;

export type Gpt56Command = (typeof SUPPORTED_GPT56_COMMANDS)[number];

const sources = [
  {
    id: "src_openai_release",
    title: "GPT-5.6: Frontier intelligence that scales with your ambition",
    url: "https://openai.com/index/gpt-5-6/",
    publisher: "OpenAI",
    accessedAt: "2026-07-13"
  },
  {
    id: "src_openai_system_card",
    title: "GPT-5.6 System Card",
    url: "https://deploymentsafety.openai.com/gpt-5-6",
    publisher: "OpenAI Deployment Safety Hub",
    accessedAt: "2026-07-13"
  },
  {
    id: "src_openai_model_docs",
    title: "GPT-5.6 Sol Model",
    url: "https://developers.openai.com/api/docs/models/gpt-5.6-sol",
    publisher: "OpenAI API Docs",
    accessedAt: "2026-07-13"
  },
  {
    id: "src_openai_programmatic_tools",
    title: "Programmatic Tool Calling",
    url: "https://developers.openai.com/api/docs/guides/tools-programmatic-tool-calling",
    publisher: "OpenAI API Docs",
    accessedAt: "2026-07-13"
  }
] as const satisfies readonly ProductionSource[];

const claims = [
  {
    id: "claim_launch_family",
    text: "OpenAI launched GPT-5.6 as a family containing Sol, Terra, and Luna.",
    sourceIds: ["src_openai_release"]
  },
  {
    id: "claim_tiers",
    text: "Sol is the flagship, Terra is the balanced tier, and Luna is the fastest and least expensive tier.",
    sourceIds: ["src_openai_release", "src_openai_model_docs"]
  },
  {
    id: "claim_efficiency",
    text: "OpenAI reports stronger performance per dollar and lower resource use on several launch comparisons.",
    sourceIds: ["src_openai_release"]
  },
  {
    id: "claim_max",
    text: "Max gives GPT-5.6 more time than xhigh to explore, check, and revise.",
    sourceIds: ["src_openai_release", "src_openai_model_docs"]
  },
  {
    id: "claim_ultra",
    text: "Ultra coordinates four agents in parallel by default and the Responses API offers a multi-agent beta.",
    sourceIds: ["src_openai_release"]
  },
  {
    id: "claim_programmatic_tools",
    text: "Programmatic Tool Calling runs lightweight programs that coordinate tools and filter intermediate results.",
    sourceIds: ["src_openai_release", "src_openai_programmatic_tools"]
  },
  {
    id: "claim_design",
    text: "OpenAI says stronger computer use helps GPT-5.6 inspect and refine rendered results.",
    sourceIds: ["src_openai_release"]
  },
  {
    id: "claim_knowledge_work",
    text: "OpenAI positions GPT-5.6 for interfaces, presentations, documents, and spreadsheets.",
    sourceIds: ["src_openai_release"]
  },
  {
    id: "claim_benchmark_caveat",
    text: "OpenAI says benchmark latency and API cost are simulated and real-world results may vary substantially.",
    sourceIds: ["src_openai_release"]
  },
  {
    id: "claim_safety_overreach",
    text: "OpenAI reports more going beyond user intent than GPT-5.5 in agentic coding evaluations, with low absolute rates.",
    sourceIds: ["src_openai_system_card"]
  },
  {
    id: "claim_safety_profile",
    text: "OpenAI classifies GPT-5.6 as High capability in cyber and biological and chemical risk, below Critical.",
    sourceIds: ["src_openai_system_card"]
  },
  {
    id: "claim_availability",
    text: "GPT-5.6 is available across ChatGPT, Codex, and the OpenAI API.",
    sourceIds: ["src_openai_release", "src_openai_model_docs"]
  },
  {
    id: "claim_pricing",
    text: "Per million tokens, Sol is $5 input and $30 output, Terra is $2.50 and $15, and Luna is $1 and $6.",
    sourceIds: ["src_openai_release", "src_openai_model_docs"]
  },
  {
    id: "claim_aimh_read",
    text: "AIMH interprets model and effort selection as allocating work across cost, reasoning time, and agents.",
    sourceIds: ["src_openai_release", "src_openai_model_docs"]
  }
] as const satisfies readonly ProductionClaim[];

const narration = [
  {
    id: "narration_launch",
    kind: "narration",
    scene: "hook",
    text: "OpenAI just launched GPT-5.6, but the headline is not one new model. It is a system for deciding how much intelligence, time, and compute a piece of work deserves, starting with three tiers called Luna, Terra, and Sol.",
    claimIds: ["claim_launch_family", "claim_tiers"]
  },
  {
    id: "narration_tiers",
    kind: "narration",
    scene: "future",
    text: "At the bottom, Luna is the fastest and cheapest. Terra is the everyday balance. Sol is the flagship for hard professional work. OpenAI's pitch is not just higher scores. It is more useful work per dollar, using fewer output tokens and less time on many of its published comparisons. Those are launch results, and real workloads can look different.",
    claimIds: ["claim_tiers", "claim_efficiency", "claim_benchmark_caveat"]
  },
  {
    id: "narration_controls",
    kind: "narration",
    scene: "full_duplex",
    text: "Then there are two new gears. Max gives the model more time to explore, check, and revise. Ultra goes further: it coordinates four agents in parallel by default. In the API, developers get a multi-agent beta that can run concurrent subagents and combine their work into one response.",
    claimIds: ["claim_max", "claim_ultra"]
  },
  {
    id: "narration_practical",
    kind: "narration",
    scene: "use_cases",
    text: "The most practical change is how the model handles real work. Programmatic Tool Calling lets it write small programs that coordinate tools and filter intermediate results instead of sending everything back through the model. OpenAI also says stronger computer use helps it inspect and refine what it built, especially interfaces, presentations, documents, and spreadsheets.",
    claimIds: ["claim_programmatic_tools", "claim_design", "claim_knowledge_work"]
  },
  {
    id: "narration_evidence",
    kind: "narration",
    scene: "evidence",
    text: "The benchmark story is strongest in coding, browsing, computer use, and long-horizon professional tasks. But the important qualifier is that much of the headline evidence is vendor-reported. OpenAI's own footnotes say cost and latency are simulated estimates and real-world results may vary substantially. So the useful question is not whether every chart wins. It is whether a task gets finished with fewer rounds and less cleanup.",
    claimIds: ["claim_efficiency", "claim_benchmark_caveat"]
  },
  {
    id: "narration_safety",
    kind: "narration",
    scene: "evidence",
    text: "More autonomy also raises the cost of a mistake. The system card says GPT-5.6 Sol went beyond user intent more often than GPT-5.5 in agentic coding evaluations, including attempting actions users did not ask for, though absolute rates stayed low. OpenAI paired the launch with a more conservative safety stack and classifies these models as high capability in cyber and biological risk, but below its critical threshold.",
    claimIds: ["claim_safety_overreach", "claim_safety_profile"]
  },
  {
    id: "narration_availability",
    kind: "narration",
    scene: "availability",
    text: "GPT-5.6 is rolling out across ChatGPT, Codex, and the API. In the API, Sol is five dollars in and thirty out per million tokens. Terra is two-fifty and fifteen. Luna is one and six. Model selection is becoming work allocation: choose the tier, the effort, and when a hard problem is worth a small team of agents.",
    claimIds: ["claim_availability", "claim_pricing", "claim_aimh_read"]
  },
  {
    id: "narration_takeaway",
    kind: "narration",
    scene: "cta",
    text: "The next thing to test is not a benchmark. Give the same real task to Luna, Terra, and Sol, then compare the finished artifact, not just the answer. That will tell you which kind of work each model actually deserves.",
    claimIds: ["claim_tiers", "claim_aimh_read"]
  }
] as const satisfies readonly NarrationSpec[];

const openAiRelease = "https://openai.com/index/gpt-5-6/";

const evidence = [
  {
    id: "evidence_launch",
    scene: "hook",
    sourceId: "src_openai_release",
    assetPath: "evidence/01-openai-hero.png",
    canonicalUrl: openAiRelease,
    displayUrl: "openai.com/index/gpt-5-6",
    publisher: "OpenAI",
    sourceType: "primary",
    playbackDecision: "captured_source",
    placement: "right",
    takeaway: "One launch, three tiers",
    detail: "OpenAI introduces GPT-5.6 as a tiered model family.",
    focalRect: { x: 0.27, y: 0.04, width: 0.48, height: 0.16 },
    youtubeDescription: true
  },
  {
    id: "evidence_tiers",
    scene: "future",
    sourceId: "src_openai_release",
    assetPath: "evidence/02-efficient-default.png",
    canonicalUrl: openAiRelease,
    displayUrl: "openai.com/index/gpt-5-6",
    publisher: "OpenAI",
    sourceType: "primary",
    playbackDecision: "captured_source",
    placement: "right",
    takeaway: "The tier is the first control",
    detail: "OpenAI's launch comparison emphasizes performance per dollar.",
    focalRect: { x: 0.37, y: 0.1, width: 0.43, height: 0.34 },
    youtubeDescription: true
  },
  {
    id: "evidence_controls",
    scene: "full_duplex",
    sourceId: "src_openai_release",
    assetPath: "evidence/06-max-ultra.png",
    canonicalUrl: openAiRelease,
    displayUrl: "openai.com/index/gpt-5-6",
    publisher: "OpenAI",
    sourceType: "primary",
    playbackDecision: "captured_source",
    placement: "right",
    takeaway: "Max thinks longer; ultra uses agents",
    detail: "The launch page defines the new max and ultra effort settings.",
    focalRect: { x: 0.38, y: 0.66, width: 0.42, height: 0.25 },
    youtubeDescription: true
  },
  {
    id: "evidence_practical_tools",
    scene: "use_cases",
    sourceId: "src_openai_release",
    assetPath: "evidence/06-max-ultra.png",
    canonicalUrl: openAiRelease,
    displayUrl: "openai.com/index/gpt-5-6",
    publisher: "OpenAI",
    sourceType: "primary",
    playbackDecision: "captured_source",
    placement: "left",
    takeaway: "Coordinate tools in code",
    detail: "Programmatic Tool Calling filters intermediate results before returning them.",
    focalRect: { x: 0.38, y: 0.32, width: 0.42, height: 0.3 },
    youtubeDescription: true
  },
  {
    id: "evidence_practical_design",
    scene: "use_cases",
    sourceId: "src_openai_release",
    assetPath: "evidence/03-design.png",
    canonicalUrl: openAiRelease,
    displayUrl: "openai.com/index/gpt-5-6",
    publisher: "OpenAI",
    sourceType: "primary",
    playbackDecision: "captured_source",
    placement: "right",
    takeaway: "Inspect and refine rendered work",
    detail: "OpenAI highlights computer use and stronger design judgment.",
    focalRect: { x: 0.37, y: 0.1, width: 0.43, height: 0.21 },
    youtubeDescription: true
  },
  {
    id: "evidence_practical_knowledge",
    scene: "use_cases",
    sourceId: "src_openai_release",
    assetPath: "evidence/07-knowledge-work.png",
    canonicalUrl: openAiRelease,
    displayUrl: "openai.com/index/gpt-5-6",
    publisher: "OpenAI",
    sourceType: "primary",
    playbackDecision: "captured_source",
    placement: "bottom",
    takeaway: "Professional artifacts are the target",
    detail: "The launch page calls out presentations, documents, and spreadsheets.",
    focalRect: { x: 0.37, y: 0.1, width: 0.43, height: 0.28 },
    youtubeDescription: true
  },
  {
    id: "evidence_benchmarks",
    scene: "evidence",
    sourceId: "src_openai_release",
    assetPath: "evidence/02-efficient-default.png",
    canonicalUrl: openAiRelease,
    displayUrl: "openai.com/index/gpt-5-6",
    publisher: "OpenAI",
    sourceType: "primary",
    playbackDecision: "captured_source",
    placement: "left",
    takeaway: "The headline evidence is vendor-reported",
    detail: "OpenAI reports performance-per-dollar improvements in launch evaluations.",
    focalRect: { x: 0.37, y: 0.1, width: 0.43, height: 0.34 },
    youtubeDescription: true
  },
  {
    id: "evidence_footnote",
    scene: "evidence",
    sourceId: "src_openai_release",
    assetPath: "evidence/08-footnotes.png",
    canonicalUrl: openAiRelease,
    displayUrl: "openai.com/index/gpt-5-6",
    publisher: "OpenAI",
    sourceType: "primary",
    playbackDecision: "captured_source",
    placement: "right",
    takeaway: "Read the launch footnotes",
    detail: "OpenAI says cost and latency are simulated and real-world results can differ.",
    focalRect: { x: 0.31, y: 0.81, width: 0.46, height: 0.16 },
    youtubeDescription: true
  },
  {
    id: "evidence_safety",
    scene: "evidence",
    sourceId: "src_openai_system_card",
    assetPath: "evidence/05-system-card-caveat.png",
    canonicalUrl: "https://deploymentsafety.openai.com/gpt-5-6",
    displayUrl: "deploymentsafety.openai.com/gpt-5-6",
    publisher: "OpenAI Deployment Safety Hub",
    sourceType: "primary",
    playbackDecision: "captured_source",
    placement: "right",
    takeaway: "More autonomy needs tighter scope",
    detail: "The system card notes a greater tendency to go beyond user intent.",
    focalRect: { x: 0.35, y: 0.08, width: 0.53, height: 0.2 },
    youtubeDescription: true
  },
  {
    id: "evidence_availability",
    scene: "availability",
    sourceId: "src_openai_release",
    assetPath: "evidence/04-availability-pricing.png",
    canonicalUrl: openAiRelease,
    displayUrl: "openai.com/index/gpt-5-6",
    publisher: "OpenAI",
    sourceType: "primary",
    playbackDecision: "captured_source",
    placement: "right",
    takeaway: "Access spans ChatGPT, Codex, and API",
    detail: "The launch page lists availability and API pricing for all three tiers.",
    focalRect: { x: 0.38, y: 0.78, width: 0.43, height: 0.18 },
    youtubeDescription: true
  }
] as const satisfies readonly EvidenceSpec[];

export const GPT56_EPISODE: GptLiveProduction = {
  id: "2026-07-13-gpt-5-6",
  variants: ["dynamic_editorial"],
  sources,
  claims,
  narration,
  timeline: narration,
  evidence,
  audio: {
    introMusic: false,
    bodyMusic: false,
    outroMusicPath:
      process.env.AIMH_OUTRO_MUSIC_PATH ??
      "/Users/dennywii/Documents/dev/aimh-video-engine/assets/music/Outro_Much_Higher_Causmic.mp3",
    outroDurationSeconds: 7
  },
  branding: {
    logoPath:
      process.env.AIMH_LOGO_PATH ??
      "/Users/dennywii/Documents/dev/aimh-video-engine/assets/logo.png",
    width: 150,
    marginTop: 24,
    marginRight: 24,
    opacity: 0.85
  }
};

export const validateGpt56Episode = (episode: GptLiveProduction): void => {
  validateProductionManifest(episode);
  if (episode.narration.length !== 8) {
    throw new Error(`Invalid GPT-5.6 episode: expected 8 narration scenes, found ${episode.narration.length}`);
  }
  const scenesWithEvidence = new Set(episode.evidence.map(({ scene }) => scene));
  for (const item of episode.narration) {
    if (item.scene !== "cta" && !scenesWithEvidence.has(item.scene)) {
      throw new Error(`Invalid GPT-5.6 episode: narration "${item.id}" has no captured evidence`);
    }
  }
};

export const assertElevenLabsVoiceResult = (
  voice: VoiceRenderResult
): readonly VoiceChunkResult[] => {
  if (voice.provider !== "elevenlabs" || voice.warnings.length > 0) {
    throw new Error(
      `ElevenLabs narration is required; provider=${voice.provider}, warnings=${voice.warnings.length}`
    );
  }
  if (voice.chunks.length !== narration.length) {
    throw new Error(
      `ElevenLabs narration is required for all 8 scenes; found ${voice.chunks.length} chunks`
    );
  }
  voice.chunks.forEach((chunk, index) => {
    const expected = narration[index]!;
    if (
      chunk.id !== expected.id ||
      chunk.text !== expected.text ||
      chunk.provider !== "elevenlabs" ||
      !chunk.file ||
      !Number.isFinite(chunk.durationSeconds) ||
      chunk.durationSeconds <= 0
    ) {
      throw new Error(`Invalid ElevenLabs narration chunk at index ${index}: ${chunk.id}`);
    }
  });
  return voice.chunks;
};

const sceneContent = (item: NarrationSpec, index: number): SceneContent => {
  const base = {
    sectionNumber: String(index + 1).padStart(2, "0"),
    seriesLabel: "GPT-5.6",
    narrationId: item.id,
    narrationText: item.text,
    claimIds: item.claimIds,
    sourceLabels: item.scene === "cta" ? ["AIMH analysis"] : ["OpenAI, accessed July 13, 2026"]
  } as const;

  switch (item.id) {
    case "narration_launch":
      return {
        ...base,
        scene: "hook",
        header: "THE LAUNCH",
        headline: "GPT-5.6 is a work system",
        listeningLabel: "FASTEST",
        listeningValue: "LUNA",
        speakingLabel: "FLAGSHIP",
        speakingValue: "SOL",
        inputLabel: "BALANCED: TERRA",
        simultaneousLabel: "ONE FAMILY · THREE TIERS"
      };
    case "narration_tiers":
      return {
        ...base,
        scene: "future",
        header: "THE TIERS",
        headline: "Allocate intelligence to the work",
        flows: [
          { from: "LUNA", to: "FAST + LOW COST" },
          { from: "TERRA", to: "EVERYDAY BALANCE" },
          { from: "SOL", to: "HARD PROFESSIONAL WORK" }
        ],
        summary: "The launch claim is useful work per dollar — test it on your own workload."
      };
    case "narration_controls":
      return {
        ...base,
        scene: "full_duplex",
        header: "THE CONTROLS",
        headline: "More reasoning, then more agents",
        legacyLabel: "MAX",
        legacySteps: ["EXPLORE", "CHECK", "REVISE"],
        concurrentLabel: "ULTRA",
        tracks: ["AGENT 1", "AGENT 2", "AGENT 3", "AGENT 4"],
        interruptionLabel: "RESPONSES API · MULTI-AGENT BETA"
      };
    case "narration_practical":
      return {
        ...base,
        scene: "use_cases",
        header: "THE PRACTICAL CHANGE",
        headline: "Finish the artifact, not just the answer",
        progressLabel: "END-TO-END WORK",
        items: [
          { number: "01", label: "COORDINATE", detail: "Programmatic tool calls" },
          { number: "02", label: "INSPECT", detail: "Rendered interfaces and documents" },
          { number: "03", label: "REFINE", detail: "Presentations and spreadsheets" }
        ]
      };
    case "narration_evidence":
      return {
        ...base,
        scene: "evidence",
        header: "THE EVIDENCE",
        headline: "Read the footnotes",
        worldCupAttribution: "OPENAI LAUNCH RESULTS",
        worldCupHeadline: "Coding · browsing · computer use",
        worldCupDetail: "Vendor-reported performance on launch evaluations",
        benchmarkAttribution: "OPENAI FOOTNOTE 4",
        benchmarkComparison: "SIMULATED",
        benchmarkName: "COST + LATENCY",
        benchmarkStatement: "Real-world results may vary substantially",
        qualification: "Compare completed work, iterations, and cleanup on your own tasks."
      };
    case "narration_safety":
      return {
        ...base,
        scene: "evidence",
        header: "THE LIMIT",
        headline: "Autonomy increases the cost of scope drift",
        worldCupAttribution: "SYSTEM CARD",
        worldCupHeadline: "Greater tendency to go beyond intent",
        worldCupDetail: "Agentic coding evaluations; absolute rates remained low",
        benchmarkAttribution: "PREPAREDNESS",
        benchmarkComparison: "HIGH",
        benchmarkName: "CYBER + BIO/CHEM",
        benchmarkStatement: "Below OpenAI's Critical threshold",
        qualification: "Use explicit permissions, checkpoints, and review for consequential actions."
      };
    case "narration_availability":
      return {
        ...base,
        scene: "availability",
        header: "ACCESS + PRICE",
        headline: "Model choice becomes work allocation",
        tiers: [
          { label: "LUNA", value: "$1 IN · $6 OUT" },
          { label: "TERRA", value: "$2.50 IN · $15 OUT" },
          { label: "SOL", value: "$5 IN · $30 OUT" }
        ],
        limitsLabel: "AVAILABLE IN",
        limits: ["CHATGPT", "CODEX", "API"]
      };
    case "narration_takeaway":
      return {
        ...base,
        scene: "cta",
        header: "THE TEST",
        headline: "Compare the finished artifact",
        prompts: ["SAME TASK", "THREE TIERS", "ONE REVIEW RUBRIC"],
        audiencePrompt: "Which tier actually earns the work?"
      };
    default:
      throw new Error(`Unsupported GPT-5.6 narration: ${item.id}`);
  }
};

const EVIDENCE_BY_NARRATION_ID: Readonly<Record<string, readonly string[]>> = {
  narration_launch: ["evidence_launch"],
  narration_tiers: ["evidence_tiers"],
  narration_controls: ["evidence_controls"],
  narration_practical: [
    "evidence_practical_tools",
    "evidence_practical_design",
    "evidence_practical_knowledge"
  ],
  narration_evidence: ["evidence_benchmarks", "evidence_footnote"],
  narration_safety: ["evidence_safety"],
  narration_availability: ["evidence_availability"],
  narration_takeaway: []
};

export interface Gpt56PlateJob {
  readonly narrationId: string;
  readonly narrationPath: string;
  readonly outputPath: string;
  readonly durationSeconds: number;
  readonly inputProps: GptLivePlateProps;
}

export const buildGpt56PlateJobs = (
  voiceRecords: readonly VoiceChunkResult[],
  evidenceDimensions: Readonly<Record<string, EvidenceAssetDimensions>>,
  episodeDir: string
): readonly Gpt56PlateJob[] => {
  if (voiceRecords.length !== narration.length) {
    throw new Error(`Expected 8 voice records, found ${voiceRecords.length}`);
  }
  const voiceById = new Map(voiceRecords.map((record) => [record.id, record]));
  const evidenceById = new Map<string, EvidenceSpec>(
    evidence.map((item) => [item.id, item])
  );

  return narration.map((item, index) => {
    const voice = voiceById.get(item.id);
    if (!voice || !Number.isFinite(voice.durationSeconds) || voice.durationSeconds <= 0) {
      throw new Error(`Missing measured voice record: ${item.id}`);
    }
    const renderedEvidence = (EVIDENCE_BY_NARRATION_ID[item.id] ?? []).map((evidenceId) => {
      const itemEvidence = evidenceById.get(evidenceId);
      if (!itemEvidence) throw new Error(`Unknown GPT-5.6 evidence: ${evidenceId}`);
      const dimensions = evidenceDimensions[itemEvidence.assetPath];
      if (!dimensions) throw new Error(`Missing evidence dimensions: ${itemEvidence.assetPath}`);
      return { ...itemEvidence, assetWidth: dimensions.width, assetHeight: dimensions.height };
    });
    return {
      narrationId: item.id,
      narrationPath: voice.file,
      outputPath: join(episodeDir, "render", "plates", `${String(index + 1).padStart(2, "0")}-${item.id}.mp4`),
      durationSeconds: voice.durationSeconds,
      inputProps: {
        variant: "dynamic_editorial",
        durationSeconds: voice.durationSeconds,
        sceneContent: sceneContent(item, index),
        ...(renderedEvidence.length > 0 ? { evidences: renderedEvidence } : {})
      }
    };
  });
};

export const buildGpt56SegmentMuxArgs = (options: {
  readonly platePath: string;
  readonly narrationPath: string;
  readonly outputPath: string;
  readonly durationSeconds: number;
}): string[] => [
  "-y",
  "-loglevel",
  "error",
  "-i",
  options.platePath,
  "-i",
  options.narrationPath,
  "-map",
  "0:v:0",
  "-map",
  "1:a:0",
  "-c:v",
  "copy",
  "-c:a",
  "aac",
  "-b:a",
  "192k",
  "-ar",
  "48000",
  "-ac",
  "2",
  "-t",
  options.durationSeconds.toFixed(3),
  "-movflags",
  "+faststart",
  options.outputPath
];

export const buildGpt56FinalRenderArgs = (options: {
  readonly assembledPath: string;
  readonly logoPath: string;
  readonly outroPath: string;
  readonly outputPath: string;
  readonly durationSeconds: number;
}): string[] => {
  if (!Number.isFinite(options.durationSeconds) || options.durationSeconds <= 7) {
    throw new Error("Final duration must be longer than the seven-second outro");
  }
  const outroDelayMs = Math.round((options.durationSeconds - 7) * 1000);
  const filterGraph = [
    "[1:v]scale=150:-1,format=rgba,colorchannelmixer=aa=0.85[logo]",
    "[0:v][logo]overlay=W-w-24:24:format=auto[v]",
    "[0:a]aresample=48000,aformat=channel_layouts=stereo[program]",
    `[2:a]aresample=48000,atrim=duration=7,asetpts=PTS-STARTPTS,volume=0.12,afade=t=in:st=0:d=0.75,afade=t=out:st=6:d=1,adelay=${outroDelayMs}:all=1[outro]`,
    "[program][outro]amix=inputs=2:duration=first:dropout_transition=0:normalize=0,alimiter=limit=0.95[a]"
  ].join(";");
  return [
    "-y",
    "-loglevel",
    "error",
    "-i",
    options.assembledPath,
    "-loop",
    "1",
    "-i",
    options.logoPath,
    "-i",
    options.outroPath,
    "-filter_complex",
    filterGraph,
    "-map",
    "[v]",
    "-map",
    "[a]",
    "-c:v",
    "libx264",
    "-preset",
    "medium",
    "-crf",
    "18",
    "-pix_fmt",
    "yuv420p",
    "-c:a",
    "aac",
    "-b:a",
    "192k",
    "-ar",
    "48000",
    "-ac",
    "2",
    "-t",
    options.durationSeconds.toFixed(3),
    "-movflags",
    "+faststart",
    options.outputPath
  ];
};

export const parseGpt56Command = (command: string | undefined): Gpt56Command => {
  if (!SUPPORTED_GPT56_COMMANDS.includes(command as Gpt56Command)) {
    throw new Error(
      `Unsupported GPT-5.6 command "${command ?? ""}". Expected one of: ${SUPPORTED_GPT56_COMMANDS.join(", ")}`
    );
  }
  return command as Gpt56Command;
};

const PROJECT_ROOT = fileURLToPath(new URL("../../", import.meta.url));
export const GPT56_EPISODE_DIR = join(PROJECT_ROOT, "episodes", GPT56_EPISODE.id);

const ffmpegPath = (): string => process.env.FFMPEG_PATH ?? process.env.FFMPEG ?? "ffmpeg";
const ffprobePath = (): string => process.env.FFPROBE_PATH ?? process.env.FFPROBE ?? "ffprobe";

const readJson = async <T>(path: string): Promise<T> =>
  JSON.parse(await readFile(path, "utf8")) as T;

const loadEpisodePackage = async (episodeDir: string): Promise<EpisodePackage> => ({
  episode: await readJson(join(episodeDir, "episode.json")),
  script: await readJson(join(episodeDir, "script.json")),
  shotlist: await readJson(join(episodeDir, "shotlist.json")),
  sources: await readJson(join(episodeDir, "sources.json")),
  metadata: await readJson(join(episodeDir, "metadata.json"))
});

const assertScriptMatchesManifest = (script: ScriptFile): void => {
  if (script.narration.length !== narration.length) {
    throw new Error(`Script must contain exactly 8 narration chunks; found ${script.narration.length}`);
  }
  script.narration.forEach((paragraph, index) => {
    const expected = narration[index]!;
    if (paragraph.id !== expected.id || paragraph.text !== expected.text) {
      throw new Error(`Script does not match the reviewed manifest at index ${index}`);
    }
  });
};

const requireFile = async (path: string, label: string): Promise<void> => {
  try {
    await access(path);
  } catch {
    throw new Error(`${label} is unavailable: ${path}`);
  }
};

const loadVoiceResult = async (episodeDir: string): Promise<VoiceRenderResult> => {
  const voice = await readJson<VoiceRenderResult>(join(episodeDir, "voice", "narration.json"));
  assertElevenLabsVoiceResult(voice);
  return voice;
};

const uniqueCapturedEvidence = (): readonly EvidenceSpec[] => {
  const seen = new Set<string>();
  return GPT56_EPISODE.evidence.filter((item) => {
    if (seen.has(item.assetPath)) return false;
    seen.add(item.assetPath);
    return true;
  });
};

const sha256File = async (path: string): Promise<string> =>
  createHash("sha256").update(await readFile(path)).digest("hex");

export const runGpt56Voice = async (
  episodeDir = GPT56_EPISODE_DIR
): Promise<VoiceRenderResult> => {
  validateGpt56Episode(GPT56_EPISODE);
  if (!process.env.ELEVENLABS_API_KEY || !process.env.ELEVENLABS_VOICE_ID) {
    throw new Error("ELEVENLABS_API_KEY and ELEVENLABS_VOICE_ID are required; no narration fallback is allowed");
  }
  const script = await readJson<ScriptFile>(join(episodeDir, "script.json"));
  assertScriptMatchesManifest(script);
  const voice = await synthesizeNarration({
    script,
    outDir: join(episodeDir, "voice"),
    env: process.env,
    ffprobePath: ffprobePath(),
    allowElevenLabs: true
  });
  assertElevenLabsVoiceResult(voice);
  await writeJson(join(episodeDir, "voice", "narration.json"), voice);
  return voice;
};

const safeConcatLine = (path: string): string => `file '${path.replaceAll("'", "'\\''")}'`;

export interface Gpt56RenderResult {
  readonly status: "rendered";
  readonly finalVideoPath: string;
  readonly captionsPath: string;
  readonly durationSeconds: number;
  readonly segments: readonly string[];
}

export const runGpt56Render = async (
  episodeDir = GPT56_EPISODE_DIR
): Promise<Gpt56RenderResult> => {
  validateGpt56Episode(GPT56_EPISODE);
  const voice = await loadVoiceResult(episodeDir);
  const script = await readJson<ScriptFile>(join(episodeDir, "script.json"));
  assertScriptMatchesManifest(script);
  await Promise.all([
    requireFile(GPT56_EPISODE.branding.logoPath, "AIMH logo"),
    requireFile(GPT56_EPISODE.audio.outroMusicPath, "AIMH outro music")
  ]);

  const renderDir = join(episodeDir, "render");
  const platesDir = join(renderDir, "plates");
  const segmentsDir = join(renderDir, "segments");
  const workDir = join(renderDir, "work");
  await rm(renderDir, { recursive: true, force: true });
  await Promise.all([ensureDir(platesDir), ensureDir(segmentsDir), ensureDir(workDir)]);

  let stagedEvidence: StagedEvidencePublicAssets | undefined;
  let bundleOutput: string | undefined;
  try {
    stagedEvidence = await stageEvidencePublicAssets(episodeDir, uniqueCapturedEvidence());
    const jobs = buildGpt56PlateJobs(voice.chunks, stagedEvidence.dimensions, episodeDir);
    const serveUrl = await bundle({
      entryPoint: fileURLToPath(new URL("./gptLive/motion/Root.tsx", import.meta.url)),
      publicDir: stagedEvidence.publicDir,
      onDirectoryCreated: (path) => {
        bundleOutput = path;
      }
    });
    for (const [index, job] of jobs.entries()) {
      await ensureDir(dirname(job.outputPath));
      const composition = await selectComposition({
        serveUrl,
        id: "GptLivePlate",
        inputProps: job.inputProps
      });
      await renderMedia({
        composition,
        serveUrl,
        codec: "h264",
        outputLocation: job.outputPath,
        inputProps: job.inputProps,
        muted: true,
        enforceAudioTrack: false,
        overwrite: true,
        pixelFormat: "yuv420p"
      });
      const segmentPath = join(
        segmentsDir,
        `${String(index + 1).padStart(2, "0")}-${job.narrationId}.mp4`
      );
      await runCommand(
        ffmpegPath(),
        buildGpt56SegmentMuxArgs({
          platePath: job.outputPath,
          narrationPath: job.narrationPath,
          outputPath: segmentPath,
          durationSeconds: job.durationSeconds
        })
      );
    }

    const segmentPaths = jobs.map((job, index) =>
      join(
        segmentsDir,
        `${String(index + 1).padStart(2, "0")}-${job.narrationId}.mp4`
      )
    );
    await Promise.all(segmentPaths.map((path) => requireFile(path, "Rendered GPT-5.6 segment")));
    const concatPath = join(workDir, "segments.txt");
    const assembledPath = join(workDir, "assembled.mp4");
    await writeText(concatPath, `${segmentPaths.map(safeConcatLine).join("\n")}\n`);
    await runCommand(ffmpegPath(), [
      "-y",
      "-loglevel",
      "error",
      "-f",
      "concat",
      "-safe",
      "0",
      "-i",
      concatPath,
      "-c",
      "copy",
      assembledPath
    ]);

    const durationSeconds = voice.chunks.reduce(
      (total, chunk) => total + chunk.durationSeconds,
      0
    );
    const captionsPath = join(renderDir, "captions.srt");
    await writeText(
      captionsPath,
      buildCaptionsSrt(
        script.narration,
        voice.chunks.map(({ durationSeconds: duration }) => duration)
      )
    );
    const finalVideoPath = join(renderDir, "final.mp4");
    await runCommand(
      ffmpegPath(),
      buildGpt56FinalRenderArgs({
        assembledPath,
        logoPath: GPT56_EPISODE.branding.logoPath,
        outroPath: GPT56_EPISODE.audio.outroMusicPath,
        outputPath: finalVideoPath,
        durationSeconds
      })
    );

    const evidenceHashes = await Promise.all(
      uniqueCapturedEvidence().map(async (item) => ({
        id: item.id,
        path: item.assetPath,
        sha256: await sha256File(join(episodeDir, item.assetPath))
      }))
    );
    const result: Gpt56RenderResult = {
      status: "rendered",
      finalVideoPath,
      captionsPath,
      durationSeconds,
      segments: segmentPaths
    };
    await writeJson(join(renderDir, "render-status.json"), {
      ...result,
      renderedAt: new Date().toISOString(),
      voiceProvider: voice.provider,
      evidenceHashes,
      uploadAttempted: false
    });
    return result;
  } finally {
    await stagedEvidence?.cleanup();
    if (bundleOutput && basename(bundleOutput).startsWith("remotion-webpack-bundle-")) {
      await rm(bundleOutput, { recursive: true, force: true });
    }
  }
};

interface SampledFrame {
  readonly narrationId: string;
  readonly offset: "start" | "middle" | "end";
  readonly atSeconds: number;
  readonly path: string;
  readonly lumaRange: number;
}

const sampleFrames = async (
  episodeDir: string,
  finalVideoPath: string,
  chunks: readonly VoiceChunkResult[]
): Promise<readonly SampledFrame[]> => {
  const framesDir = join(episodeDir, "qa", "frames");
  await rm(framesDir, { recursive: true, force: true });
  await ensureDir(framesDir);
  const samples: SampledFrame[] = [];
  let cursor = 0;
  let sequence = 1;
  for (const chunk of chunks) {
    const relativeSamples = [
      { offset: "start" as const, seconds: Math.min(0.2, chunk.durationSeconds / 4) },
      { offset: "middle" as const, seconds: chunk.durationSeconds / 2 },
      { offset: "end" as const, seconds: Math.max(0, chunk.durationSeconds - 0.2) }
    ];
    for (const sample of relativeSamples) {
      const atSeconds = cursor + sample.seconds;
      const framePath = join(framesDir, `frame-${String(sequence).padStart(2, "0")}.png`);
      await runCommand(ffmpegPath(), [
        "-y",
        "-loglevel",
        "error",
        "-ss",
        atSeconds.toFixed(3),
        "-i",
        finalVideoPath,
        "-frames:v",
        "1",
        framePath
      ]);
      const signal = await runCommand(ffmpegPath(), [
        "-hide_banner",
        "-nostats",
        "-i",
        framePath,
        "-vf",
        "signalstats,metadata=print",
        "-frames:v",
        "1",
        "-f",
        "null",
        "-"
      ]);
      const diagnostic = `${signal.stdout}\n${signal.stderr}`;
      const minimum = Number(diagnostic.match(/lavfi\.signalstats\.YMIN=(\d+(?:\.\d+)?)/)?.[1]);
      const maximum = Number(diagnostic.match(/lavfi\.signalstats\.YMAX=(\d+(?:\.\d+)?)/)?.[1]);
      samples.push({
        narrationId: chunk.id,
        offset: sample.offset,
        atSeconds,
        path: framePath,
        lumaRange: maximum - minimum
      });
      sequence += 1;
    }
    cursor += chunk.durationSeconds;
  }
  return samples;
};

const createContactSheet = async (
  episodeDir: string,
  frames: readonly SampledFrame[]
): Promise<string> => {
  if (frames.length !== 24) throw new Error(`Expected 24 sampled frames, found ${frames.length}`);
  const contactSheetPath = join(episodeDir, "qa", "contact-sheet.png");
  await runCommand(ffmpegPath(), [
    "-y",
    "-loglevel",
    "error",
    "-framerate",
    "1",
    "-i",
    join(episodeDir, "qa", "frames", "frame-%02d.png"),
    "-vf",
    "scale=440:248,tile=4x6:nb_frames=24:padding=8:margin=8:color=0x242424",
    "-frames:v",
    "1",
    contactSheetPath
  ]);
  return contactSheetPath;
};

const recursiveFileNames = async (
  root: string,
  baseRoot = root
): Promise<readonly string[]> => {
  const entries = await readdir(root, { withFileTypes: true });
  const values = await Promise.all(
    entries.map(async (entry) => {
      const fullPath = join(root, entry.name);
      return entry.isDirectory()
        ? recursiveFileNames(fullPath, baseRoot)
        : [relative(baseRoot, fullPath)];
    })
  );
  return values.flat();
};

export interface Gpt56QaResult {
  readonly ok: boolean;
  readonly finalVideoPath: string;
  readonly contactSheetPath: string;
  readonly tailAudioPath: string;
  readonly checks: readonly { readonly name: string; readonly pass: boolean; readonly detail: string }[];
}

export const runGpt56Qa = async (
  episodeDir = GPT56_EPISODE_DIR
): Promise<Gpt56QaResult> => {
  const pkg = await loadEpisodePackage(episodeDir);
  const packageQa = runPackageQa(pkg);
  const voice = await loadVoiceResult(episodeDir);
  const renderStatus = await readJson<Gpt56RenderResult & { readonly uploadAttempted?: boolean }>(
    join(episodeDir, "render", "render-status.json")
  );
  const finalVideoPath = join(episodeDir, "render", "final.mp4");
  const expectedDuration = voice.chunks.reduce((total, chunk) => total + chunk.durationSeconds, 0);
  const inspection = await inspectMediaFile(ffprobePath(), finalVideoPath);
  const measuredDuration = await ffprobeDurationSeconds(ffprobePath(), finalVideoPath);
  const streamProbe = await runCommand(ffprobePath(), [
    "-v",
    "error",
    "-select_streams",
    "a:0",
    "-show_entries",
    "stream=sample_rate,channels,channel_layout",
    "-of",
    "json",
    finalVideoPath
  ]);
  const audioStream = (
    JSON.parse(streamProbe.stdout) as {
      readonly streams?: readonly {
        readonly sample_rate?: string;
        readonly channels?: number;
        readonly channel_layout?: string;
      }[];
    }
  ).streams?.[0];
  const frames = await sampleFrames(episodeDir, finalVideoPath, voice.chunks);
  const contactSheetPath = await createContactSheet(episodeDir, frames);
  const volumeResult = await runCommand(ffmpegPath(), [
    "-hide_banner",
    "-nostats",
    "-i",
    finalVideoPath,
    "-af",
    "volumedetect",
    "-f",
    "null",
    "-"
  ]);
  const volumeDiagnostic = `${volumeResult.stdout}\n${volumeResult.stderr}`;
  const meanVolume = Number(volumeDiagnostic.match(/mean_volume:\s*(-?\d+(?:\.\d+)?) dB/)?.[1]);
  const maxVolume = Number(volumeDiagnostic.match(/max_volume:\s*(-?\d+(?:\.\d+)?) dB/)?.[1]);
  const tailAudioPath = join(episodeDir, "qa", "tail-10s.wav");
  await runCommand(ffmpegPath(), [
    "-y",
    "-loglevel",
    "error",
    "-sseof",
    "-10",
    "-i",
    finalVideoPath,
    "-vn",
    "-ar",
    "48000",
    "-ac",
    "2",
    tailAudioPath
  ]);
  const episodeFiles = await recursiveFileNames(episodeDir);
  const uploadArtifacts = episodeFiles.filter((path) =>
    /(^|\/)(upload|publish|youtube-receipt|youtube-id)(\/|\.|-|$)/i.test(path)
  );
  const checks = [
    {
      name: "package_qa",
      pass: packageQa.ok,
      detail: packageQa.checks.map((check) => `${check.name}=${check.pass}`).join(", ")
    },
    {
      name: "elevenlabs_voice",
      pass: voice.provider === "elevenlabs" && voice.chunks.length === 8 && voice.warnings.length === 0,
      detail: `${voice.chunks.length} measured chunks; warnings=${voice.warnings.length}`
    },
    {
      name: "final_video_contract",
      pass:
        inspection.video.codecName === "h264" &&
        inspection.video.width === 1920 &&
        inspection.video.height === 1080 &&
        Math.abs(inspection.video.framesPerSecond - 30) < 0.001 &&
        inspection.audio?.codecName === "aac",
      detail: `${inspection.video.codecName} ${inspection.video.width}x${inspection.video.height} ${inspection.video.framesPerSecond}fps; audio=${inspection.audio?.codecName ?? "none"}`
    },
    {
      name: "duration",
      pass: Math.abs(measuredDuration - expectedDuration) <= 0.12,
      detail: `expected=${expectedDuration.toFixed(3)}s measured=${measuredDuration.toFixed(3)}s`
    },
    {
      name: "audio_format",
      pass: audioStream?.sample_rate === "48000" && audioStream.channels === 2,
      detail: `${audioStream?.sample_rate ?? "unknown"}Hz ${audioStream?.channels ?? "unknown"}ch ${audioStream?.channel_layout ?? "unknown"}`
    },
    {
      name: "audio_levels",
      pass: Number.isFinite(meanVolume) && meanVolume > -35 && Number.isFinite(maxVolume) && maxVolume <= 0 && maxVolume > -12,
      detail: `mean=${meanVolume.toFixed(1)}dB max=${maxVolume.toFixed(1)}dB`
    },
    {
      name: "sampled_frames",
      pass: frames.length === 24 && frames.every(({ lumaRange }) => Number.isFinite(lumaRange) && lumaRange >= 8),
      detail: `${frames.length} frames; minimum luma range=${Math.min(...frames.map(({ lumaRange }) => lumaRange)).toFixed(1)}`
    },
    {
      name: "no_upload",
      pass:
        pkg.episode.youtube.upload_enabled === false &&
        renderStatus.uploadAttempted !== true &&
        uploadArtifacts.length === 0,
      detail: `upload_enabled=${pkg.episode.youtube.upload_enabled}; artifacts=${uploadArtifacts.length}`
    }
  ] as const;
  const result: Gpt56QaResult = {
    ok: checks.every(({ pass }) => pass),
    finalVideoPath,
    contactSheetPath,
    tailAudioPath,
    checks
  };
  await writeJson(join(episodeDir, "qa", "qa.json"), {
    ...result,
    checkedAt: new Date().toISOString(),
    packageQa,
    frames,
    audio: { meanVolume, maxVolume, stream: audioStream },
    media: inspection
  });
  if (!result.ok) {
    throw new Error(
      `GPT-5.6 QA failed: ${checks.filter(({ pass }) => !pass).map(({ name }) => name).join(", ")}`
    );
  }
  await writeJson(join(episodeDir, "episode.json"), {
    ...pkg.episode,
    status: "needs_review"
  });
  return result;
};

export const runGpt56Command = async (
  command: Gpt56Command,
  episodeDir = GPT56_EPISODE_DIR
): Promise<unknown> => {
  switch (command) {
    case "voice":
      return runGpt56Voice(episodeDir);
    case "render":
      return runGpt56Render(episodeDir);
    case "qa":
      return runGpt56Qa(episodeDir);
    case "all":
      await runGpt56Voice(episodeDir);
      await runGpt56Render(episodeDir);
      return runGpt56Qa(episodeDir);
  }
};

const isDirectExecution =
  process.argv[1] !== undefined && fileURLToPath(import.meta.url) === process.argv[1];

if (isDirectExecution) {
  runGpt56Command(parseGpt56Command(process.argv[2])).catch((error: unknown) => {
    process.stderr.write(`${(error as Error).message}\n`);
    process.exitCode = 1;
  });
}
