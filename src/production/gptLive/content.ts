import type {
  EvidenceSpec,
  GptLiveProduction,
  GptLiveVisualContent,
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
    if (item.claimIds.length === 0) {
      invalidProduction(`narration "${item.id}" must reference at least one claim`);
    }
    for (const claimId of item.claimIds) {
      if (!claimIds.has(claimId)) {
        invalidProduction(`narration "${item.id}" references unknown claim "${claimId}"`);
      }
    }
  }
};

const narrationExactlyMatches = (timelineItem: NarrationSpec, canonical: NarrationSpec): boolean =>
  timelineItem.id === canonical.id &&
  timelineItem.kind === canonical.kind &&
  timelineItem.text === canonical.text &&
  timelineItem.scene === canonical.scene &&
  timelineItem.claimIds.length === canonical.claimIds.length &&
  timelineItem.claimIds.every((claimId, index) => claimId === canonical.claimIds[index]);

const normalizeHostname = (hostname: string): string =>
  hostname.toLowerCase().replace(/\.+$/, "");

const isRelativeAssetBelow = (assetPath: string, directory: string): boolean => {
  if (
    !assetPath ||
    assetPath.includes("\\") ||
    assetPath.startsWith("/") ||
    /^[A-Za-z]:[\\/]/.test(assetPath)
  ) {
    return false;
  }
  const segments = assetPath.split("/");
  return (
    segments[0] === directory &&
    segments.length > 1 &&
    segments.every((segment) => segment.length > 0 && segment !== "." && segment !== "..")
  );
};

const assertEvidenceIsValid = (
  evidence: EvidenceSpec,
  sources: ReadonlyMap<string, ProductionSource>,
  narrationScenes: ReadonlySet<string>
): void => {
  const source =
    sources.get(evidence.sourceId) ??
    invalidProduction(`evidence "${evidence.id}" references unknown source "${evidence.sourceId}"`);

  if (evidence.canonicalUrl !== source.url) {
    invalidProduction(`evidence "${evidence.id}" canonical URL does not match source "${source.id}"`);
  }
  if (evidence.publisher !== source.publisher) {
    invalidProduction(`evidence "${evidence.id}" publisher does not match source "${source.id}"`);
  }
  const canonicalUrl = (() => {
    try {
      return new URL(evidence.canonicalUrl);
    } catch {
      return invalidProduction(
        `evidence "${evidence.id}" canonical URL must be a valid HTTPS URL`
      );
    }
  })();
  if (canonicalUrl.protocol !== "https:") {
    invalidProduction(`evidence "${evidence.id}" canonical URL must be a valid HTTPS URL`);
  }
  if (evidence.mediaUrl !== undefined) {
    const mediaUrl = (() => {
      try {
        return new URL(evidence.mediaUrl);
      } catch {
        return invalidProduction(`evidence "${evidence.id}" media URL must be a valid HTTPS URL`);
      }
    })();
    if (mediaUrl.protocol !== "https:") {
      invalidProduction(`evidence "${evidence.id}" media URL must be a valid HTTPS URL`);
    }
    if (normalizeHostname(mediaUrl.hostname) !== normalizeHostname(canonicalUrl.hostname)) {
      invalidProduction(`evidence "${evidence.id}" media URL must use the source publisher domain`);
    }
  }

  const requiredAssetDirectory =
    evidence.playbackDecision === "captured_source" ? "evidence" : "source";
  if (!isRelativeAssetBelow(evidence.assetPath, requiredAssetDirectory)) {
    invalidProduction(
      `evidence "${evidence.id}" asset path must be relative and below ${requiredAssetDirectory}/`
    );
  }

  const focalRect = evidence.focalRect;
  for (const name of ["x", "y", "width", "height"] as const) {
    const value = focalRect?.[name];
    if (typeof value !== "number" || !Number.isFinite(value) || value < 0 || value > 1) {
      invalidProduction(`evidence "${evidence.id}" focal ${name} must be finite and within 0..1`);
    }
  }
  if (focalRect.x + focalRect.width > 1) {
    invalidProduction(`evidence "${evidence.id}" focal x + width must not exceed 1`);
  }
  if (focalRect.y + focalRect.height > 1) {
    invalidProduction(`evidence "${evidence.id}" focal y + height must not exceed 1`);
  }
  if (!narrationScenes.has(evidence.scene)) {
    invalidProduction(`evidence "${evidence.id}" references unknown narration scene "${evidence.scene}"`);
  }
};

