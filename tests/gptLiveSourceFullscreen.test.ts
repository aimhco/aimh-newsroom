import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it, vi } from "vitest";
import {
  SOURCE_FULLSCREEN_SSIM_THRESHOLD,
  assertSourceFullscreenEvidence,
  buildSourceFullscreenSsimArgs,
  deriveSourceFullscreenExpectations,
  measureSourceFullscreenSsim,
  parseSourceFullscreenSsim,
  verifySourceFullscreen,
  type SourceFullscreenEvidence
} from "../src/production/gptLive/sourceFullscreen";
import type { TellaPlan } from "../src/production/gptLive/tellaPlan";
import { runCommand } from "../src/render/process";

const plan = (): TellaPlan => ({
  schemaVersion: "0.1.0",
  productionId: "test-production",
  clips: [
    {
      id: "source-one",
      kind: "source_clip",
      mediaPath: "/episode/source/source-one.mp4",
      durationSeconds: 4,
      preserveOriginalAudio: true
    },
    {
      id: "narration",
      kind: "narration",
      masterPath: "/episode/master/narration.mp4",
      durationSeconds: 5,
      variants: {
        dynamic_editorial: {
          platePath: "/episode/plates/a.mp4",
          narrationAudioPath: "/episode/voice/narration.mp3"
        },
        aimh_visual_host: {
          platePath: "/episode/plates/b.mp4",
          narrationAudioPath: "/episode/voice/narration.mp3"
        }
      }
    },
    {
      id: "source-two",
      kind: "source_clip",
      mediaPath: "/episode/source/source-two.mp4",
      durationSeconds: 2,
      preserveOriginalAudio: true
    }
  ]
});

const evidence = (): SourceFullscreenEvidence[] =>
  deriveSourceFullscreenExpectations(plan()).map((sample) => ({
    ...sample,
    ssim: 0.93,
    threshold: SOURCE_FULLSCREEN_SSIM_THRESHOLD
  }));

