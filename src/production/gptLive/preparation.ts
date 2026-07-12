import { createHash } from "node:crypto";
import { isAbsolute, join, relative, resolve, sep } from "node:path";
import { GPT_LIVE_CONTENT } from "./content";
import { resolveEvidenceAssetPath } from "./evidence";
import { buildTellaPlan } from "./tellaPlan";

export interface PreparationFingerprintInput {
  readonly production: unknown;
  readonly voice: unknown;
  readonly plan: unknown;
  readonly sourceMatrix: string;
  readonly sourceManifest: unknown;
  readonly artifacts: readonly PreparedArtifactBinding[];
}

export interface PreparedArtifactBinding {
  readonly logicalId: string;
  readonly path: string;
  readonly sha256: string;
  readonly byteSize: number;
}

export interface PreparedArtifactDescriptor {
  readonly logicalId: string;
  readonly path: string;
  readonly absolutePath: string;
}

export interface PreparedArtifactDescriptorInput {
  readonly episodeDir: string;
  readonly production: unknown;
  readonly voice: unknown;
  readonly plan: unknown;
}

export type ReadPreparedArtifactBytes = (path: string) => Promise<Uint8Array>;

export interface PreparedGenerationRecord {
  readonly schemaVersion: "0.1.0";
  readonly status: "prepared";
  readonly productionId: string;
  readonly artifacts: readonly PreparedArtifactBinding[];
  readonly manifestFingerprint: string;
}

const HASH = /^[a-f0-9]{64}$/;
const LOGICAL_ID = /^[a-z][a-z0-9_-]*(?::[a-z0-9][a-z0-9_-]*)+$/;
const PREPARED_KEYS = [
  "schemaVersion",
  "status",
  "productionId",
  "artifacts",
  "manifestFingerprint"
] as const;
const ARTIFACT_KEYS = ["logicalId", "path", "sha256", "byteSize"] as const;

const isRecord = (value: unknown): value is Record<string, unknown> =>
  value !== null && typeof value === "object" && !Array.isArray(value);

const isWithinEpisode = (episodeRoot: string, path: string): boolean => {
  const descendant = relative(episodeRoot, path);
  return descendant.length > 0 &&
    descendant !== ".." &&
    !descendant.startsWith(`..${sep}`) &&
    !isAbsolute(descendant);
};

const serializedArtifactPath = (episodeRoot: string, absolutePath: string): string =>
  isWithinEpisode(episodeRoot, absolutePath)
    ? relative(episodeRoot, absolutePath).split(sep).join("/")
    : absolutePath;

const requiredAbsoluteAssetPath = (value: unknown, label: string): string => {
  if (typeof value !== "string" || !value.trim() || value !== value.trim() || !isAbsolute(value)) {
    throw new Error(`Invalid prepared artifact ${label} path`);
  }
  return resolve(value);
};

export function derivePreparedArtifactDescriptors(
  input: PreparedArtifactDescriptorInput
): readonly PreparedArtifactDescriptor[] {
  const episodeRoot = resolve(input.episodeDir);
  if (!isRecord(input.production) || input.production.id !== GPT_LIVE_CONTENT.id) {
    throw new Error("Invalid prepared artifact production manifest");
  }
  const branding = isRecord(input.production.branding) ? input.production.branding : undefined;
  const audio = isRecord(input.production.audio) ? input.production.audio : undefined;
  const logoPath = requiredAbsoluteAssetPath(branding?.logoPath, "logo");
  const outroPath = requiredAbsoluteAssetPath(audio?.outroMusicPath, "outro");

  if (!isRecord(input.voice) || !Array.isArray(input.voice.chunks)) {
    throw new Error("Invalid prepared artifact voice manifest");
  }
  const voiceChunks = input.voice.chunks as unknown[];
  const narrationAssets = GPT_LIVE_CONTENT.narration.map((narration, index) => {
    const chunk = voiceChunks[index];
    const expectedAudioPath = join(episodeRoot, "voice", `${narration.id}.mp3`);
    if (
      !isRecord(chunk) ||
      chunk.id !== narration.id ||
      chunk.file !== expectedAudioPath ||
      typeof chunk.durationSeconds !== "number" ||
      !Number.isFinite(chunk.durationSeconds) ||
      chunk.durationSeconds <= 0
    ) {
      throw new Error(`Invalid prepared artifact voice chunk: ${narration.id}`);
    }
    return {
      id: narration.id,
      audioPath: expectedAudioPath,
      durationSeconds: chunk.durationSeconds
    };
  });
  if (voiceChunks.length !== narrationAssets.length) {
    throw new Error("Invalid prepared artifact voice chunk count");
  }

  const expectedPlan = buildTellaPlan({ episodeDir: episodeRoot, narrationAssets });
  if (
    !isRecord(input.plan) ||
    input.plan.schemaVersion !== expectedPlan.schemaVersion ||
    input.plan.productionId !== expectedPlan.productionId ||
    !Array.isArray(input.plan.clips) ||
    input.plan.clips.length !== expectedPlan.clips.length
  ) {
    throw new Error("Invalid prepared artifact Tella plan");
  }
  for (const [index, expectedClip] of expectedPlan.clips.entries()) {
    const candidate = input.plan.clips[index];
    if (!isRecord(candidate)) throw new Error("Invalid prepared artifact Tella plan");
    const comparable = expectedClip.kind === "source_clip"
      ? { ...candidate, durationSeconds: expectedClip.durationSeconds }
      : candidate;
    if (
      !Number.isFinite(candidate.durationSeconds) ||
      (candidate.durationSeconds as number) <= 0 ||
      JSON.stringify(comparable) !== JSON.stringify(expectedClip)
    ) {
      throw new Error("Invalid prepared artifact Tella plan");
    }
  }

  const descriptors = [
    ...GPT_LIVE_CONTENT.evidence
      .filter((evidence) => evidence.playbackDecision === "captured_source")
      .map((evidence) => ({
        logicalId: `evidence:${evidence.id}`,
        absolutePath: resolveEvidenceAssetPath(episodeRoot, evidence)
      })),
    ...GPT_LIVE_CONTENT.timeline
      .filter((item) => item.kind === "source_clip")
      .map((item) => ({
        logicalId: `source:${item.id}`,
        absolutePath: join(episodeRoot, "source", `${item.id}.mp4`)
      })),
    ...GPT_LIVE_CONTENT.narration.map((narration) => ({
      logicalId: `voice:${narration.id}`,
      absolutePath: join(episodeRoot, "voice", `${narration.id}.mp3`)
    })),
    ...GPT_LIVE_CONTENT.narration.map((narration) => ({
      logicalId: `master:${narration.id}`,
      absolutePath: join(episodeRoot, "master", `${narration.id}.mp4`)
    })),
    ...GPT_LIVE_CONTENT.narration.flatMap((narration) =>
      GPT_LIVE_CONTENT.variants.map((variant) => ({
        logicalId: `plate:${variant}:${narration.id}`,
        absolutePath: join(episodeRoot, "plates", variant, `${narration.id}.mp4`)
      }))
    ),
    { logicalId: "branding:logo", absolutePath: logoPath },
    { logicalId: "audio:outro", absolutePath: outroPath }
  ];

  return descriptors.map((descriptor) => ({
    ...descriptor,
    path: serializedArtifactPath(episodeRoot, descriptor.absolutePath)
  }));
}

