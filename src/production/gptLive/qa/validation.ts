import { createHash } from "node:crypto";
import { basename, join } from "node:path";
import { GPT_LIVE_CONTENT, validateProductionManifest } from "../content";
import {
  assertFinalMediaContract,
  assertSourceOutputLoudness,
  assertVariantDurationParity,
  buildLogoFilter,
  deriveSharedSourceGains,
  deriveSourceDuckIntervals,
  type SourceIntervalGain
} from "../finish";
import { assertNarrationSlateContract } from "../mediaInspection";
import { GPT_LIVE_SCENES } from "../motion/sceneStyle";
import { buildSourceManifest } from "../prepare";
import { assertPlateContract } from "../renderPlates";
import { buildTellaPlan } from "../tellaPlan";
import type { EvidenceSpec, GptLiveProduction, ProductionClaim } from "../types";
import { buildSpeechRequestBody, buildVoiceCacheKey } from "../../../voice/elevenLabsAdapter";
import type {
  GptLiveQaSnapshot,
  QaPreparedMediaInspection,
  QaProduction,
  QaVariantName,
  QaVoice
} from "./types";

const VARIANTS = ["version-a", "version-b"] as const;
const PLATE_VARIANTS = ["dynamic_editorial", "aimh_visual_host"] as const;
const HASH = /^[a-f0-9]{64}$/;
const FRAME_RATE_TOLERANCE = 0.001;
const SOURCE_DURATION_TOLERANCE_SECONDS = 0.25;
const TAIL_SIGNAL_FLOOR_DB = -50;
const UNSAFE_URL_PARAMETER_SUFFIXES = [
  "token",
  "signature",
  "key",
  "expires",
  "credential"
] as const;

const fail = (detail: string): never => {
  throw new Error(`GPT-Live QA failed: ${detail}`);
};

const isRecord = (value: unknown): value is Record<string, unknown> =>
  value !== null && typeof value === "object" && !Array.isArray(value);

const requireRecord = (value: unknown, label: string): Record<string, unknown> => {
  if (!isRecord(value)) fail(`${label} must be an object`);
  return value as Record<string, unknown>;
};

const exact = (actual: unknown, expected: unknown, label: string): void => {
  if (JSON.stringify(actual) !== JSON.stringify(expected)) fail(`${label} does not match the approved contract`);
};

const uniqueStringArray = (value: unknown, label: string): string[] => {
  if (!Array.isArray(value) || value.some((item) => typeof item !== "string" || !item.trim())) {
    fail(`${label} must be an array of non-empty strings`);
  }
  const values = value as string[];
  if (new Set(values).size !== values.length) fail(`${label} must contain unique values`);
  return values;
};

const safeHttpsUrl = (value: unknown, label: string): string => {
  if (typeof value !== "string" || !value.trim()) fail(`${label} must be a non-empty URL`);
  const parsed = (() => {
    try {
      return new URL(value as string);
    } catch {
      return fail(`${label} must be a valid HTTPS URL`);
    }
  })();
  if (parsed.protocol !== "https:" || parsed.username || parsed.password) {
    fail(`${label} must be a safe HTTPS URL without credentials`);
  }
  for (const key of parsed.searchParams.keys()) {
    const normalized = key.toLowerCase().replaceAll(/[^a-z]/g, "");
    if (UNSAFE_URL_PARAMETER_SUFFIXES.some((suffix) => normalized.endsWith(suffix))) {
      fail(`${label} contains an unsafe query parameter`);
    }
  }
  return value as string;
};

