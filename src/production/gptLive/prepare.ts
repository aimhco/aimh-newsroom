import { createHash } from "node:crypto";
import { constants } from "node:fs";
import {
  access as defaultAccess,
  rm as defaultRm,
  stat as defaultStat
} from "node:fs/promises";
import { isAbsolute, join, parse } from "node:path";
import type { ScriptFile } from "../../types";
import { runCommand as defaultRunCommand } from "../../render/process";
import { ensureDir as defaultEnsureDir } from "../../utils/fs";
import {
  synthesizeNarration as defaultSynthesizeNarration,
  type VoiceRenderResult
} from "../../voice/elevenLabsAdapter";
import { GPT_LIVE_CONTENT } from "./content";
import {
  writeJsonAtomic as defaultWriteJsonAtomic,
  writeTextAtomic as defaultWriteTextAtomic
} from "./atomicFiles";
import { extractSourceClip as defaultExtractSourceClip } from "./media";
import {
  assertNarrationSlateContract,
  inspectMediaFile as defaultInspectMediaFile
} from "./mediaInspection";
import {
  renderGptLivePlates as defaultRenderGptLivePlates,
  type RenderGptLivePlatesOptions
} from "./renderPlates";
import { buildTellaPlan, type TellaPlan } from "./tellaPlan";

const EPISODE_SUBDIRECTORIES = [
  "source",
  "voice",
  "master",
  "plates",
  "tella",
  "exports",
  "final",
  "reports"
] as const;

export interface NarrationSlateArgsOptions {
  readonly audioPath: string;
  readonly durationSeconds: number;
  readonly outputPath: string;
}

export interface PrepareGptLiveProductionOptions {
  readonly episodeDir: string;
  readonly env: Record<string, string | undefined>;
  readonly ffmpegPath: string;
  readonly ffprobePath: string;
}

interface FileStat {
  readonly size: number;
  isFile(): boolean;
}

type SynthesizeNarration = (
  options: Parameters<typeof defaultSynthesizeNarration>[0]
) => Promise<VoiceRenderResult>;
type AccessFile = (path: string, mode?: number) => Promise<void>;
type RenderPlates = (options: RenderGptLivePlatesOptions) => Promise<unknown>;

export interface PrepareGptLiveProductionDependencies {
  readonly access?: AccessFile;
  readonly ensureDir?: typeof defaultEnsureDir;
  readonly extractSourceClip?: typeof defaultExtractSourceClip;
  readonly synthesizeNarration?: SynthesizeNarration;
  readonly runCommand?: typeof defaultRunCommand;
  readonly inspectMediaFile?: typeof defaultInspectMediaFile;
  readonly removeFile?: (path: string) => Promise<void>;
  readonly renderPlates?: RenderPlates;
  readonly stat?: (path: string) => Promise<FileStat>;
  readonly writeJsonAtomic?: typeof defaultWriteJsonAtomic;
  readonly writeTextAtomic?: typeof defaultWriteTextAtomic;
}

export interface PrepareGptLiveProductionResult {
  readonly episodeDir: string;
  readonly productionPath: string;
  readonly voicePath: string;
  readonly planPath: string;
  readonly sourceMatrixPath: string;
  readonly preparedPath: string;
  readonly script: ScriptFile;
  readonly voice: VoiceRenderResult;
  readonly plan: TellaPlan;
}

const estimatedNarrationSeconds = (text: string): number =>
  Math.max(1, Number((text.trim().split(/\s+/).length / 2.5).toFixed(1)));

const buildScript = (): ScriptFile => ({
  schema_version: "0.1.0",
  voice: {
    provider: "elevenlabs",
    voice_id_env: "ELEVENLABS_VOICE_ID",
    style: "clear, conversational AIMH newsroom narration"
  },
  narration: GPT_LIVE_CONTENT.narration.map((item) => ({
    id: item.id,
    segment_id: item.scene,
    text: item.text,
    estimated_seconds: estimatedNarrationSeconds(item.text),
    claim_ids: [...item.claimIds],
    shot_ids: []
  }))
});

const requireConfiguredValue = (value: string | undefined, label: string): string => {
  if (!value?.trim()) throw new Error(`GPT-Live preflight failed: ${label} is not configured`);
  return value;
};

