import { readFile as defaultReadFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { bundle as defaultBundle } from "@remotion/bundler";
import {
  renderMedia as defaultRenderMedia,
  selectComposition as defaultSelectComposition
} from "@remotion/renderer";
import { ensureDir as defaultEnsureDir } from "../../utils/fs";
import { writeJsonAtomic as defaultWriteJsonAtomic } from "./atomicFiles";
import { GPT_LIVE_CONTENT } from "./content";
import {
  assertNarrationSlateContract,
  inspectMediaFile as defaultInspectMediaFile,
  type MediaInspection
} from "./mediaInspection";
import type { GptLiveClaimLabel, GptLivePlateProps } from "./motion/Root";
import { buildTellaPlan, type TellaPlan } from "./tellaPlan";
import type { GptLiveVariant, NarrationSpec } from "./types";

const FRAME_RATE_TOLERANCE = 0.001;
const DURATION_TOLERANCE_SECONDS = 0.1;
const COMPOSITION_ID = "GptLivePlate";

export interface PlateNarrationRecord {
  readonly id: string;
  readonly text: string;
  readonly durationSeconds: number;
}

export interface PlateRenderJob {
  readonly narrationId: string;
  readonly variant: GptLiveVariant;
  readonly scene: NarrationSpec["scene"];
  readonly durationSeconds: number;
  readonly outputPath: string;
  readonly inputProps: GptLivePlateProps;
}

export interface BuildPlateRenderJobsOptions {
  readonly episodeDir: string;
  readonly narrationRecords: readonly PlateNarrationRecord[];
}

export interface RenderGptLivePlatesOptions {
  readonly episodeDir: string;
  readonly ffprobePath: string;
  readonly narrationRecords?: readonly PlateNarrationRecord[];
  readonly publishPlan?: boolean;
}

interface RenderMediaOptions {
  readonly composition: unknown;
  readonly serveUrl: string;
  readonly codec: "h264";
  readonly outputLocation: string;
  readonly inputProps: GptLivePlateProps;
  readonly muted: true;
  readonly enforceAudioTrack: false;
  readonly overwrite: true;
  readonly pixelFormat: "yuv420p";
}

export interface RenderGptLivePlatesDependencies {
  readonly bundle?: (options: { readonly entryPoint: string }) => Promise<string>;
  readonly ensureDir?: (path: string) => Promise<void>;
  readonly inspectMediaFile?: typeof defaultInspectMediaFile;
  readonly readFile?: (path: string, encoding: "utf8") => Promise<string>;
  readonly renderMedia?: (options: RenderMediaOptions) => Promise<unknown>;
  readonly selectComposition?: (options: {
    readonly serveUrl: string;
    readonly id: string;
    readonly inputProps: GptLivePlateProps;
  }) => Promise<unknown>;
  readonly writeJsonAtomic?: typeof defaultWriteJsonAtomic;
}

export interface RenderGptLivePlatesResult {
  readonly jobs: readonly PlateRenderJob[];
  readonly plan: TellaPlan;
  readonly planPath: string;
}

interface VoiceNarrationFile {
  readonly provider?: unknown;
  readonly warnings?: unknown;
  readonly chunks?: unknown;
}

const isRecord = (value: unknown): value is Record<string, unknown> =>
  value !== null && typeof value === "object" && !Array.isArray(value);

export async function readPlateNarrationRecords(
  episodeDir: string,
  readFile: (path: string, encoding: "utf8") => Promise<string> = defaultReadFile
): Promise<readonly PlateNarrationRecord[]> {
  const voicePath = join(episodeDir, "voice", "narration.json");
  let parsed: VoiceNarrationFile;
  try {
    parsed = JSON.parse(await readFile(voicePath, "utf8")) as VoiceNarrationFile;
  } catch {
    throw new Error(`Invalid GPT-Live voice data: unable to read ${voicePath}`);
  }
  if (
    parsed.provider !== "elevenlabs" ||
    !Array.isArray(parsed.warnings) ||
    parsed.warnings.length > 0 ||
    !Array.isArray(parsed.chunks)
  ) {
    throw new Error("Invalid GPT-Live voice data: verified ElevenLabs chunks are required");
  }

  return parsed.chunks.map((chunk, index) => {
    if (!isRecord(chunk)) {
      throw new Error(`Invalid GPT-Live voice data: chunk ${index + 1} is malformed`);
    }
    const id = chunk.id;
    const text = chunk.text;
    const durationSeconds = chunk.durationSeconds;
    if (
      typeof id !== "string" ||
      typeof text !== "string" ||
      typeof durationSeconds !== "number"
    ) {
      throw new Error(`Invalid GPT-Live voice data: chunk ${index + 1} is malformed`);
    }
    return { id, text, durationSeconds };
  });
}

const narrationMap = (
  records: readonly PlateNarrationRecord[]
): ReadonlyMap<string, PlateNarrationRecord> => {
  const expected = new Set<string>(GPT_LIVE_CONTENT.narration.map(({ id }) => id));
  const byId = new Map<string, PlateNarrationRecord>();
  for (const record of records) {
    if (!expected.has(record.id)) throw new Error(`Unknown plate narration: ${record.id}`);
    if (byId.has(record.id)) throw new Error(`Duplicate plate narration: ${record.id}`);
    if (!Number.isFinite(record.durationSeconds) || record.durationSeconds <= 0) {
      throw new Error(`Invalid plate narration duration: ${record.id}`);
    }
    byId.set(record.id, record);
  }
  for (const id of expected) {
    if (!byId.has(id)) throw new Error(`Missing plate narration: ${id}`);
  }
  return byId;
};

const claimLabelsFor = (narration: NarrationSpec): readonly GptLiveClaimLabel[] => {
  const claimById = new Map<string, (typeof GPT_LIVE_CONTENT.claims)[number]>(
    GPT_LIVE_CONTENT.claims.map((claim) => [claim.id, claim])
  );
  const sourceById = new Map<string, (typeof GPT_LIVE_CONTENT.sources)[number]>(
    GPT_LIVE_CONTENT.sources.map((source) => [source.id, source])
  );
  return narration.claimIds.map((claimId) => {
    const claim = claimById.get(claimId);
    if (!claim) throw new Error(`Missing plate claim: ${claimId}`);
    return {
      label: claim.text,
      source: claim.sourceIds
        .map((sourceId) => sourceById.get(sourceId)?.publisher)
        .filter((publisher) => publisher !== undefined)
        .join(" + ")
    };
  });
};

export function buildPlateRenderJobs(options: BuildPlateRenderJobsOptions): readonly PlateRenderJob[] {
  const records = narrationMap(options.narrationRecords);
  return GPT_LIVE_CONTENT.narration.flatMap((narration) => {
    const record = records.get(narration.id)!;
    return GPT_LIVE_CONTENT.variants.map((variant) => ({
      narrationId: narration.id,
      variant,
      scene: narration.scene,
      durationSeconds: record.durationSeconds,
      outputPath: join(options.episodeDir, "plates", variant, `${narration.id}.mp4`),
      inputProps: {
        variant,
        scene: narration.scene,
        durationSeconds: record.durationSeconds,
        narrationId: narration.id,
        text: record.text,
        claimLabels: claimLabelsFor(narration)
      }
    }));
  });
}

export function assertPlateContract(
  plateInspection: MediaInspection,
  slateInspection: MediaInspection
): void {
  const durationComparisonEpsilon =
    Number.EPSILON *
    Math.max(1, Math.abs(plateInspection.durationSeconds), Math.abs(slateInspection.durationSeconds)) *
    4;
  if (plateInspection.video.codecName !== "h264") {
    throw new Error("Motion plate must use H.264 video");
  }
  if (plateInspection.video.width !== 1920 || plateInspection.video.height !== 1080) {
    throw new Error("Motion plate must be 1920x1080");
  }
  if (Math.abs(plateInspection.video.framesPerSecond - 30) > FRAME_RATE_TOLERANCE) {
    throw new Error("Motion plate must be 30fps");
  }
  if (plateInspection.audio) throw new Error("Motion plate must not contain audio");
  if (
    !Number.isFinite(plateInspection.durationSeconds) ||
    !Number.isFinite(slateInspection.durationSeconds) ||
    Math.abs(plateInspection.durationSeconds - slateInspection.durationSeconds) >
      DURATION_TOLERANCE_SECONDS + durationComparisonEpsilon
  ) {
    throw new Error(
      `Motion plate/slate duration mismatch: slate ${slateInspection.durationSeconds.toFixed(3)}s, plate ${plateInspection.durationSeconds.toFixed(3)}s`
    );
  }
}

export async function renderGptLivePlates(
  options: RenderGptLivePlatesOptions,
  dependencies: RenderGptLivePlatesDependencies = {}
): Promise<RenderGptLivePlatesResult> {
  const ensureDir = dependencies.ensureDir ?? defaultEnsureDir;
  const inspectMediaFile = dependencies.inspectMediaFile ?? defaultInspectMediaFile;
  const bundle = dependencies.bundle ?? ((args) => defaultBundle(args));
  const selectComposition = dependencies.selectComposition ??
    ((args) => defaultSelectComposition(args));
  const renderMedia = dependencies.renderMedia ?? (async (args) => {
    await defaultRenderMedia({
      ...args,
      composition: args.composition as Parameters<typeof defaultRenderMedia>[0]["composition"]
    });
  });
  const writeJsonAtomic = dependencies.writeJsonAtomic ?? defaultWriteJsonAtomic;
  const narrationRecords = options.narrationRecords ??
    await readPlateNarrationRecords(options.episodeDir, dependencies.readFile ?? defaultReadFile);
  const jobs = buildPlateRenderJobs({
    episodeDir: options.episodeDir,
    narrationRecords
  });
  const plan = buildTellaPlan({
    episodeDir: options.episodeDir,
    narrationAssets: narrationRecords.map((record) => ({
      id: record.id,
      audioPath: join(options.episodeDir, "voice", `${record.id}.mp3`),
      durationSeconds: record.durationSeconds
    }))
  });
  const planPath = join(options.episodeDir, "tella", "plan.json");
  const narrationPlanById = new Map(
    plan.clips
      .filter((clip) => clip.kind === "narration")
      .map((clip) => [clip.id, clip])
  );
  const entryPoint = fileURLToPath(new URL("./motion/Root.tsx", import.meta.url));
  const serveUrl = await bundle({ entryPoint });

  for (const job of jobs) {
    await ensureDir(dirname(job.outputPath));
    const composition = await selectComposition({
      serveUrl,
      id: COMPOSITION_ID,
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
    const narrationPlan = narrationPlanById.get(job.narrationId);
    if (!narrationPlan) {
      throw new Error(`Missing narration slate plan: ${job.narrationId}`);
    }
    const plateInspection = await inspectMediaFile(options.ffprobePath, job.outputPath);
    const slateInspection = await inspectMediaFile(options.ffprobePath, narrationPlan.masterPath);
    assertNarrationSlateContract(slateInspection, job.durationSeconds);
    assertPlateContract(plateInspection, slateInspection);
  }

  if (options.publishPlan !== false) {
    await writeJsonAtomic(planPath, plan);
  }
  return { jobs, plan, planPath };
}
