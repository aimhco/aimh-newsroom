import { createHash } from "node:crypto";
import { access, readFile, readdir, rm } from "node:fs/promises";
import { basename, join } from "node:path";
import { fileURLToPath } from "node:url";
import { bundle } from "@remotion/bundler";
import { renderMedia, selectComposition } from "@remotion/renderer";
import { loadEnvSnapshotFromFiles } from "../config/env";
import { validateArticleEditorialGate } from "../editorial/articleEditorialGate";
import type { ResearchManifest } from "../editorial/researchManifest";
import type { MediaManifest } from "../capture/mediaManifest";
import { buildCaptionsSrt } from "../render/captions";
import { selectEpisodeOutroPath } from "../render/outroMusic";
import { ffprobeDurationSeconds, runCommand } from "../render/process";
import type { ScriptFile } from "../types";
import { ensureDir, writeJson, writeText } from "../utils/fs";
import {
  synthesizeNarration,
  type VoiceChunkResult,
  type VoiceRenderResult
} from "../voice/elevenLabsAdapter";
import {
  buildGpt56FinalRenderArgs,
  buildGpt56SegmentMuxArgs
} from "./gpt56Episode";
import type {
  EvidenceBeat,
  FocalRect,
  NewsroomEvidencePlateProps
} from "./newsroom/motion/types";
import { findLongStaticHolds } from "./newsroom/motion/timing";
import { inspectMediaFile } from "./gptLive/mediaInspection";

export const SUPPORTED_GPT56_REVISION_COMMANDS = ["voice", "render", "qa", "all"] as const;
export type Gpt56RevisionCommand = (typeof SUPPORTED_GPT56_REVISION_COMMANDS)[number];
export type Gpt56RevisionVariantId = "a-evidence" | "b-demo";

interface WeightedBeatBase {
  readonly id: string;
  readonly assetPath: string;
  readonly weight: number;
  readonly sourceLabel: string;
  readonly headline: string;
  readonly fit?: "cover" | "contain";
}

interface WeightedMotionBeat extends WeightedBeatBase {
  readonly kind: "video" | "interactive_capture";
  readonly startFromFrames?: number;
}

interface WeightedStillBeat extends WeightedBeatBase {
  readonly kind: "source_zoom" | "image";
  readonly focalRect: FocalRect;
}

export type WeightedEvidenceBeat = WeightedMotionBeat | WeightedStillBeat;

export interface Gpt56RevisionScene {
  readonly narrationId: string;
  readonly beats: readonly WeightedEvidenceBeat[];
}

export interface Gpt56RevisionVariant {
  readonly id: Gpt56RevisionVariantId;
  readonly label: string;
  readonly script: ScriptFile;
  readonly scenes: readonly Gpt56RevisionScene[];
}

export interface Gpt56RevisionManifest {
  readonly id: "2026-07-13-gpt-5-6";
  readonly variants: readonly Gpt56RevisionVariant[];
}

const voice = {
  provider: "elevenlabs" as const,
  voice_id_env: "ELEVENLABS_VOICE_ID" as const,
  style: "clear, evidence-first, conversational newsroom analysis"
};

const paragraph = (
  id: string,
  text: string,
  estimatedSeconds: number,
  claimIds: readonly string[],
  options: { readonly speechText?: string; readonly criticalPhrases?: readonly string[] } = {}
): ScriptFile["narration"][number] => ({
  id,
  segment_id: id,
  text,
  ...(options.speechText ? { speech_text: options.speechText } : {}),
  ...(options.criticalPhrases ? { critical_phrases: [...options.criticalPhrases] } : {}),
  estimated_seconds: estimatedSeconds,
  claim_ids: [...claimIds],
  shot_ids: [`shot_${id}`]
});

const scriptA: ScriptFile = {
  schema_version: "0.1.0",
  voice,
  narration: [
    paragraph(
      "a_launch",
      "OpenAI's GPT-5.6 page opens with work in the physical world: a grower in a greenhouse, a laptop in the field, and handwritten labels pointing to the task. That framing matters. This is a family called Luna, Terra, and Sol, built around one question: how much intelligence, time, and parallelism does this job deserve?",
      27,
      ["claim_launch_family", "claim_tiers"]
    ),
    paragraph(
      "a_tiers",
      "Luna is the fast, low-cost lane. Terra is the everyday balance. Sol is the flagship for hard professional work. OpenAI claims more useful work per dollar, often with fewer tokens or less time. Those are launch comparisons, not a guarantee for your workload. Choosing a model now looks more like routing work than picking one default.",
      28,
      ["claim_tiers", "claim_efficiency", "claim_benchmark_caveat"]
    ),
    paragraph(
      "a_controls",
      "The second control is effort. Max spends longer exploring, checking, and revising. Ultra coordinates four agents in parallel by default. The Responses API also gets a multi-agent beta. So there are three levers: model tier, reasoning effort, and whether a difficult task deserves a small team.",
      23,
      ["claim_max", "claim_ultra"]
    ),
    paragraph(
      "a_practical",
      "The interesting part is what that capability produces. Programmatic Tool Calling runs small programs that coordinate tools and filter intermediate results. Stronger computer use lets GPT-5.6 inspect what it built. OpenAI's examples include this playable sailing game and an interactive spirograph. These are rendered artifacts you can operate and evaluate.",
      25,
      ["claim_programmatic_tools", "claim_design", "claim_knowledge_work"],
      {
        speechText:
          "The interesting part is what that capability produces. Programmatic tool-calling runs small programs that coordinate tools and filter intermediate results. Stronger computer use lets GPT-5.6 inspect what it built. OpenAI's examples include this playable sailing game and an interactive spirograph. These are rendered artifacts you can operate and evaluate.",
        criticalPhrases: ["Programmatic Tool Calling"]
      }
    ),
    paragraph(
      "a_hands_on",
      "Independent testing adds a reality check. CodeRabbit gave the models more than one hundred repository tasks across five languages. Sol passed 63.7 percent; Terra passed 40.7 percent, while averaging far more output tokens. Their point is not that Terra is bad. It is that cheaper tokens do not guarantee a cheaper solved task. On long runs, follow-through can dominate list price.",
      28,
      ["claim_coderabbit_hands_on"]
    ),
    paragraph(
      "a_cost",
      "Developer Simon Willison tested one pelican prompt across GPT-5.6 models and effort settings. The least expensive run cost 0.71 cents; the most expensive cost 48.55 cents. That is nearly a seventy-fold swing before judging the result. The price table is only a starting point. Settings and retries determine the bill.",
      25,
      ["claim_simon_cost_example"]
    ),
    paragraph(
      "a_caveat",
      "Keep two boundaries visible. OpenAI says its cost and latency comparisons are simulated and real-world results may vary substantially. The system card also reports more cases of going beyond user intent than GPT-5.5 in agentic coding tests, although absolute rates stayed low. More capable agents make permissions, checkpoints, and review more important.",
      27,
      ["claim_benchmark_caveat", "claim_safety_overreach"]
    ),
    paragraph(
      "a_availability",
      "GPT-5.6 is available across ChatGPT, Codex, and the API. Per million API tokens, Luna is one dollar in and six out. Terra is two-fifty and fifteen. Sol is five and thirty. The prices do not choose the workflow for you. A short classification job and a multi-file implementation should not get the same model, effort, or supervision.",
      26,
      ["claim_availability", "claim_pricing", "claim_aimh_read"]
    ),
    paragraph(
      "a_takeaway",
      "The AIMH test is simple: give one real task to Luna, Terra, and Sol. Track total cost, time, retries, and cleanup. Compare the finished artifact, not just the first answer. GPT-5.6's value will be decided by which tier reliably earns each kind of work.",
      19,
      ["claim_tiers", "claim_aimh_read"]
    )
  ]
};

