import type { ScriptFile } from "../types";
import type { FocalRect } from "./newsroom/motion/types";

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
      "OpenAI's GPT-5.6 page opens with work in the physical world: a grower walking through a greenhouse, a laptop in the field, and handwritten labels pointing to the task. That framing matters. The launch is not one model. It is a family called Luna, Terra, and Sol, built around a new question: how much intelligence, time, and parallelism does this job deserve?",
      27,
      ["claim_launch_family", "claim_tiers"]
    ),
    paragraph(
      "a_tiers",
      "Luna is the fast, low-cost lane. Terra is the everyday balance. Sol is the flagship for hard professional work. OpenAI says the family delivers more useful work per dollar, often with fewer output tokens or less time. But those are launch comparisons, not a guarantee for your workload. The practical shift is that choosing a model now looks more like routing work than picking a single default.",
      28,
      ["claim_tiers", "claim_efficiency", "claim_benchmark_caveat"]
    ),
    paragraph(
      "a_controls",
      "The second control is effort. Max lets one model spend longer exploring, checking, and revising. Ultra coordinates four agents in parallel by default. Developers also get a multi-agent beta in the Responses API. So the stack now has three levers: model tier, reasoning effort, and whether a difficult task deserves a small team working at once.",
      23,
      ["claim_max", "claim_ultra"]
    ),
    paragraph(
      "a_practical",
      "The interesting part is what that extra capability produces. Programmatic Tool Calling lets GPT-5.6 run small programs that coordinate tools and filter intermediate results. Stronger computer use lets it inspect and refine what it built. OpenAI's own examples include this playable sailing game and an interactive spirograph. These are not benchmark bars; they are rendered artifacts you can actually operate and evaluate.",
      25,
      ["claim_programmatic_tools", "claim_design", "claim_knowledge_work"],
      {
        speechText:
          "The interesting part is what that extra capability produces. Programmatic tool-calling lets GPT-5.6 run small programs that coordinate tools and filter intermediate results. Stronger computer use lets it inspect and refine what it built. OpenAI's own examples include this playable sailing game and an interactive spirograph. These are not benchmark bars; they are rendered artifacts you can actually operate and evaluate.",
        criticalPhrases: ["Programmatic Tool Calling"]
      }
    ),
    paragraph(
      "a_hands_on",
      "Independent testing adds a useful reality check. CodeRabbit gave the models more than one hundred repository tasks across five programming languages. Sol passed 63.7 percent; Terra passed 40.7 percent. Terra also averaged far more output tokens per task. Their conclusion was not that Terra is bad. It was that cheaper tokens do not automatically mean a cheaper solved task. For long agent runs, follow-through can dominate list price.",
      28,
      ["claim_coderabbit_hands_on"]
    ),
    paragraph(
      "a_cost",
      "Axios highlighted the same problem from another angle. In Simon Willison's pelican test, an identical prompt cost anywhere from 0.71 cents to 48.55 cents depending on the model and effort setting. That is nearly a seventy-fold swing before you judge the result. The headline price table is only the starting point; your settings and the number of retries determine the bill.",
      25,
      ["claim_axios_cost_example"]
    ),
    paragraph(
      "a_caveat",
      "There are two boundaries to keep visible. First, OpenAI says its cost and latency comparisons are simulated estimates and real-world results may vary substantially. Second, the system card reports more cases of going beyond user intent than GPT-5.5 in agentic coding evaluations, although the absolute rates remained low. More capable agents make explicit permissions, checkpoints, and review more important, not less.",
      27,
      ["claim_benchmark_caveat", "claim_safety_overreach"]
    ),
    paragraph(
      "a_availability",
      "GPT-5.6 is available across ChatGPT, Codex, and the API. Per million API tokens, Luna is one dollar in and six out. Terra is two-fifty and fifteen. Sol is five and thirty. Those numbers are useful, but they do not choose the workflow for you. A short classification job and a multi-file implementation should not receive the same model, effort level, or supervision.",
      26,
      ["claim_availability", "claim_pricing", "claim_aimh_read"]
    ),
    paragraph(
      "a_takeaway",
      "The AIMH test is simple: give the same real task to Luna, Terra, and Sol. Track total cost, elapsed time, retries, and cleanup. Then compare the finished artifact, not just the first answer. GPT-5.6's real value will be decided by which tier reliably earns each kind of work.",
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
      "Outside tests keep the demo reel honest. CodeRabbit reports that Sol completed 63.7 percent of more than one hundred coding tasks, versus 40.7 percent for Terra, while Terra used more output tokens. Axios points to identical prompts costing from 0.71 cents to 48.55 cents as model and effort changed. Cheap tokens and cheap completed work are not the same thing.",
      25,
      ["claim_coderabbit_hands_on", "claim_axios_cost_example"]
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

const hero = () =>
  motion(
    "openai-top-hero",
    "video",
    "source/openai-hero-excerpt.mp4",
    "OpenAI · GPT-5.6 launch page hero",
    "OpenAI opens with work in the world",
    2
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
  { narrationId: "a_launch", beats: [hero()] },
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
        "axios-cost",
        "evidence/10-axios-cost-example.png",
        "Axios · Simon Willison comparison",
        "The same prompt, a radically different bill",
        { x: 0.07, y: 0.48, width: 0.86, height: 0.35 }
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
      hero(),
      motion(
        "chatgpt-work-launch",
        "video",
        "source/openai-launch.mp4",
        "OpenAI · ChatGPT Work launch clip",
        "From model picker to work system",
        2,
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
        "axios-compact",
        "evidence/10-axios-cost-example.png",
        "Axios · Simon Willison comparison",
        "Settings determine the bill",
        { x: 0.07, y: 0.48, width: 0.86, height: 0.35 }
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
