import {
  mkdir,
  mkdtemp,
  readFile,
  rm,
  symlink,
  writeFile
} from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it, vi } from "vitest";
import {
  episodeProductionLockPath,
  withEpisodeProductionLock
} from "../src/production/gptLive/productionLock";
import { finishGptLiveProduction } from "../src/production/gptLive/finish";
import { runGptLiveQa } from "../src/production/gptLive/qa";

const finishOptions = (episodeDir: string) => ({
  episodeDir,
  env: {
    AIMH_LOGO_PATH: "/assets/logo.png",
    AIMH_BODY_MUSIC_PATH: "/assets/music.mp3"
  },
  ffmpegPath: "ffmpeg",
  ffprobePath: "ffprobe"
});

const qaOptions = (episodeDir: string) => ({
  episodeDir,
  env: {},
  ffmpegPath: "ffmpeg",
  ffprobePath: "ffprobe"
});

const createSentinelEpisode = async () => {
  const episodeDir = await mkdtemp(join(tmpdir(), "gpt-live-lock-workflow-"));
  await mkdir(join(episodeDir, "final"), { recursive: true });
  await mkdir(join(episodeDir, "reports", "visual"), { recursive: true });
  const sentinels = new Map([
    [join(episodeDir, "final", "version-a.mp4"), "old-final-a"],
    [join(episodeDir, "final", "version-b.mp4"), "old-final-b"],
    [join(episodeDir, "reports", "post-production.json"), "old-post"],
    [join(episodeDir, "reports", "qa.json"), "old-qa"],
    [join(episodeDir, "reports", "comparison.md"), "old-comparison"],
    [join(episodeDir, "reports", "visual", "old-frame.png"), "old-visual"]
  ]);
  await Promise.all([...sentinels].map(([path, contents]) => writeFile(path, contents, "utf8")));
  return { episodeDir, sentinels };
};

const expectSentinelsUnchanged = async (sentinels: Map<string, string>) => {
  for (const [path, contents] of sentinels) {
    await expect(readFile(path, "utf8")).resolves.toBe(contents);
  }
};

describe("GPT-Live per-episode production lock", () => {
  it("publishes safe metadata and removes the lock after a thrown callback", async () => {
    const episodeDir = await mkdtemp(join(tmpdir(), "gpt-live-lock-cleanup-"));
    const lockPath = episodeProductionLockPath(episodeDir);

    try {
      await expect(withEpisodeProductionLock(episodeDir, "qa", async () => {
        const metadataText = await readFile(join(lockPath, "lock.json"), "utf8");
        const metadata = JSON.parse(metadataText);
        expect(metadata).toEqual({
          schemaVersion: "0.1.0",
          operation: "qa",
          pid: process.pid,
          acquiredAt: expect.stringMatching(/^\d{4}-\d{2}-\d{2}T/)
        });
        expect(metadataText).not.toMatch(/secret|token|key|password/i);
        throw new Error("injected locked callback failure");
      })).rejects.toThrow("injected locked callback failure");

      await expect(readFile(lockPath, "utf8")).rejects.toMatchObject({ code: "ENOENT" });
    } finally {
      await rm(episodeDir, { recursive: true, force: true });
    }
  });

  it("fails contention clearly without invoking the competing callback", async () => {
    const episodeDir = await mkdtemp(join(tmpdir(), "gpt-live-lock-contention-"));
    const competing = vi.fn(async () => undefined);

    try {
      await withEpisodeProductionLock(episodeDir, "qa", async () => {
        await expect(withEpisodeProductionLock(episodeDir, "finish", competing))
          .rejects.toThrow(/production lock.*remove.*manually/i);
      });
      expect(competing).not.toHaveBeenCalled();
    } finally {
      await rm(episodeDir, { recursive: true, force: true });
    }
  });

  it("allows successful sequential finish then QA lock ownership", async () => {
    const episodeDir = await mkdtemp(join(tmpdir(), "gpt-live-lock-sequential-"));
    const events: string[] = [];

    try {
      await withEpisodeProductionLock(episodeDir, "finish", async () => {
        events.push("finish");
      });
      await withEpisodeProductionLock(episodeDir, "qa", async () => {
        events.push("qa");
      });
      expect(events).toEqual(["finish", "qa"]);
    } finally {
      await rm(episodeDir, { recursive: true, force: true });
    }
  });

  it("rejects a symlinked lock path without touching its outside target", async () => {
    const episodeDir = await mkdtemp(join(tmpdir(), "gpt-live-lock-contained-"));
    const outsideDir = await mkdtemp(join(tmpdir(), "gpt-live-lock-outside-"));
    const sentinelPath = join(outsideDir, "sentinel.txt");
    await writeFile(sentinelPath, "outside-unchanged", "utf8");
    await symlink(outsideDir, episodeProductionLockPath(episodeDir), "dir");

    try {
      await expect(withEpisodeProductionLock(episodeDir, "qa", async () => undefined))
        .rejects.toThrow(/symlink/i);
      await expect(readFile(sentinelPath, "utf8")).resolves.toBe("outside-unchanged");
    } finally {
      await rm(episodeDir, { recursive: true, force: true });
      await rm(outsideDir, { recursive: true, force: true });
    }
  });

  it("rejects finish without mutation while QA holds the episode lock", async () => {
    const { episodeDir, sentinels } = await createSentinelEpisode();
    let releaseQa!: () => void;
    let markQaEntered!: () => void;
    const qaEntered = new Promise<void>((resolve) => { markQaEntered = resolve; });
    const holdQa = new Promise<void>((resolve) => { releaseQa = resolve; });
    const qaRun = runGptLiveQa(qaOptions(episodeDir), {
      validatePublishedGeneration: async () => {
        markQaEntered();
        await holdQa;
        throw new Error("release QA holder");
      }
    });
    const access = vi.fn(async () => undefined);

    try {
      await qaEntered;
      await expect(finishGptLiveProduction(finishOptions(episodeDir), { access }))
        .rejects.toThrow(/production lock/i);
      expect(access).not.toHaveBeenCalled();
      await expectSentinelsUnchanged(sentinels);
    } finally {
      releaseQa();
      await qaRun.catch(() => undefined);
      await rm(episodeDir, { recursive: true, force: true });
    }
  });

  it("rejects QA and preserves prior reports while finish holds the episode lock", async () => {
    const { episodeDir, sentinels } = await createSentinelEpisode();
    let releaseFinish!: () => void;
    let markFinishEntered!: () => void;
    const finishEntered = new Promise<void>((resolve) => { markFinishEntered = resolve; });
    const holdFinish = new Promise<void>((resolve) => { releaseFinish = resolve; });
    const finishRun = finishGptLiveProduction(finishOptions(episodeDir), {
      access: async () => {
        markFinishEntered();
        await holdFinish;
        throw new Error("release finish holder");
      }
    });
    const validatePublishedGeneration = vi.fn(async () => {
      throw new Error("QA should not read generation state");
    });

    try {
      await finishEntered;
      await expect(runGptLiveQa(qaOptions(episodeDir), { validatePublishedGeneration }))
        .rejects.toThrow(/production lock/i);
      expect(validatePublishedGeneration).not.toHaveBeenCalled();
      await expectSentinelsUnchanged(sentinels);
    } finally {
      releaseFinish();
      await finishRun.catch(() => undefined);
      await rm(episodeDir, { recursive: true, force: true });
    }
  });
});