const scriptB: ScriptFile = {
  schema_version: "0.1.0",
  voice,
  narration: [
    paragraph(
      "b_launch",
      "OpenAI opens its GPT-5.6 story with work happening in the world: a greenhouse, a laptop in the field, and a person annotating what the system should notice. Then the product footage moves into ChatGPT Work. The message is clear. GPT-5.6 is being sold as a system that does work, not merely a model that answers questions.",
      24,
      ["claim_launch_family", "claim_knowledge_work"]
    ),
    paragraph(
      "b_tiers",
      "That system has three lanes. Luna is fastest and least expensive. Terra balances speed and capability. Sol is the flagship for the hardest professional tasks. OpenAI's pitch is better work per dollar, but the practical choice is not a leaderboard winner. It is deciding which lane fits the job in front of you.",
      21,
      ["claim_tiers", "claim_efficiency"]
    ),
    paragraph(
      "b_controls",
      "Then effort changes the shape of the run. Max lets the model spend longer exploring and checking. Ultra coordinates four agents by default, while the API adds a multi-agent beta. Model, effort, and agent count are now separate controls. Turning all three up may improve a difficult result, but it also changes time and cost.",
      22,
      ["claim_max", "claim_ultra"]
    ),
    paragraph(
      "b_practical",
      "Here is the more interesting proof. Programmatic Tool Calling coordinates tools through small programs, and computer use lets the model inspect what it rendered. OpenAI shows a sailing game that can actually be played, with wind, gates, sail trim, and race telemetry. It also shows an interactive spirograph built inside ChatGPT. This is where the launch feels different: the evidence moves, responds, and can be judged as a finished artifact.",
      29,
      ["claim_programmatic_tools", "claim_design"],
      {
        speechText:
          "Here is the more interesting proof. Programmatic tool-calling coordinates tools through small programs, and computer use lets the model inspect what it rendered. OpenAI shows a sailing game that can actually be played, with wind, gates, sail trim, and race telemetry. It also shows an interactive spirograph built inside ChatGPT. This is where the launch feels different: the evidence moves, responds, and can be judged as a finished artifact.",
        criticalPhrases: ["Programmatic Tool Calling"]
      }
    ),
    paragraph(
      "b_demos",
      "The demos also reveal the real review standard. A polished first frame is not enough. Can the boat steer? Does the interface explain itself? Does the animation continue cleanly? Stronger computer use matters only when the model notices broken states and fixes them. That is why playing the result tells us more than another static screenshot.",
      22,
      ["claim_design", "claim_knowledge_work"]
    ),
    paragraph(
      "b_reality",
      "Outside tests keep the demo reel honest. CodeRabbit reports that Sol completed 63.7 percent of more than one hundred coding tasks, versus 40.7 percent for Terra, while Terra used more output tokens. Simon Willison's identical pelican prompt cost from 0.71 cents to 48.55 cents as model and effort changed. Cheap tokens and cheap completed work are not the same thing.",
      25,
      ["claim_coderabbit_hands_on", "claim_simon_cost_example"]
    ),
    paragraph(
      "b_caveat",
      "OpenAI's own footnote says its cost and latency estimates are simulated and real workloads can vary substantially. The system card also reports more agentic cases of going beyond user intent than GPT-5.5, at low absolute rates. More autonomy still needs scope, permissions, and checkpoints.",
      19,
      ["claim_benchmark_caveat", "claim_safety_overreach"]
    ),
    paragraph(
      "b_availability",
      "GPT-5.6 is rolling out through ChatGPT, Codex, and the API. Luna costs one dollar in and six out per million tokens. Terra is two-fifty and fifteen. Sol is five and thirty. The useful workflow is to start with a task you know well, then raise the tier or effort only when the artifact does not meet the bar.",
      23,
      ["claim_availability", "claim_pricing", "claim_aimh_read"]
    ),
    paragraph(
      "b_takeaway",
      "The launch looks impressive when you can see the work move. Now test it on your own job. Compare the finished result, the retries, and the cleanup. The best GPT-5.6 setting is the one that earns its total cost.",
      15,
      ["claim_aimh_read"]
    )
  ]
};

const zoom = (
  id: string,
  assetPath: string,
  sourceLabel: string,
  headline: string,
  focalRect: FocalRect,
  weight = 1
): WeightedStillBeat => ({
  id,
  kind: "source_zoom",
  assetPath,
  weight,
  sourceLabel,
  headline,
  focalRect,
  fit: "contain"
});

const motion = (
  id: string,
  kind: "video" | "interactive_capture",
  assetPath: string,
  sourceLabel: string,
  headline: string,
  weight = 1,
  fit: "cover" | "contain" = "cover"
): WeightedMotionBeat => ({ id, kind, assetPath, weight, sourceLabel, headline, fit });

const hero = (weight = 2) =>
  motion(
    "openai-top-hero",
    "video",
    "source/openai-hero-excerpt.mp4",
    "OpenAI · GPT-5.6 launch page hero",
    "OpenAI opens with work in the world",
    weight
  );

const saltwind = (weight = 2) =>
  motion(
    "saltwind-gameplay",
    "interactive_capture",
    "source/saltwind-gameplay.mp4",
    "OpenAI · Saltwind interactive demo",
    "A generated result you can actually play",
    weight
  );

const spirograph = (weight = 2) =>
  motion(
    "spirograph-build",
    "video",
    "source/spirograph-build.mp4",
    "OpenAI · ChatGPT Work example",
    "The built artifact keeps moving",
    weight,
    "contain"
  );