export const validateProductionManifest = (production: GptLiveProduction): void => {
  assertUniqueIds("source", production.sources);
  assertUniqueIds("claim", production.claims);
  assertUniqueIds("narration", production.narration);
  assertUniqueIds("evidence", production.evidence);

  const sourceIds = new Set(production.sources.map(({ id }) => id));
  const sources = new Map(production.sources.map((source) => [source.id, source]));
  const claimIds = new Set(production.claims.map(({ id }) => id));
  const narrationScenes = new Set(production.narration.map(({ scene }) => scene));

  for (const claim of production.claims) {
    if (claim.sourceIds.length === 0) {
      invalidProduction(`claim "${claim.id}" must reference at least one source`);
    }
    for (const sourceId of claim.sourceIds) {
      if (!sourceIds.has(sourceId)) {
        invalidProduction(`claim "${claim.id}" references unknown source "${sourceId}"`);
      }
    }
  }

  assertNarrationClaimsResolve(production.narration, claimIds);
  for (const evidence of production.evidence) {
    assertEvidenceIsValid(evidence, sources, narrationScenes);
  }

  const canonicalNarration = new Map(production.narration.map((item) => [item.id, item]));
  const narrationOccurrences = new Map(production.narration.map((item) => [item.id, 0]));

  for (const item of production.timeline) {
    if (item.kind === "source_clip") {
      if (!sourceIds.has(item.sourceId)) {
        invalidProduction(`source clip "${item.id}" references unknown source "${item.sourceId}"`);
      }
    } else {
      const canonical =
        canonicalNarration.get(item.id) ??
        invalidProduction(`timeline narration "${item.id}" is not declared in canonical narration`);
      narrationOccurrences.set(item.id, narrationOccurrences.get(item.id)! + 1);
      if (!narrationExactlyMatches(item, canonical)) {
        invalidProduction(`timeline narration "${item.id}" does not exactly match canonical narration`);
      }
    }
  }

  for (const narration of production.narration) {
    const occurrences = narrationOccurrences.get(narration.id)!;
    if (occurrences !== 1) {
      invalidProduction(
        `canonical narration "${narration.id}" must appear exactly once in timeline; found ${occurrences}`
      );
    }
  }

  assertUniqueIds("timeline", production.timeline);
};

export const validateGptLiveProduction = validateProductionManifest;

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
  text: "Tom's Guide played rapid Spanish World Cup commentary and reported that GPT-Live delivered a continuous English interpretation over the broadcast. OpenAI's own tests also show a large jump in expert science reasoning, although those remain vendor-reported results.",
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

const visualNarration = (narration: NarrationSpec, sourceLabels: readonly string[]) => ({
  narrationId: narration.id,
  narrationText: narration.text,
  claimIds: narration.claimIds,
  sourceLabels
});

