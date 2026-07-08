import { join } from "node:path";
import { readTextIfExists } from "../../utils/fs";
import { parseEnvText } from "../../config/env";

export interface VideoEngineInspection {
  path: string;
  exists: boolean;
  packageName?: string;
  packageManager?: "bun" | "pnpm" | "npm" | "unknown";
  language: "TypeScript" | "unknown";
  scripts: Record<string, string>;
  envNames: string[];
  adapterMode: "detected_cli" | "detected_library" | "package_only";
  notes: string[];
}

export async function detectVideoEngine(path: string): Promise<VideoEngineInspection> {
  const packageText = await readTextIfExists(join(path, "package.json"));
  if (!packageText) {
    return {
      path,
      exists: false,
      language: "unknown",
      scripts: {},
      envNames: [],
      adapterMode: "package_only",
      notes: ["Video engine package.json was not found; newsroom produced package-only output."]
    };
  }

  const packageJson = JSON.parse(packageText) as { name?: string; scripts?: Record<string, string> };
  const envNames = Object.keys(parseEnvText((await readTextIfExists(join(path, ".env"))) ?? "")).sort();
  const hasBunLock = Boolean(await readTextIfExists(join(path, "bun.lock")));
  const hasPnpmLock = Boolean(await readTextIfExists(join(path, "pnpm-lock.yaml")));
  const scripts = packageJson.scripts ?? {};
  const canRenderScreenRecording = Boolean(scripts["make-video"]);
  const canPublish = Boolean(scripts.publish);

  return {
    path,
    exists: true,
    packageName: packageJson.name,
    packageManager: hasBunLock ? "bun" : hasPnpmLock ? "pnpm" : "unknown",
    language: "TypeScript",
    scripts,
    envNames,
    adapterMode: "package_only",
    notes: [
      canRenderScreenRecording
        ? "Detected make-video CLI, but it currently expects videos/<slug>/script.json plus recording.mp4 rather than a newsroom episode package."
        : "No compatible make-video CLI was detected.",
      canPublish
        ? "Detected private YouTube publishing helper; newsroom upload remains disabled unless explicitly configured."
        : "No publish script was detected.",
      "No changes were made to the sibling video engine."
    ]
  };
}
