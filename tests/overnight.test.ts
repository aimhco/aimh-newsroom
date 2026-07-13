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

  it("records a local render result when rendering is requested", async () => {
    const root = await mkdtemp(join(tmpdir(), "aimh-newsroom-render-"));
    const result = await runOvernight({
      projectRoot: root,
      date: "2026-07-09",
      fixtures: true,
      dryRun: false,
      noUpload: true,
      renderVideo: true,
      videoEnginePath: "/Users/dennywii/Documents/dev/aimh-video-engine",
      renderer: async ({ episodeDir }) => ({
        mode: "local_fallback_render",
        status: "rendered",
        finalVideoPath: join(episodeDir, "render/final.mp4"),
        captionsPath: join(episodeDir, "render/captions.srt"),
        voice: { provider: "silent_placeholder", chunks: [], warnings: [] },
        warnings: [],
        qaCheck: { name: "local_render", pass: true, detail: "stub render" }
      })
    });

    expect(result.qa.checks.find((check) => check.name === "local_render")).toEqual({
      name: "local_render",
      pass: true,
      detail: "stub render"
    });
    const renderStatus = await readFile(join(result.episodeDir, "render/render-status.json"), "utf8");
    expect(renderStatus).toContain("local_fallback_render");
  });

  it("runs a capture adapter before rendering when capture is requested", async () => {
    const root = await mkdtemp(join(tmpdir(), "aimh-newsroom-capture-"));
    const result = await runOvernight({
      projectRoot: root,
      date: "2026-07-09",
      fixtures: true,
      dryRun: false,
      noUpload: true,
      captureSources: true,
      renderVideo: true,
      videoEnginePath: "/Users/dennywii/Documents/dev/aimh-video-engine",
      captureAdapter: async ({ package: episodePackage }) => {
        episodePackage.shotlist.shots[0]!.asset_path = "assets/screenshots/shot_001.png";
        episodePackage.shotlist.shots[0]!.status = "captured";
        return { attempted: 1, captured: 1, failed: 0, skipped: 4, results: [] };
      },
      renderer: async ({ episodeDir, package: episodePackage }) => ({
        mode: "local_fallback_render",
        status: "rendered",
        finalVideoPath: join(episodeDir, "render/final.mp4"),
        captionsPath: join(episodeDir, "render/captions.srt"),
        voice: { provider: "silent_placeholder", chunks: [], warnings: [] },
        warnings: [],
        qaCheck: {
          name: "local_render",
          pass: episodePackage.shotlist.shots[0]?.asset_path === "assets/screenshots/shot_001.png",
          detail: "stub render saw captured screenshot"
        }
      })
    });

    expect(result.capture?.captured).toBe(1);
    expect(result.package.shotlist.shots[0]?.asset_path).toBe("assets/screenshots/shot_001.png");
    expect(result.qa.checks.find((check) => check.name === "source_capture")).toEqual({
      name: "source_capture",
      pass: true,
      detail: "captured 1 of 1 attempted source screenshots"
    });
  });
});
