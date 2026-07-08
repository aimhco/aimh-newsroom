import { runOvernight } from "../pipeline/overnight";

function flagValue(args: string[], name: string): string | undefined {
  const index = args.indexOf(name);
  if (index >= 0) return args[index + 1];
  const prefix = `${name}=`;
  const found = args.find((arg) => arg.startsWith(prefix));
  return found?.slice(prefix.length);
}

async function main(): Promise<void> {
  const [, , command = "overnight", ...args] = process.argv;
  const date = flagValue(args, "--date") ?? "2026-07-09";
  const fixtures = args.includes("--fixtures") || command === "overnight" || command === "resume";
  const dryRun = args.includes("--dry-run") || command === "overnight" || command === "resume";
  const noUpload = args.includes("--no-upload") || dryRun;
  const videoEnginePath = flagValue(args, "--video-engine-path") ?? process.env.AIMH_VIDEO_ENGINE_PATH;

  if (
    ["overnight", "resume", "collect", "rank", "plan", "capture", "voice", "render", "qa", "upload"].includes(command)
  ) {
    const result = await runOvernight({
      projectRoot: process.cwd(),
      date,
      fixtures,
      dryRun,
      noUpload,
      videoEnginePath
    });
    console.log(`episode: ${result.episodeId}`);
    console.log(`dir: ${result.episodeDir}`);
    console.log(`qa: ${result.qa.ok ? "pass" : "fail"}`);
    if (!result.qa.ok) process.exitCode = 1;
    return;
  }

  throw new Error(`Unknown command: ${command}`);
}

main().catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exitCode = 1;
});
