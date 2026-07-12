import { createHash } from "node:crypto";
import {
  lstat as fsLstat,
  mkdir,
  mkdtemp,
  readFile,
  readdir,
  rename,
  rm,
  stat as fsStat,
  symlink,
  writeFile
} from "node:fs/promises";
import { tmpdir } from "node:os";
import { basename, join, resolve } from "node:path";
import { describe, expect, it, vi } from "vitest";
import { DEFAULT_ENV_KEYS, loadEnvSnapshot } from "../src/config/env";
import * as contentModule from "../src/production/gptLive/content";
import { formatGptLiveCliResult, runGptLiveCli } from "../src/production/gptLive/cli";
import {
  evidenceForScene,
  resolveEvidenceAssetPath,
  stageEvidencePublicAssets,
  validateEvidenceAssets
} from "../src/production/gptLive/evidence";
import {
  assertNarrationSlateContract,
  buildFfprobeMediaArgs,
  parseFfprobeMediaJson,
  type MediaInspection
} from "../src/production/gptLive/mediaInspection";
import {
  buildNarrationSlateArgs,
  prepareGptLiveProduction
} from "../src/production/gptLive/prepare";
import * as prepareModule from "../src/production/gptLive/prepare";
import { validateSerializedQaPaths } from "../src/production/gptLive/qa/paths";
import type { QaProduction, QaVoice } from "../src/production/gptLive/qa/types";
import { buildTellaPlan } from "../src/production/gptLive/tellaPlan";
import type {
  EvidenceSpec,
  GptLiveProduction,
  SourceClipSpec
} from "../src/production/gptLive/types";

const { GPT_LIVE_CONTENT, GPT_LIVE_TIMELINE, validateProductionManifest } = contentModule;

const CAPTURED_EVIDENCE = GPT_LIVE_CONTENT.evidence.filter(
  (item) => item.playbackDecision === "captured_source"
);
const VALID_PNG = Buffer.from(
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=",
  "base64"
);

const materializeEvidenceFixtures = async (episodeDir: string): Promise<void> => {
  await mkdir(join(episodeDir, "evidence"), { recursive: true });
  await Promise.all(
    CAPTURED_EVIDENCE.map((evidence) =>
      writeFile(resolveEvidenceAssetPath(episodeDir, evidence), VALID_PNG)
    )
  );
};

const EXPECTED_SOURCES = [
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
] as const;

const EXPECTED_CLAIMS = [
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
] as const;

const EXPECTED_NARRATION = [
  {
    id: "narration_hook",
    kind: "narration",
    text: "That was not a prepared translation. ChatGPT was listening in French and speaking in English almost at the same time. And that is only one thing GPT-Live suddenly makes possible.",
    claimIds: ["claim_translation"],
    scene: "hook"
  },
  {
    id: "narration_full_duplex",
    kind: "narration",
    text: "The important phrase is full duplex. Old voice assistants worked like a walkie-talkie: you spoke, stopped, waited, and then the machine answered. GPT-Live works more like a phone call. It can keep listening while it talks, so you can interrupt, correct yourself, change direction, or pause to think without restarting the conversation.",
    claimIds: ["claim_full_duplex"],
    scene: "full_duplex"
  },
  {
    id: "narration_use_cases",
    kind: "narration",
    text: "That enables much more than smoother small talk. You can translate a conversation while it happens, practice a language through fast role-play, talk through a messy idea without being cut off, or add another request while ChatGPT is already searching. It can keep the conversation moving, bring back harder answers from a stronger model, and show visual cards when weather, maps, sports, or stocks are easier to understand on screen.",
    claimIds: ["claim_translation", "claim_delegation", "claim_visuals"],
    scene: "use_cases"
  },
  {
    id: "narration_evidence",
    kind: "narration",
    text: "Tom's Guide played rapid Spanish World Cup commentary and reported that GPT-Live delivered a continuous English interpretation over the broadcast. OpenAI's own tests also show a large jump in expert science reasoning, although those remain vendor-reported results.",
    claimIds: ["claim_world_cup", "claim_benchmark"],
    scene: "evidence"
  },
  {
    id: "narration_availability",
    kind: "narration",
    text: "You can try it now in ChatGPT Voice on consumer web and mobile. Free accounts get GPT-Live-1 mini. Go, Plus, and Pro get GPT-Live-1. Look under Settings, then Voice, for Live. It is still a launch product: no Live video or screen sharing yet, no connected apps or plugins, and some ChatGPT workspaces and tools are not supported.",
    claimIds: ["claim_access", "claim_limits"],
    scene: "availability"
  },
  {
    id: "narration_future",
    kind: "narration",
    text: "Where this gets interesting is what comes next: voice that can take action, software that speaks useful context before you ask, and conversations that cross languages without stopping. OpenAI says GPT-Live is coming to the API, while its related realtime tools already point toward travel changes, scheduling, customer support, and multilingual work.",
    claimIds: ["claim_direction", "claim_api_soon"],
    scene: "future"
  },
  {
    id: "narration_cta",
    kind: "narration",
    text: "The breakthrough is not that ChatGPT sounds more human. It is that you no longer have to speak like a machine to use it. Try one real task in Voice: translate a conversation, talk through a messy problem, or interrupt it halfway through an answer. In the comments, tell me what GPT-Live enabled for you, or what you think it is going to enable for you.",
    claimIds: ["claim_full_duplex"],
    scene: "cta"
  }
] as const;

const visualNarration = (index: number, sourceLabels: readonly string[]) => ({
  narrationId: EXPECTED_NARRATION[index]!.id,
  narrationText: EXPECTED_NARRATION[index]!.text,
  claimIds: EXPECTED_NARRATION[index]!.claimIds,
  sourceLabels
});

const EXPECTED_VISUAL_CONTENT = {
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
    ...visualNarration(0, ["OPENAI", "CHATGPT VOICE"])
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
    ...visualNarration(1, ["OPENAI", "CHATGPT VOICE"])
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
    ...visualNarration(2, ["OPENAI PRODUCT MATERIALS"])
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
    ...visualNarration(3, ["TOM'S GUIDE", "OPENAI'S OWN GPQA TESTS"])
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
    ...visualNarration(4, ["OPENAI HELP CENTER"])
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
    ...visualNarration(5, ["OPENAI", "OPENAI REALTIME"])
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
    ...visualNarration(6, ["OPENAI", "CHATGPT VOICE"])
  }
} as const;

const EXPECTED_SOURCE_CLIPS = [
  {
    id: "clip_translation",
    kind: "source_clip",
    playerConfigUrl: "https://player.vimeo.com/video/1208096618/config?h=c7dd7ef278",
    startSeconds: 50.82,
    endSeconds: 63.17,
    sourceId: "src_openai_article"
  },
  {
    id: "clip_interruption",
    kind: "source_clip",
    playerConfigUrl: "https://player.vimeo.com/video/1208152658/config?h=c944a411bd",
    startSeconds: 31.96,
    endSeconds: 43.92,
    sourceId: "src_openai_article"
  }
] as const;

const EXPECTED_EVIDENCE = [
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
    focalRect: { x: 0.26, y: 0.39, width: 0.48, height: 0.22 },
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
    focalRect: { x: 0.25, y: 0.78, width: 0.34, height: 0.14 },
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
    focalRect: { x: 0.11, y: 0.88, width: 0.58, height: 0.1 },
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
    focalRect: { x: 0.35, y: 0.61, width: 0.45, height: 0.2 },
    youtubeDescription: true
  }
] as const;

const EXPECTED_AUDIO = {
  introMusic: false,
  bodyMusic: false,
  outroMusicPath:
    "/Users/dennywii/Documents/dev/aimh-video-engine/assets/music/Outro_Much_Higher_Causmic.mp3",
  outroDurationSeconds: 7
} as const;

const unique = <T>(values: readonly T[]): T[] => [...new Set(values)];

const EXPECTED_SOURCE_MANIFEST = {
  schemaVersion: "0.1.0",
  productionId: "2026-07-10-gpt-live-tella-ab",
  sources: EXPECTED_SOURCES.map((source) => {
    const evidence = EXPECTED_EVIDENCE.filter((item) => item.sourceId === source.id);
    const mediaUrls = unique(evidence.flatMap((item) => "mediaUrl" in item ? [item.mediaUrl] : []));
    return {
      sourceId: source.id,
      publisher: source.publisher,
      title: source.title,
      canonicalUrl: source.url,
      mediaUrls,
      scenes: unique(evidence.map((item) => item.scene)),
      claims: EXPECTED_CLAIMS.filter((claim) =>
        claim.sourceIds.some((sourceId) => sourceId === source.id)
      ).map(
        (claim) => claim.id
      ),
      onScreenAttribution: unique(evidence.map((item) => item.displayUrl)),
      playbackDecisions: unique(evidence.map((item) => item.playbackDecision)),
      youtubeDescription: evidence.length > 0
    };
  })
} as const;

const cloneProduction = (): GptLiveProduction => structuredClone(GPT_LIVE_CONTENT);

const replaceEvidence = (
  production: GptLiveProduction,
  index: number,
  changes: Record<string, unknown>
): GptLiveProduction => ({
  ...production,
  evidence: production.evidence.map((item, itemIndex) =>
    itemIndex === index ? { ...item, ...changes } : item
  ) as GptLiveProduction["evidence"]
});