const validateSourceManifest = (snapshot: GptLiveQaSnapshot): void => {
  const manifest = requireRecord(snapshot.sourceManifest, "source manifest");
  exact(
    Object.keys(manifest).sort(),
    ["schemaVersion", "productionId", "sources"].sort(),
    "source manifest"
  );
  if (manifest.schemaVersion !== "0.1.0") fail("source manifest schema version is invalid");
  if (manifest.productionId !== GPT_LIVE_CONTENT.id) fail("source manifest production ID is invalid");
  const sourceValues = Array.isArray(manifest.sources)
    ? manifest.sources
    : fail("source manifest sources must be an array");

  const entries = sourceValues.map((value, index) => {
    const entry = requireRecord(value, `source manifest entry ${index + 1}`);
    const expectedKeys = [
      "sourceId",
      "publisher",
      "title",
      "canonicalUrl",
      "scenes",
      "claims",
      "onScreenAttribution",
      "playbackDecisions",
      "youtubeDescription",
      ...(Object.hasOwn(entry, "mediaUrls") ? ["mediaUrls"] : [])
    ];
    exact(Object.keys(entry).sort(), expectedKeys.sort(), `source manifest entry ${index + 1}`);
    if (
      typeof entry.sourceId !== "string" ||
      typeof entry.publisher !== "string" ||
      typeof entry.title !== "string" ||
      typeof entry.youtubeDescription !== "boolean"
    ) {
      fail(`source manifest entry ${index + 1} is malformed`);
    }
    safeHttpsUrl(entry.canonicalUrl, `source manifest canonical URL for ${entry.sourceId}`);
    uniqueStringArray(entry.scenes, `source manifest scenes for ${entry.sourceId}`);
    uniqueStringArray(entry.claims, `source manifest claims for ${entry.sourceId}`);
    uniqueStringArray(
      entry.onScreenAttribution,
      `source manifest on-screen attribution for ${entry.sourceId}`
    );
    uniqueStringArray(
      entry.playbackDecisions,
      `source manifest playback decisions for ${entry.sourceId}`
    );
    if (Object.hasOwn(entry, "mediaUrls")) {
      for (const mediaUrl of uniqueStringArray(
        entry.mediaUrls,
        `source manifest media URLs for ${entry.sourceId}`
      )) {
        safeHttpsUrl(mediaUrl, `source manifest media URL for ${entry.sourceId}`);
      }
    }
    return entry;
  });

  const sourceIds = entries.map((entry) => entry.sourceId as string);
  if (new Set(sourceIds).size !== sourceIds.length) fail("source manifest source IDs must be unique");
  exact(
    sourceIds,
    GPT_LIVE_CONTENT.sources.map((source) => source.id),
    "source manifest source coverage and order"
  );

  const expected = buildSourceManifest();
  const evidenceItems: readonly EvidenceSpec[] = GPT_LIVE_CONTENT.evidence;
  const claims: readonly ProductionClaim[] = GPT_LIVE_CONTENT.claims;
  for (const [index, expectedEntry] of expected.sources.entries()) {
    const entry = entries[index]!;
    const sourceEvidence = evidenceItems.filter(
      (evidence) => evidence.sourceId === expectedEntry.sourceId
    );
    const sourceClaims = claims
      .filter((claim) =>
        claim.sourceIds.some((sourceId) => sourceId === expectedEntry.sourceId)
      )
      .map((claim) => claim.id);

    exact(entry.publisher, expectedEntry.publisher, `source manifest publisher for ${expectedEntry.sourceId}`);
    exact(entry.title, expectedEntry.title, `source manifest title for ${expectedEntry.sourceId}`);
    exact(
      entry.canonicalUrl,
      expectedEntry.canonicalUrl,
      `source manifest canonical URL for ${expectedEntry.sourceId}`
    );
    exact(
      Object.hasOwn(entry, "mediaUrls") ? entry.mediaUrls : undefined,
      expectedEntry.mediaUrls,
      `source manifest media URLs for ${expectedEntry.sourceId}`
    );
    exact(entry.claims, sourceClaims, `source manifest claims for ${expectedEntry.sourceId}`);

    for (const evidence of sourceEvidence) {
      if (!(entry.scenes as string[]).includes(evidence.scene)) {
        fail(`source manifest is missing evidence scene ${evidence.scene} for ${evidence.id}`);
      }
      if (!(entry.onScreenAttribution as string[]).includes(evidence.displayUrl)) {
        fail(`source manifest is missing on-screen attribution for ${evidence.id}`);
      }
      if (!(entry.playbackDecisions as string[]).includes(evidence.playbackDecision)) {
        fail(`source manifest is missing playback decision for ${evidence.id}`);
      }
      if (
        evidence.mediaUrl &&
        !(entry.mediaUrls as string[] | undefined)?.includes(evidence.mediaUrl)
      ) {
        fail(`source manifest is missing media URL for ${evidence.id}`);
      }
      if (entry.youtubeDescription !== evidence.youtubeDescription) {
        fail(`source manifest YouTube-description flag does not map ${evidence.id}`);
      }
    }
    exact(entry.scenes, expectedEntry.scenes, `source manifest evidence scenes for ${expectedEntry.sourceId}`);
    exact(
      entry.onScreenAttribution,
      expectedEntry.onScreenAttribution,
      `source manifest on-screen attribution for ${expectedEntry.sourceId}`
    );
    exact(
      entry.playbackDecisions,
      expectedEntry.playbackDecisions,
      `source manifest playback decisions for ${expectedEntry.sourceId}`
    );
    exact(
      entry.youtubeDescription,
      expectedEntry.youtubeDescription,
      `source manifest YouTube-description flag for ${expectedEntry.sourceId}`
    );
  }
};