export const GPT_LIVE_VISUAL_CONTENT = deepFreeze({
  hook: {
    scene: "hook",
    sectionNumber: "01",
    header: "LIVE TRANSLATION",
    headline: "LISTENING IN FRENCH / SPEAKING IN ENGLISH",
    listeningLabel: "LISTENING",
    listeningValue: "IN FRENCH",
    speakingLabel: "SPEAKING",
    speakingValue: "IN ENGLISH",
    inputLabel: "LIVE INPUT",
    simultaneousLabel: "AT THE SAME TIME",
    ...visualNarration(NARRATION_HOOK, ["OPENAI", "CHATGPT VOICE"])
  },
  full_duplex: {
    scene: "full_duplex",
    sectionNumber: "02",
    header: "FULL DUPLEX",
    headline: "LISTENING AND SPEAKING CAN OVERLAP.",
    legacyLabel: "OLD / WALKIE-TALKIE QUEUE",
    legacySteps: ["YOU SPEAK", "WAIT", "MODEL SPEAKS"],
    concurrentLabel: "NOW / CONCURRENT TRACKS",
    tracks: ["LISTEN", "SPEAK"],
    interruptionLabel: "INTERRUPTION ACCEPTED / COURSE CORRECTED",
    ...visualNarration(NARRATION_FULL_DUPLEX, ["OPENAI", "CHATGPT VOICE"])
  },
  use_cases: {
    scene: "use_cases",
    sectionNumber: "03",
    header: "SIX THINGS TO TRY",
    headline: "SIX FAST REVEALS",
    progressLabel: "FAST REVEAL",
    items: [
      { number: "01", label: "LIVE TRANSLATION", detail: "Language shifts without stopping." },
      { number: "02", label: "LANGUAGE ROLE-PLAY", detail: "Practice the exchange, not the prompt." },
      { number: "03", label: "MESSY IDEA", detail: "Think aloud before the structure exists." },
      { number: "04", label: "INTERRUPT + SEARCH", detail: "Correct course and follow the thread." },
      { number: "05", label: "VISUAL CARDS", detail: "Voice can surface something you can see." },
      { number: "06", label: "DEEPER WORK", detail: "Keep talking while background work runs." }
    ],
    ...visualNarration(NARRATION_USE_CASES, ["OPENAI PRODUCT MATERIALS"])
  },
  evidence: {
    scene: "evidence",
    sectionNumber: "04",
    header: "REPORTED EVIDENCE",
    headline: "REPORTED EVIDENCE",
    worldCupAttribution: "TOM'S GUIDE REPORTED",
    worldCupHeadline: "CONTINUOUS ENGLISH INTERPRETATION",
    worldCupDetail: "Over rapid Spanish World Cup commentary in the publication's hands-on test.",
    benchmarkAttribution: "OPENAI-REPORTED / VENDOR-REPORTED",
    benchmarkComparison: "GPT-LIVE-1 VS ADVANCED VOICE MODE",
    benchmarkName: "ON GPQA",
    benchmarkStatement:
      "OpenAI reports GPT-Live-1 substantially outperforms Advanced Voice Mode on GPQA.",
    qualification: "Not independent validation.",
    ...visualNarration(NARRATION_EVIDENCE, ["TOM'S GUIDE", "OPENAI'S OWN GPQA TESTS"])
  },
  availability: {
    scene: "availability",
    sectionNumber: "05",
    header: "AVAILABILITY",
    headline: "TRY IT NOW IN CHATGPT VOICE",
    tiers: [
      { label: "FREE", value: "GPT-LIVE-1 MINI" },
      { label: "GO / PLUS / PRO", value: "GPT-LIVE-1" },
      { label: "WHERE", value: "SETTINGS > VOICE > LIVE" }
    ],
    limitsLabel: "LAUNCH LIMITS",
    limits: [
      "NO LIVE VIDEO OR SCREEN SHARE",
      "NO CONNECTED APPS OR PLUGINS",
      "SOME WORKSPACES + TOOLS UNSUPPORTED"
    ],
    ...visualNarration(NARRATION_AVAILABILITY, ["OPENAI HELP CENTER"])
  },
  future: {
    scene: "future",
    sectionNumber: "06",
    header: "WHAT COMES NEXT",
    headline: "VOICE AND SYSTEMS MOVE BOTH WAYS",
    flows: [
      { from: "VOICE", to: "ACTION" },
      { from: "SYSTEMS", to: "VOICE" },
      { from: "VOICE", to: "VOICE" }
    ],
    summary: "ACTIONS, PROACTIVE CONTEXT, AND CROSS-LANGUAGE CONVERSATION WITHOUT STOPPING.",
    ...visualNarration(NARRATION_FUTURE, ["OPENAI", "OPENAI REALTIME"])
  },
  cta: {
    scene: "cta",
    sectionNumber: "07",
    header: "THE TAKEAWAY",
    headline: "YOU NO LONGER HAVE TO SPEAK LIKE A MACHINE.",
    prompts: [
      "TRANSLATE A CONVERSATION",
      "TALK THROUGH A MESSY PROBLEM",
      "INTERRUPT MID-ANSWER"
    ],
    audiencePrompt: "WHAT DID GPT-LIVE ENABLE FOR YOU — OR WHAT DO YOU THINK IT WILL ENABLE?",
    ...visualNarration(NARRATION_CTA, ["OPENAI", "CHATGPT VOICE"])
  }
} as const satisfies GptLiveVisualContent);

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