const runPreflight = async (
  options: PrepareGptLiveProductionOptions,
  access: AccessFile
): Promise<void> => {
  if (!isAbsolute(options.episodeDir) || options.episodeDir === parse(options.episodeDir).root) {
    throw new Error("GPT-Live preflight failed: episode destination is invalid");
  }
  if (!options.env.ELEVENLABS_API_KEY?.trim() || !options.env.ELEVENLABS_VOICE_ID?.trim()) {
    throw new Error("GPT-Live preflight failed: ElevenLabs credentials are required");
  }
  requireConfiguredValue(options.ffmpegPath, "ffmpeg path");
  requireConfiguredValue(options.ffprobePath, "ffprobe path");
  const logoPath = requireConfiguredValue(options.env.AIMH_LOGO_PATH, "AIMH logo path");
  const musicPath = requireConfiguredValue(
    options.env.AIMH_BODY_MUSIC_PATH,
    "AIMH body music path"
  );

  try {
    await access(logoPath, constants.R_OK);
  } catch {
    throw new Error("GPT-Live preflight failed: AIMH logo is not readable");
  }
  try {
    await access(musicPath, constants.R_OK);
  } catch {
    throw new Error("GPT-Live preflight failed: AIMH body music is not readable");
  }
};

export function buildNarrationSlateArgs(options: NarrationSlateArgsOptions): string[] {
  if (!Number.isFinite(options.durationSeconds) || options.durationSeconds <= 0) {
    throw new Error("Narration slate duration must be finite and positive");
  }
  const duration = options.durationSeconds.toFixed(3);

  return [
    "-y",
    "-f",
    "lavfi",
    "-i",
    `color=c=black:s=1920x1080:r=30:d=${duration}`,
    "-i",
    options.audioPath,
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
    duration,
    "-movflags",
    "+faststart",
    options.outputPath
  ];
}

const validatedVoiceChunks = async (
  voice: VoiceRenderResult,
  voiceDir: string,
  stat: (path: string) => Promise<FileStat>
): Promise<VoiceRenderResult["chunks"]> => {
  if (voice.provider !== "elevenlabs") {
    throw new Error("ElevenLabs narration required; fallback providers are not allowed");
  }
  if (voice.warnings.length > 0) {
    throw new Error("Narration synthesis returned warnings; refusing fallback output");
  }
  if (voice.chunks.length !== GPT_LIVE_CONTENT.narration.length) {
    throw new Error("Invalid ElevenLabs narration chunk count");
  }

  for (const [index, narration] of GPT_LIVE_CONTENT.narration.entries()) {
    const chunk = voice.chunks[index];
    const expectedFile = join(voiceDir, `${narration.id}.mp3`);
    if (
      chunk?.id !== narration.id ||
      chunk.provider !== "elevenlabs" ||
      chunk.file !== expectedFile ||
      !Number.isFinite(chunk.durationSeconds) ||
      chunk.durationSeconds <= 0
    ) {
      throw new Error(`Invalid ElevenLabs narration chunk: ${narration.id}`);
    }

    let fileStat: FileStat;
    try {
      fileStat = await stat(chunk.file);
    } catch {
      throw new Error(`Invalid ElevenLabs narration chunk file: ${narration.id}`);
    }
    if (!fileStat.isFile() || fileStat.size <= 0) {
      throw new Error(`Invalid ElevenLabs narration chunk file: ${narration.id}`);
    }
  }

  return voice.chunks;
};

const markdownCell = (value: string): string => value.replaceAll("|", "\\|").replaceAll("\n", " ");

const renderSourceMatrix = (): string => {
  const sources = new Map<string, (typeof GPT_LIVE_CONTENT.sources)[number]>(
    GPT_LIVE_CONTENT.sources.map((source) => [source.id, source])
  );
  const claims = new Map<string, (typeof GPT_LIVE_CONTENT.claims)[number]>(
    GPT_LIVE_CONTENT.claims.map((claim) => [claim.id, claim])
  );
  const sourceLink = (sourceId: string): string => {
    const source = sources.get(sourceId);
    if (!source) throw new Error(`Source matrix references unknown source: ${sourceId}`);
    return `[${markdownCell(source.title)}](${source.url})`;
  };

  const claimRows = GPT_LIVE_CONTENT.claims.flatMap((claim) =>
    claim.sourceIds.map(
      (sourceId) => `| ${claim.id} | ${markdownCell(claim.text)} | ${sourceLink(sourceId)} |`
    )
  );
  const narrationRows = GPT_LIVE_CONTENT.narration.map((narration) => {
    const sourceIds = new Set<string>();
    for (const claimId of narration.claimIds) {
      const claim = claims.get(claimId);
      if (!claim) throw new Error(`Source matrix references unknown claim: ${claimId}`);
      for (const sourceId of claim.sourceIds) sourceIds.add(sourceId);
    }
    return `| ${narration.id} | ${narration.claimIds.join(", ")} | ${[...sourceIds]
      .map(sourceLink)
      .join("<br>")} |`;
  });

  return [
    "# GPT-Live Source Matrix",
    "",
    "## Claims",
    "",
    "| Claim | Approved wording | Sources |",
    "| --- | --- | --- |",
    ...claimRows,
    "",
    "## Narration",
    "",
    "| Narration | Claims | Sources |",
    "| --- | --- | --- |",
    ...narrationRows,
    ""
  ].join("\n");
};