const scenesA: readonly Gpt56RevisionScene[] = [
  {
    narrationId: "a_launch",
    beats: [
      hero(1),
      zoom(
        "launch-context",
        "evidence/01-openai-hero.png",
        "OpenAI · GPT-5.6 launch",
        "A three-tier family for work",
        { x: 0.27, y: 0.04, width: 0.48, height: 0.16 },
        3
      )
    ]
  },
  {
    narrationId: "a_tiers",
    beats: [
      zoom(
        "tiers-zoom",
        "evidence/02-efficient-default.png",
        "OpenAI · GPT-5.6 launch",
        "The tier is the first routing decision",
        { x: 0.37, y: 0.1, width: 0.43, height: 0.34 }
      )
    ]
  },
  {
    narrationId: "a_controls",
    beats: [
      zoom(
        "controls-zoom",
        "evidence/06-max-ultra.png",
        "OpenAI · GPT-5.6 launch",
        "Max thinks longer; ultra uses agents",
        { x: 0.38, y: 0.62, width: 0.42, height: 0.29 }
      )
    ]
  },
  { narrationId: "a_practical", beats: [saltwind(3), spirograph(2)] },
  {
    narrationId: "a_hands_on",
    beats: [
      zoom(
        "coderabbit-hands-on",
        "evidence/09-coderabbit-hands-on.png",
        "CodeRabbit · hands-on coding test",
        "Measure the cost of a solved task",
        { x: 0.08, y: 0.42, width: 0.84, height: 0.42 }
      )
    ]
  },
  {
    narrationId: "a_cost",
    beats: [
      zoom(
        "simon-low-cost",
        "evidence/10-simon-willison-cost-example.png",
        "Simon Willison · GPT-5.6 pelican test",
        "Luna at no effort: 0.71 cents",
        { x: 0.05, y: 0.02, width: 0.35, height: 0.21 }
      ),
      zoom(
        "simon-high-cost",
        "evidence/10-simon-willison-cost-example.png",
        "Simon Willison · GPT-5.6 pelican test",
        "Sol at max effort: 48.55 cents",
        { x: 0.59, y: 0.79, width: 0.4, height: 0.2 }
      )
    ]
  },
  {
    narrationId: "a_caveat",
    beats: [
      zoom(
        "openai-footnote",
        "evidence/08-footnotes.png",
        "OpenAI · launch footnote",
        "Real-world cost and latency can differ",
        { x: 0.31, y: 0.8, width: 0.46, height: 0.17 }
      ),
      zoom(
        "system-card",
        "evidence/05-system-card-caveat.png",
        "OpenAI · GPT-5.6 system card",
        "More autonomy needs tighter scope",
        { x: 0.35, y: 0.08, width: 0.53, height: 0.2 }
      )
    ]
  },
  {
    narrationId: "a_availability",
    beats: [
      zoom(
        "pricing",
        "evidence/04-availability-pricing.png",
        "OpenAI · GPT-5.6 pricing",
        "Model choice becomes work allocation",
        { x: 0.38, y: 0.77, width: 0.43, height: 0.2 }
      )
    ]
  },
  { narrationId: "a_takeaway", beats: [saltwind(), spirograph()] }
];

const scenesB: readonly Gpt56RevisionScene[] = [
  {
    narrationId: "b_launch",
    beats: [
      hero(8),
      motion(
        "chatgpt-work-launch",
        "video",
        "source/openai-launch.mp4",
        "OpenAI · ChatGPT Work launch clip",
        "From model picker to work system",
        15,
        "contain"
      )
    ]
  },
  {
    narrationId: "b_tiers",
    beats: [
      zoom(
        "tiers-zoom-b",
        "evidence/02-efficient-default.png",
        "OpenAI · GPT-5.6 launch",
        "Three lanes for three kinds of work",
        { x: 0.37, y: 0.1, width: 0.43, height: 0.34 }
      )
    ]
  },
  {
    narrationId: "b_controls",
    beats: [
      zoom(
        "controls-zoom-b",
        "evidence/06-max-ultra.png",
        "OpenAI · GPT-5.6 launch",
        "Turn up time, agents, or both",
        { x: 0.38, y: 0.62, width: 0.42, height: 0.29 }
      )
    ]
  },
  { narrationId: "b_practical", beats: [saltwind(4), spirograph(3)] },
  {
    narrationId: "b_demos",
    beats: [saltwind(3), spirograph(2), motion("work-demo", "video", "source/openai-launch.mp4", "OpenAI · ChatGPT Work", "Watch the artifact change", 2, "contain")]
  },
  {
    narrationId: "b_reality",
    beats: [
      zoom(
        "coderabbit-compact",
        "evidence/09-coderabbit-hands-on.png",
        "CodeRabbit · hands-on coding test",
        "Follow-through changes task economics",
        { x: 0.08, y: 0.42, width: 0.84, height: 0.42 }
      ),
      zoom(
        "simon-low-compact",
        "evidence/10-simon-willison-cost-example.png",
        "Simon Willison · GPT-5.6 pelican test",
        "The same prompt starts at 0.71 cents",
        { x: 0.05, y: 0.02, width: 0.35, height: 0.21 }
      ),
      zoom(
        "simon-high-compact",
        "evidence/10-simon-willison-cost-example.png",
        "Simon Willison · GPT-5.6 pelican test",
        "At max effort it reaches 48.55 cents",
        { x: 0.59, y: 0.79, width: 0.4, height: 0.2 }
      )
    ]
  },
  {
    narrationId: "b_caveat",
    beats: [
      zoom(
        "footnote-b",
        "evidence/08-footnotes.png",
        "OpenAI · launch footnote",
        "Launch estimates are not your workload",
        { x: 0.31, y: 0.8, width: 0.46, height: 0.17 }
      ),
      zoom(
        "system-card-b",
        "evidence/05-system-card-caveat.png",
        "OpenAI · system card",
        "Autonomy still needs boundaries",
        { x: 0.35, y: 0.08, width: 0.53, height: 0.2 }
      )
    ]
  },
  {
    narrationId: "b_availability",
    beats: [
      zoom(
        "pricing-b",
        "evidence/04-availability-pricing.png",
        "OpenAI · GPT-5.6 pricing",
        "Start low, raise effort when needed",
        { x: 0.38, y: 0.77, width: 0.43, height: 0.2 }
      )
    ]
  },
  { narrationId: "b_takeaway", beats: [hero(), saltwind(2), spirograph(2)] }
];

export const GPT56_REVISION: Gpt56RevisionManifest = {
  id: "2026-07-13-gpt-5-6",
  variants: [
    { id: "a-evidence", label: "Evidence documentary", script: scriptA, scenes: scenesA },
    { id: "b-demo", label: "Demo-led review", script: scriptB, scenes: scenesB }
  ]
};

export function allocateBeatFrames(
  totalFrames: number,
  beats: readonly { readonly weight: number }[]
): number[] {
  if (!Number.isInteger(totalFrames) || totalFrames <= 0) {
    throw new Error("Beat allocation requires a positive integer frame count");
  }
  if (beats.length === 0) throw new Error("Beat allocation requires at least one beat");
  if (totalFrames < beats.length) throw new Error("Every evidence beat requires at least one frame");
  if (!beats.every((beat) => Number.isFinite(beat.weight) && beat.weight > 0)) {
    throw new Error("Evidence beat weights must be finite and positive");
  }

  const totalWeight = beats.reduce((sum, beat) => sum + beat.weight, 0);
  const exact = beats.map((beat) => (totalFrames * beat.weight) / totalWeight);
  const allocated = exact.map((value) => Math.max(1, Math.floor(value)));
  let remaining = totalFrames - allocated.reduce((sum, value) => sum + value, 0);
  const byFraction = exact
    .map((value, index) => ({ index, fraction: value - Math.floor(value) }))
    .sort((a, b) => b.fraction - a.fraction || a.index - b.index);

  while (remaining > 0) {
    allocated[byFraction[(remaining - 1) % byFraction.length]!.index]! += 1;
    remaining -= 1;
  }
  while (remaining < 0) {
    const candidate = [...byFraction].reverse().find(({ index }) => allocated[index]! > 1);
    if (!candidate) throw new Error("Every evidence beat requires at least one frame");
    allocated[candidate.index]! -= 1;
    remaining += 1;
  }
  return allocated;
}