export async function hashPreparedArtifactDescriptors(
  descriptors: readonly PreparedArtifactDescriptor[],
  readFileBytes: ReadPreparedArtifactBytes
): Promise<readonly PreparedArtifactBinding[]> {
  return Promise.all(descriptors.map(async ({ logicalId, path, absolutePath }) => {
    let bytes: Uint8Array;
    try {
      bytes = await readFileBytes(absolutePath);
    } catch (error) {
      throw new Error(
        `Prepared artifact is missing or unreadable: ${logicalId} (${error instanceof Error ? error.message : String(error)})`
      );
    }
    if (bytes.byteLength <= 0) {
      throw new Error(`Prepared artifact is empty: ${logicalId}`);
    }
    return {
      logicalId,
      path,
      sha256: createHash("sha256").update(bytes).digest("hex"),
      byteSize: bytes.byteLength
    };
  }));
}

const hasExactKeys = (
  value: Record<string, unknown>,
  expectedKeys: readonly string[]
): boolean => {
  const keys = Object.keys(value);
  return keys.length === expectedKeys.length &&
    expectedKeys.every((key) => Object.hasOwn(value, key));
};

const parsePreparedArtifactBindings = (value: unknown): readonly PreparedArtifactBinding[] => {
  if (!Array.isArray(value) || value.length === 0) {
    throw new Error("Invalid prepared generation record");
  }
  const logicalIds = new Set<string>();
  const paths = new Set<string>();
  return value.map((item) => {
    if (
      !isRecord(item) ||
      !hasExactKeys(item, ARTIFACT_KEYS) ||
      typeof item.logicalId !== "string" ||
      !LOGICAL_ID.test(item.logicalId) ||
      logicalIds.has(item.logicalId) ||
      typeof item.path !== "string" ||
      !item.path.trim() ||
      item.path !== item.path.trim() ||
      item.path.includes("\0") ||
      paths.has(item.path) ||
      typeof item.sha256 !== "string" ||
      !HASH.test(item.sha256) ||
      !Number.isSafeInteger(item.byteSize) ||
      (item.byteSize as number) <= 0
    ) {
      throw new Error("Invalid prepared generation record");
    }
    logicalIds.add(item.logicalId);
    paths.add(item.path);
    return item as unknown as PreparedArtifactBinding;
  });
};

export function buildPreparationFingerprint(input: PreparationFingerprintInput): string {
  return createHash("sha256").update(JSON.stringify(input)).digest("hex");
}

export function parsePreparedGenerationRecord(
  value: unknown,
  expectedProductionId: string
): PreparedGenerationRecord {
  if (!isRecord(value)) throw new Error("Invalid prepared generation record");
  if (
    !hasExactKeys(value, PREPARED_KEYS) ||
    value.schemaVersion !== "0.1.0" ||
    value.status !== "prepared" ||
    value.productionId !== expectedProductionId ||
    typeof value.manifestFingerprint !== "string" ||
    !HASH.test(value.manifestFingerprint)
  ) {
    throw new Error("Invalid prepared generation record");
  }
  parsePreparedArtifactBindings(value.artifacts);
  return value as unknown as PreparedGenerationRecord;
}

export function validatePreparedGeneration(
  preparedValue: unknown,
  expectedProductionId: string,
  input: PreparationFingerprintInput
): PreparedGenerationRecord {
  const prepared = parsePreparedGenerationRecord(preparedValue, expectedProductionId);
  if (JSON.stringify(prepared.artifacts) !== JSON.stringify(input.artifacts)) {
    throw new Error("Prepared artifact mismatch with current production artifacts");
  }
  const currentFingerprint = buildPreparationFingerprint(input);
  if (prepared.manifestFingerprint !== currentFingerprint) {
    throw new Error(
      "Prepared generation fingerprint does not match current production records"
    );
  }
  return prepared;
}
