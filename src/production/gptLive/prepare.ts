import { constants } from "node:fs";
import {
  access as defaultAccess,
  lstat as defaultLstat,
  readFile as defaultReadFile,
  realpath as defaultRealpath,
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
import { resolveEvidenceAssetPath, validateEvidenceAssets } from "./evidence";
import { extractSourceClip as defaultExtractSourceClip } from "./media";
import {
  buildPreparationFingerprint,
  derivePreparedArtifactDescriptors,
  hashPreparedArtifactDescriptors,
  type PreparedArtifactDescriptor,
  type ReadPreparedArtifactBytes
} from "./preparation";
import {
  assertNarrationSlateContract,
  inspectMediaFile as defaultInspectMediaFile
} from "./mediaInspection";
import {
  renderGptLivePlates as defaultRenderGptLivePlates,
  type RenderGptLivePlatesOptions
} from "./renderPlates";
import { validateContainedEpisodePaths } from "./qa/paths";
import type { GptLiveSourceManifest } from "./qa/types";
import { buildTellaPlan, type TellaPlan } from "./tellaPlan";
import type { EvidenceSpec, ProductionClaim } from "./types";

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
  readonly lstat?: typeof defaultLstat;
  readonly realpath?: typeof defaultRealpath;
  readonly readFileBytes?: ReadPreparedArtifactBytes;
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
  readonly sourceManifestPath: string;
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
  const outroMusicPath = requireConfiguredValue(
    options.env.AIMH_OUTRO_MUSIC_PATH,
    "AIMH outro music path"
  );

  try {
    await access(logoPath, constants.R_OK);
  } catch {
    throw new Error("GPT-Live preflight failed: AIMH logo is not readable");
  }
  try {
    await access(outroMusicPath, constants.R_OK);
  } catch {
    throw new Error("GPT-Live preflight failed: AIMH outro music is not readable");
  }
};

