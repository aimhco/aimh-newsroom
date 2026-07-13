import { createHash, randomUUID as defaultRandomUUID } from "node:crypto";
import {
  readFile as defaultReadFile,
  rename as defaultRename,
  rm as defaultRm,
  stat as defaultStat,
  writeFile as defaultWriteFile
} from "node:fs/promises";
import type { ScriptFile } from "../types";
import { ensureDir } from "../utils/fs";
import { redactText } from "../utils/redact";
import { ffprobeDurationSeconds as defaultFfprobeDurationSeconds } from "../render/process";

type Env = Record<string, string | undefined>;
const DEFAULT_MODEL_ID = "eleven_multilingual_v2";
const VOICE_SETTINGS = { stability: 0.5, similarity_boost: 0.8 } as const;

interface VoiceCacheMetadata {
  readonly schemaVersion: "0.1.0";
  readonly cacheKey: string;
  readonly modelId: string;
}

export interface SynthesizeNarrationDependencies {
  readonly fetch?: typeof fetch;
  readonly readFile?: typeof defaultReadFile;
  readonly rename?: (from: string, to: string) => Promise<void>;
  readonly rm?: typeof defaultRm;
  readonly stat?: typeof defaultStat;
  readonly writeFile?: typeof defaultWriteFile;
  readonly ffprobeDurationSeconds?: typeof defaultFfprobeDurationSeconds;
  readonly randomUUID?: () => string;
}

export interface VoiceChunkResult {
  id: string;
  text: string;
  file: string;
  durationSeconds: number;
  provider: "elevenlabs" | "silent_placeholder";
  cached: boolean;
}

export interface VoiceRenderResult {
  provider: "elevenlabs" | "silent_placeholder";
  chunks: VoiceChunkResult[];
  warnings: string[];
}

export function prepareTextForSpeech(text: string): string {
  return text
    .replace(/\bwww\.aimh\.co\b/gi, "A-I-M-H dot co")
    .replace(/\baimh\.co\b/gi, "A-I-M-H dot co");
}

export function buildSpeechRequestBody(text: string, env: Env): Record<string, unknown> {
  const request: Record<string, unknown> = {
    text: prepareTextForSpeech(text),
    model_id: env.ELEVENLABS_MODEL_ID || DEFAULT_MODEL_ID,
    voice_settings: VOICE_SETTINGS
  };
  const dictionaryId = env.ELEVENLABS_PRONUNCIATION_DICTIONARY_ID;
  const versionId = env.ELEVENLABS_PRONUNCIATION_DICTIONARY_VERSION_ID;
  if (dictionaryId && versionId) {
    request.pronunciation_dictionary_locators = [
      {
        pronunciation_dictionary_id: dictionaryId,
        version_id: versionId
      }
    ];
  }
  return request;
}

export function buildVoiceCacheKey(options: { readonly text: string; readonly env: Env }): string {
  const request = buildSpeechRequestBody(options.text, options.env);
  return createHash("sha256")
    .update(
      JSON.stringify({
        voiceId: options.env.ELEVENLABS_VOICE_ID ?? "",
        request
      })
    )
    .digest("hex");
}

export const voiceCacheMetadataPath = (audioPath: string): string => `${audioPath}.json`;

const readMatchingCacheDuration = async (options: {
  readonly outFile: string;
  readonly cacheKey: string;
  readonly ffprobePath: string;
  readonly dependencies: Required<
    Pick<SynthesizeNarrationDependencies, "readFile" | "stat" | "ffprobeDurationSeconds">
  >;
}): Promise<number | undefined> => {
  try {
    const metadata = JSON.parse(
      await options.dependencies.readFile(voiceCacheMetadataPath(options.outFile), "utf8")
    ) as Partial<VoiceCacheMetadata>;
    if (metadata.schemaVersion !== "0.1.0" || metadata.cacheKey !== options.cacheKey) {
      return undefined;
    }

    const audioStat = await options.dependencies.stat(options.outFile);
    if (!audioStat.isFile() || audioStat.size <= 0) return undefined;
    const duration = await options.dependencies.ffprobeDurationSeconds(
      options.ffprobePath,
      options.outFile
    );
    return Number.isFinite(duration) && duration > 0 ? duration : undefined;
  } catch {
    return undefined;
  }
};

