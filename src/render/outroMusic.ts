import { createHash } from "node:crypto";
import { basename, join } from "node:path";

export const filterOutroCandidates = (files: readonly string[]): string[] =>
  files.filter((file) => /^Outro_.*\.mp3$/i.test(file)).sort();

export function chooseEpisodeOutro(
  seed: string,
  files: readonly string[],
  previous?: string
): string {
  if (!seed.trim()) throw new Error("Episode outro selection requires a seed");
  const candidates = filterOutroCandidates(files);
  if (candidates.length === 0) throw new Error("No outro music candidates found");

  const previousName = previous ? basename(previous) : undefined;
  const eligible =
    candidates.length > 1 && previousName
      ? candidates.filter((candidate) => candidate !== previousName)
      : candidates;
  const digest = createHash("sha256").update(seed).digest();
  return eligible[digest.readUInt32BE(0) % eligible.length]!;
}

export function selectEpisodeOutroPath(
  seed: string,
  musicDirectory: string,
  files: readonly string[],
  previous?: string
): string {
  if (!musicDirectory.trim()) throw new Error("Outro music directory is required");
  return join(musicDirectory, chooseEpisodeOutro(seed, files, previous));
}
