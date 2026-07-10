import type {
  GptLiveProduction,
  NarrationSpec,
  ProductionClaim,
  ProductionSource,
  SourceClipSpec,
  TimelineItem
} from "./types";

const invalidProduction = (detail: string): never => {
  throw new Error(`Invalid GPT-Live production: ${detail}`);
};

const assertUniqueIds = (label: string, values: readonly { readonly id: string }[]): void => {
  const ids = new Set<string>();

  for (const { id } of values) {
    if (ids.has(id)) {
      invalidProduction(`duplicate ${label} id "${id}"`);
    }
    ids.add(id);
  }
};

const assertNarrationClaimsResolve = (
  narration: readonly NarrationSpec[],
  claimIds: ReadonlySet<string>
): void => {
  for (const item of narration) {
    for (const claimId of item.claimIds) {
      if (!claimIds.has(claimId)) {
        invalidProduction(`narration "${item.id}" references unknown claim "${claimId}"`);
      }
    }
  }
};

export const validateGptLiveProduction = (production: GptLiveProduction): void => {
  assertUniqueIds("source", production.sources);
  assertUniqueIds("claim", production.claims);
  assertUniqueIds("narration", production.narration);
  assertUniqueIds("timeline", production.timeline);

  const sourceIds = new Set(production.sources.map(({ id }) => id));
  const claimIds = new Set(production.claims.map(({ id }) => id));

  for (const claim of production.claims) {
    for (const sourceId of claim.sourceIds) {
      if (!sourceIds.has(sourceId)) {
        invalidProduction(`claim "${claim.id}" references unknown source "${sourceId}"`);
      }
    }
  }

  assertNarrationClaimsResolve(production.narration, claimIds);

  const timelineNarration: NarrationSpec[] = [];
  for (const item of production.timeline) {
    if (item.kind === "source_clip") {
      if (!sourceIds.has(item.sourceId)) {
        invalidProduction(`source clip "${item.id}" references unknown source "${item.sourceId}"`);
      }
    } else {
      timelineNarration.push(item);
    }
  }
  assertNarrationClaimsResolve(timelineNarration, claimIds);
};

const deepFreeze = <T>(value: T): T => {
  if (value === null || typeof value !== "object" || Object.isFrozen(value)) {
    return value;
  }

  for (const nestedValue of Object.values(value)) {
    deepFreeze(nestedValue);
  }

  return Object.freeze(value);
};

const GPT_LIVE_SOURCES = [
  {
    id: "src_openai_article",
    title: "Introducing GPT-Live",
    url: "https://openai.com/index/introducing-gpt-live/",
    publisher: "OpenAI",
    accessedAt: "2026-07-10"
  },
  {
    id: "src_openai_help",
    title: "ChatGPT Voice",
    url: "https://help.openai.com/en/articles/20001274/",
    publisher: "OpenAI Help Center",
    accessedAt: "2026-07-10"
  },
  {
    id: "src_openai_realtime",
    title: "Advancing voice intelligence with new models in the API",
    url: "https://openai.com/index/advancing-voice-intelligence-with-new-models-in-the-api/",
    publisher: "OpenAI",
    accessedAt: "2026-07-10"
  },
  {
    id: "src_toms_guide",
    title: "I used ChatGPT's new voice mode to translate the World Cup in real time",
    url: "https://www.tomsguide.com/ai/i-used-chatgpts-new-voice-mode-to-translate-the-world-cup-in-real-time-heres-what-happened",
    publisher: "Tom's Guide",
    accessedAt: "2026-07-10"
  }
] as const satisfies readonly ProductionSource[];

const GPT_LIVE_CLAIMS = [
  {
    id: "claim_full_duplex",
    text: "GPT-Live can listen and speak at the same time.",
    sourceIds: ["src_openai_article", "src_openai_help"]
  },
  {
    id: "claim_translation",
    text: "GPT-Live can perform live translation.",
    sourceIds: ["src_openai_article", "src_toms_guide"]
  },
  {
    id: "claim_world_cup",
    text: "Tom's Guide reported continuous English interpretation over rapid Spanish World Cup commentary.",
    sourceIds: ["src_toms_guide"]
  },
  {
    id: "claim_delegation",
    text: "GPT-Live can keep the conversation moving while deeper work runs in the background.",
    sourceIds: ["src_openai_article"]
  },
  {
    id: "claim_visuals",
    text: "Voice can show visual results for weather, sports, maps, stocks, and more.",
    sourceIds: ["src_openai_article", "src_openai_help"]
  },
  {
    id: "claim_benchmark",
    text: "OpenAI reports that GPT-Live-1 substantially outperforms Advanced Voice Mode on GPQA.",
    sourceIds: ["src_openai_article"]
  },
  {
    id: "claim_access",
    text: "Paid consumer plans use GPT-Live-1 and Free uses GPT-Live-1 mini.",
    sourceIds: ["src_openai_help"]
  },
  {
    id: "claim_limits",
    text: "Live initially excludes video, screen sharing, connected apps, plugins, and several ChatGPT surfaces.",
    sourceIds: ["src_openai_help"]
  },
  {
    id: "claim_direction",
    text: "Related realtime voice work points toward voice-to-action, systems-to-voice, and voice-to-voice products.",
    sourceIds: ["src_openai_realtime"]
  },
  {
    id: "claim_api_soon",
    text: "OpenAI plans to bring GPT-Live models to the API.",
    sourceIds: ["src_openai_article"]
  }
] as const satisfies readonly ProductionClaim[];

const NARRATION_HOOK = {
  id: "narration_hook",
  kind: "narration",
  text: "That was not a prepared translation. ChatGPT was listening in French and speaking in English almost at the same time. And that is only one thing GPT-Live suddenly makes possible.",
  claimIds: ["claim_translation"],
  scene: "hook"
} as const satisfies NarrationSpec;

