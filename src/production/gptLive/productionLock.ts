import {
  lstat as defaultLstat,
  mkdir as defaultMkdir,
  realpath as defaultRealpath,
  rm as defaultRm,
  writeFile as defaultWriteFile
} from "node:fs/promises";
import { join } from "node:path";
import { validateContainedEpisodePaths } from "./qa/paths";

export type GptLiveProductionOperation = "finish" | "qa";

export interface EpisodeProductionLockDependencies {
  lstat?: typeof defaultLstat;
  mkdir?: typeof defaultMkdir;
  now?: () => Date;
  pid?: number;
  realpath?: typeof defaultRealpath;
  rm?: typeof defaultRm;
  writeFile?: typeof defaultWriteFile;
}

export const episodeProductionLockPath = (episodeDir: string): string =>
  join(episodeDir, ".gpt-live-production.lock");

const isExistingLockError = (error: unknown): boolean =>
  (error as NodeJS.ErrnoException).code === "EEXIST";

export async function withEpisodeProductionLock<T>(
  episodeDir: string,
  operation: GptLiveProductionOperation,
  action: () => Promise<T>,
  dependencies: EpisodeProductionLockDependencies = {}
): Promise<T> {
  const lstat = dependencies.lstat ?? defaultLstat;
  const mkdir = dependencies.mkdir ?? defaultMkdir;
  const realpath = dependencies.realpath ?? defaultRealpath;
  const rm = dependencies.rm ?? defaultRm;
  const writeFile = dependencies.writeFile ?? defaultWriteFile;
  const lockPath = episodeProductionLockPath(episodeDir);
  const metadataPath = join(lockPath, "lock.json");

  await validateContainedEpisodePaths(episodeDir, [lockPath, metadataPath], {
    lstat,
    realpath,
    context: "GPT-Live production lock"
  });

  try {
    await mkdir(lockPath, { mode: 0o700 });
  } catch (error) {
    if (!isExistingLockError(error)) throw error;
    throw new Error(
      `GPT-Live production lock is already held at ${lockPath}. ` +
      "Wait for the active finish or QA command to complete. If a crashed process left the lock, " +
      `verify no GPT-Live production command is running, inspect ${metadataPath}, ` +
      `then remove the lock manually: rm -rf ${lockPath}`
    );
  }

  try {
    await validateContainedEpisodePaths(episodeDir, [lockPath, metadataPath], {
      lstat,
      realpath,
      context: "GPT-Live production lock"
    });
    await writeFile(metadataPath, `${JSON.stringify({
      schemaVersion: "0.1.0",
      operation,
      pid: dependencies.pid ?? process.pid,
      acquiredAt: (dependencies.now ?? (() => new Date()))().toISOString()
    }, null, 2)}\n`, {
      encoding: "utf8",
      flag: "wx",
      mode: 0o600
    });
    return await action();
  } finally {
    await validateContainedEpisodePaths(episodeDir, [lockPath], {
      lstat,
      realpath,
      context: "GPT-Live production lock"
    });
    await rm(lockPath, { recursive: true, force: true });
  }
}
