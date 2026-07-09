import { spawn } from "node:child_process";
import { redactText } from "../utils/redact";

export interface CommandResult {
  stdout: string;
  stderr: string;
}

export function runCommand(command: string, args: string[], cwd?: string): Promise<CommandResult> {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, { cwd, stdio: ["ignore", "pipe", "pipe"] });
    const stdout: Buffer[] = [];
    const stderr: Buffer[] = [];
    child.stdout.on("data", (chunk: Buffer) => stdout.push(chunk));
    child.stderr.on("data", (chunk: Buffer) => stderr.push(chunk));
    child.on("error", reject);
    child.on("close", (code) => {
      const result = {
        stdout: Buffer.concat(stdout).toString("utf8"),
        stderr: Buffer.concat(stderr).toString("utf8")
      };
      if (code === 0) {
        resolve(result);
        return;
      }
      const detail = redactText([result.stdout, result.stderr].filter(Boolean).join("\n"));
      reject(new Error(`${command} exited ${code}${detail ? `: ${detail}` : ""}`));
    });
  });
}

export async function ffprobeDurationSeconds(ffprobePath: string, file: string): Promise<number> {
  const result = await runCommand(ffprobePath, [
    "-v",
    "error",
    "-show_entries",
    "format=duration",
    "-of",
    "default=noprint_wrappers=1:nokey=1",
    file
  ]);
  const duration = Number.parseFloat(result.stdout.trim());
  if (!Number.isFinite(duration)) throw new Error(`Could not read duration for ${file}`);
  return duration;
}