const EPISODE_DIR = "/tmp/gpt-live-episode";
const narrationAssets = GPT_LIVE_CONTENT.narration.map((item, index) => ({
  id: item.id,
  audioPath: join(EPISODE_DIR, "voice", `${item.id}.mp3`),
  durationSeconds: 10 + index / 10
}));

describe("GPT-Live source manifest", () => {
  it("builds exactly one deterministic attribution entry per canonical production source", () => {
    const buildSourceManifest = (
      prepareModule as typeof prepareModule & { buildSourceManifest?: () => unknown }
    ).buildSourceManifest;

    expect(buildSourceManifest).toBeTypeOf("function");
    expect(buildSourceManifest!()).toEqual(EXPECTED_SOURCE_MANIFEST);
    expect(EXPECTED_SOURCE_MANIFEST.sources[0]).toEqual({
      sourceId: "src_openai_article",
      publisher: "OpenAI",
      title: "Introducing GPT-Live",
      canonicalUrl: "https://openai.com/index/introducing-gpt-live/",
      mediaUrls: [
        "https://openai.com/index/introducing-gpt-live/?video=1208096618",
        "https://openai.com/index/introducing-gpt-live/?video=1208152658"
      ],
      scenes: ["hook", "full_duplex"],
      claims: [
        "claim_full_duplex",
        "claim_translation",
        "claim_delegation",
        "claim_visuals",
        "claim_benchmark",
        "claim_api_soon"
      ],
      onScreenAttribution: ["OPENAI.COM / GPT-LIVE"],
      playbackDecisions: ["full_screen_original_audio", "captured_source"],
      youtubeDescription: true
    });
    expect(EXPECTED_SOURCE_MANIFEST.sources[1]).toMatchObject({
      sourceId: "src_openai_help",
      mediaUrls: []
    });
    expect(new Set(EXPECTED_SOURCE_MANIFEST.sources.map(({ sourceId }) => sourceId)).size).toBe(
      GPT_LIVE_CONTENT.sources.length
    );
  });
});

describe("GPT-Live Tella plan", () => {
  it("preserves the exact nine-item timeline order and kinds", () => {
    const plan = buildTellaPlan({ episodeDir: EPISODE_DIR, narrationAssets });

    expect(plan.clips.map(({ id }) => id)).toEqual(GPT_LIVE_CONTENT.timeline.map(({ id }) => id));
    expect(plan.clips.map(({ kind }) => kind)).toEqual(
      GPT_LIVE_CONTENT.timeline.map(({ kind }) => kind)
    );
    expect(plan.clips).toHaveLength(9);
  });

  it("preserves original audio for source clips", () => {
    const plan = buildTellaPlan({ episodeDir: EPISODE_DIR, narrationAssets });
    const sourceClips = plan.clips.filter((clip) => clip.kind === "source_clip");

    expect(sourceClips).toHaveLength(2);
    expect(sourceClips.every((clip) => clip.preserveOriginalAudio === true)).toBe(true);
  });

  it("maps each narration to distinct A/B plates with one shared audio file", () => {
    const plan = buildTellaPlan({ episodeDir: EPISODE_DIR, narrationAssets });
    const narrationClips = plan.clips.filter((clip) => clip.kind === "narration");

    expect(narrationClips).toHaveLength(7);
    for (const [index, clip] of narrationClips.entries()) {
      expect(Object.keys(clip.variants)).toEqual(["dynamic_editorial", "aimh_visual_host"]);
      expect(clip.variants.dynamic_editorial.platePath).toBe(
        join(EPISODE_DIR, "plates", "dynamic_editorial", `${clip.id}.mp4`)
      );
      expect(clip.variants.aimh_visual_host.platePath).toBe(
        join(EPISODE_DIR, "plates", "aimh_visual_host", `${clip.id}.mp4`)
      );
      expect(clip.variants.dynamic_editorial.platePath).not.toBe(
        clip.variants.aimh_visual_host.platePath
      );
      expect(clip.variants.dynamic_editorial.narrationAudioPath).toBe(
        clip.variants.aimh_visual_host.narrationAudioPath
      );
      expect(clip.variants.dynamic_editorial.narrationAudioPath).toBe(
        narrationAssets[index]?.audioPath
      );
      expect(clip.durationSeconds).toBe(narrationAssets[index]?.durationSeconds);
    }
  });

  it("serializes without undefined values, placeholders, or dynamic Tella IDs", () => {
    const serialized = JSON.stringify(
      buildTellaPlan({ episodeDir: EPISODE_DIR, narrationAssets })
    );

    expect(serialized).not.toContain("undefined");
    expect(serialized).not.toMatch(/placeholder/i);
    expect(serialized).not.toMatch(/(?:video|clip|source)Id/);
    expect(JSON.parse(serialized)).toEqual(
      buildTellaPlan({ episodeDir: EPISODE_DIR, narrationAssets })
    );
  });
});

describe("GPT-Live production environment", () => {
  it("defaults logo and music paths from the resolved video-engine path", () => {
    const snapshot = loadEnvSnapshot({
      shellEnv: { AIMH_VIDEO_ENGINE_PATH: "/opt/aimh-video-engine" }
    });

    expect(DEFAULT_ENV_KEYS).toContain("AIMH_LOGO_PATH");
    expect(DEFAULT_ENV_KEYS).toContain("AIMH_BODY_MUSIC_PATH");
    expect(DEFAULT_ENV_KEYS).toContain("AIMH_OUTRO_MUSIC_PATH");
    expect(snapshot.values.AIMH_LOGO_PATH).toBe("/opt/aimh-video-engine/assets/logo.png");
    expect(snapshot.values.AIMH_BODY_MUSIC_PATH).toBe(
      "/opt/aimh-video-engine/assets/music/Body_Komorebi_Futuremono.mp3"
    );
    expect(snapshot.values.AIMH_OUTRO_MUSIC_PATH).toBe(
      "/opt/aimh-video-engine/assets/music/Outro_Much_Higher_Causmic.mp3"
    );
  });

  it("preserves shell, local, and fallback precedence for explicit asset paths", () => {
    const snapshot = loadEnvSnapshot({
      shellEnv: { AIMH_LOGO_PATH: "/shell/logo.png" },
      localEnvText: "AIMH_LOGO_PATH=/local/logo.png\nAIMH_BODY_MUSIC_PATH=/local/music.mp3\n",
      fallbackEnvText:
        "AIMH_LOGO_PATH=/fallback/logo.png\nAIMH_BODY_MUSIC_PATH=/fallback/music.mp3\n"
    });

    expect(snapshot.values.AIMH_LOGO_PATH).toBe("/shell/logo.png");
    expect(snapshot.values.AIMH_BODY_MUSIC_PATH).toBe("/local/music.mp3");
    expect(snapshot.status.AIMH_LOGO_PATH).toEqual({ present: true, source: "shell" });
    expect(snapshot.status.AIMH_BODY_MUSIC_PATH).toEqual({ present: true, source: "local" });
  });
});

