import { stat as defaultStat } from "node:fs/promises";
import { join } from "node:path";
import type { ScriptFile } from "../../types";
import {
  ffprobeDurationSeconds as defaultFfprobeDurationSeconds,
  runCommand as defaultRunCommand
} from "../../render/process";
import {
  ensureDir as defaultEnsureDir,
  writeJson as defaultWriteJson,
  writeText as defaultWriteText
} from "../../utils/fs";
import {
  synthesizeNarration as defaultSynthesizeNarration,
  type VoiceRenderResult
} from "../../voice/elevenLabsAdapter";
import { GPT_LIVE_CONTENT } from "./content";
import { extractSourceClip as defaultExtractSourceClip } from "./media";
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
const SLATE_DURATION_TOLERANCE_SECONDS = 0.1;

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

export interface PrepareGptLiveProductionDependencies {
  readonly ensureDir?: typeof defaultEnsureDir;
  readonly extractSourceClip?: typeof defaultExtractSourceClip;
  readonly synthesizeNarration?: typeof defaultSynthesizeNarration;
  readonly runCommand?: typeof defaultRunCommand;
  readonly ffprobeDurationSeconds?: typeof defaultFfprobeDurationSeconds;
  readonly stat?: (path: string) => Promise<FileStat>;
  readonly writeJson?: typeof defaultWriteJson;
  readonly writeText?: typeof defaultWriteText;
}

export interface PrepareGptLiveProductionResult {
  readonly episodeDir: string;
  readonly productionPath: string;
  readonly voicePath: string;
  readonly planPath: string;
  readonly sourceMatrixPath: string;
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
  const ensureDir = dependencies.ensureDir ?? defaultEnsureDir;
  const extractSourceClip = dependencies.extractSourceClip ?? defaultExtractSourceClip;
  const synthesizeNarration = dependencies.synthesizeNarration ?? defaultSynthesizeNarration;
  const runCommand = dependencies.runCommand ?? defaultRunCommand;
  const ffprobeDurationSeconds =
    dependencies.ffprobeDurationSeconds ?? defaultFfprobeDurationSeconds;
  const stat = dependencies.stat ?? defaultStat;
  const writeJson = dependencies.writeJson ?? defaultWriteJson;
  const writeText = dependencies.writeText ?? defaultWriteText;

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
    const slateDuration = await ffprobeDurationSeconds(options.ffprobePath, outputPath);
    if (
      !Number.isFinite(slateDuration) ||
      Math.abs(slateDuration - chunk.durationSeconds) > SLATE_DURATION_TOLERANCE_SECONDS
    ) {
      throw new Error(
        `Narration slate duration mismatch: ${chunk.id} expected ${chunk.durationSeconds.toFixed(3)}s, received ${slateDuration.toFixed(3)}s`
      );
    }
  }

  const plan = buildTellaPlan({
    episodeDir: options.episodeDir,
    narrationAssets: chunks.map((chunk) => ({
      id: chunk.id,
      audioPath: chunk.file,
      durationSeconds: chunk.durationSeconds
    }))
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

  await writeJson(productionPath, production);
  await writeJson(voicePath, voice);
  await writeJson(planPath, plan);
  await writeText(sourceMatrixPath, renderSourceMatrix());

  return {
    episodeDir: options.episodeDir,
    productionPath,
    voicePath,
    planPath,
    sourceMatrixPath,
    script,
    voice,
    plan
  };
}