const keysExactly = (
  value: unknown,
  expected: readonly string[],
  label: string,
  requireStringValues = true
): Record<string, unknown> => {
  const record = requireRecord(value, label);
  const actualKeys = Object.keys(record).sort();
  const expectedKeys = [...expected].sort();
  exact(actualKeys, expectedKeys, `${label} keys`);
  for (const key of expected) {
    if (requireStringValues && (typeof record[key] !== "string" || !(record[key] as string).trim())) {
      fail(`${label} contains an invalid ID for ${key}`);
    }
  }
  return record;
};

const assertFile = (snapshot: GptLiveQaSnapshot, path: string, label: string): void => {
  if (snapshot.filePresence[path] !== true) fail(`${label} is missing`);
};

const assertUniqueValues = (record: Record<string, unknown>, label: string): void => {
  const values = Object.values(record);
  if (new Set(values).size !== values.length) fail(`${label} IDs must be unique`);
};

const assertGenericVideo = (
  inspection: QaPreparedMediaInspection,
  label: string,
  pixelFormats: readonly string[] = ["yuv420p"]
): void => {
  if (inspection.video.codecName !== "h264") fail(`${label} must use H.264 video`);
  if (inspection.video.width !== 1920 || inspection.video.height !== 1080) {
    fail(`${label} must be 1920x1080`);
  }
  if (Math.abs(inspection.video.framesPerSecond - 30) > FRAME_RATE_TOLERANCE) {
    fail(`${label} must be 30fps`);
  }
  if (!pixelFormats.includes(inspection.video.pixelFormat)) {
    fail(`${label} must use yuv420p-compatible output`);
  }
};

const assertPreparedAudio = (inspection: QaPreparedMediaInspection, label: string): void => {
  if (inspection.audio?.codecName !== "aac") fail(`${label} is missing or not AAC`);
  const audio = inspection.audio as NonNullable<QaPreparedMediaInspection["audio"]>;
  if (audio.sampleRate !== 48_000) fail(`${label} must be 48kHz`);
  if (audio.channels !== 2) fail(`${label} must be stereo`);
};