describe("GPT-Live production preparation", () => {
  const durationById = new Map<string, number>(
    GPT_LIVE_CONTENT.narration.map((item, index) => [item.id, 8.25 + index / 10])
  );

  const successfulVoiceResult = (voiceDir: string) => ({
    provider: "elevenlabs" as const,
    warnings: [],
    chunks: GPT_LIVE_CONTENT.narration.map((item) => ({
      id: item.id,
      text: item.text,
      file: join(voiceDir, `${item.id}.mp3`),
      durationSeconds: durationById.get(item.id)!,
      provider: "elevenlabs" as const,
      cached: false
    }))
  });

  const validMediaInspection = (durationSeconds = 8.25): MediaInspection => ({
    durationSeconds,
    video: {
      codecName: "h264",
      width: 1920,
      height: 1080,
      framesPerSecond: 30
    },
    audio: { codecName: "aac" }
  });

  it("resolves evidence beneath the episode and rejects traversal", () => {
    const evidence = {
      ...CAPTURED_EVIDENCE[0]!,
      assetPath: "evidence/openai.png"
    } satisfies EvidenceSpec;

    expect(resolveEvidenceAssetPath("/episode", evidence)).toBe("/episode/evidence/openai.png");
    expect(() =>
      resolveEvidenceAssetPath("/episode", { ...evidence, assetPath: "../outside.png" })
    ).toThrow("Evidence asset must remain inside the episode directory");
    expect(() =>
      resolveEvidenceAssetPath("/episode", { ...evidence, assetPath: "/outside.png" })
    ).toThrow("Evidence asset must remain inside the episode directory");
  });

  it("finds only captured evidence for a narration scene", () => {
    expect(evidenceForScene("full_duplex")).toMatchObject({
      id: "evidence_openai_full_duplex",
      playbackDecision: "captured_source"
    });
    expect(evidenceForScene("hook")).toBeUndefined();
    expect(evidenceForScene("cta")).toBeUndefined();
  });

  it("rejects a missing captured evidence file", async () => {
    const episodeDir = await mkdtemp(join(tmpdir(), "gpt-live-evidence-missing-"));
    try {
      await expect(
        validateEvidenceAssets(episodeDir, [CAPTURED_EVIDENCE[0]!])
      ).rejects.toThrow(/missing/i);
    } finally {
      await rm(episodeDir, { recursive: true, force: true });
    }
  });

  it("rejects symlinked and non-file captured evidence", async () => {
    const episodeDir = await mkdtemp(join(tmpdir(), "gpt-live-evidence-kind-"));
    const outsideDir = await mkdtemp(join(tmpdir(), "gpt-live-evidence-outside-"));
    const evidenceDir = join(episodeDir, "evidence");
    const evidence = CAPTURED_EVIDENCE[0]!;
    try {
      await mkdir(evidenceDir);
      const outsidePath = join(outsideDir, "outside.png");
      await writeFile(outsidePath, "outside");
      await symlink(outsidePath, resolveEvidenceAssetPath(episodeDir, evidence));
      await expect(validateEvidenceAssets(episodeDir, [evidence])).rejects.toThrow(/symlink/i);

      await rm(resolveEvidenceAssetPath(episodeDir, evidence));
      await mkdir(resolveEvidenceAssetPath(episodeDir, evidence));
      await expect(validateEvidenceAssets(episodeDir, [evidence])).rejects.toThrow(/regular file/i);
    } finally {
      await rm(episodeDir, { recursive: true, force: true });
      await rm(outsideDir, { recursive: true, force: true });
    }
  });

  it("rejects empty and unreadable captured evidence", async () => {
    const episodeDir = await mkdtemp(join(tmpdir(), "gpt-live-evidence-file-"));
    const evidence = CAPTURED_EVIDENCE[0]!;
    const evidencePath = resolveEvidenceAssetPath(episodeDir, evidence);
    try {
      await mkdir(join(episodeDir, "evidence"));
      await writeFile(evidencePath, "");
      await expect(validateEvidenceAssets(episodeDir, [evidence])).rejects.toThrow(/empty/i);

      await writeFile(evidencePath, "non-empty");
      await expect(
        validateEvidenceAssets(episodeDir, [evidence], {
          open: async () => {
            throw Object.assign(new Error("EACCES"), { code: "EACCES" });
          }
        })
      ).rejects.toThrow(/not readable/i);
    } finally {
      await rm(episodeDir, { recursive: true, force: true });
    }
  });

  it("rejects a corrupt nonempty PNG capture", async () => {
    const episodeDir = await mkdtemp(join(tmpdir(), "gpt-live-evidence-corrupt-"));
    const evidence = CAPTURED_EVIDENCE[0]!;
    try {
      await mkdir(join(episodeDir, "evidence"));
      await writeFile(resolveEvidenceAssetPath(episodeDir, evidence), "not a PNG");
      await expect(validateEvidenceAssets(episodeDir, [evidence])).rejects.toThrow(
        /PNG signature|IHDR/i
      );
    } finally {
      await rm(episodeDir, { recursive: true, force: true });
    }
  });

  it("requires PNG captures while leaving full-screen source videos to media validation", async () => {
    const episodeDir = join(tmpdir(), `gpt-live-evidence-media-${crypto.randomUUID()}`);
    const sourceVideo = GPT_LIVE_CONTENT.evidence.find(
      (item) => item.playbackDecision === "full_screen_original_audio"
    )!;
    const jpegCapture = {
      ...CAPTURED_EVIDENCE[0]!,
      assetPath: "evidence/capture.jpg"
    } satisfies EvidenceSpec;
    await expect(validateEvidenceAssets(episodeDir, [sourceVideo])).resolves.toBeUndefined();
    await expect(validateEvidenceAssets(episodeDir, [jpegCapture])).rejects.toThrow(/PNG/i);
  });

  it("stages only allowlisted evidence PNGs and removes the temporary public root", async () => {
    const episodeDir = await mkdtemp(join(tmpdir(), "gpt-live-evidence-stage-"));
    await materializeEvidenceFixtures(episodeDir);
    await writeFile(join(episodeDir, "production.json"), "do not expose");
    await mkdir(join(episodeDir, "source"));
    await writeFile(join(episodeDir, "source", "clip.mp4"), "do not expose");

    const staged = await stageEvidencePublicAssets(episodeDir);
    try {
      expect(staged.dimensions).toEqual(
        Object.fromEntries(
          CAPTURED_EVIDENCE.map((evidence) => [
            evidence.assetPath,
            { width: 1, height: 1 }
          ])
        )
      );
      expect((await readdir(staged.publicDir, { recursive: true })).sort()).toEqual([
        "evidence",
        ...CAPTURED_EVIDENCE.map((evidence) => evidence.assetPath).sort()
      ]);
      for (const evidence of CAPTURED_EVIDENCE) {
        await expect(readFile(join(staged.publicDir, evidence.assetPath))).resolves.toEqual(
          VALID_PNG
        );
      }
    } finally {
      await staged.cleanup();
    }
    await expect(fsStat(staged.publicDir)).rejects.toMatchObject({ code: "ENOENT" });
  });

  it("rejects symlinked evidence while staging for standalone rendering", async () => {
    const episodeDir = await mkdtemp(join(tmpdir(), "gpt-live-evidence-stage-link-"));
    const outsideDir = await mkdtemp(join(tmpdir(), "gpt-live-evidence-stage-outside-"));
    const evidence = CAPTURED_EVIDENCE[0]!;
    try {
      await mkdir(join(episodeDir, "evidence"));
      const outsidePath = join(outsideDir, "outside.png");
      await writeFile(outsidePath, VALID_PNG);
      await symlink(outsidePath, resolveEvidenceAssetPath(episodeDir, evidence));
      await expect(stageEvidencePublicAssets(episodeDir, [evidence])).rejects.toThrow(/symlink/i);
    } finally {
      await rm(episodeDir, { recursive: true, force: true });
      await rm(outsideDir, { recursive: true, force: true });
    }
  });

  it("rejects an evidence parent swapped to an external symlink before open", async () => {
    const episodeDir = await mkdtemp(join(tmpdir(), "gpt-live-evidence-parent-race-"));
    const outsideDir = await mkdtemp(join(tmpdir(), "gpt-live-evidence-race-outside-"));
    const evidence = CAPTURED_EVIDENCE[0]!;
    const evidenceDir = join(episodeDir, "evidence");
    const displacedEvidenceDir = join(episodeDir, "evidence-original");
    const evidencePath = resolveEvidenceAssetPath(episodeDir, evidence);
    let evidenceFileLstatCalls = 0;
    try {
      await mkdir(evidenceDir);
      await writeFile(evidencePath, VALID_PNG);
      await writeFile(join(outsideDir, basename(evidence.assetPath)), VALID_PNG);

      await expect(
        stageEvidencePublicAssets(episodeDir, [evidence], {
          lstat: async (path) => {
            if (path === evidencePath) {
              evidenceFileLstatCalls += 1;
              if (evidenceFileLstatCalls === 2) {
                await rename(evidenceDir, displacedEvidenceDir);
                await symlink(outsideDir, evidenceDir, "dir");
              }
            }
            return fsLstat(path);
          }
        })
      ).rejects.toThrow(/outside captured evidence root|changed during validation/i);
      expect(evidenceFileLstatCalls).toBe(2);
    } finally {
      await rm(episodeDir, { recursive: true, force: true });
      await rm(outsideDir, { recursive: true, force: true });
    }
  });

  it("validates evidence before creating directories, extracting media, or synthesizing narration", async () => {
    const episodeDir = await mkdtemp(join(tmpdir(), "gpt-live-evidence-preflight-"));
    const ensureDir = vi.fn(async () => undefined);
    const extractSourceClip = vi.fn(async () => undefined);
    const synthesizeNarration = vi.fn(async () => successfulVoiceResult(join(episodeDir, "voice")));
    const renderPlates = vi.fn(async () => ({ jobs: [] }));
    try {
      await expect(
        prepareGptLiveProduction(
          {
            episodeDir,
            env: {
              ELEVENLABS_API_KEY: "test-key",
              ELEVENLABS_VOICE_ID: "test-voice",
              AIMH_LOGO_PATH: "/assets/logo.png",
              AIMH_OUTRO_MUSIC_PATH: "/assets/outro.mp3"
            },
            ffmpegPath: "ffmpeg",
            ffprobePath: "ffprobe"
          },
          {
            access: async () => undefined,
            ensureDir,
            extractSourceClip,
            synthesizeNarration,
            renderPlates
          }
        )
      ).rejects.toThrow(/Evidence asset.*missing/i);
      expect(ensureDir).not.toHaveBeenCalled();
      expect(extractSourceClip).not.toHaveBeenCalled();
      expect(synthesizeNarration).not.toHaveBeenCalled();
      expect(renderPlates).not.toHaveBeenCalled();
    } finally {
      await rm(episodeDir, { recursive: true, force: true });
    }
  });

  it("parses ffprobe JSON and keeps the inspected path as one command argument", () => {
    const inspectedPath = "/tmp/slate;not-a-command.mp4";
    expect(buildFfprobeMediaArgs(inspectedPath)).toEqual([
      "-v",
      "error",
      "-show_entries",
      "stream=codec_type,codec_name,width,height,r_frame_rate:format=duration",
      "-of",
      "json",
      inspectedPath
    ]);
    expect(
      parseFfprobeMediaJson(
        JSON.stringify({
          streams: [
            {
              codec_type: "video",
              codec_name: "h264",
              width: 1920,
              height: 1080,
              r_frame_rate: "30/1"
            },
            { codec_type: "audio", codec_name: "aac" }
          ],
          format: { duration: "8.250" }
        })
      )
    ).toEqual(validMediaInspection());
  });

  it.each([
    { name: "video codec", inspection: { video: { codecName: "hevc" } }, error: "H.264" },
    { name: "audio codec", inspection: { audio: { codecName: "mp3" } }, error: "AAC" },
    { name: "dimensions", inspection: { video: { width: 1280 } }, error: "1920x1080" },
    { name: "frame rate", inspection: { video: { framesPerSecond: 29.97 } }, error: "30fps" },
    { name: "audio stream", inspection: { audio: undefined }, error: "audio stream" }
  ])("rejects an invalid narration slate $name", ({ inspection, error }) => {
    const valid = validMediaInspection();
    const candidate = {
      ...valid,
      ...inspection,
      video: inspection.video ? { ...valid.video, ...inspection.video } : valid.video
    } as MediaInspection;

    expect(() => assertNarrationSlateContract(candidate, 8.25)).toThrow(error);
  });

  it("builds a black 1080p H.264/AAC slate command around the exact voice duration", () => {
    expect(
      buildNarrationSlateArgs({
        audioPath: "/episode/voice/narration_hook.mp3",
        durationSeconds: 8.25,
        outputPath: "/episode/master/narration_hook.mp4"
      })
    ).toEqual([
      "-y",
      "-f",
      "lavfi",
      "-i",
      "color=c=black:s=1920x1080:r=30:d=8.250",
      "-i",
      "/episode/voice/narration_hook.mp3",
      "-map",
      "0:v:0",
      "-map",
      "1:a:0",
      "-c:v",
      "libx264",
      "-pix_fmt",
      "yuv420p",
      "-r",
      "30",
      "-c:a",
      "aac",
      "-b:a",
      "192k",
      "-ar",
      "48000",
      "-ac",
      "2",
      "-t",
      "8.250",
      "-movflags",
      "+faststart",
      "/episode/master/narration_hook.mp4"
    ]);
  });

  it("prepares media, QA-validates a non-default outro, and persists deterministic records", async () => {
    const episodeDir = await mkdtemp(join(tmpdir(), "gpt-live-prepare-"));
    await materializeEvidenceFixtures(episodeDir);
    const resolvedOutroPath = "/assets/Outro_Alternate.mp3";
    const prepareEnv = {
      ELEVENLABS_API_KEY: "eleven-secret-do-not-write",
      ELEVENLABS_VOICE_ID: "voice-secret-do-not-write",
      AIMH_LOGO_PATH: GPT_LIVE_CONTENT.branding.logoPath,
      AIMH_OUTRO_MUSIC_PATH: resolvedOutroPath
    };
    const extractSourceClip = vi.fn(async () => undefined);
    const synthesizeNarration = vi.fn(async ({ outDir }: { outDir: string }) =>
      successfulVoiceResult(outDir)
    );
    const runCommand = vi.fn(async (_command: string, _args: string[]) => ({
      stdout: "",
      stderr: ""
    }));
    const inspectMediaFile = vi.fn(async (_ffprobePath: string, file: string) => {
      const id = basename(file, ".mp4");
      return validMediaInspection(durationById.get(id)!);
    });
    const publications: string[] = [];
    const plateRendering = vi.fn(async () => {
      publications.push("plates-complete");
      return { jobs: [] };
    });
    const writeJsonAtomic = vi.fn(async (path: string, value: unknown) => {
      publications.push(path);
      await writeFile(path, `${JSON.stringify(value, null, 2)}\n`, "utf8");
    });
    const writeTextAtomic = vi.fn(async (path: string, value: string) => {
      publications.push(path);
      await writeFile(path, value, "utf8");
    });

    try {
      const result = await prepareGptLiveProduction(
        {
          episodeDir,
          env: prepareEnv,
          ffmpegPath: "/tools/ffmpeg",
          ffprobePath: "/tools/ffprobe"
        },
        {
          extractSourceClip,
          synthesizeNarration,
          runCommand,
          inspectMediaFile,
          renderPlates: plateRendering,
          access: async () => undefined,
          writeJsonAtomic,
          writeTextAtomic,
          stat: async () => ({ size: 100, isFile: () => true })
        }
      );

      for (const name of [
        "source",
        "voice",
        "master",
        "plates",
        "tella",
        "exports",
        "final",
        "reports"
      ]) {
        expect((await fsStat(join(episodeDir, name))).isDirectory()).toBe(true);
      }
      expect(extractSourceClip).toHaveBeenCalledTimes(2);
      expect(extractSourceClip).toHaveBeenNthCalledWith(1, {
        playerConfigUrl: EXPECTED_SOURCE_CLIPS[0].playerConfigUrl,
        startSeconds: EXPECTED_SOURCE_CLIPS[0].startSeconds,
        endSeconds: EXPECTED_SOURCE_CLIPS[0].endSeconds,
        outputPath: join(episodeDir, "source", "clip_translation.mp4"),
        ffmpegPath: "/tools/ffmpeg",
        ffprobePath: "/tools/ffprobe"
      });
      expect(synthesizeNarration).toHaveBeenCalledWith(
        expect.objectContaining({
          outDir: join(episodeDir, "voice"),
          ffprobePath: "/tools/ffprobe",
          allowElevenLabs: true
        })
      );
      expect(runCommand).toHaveBeenCalledTimes(7);
      expect(runCommand.mock.calls.every(([command]) => command === "/tools/ffmpeg")).toBe(true);
      expect(inspectMediaFile).toHaveBeenCalledTimes(7);
      expect(plateRendering).toHaveBeenCalledOnce();

      const productionText = await readFile(result.productionPath, "utf8");
      const voiceText = await readFile(result.voicePath, "utf8");
      const planText = await readFile(result.planPath, "utf8");
      const matrixText = await readFile(result.sourceMatrixPath, "utf8");
      const sourceManifestPath = join(episodeDir, "reports", "source-manifest.json");
      const sourceManifestText = await readFile(sourceManifestPath, "utf8");
      const preparedText = await readFile(result.preparedPath, "utf8");
      const persistedText = [
        productionText,
        voiceText,
        planText,
        matrixText,
        sourceManifestText,
        preparedText
      ].join("\n");

      expect(JSON.parse(productionText)).toMatchObject({
        id: GPT_LIVE_CONTENT.id,
        branding: { logoPath: GPT_LIVE_CONTENT.branding.logoPath },
        evidence: EXPECTED_EVIDENCE,
        audio: { ...EXPECTED_AUDIO, outroMusicPath: resolvedOutroPath }
      });
      expect(JSON.parse(productionText)).not.toHaveProperty("musicPath");
      expect(JSON.parse(voiceText)).toEqual(successfulVoiceResult(join(episodeDir, "voice")));
      expect(JSON.parse(planText)).toEqual(result.plan);
      expect(result.plan.clips.map(({ id }) => id)).toEqual(
        GPT_LIVE_CONTENT.timeline.map(({ id }) => id)
      );
      for (const source of GPT_LIVE_CONTENT.sources) {
        expect(matrixText).toContain(source.title);
        expect(matrixText).toContain(source.url);
      }
      expect(JSON.parse(sourceManifestText)).toEqual(EXPECTED_SOURCE_MANIFEST);
      expect((result as typeof result & { sourceManifestPath?: string }).sourceManifestPath).toBe(
        sourceManifestPath
      );
      expect(persistedText).not.toMatch(/eleven-secret|voice-secret|playlist\.m3u8\?/);
      expect(JSON.parse(preparedText)).toEqual({
        schemaVersion: "0.1.0",
        status: "prepared",
        productionId: GPT_LIVE_CONTENT.id,
        manifestFingerprint: createHash("sha256")
          .update(JSON.stringify({
            production: JSON.parse(productionText),
            voice: JSON.parse(voiceText),
            plan: JSON.parse(planText),
            sourceMatrix: matrixText,
            sourceManifest: EXPECTED_SOURCE_MANIFEST
          }))
          .digest("hex")
      });
      expect(() =>
        validateSerializedQaPaths({
          episodeDir,
          env: prepareEnv,
          production: JSON.parse(productionText) as QaProduction,
          voice: JSON.parse(voiceText) as QaVoice,
          plan: result.plan,
          generation: {
            generationId: "00000000-0000-4000-8000-000000000000",
            variants: [],
            finalPaths: [
              join(episodeDir, "final", "version-a.mp4"),
              join(episodeDir, "final", "version-b.mp4")
            ],
            reportPath: join(episodeDir, "reports", "post-production.json")
          }
        })
      ).not.toThrow();
      expect(publications).toEqual([
        "plates-complete",
        result.productionPath,
        result.voicePath,
        result.planPath,
        result.sourceMatrixPath,
        sourceManifestPath,
        result.preparedPath
      ]);
      expect(publications.indexOf("plates-complete")).toBeLessThan(
        publications.indexOf(result.preparedPath)
      );
      expect(result.episodeDir).toBe(episodeDir);
    } finally {
      await rm(episodeDir, { recursive: true, force: true });
    }
  });

  it.each([
    {
      name: "top-level fallback provider",
      mutate: (result: ReturnType<typeof successfulVoiceResult>) => ({
        ...result,
        provider: "silent_placeholder" as const
      }),
      expected: "ElevenLabs narration required"
    },
    {
      name: "synthesis warnings",
      mutate: (result: ReturnType<typeof successfulVoiceResult>) => ({
        ...result,
        warnings: ["fallback was attempted"]
      }),
      expected: "Narration synthesis returned warnings"
    },
    {
      name: "invalid chunk file",
      mutate: (result: ReturnType<typeof successfulVoiceResult>) => ({
        ...result,
        chunks: [{ ...result.chunks[0]!, file: "" }, ...result.chunks.slice(1)]
      }),
      expected: "Invalid ElevenLabs narration chunk"
    }
  ])("rejects $name instead of silently falling back", async ({ mutate, expected }) => {
    const episodeDir = await mkdtemp(join(tmpdir(), "gpt-live-reject-"));
    await materializeEvidenceFixtures(episodeDir);

    try {
      const preparation = prepareGptLiveProduction(
        {
          episodeDir,
          env: {
            ELEVENLABS_API_KEY: "test-key",
            ELEVENLABS_VOICE_ID: "test-voice",
            AIMH_LOGO_PATH: "/assets/logo.png",
            AIMH_OUTRO_MUSIC_PATH: "/assets/outro.mp3"
          },
          ffmpegPath: "ffmpeg",
          ffprobePath: "ffprobe"
        },
        {
          extractSourceClip: async () => undefined,
          synthesizeNarration: (async ({ outDir }: { outDir: string }) =>
            mutate(successfulVoiceResult(outDir))),
          runCommand: async () => ({ stdout: "", stderr: "" }),
          inspectMediaFile: async () => validMediaInspection(1),
          access: async () => undefined,
          stat: async () => ({ size: 100, isFile: () => true })
        }
      );

      await expect(preparation).rejects.toThrow(expected);
    } finally {
      await rm(episodeDir, { recursive: true, force: true });
    }
  });

  it("removes a stale completion marker before a rerun can fail", async () => {
    const episodeDir = await mkdtemp(join(tmpdir(), "gpt-live-stale-marker-"));
    const markerPath = join(episodeDir, "reports", "prepared.json");
    await mkdir(join(episodeDir, "reports"), { recursive: true });
    await writeFile(markerPath, '{"status":"prepared","stale":true}\n');
    await materializeEvidenceFixtures(episodeDir);

    try {
      await expect(
        prepareGptLiveProduction(
          {
            episodeDir,
            env: {
              ELEVENLABS_API_KEY: "test-key",
              ELEVENLABS_VOICE_ID: "test-voice",
              AIMH_LOGO_PATH: "/assets/logo.png",
              AIMH_OUTRO_MUSIC_PATH: "/assets/outro.mp3"
            },
            ffmpegPath: "ffmpeg",
            ffprobePath: "ffprobe"
          },
          {
            access: async () => undefined,
            extractSourceClip: async () => {
              throw new Error("injected source failure");
            }
          }
        )
      ).rejects.toThrow("injected source failure");
      await expect(readFile(markerPath, "utf8")).rejects.toMatchObject({ code: "ENOENT" });
    } finally {
      await rm(episodeDir, { recursive: true, force: true });
    }
  });

  it.each(["reports", "source", "voice", "plates", "evidence"])(
    "rejects a symlinked %s descendant before preparation side effects",
    async (directory) => {
      const episodeDir = await mkdtemp(join(tmpdir(), "gpt-live-prepare-contained-"));
      const outsideDir = await mkdtemp(join(tmpdir(), "gpt-live-prepare-outside-"));
      const sentinelPath = join(outsideDir, "sentinel.txt");
      await writeFile(sentinelPath, "outside-unchanged", "utf8");
      await symlink(outsideDir, join(episodeDir, directory), "dir");

      const access = vi.fn(async () => undefined);
      const ensureDir = vi.fn(async () => undefined);
      const extractSourceClip = vi.fn(async () => undefined);
      const synthesizeNarration = vi.fn(async () => successfulVoiceResult(join(episodeDir, "voice")));
      const runCommand = vi.fn(async () => ({ stdout: "", stderr: "" }));
      const renderPlates = vi.fn(async () => ({ jobs: [] }));
      const removeFile = vi.fn(async () => undefined);
      const writeJsonAtomic = vi.fn(async () => undefined);
      const writeTextAtomic = vi.fn(async () => undefined);

      try {
        await expect(
          prepareGptLiveProduction(
            {
              episodeDir,
              env: {
                ELEVENLABS_API_KEY: "test-key",
                ELEVENLABS_VOICE_ID: "test-voice",
                AIMH_LOGO_PATH: "/assets/logo.png",
                AIMH_OUTRO_MUSIC_PATH: "/assets/outro.mp3"
              },
              ffmpegPath: "ffmpeg",
              ffprobePath: "ffprobe"
            },
            {
              access,
              ensureDir,
              extractSourceClip,
              synthesizeNarration,
              runCommand,
              renderPlates,
              removeFile,
              writeJsonAtomic,
              writeTextAtomic
            }
          )
        ).rejects.toThrow(/symlink/i);

        expect(access).not.toHaveBeenCalled();
        expect(ensureDir).not.toHaveBeenCalled();
        expect(extractSourceClip).not.toHaveBeenCalled();
        expect(synthesizeNarration).not.toHaveBeenCalled();
        expect(runCommand).not.toHaveBeenCalled();
        expect(renderPlates).not.toHaveBeenCalled();
        expect(removeFile).not.toHaveBeenCalled();
        expect(writeJsonAtomic).not.toHaveBeenCalled();
        expect(writeTextAtomic).not.toHaveBeenCalled();
        await expect(readFile(sentinelPath, "utf8")).resolves.toBe("outside-unchanged");
      } finally {
        await rm(episodeDir, { recursive: true, force: true });
        await rm(outsideDir, { recursive: true, force: true });
      }
    }
  );

  it.each([
    {
      name: "missing ElevenLabs credentials",
      options: { env: { AIMH_LOGO_PATH: "/logo", AIMH_OUTRO_MUSIC_PATH: "/outro" } },
      error: "ElevenLabs credentials"
    },
    {
      name: "blank ElevenLabs credentials",
      options: {
        env: {
          ELEVENLABS_API_KEY: " ",
          ELEVENLABS_VOICE_ID: "\t",
          AIMH_LOGO_PATH: "/logo",
          AIMH_OUTRO_MUSIC_PATH: "/outro"
        }
      },
      error: "ElevenLabs credentials"
    },
    { name: "missing ffmpeg path", options: { ffmpegPath: "" }, error: "ffmpeg path" },
    { name: "missing ffprobe path", options: { ffprobePath: "" }, error: "ffprobe path" }
  ])("fails preflight for $name before source extraction", async ({ options, error }) => {
    const extractSourceClip = vi.fn(async () => undefined);
    const ensureDir = vi.fn(async () => undefined);
    const base = {
      episodeDir: "/tmp/valid-episode",
      env: {
        ELEVENLABS_API_KEY: "test-key",
        ELEVENLABS_VOICE_ID: "test-voice",
        AIMH_LOGO_PATH: "/logo",
        AIMH_OUTRO_MUSIC_PATH: "/outro"
      },
      ffmpegPath: "ffmpeg",
      ffprobePath: "ffprobe"
    };

    await expect(
      prepareGptLiveProduction(
        { ...base, ...options, env: options.env ?? base.env },
        { access: async () => undefined, ensureDir, extractSourceClip }
      )
    ).rejects.toThrow(error);
    expect(ensureDir).not.toHaveBeenCalled();
    expect(extractSourceClip).not.toHaveBeenCalled();
  });

  it("fails preflight when a required brand asset is unreadable", async () => {
    const extractSourceClip = vi.fn(async () => undefined);
    await expect(
      prepareGptLiveProduction(
        {
          episodeDir: "/tmp/valid-episode",
          env: {
            ELEVENLABS_API_KEY: "test-key",
            ELEVENLABS_VOICE_ID: "test-voice",
            AIMH_LOGO_PATH: "/missing/logo.png",
            AIMH_OUTRO_MUSIC_PATH: "/outro.mp3"
          },
          ffmpegPath: "ffmpeg",
          ffprobePath: "ffprobe"
        },
        {
          access: async (path: string) => {
            if (path.includes("logo")) throw new Error("ENOENT");
          },
          ensureDir: async () => undefined,
          extractSourceClip
        }
      )
    ).rejects.toThrow("AIMH logo is not readable");
    expect(extractSourceClip).not.toHaveBeenCalled();
  });

  it("rejects a slate with the wrong stream contract and leaves no completion marker", async () => {
    const episodeDir = await mkdtemp(join(tmpdir(), "gpt-live-stream-contract-"));
    await materializeEvidenceFixtures(episodeDir);

    try {
      await expect(
        prepareGptLiveProduction(
          {
            episodeDir,
            env: {
              ELEVENLABS_API_KEY: "test-key",
              ELEVENLABS_VOICE_ID: "test-voice",
              AIMH_LOGO_PATH: "/logo.png",
              AIMH_OUTRO_MUSIC_PATH: "/outro.mp3"
            },
            ffmpegPath: "ffmpeg",
            ffprobePath: "ffprobe"
          },
          {
            access: async () => undefined,
            extractSourceClip: async () => undefined,
            synthesizeNarration: async ({ outDir }) => successfulVoiceResult(outDir),
            stat: async () => ({ size: 100, isFile: () => true }),
            runCommand: async () => ({ stdout: "", stderr: "" }),
            inspectMediaFile: async () => ({
              ...validMediaInspection(8.25),
              video: { ...validMediaInspection().video, codecName: "hevc" }
            })
          }
        )
      ).rejects.toThrow("H.264");
      await expect(
        readFile(join(episodeDir, "reports", "prepared.json"), "utf8")
      ).rejects.toMatchObject({ code: "ENOENT" });
    } finally {
      await rm(episodeDir, { recursive: true, force: true });
    }
  });
});