describe("GPT-Live source fullscreen verification", () => {
  it("uses the calibrated 0.90 SSIM publication threshold", () => {
    expect(SOURCE_FULLSCREEN_SSIM_THRESHOLD).toBe(0.9);
  });

  it("derives exact cumulative midpoint samples for both compatibility versions", () => {
    expect(deriveSourceFullscreenExpectations(plan())).toEqual([
      { version: "version-a", clipId: "source-one", exportTimeSeconds: 2, sourceTimeSeconds: 2 },
      { version: "version-a", clipId: "source-two", exportTimeSeconds: 10, sourceTimeSeconds: 1 },
      { version: "version-b", clipId: "source-one", exportTimeSeconds: 2, sourceTimeSeconds: 2 },
      { version: "version-b", clipId: "source-two", exportTimeSeconds: 10, sourceTimeSeconds: 1 }
    ]);
  });

  it("builds deterministic one-frame normalized SSIM arguments and parses FFmpeg output", () => {
    expect(buildSourceFullscreenSsimArgs({
      exportPath: "/episode/exports/tella-a.mp4",
      sourcePath: "/episode/source/source-one.mp4",
      exportTimeSeconds: 2,
      sourceTimeSeconds: 2
    })).toEqual([
      "-hide_banner", "-loglevel", "info",
      "-ss", "2.000000", "-i", "/episode/exports/tella-a.mp4",
      "-ss", "2.000000", "-i", "/episode/source/source-one.mp4",
      "-filter_complex",
      "[0:v]scale=1920:1080:force_original_aspect_ratio=disable,format=yuv420p,setpts=PTS-STARTPTS[export];" +
        "[1:v]scale=1920:1080:force_original_aspect_ratio=disable,format=yuv420p,setpts=PTS-STARTPTS[source];" +
        "[export][source]ssim",
      "-frames:v", "1", "-an", "-f", "null", "-"
    ]);
    expect(parseSourceFullscreenSsim("[Parsed_ssim_0] SSIM Y:0.94 U:0.92 V:0.91 All:0.932144 (11.7)"))
      .toBe(0.932144);
    expect(() => parseSourceFullscreenSsim("no metric")).toThrow(/SSIM/i);
  });

  it("orchestrates every expected source/version pair in deterministic order", async () => {
    const command = vi.fn(async (_command: string, _args: string[]) => ({
      stdout: "",
      stderr: "All:0.931"
    }));
    const result = await verifySourceFullscreen({
      ffmpegPath: "ffmpeg-custom",
      plan: plan(),
      exportPaths: {
        "version-a": "/episode/exports/tella-a.mp4",
        "version-b": "/episode/exports/tella-b.mp4"
      }
    }, { runCommand: command });

    expect(result).toEqual(evidence().map((record) => ({ ...record, ssim: 0.931 })));
    expect(command).toHaveBeenCalledTimes(4);
    expect(command.mock.calls[1]?.[1]).toEqual(expect.arrayContaining([
      "10.000000",
      "/episode/exports/tella-a.mp4",
      "1.000000",
      "/episode/source/source-two.mp4"
    ]));
  });

  it.each([
    ["missing", (records: any[]) => records.slice(1)],
    ["extra", (records: any[]) => [...records, { ...records[0] }]],
    ["reordered", (records: any[]) => records.reverse()],
    ["wrong version", (records: any[]) => { records[0].version = "version-b"; return records; }],
    ["wrong clip", (records: any[]) => { records[0].clipId = "other"; return records; }],
    ["wrong export midpoint", (records: any[]) => { records[0].exportTimeSeconds += 0.01; return records; }],
    ["wrong source midpoint", (records: any[]) => { records[0].sourceTimeSeconds += 0.01; return records; }],
    ["wrong threshold", (records: any[]) => { records[0].threshold = 0.8; return records; }],
    ["below threshold", (records: any[]) => { records[0].ssim = 0.899999; return records; }],
    ["extra field", (records: any[]) => { records[0].framePath = "/tmp/secret"; return records; }]
  ])("rejects %s fullscreen evidence coverage", (_name, mutate) => {
    expect(() => assertSourceFullscreenEvidence(plan(), mutate(evidence() as any[])))
      .toThrow(/source fullscreen/i);
  });

  it("passes a current-style full-frame re-encode and rejects inset and cropped layouts", async () => {
    const root = await mkdtemp(join(tmpdir(), "gpt-live-fullscreen-"));
    const sourcePath = join(root, "source.mp4");
    const fullPath = join(root, "full.mp4");
    const insetPath = join(root, "inset.mp4");
    const smallInsetPath = join(root, "small-inset.mp4");
    const croppedPath = join(root, "cropped.mp4");
    try {
      await runCommand("ffmpeg", [
        "-y", "-f", "lavfi", "-i", "testsrc2=size=640x360:rate=30:duration=2",
        "-c:v", "libx264", "-crf", "14", "-pix_fmt", "yuv420p", sourcePath
      ]);
      await runCommand("ffmpeg", [
        "-y", "-i", sourcePath, "-c:v", "libx264", "-crf", "23", "-pix_fmt", "yuv420p", fullPath
      ]);
      await runCommand("ffmpeg", [
        "-y", "-i", sourcePath,
        "-vf", "scale=480:270,pad=640:360:80:45:black",
        "-c:v", "libx264", "-crf", "18", "-pix_fmt", "yuv420p", insetPath
      ]);
      await runCommand("ffmpeg", [
        "-y", "-i", sourcePath,
        "-vf", "scale=632:356,pad=640:360:4:2:black",
        "-c:v", "libx264", "-crf", "18", "-pix_fmt", "yuv420p", smallInsetPath
      ]);
      await runCommand("ffmpeg", [
        "-y", "-i", sourcePath,
        "-vf", "crop=480:360:80:0,scale=640:360",
        "-c:v", "libx264", "-crf", "18", "-pix_fmt", "yuv420p", croppedPath
      ]);

      const full = await measureSourceFullscreenSsim("ffmpeg", fullPath, sourcePath, 1, 1);
      const inset = await measureSourceFullscreenSsim("ffmpeg", insetPath, sourcePath, 1, 1);
      const smallInset = await measureSourceFullscreenSsim(
        "ffmpeg",
        smallInsetPath,
        sourcePath,
        1,
        1
      );
      const cropped = await measureSourceFullscreenSsim("ffmpeg", croppedPath, sourcePath, 1, 1);
      expect(full).toBeGreaterThanOrEqual(SOURCE_FULLSCREEN_SSIM_THRESHOLD);
      expect(inset).toBeLessThan(SOURCE_FULLSCREEN_SSIM_THRESHOLD);
      expect(smallInset).toBeLessThan(SOURCE_FULLSCREEN_SSIM_THRESHOLD);
      expect(cropped).toBeLessThan(SOURCE_FULLSCREEN_SSIM_THRESHOLD);
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  }, 30_000);
});