const validateProduction = (
  production: QaProduction,
  env: Readonly<Record<string, string | undefined>>
): void => {
  validateProductionManifest(production as unknown as GptLiveProduction);
  if (production.schemaVersion !== "0.1.0") fail("production schema version is invalid");

  const approvedCore = {
    id: GPT_LIVE_CONTENT.id,
    variants: GPT_LIVE_CONTENT.variants,
    sources: GPT_LIVE_CONTENT.sources,
    claims: GPT_LIVE_CONTENT.claims,
    narration: GPT_LIVE_CONTENT.narration,
    timeline: GPT_LIVE_CONTENT.timeline,
    evidence: GPT_LIVE_CONTENT.evidence
  };
  exact(
    {
      id: production.id,
      variants: production.variants,
      sources: production.sources,
      claims: production.claims,
      narration: production.narration,
      timeline: production.timeline,
      evidence: production.evidence
    },
    approvedCore,
    "production manifest"
  );

  const { outroMusicPath, ...audioPolicy } = production.audio;
  const canonicalAudioPolicy = {
    introMusic: GPT_LIVE_CONTENT.audio.introMusic,
    bodyMusic: GPT_LIVE_CONTENT.audio.bodyMusic,
    outroDurationSeconds: GPT_LIVE_CONTENT.audio.outroDurationSeconds
  };
  exact(audioPolicy, canonicalAudioPolicy, "production audio policy");
  const resolvedOutroMusicPath = env.AIMH_OUTRO_MUSIC_PATH;
  if (!resolvedOutroMusicPath?.trim() || outroMusicPath !== resolvedOutroMusicPath) {
    fail("production outro music path does not match the resolved QA environment");
  }

  const coveredSources = new Set(production.claims.flatMap((claim) => claim.sourceIds));
  for (const source of production.sources) {
    if (!coveredSources.has(source.id)) fail(`source ${source.id} is not covered by a claim`);
  }
  const coveredClaims = new Set(production.narration.flatMap((narration) => narration.claimIds));
  for (const claim of production.claims) {
    if (!coveredClaims.has(claim.id)) fail(`claim ${claim.id} is not covered by narration`);
  }

  exact(production.branding, GPT_LIVE_CONTENT.branding, "logo settings and path");
};

const validatePreparedFingerprint = (snapshot: GptLiveQaSnapshot): void => {
  const expected = createHash("sha256")
    .update(JSON.stringify({
      production: snapshot.production,
      voice: snapshot.voice,
      plan: snapshot.plan,
      sourceMatrix: snapshot.sourceMatrix,
      sourceManifest: snapshot.sourceManifest
    }))
    .digest("hex");
  if (
    snapshot.prepared.schemaVersion !== "0.1.0" ||
    snapshot.prepared.status !== "prepared" ||
    snapshot.prepared.productionId !== GPT_LIVE_CONTENT.id ||
    snapshot.prepared.manifestFingerprint !== expected
  ) {
    fail("prepared generation fingerprint does not match production records");
  }
};

const validateVoice = (snapshot: GptLiveQaSnapshot): void => {
  const voice = snapshot.voice;
  if (voice.provider !== "elevenlabs") fail("ElevenLabs voice provider is required");
  if (!Array.isArray(voice.warnings) || voice.warnings.length > 0) {
    fail("ElevenLabs voice warnings or fallback output are not allowed");
  }
  if (!Array.isArray(voice.chunks) || voice.chunks.length !== 7) {
    fail("voice/narration.json must contain exactly seven chunks");
  }

  for (const [index, narration] of GPT_LIVE_CONTENT.narration.entries()) {
    const chunk = voice.chunks[index];
    const expectedFile = join(snapshot.episodeDir, "voice", `${narration.id}.mp3`);
    if (
      !chunk ||
      chunk.id !== narration.id ||
      chunk.text !== narration.text ||
      chunk.provider !== "elevenlabs" ||
      chunk.file !== expectedFile ||
      !Number.isFinite(chunk.durationSeconds) ||
      chunk.durationSeconds <= 0 ||
      typeof chunk.cached !== "boolean"
    ) {
      fail(`invalid ElevenLabs voice chunk: ${narration.id}`);
    }
    assertFile(snapshot, expectedFile, `voice file ${narration.id}`);
    const metadataPath = `${expectedFile}.json`;
    assertFile(snapshot, metadataPath, `voice cache provenance ${narration.id}`);
    const metadata = snapshot.voiceCacheMetadata[narration.id];
    const expectedCacheKey = buildVoiceCacheKey({ text: narration.text, env: snapshot.env });
    const expectedModelId = String(buildSpeechRequestBody(narration.text, snapshot.env).model_id);
    if (
      !metadata ||
      metadata.schemaVersion !== "0.1.0" ||
      metadata.cacheKey !== expectedCacheKey ||
      metadata.modelId !== expectedModelId
    ) {
      fail(`invalid voice cache provenance: ${narration.id}`);
    }
  }
};