export interface Gpt56RevisionPaths {
  readonly baselineVideo: string;
  readonly finalVideo: string;
  readonly variantRoot: string;
  readonly platesDir: string;
  readonly segmentsDir: string;
  readonly workDir: string;
  readonly captions: string;
  readonly renderStatus: string;
  readonly script: string;
  readonly voiceRoot: string;
  readonly voiceResult: string;
  readonly qaRoot: string;
}

export function revisionPaths(
  episodeDir: string,
  variantId: Gpt56RevisionVariantId
): Gpt56RevisionPaths {
  const suffix = variantId === "a-evidence" ? "a" : "b";
  const variantRoot = join(episodeDir, "render", "revision", variantId);
  const voiceRoot = join(episodeDir, "voice", "revision", variantId);
  return {
    baselineVideo: join(episodeDir, "render", "final-baseline.mp4"),
    finalVideo: join(episodeDir, "render", `final-${variantId}.mp4`),
    variantRoot,
    platesDir: join(variantRoot, "plates"),
    segmentsDir: join(variantRoot, "segments"),
    workDir: join(variantRoot, "work"),
    captions: join(episodeDir, "render", `captions-${variantId}.srt`),
    renderStatus: join(variantRoot, "render-status.json"),
    script: join(episodeDir, `script-${suffix}.json`),
    voiceRoot,
    voiceResult: join(voiceRoot, "narration.json"),
    qaRoot: join(episodeDir, "qa", variantId)
  };
}

export interface Gpt56RevisionPlateJob {
  readonly narrationId: string;
  readonly narrationPath: string;
  readonly outputPath: string;
  readonly durationSeconds: number;
  readonly inputProps: NewsroomEvidencePlateProps;
}

export function buildRevisionPlateJobs(
  variant: Gpt56RevisionVariant,
  voiceRecords: readonly VoiceChunkResult[],
  episodeDir: string
): readonly Gpt56RevisionPlateJob[] {
  if (voiceRecords.length !== variant.script.narration.length) {
    throw new Error(
      `Variant ${variant.id} expected ${variant.script.narration.length} voice records, found ${voiceRecords.length}`
    );
  }
  const voiceById = new Map(voiceRecords.map((record) => [record.id, record]));
  const paths = revisionPaths(episodeDir, variant.id);

  return variant.scenes.map((scene, index) => {
    const record = voiceById.get(scene.narrationId);
    if (
      !record ||
      !record.file ||
      record.provider !== "elevenlabs" ||
      !Number.isFinite(record.durationSeconds) ||
      record.durationSeconds <= 0
    ) {
      throw new Error(`Missing measured ElevenLabs voice record: ${scene.narrationId}`);
    }
    const totalFrames = Math.ceil(record.durationSeconds * 30);
    const frames = allocateBeatFrames(totalFrames, scene.beats);
    const beats: EvidenceBeat[] = scene.beats.map((weightedBeat, beatIndex) => {
      const { weight: _weight, ...beat } = weightedBeat;
      return { ...beat, durationFrames: frames[beatIndex]! } as EvidenceBeat;
    });
    return {
      narrationId: scene.narrationId,
      narrationPath: record.file,
      outputPath: join(
        paths.platesDir,
        `${String(index + 1).padStart(2, "0")}-${scene.narrationId}.mp4`
      ),
      durationSeconds: record.durationSeconds,
      inputProps: {
        durationSeconds: record.durationSeconds,
        seriesLabel: "AIMH NEWSROOM · GPT-5.6",
        beats
      }
    };
  });
}

export interface Gpt56RevisionBeatWindow {
  readonly id: string;
  readonly kind: WeightedEvidenceBeat["kind"];
  readonly assetPath: string;
  readonly startSeconds: number;
  readonly endSeconds: number;
}

export interface Gpt56RevisionSceneWindow {
  readonly narrationId: string;
  readonly startSeconds: number;
  readonly endSeconds: number;
  readonly beats: readonly Gpt56RevisionBeatWindow[];
}

export function buildRevisionSceneWindows(
  variant: Gpt56RevisionVariant,
  voiceRecords: readonly VoiceChunkResult[]
): readonly Gpt56RevisionSceneWindow[] {
  const voiceById = new Map(voiceRecords.map((record) => [record.id, record]));
  let sceneCursor = 0;
  return variant.scenes.map((scene) => {
    const record = voiceById.get(scene.narrationId);
    if (!record || !Number.isFinite(record.durationSeconds) || record.durationSeconds <= 0) {
      throw new Error(`Missing measured voice duration: ${scene.narrationId}`);
    }
    const totalFrames = Math.ceil(record.durationSeconds * 30);
    const frames = allocateBeatFrames(totalFrames, scene.beats);
    const startSeconds = sceneCursor;
    let beatCursor = startSeconds;
    const beats = scene.beats.map((beat, index) => {
      const durationSeconds = (frames[index]! / totalFrames) * record.durationSeconds;
      const window = {
        id: beat.id,
        kind: beat.kind,
        assetPath: beat.assetPath,
        startSeconds: beatCursor,
        endSeconds: beatCursor + durationSeconds
      };
      beatCursor = window.endSeconds;
      return window;
    });
    const endSeconds = startSeconds + record.durationSeconds;
    if (beats.length > 0) {
      beats[beats.length - 1] = { ...beats[beats.length - 1]!, endSeconds };
    }
    sceneCursor = endSeconds;
    return { narrationId: scene.narrationId, startSeconds, endSeconds, beats };
  });
}

const safeAssetPath = (path: string): boolean =>
  Boolean(path) && !path.startsWith("/") && !path.split("/").includes("..");

export function validateGpt56Revision(manifest: Gpt56RevisionManifest): void {
  if (manifest.variants.length !== 2) throw new Error("GPT-5.6 revision requires exactly two variants");
  if (manifest.variants[0]?.id !== "a-evidence" || manifest.variants[1]?.id !== "b-demo") {
    throw new Error("GPT-5.6 revision variant order is invalid");
  }

  for (const variant of manifest.variants) {
    if (variant.script.narration.length !== variant.scenes.length) {
      throw new Error(`Variant ${variant.id} narration and scene counts differ`);
    }
    const narrationIds = new Set<string>();
    variant.script.narration.forEach((item, index) => {
      if (narrationIds.has(item.id)) throw new Error(`Duplicate narration id: ${item.id}`);
      narrationIds.add(item.id);
      if (variant.scenes[index]?.narrationId !== item.id) {
        throw new Error(`Variant ${variant.id} scene order does not match narration`);
      }
      if (item.claim_ids.length === 0) throw new Error(`Narration ${item.id} has no claims`);
    });

    const beats = variant.scenes.flatMap((scene) => scene.beats);
    for (const beat of beats) {
      if (!safeAssetPath(beat.assetPath)) throw new Error(`Unsafe evidence asset path: ${beat.id}`);
      if (!Number.isFinite(beat.weight) || beat.weight <= 0) {
        throw new Error(`Invalid evidence weight: ${beat.id}`);
      }
    }
    if (!beats.some((beat) => beat.assetPath.endsWith("openai-hero-excerpt.mp4"))) {
      throw new Error(`Variant ${variant.id} omits the article hero video`);
    }
    if (!beats.some((beat) => beat.kind === "interactive_capture")) {
      throw new Error(`Variant ${variant.id} omits an interactive capture`);
    }
    if (!beats.some((beat) => beat.assetPath.includes("spirograph"))) {
      throw new Error(`Variant ${variant.id} omits an embedded build video`);
    }
    if (!beats.some((beat) => beat.kind === "source_zoom")) {
      throw new Error(`Variant ${variant.id} omits readable source zooms`);
    }
    const practical = variant.script.narration.find((item) =>
      item.text.includes("Programmatic Tool Calling")
    );
    if (!practical?.speech_text?.includes("tool-calling") || !practical.critical_phrases?.includes("Programmatic Tool Calling")) {
      throw new Error(`Variant ${variant.id} lacks the Programmatic Tool Calling phrase lock`);
    }
  }
}

