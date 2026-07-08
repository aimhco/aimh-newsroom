import { mkdtemp, readFile, stat } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { describe, expect, it } from "vitest";
import { runOvernight } from "../src/pipeline/overnight";

describe("overnight dry run", () => {
  it("creates a complete fixture episode package without credentials", async () => {
    const root = await mkdtemp(join(tmpdir(), "aimh-newsroom-"));
    const result = await runOvernight({
      projectRoot: root,
      date: "2026-07-09",
      fixtures: true,
      dryRun: true,
      noUpload: true,
      videoEnginePath: "/Users/dennywii/Documents/dev/aimh-video-engine"
    });

    expect(result.episodeId).toBe("2026-07-09-daily-ai-briefing");
    expect(result.qa.ok).toBe(true);

    for (const rel of [
      "raw_items.jsonl",
      "clusters.json",
      "rankings.json",
      "episode.json",
      "script.json",
      "shotlist.json",
      "sources.json",
      "metadata.json",
      "qa.json",
      "episode-review.md",
      "review.html",
      "reports/questions-for-denny.md",
      "reports/run-log.md"
    ]) {
      await expect(stat(join(result.episodeDir, rel))).resolves.toBeTruthy();
    }

    const questions = await readFile(join(result.episodeDir, "reports/questions-for-denny.md"), "utf8");
    expect(questions).toContain("YOUTUBE_UPLOAD_ENABLED");
    expect(questions).not.toContain("sk-");
  });
});