const validatePlan = (snapshot: GptLiveQaSnapshot): void => {
  const expected = buildTellaPlan({
    episodeDir: snapshot.episodeDir,
    narrationAssets: snapshot.voice.chunks.map((chunk) => ({
      id: chunk.id,
      audioPath: chunk.file,
      durationSeconds: chunk.durationSeconds
    }))
  });
  exact(snapshot.plan, expected, "Tella nine-clip plan");

  const platePaths = new Set<string>();
  for (const clip of snapshot.plan.clips) {
    if (clip.kind === "source_clip") {
      if (clip.preserveOriginalAudio !== true) fail(`source clip ${clip.id} must preserve original audio`);
      assertFile(snapshot, clip.mediaPath, `prepared source clip ${clip.id}`);
      continue;
    }
    assertFile(snapshot, clip.masterPath, `narration master ${clip.id}`);
    const a = clip.variants.dynamic_editorial;
    const b = clip.variants.aimh_visual_host;
    if (a.narrationAudioPath !== b.narrationAudioPath) {
      fail(`A/B narration audio is not shared for ${clip.id}`);
    }
    for (const variant of Object.values(clip.variants)) {
      platePaths.add(variant.platePath);
      assertFile(snapshot, variant.platePath, `motion plate ${clip.id}`);
    }
  }
  if (platePaths.size !== 14) fail("Tella plan must contain 14 distinct plate paths");
};

const scanUnsafeTellaState = (value: unknown, path = "tellaState"): void => {
  if (Array.isArray(value)) {
    value.forEach((item, index) => scanUnsafeTellaState(item, `${path}[${index}]`));
    return;
  }
  if (!isRecord(value)) {
    if (typeof value === "string" && /^https?:\/\//i.test(value)) {
      fail(`Tella state contains a presigned or remote URL at ${path}`);
    }
    return;
  }
  for (const [key, nested] of Object.entries(value)) {
    const normalized = key.toLowerCase().replaceAll(/[^a-z]/g, "");
    if (normalized === "uploadurl" || normalized === "signedurl") {
      fail(`Tella state contains unsafe URL field: ${key}`);
    }
    scanUnsafeTellaState(nested, `${path}.${key}`);
  }
};

const validateTellaState = (snapshot: GptLiveQaSnapshot): void => {
  scanUnsafeTellaState(snapshot.tellaState);
  const state = requireRecord(snapshot.tellaState, "Tella state");
  if (typeof state.masterVideoId !== "string" || !state.masterVideoId) fail("Tella master video ID is missing");
  const variantVideoIds = keysExactly(state.variantVideoIds, PLATE_VARIANTS, "Tella variant video IDs");
  assertUniqueValues(variantVideoIds, "Tella variant video");
  if (Object.values(variantVideoIds).includes(state.masterVideoId)) {
    fail("Tella master and A/B video IDs must be distinct");
  }

  const timelineIds = snapshot.plan.clips.map((clip) => clip.id);
  const plateSourceKeys = GPT_LIVE_CONTENT.narration.flatMap((narration) =>
    PLATE_VARIANTS.map((variant) => `plate:${variant}:${narration.id}`)
  );
  const sourceIds = keysExactly(state.sourceIds, [...timelineIds, ...plateSourceKeys], "Tella source IDs");
  assertUniqueValues(Object.fromEntries(timelineIds.map((key) => [key, sourceIds[key]])), "Tella base source");
  assertUniqueValues(Object.fromEntries(plateSourceKeys.map((key) => [key, sourceIds[key]])), "Tella plate source");
  const baseClipIds = keysExactly(state.clipIds, timelineIds, "Tella base clip IDs");
  assertUniqueValues(baseClipIds, "Tella base clip");
  const variantClipIds = keysExactly(
    state.variantClipIds,
    PLATE_VARIANTS,
    "Tella variant clip groups",
    false
  );
  for (const variant of PLATE_VARIANTS) {
    const clips = keysExactly(variantClipIds[variant], timelineIds, `Tella ${variant} clip IDs`);
    assertUniqueValues(clips, `Tella ${variant} clip`);
  }
  const layoutKeys = GPT_LIVE_CONTENT.narration.flatMap((narration) =>
    PLATE_VARIANTS.map((variant) => `${variant}:${narration.id}`)
  );
  const layoutIds = keysExactly(state.layoutIds, layoutKeys, "Tella layout IDs");
  assertUniqueValues(layoutIds, "Tella layout");
  const exportPaths = keysExactly(state.exportPaths, PLATE_VARIANTS, "Tella export paths");
  exact(exportPaths, {
    dynamic_editorial: join(snapshot.episodeDir, "exports", "tella-a.mp4"),
    aimh_visual_host: join(snapshot.episodeDir, "exports", "tella-b.mp4")
  }, "Tella export paths");
};

