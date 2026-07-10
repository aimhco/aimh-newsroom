import { randomUUID as defaultRandomUUID } from "node:crypto";
import {
  mkdir as defaultMkdir,
  rename as defaultRename,
  rm as defaultRm,
  writeFile as defaultWriteFile
} from "node:fs/promises";
import { dirname } from "node:path";

export interface AtomicFileDependencies {
  readonly mkdir?: typeof defaultMkdir;
  readonly randomUUID?: typeof defaultRandomUUID;
  readonly rename?: typeof defaultRename;
  readonly rm?: typeof defaultRm;
  readonly writeFile?: typeof defaultWriteFile;
}

export async function writeTextAtomic(
  path: string,
  value: string,
  dependencies: AtomicFileDependencies = {}
): Promise<void> {
  const mkdir = dependencies.mkdir ?? defaultMkdir;
  const randomUUID = dependencies.randomUUID ?? defaultRandomUUID;
  const rename = dependencies.rename ?? defaultRename;
  const rm = dependencies.rm ?? defaultRm;
  const writeFile = dependencies.writeFile ?? defaultWriteFile;
  const tempPath = `${path}.tmp-${randomUUID()}`;

  await mkdir(dirname(path), { recursive: true });
  try {
    await rm(tempPath, { force: true });
    await writeFile(tempPath, value, "utf8");
    await rename(tempPath, path);
  } finally {
    await rm(tempPath, { force: true });
  }
}

export const writeJsonAtomic = (
  path: string,
  value: unknown,
  dependencies: AtomicFileDependencies = {}
): Promise<void> => writeTextAtomic(path, `${JSON.stringify(value, null, 2)}\n`, dependencies);