describe("GPT-Live preparation CLI", () => {
  const virtualCliFileSystem = {
    lstat: async (path: string) => {
      if (path === "/project/episodes") {
        return { isDirectory: () => true, isSymbolicLink: () => false };
      }
      throw Object.assign(new Error("not found"), { code: "ENOENT" });
    },
    realpath: async (path: string) => path
  };

  it("prints the root comparison report separately from visual assets", () => {
    expect(formatGptLiveCliResult({
      episodeDir: "/project/episodes/custom",
      machineOk: true,
      humanPlayback: { status: "pending", note: "Playback required." },
      readyForUpload: false,
      ok: false,
      reportPath: "/project/episodes/custom/reports/qa.json",
      comparisonPath: "/project/episodes/custom/reports/comparison.md",
      visualDirectory: "/project/episodes/custom/reports/visual"
    })).toEqual([
      "episode: /project/episodes/custom",
      "machineOk: true",
      "humanPlayback: pending",
      "readyForUpload: false",
      "ok: false",
      "qa: /project/episodes/custom/reports/qa.json",
      "comparison: /project/episodes/custom/reports/comparison.md",
      "visual: /project/episodes/custom/reports/visual"
    ]);
  });

  it("accepts pnpm's extra separator and resolves preparation paths from cwd", async () => {
    const loadEnvSnapshotFromFiles = vi.fn(async () => ({
      values: {
        AIMH_VIDEO_ENGINE_PATH: "/video-engine",
        FFMPEG_PATH: "/tools/ffmpeg",
        FFPROBE_PATH: "/tools/ffprobe"
      },
      status: {}
    }));
    const prepareGptLiveProduction = vi.fn(async () => ({ ok: true }));

    await runGptLiveCli(["prepare", "--", "--episode-dir", "episodes/custom"], {
      cwd: () => "/project",
      loadEnvSnapshotFromFiles,
      prepareGptLiveProduction,
      ...virtualCliFileSystem
    });

    expect(loadEnvSnapshotFromFiles).toHaveBeenCalledWith(
      "/project",
      "/Users/dennywii/Documents/dev/aimh-video-engine"
    );
    expect(prepareGptLiveProduction).toHaveBeenCalledWith({
      episodeDir: resolve("/project", "episodes/custom"),
      env: expect.objectContaining({ AIMH_VIDEO_ENGINE_PATH: "/video-engine" }),
      ffmpegPath: "/tools/ffmpeg",
      ffprobePath: "/tools/ffprobe"
    });
  });

  it("uses the manifest ID for the default episode directory", async () => {
    const prepareGptLiveProduction = vi.fn(async () => ({ ok: true }));

    await runGptLiveCli(["prepare"], {
      cwd: () => "/project",
      loadEnvSnapshotFromFiles: async () => ({ values: {}, status: {} }),
      prepareGptLiveProduction,
      ...virtualCliFileSystem
    });

    expect(prepareGptLiveProduction).toHaveBeenCalledWith(
      expect.objectContaining({
        episodeDir: "/project/episodes/2026-07-10-gpt-live-tella-ab",
        ffmpegPath: "ffmpeg",
        ffprobePath: "ffprobe"
      })
    );
  });

  it.each([
    { args: ["prepare", "--episode-dir"], error: "Missing value for --episode-dir" },
    { args: ["unexpected"], error: "Unknown command: unexpected" }
  ])("rejects invalid command input: $args", async ({ args, error }) => {
    await expect(runGptLiveCli(args)).rejects.toThrow(error);
  });

  it("dispatches finish with the same contained episode path and loaded environment", async () => {
    const finishGptLiveProduction = vi.fn(async () => ({ episodeDir: "/project/episodes/custom" }));

    await runGptLiveCli(["finish", "--", "--episode-dir", "episodes/custom"], {
      cwd: () => "/project",
      loadEnvSnapshotFromFiles: async () => ({
        values: {
          AIMH_LOGO_PATH: "/assets/logo.png",
          AIMH_OUTRO_MUSIC_PATH: "/assets/outro.mp3",
          FFMPEG_PATH: "/tools/ffmpeg",
          FFPROBE_PATH: "/tools/ffprobe"
        },
        status: {}
      }),
      finishGptLiveProduction,
      ...virtualCliFileSystem
    });

    expect(finishGptLiveProduction).toHaveBeenCalledWith({
      episodeDir: "/project/episodes/custom",
      env: expect.objectContaining({ AIMH_LOGO_PATH: "/assets/logo.png" }),
      ffmpegPath: "/tools/ffmpeg",
      ffprobePath: "/tools/ffprobe"
    });
  });

  it("dispatches QA with the same contained episode path and loaded environment", async () => {
    const qaGptLiveProduction = vi.fn(async () => ({
      episodeDir: "/project/episodes/custom",
      ok: true
    }));

    await runGptLiveCli(["qa", "--", "--episode-dir", "episodes/custom"], {
      cwd: () => "/project",
      loadEnvSnapshotFromFiles: async () => ({
        values: {
          YOUTUBE_UPLOAD_ENABLED: "false",
          FFMPEG_PATH: "/tools/ffmpeg",
          FFPROBE_PATH: "/tools/ffprobe"
        },
        status: {}
      }),
      qaGptLiveProduction,
      ...virtualCliFileSystem
    });

    expect(qaGptLiveProduction).toHaveBeenCalledWith({
      episodeDir: "/project/episodes/custom",
      env: expect.objectContaining({ YOUTUBE_UPLOAD_ENABLED: "false" }),
      ffmpegPath: "/tools/ffmpeg",
      ffprobePath: "/tools/ffprobe"
    });
  });

  it.each([
    { name: "unknown option typo", args: ["prepare", "--episode-dr", "episodes/x"] },
    {
      name: "duplicate option",
      args: ["prepare", "--episode-dir", "episodes/a", "--episode-dir=episodes/b"]
    },
    { name: "stray positional argument", args: ["prepare", "episodes/x"] },
    { name: "excess separators", args: ["prepare", "--", "--", "--episode-dir", "episodes/x"] },
    { name: "trailing separator", args: ["prepare", "--episode-dir", "episodes/x", "--"] }
  ])("rejects $name before loading env or preparing", async ({ args }) => {
    const loadEnvSnapshotFromFiles = vi.fn(async () => ({ values: {}, status: {} }));
    const prepareGptLiveProduction = vi.fn(async () => ({ ok: true }));

    await expect(
      runGptLiveCli(args, {
        cwd: () => "/project",
        loadEnvSnapshotFromFiles,
        prepareGptLiveProduction
      })
    ).rejects.toThrow();
    expect(loadEnvSnapshotFromFiles).not.toHaveBeenCalled();
    expect(prepareGptLiveProduction).not.toHaveBeenCalled();
  });

  it.each([
    { name: "episodes root", value: "episodes" },
    { name: "project root", value: "." },
    { name: "filesystem root", value: "/" },
    { name: "relative traversal", value: "../outside" },
    { name: "absolute outside path", value: "/tmp/outside" }
  ])("rejects $name as an episode destination before preparation", async ({ value }) => {
    const loadEnvSnapshotFromFiles = vi.fn(async () => ({ values: {}, status: {} }));
    const prepareGptLiveProduction = vi.fn(async () => ({ ok: true }));

    await expect(
      runGptLiveCli(["prepare", "--episode-dir", value], {
        cwd: () => "/project",
        loadEnvSnapshotFromFiles,
        prepareGptLiveProduction
      })
    ).rejects.toThrow("Episode directory must be a child of /project/episodes");
    expect(loadEnvSnapshotFromFiles).not.toHaveBeenCalled();
    expect(prepareGptLiveProduction).not.toHaveBeenCalled();
  });

  it("rejects an existing symlink component that escapes the episodes root", async () => {
    const projectRoot = await mkdtemp(join(tmpdir(), "gpt-live-cli-project-"));
    const outsideRoot = await mkdtemp(join(tmpdir(), "gpt-live-cli-outside-"));
    const prepareGptLiveProduction = vi.fn(async () => ({ ok: true }));
    await mkdir(join(projectRoot, "episodes"), { recursive: true });
    await symlink(outsideRoot, join(projectRoot, "episodes", "linked"), "dir");

    try {
      await expect(
        runGptLiveCli(["prepare", "--episode-dir", "episodes/linked/run"], {
          cwd: () => projectRoot,
          loadEnvSnapshotFromFiles: async () => ({ values: {}, status: {} }),
          prepareGptLiveProduction
        })
      ).rejects.toThrow(/symlink/i);
      expect(prepareGptLiveProduction).not.toHaveBeenCalled();
    } finally {
      await rm(projectRoot, { recursive: true, force: true });
      await rm(outsideRoot, { recursive: true, force: true });
    }
  });
});