const validateAbsolutePreparedArtifacts = async (
  artifacts: readonly PreparedArtifactDescriptor[],
  lstat: typeof defaultLstat
): Promise<void> => {
  for (const artifact of artifacts.filter((candidate) => isAbsolute(candidate.path))) {
    let file;
    try {
      file = await lstat(artifact.absolutePath);
    } catch (error) {
      throw new Error(`Prepared artifact is missing or unreadable: ${artifact.logicalId}`, {
        cause: error
      });
    }
    if (file.isSymbolicLink()) {
      throw new Error(`Prepared artifact path must not be a symlink: ${artifact.logicalId}`);
    }
    if (file.isDirectory() || !file.isFile()) {
      throw new Error(`Prepared artifact path is not a regular file: ${artifact.logicalId}`);
    }
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

const unique = <T>(values: readonly T[]): T[] => [...new Set(values)];

export function buildSourceManifest(): GptLiveSourceManifest {
  const evidenceItems: readonly EvidenceSpec[] = GPT_LIVE_CONTENT.evidence;
  const claims: readonly ProductionClaim[] = GPT_LIVE_CONTENT.claims;
  return {
    schemaVersion: "0.1.0",
    productionId: GPT_LIVE_CONTENT.id,
    sources: GPT_LIVE_CONTENT.sources.map((source) => {
      const evidence = evidenceItems.filter((item) => item.sourceId === source.id);
      const mediaUrls = unique(evidence.flatMap((item) => item.mediaUrl ? [item.mediaUrl] : []));
      return {
        sourceId: source.id,
        publisher: source.publisher,
        title: source.title,
        canonicalUrl: source.url,
        mediaUrls,
        scenes: unique(evidence.map((item) => item.scene)),
        claims: claims
          .filter((claim) => claim.sourceIds.some((sourceId) => sourceId === source.id))
          .map((claim) => claim.id),
        onScreenAttribution: unique(evidence.map((item) => item.displayUrl)),
        playbackDecisions: unique(evidence.map((item) => item.playbackDecision)),
        youtubeDescription: evidence.length > 0
      };
    })
  };
}

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
  const lstat = dependencies.lstat ?? defaultLstat;
  const realpath = dependencies.realpath ?? defaultRealpath;
  const readFileBytes = dependencies.readFileBytes ??
    ((path: string) => defaultReadFile(path) as Promise<Uint8Array>);
  const removeFile =
    dependencies.removeFile ?? ((path: string) => defaultRm(path, { force: true }));
  const renderPlates = dependencies.renderPlates ?? ((renderOptions) =>
    defaultRenderGptLivePlates(renderOptions));
  const stat = dependencies.stat ?? defaultStat;
  const writeJsonAtomic = dependencies.writeJsonAtomic ?? defaultWriteJsonAtomic;
  const writeTextAtomic = dependencies.writeTextAtomic ?? defaultWriteTextAtomic;
  const sourceManifestPath = join(options.episodeDir, "reports", "source-manifest.json");
  const fixedDescendantPaths = [
    ...EPISODE_SUBDIRECTORIES.map((directory) => join(options.episodeDir, directory)),
    join(options.episodeDir, "production.json"),
    ...GPT_LIVE_CONTENT.evidence
      .filter((evidence) => evidence.playbackDecision === "captured_source")
      .map((evidence) => resolveEvidenceAssetPath(options.episodeDir, evidence)),
    ...GPT_LIVE_CONTENT.timeline.flatMap((item) => item.kind === "source_clip"
      ? [join(options.episodeDir, "source", `${item.id}.mp4`)]
      : [
          join(options.episodeDir, "voice", `${item.id}.mp3`),
          join(options.episodeDir, "voice", `${item.id}.mp3.json`),
          join(options.episodeDir, "master", `${item.id}.mp4`)
        ]),
    join(options.episodeDir, "voice", "narration.json"),
    join(options.episodeDir, "tella", "plan.json"),
    join(options.episodeDir, "reports", "source-matrix.md"),
    sourceManifestPath,
    join(options.episodeDir, "reports", "prepared.json")
  ];
  const preparedPath = join(options.episodeDir, "reports", "prepared.json");

  await validateContainedEpisodePaths(options.episodeDir, fixedDescendantPaths, {
    lstat,
    realpath,
    context: "GPT-Live preparation",
    allowMissingEpisodeDir: true
  });
  await runPreflight(options, access);
  await validateEvidenceAssets(options.episodeDir, GPT_LIVE_CONTENT.evidence, {
    lstat,
    realpath
  });

  await Promise.all(
    EPISODE_SUBDIRECTORIES.map((directory) => ensureDir(join(options.episodeDir, directory)))
  );
  await validateContainedEpisodePaths(options.episodeDir, fixedDescendantPaths, {
    lstat,
    realpath,
    context: "GPT-Live preparation"
  });
  await removeFile(preparedPath);

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
  const sourceManifest = buildSourceManifest();
  const production = {
    schemaVersion: "0.1.0",
    ...GPT_LIVE_CONTENT,
    branding: {
      ...GPT_LIVE_CONTENT.branding,
      logoPath: options.env.AIMH_LOGO_PATH ?? GPT_LIVE_CONTENT.branding.logoPath
    },
    audio: {
      ...GPT_LIVE_CONTENT.audio,
      outroMusicPath:
        options.env.AIMH_OUTRO_MUSIC_PATH ?? GPT_LIVE_CONTENT.audio.outroMusicPath
    }
  };
  const sourceMatrix = renderSourceMatrix();
  const artifactDescriptors = derivePreparedArtifactDescriptors({
    episodeDir: options.episodeDir,
    production,
    voice,
    plan
  });
  await validateContainedEpisodePaths(
    options.episodeDir,
    artifactDescriptors
      .filter((artifact) => !isAbsolute(artifact.path))
      .map((artifact) => artifact.absolutePath),
    { lstat, realpath, context: "GPT-Live prepared artifacts" }
  );
  await validateAbsolutePreparedArtifacts(artifactDescriptors, lstat);
  const artifacts = await hashPreparedArtifactDescriptors(artifactDescriptors, readFileBytes);
  const manifestFingerprint = buildPreparationFingerprint({
    production,
    voice,
    plan,
    sourceMatrix,
    sourceManifest,
    artifacts
  });
  const prepared = {
    schemaVersion: "0.1.0",
    status: "prepared",
    productionId: GPT_LIVE_CONTENT.id,
    artifacts,
    manifestFingerprint
  } as const;

  await writeJsonAtomic(productionPath, production);
  await writeJsonAtomic(voicePath, voice);
  await writeJsonAtomic(planPath, plan);
  await writeTextAtomic(sourceMatrixPath, sourceMatrix);
  await writeJsonAtomic(sourceManifestPath, sourceManifest);
  await writeJsonAtomic(preparedPath, prepared);

  return {
    episodeDir: options.episodeDir,
    productionPath,
    voicePath,
    planPath,
    sourceMatrixPath,
    sourceManifestPath,
    preparedPath,
    script,
    voice,
    plan
  };
}