export async function prepareGptLiveProduction(
  options: PrepareGptLiveProductionOptions,
  dependencies: PrepareGptLiveProductionDependencies = {}
): Promise<PrepareGptLiveProductionResult> {
  const access = dependencies.access ?? defaultAccess;
  const ensureDir = dependencies.ensureDir ?? defaultEnsureDir;
  const extractSourceClip = dependencies.extractSourceClip ?? defaultExtractSourceClip;
  const synthesizeNarration = dependencies.synthesizeNarration ?? defaultSynthesizeNarration;
  const runCommand = dependencies.runCommand ?? defaultRunCommand;
  const inspectMediaFile = dependencies.inspectMediaFile ?? defaultInspectMediaFile;
  const removeFile =
    dependencies.removeFile ?? ((path: string) => defaultRm(path, { force: true }));
  const renderPlates = dependencies.renderPlates ?? ((renderOptions) =>
    defaultRenderGptLivePlates(renderOptions));
  const stat = dependencies.stat ?? defaultStat;
  const writeJsonAtomic = dependencies.writeJsonAtomic ?? defaultWriteJsonAtomic;
  const writeTextAtomic = dependencies.writeTextAtomic ?? defaultWriteTextAtomic;
  const preparedPath = join(options.episodeDir, "reports", "prepared.json");

  await runPreflight(options, access);
  await removeFile(preparedPath);

  await Promise.all(
    EPISODE_SUBDIRECTORIES.map((directory) => ensureDir(join(options.episodeDir, directory)))
  );

  for (const item of GPT_LIVE_CONTENT.timeline) {
    if (item.kind !== "source_clip") continue;
    await extractSourceClip({
      playerConfigUrl: item.playerConfigUrl,
      startSeconds: item.startSeconds,
      endSeconds: item.endSeconds,
      outputPath: join(options.episodeDir, "source", `${item.id}.mp4`),
      ffmpegPath: options.ffmpegPath,
      ffprobePath: options.ffprobePath
    });
  }

  const script = buildScript();
  const voiceDir = join(options.episodeDir, "voice");
  const voice = await synthesizeNarration({
    script,
    outDir: voiceDir,
    env: options.env,
    ffprobePath: options.ffprobePath,
    allowElevenLabs: true
  });
  const chunks = await validatedVoiceChunks(voice, voiceDir, stat);

  for (const chunk of chunks) {
    const outputPath = join(options.episodeDir, "master", `${chunk.id}.mp4`);
    await runCommand(
      options.ffmpegPath,
      buildNarrationSlateArgs({
        audioPath: chunk.file,
        durationSeconds: chunk.durationSeconds,
        outputPath
      })
    );
    const inspection = await inspectMediaFile(options.ffprobePath, outputPath);
    assertNarrationSlateContract(inspection, chunk.durationSeconds);
  }

  const plan = buildTellaPlan({
    episodeDir: options.episodeDir,
    narrationAssets: chunks.map((chunk) => ({
      id: chunk.id,
      audioPath: chunk.file,
      durationSeconds: chunk.durationSeconds
    }))
  });
  await renderPlates({
    episodeDir: options.episodeDir,
    ffprobePath: options.ffprobePath,
    narrationRecords: chunks.map((chunk) => ({
      id: chunk.id,
      text: chunk.text,
      durationSeconds: chunk.durationSeconds
    })),
    publishPlan: false
  });
  const productionPath = join(options.episodeDir, "production.json");
  const voicePath = join(options.episodeDir, "voice", "narration.json");
  const planPath = join(options.episodeDir, "tella", "plan.json");
  const sourceMatrixPath = join(options.episodeDir, "reports", "source-matrix.md");
  const production = {
    schemaVersion: "0.1.0",
    ...GPT_LIVE_CONTENT,
    branding: {
      ...GPT_LIVE_CONTENT.branding,
      logoPath: options.env.AIMH_LOGO_PATH ?? GPT_LIVE_CONTENT.branding.logoPath
    },
    musicPath: options.env.AIMH_BODY_MUSIC_PATH ?? GPT_LIVE_CONTENT.musicPath
  };
  const sourceMatrix = renderSourceMatrix();
  const manifestFingerprint = createHash("sha256")
    .update(JSON.stringify({ production, voice, plan, sourceMatrix }))
    .digest("hex");
  const prepared = {
    schemaVersion: "0.1.0",
    status: "prepared",
    productionId: GPT_LIVE_CONTENT.id,
    manifestFingerprint
  } as const;

  await writeJsonAtomic(productionPath, production);
  await writeJsonAtomic(voicePath, voice);
  await writeJsonAtomic(planPath, plan);
  await writeTextAtomic(sourceMatrixPath, sourceMatrix);
  await writeJsonAtomic(preparedPath, prepared);

  return {
    episodeDir: options.episodeDir,
    productionPath,
    voicePath,
    planPath,
    sourceMatrixPath,
    preparedPath,
    script,
    voice,
    plan
  };
}