const NARRATION_FULL_DUPLEX = {
  id: "narration_full_duplex",
  kind: "narration",
  text: "The important phrase is full duplex. Old voice assistants worked like a walkie-talkie: you spoke, stopped, waited, and then the machine answered. GPT-Live works more like a phone call. It can keep listening while it talks, so you can interrupt, correct yourself, change direction, or pause to think without restarting the conversation.",
  claimIds: ["claim_full_duplex"],
  scene: "full_duplex"
} as const satisfies NarrationSpec;

const NARRATION_USE_CASES = {
  id: "narration_use_cases",
  kind: "narration",
  text: "That enables much more than smoother small talk. You can translate a conversation while it happens, practice a language through fast role-play, talk through a messy idea without being cut off, or add another request while ChatGPT is already searching. It can keep the conversation moving, bring back harder answers from a stronger model, and show visual cards when weather, maps, sports, or stocks are easier to understand on screen.",
  claimIds: ["claim_translation", "claim_delegation", "claim_visuals"],
  scene: "use_cases"
} as const satisfies NarrationSpec;

const NARRATION_EVIDENCE = {
  id: "narration_evidence",
  kind: "narration",
  text: "This is already moving beyond staged demos. Tom's Guide played rapid Spanish World Cup commentary and reported that GPT-Live delivered a continuous English interpretation over the broadcast. OpenAI's own tests also show a large jump in expert science reasoning, although those remain vendor-reported results.",
  claimIds: ["claim_world_cup", "claim_benchmark"],
  scene: "evidence"
} as const satisfies NarrationSpec;

const NARRATION_AVAILABILITY = {
  id: "narration_availability",
  kind: "narration",
  text: "You can try it now in ChatGPT Voice on consumer web and mobile. Free accounts get GPT-Live-1 mini. Go, Plus, and Pro get GPT-Live-1. Look under Settings, then Voice, for Live. It is still a launch product: no Live video or screen sharing yet, no connected apps or plugins, and some ChatGPT workspaces and tools are not supported.",
  claimIds: ["claim_access", "claim_limits"],
  scene: "availability"
} as const satisfies NarrationSpec;

const NARRATION_FUTURE = {
  id: "narration_future",
  kind: "narration",
  text: "Where this gets interesting is what comes next: voice that can take action, software that speaks useful context before you ask, and conversations that cross languages without stopping. OpenAI says GPT-Live is coming to the API, while its related realtime tools already point toward travel changes, scheduling, customer support, and multilingual work.",
  claimIds: ["claim_direction", "claim_api_soon"],
  scene: "future"
} as const satisfies NarrationSpec;

const NARRATION_CTA = {
  id: "narration_cta",
  kind: "narration",
  text: "The breakthrough is not that ChatGPT sounds more human. It is that you no longer have to speak like a machine to use it. Try one real task in Voice: translate a conversation, talk through a messy problem, or interrupt it halfway through an answer. In the comments, tell me what GPT-Live enabled for you, or what you think it is going to enable for you.",
  claimIds: ["claim_full_duplex"],
  scene: "cta"
} as const satisfies NarrationSpec;

const GPT_LIVE_NARRATION = [
  NARRATION_HOOK,
  NARRATION_FULL_DUPLEX,
  NARRATION_USE_CASES,
  NARRATION_EVIDENCE,
  NARRATION_AVAILABILITY,
  NARRATION_FUTURE,
  NARRATION_CTA
] as const satisfies readonly NarrationSpec[];

const CLIP_TRANSLATION = {
  id: "clip_translation",
  kind: "source_clip",
  playerConfigUrl: "https://player.vimeo.com/video/1208096618/config?h=c7dd7ef278",
  startSeconds: 50.82,
  endSeconds: 63.17,
  sourceId: "src_openai_article"
} as const satisfies SourceClipSpec;

const CLIP_INTERRUPTION = {
  id: "clip_interruption",
  kind: "source_clip",
  playerConfigUrl: "https://player.vimeo.com/video/1208152658/config?h=c944a411bd",
  startSeconds: 31.96,
  endSeconds: 43.92,
  sourceId: "src_openai_article"
} as const satisfies SourceClipSpec;

export const GPT_LIVE_TIMELINE = deepFreeze([
  CLIP_TRANSLATION,
  NARRATION_HOOK,
  CLIP_INTERRUPTION,
  NARRATION_FULL_DUPLEX,
  NARRATION_USE_CASES,
  NARRATION_EVIDENCE,
  NARRATION_AVAILABILITY,
  NARRATION_FUTURE,
  NARRATION_CTA
] as const satisfies readonly TimelineItem[]);

const GPT_LIVE_CONTENT_MANIFEST = {
  id: "2026-07-10-gpt-live-tella-ab",
  variants: ["dynamic_editorial", "aimh_visual_host"],
  sources: GPT_LIVE_SOURCES,
  claims: GPT_LIVE_CLAIMS,
  narration: GPT_LIVE_NARRATION,
  timeline: GPT_LIVE_TIMELINE,
  branding: {
    logoPath: "/Users/dennywii/Documents/dev/aimh-video-engine/assets/logo.png",
    width: 150,
    marginTop: 24,
    marginRight: 24,
    opacity: 0.85
  },
  musicPath: "/Users/dennywii/Documents/dev/aimh-video-engine/assets/music/Body_Komorebi_Futuremono.mp3"
} as const satisfies GptLiveProduction;

validateGptLiveProduction(GPT_LIVE_CONTENT_MANIFEST);

export const GPT_LIVE_CONTENT = deepFreeze(GPT_LIVE_CONTENT_MANIFEST);
