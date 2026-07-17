import { resolve } from "node:path";
import { validateArticleEpisodePreflight } from "../editorial/articleEpisodePreflight";

const valuesFor = (args: readonly string[], name: string): string[] => {
  const values: string[] = [];
  for (let index = 0; index < args.length; index += 1) {
    if (args[index] === name && args[index + 1]) {
      values.push(args[index + 1]!);
      index += 1;
    }
  }
  return values;
};

const args = process.argv.slice(2);
const episodeDirValue = valuesFor(args, "--episode-dir")[0];
if (!episodeDirValue) {
  throw new Error("Article preflight requires --episode-dir");
}

validateArticleEpisodePreflight({
  episodeDir: resolve(episodeDirValue),
  usedPrimaryMotionAssets: valuesFor(args, "--used-motion")
}).then((result) => {
  process.stdout.write(
    `Article preflight passed: ${result.selectedMotionAssets.length} reviewed motion assets ready\n`
  );
}).catch((error: unknown) => {
  process.stderr.write(`${(error as Error).message}\n`);
  process.exitCode = 1;
});