export function parseGpt56RevisionCommand(command: string | undefined): Gpt56RevisionCommand {
  if (!SUPPORTED_GPT56_REVISION_COMMANDS.includes(command as Gpt56RevisionCommand)) {
    throw new Error(
      `Unsupported GPT-5.6 revision command "${command ?? ""}". Expected one of: ${SUPPORTED_GPT56_REVISION_COMMANDS.join(", ")}`
    );
  }
  return command as Gpt56RevisionCommand;
}

const PROJECT_ROOT = fileURLToPath(new URL("../../", import.meta.url));
const DEFAULT_VIDEO_ENGINE_DIR = "/Users/dennywii/Documents/dev/aimh-video-engine";
const DEFAULT_NEWSROOM_ENV_DIR = "/Users/dennywii/Documents/dev/aimh-newsroom-pipeline";
const DEFAULT_MUSIC_DIR = join(DEFAULT_VIDEO_ENGINE_DIR, "assets", "music");
export const GPT56_REVISION_EPISODE_DIR = join(PROJECT_ROOT, "episodes", GPT56_REVISION.id);

const ffmpegPath = (env: Record<string, string>): string =>
  env.FFMPEG_PATH ?? env.FFMPEG ?? "ffmpeg";
const ffprobePath = (env: Record<string, string>): string =>
  env.FFPROBE_PATH ?? env.FFPROBE ?? "ffprobe";

const readJson = async <T>(path: string): Promise<T> =>
  JSON.parse(await readFile(path, "utf8")) as T;

const requireFile = async (path: string, label: string): Promise<void> => {
  try {
    await access(path);
  } catch {
    throw new Error(`${label} is unavailable: ${path}`);
  }
};

const sha256File = async (path: string): Promise<string> =>
  createHash("sha256").update(await readFile(path)).digest("hex");

const validateRevisionEditorialInputs = async (episodeDir: string): Promise<void> => {
  const [researchManifest, mediaManifest] = await Promise.all([
    readJson<ResearchManifest>(join(episodeDir, "research-manifest.json")),
    readJson<MediaManifest>(join(episodeDir, "media-manifest.json"))
  ]);
  const usedPrimaryMotionAssets = [
    ...new Set(
      GPT56_REVISION.variants.flatMap((variant) =>
        variant.scenes.flatMap((scene) =>
          scene.beats.flatMap((beat) =>
            beat.kind === "video" || beat.kind === "interactive_capture"
              ? [beat.assetPath]
              : []
          )
        )
      )
    )
  ];
  validateArticleEditorialGate({
    researchManifest,
    mediaManifest,
    usedPrimaryMotionAssets
  });
};

const safeConcatLine = (path: string): string => `file '${path.replaceAll("'", "'\\''")}'`;

const assertRevisionVoiceResult = (
  variant: Gpt56RevisionVariant,
  voiceResult: VoiceRenderResult
): void => {
  if (
    voiceResult.provider !== "elevenlabs" ||
    voiceResult.warnings.length > 0 ||
    voiceResult.chunks.length !== variant.script.narration.length
  ) {
    throw new Error(
      `Variant ${variant.id} requires complete ElevenLabs narration; provider=${voiceResult.provider} warnings=${voiceResult.warnings.length}`
    );
  }
  variant.script.narration.forEach((paragraph, index) => {
    const chunk = voiceResult.chunks[index];
    if (
      chunk?.id !== paragraph.id ||
      chunk.text !== paragraph.text ||
      !chunk.file ||
      !Number.isFinite(chunk.durationSeconds) ||
      chunk.durationSeconds <= 0
    ) {
      throw new Error(`Invalid ElevenLabs narration chunk: ${paragraph.id}`);
    }
  });
};

const loadRuntimeEnv = async (): Promise<Record<string, string>> => {
  const videoEngineDir = process.env.AIMH_VIDEO_ENGINE_PATH ?? DEFAULT_VIDEO_ENGINE_DIR;
  const localEnvRoot = process.env.AIMH_NEWSROOM_ROOT ??
    (PROJECT_ROOT.includes(`${join("", ".worktrees")}/`) ? DEFAULT_NEWSROOM_ENV_DIR : PROJECT_ROOT);
  return (await loadEnvSnapshotFromFiles(localEnvRoot, videoEngineDir)).values;
};

const selectedVariants = (
  requested: Gpt56RevisionVariantId | "both"
): readonly Gpt56RevisionVariant[] => {
  if (requested === "both") return GPT56_REVISION.variants;
  const variant = GPT56_REVISION.variants.find((candidate) => candidate.id === requested);
  if (!variant) throw new Error(`Unknown GPT-5.6 revision variant: ${requested}`);
  return [variant];
};

export function parseGpt56RevisionVariant(
  args: readonly string[]
): Gpt56RevisionVariantId | "both" {
  const optionIndex = args.indexOf("--variant");
  const value = optionIndex >= 0 ? args[optionIndex + 1] : "both";
  if (value !== "a-evidence" && value !== "b-demo" && value !== "both") {
    throw new Error('GPT-5.6 revision --variant must be "a-evidence", "b-demo", or "both"');
  }
  return value;
}

interface RevisionAudioSelection {
  readonly schema_version: "0.1.0";
  readonly episode_id: string;
  readonly seed: string;
  readonly selected_outro: string;
}

const loadOrSelectRevisionOutro = async (
  episodeDir: string,
  env: Record<string, string>
): Promise<RevisionAudioSelection> => {
  const manifestPath = join(episodeDir, "revision-audio.json");
  try {
    const persisted = await readJson<RevisionAudioSelection>(manifestPath);
    await requireFile(persisted.selected_outro, "Persisted revision outro");
    return persisted;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== "ENOENT") {
      const message = (error as Error).message;
      if (!message.includes("unavailable")) throw error;
    }
  }
  const musicDirectory = env.AIMH_MUSIC_PATH ?? DEFAULT_MUSIC_DIR;
  const seed = `${GPT56_REVISION.id}:two-cut-revision`;
  const selectedOutro = selectEpisodeOutroPath(
    seed,
    musicDirectory,
    await readdir(musicDirectory),
    env.AIMH_OUTRO_MUSIC_PATH
  );
  const selection: RevisionAudioSelection = {
    schema_version: "0.1.0",
    episode_id: GPT56_REVISION.id,
    seed,
    selected_outro: selectedOutro
  };
  await requireFile(selectedOutro, "Selected revision outro");
  await writeJson(manifestPath, selection);
  return selection;
};

