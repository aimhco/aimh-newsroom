import { stat, writeFile } from "node:fs/promises";
import type { ScriptFile } from "../types";
import { ensureDir } from "../utils/fs";
import { redactText } from "../utils/redact";
import { ffprobeDurationSeconds } from "../render/process";

type Env = Record<string, string | undefined>;

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
  return {
    text: prepareTextForSpeech(text),
    model_id: env.ELEVENLABS_MODEL_ID || "eleven_multilingual_v2",
    voice_settings: { stability: 0.5, similarity_boost: 0.8 }
  };
}

async function synthesizeElevenLabsChunk(options: {
  paragraph: ScriptFile["narration"][number];
  outFile: string;
  env: Env;
  ffprobePath: string;
}): Promise<VoiceChunkResult> {
  const apiKey = options.env.ELEVENLABS_API_KEY;
  const voiceId = options.env.ELEVENLABS_VOICE_ID;
  if (!apiKey || !voiceId) throw new Error("ELEVENLABS_API_KEY and ELEVENLABS_VOICE_ID must be set");

  try {
    const existing = await stat(options.outFile);
    if (existing.size > 0) {
      return {
        id: options.paragraph.id,
        text: options.paragraph.text,
        file: options.outFile,
        durationSeconds: await ffprobeDurationSeconds(options.ffprobePath, options.outFile),
        provider: "elevenlabs",
        cached: true
      };
    }
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
  }

  const res = await fetch(`https://api.elevenlabs.io/v1/text-to-speech/${voiceId}`, {
    method: "POST",
    headers: {
      "Accept": "audio/mpeg",
      "Content-Type": "application/json",
      "xi-api-key": apiKey
    },
    body: JSON.stringify(buildSpeechRequestBody(options.paragraph.text, options.env))
  });

  if (!res.ok) {
    const retryAfter = res.headers.get("retry-after");
    const body = redactText(await res.text());
    throw new Error(
      `ElevenLabs ${res.status}${retryAfter ? ` retry-after=${retryAfter}` : ""}${body ? `: ${body}` : ""}`
    );
  }

  await writeFile(options.outFile, Buffer.from(await res.arrayBuffer()));
  return {
    id: options.paragraph.id,
    text: options.paragraph.text,
    file: options.outFile,
    durationSeconds: await ffprobeDurationSeconds(options.ffprobePath, options.outFile),
    provider: "elevenlabs",
    cached: false
  };
}

export async function synthesizeNarration(options: {
  script: ScriptFile;
  outDir: string;
  env: Env;
  ffprobePath: string;
  allowElevenLabs: boolean;
}): Promise<VoiceRenderResult> {
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
            ffprobePath: options.ffprobePath
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