const validatePreparedMedia = (snapshot: GptLiveQaSnapshot): void => {
  const sourceClips = GPT_LIVE_CONTENT.timeline.filter((item) => item.kind === "source_clip");
  for (const clip of sourceClips) {
    const inspection = snapshot.media.sources[clip.id] ?? fail(`source media inspection missing: ${clip.id}`);
    assertGenericVideo(inspection, `source clip ${clip.id}`);
    assertPreparedAudio(inspection, `source audio for ${clip.id}`);
    const expectedDuration = clip.endSeconds - clip.startSeconds;
    if (Math.abs(inspection.durationSeconds - expectedDuration) > SOURCE_DURATION_TOLERANCE_SECONDS) {
      fail(`source clip duration mismatch: ${clip.id}`);
    }
  }

  for (const chunk of snapshot.voice.chunks) {
    const master = snapshot.media.masters[chunk.id] ?? fail(`master inspection missing: ${chunk.id}`);
    assertGenericVideo(master, `narration master ${chunk.id}`);
    assertPreparedAudio(master, `narration master audio ${chunk.id}`);
    try {
      assertNarrationSlateContract(master, chunk.durationSeconds);
    } catch (error) {
      fail(error instanceof Error ? error.message : String(error));
    }
    for (const variant of PLATE_VARIANTS) {
      const plate = snapshot.media.plates[`${variant}:${chunk.id}`] ??
        fail(`plate inspection missing: ${variant}:${chunk.id}`);
      assertGenericVideo(
        plate,
        `motion plate ${variant}:${chunk.id}`,
        ["yuv420p", "yuvj420p"]
      );
      try {
        assertPlateContract(plate, master);
      } catch (error) {
        fail(error instanceof Error ? error.message : String(error));
      }
    }
  }
};

interface PostVariant {
  name: QaVariantName;
  inputPath: string;
  outputPath: string;
  inputDurationSeconds: number;
  outputDurationSeconds: number;
  sha256: string;
  byteSize: number;
}

const postVariants = (post: Record<string, unknown>): PostVariant[] => {
  if (!Array.isArray(post.variants) || post.variants.length !== 2) fail("post-production variants are invalid");
  return post.variants as PostVariant[];
};

const validateFinals = (snapshot: GptLiveQaSnapshot): void => {
  const a = snapshot.media.finals["version-a"];
  const b = snapshot.media.finals["version-b"];
  if (a.durationSeconds < 120 || a.durationSeconds > 180 || b.durationSeconds < 120 || b.durationSeconds > 180) {
    fail("final duration must be between 120 and 180 seconds");
  }
  try {
    assertVariantDurationParity(a.durationSeconds, b.durationSeconds);
  } catch (error) {
    fail(error instanceof Error ? error.message : String(error));
  }

  const variants = postVariants(snapshot.postProduction);
  for (const name of VARIANTS) {
    const report = variants.find((variant) => variant.name === name) ?? fail(`missing ${name} report`);
    const final = snapshot.media.finals[name];
    try {
      assertFinalMediaContract(final, report.inputDurationSeconds);
    } catch (error) {
      fail(error instanceof Error ? error.message : String(error));
    }
    if (Math.abs(report.outputDurationSeconds - final.durationSeconds) > 0.001) {
      fail(`${name} report duration does not match final`);
    }
    if (!HASH.test(report.sha256) || !Number.isSafeInteger(report.byteSize) || report.byteSize <= 0) {
      fail(`${name} generation hash metadata is invalid`);
    }
  }
};