export async function runGpt56RevisionVoice(
  requested: Gpt56RevisionVariantId | "both" = "both",
  episodeDir = GPT56_REVISION_EPISODE_DIR
): Promise<readonly VoiceRenderResult[]> {
  validateGpt56Revision(GPT56_REVISION);
  await validateRevisionEditorialInputs(episodeDir);
  const env = await loadRuntimeEnv();
  if (!env.ELEVENLABS_API_KEY || !env.ELEVENLABS_VOICE_ID) {
    throw new Error(
      "ELEVENLABS_API_KEY and ELEVENLABS_VOICE_ID are required; no narration fallback is allowed"
    );
  }
  const results: VoiceRenderResult[] = [];
  for (const variant of selectedVariants(requested)) {
    const paths = revisionPaths(episodeDir, variant.id);
    await writeJson(paths.script, variant.script);
    const voiceResult = await synthesizeNarration({
      script: variant.script,
      outDir: paths.voiceRoot,
      env,
      ffprobePath: ffprobePath(env),
      allowElevenLabs: true
    });
    assertRevisionVoiceResult(variant, voiceResult);
    await writeJson(paths.voiceResult, voiceResult);
    process.stdout.write(`Narration ready: ${variant.label}\n`);
    results.push(voiceResult);
  }
  return results;
}

export interface Gpt56RevisionRenderResult {
  readonly status: "rendered";
  readonly variantId: Gpt56RevisionVariantId;
  readonly finalVideoPath: string;
  readonly captionsPath: string;
  readonly durationSeconds: number;
  readonly selectedOutro: string;
  readonly baselineSha256: string;
  readonly segments: readonly string[];
}

const loadRevisionVoice = async (
  episodeDir: string,
  variant: Gpt56RevisionVariant
): Promise<VoiceRenderResult> => {
  const voiceResult = await readJson<VoiceRenderResult>(
    revisionPaths(episodeDir, variant.id).voiceResult
  );
  assertRevisionVoiceResult(variant, voiceResult);
  return voiceResult;
};