describe("GPT-Live controlled production content", () => {
  it("pins all canonical visual scene content", () => {
    expect((contentModule as Record<string, unknown>).GPT_LIVE_VISUAL_CONTENT).toEqual(
      EXPECTED_VISUAL_CONTENT
    );
  });

  it("pins every approved production field", () => {
    expect(GPT_LIVE_CONTENT.id).toBe("2026-07-10-gpt-live-tella-ab");
    expect(GPT_LIVE_CONTENT.variants).toEqual(["dynamic_editorial", "aimh_visual_host"]);
    expect(GPT_LIVE_CONTENT.sources).toEqual(EXPECTED_SOURCES);
    expect(GPT_LIVE_CONTENT.claims).toEqual(EXPECTED_CLAIMS);
    expect(GPT_LIVE_CONTENT.narration).toEqual(EXPECTED_NARRATION);
    expect(GPT_LIVE_CONTENT.evidence).toEqual(EXPECTED_EVIDENCE);
    expect(GPT_LIVE_CONTENT.audio).toEqual(EXPECTED_AUDIO);
    expect(GPT_LIVE_CONTENT.branding).toEqual({
      logoPath: "/Users/dennywii/Documents/dev/aimh-video-engine/assets/logo.png",
      width: 150,
      marginTop: 24,
      marginRight: 24,
      opacity: 0.85
    });
    expect(GPT_LIVE_CONTENT).not.toHaveProperty("musicPath");
  });

  it("pins the ordered timeline IDs and kinds", () => {
    expect(GPT_LIVE_TIMELINE.map(({ id }) => id)).toEqual([
      "clip_translation",
      "narration_hook",
      "clip_interruption",
      "narration_full_duplex",
      "narration_use_cases",
      "narration_evidence",
      "narration_availability",
      "narration_future",
      "narration_cta"
    ]);
    expect(GPT_LIVE_TIMELINE.map(({ kind }) => kind)).toEqual([
      "source_clip",
      "narration",
      "source_clip",
      "narration",
      "narration",
      "narration",
      "narration",
      "narration",
      "narration"
    ]);
    expect(GPT_LIVE_CONTENT.timeline).toBe(GPT_LIVE_TIMELINE);
  });

  it("pins the exact source clip contract", () => {
    expect(GPT_LIVE_TIMELINE.filter(({ kind }) => kind === "source_clip")).toEqual(EXPECTED_SOURCE_CLIPS);
  });

  it("uses exact equality for the approved CTA", () => {
    expect(GPT_LIVE_CONTENT.narration.at(-1)).toEqual(EXPECTED_NARRATION.at(-1));
  });

  it.each([
    {
      name: "duplicate source IDs",
      expectedError: 'Invalid GPT-Live production: duplicate source id "src_openai_article"',
      build: () => {
        const production = cloneProduction();
        return { ...production, sources: [...production.sources, production.sources[0]!] };
      }
    },
    {
      name: "duplicate claim IDs",
      expectedError: 'Invalid GPT-Live production: duplicate claim id "claim_full_duplex"',
      build: () => {
        const production = cloneProduction();
        return { ...production, claims: [...production.claims, production.claims[0]!] };
      }
    },
    {
      name: "duplicate narration IDs",
      expectedError: 'Invalid GPT-Live production: duplicate narration id "narration_hook"',
      build: () => {
        const production = cloneProduction();
        return { ...production, narration: [...production.narration, production.narration[0]!] };
      }
    },
    {
      name: "duplicate timeline IDs",
      expectedError: 'Invalid GPT-Live production: duplicate timeline id "clip_translation"',
      build: () => {
        const production = cloneProduction();
        return { ...production, timeline: [...production.timeline, production.timeline[0]!] };
      }
    },
    {
      name: "duplicate evidence IDs",
      expectedError:
        'Invalid GPT-Live production: duplicate evidence id "evidence_translation_video"',
      build: () => {
        const production = cloneProduction();
        return { ...production, evidence: [...production.evidence, production.evidence[0]!] };
      }
    },
    {
      name: "unknown claim source IDs",
      expectedError:
        'Invalid GPT-Live production: claim "claim_full_duplex" references unknown source "src_missing"',
      build: () => {
        const production = cloneProduction();
        const [claim, ...claims] = production.claims;
        return { ...production, claims: [{ ...claim!, sourceIds: ["src_missing"] }, ...claims] };
      }
    },
    {
      name: "unknown narration claim IDs",
      expectedError:
        'Invalid GPT-Live production: narration "narration_hook" references unknown claim "claim_missing"',
      build: () => {
        const production = cloneProduction();
        const [narration, ...narrations] = production.narration;
        return { ...production, narration: [{ ...narration!, claimIds: ["claim_missing"] }, ...narrations] };
      }
    },
    {
      name: "unknown source clip source IDs",
      expectedError:
        'Invalid GPT-Live production: source clip "clip_translation" references unknown source "src_missing"',
      build: () => {
        const production = cloneProduction();
        const firstClip = production.timeline.find((item): item is SourceClipSpec => item.kind === "source_clip")!;
        return {
          ...production,
          timeline: production.timeline.map((item) =>
            item.id === firstClip.id ? { ...firstClip, sourceId: "src_missing" } : item
          )
        };
      }
    },
    {
      name: "altered timeline narration",
      expectedError:
        'Invalid GPT-Live production: timeline narration "narration_hook" does not exactly match canonical narration',
      build: () => {
        const production = cloneProduction();
        return {
          ...production,
          timeline: production.timeline.map((item) =>
            item.id === "narration_hook" ? { ...item, text: "Altered narration." } : item
          )
        };
      }
    },
    {
      name: "missing timeline narration",
      expectedError:
        'Invalid GPT-Live production: canonical narration "narration_hook" must appear exactly once in timeline; found 0',
      build: () => {
        const production = cloneProduction();
        return {
          ...production,
          timeline: production.timeline.filter((item) => item.id !== "narration_hook")
        };
      }
    },
    {
      name: "duplicated timeline narration",
      expectedError:
        'Invalid GPT-Live production: canonical narration "narration_hook" must appear exactly once in timeline; found 2',
      build: () => {
        const production = cloneProduction();
        const narration = production.timeline.find((item) => item.id === "narration_hook")!;
        return { ...production, timeline: [...production.timeline, narration] };
      }
    },
    {
      name: "undeclared timeline narration",
      expectedError:
        'Invalid GPT-Live production: timeline narration "narration_extra" is not declared in canonical narration',
      build: () => {
        const production = cloneProduction();
        const narration = production.narration[0]!;
        return {
          ...production,
          timeline: [...production.timeline, { ...narration, id: "narration_extra" }]
        };
      }
    },
    {
      name: "claims without sources",
      expectedError: 'Invalid GPT-Live production: claim "claim_full_duplex" must reference at least one source',
      build: () => {
        const production = cloneProduction();
        const [claim, ...claims] = production.claims;
        return { ...production, claims: [{ ...claim!, sourceIds: [] }, ...claims] };
      }
    },
    {
      name: "narration without claims",
      expectedError: 'Invalid GPT-Live production: narration "narration_hook" must reference at least one claim',
      build: () => {
        const production = cloneProduction();
        const [narration, ...narrations] = production.narration;
        return { ...production, narration: [{ ...narration!, claimIds: [] }, ...narrations] };
      }
    },
    {
      name: "evidence with an unknown source",
      expectedError:
        'Invalid GPT-Live production: evidence "evidence_translation_video" references unknown source "src_missing"',
      build: () => replaceEvidence(cloneProduction(), 0, { sourceId: "src_missing" })
    },
    {
      name: "evidence with a non-canonical source URL",
      expectedError:
        'Invalid GPT-Live production: evidence "evidence_translation_video" canonical URL does not match source "src_openai_article"',
      build: () => replaceEvidence(cloneProduction(), 0, { canonicalUrl: "https://openai.com/" })
    },
    {
      name: "evidence with a non-HTTPS canonical URL",
      expectedError:
        'Invalid GPT-Live production: evidence "evidence_openai_availability" canonical URL must be a valid HTTPS URL',
      build: () => {
        const production = cloneProduction();
        return replaceEvidence(
          {
            ...production,
            sources: production.sources.map((source) =>
              source.id === "src_openai_help"
                ? { ...source, url: "http://help.openai.com/en/articles/20001274/" }
                : source
            )
          },
          4,
          { canonicalUrl: "http://help.openai.com/en/articles/20001274/" }
        );
      }
    },
    {
      name: "evidence with publisher drift",
      expectedError:
        'Invalid GPT-Live production: evidence "evidence_translation_video" publisher does not match source "src_openai_article"',
      build: () => replaceEvidence(cloneProduction(), 0, { publisher: "OpenAI News" })
    },
    {
      name: "evidence with a non-HTTPS media URL",
      expectedError:
        'Invalid GPT-Live production: evidence "evidence_translation_video" media URL must be a valid HTTPS URL',
      build: () =>
        replaceEvidence(cloneProduction(), 0, {
          mediaUrl: "http://openai.com/index/introducing-gpt-live/?video=1208096618"
        })
    },
    {
      name: "evidence with a media URL on another publisher domain",
      expectedError:
        'Invalid GPT-Live production: evidence "evidence_translation_video" media URL must use the source publisher domain',
      build: () =>
        replaceEvidence(cloneProduction(), 0, {
          mediaUrl: "https://example.com/index/introducing-gpt-live/?video=1208096618"
        })
    },
    {
      name: "evidence with a media URL on the canonical parent domain",
      expectedError:
        'Invalid GPT-Live production: evidence "evidence_openai_availability" media URL must use the source publisher domain',
      build: () =>
        replaceEvidence(cloneProduction(), 4, {
          mediaUrl: "https://openai.com/video"
        })
    },
    {
      name: "evidence with a media URL on a canonical subdomain",
      expectedError:
        'Invalid GPT-Live production: evidence "evidence_translation_video" media URL must use the source publisher domain',
      build: () =>
        replaceEvidence(cloneProduction(), 0, {
          mediaUrl: "https://media.openai.com/video"
        })
    },
    {
      name: "evidence with an attacker subdomain of a short canonical host",
      expectedError:
        'Invalid GPT-Live production: evidence "evidence_openai_availability" media URL must use the source publisher domain',
      build: () => {
        const production = cloneProduction();
        return replaceEvidence(
          {
            ...production,
            sources: production.sources.map((source) =>
              source.id === "src_openai_help"
                ? { ...source, url: "https://co.uk/article" }
                : source
            )
          },
          4,
          {
            canonicalUrl: "https://co.uk/article",
            mediaUrl: "https://attacker.co.uk/video"
          }
        );
      }
    },
    {
      name: "evidence with a top-level media domain suffix",
      expectedError:
        'Invalid GPT-Live production: evidence "evidence_translation_video" media URL must use the source publisher domain',
      build: () =>
        replaceEvidence(cloneProduction(), 0, {
          mediaUrl: "https://com/video"
        })
    },
    {
      name: "captured evidence with an absolute asset path",
      expectedError:
        'Invalid GPT-Live production: evidence "evidence_openai_full_duplex" asset path must be relative and below evidence/',
      build: () =>
        replaceEvidence(cloneProduction(), 2, {
          assetPath: "/evidence/openai-gpt-live-full-duplex.png"
        })
    },
    {
      name: "captured evidence with a traversing asset path",
      expectedError:
        'Invalid GPT-Live production: evidence "evidence_openai_full_duplex" asset path must be relative and below evidence/',
      build: () =>
        replaceEvidence(cloneProduction(), 2, {
          assetPath: "evidence/../source/clip_interruption.mp4"
        })
    },
    {
      name: "captured evidence with Windows-style traversal",
      expectedError:
        'Invalid GPT-Live production: evidence "evidence_openai_full_duplex" asset path must be relative and below evidence/',
      build: () =>
        replaceEvidence(cloneProduction(), 2, {
          assetPath: "evidence/foo\\..\\..\\outside.png"
        })
    },
    {
      name: "captured evidence with an empty path segment",
      expectedError:
        'Invalid GPT-Live production: evidence "evidence_openai_full_duplex" asset path must be relative and below evidence/',
      build: () =>
        replaceEvidence(cloneProduction(), 2, {
          assetPath: "evidence//openai-gpt-live-full-duplex.png"
        })
    },
    {
      name: "captured evidence with a dot path segment",
      expectedError:
        'Invalid GPT-Live production: evidence "evidence_openai_full_duplex" asset path must be relative and below evidence/',
      build: () =>
        replaceEvidence(cloneProduction(), 2, {
          assetPath: "evidence/./openai-gpt-live-full-duplex.png"
        })
    },
    {
      name: "source video evidence with a backslash",
      expectedError:
        'Invalid GPT-Live production: evidence "evidence_translation_video" asset path must be relative and below source/',
      build: () =>
        replaceEvidence(cloneProduction(), 0, {
          assetPath: "source/clip\\translation.mp4"
        })
    },
    {
      name: "source video evidence outside the source directory",
      expectedError:
        'Invalid GPT-Live production: evidence "evidence_translation_video" asset path must be relative and below source/',
      build: () =>
        replaceEvidence(cloneProduction(), 0, {
          assetPath: "evidence/clip_translation.mp4"
        })
    },
    {
      name: "evidence with a non-finite focal value",
      expectedError:
        'Invalid GPT-Live production: evidence "evidence_translation_video" focal x must be finite and within 0..1',
      build: () =>
        replaceEvidence(cloneProduction(), 0, {
          focalRect: { x: Number.NaN, y: 0, width: 1, height: 1 }
        })
    },
    {
      name: "evidence with a missing focal value",
      expectedError:
        'Invalid GPT-Live production: evidence "evidence_translation_video" focal width must be finite and within 0..1',
      build: () =>
        replaceEvidence(cloneProduction(), 0, {
          focalRect: { x: 0, y: 0, height: 1 }
        })
    },
    {
      name: "evidence with a focal value below zero",
      expectedError:
        'Invalid GPT-Live production: evidence "evidence_translation_video" focal y must be finite and within 0..1',
      build: () =>
        replaceEvidence(cloneProduction(), 0, {
          focalRect: { x: 0, y: -0.1, width: 1, height: 1 }
        })
    },
    {
      name: "evidence with a focal value above one",
      expectedError:
        'Invalid GPT-Live production: evidence "evidence_translation_video" focal width must be finite and within 0..1',
      build: () =>
        replaceEvidence(cloneProduction(), 0, {
          focalRect: { x: 0, y: 0, width: 1.1, height: 1 }
        })
    },
    {
      name: "evidence whose horizontal focal bounds exceed one",
      expectedError:
        'Invalid GPT-Live production: evidence "evidence_openai_full_duplex" focal x + width must not exceed 1',
      build: () =>
        replaceEvidence(cloneProduction(), 2, {
          focalRect: { x: 0.5, y: 0.18, width: 0.64, height: 0.34 }
        })
    },
    {
      name: "evidence whose vertical focal bounds exceed one",
      expectedError:
        'Invalid GPT-Live production: evidence "evidence_openai_full_duplex" focal y + height must not exceed 1',
      build: () =>
        replaceEvidence(cloneProduction(), 2, {
          focalRect: { x: 0.18, y: 0.8, width: 0.64, height: 0.34 }
        })
    },
    {
      name: "evidence with an unknown narration scene",
      expectedError:
        'Invalid GPT-Live production: evidence "evidence_translation_video" references unknown narration scene "missing"',
      build: () => replaceEvidence(cloneProduction(), 0, { scene: "missing" })
    }
  ])("rejects $name", ({ build, expectedError }) => {
    expect(() => validateProductionManifest(build())).toThrow(expectedError);
  });

  it("accepts a media URL with the exact canonical hostname", () => {
    const production = replaceEvidence(cloneProduction(), 0, {
      mediaUrl: "https://openai.com/video"
    });

    expect(() => validateProductionManifest(production)).not.toThrow();
  });

  it("recursively freezes the exported production graph", () => {
    const representativeValues = [
      GPT_LIVE_CONTENT,
      GPT_LIVE_CONTENT.variants,
      GPT_LIVE_CONTENT.sources,
      GPT_LIVE_CONTENT.sources[0],
      GPT_LIVE_CONTENT.claims,
      GPT_LIVE_CONTENT.claims[0],
      GPT_LIVE_CONTENT.claims[0]?.sourceIds,
      GPT_LIVE_CONTENT.narration,
      GPT_LIVE_CONTENT.narration[0],
      GPT_LIVE_CONTENT.narration[0]?.claimIds,
      GPT_LIVE_CONTENT.evidence,
      GPT_LIVE_CONTENT.evidence[0],
      GPT_LIVE_CONTENT.evidence[0]?.focalRect,
      GPT_LIVE_CONTENT.audio,
      GPT_LIVE_TIMELINE,
      GPT_LIVE_TIMELINE[0],
      GPT_LIVE_CONTENT.branding
    ];

    for (const value of representativeValues) {
      expect(Object.isFrozen(value)).toBe(true);
    }
  });

  it("prevents mutation of frozen nested records and arrays", () => {
    const mutableBranding = GPT_LIVE_CONTENT.branding as unknown as { width: number };
    const mutableFocalRect = GPT_LIVE_CONTENT.evidence[0]!.focalRect as unknown as { width: number };
    const mutableAudio = GPT_LIVE_CONTENT.audio as unknown as { outroDurationSeconds: number };
    const mutableTimeline = GPT_LIVE_TIMELINE as unknown as unknown[];

    expect(() => {
      mutableBranding.width = 200;
    }).toThrow(TypeError);
    expect(() => {
      mutableFocalRect.width = 0.5;
    }).toThrow(TypeError);
    expect(() => {
      mutableAudio.outroDurationSeconds = 8;
    }).toThrow(TypeError);
    expect(() => mutableTimeline.push({})).toThrow(TypeError);
    expect(GPT_LIVE_CONTENT.branding.width).toBe(150);
    expect(GPT_LIVE_CONTENT.evidence[0]!.focalRect.width).toBe(1);
    expect(GPT_LIVE_CONTENT.audio.outroDurationSeconds).toBe(7);
    expect(GPT_LIVE_TIMELINE).toHaveLength(9);
  });
});