async function synthesizeElevenLabsChunk(options: {
  paragraph: ScriptFile["narration"][number];
  outFile: string;
  env: Env;
  ffprobePath: string;
  dependencies: Required<SynthesizeNarrationDependencies>;
}): Promise<VoiceChunkResult> {
  const apiKey = options.env.ELEVENLABS_API_KEY;
  const voiceId = options.env.ELEVENLABS_VOICE_ID;
  if (!apiKey || !voiceId) throw new Error("ELEVENLABS_API_KEY and ELEVENLABS_VOICE_ID must be set");

  const requestBody = buildSpeechRequestBody(options.paragraph.text, options.env);
  const cacheKey = buildVoiceCacheKey({ text: options.paragraph.text, env: options.env });
  const cachedDuration = await readMatchingCacheDuration({
    outFile: options.outFile,
    cacheKey,
    ffprobePath: options.ffprobePath,
    dependencies: options.dependencies
  });
  if (cachedDuration !== undefined) {
    return {
      id: options.paragraph.id,
      text: options.paragraph.text,
      file: options.outFile,
      durationSeconds: cachedDuration,
      provider: "elevenlabs",
      cached: true
    };
  }

  const res = await options.dependencies.fetch(`https://api.elevenlabs.io/v1/text-to-speech/${voiceId}`, {
    method: "POST",
    headers: {
      "Accept": "audio/mpeg",
      "Content-Type": "application/json",
      "xi-api-key": apiKey
    },
    body: JSON.stringify(requestBody)
  });

  if (!res.ok) {
    const retryAfter = res.headers.get("retry-after");
    const body = redactText(await res.text());
    throw new Error(
      `ElevenLabs ${res.status}${retryAfter ? ` retry-after=${retryAfter}` : ""}${body ? `: ${body}` : ""}`
    );
  }

  const audio = Buffer.from(await res.arrayBuffer());
  if (audio.length === 0) throw new Error("ElevenLabs returned empty audio");

  const metadataPath = voiceCacheMetadataPath(options.outFile);
  const tempId = options.dependencies.randomUUID();
  const tempAudioPath = `${options.outFile}.tmp-${tempId}.mp3`;
  const tempMetadataPath = `${metadataPath}.tmp-${tempId}`;
  const metadata: VoiceCacheMetadata = {
    schemaVersion: "0.1.0",
    cacheKey,
    modelId: String(requestBody.model_id)
  };

  try {
    await options.dependencies.rm(tempAudioPath, { force: true });
    await options.dependencies.rm(tempMetadataPath, { force: true });
    await options.dependencies.writeFile(tempAudioPath, audio);
    await options.dependencies.writeFile(
      tempMetadataPath,
      `${JSON.stringify(metadata, null, 2)}\n`,
      "utf8"
    );
    const durationSeconds = await options.dependencies.ffprobeDurationSeconds(
      options.ffprobePath,
      tempAudioPath
    );
    if (!Number.isFinite(durationSeconds) || durationSeconds <= 0) {
      throw new Error("ElevenLabs returned invalid MP3 audio");
    }

    await options.dependencies.rm(metadataPath, { force: true });
    await options.dependencies.rename(tempAudioPath, options.outFile);
    await options.dependencies.rename(tempMetadataPath, metadataPath);
    return {
      id: options.paragraph.id,
      text: options.paragraph.text,
      file: options.outFile,
      durationSeconds,
      provider: "elevenlabs",
      cached: false
    };
  } finally {
    await Promise.all([
      options.dependencies.rm(tempAudioPath, { force: true }),
      options.dependencies.rm(tempMetadataPath, { force: true })
    ]);
  }
}

export async function synthesizeNarration(options: {
  script: ScriptFile;
  outDir: string;
  env: Env;
  ffprobePath: string;
  allowElevenLabs: boolean;
}, dependencies: SynthesizeNarrationDependencies = {}): Promise<VoiceRenderResult> {
  const resolvedDependencies: Required<SynthesizeNarrationDependencies> = {
    fetch: dependencies.fetch ?? fetch,
    readFile: dependencies.readFile ?? defaultReadFile,
    rename: dependencies.rename ?? defaultRename,
    rm: dependencies.rm ?? defaultRm,
    stat: dependencies.stat ?? defaultStat,
    writeFile: dependencies.writeFile ?? defaultWriteFile,
    ffprobeDurationSeconds:
      dependencies.ffprobeDurationSeconds ?? defaultFfprobeDurationSeconds,
    randomUUID: dependencies.randomUUID ?? defaultRandomUUID
  };
  await ensureDir(options.outDir);
  const useElevenLabs =
    options.allowElevenLabs && Boolean(options.env.ELEVENLABS_API_KEY && options.env.ELEVENLABS_VOICE_ID);
  const warnings: string[] = [];
  const chunks: VoiceChunkResult[] = [];

  for (const paragraph of options.script.narration) {
    const outFile = `${options.outDir}/${paragraph.id}.mp3`;
    if (useElevenLabs) {
      try {
        chunks.push(
          await synthesizeElevenLabsChunk({
            paragraph,
            outFile,
            env: options.env,
            ffprobePath: options.ffprobePath,
            dependencies: resolvedDependencies
          })
        );
        continue;
      } catch (error) {
        warnings.push(`ElevenLabs failed for ${paragraph.id}; using silent placeholder. ${(error as Error).message}`);
      }
    }

    chunks.push({
      id: paragraph.id,
      text: paragraph.text,
      file: "",
      durationSeconds: paragraph.estimated_seconds,
      provider: "silent_placeholder",
      cached: false
    });
  }

  return {
    provider: chunks.every((chunk) => chunk.provider === "elevenlabs") ? "elevenlabs" : "silent_placeholder",
    chunks,
    warnings
  };
}