export async function runGpt56RevisionRender(
  requested: Gpt56RevisionVariantId | "both" = "both",
  episodeDir = GPT56_REVISION_EPISODE_DIR
): Promise<readonly Gpt56RevisionRenderResult[]> {
  validateGpt56Revision(GPT56_REVISION);
  await validateRevisionEditorialInputs(episodeDir);
  const env = await loadRuntimeEnv();
  const logoPath = env.AIMH_LOGO_PATH ?? join(DEFAULT_VIDEO_ENGINE_DIR, "assets", "logo.png");
  const audioSelection = await loadOrSelectRevisionOutro(episodeDir, env);
  await Promise.all([
    requireFile(logoPath, "AIMH logo"),
    requireFile(audioSelection.selected_outro, "Revision outro")
  ]);

  const results: Gpt56RevisionRenderResult[] = [];
  let bundleOutput: string | undefined;
  try {
    const serveUrl = await bundle({
      entryPoint: fileURLToPath(new URL("./newsroom/motion/Root.tsx", import.meta.url)),
      publicDir: episodeDir,
      onDirectoryCreated: (path) => {
        bundleOutput = path;
      }
    });

    for (const variant of selectedVariants(requested)) {
      const paths = revisionPaths(episodeDir, variant.id);
      await requireFile(paths.baselineVideo, "Approved baseline video");
      const baselineSha256 = await sha256File(paths.baselineVideo);
      const voiceResult = await loadRevisionVoice(episodeDir, variant);
      const uniqueAssets = [...new Set(variant.scenes.flatMap((scene) =>
        scene.beats.map((beat) => beat.assetPath)
      ))];
      await Promise.all(
        uniqueAssets.map((assetPath) => requireFile(join(episodeDir, assetPath), "Revision evidence"))
      );

      await rm(paths.variantRoot, { recursive: true, force: true });
      await Promise.all([
        ensureDir(paths.platesDir),
        ensureDir(paths.segmentsDir),
        ensureDir(paths.workDir)
      ]);
      const jobs = buildRevisionPlateJobs(variant, voiceResult.chunks, episodeDir);
      for (const [index, job] of jobs.entries()) {
        const composition = await selectComposition({
          serveUrl,
          id: "NewsroomEvidencePlate",
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
          paths.segmentsDir,
          `${String(index + 1).padStart(2, "0")}-${job.narrationId}.mp4`
        );
        await runCommand(
          ffmpegPath(env),
          buildGpt56SegmentMuxArgs({
            platePath: job.outputPath,
            narrationPath: job.narrationPath,
            outputPath: segmentPath,
            durationSeconds: job.durationSeconds
          })
        );
        process.stdout.write(
          `Rendered ${variant.id} scene ${index + 1}/${jobs.length}: ${job.narrationId}\n`
        );
      }

      const segmentPaths = jobs.map((job, index) =>
        join(
          paths.segmentsDir,
          `${String(index + 1).padStart(2, "0")}-${job.narrationId}.mp4`
        )
      );
      const concatPath = join(paths.workDir, "segments.txt");
      const assembledPath = join(paths.workDir, "assembled.mp4");
      await writeText(concatPath, `${segmentPaths.map(safeConcatLine).join("\n")}\n`);
      await runCommand(ffmpegPath(env), [
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

      const durationSeconds = voiceResult.chunks.reduce(
        (sum, chunk) => sum + chunk.durationSeconds,
        0
      );
      await writeText(
        paths.captions,
        buildCaptionsSrt(
          variant.script.narration,
          voiceResult.chunks.map((chunk) => chunk.durationSeconds)
        )
      );
      await runCommand(
        ffmpegPath(env),
        buildGpt56FinalRenderArgs({
          assembledPath,
          logoPath,
          outroPath: audioSelection.selected_outro,
          outputPath: paths.finalVideo,
          durationSeconds
        })
      );

      const baselineAfter = await sha256File(paths.baselineVideo);
      if (baselineAfter !== baselineSha256) {
        throw new Error(`Protected baseline changed while rendering ${variant.id}`);
      }
      const result: Gpt56RevisionRenderResult = {
        status: "rendered",
        variantId: variant.id,
        finalVideoPath: paths.finalVideo,
        captionsPath: paths.captions,
        durationSeconds,
        selectedOutro: audioSelection.selected_outro,
        baselineSha256,
        segments: segmentPaths
      };
      await writeJson(paths.renderStatus, {
        ...result,
        renderedAt: new Date().toISOString(),
        voiceProvider: voiceResult.provider,
        evidence: await Promise.all(
          uniqueAssets.map(async (assetPath) => ({
            path: assetPath,
            sha256: await sha256File(join(episodeDir, assetPath))
          }))
        ),
        uploadAttempted: false
      });
      results.push(result);
    }
    return results;
  } finally {
    if (bundleOutput && basename(bundleOutput).startsWith("remotion-webpack-bundle-")) {
      await rm(bundleOutput, { recursive: true, force: true });
    }
  }
}

interface RevisionSampledFrame {
  readonly narrationId: string;
  readonly position: "start" | "middle" | "end";
  readonly atSeconds: number;
  readonly path: string;
  readonly lumaRange: number;
}

const frameLumaRange = async (
  ffmpeg: string,
  framePath: string
): Promise<number> => {
  const signal = await runCommand(ffmpeg, [
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
  return maximum - minimum;
};

const sampleRevisionFrames = async (options: {
  readonly ffmpeg: string;
  readonly finalVideoPath: string;
  readonly qaRoot: string;
  readonly windows: readonly Gpt56RevisionSceneWindow[];
}): Promise<readonly RevisionSampledFrame[]> => {
  const framesDir = join(options.qaRoot, "frames");
  await ensureDir(framesDir);
  const frames: RevisionSampledFrame[] = [];
  let sequence = 1;
  for (const window of options.windows) {
    const duration = window.endSeconds - window.startSeconds;
    const sampleTimes = [
      { position: "start" as const, atSeconds: window.startSeconds + Math.min(0.35, duration / 4) },
      { position: "middle" as const, atSeconds: window.startSeconds + duration / 2 },
      { position: "end" as const, atSeconds: window.endSeconds - Math.min(0.35, duration / 4) }
    ];
    for (const sample of sampleTimes) {
      const path = join(framesDir, `frame-${String(sequence).padStart(2, "0")}.png`);
      await runCommand(options.ffmpeg, [
        "-y",
        "-loglevel",
        "error",
        "-ss",
        sample.atSeconds.toFixed(3),
        "-i",
        options.finalVideoPath,
        "-frames:v",
        "1",
        path
      ]);
      frames.push({
        narrationId: window.narrationId,
        position: sample.position,
        atSeconds: sample.atSeconds,
        path,
        lumaRange: await frameLumaRange(options.ffmpeg, path)
      });
      sequence += 1;
    }
  }
  return frames;
};

const createRevisionContactSheet = async (options: {
  readonly ffmpeg: string;
  readonly qaRoot: string;
  readonly frameCount: number;
}): Promise<string> => {
  const outputPath = join(options.qaRoot, "contact-sheet.png");
  await runCommand(options.ffmpeg, [
    "-y",
    "-loglevel",
    "error",
    "-framerate",
    "1",
    "-start_number",
    "1",
    "-i",
    join(options.qaRoot, "frames", "frame-%02d.png"),
    "-vf",
    `scale=352:198,tile=5x6:nb_frames=${options.frameCount}:padding=8:margin=8:color=0x242424`,
    "-frames:v",
    "1",
    outputPath
  ]);
  return outputPath;
};

interface MotionProof {
  readonly beatId: string;
  readonly firstAtSeconds: number;
  readonly secondAtSeconds: number;
  readonly ssim: number;
  readonly pass: boolean;
  readonly firstFrame: string;
  readonly secondFrame: string;
}

const motionProofForBeat = async (options: {
  readonly ffmpeg: string;
  readonly finalVideoPath: string;
  readonly qaRoot: string;
  readonly beat: Gpt56RevisionBeatWindow;
}): Promise<MotionProof> => {
  const duration = options.beat.endSeconds - options.beat.startSeconds;
  const firstAtSeconds = options.beat.startSeconds + Math.min(1, duration * 0.2);
  const secondAtSeconds = Math.min(
    options.beat.endSeconds - 0.35,
    firstAtSeconds + Math.min(2.5, duration * 0.4)
  );
  const proofDir = join(options.qaRoot, "motion-proof");
  await ensureDir(proofDir);
  const firstFrame = join(proofDir, `${options.beat.id}-1.png`);
  const secondFrame = join(proofDir, `${options.beat.id}-2.png`);
  for (const [atSeconds, path] of [
    [firstAtSeconds, firstFrame],
    [secondAtSeconds, secondFrame]
  ] as const) {
    await runCommand(options.ffmpeg, [
      "-y",
      "-loglevel",
      "error",
      "-ss",
      atSeconds.toFixed(3),
      "-i",
      options.finalVideoPath,
      "-frames:v",
      "1",
      path
    ]);
  }
  const comparison = await runCommand(options.ffmpeg, [
    "-hide_banner",
    "-nostats",
    "-i",
    firstFrame,
    "-i",
    secondFrame,
    "-filter_complex",
    "[0:v][1:v]ssim",
    "-frames:v",
    "1",
    "-f",
    "null",
    "-"
  ]);
  const diagnostic = `${comparison.stdout}\n${comparison.stderr}`;
  const ssim = Number(diagnostic.match(/All:([0-9.]+)/)?.[1]);
  return {
    beatId: options.beat.id,
    firstAtSeconds,
    secondAtSeconds,
    ssim,
    pass: Number.isFinite(ssim) && ssim < 0.995,
    firstFrame,
    secondFrame
  };
};

const captureReadableZoomProof = async (options: {
  readonly ffmpeg: string;
  readonly finalVideoPath: string;
  readonly qaRoot: string;
  readonly beat: Gpt56RevisionBeatWindow;
}): Promise<string> => {
  const atSeconds = Math.max(options.beat.startSeconds, options.beat.endSeconds - 0.7);
  const outputPath = join(options.qaRoot, "readable-source-zoom.png");
  await runCommand(options.ffmpeg, [
    "-y",
    "-loglevel",
    "error",
    "-ss",
    atSeconds.toFixed(3),
    "-i",
    options.finalVideoPath,
    "-frames:v",
    "1",
    outputPath
  ]);
  return outputPath;
};

export interface Gpt56RevisionQaResult {
  readonly ok: boolean;
  readonly variantId: Gpt56RevisionVariantId;
  readonly finalVideoPath: string;
  readonly contactSheetPath: string;
  readonly readableZoomPath: string;
  readonly checks: readonly {
    readonly name: string;
    readonly pass: boolean;
    readonly detail: string;
  }[];
}

export async function runGpt56RevisionQa(
  requested: Gpt56RevisionVariantId | "both" = "both",
  episodeDir = GPT56_REVISION_EPISODE_DIR
): Promise<readonly Gpt56RevisionQaResult[]> {
  validateGpt56Revision(GPT56_REVISION);
  await validateRevisionEditorialInputs(episodeDir);
  const env = await loadRuntimeEnv();
  const ffmpeg = ffmpegPath(env);
  const ffprobe = ffprobePath(env);
  const results: Gpt56RevisionQaResult[] = [];
  for (const variant of selectedVariants(requested)) {
    const paths = revisionPaths(episodeDir, variant.id);
    const voiceResult = await loadRevisionVoice(episodeDir, variant);
    const renderStatus = await readJson<Gpt56RevisionRenderResult & { uploadAttempted?: boolean }>(
      paths.renderStatus
    );
    await rm(paths.qaRoot, { recursive: true, force: true });
    await ensureDir(paths.qaRoot);
    const windows = buildRevisionSceneWindows(variant, voiceResult.chunks);
    const inspection = await inspectMediaFile(ffprobe, paths.finalVideo);
    const measuredDuration = await ffprobeDurationSeconds(ffprobe, paths.finalVideo);
    const expectedDuration = voiceResult.chunks.reduce(
      (sum, chunk) => sum + chunk.durationSeconds,
      0
    );
    const streamProbe = await runCommand(ffprobe, [
      "-v",
      "error",
      "-select_streams",
      "a:0",
      "-show_entries",
      "stream=sample_rate,channels,channel_layout",
      "-of",
      "json",
      paths.finalVideo
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
    const frames = await sampleRevisionFrames({
      ffmpeg,
      finalVideoPath: paths.finalVideo,
      qaRoot: paths.qaRoot,
      windows
    });
    const contactSheetPath = await createRevisionContactSheet({
      ffmpeg,
      qaRoot: paths.qaRoot,
      frameCount: frames.length
    });
    const allBeats = windows.flatMap((window) => window.beats);
    const requiredMotion = ["openai-top-hero", "saltwind-gameplay", "spirograph-build"];
    const motionProofs = await Promise.all(
      requiredMotion.map(async (beatId) => {
        const beat = allBeats.find((candidate) => candidate.id === beatId);
        if (!beat) throw new Error(`QA motion beat is missing: ${beatId}`);
        return motionProofForBeat({
          ffmpeg,
          finalVideoPath: paths.finalVideo,
          qaRoot: paths.qaRoot,
          beat
        });
      })
    );
    const readableBeat = allBeats.find((beat) => beat.kind === "source_zoom");
    if (!readableBeat) throw new Error(`Variant ${variant.id} has no readable source zoom`);
    const readableZoomPath = await captureReadableZoomProof({
      ffmpeg,
      finalVideoPath: paths.finalVideo,
      qaRoot: paths.qaRoot,
      beat: readableBeat
    });
    const volumeResult = await runCommand(ffmpeg, [
      "-hide_banner",
      "-nostats",
      "-i",
      paths.finalVideo,
      "-af",
      "volumedetect",
      "-f",
      "null",
      "-"
    ]);
    const volumeDiagnostic = `${volumeResult.stdout}\n${volumeResult.stderr}`;
    const meanVolume = Number(volumeDiagnostic.match(/mean_volume:\s*(-?\d+(?:\.\d+)?) dB/)?.[1]);
    const maxVolume = Number(volumeDiagnostic.match(/max_volume:\s*(-?\d+(?:\.\d+)?) dB/)?.[1]);
    const tailAudioPath = join(paths.qaRoot, "tail-10s.wav");
    await runCommand(ffmpeg, [
      "-y",
      "-loglevel",
      "error",
      "-sseof",
      "-10",
      "-i",
      paths.finalVideo,
      "-vn",
      "-ar",
      "48000",
      "-ac",
      "2",
      tailAudioPath
    ]);
    const longStaticHolds = buildRevisionPlateJobs(variant, voiceResult.chunks, episodeDir)
      .flatMap((job) => findLongStaticHolds(job.inputProps.beats, 30, 12));
    const baselineSha256 = await sha256File(paths.baselineVideo);
    const practical = variant.script.narration.find((paragraph) =>
      paragraph.critical_phrases?.includes("Programmatic Tool Calling")
    );
    const checks = [
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
        pass:
          Number.isFinite(meanVolume) &&
          meanVolume > -35 &&
          Number.isFinite(maxVolume) &&
          maxVolume <= 0 &&
          maxVolume > -12,
        detail: `mean=${meanVolume.toFixed(1)}dB max=${maxVolume.toFixed(1)}dB`
      },
      {
        name: "sampled_frames",
        pass:
          frames.length === variant.scenes.length * 3 &&
          frames.every((frame) => Number.isFinite(frame.lumaRange) && frame.lumaRange >= 8),
        detail: `${frames.length} scene frames; minimum luma range=${Math.min(...frames.map((frame) => frame.lumaRange)).toFixed(1)}`
      },
      {
        name: "required_motion",
        pass: motionProofs.every((proof) => proof.pass),
        detail: motionProofs.map((proof) => `${proof.beatId} ssim=${proof.ssim.toFixed(4)}`).join(", ")
      },
      {
        name: "pacing",
        pass: longStaticHolds.length === 0,
        detail: longStaticHolds.length === 0 ? "no unacknowledged static hold exceeds 12s" : JSON.stringify(longStaticHolds)
      },
      {
        name: "phrase_lock",
        pass:
          practical?.speech_text?.includes("tool-calling") === true &&
          practical.critical_phrases?.includes("Programmatic Tool Calling") === true,
        detail: "Programmatic Tool Calling uses the hyphenated synthesis override"
      },
      {
        name: "protected_baseline",
        pass: baselineSha256 === renderStatus.baselineSha256,
        detail: baselineSha256
      },
      {
        name: "single_persisted_outro",
        pass: Boolean(renderStatus.selectedOutro) && renderStatus.selectedOutro === (
          await readJson<RevisionAudioSelection>(join(episodeDir, "revision-audio.json"))
        ).selected_outro,
        detail: renderStatus.selectedOutro
      },
      {
        name: "no_upload",
        pass: renderStatus.uploadAttempted !== true,
        detail: `uploadAttempted=${renderStatus.uploadAttempted === true}`
      }
    ];
    const result: Gpt56RevisionQaResult = {
      ok: checks.every((check) => check.pass),
      variantId: variant.id,
      finalVideoPath: paths.finalVideo,
      contactSheetPath,
      readableZoomPath,
      checks
    };
    await writeJson(join(paths.qaRoot, "qa.json"), {
      ...result,
      checkedAt: new Date().toISOString(),
      media: inspection,
      frames,
      motionProofs,
      audio: { meanVolume, maxVolume, stream: audioStream, tailAudioPath },
      longStaticHolds
    });
    if (!result.ok) {
      throw new Error(
        `GPT-5.6 revision QA failed for ${variant.id}: ${checks
          .filter((check) => !check.pass)
          .map((check) => check.name)
          .join(", ")}`
      );
    }
    process.stdout.write(`QA passed: ${variant.label}\n`);
    results.push(result);
  }
  return results;
}

export async function runGpt56RevisionCommand(
  command: Gpt56RevisionCommand,
  requested: Gpt56RevisionVariantId | "both" = "both",
  episodeDir = GPT56_REVISION_EPISODE_DIR
): Promise<unknown> {
  switch (command) {
    case "voice":
      return runGpt56RevisionVoice(requested, episodeDir);
    case "render":
      return runGpt56RevisionRender(requested, episodeDir);
    case "qa":
      return runGpt56RevisionQa(requested, episodeDir);
    case "all":
      await runGpt56RevisionVoice(requested, episodeDir);
      await runGpt56RevisionRender(requested, episodeDir);
      return runGpt56RevisionQa(requested, episodeDir);
  }
}

const isDirectExecution =
  process.argv[1] !== undefined && fileURLToPath(import.meta.url) === process.argv[1];

if (isDirectExecution) {
  runGpt56RevisionCommand(
    parseGpt56RevisionCommand(process.argv[2]),
    parseGpt56RevisionVariant(process.argv.slice(3))
  ).catch((error: unknown) => {
    process.stderr.write(`${(error as Error).message}\n`);
    process.exitCode = 1;
  });
}