const validateBrandingAndAudio = (snapshot: GptLiveQaSnapshot): void => {
  const post = snapshot.postProduction;
  if (
    post.schemaVersion !== "0.2.0" ||
    post.status !== "finished" ||
    post.productionId !== GPT_LIVE_CONTENT.id ||
    post.generationId !== snapshot.generation.generationId
  ) {
    fail("post-production generation metadata is invalid or stale");
  }
  if (snapshot.logo.path !== GPT_LIVE_CONTENT.branding.logoPath || !HASH.test(snapshot.logo.sha256)) {
    fail("logo path or hash is invalid");
  }
  if (!isRecord(post.assets)) fail("post-production assets are invalid");
  exact(post.assets, {
    logo: "logo.png",
    logoSha256: snapshot.logo.sha256,
    music: basename(snapshot.production.audio.outroMusicPath)
  }, "post-production assets");

  if (!isRecord(post.settings)) fail("post-production settings are invalid");
  exact(post.settings, {
    logoFilter: buildLogoFilter(),
    dialogueVolume: 1,
    normalMusicVolume: 0.07,
    duckedMusicVolume: 0.02,
    musicLoop: true,
    audioMixDuration: "longest",
    exactAudioDuration: true,
    limiter: "limit=0.95:attack=5:release=50:level=false:latency=true",
    videoCodec: "libx264",
    crf: 18,
    preset: "medium",
    pixelFormat: "yuv420p",
    framesPerSecond: 30,
    audioCodec: "aac",
    audioBitrate: "192k",
    audioSampleRate: 48_000,
    audioChannels: 2,
    faststart: true,
    durationToleranceSeconds: 0.25,
    variantDurationToleranceSeconds: 0.5
  }, "identical A/B audio and finish settings");

  const expectedIntervals = deriveSourceDuckIntervals(snapshot.plan);
  exact(post.duckIntervals, expectedIntervals, "source dialogue intervals");
  const sourceDialogue = requireRecord(post.sourceDialogue, "source dialogue report");
  if (!Array.isArray(sourceDialogue.intervals)) {
    fail("source dialogue report is invalid");
  }
  if (
    sourceDialogue.targetLufs !== -23 ||
    sourceDialogue.gainClampDb !== 12 ||
    sourceDialogue.rampSeconds !== 0.1 ||
    sourceDialogue.toleranceLu !== 2
  ) {
    fail("source dialogue policy is outside documented ranges");
  }
  const intervals = sourceDialogue.intervals as Array<SourceIntervalGain & {
    outputLufsA: number;
    outputLufsB: number;
  }>;
  if (intervals.length !== expectedIntervals.length) fail("source dialogue interval count mismatch");
  const expectedGains = deriveSharedSourceGains(
    expectedIntervals,
    intervals.map((interval) => interval.measuredLufsA),
    intervals.map((interval) => interval.measuredLufsB)
  );
  for (const [index, gain] of expectedGains.entries()) {
    const actual = intervals[index]!;
    exact(
      {
        startSeconds: actual.startSeconds,
        endSeconds: actual.endSeconds,
        measuredLufsA: actual.measuredLufsA,
        measuredLufsB: actual.measuredLufsB,
        averageMeasuredLufs: actual.averageMeasuredLufs,
        targetLufs: actual.targetLufs,
        gainDb: actual.gainDb
      },
      gain,
      `source dialogue gain ${index + 1}`
    );
  }
  try {
    assertSourceOutputLoudness(
      expectedGains,
      intervals.map((interval) => interval.outputLufsA),
      intervals.map((interval) => interval.outputLufsB)
    );
  } catch (error) {
    fail(error instanceof Error ? error.message : String(error));
  }

  if (!Array.isArray(post.logoEvidence) || post.logoEvidence.length !== 2) {
    fail("rendered logo evidence is incomplete");
  }
  for (const name of VARIANTS) {
    const evidence = (post.logoEvidence as Array<Record<string, unknown>>)
      .find((item) => item.name === name);
    const samples = evidence && Array.isArray(evidence.samples) ? evidence.samples : null;
    if (!samples || samples.length !== 3) {
      fail(`rendered logo evidence is incomplete for ${name}`);
    }
    for (const sample of samples as Array<Record<string, unknown>>) {
      if (
        !HASH.test(String(sample.inputSha256)) ||
        !HASH.test(String(sample.outputSha256)) ||
        sample.inputSha256 === sample.outputSha256 ||
        !Number.isFinite(sample.timeSeconds)
      ) {
        fail(`rendered logo evidence is invalid for ${name}`);
      }
    }
  }
};

