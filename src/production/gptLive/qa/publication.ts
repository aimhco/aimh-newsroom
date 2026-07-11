import {
  mkdir as defaultMkdir,
  rename as defaultRename,
  rm as defaultRm
} from "node:fs/promises";
import { join } from "node:path";

export interface QaPublicationPaths {
  reportPath: string;
  comparisonPath: string;
  staleComparisonPath: string;
  visualDirectory: string;
}

export interface PublishQaReportSetOptions {
  stagingDirectory: string;
  paths: QaPublicationPaths;
}

export interface PublishQaReportSetDependencies {
  mkdir?: typeof defaultMkdir;
  rename?: typeof defaultRename;
  rm?: typeof defaultRm;
}

const missing = (error: unknown): boolean => (error as NodeJS.ErrnoException).code === "ENOENT";

export async function publishQaReportSet(
  options: PublishQaReportSetOptions,
  dependencies: PublishQaReportSetDependencies = {}
): Promise<void> {
  const mkdir = dependencies.mkdir ?? defaultMkdir;
  const rename = dependencies.rename ?? defaultRename;
  const rm = dependencies.rm ?? defaultRm;
  const backup = `${options.stagingDirectory}.backup`;
  await rm(backup, { recursive: true, force: true });
  await mkdir(backup, { recursive: true });
  const promotions = [
    { staged: join(options.stagingDirectory, "visual"), target: options.paths.visualDirectory, old: join(backup, "visual") },
    { staged: join(options.stagingDirectory, "comparison.md"), target: options.paths.comparisonPath, old: join(backup, "comparison.md") },
    { staged: join(options.stagingDirectory, "qa.json"), target: options.paths.reportPath, old: join(backup, "qa.json") }
  ];
  const backed = new Set<string>();
  const promoted = new Set<string>();
  try {
    for (const item of promotions) {
      try {
        await rename(item.target, item.old);
        backed.add(item.target);
      } catch (error) {
        if (!missing(error)) throw error;
      }
      await rename(item.staged, item.target);
      promoted.add(item.target);
    }
  } catch (error) {
    for (const item of [...promotions].reverse()) {
      if (promoted.has(item.target)) await rm(item.target, { recursive: true, force: true });
      if (backed.has(item.target)) await rename(item.old, item.target);
    }
    throw error;
  } finally {
    await rm(options.stagingDirectory, { recursive: true, force: true });
    await rm(backup, { recursive: true, force: true });
  }
}