const GPT_LIVE_EVIDENCE = [
  {
    id: "evidence_translation_video",
    scene: "hook",
    sourceId: "src_openai_article",
    assetPath: "source/clip_translation.mp4",
    canonicalUrl: "https://openai.com/index/introducing-gpt-live/",
    mediaUrl: "https://openai.com/index/introducing-gpt-live/?video=1208096618",
    displayUrl: "OPENAI.COM / GPT-LIVE",
    publisher: "OpenAI",
    sourceType: "primary",
    playbackDecision: "full_screen_original_audio",
    placement: "left",
    takeaway: "Live translation without waiting for turns.",
    detail: "Official GPT-Live demonstration.",
    focalRect: { x: 0, y: 0, width: 1, height: 1 },
    youtubeDescription: true
  },
  {
    id: "evidence_interruption_video",
    scene: "full_duplex",
    sourceId: "src_openai_article",
    assetPath: "source/clip_interruption.mp4",
    canonicalUrl: "https://openai.com/index/introducing-gpt-live/",
    mediaUrl: "https://openai.com/index/introducing-gpt-live/?video=1208152658",
    displayUrl: "OPENAI.COM / GPT-LIVE",
    publisher: "OpenAI",
    sourceType: "primary",
    playbackDecision: "full_screen_original_audio",
    placement: "left",
    takeaway: "Interrupt and redirect without restarting.",
    detail: "Official GPT-Live demonstration.",
    focalRect: { x: 0, y: 0, width: 1, height: 1 },
    youtubeDescription: true
  },
  {
    id: "evidence_openai_full_duplex",
    scene: "full_duplex",
    sourceId: "src_openai_article",
    assetPath: "evidence/openai-gpt-live-full-duplex.png",
    canonicalUrl: "https://openai.com/index/introducing-gpt-live/",
    displayUrl: "OPENAI.COM / GPT-LIVE",
    publisher: "OpenAI",
    sourceType: "primary",
    playbackDecision: "captured_source",
    placement: "left",
    takeaway: "Listen and speak at the same time.",
    detail: "This is why GPT-Live feels like a call instead of a walkie-talkie.",
    focalRect: { x: 0.18, y: 0.18, width: 0.64, height: 0.34 },
    youtubeDescription: true
  },
  {
    id: "evidence_toms_guide_translation",
    scene: "evidence",
    sourceId: "src_toms_guide",
    assetPath: "evidence/toms-guide-world-cup-translation.png",
    canonicalUrl:
      "https://www.tomsguide.com/ai/i-used-chatgpts-new-voice-mode-to-translate-the-world-cup-in-real-time-heres-what-happened",
    displayUrl: "TOMSGUIDE.COM / AI",
    publisher: "Tom's Guide",
    sourceType: "reporting",
    playbackDecision: "captured_source",
    placement: "right",
    takeaway: "A live broadcast became continuous interpretation.",
    detail: "Tom's Guide reported English interpretation over rapid Spanish commentary.",
    focalRect: { x: 0.08, y: 0.22, width: 0.78, height: 0.46 },
    youtubeDescription: true
  },
  {
    id: "evidence_openai_availability",
    scene: "availability",
    sourceId: "src_openai_help",
    assetPath: "evidence/openai-chatgpt-voice-availability.png",
    canonicalUrl: "https://help.openai.com/en/articles/20001274/",
    displayUrl: "HELP.OPENAI.COM / CHATGPT VOICE",
    publisher: "OpenAI Help Center",
    sourceType: "primary",
    playbackDecision: "captured_source",
    placement: "left",
    takeaway: "Free gets mini. Paid plans get GPT-Live-1.",
    detail: "Launch access and limitations remain visible beside the explanation.",
    focalRect: { x: 0.12, y: 0.18, width: 0.76, height: 0.5 },
    youtubeDescription: true
  },
  {
    id: "evidence_openai_realtime",
    scene: "future",
    sourceId: "src_openai_realtime",
    assetPath: "evidence/openai-realtime-future.png",
    canonicalUrl:
      "https://openai.com/index/advancing-voice-intelligence-with-new-models-in-the-api/",
    displayUrl: "OPENAI.COM / REALTIME",
    publisher: "OpenAI",
    sourceType: "primary",
    playbackDecision: "captured_source",
    placement: "right",
    takeaway: "Voice becomes an interface for action.",
    detail:
      "Realtime tools point toward scheduling, support, travel changes, and multilingual work.",
    focalRect: { x: 0.08, y: 0.2, width: 0.82, height: 0.48 },
    youtubeDescription: true
  }
] as const satisfies readonly EvidenceSpec[];

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
  evidence: GPT_LIVE_EVIDENCE,
  audio: {
    introMusic: false,
    bodyMusic: false,
    outroMusicPath:
      "/Users/dennywii/Documents/dev/aimh-video-engine/assets/music/Outro_Much_Higher_Causmic.mp3",
    outroDurationSeconds: 7
  },
  branding: {
    logoPath: "/Users/dennywii/Documents/dev/aimh-video-engine/assets/logo.png",
    width: 150,
    marginTop: 24,
    marginRight: 24,
    opacity: 0.85
  }
} as const satisfies GptLiveProduction;

validateProductionManifest(GPT_LIVE_CONTENT_MANIFEST);

export const GPT_LIVE_CONTENT = deepFreeze(GPT_LIVE_CONTENT_MANIFEST);