const validateSafeAreasAndTails = (snapshot: GptLiveQaSnapshot): void => {
  const expectedKeys = PLATE_VARIANTS.flatMap((variant) =>
    GPT_LIVE_SCENES.map((scene) => `${variant}:${scene}`)
  ).sort();
  exact(snapshot.safeAreas.map((area) => `${area.variant}:${area.scene}`).sort(), expectedKeys, "scene safe areas");
  for (const area of snapshot.safeAreas) {
    if (
      !Number.isFinite(area.x) ||
      !Number.isFinite(area.y) ||
      area.x < 0 ||
      area.y < 0 ||
      area.width < 198 ||
      area.height < 198
    ) {
      fail(`scene safe area is below 198x198: ${area.variant}:${area.scene}`);
    }
  }
  for (const name of VARIANTS) {
    const tail = snapshot.tailAudio[name];
    if (
      !Number.isFinite(tail.tailPeakDb) ||
      !Number.isFinite(tail.endPeakDb) ||
      tail.tailPeakDb <= TAIL_SIGNAL_FLOOR_DB ||
      tail.endPeakDb <= TAIL_SIGNAL_FLOOR_DB ||
      tail.tailSignalPresent !== true
    ) {
      fail(`${name} final tail signal is not present`);
    }
  }
};

const validateObservedIntegrityHashes = (snapshot: GptLiveQaSnapshot): void => {
  const sourceIds = GPT_LIVE_CONTENT.timeline
    .filter((item) => item.kind === "source_clip")
    .map((item) => item.id);
  exact(Object.keys(snapshot.observedIntegrityHashes.sources).sort(), [...sourceIds].sort(), "observed source integrity hash keys");
  exact(
    Object.keys(snapshot.observedIntegrityHashes.voice).sort(),
    GPT_LIVE_CONTENT.narration.map(({ id }) => id).sort(),
    "observed voice integrity hash keys"
  );
  for (const hash of [
    ...Object.values(snapshot.observedIntegrityHashes.sources),
    ...Object.values(snapshot.observedIntegrityHashes.voice)
  ]) {
    if (!HASH.test(hash)) fail("observed integrity hash is invalid");
  }
};

export function validateGptLiveQaSnapshot(snapshot: GptLiveQaSnapshot): void {
  if (snapshot.env.YOUTUBE_UPLOAD_ENABLED !== "false") {
    fail("YouTube upload must be disabled for QA");
  }
  validateProduction(snapshot.production, snapshot.env);
  validateSourceManifest(snapshot);
  validateVoice(snapshot);
  validatePlan(snapshot);
  validatePreparedFingerprint(snapshot);
  validateTellaState(snapshot);
  validatePreparedMedia(snapshot);
  validateFinals(snapshot);
  validateBrandingAndAudio(snapshot);
  validateSafeAreasAndTails(snapshot);
  validateObservedIntegrityHashes(snapshot);
}
