import { join } from "node:path";
import { readTextIfExists } from "../utils/fs";

export type EnvSource = "shell" | "local" | "video-engine" | "missing";

export interface EnvSnapshot {
  values: Record<string, string>;
  status: Record<string, { present: boolean; source: EnvSource }>;
}

export interface LoadEnvSnapshotOptions {
  shellEnv?: Record<string, string | undefined>;
  localEnvText?: string;
  fallbackEnvText?: string;
  keys?: string[];
}

export const DEFAULT_ENV_KEYS = [
  "NODE_ENV",
  "AIMH_TIMEZONE",
  "AIMH_BRAND_NAME",
  "AIMH_VIDEO_ENGINE_PATH",
  "AIMH_LOGO_PATH",
  "AIMH_BODY_MUSIC_PATH",
  "AIMH_OUTRO_MUSIC_PATH",
  "GPT_LIVE_TELLA_VERSION_A_SOURCE_VARIANT",
  "GPT_LIVE_TELLA_VERSION_A_VIDEO_ID",
  "GPT_LIVE_TELLA_VERSION_A_WORKFLOW_ID",
  "GPT_LIVE_TELLA_VERSION_B_SOURCE_VARIANT",
  "GPT_LIVE_TELLA_VERSION_B_VIDEO_ID",
  "GPT_LIVE_TELLA_VERSION_B_WORKFLOW_ID",
  "OPENAI_API_KEY",
  "ANTHROPIC_API_KEY",
  "GOOGLE_API_KEY",
  "AIMH_LLM_PROVIDER",
  "AIMH_LLM_MODEL",
  "ELEVENLABS_API_KEY",
  "ELEVENLABS_VOICE_ID",
  "ELEVENLABS_MODEL_ID",
  "YOUTUBE_CLIENT_ID",
  "YOUTUBE_CLIENT_SECRET",
  "YOUTUBE_REFRESH_TOKEN",
  "YOUTUBE_CHANNEL_ID",
  "YOUTUBE_UPLOAD_ENABLED",
  "YOUTUBE_DEFAULT_PRIVACY_STATUS",
  "PLAYWRIGHT_MCP_URL",
  "PLAYWRIGHT_MCP_HEADLESS",
  "PLAYWRIGHT_MCP_CAPS",
  "PLAYWRIGHT_USER_DATA_DIR",
  "FFMPEG_PATH",
  "FFPROBE_PATH",
  "AIMH_RENDER_MODE",
  "AIMH_LOCAL_FALLBACK_RENDER",
  "AIMH_OVERNIGHT_MODE",
  "AIMH_NEVER_BLOCK",
  "AIMH_RESUME_AFTER_RATE_LIMIT",
  "AIMH_MORNING_REVIEW_AT"
] as const;

export function parseEnvText(text: string): Record<string, string> {
  const env: Record<string, string> = {};
  for (const rawLine of text.split(/\r?\n/)) {
    const line = rawLine.trim();
    if (!line || line.startsWith("#")) continue;
    const cleaned = line.startsWith("export ") ? line.slice("export ".length).trim() : line;
    const match = cleaned.match(/^([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*)$/);
    if (!match) continue;
    const [, key, rawValue] = match;
    let value = rawValue ?? "";
    if (
      (value.startsWith('"') && value.endsWith('"')) ||
      (value.startsWith("'") && value.endsWith("'"))
    ) {
      value = value.slice(1, -1);
    }
    env[key!] = value;
  }
  return env;
}

export function loadEnvSnapshot(options: LoadEnvSnapshotOptions = {}): EnvSnapshot {
  const shell = options.shellEnv ?? process.env;
  const local = parseEnvText(options.localEnvText ?? "");
  const fallback = parseEnvText(options.fallbackEnvText ?? "");
  const keys = new Set<string>([
    ...DEFAULT_ENV_KEYS,
    ...Object.keys(shell).filter((key) => key.startsWith("AIMH_")),
    ...Object.keys(local),
    ...Object.keys(fallback),
    ...(options.keys ?? [])
  ]);

  const values: Record<string, string> = {};
  const status: EnvSnapshot["status"] = {};

  for (const key of keys) {
    const shellValue = shell[key];
    if (typeof shellValue === "string" && shellValue.length > 0) {
      values[key] = shellValue;
      status[key] = { present: true, source: "shell" };
      continue;
    }
    if (typeof local[key] === "string" && local[key]!.length > 0) {
      values[key] = local[key]!;
      status[key] = { present: true, source: "local" };
      continue;
    }
    if (typeof fallback[key] === "string" && fallback[key]!.length > 0) {
      values[key] = fallback[key]!;
      status[key] = { present: true, source: "video-engine" };
      continue;
    }
    status[key] = { present: false, source: "missing" };
  }

  values.AIMH_TIMEZONE ??= "America/New_York";
  values.AIMH_BRAND_NAME ??= "AIMH";
  values.AIMH_VIDEO_ENGINE_PATH ??= "/Users/dennywii/Documents/dev/aimh-video-engine";
  values.AIMH_LOGO_PATH ??= `${values.AIMH_VIDEO_ENGINE_PATH}/assets/logo.png`;
  values.AIMH_BODY_MUSIC_PATH ??= `${values.AIMH_VIDEO_ENGINE_PATH}/assets/music/Body_Komorebi_Futuremono.mp3`;
  values.AIMH_OUTRO_MUSIC_PATH ??= `${values.AIMH_VIDEO_ENGINE_PATH}/assets/music/Outro_Much_Higher_Causmic.mp3`;
  values.YOUTUBE_DEFAULT_PRIVACY_STATUS ??= "private";
  values.YOUTUBE_UPLOAD_ENABLED ??= "false";
  values.PLAYWRIGHT_MCP_URL ??= "http://localhost:8931/mcp";
  values.PLAYWRIGHT_MCP_CAPS ??= "core,storage,devtools,network,testing";
  values.AIMH_LOCAL_FALLBACK_RENDER ??= "true";

  return { values, status };
}

export async function loadEnvSnapshotFromFiles(projectRoot: string, videoEnginePath: string): Promise<EnvSnapshot> {
  const localEnvText = await readTextIfExists(join(projectRoot, ".env"));
  const fallbackEnvText = await readTextIfExists(join(videoEnginePath, ".env"));
  return loadEnvSnapshot({ localEnvText, fallbackEnvText });
}
