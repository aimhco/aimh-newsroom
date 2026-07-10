import { mkdtemp, readFile, rm, stat as fsStat } from "node:fs/promises";
import { tmpdir } from "node:os";
import { basename, join, resolve } from "node:path";
import { describe, expect, it, vi } from "vitest";
import { DEFAULT_ENV_KEYS, loadEnvSnapshot } from "../src/config/env";
import * as contentModule from "../src/production/gptLive/content";
import { runGptLiveCli } from "../src/production/gptLive/cli";
import {
  buildNarrationSlateArgs,
  prepareGptLiveProduction
} from "../src/production/gptLive/prepare";
import { buildTellaPlan } from "../src/production/gptLive/tellaPlan";
import type { GptLiveProduction, SourceClipSpec } from "../src/production/gptLive/types";

const { GPT_LIVE_CONTENT, GPT_LIVE_TIMELINE, validateProductionManifest } = contentModule;

const EXPECTED_SOURCES = [
  {
    id: "src_openai_article",
    title: "Introducing GPT-Live",
    url: "https://openai.com/index/introducing-gpt-live/",
    publisher: "OpenAI",
    accessedAt: "2026-07-10"
  },
  {
    id: "src_openai_help",
    title: "ChatGPT Voice",
    url: "https://help.openai.com/en/articles/20001274/",
    publisher: "OpenAI Help Center",
    accessedAt: "2026-07-10"
  },
  {
    id: "src_openai_realtime",
    title: "Advancing voice intelligence with new models in the API",
    url: "https://openai.com/index/advancing-voice-intelligence-with-new-models-in-the-api/",
    publisher: "OpenAI",
    accessedAt: "2026-07-10"
  },
  {
    id: "src_toms_guide",
    title: "I used ChatGPT's new voice mode to translate the World Cup in real time",
    url: "https://www.tomsguide.com/ai/i-used-chatgpts-new-voice-mode-to-translate-the-world-cup-in-real-time-heres-what-happened",
    publisher: "Tom's Guide",
    accessedAt: "2026-07-10"
  }
] as const;

const EXPECTED_CLAIMS = [
  {
    id: "claim_full_duplex",
    text: "GPT-Live can listen and speak at the same time.",
    sourceIds: ["src_openai_article", "src_openai_help"]
  },
  {
    id: "claim_translation",
    text: "GPT-Live can perform live translation.",
    sourceIds: ["src_openai_article", "src_toms_guide"]
  },
  {
    id: "claim_world_cup",
    text: "Tom's Guide reported continuous English interpretation over rapid Spanish World Cup commentary.",
    sourceIds: ["src_toms_guide"]
  },
  {
    id: "claim_delegation",
    text: "GPT-Live can keep the conversation moving while deeper work runs in the background.",
    sourceIds: ["src_openai_article"]
  },
  {
    id: "claim_visuals",
    text: "Voice can show visual results for weather, sports, maps, stocks, and more.",
    sourceIds: ["src_openai_article", "src_openai_help"]
  },
  {
    id: "claim_benchmark",
    text: "OpenAI reports that GPT-Live-1 substantially outperforms Advanced Voice Mode on GPQA.",
    sourceIds: ["src_openai_article"]
  },
  {
    id: "claim_access",
    text: "Paid consumer plans use GPT-Live-1 and Free uses GPT-Live-1 mini.",
    sourceIds: ["src_openai_help"]
  },
  {
    id: "claim_limits",
    text: "Live initially excludes video, screen sharing, connected apps, plugins, and several ChatGPT surfaces.",
    sourceIds: ["src_openai_help"]
  },
  {
    id: "claim_direction",
    text: "Related realtime voice work points toward voice-to-action, systems-to-voice, and voice-to-voice products.",
    sourceIds: ["src_openai_realtime"]
  },
  {
    id: "claim_api_soon",
    text: "OpenAI plans to bring GPT-Live models to the API.",
    sourceIds: ["src_openai_article"]
  }
] as const;

const EXPECTED_NARRATION = [
  {
    id: "narration_hook",
    kind: "narration",
    text: "That was not a prepared translation. ChatGPT was listening in French and speaking in English almost at the same time. And that is only one thing GPT-Live suddenly makes possible.",
    claimIds: ["claim_translation"],
    scene: "hook"
  },
  {
    id: "narration_full_duplex",
    kind: "narration",
    text: "The important phrase is full duplex. Old voice assistants worked like a walkie-talkie: you spoke, stopped, waited, and then the machine answered. GPT-Live works more like a phone call. It can keep listening while it talks, so you can interrupt, correct yourself, change direction, or pause to think without restarting the conversation.",
    claimIds: ["claim_full_duplex"],
    scene: "full_duplex"
  },
  {
    id: "narration_use_cases",
    kind: "narration",
    text: "That enables much more than smoother small talk. You can translate a conversation while it happens, practice a language through fast role-play, talk through a messy idea without being cut off, or add another request while ChatGPT is already searching. It can keep the conversation moving, bring back harder answers from a stronger model, and show visual cards when weather, maps, sports, or stocks are easier to understand on screen.",
    claimIds: ["claim_translation", "claim_delegation", "claim_visuals"],
    scene: "use_cases"
  },
  {
    id: "narration_evidence",
    kind: "narration",
    text: "This is already moving beyond staged demos. Tom's Guide played rapid Spanish World Cup commentary and reported that GPT-Live delivered a continuous English interpretation over the broadcast. OpenAI's own tests also show a large jump in expert science reasoning, although those remain vendor-reported results.",
    claimIds: ["claim_world_cup", "claim_benchmark"],
    scene: "evidence"
  },
  {
    id: "narration_availability",
    kind: "narration",
    text: "You can try it now in ChatGPT Voice on consumer web and mobile. Free accounts get GPT-Live-1 mini. Go, Plus, and Pro get GPT-Live-1. Look under Settings, then Voice, for Live. It is still a launch product: no Live video or screen sharing yet, no connected apps or plugins, and some ChatGPT workspaces and tools are not supported.",
    claimIds: ["claim_access", "claim_limits"],
    scene: "availability"
  },
  {
    id: "narration_future",
    kind: "narration",
    text: "Where this gets interesting is what comes next: voice that can take action, software that speaks useful context before you ask, and conversations that cross languages without stopping. OpenAI says GPT-Live is coming to the API, while its related realtime tools already point toward travel changes, scheduling, customer support, and multilingual work.",
    claimIds: ["claim_direction", "claim_api_soon"],
    scene: "future"
  },
  {
    id: "narration_cta",
    kind: "narration",
    text: "The breakthrough is not that ChatGPT sounds more human. It is that you no longer have to speak like a machine to use it. Try one real task in Voice: translate a conversation, talk through a messy problem, or interrupt it halfway through an answer. In the comments, tell me what GPT-Live enabled for you, or what you think it is going to enable for you.",
    claimIds: ["claim_full_duplex"],
    scene: "cta"
  }
] as const;

const EXPECTED_SOURCE_CLIPS = [
  {
    id: "clip_translation",
    kind: "source_clip",
    playerConfigUrl: "https://player.vimeo.com/video/1208096618/config?h=c7dd7ef278",
    startSeconds: 50.82,
    endSeconds: 63.17,
    sourceId: "src_openai_article"
  },
  {
    id: "clip_interruption",
    kind: "source_clip",
    playerConfigUrl: "https://player.vimeo.com/video/1208152658/config?h=c944a411bd",
    startSeconds: 31.96,
    endSeconds: 43.92,
    sourceId: "src_openai_article"
  }
] as const;

const cloneProduction = (): GptLiveProduction => structuredClone(GPT_LIVE_CONTENT);

const EPISODE_DIR = "/tmp/gpt-live-episode";
const narrationAssets = GPT_LIVE_CONTENT.narration.map((item, index) => ({
  id: item.id,
  audioPath: join(EPISODE_DIR, "voice", `${item.id}.mp3`),
  durationSeconds: 10 + index / 10
}));

describe("GPT-Live Tella plan", () => {
  it("preserves the exact nine-item timeline order and kinds", () => {
    const plan = buildTellaPlan({ episodeDir: EPISODE_DIR, narrationAssets });

    expect(plan.clips.map(({ id }) => id)).toEqual(GPT_LIVE_CONTENT.timeline.map(({ id }) => id));
    expect(plan.clips.map(({ kind }) => kind)).toEqual(
      GPT_LIVE_CONTENT.timeline.map(({ kind }) => kind)
    );
    expect(plan.clips).toHaveLength(9);
  });

  it("preserves original audio for source clips", () => {
    const plan = buildTellaPlan({ episodeDir: EPISODE_DIR, narrationAssets });
    const sourceClips = plan.clips.filter((clip) => clip.kind === "source_clip");

    expect(sourceClips).toHaveLength(2);
    expect(sourceClips.every((clip) => clip.preserveOriginalAudio === true)).toBe(true);
  });

  it("maps each narration to distinct A/B plates with one shared audio file", () => {
    const plan = buildTellaPlan({ episodeDir: EPISODE_DIR, narrationAssets });
    const narrationClips = plan.clips.filter((clip) => clip.kind === "narration");

    expect(narrationClips).toHaveLength(7);
    for (const [index, clip] of narrationClips.entries()) {
      expect(Object.keys(clip.variants)).toEqual(["dynamic_editorial", "aimh_visual_host"]);
      expect(clip.variants.dynamic_editorial.platePath).toBe(
        join(EPISODE_DIR, "plates", "dynamic_editorial", `${clip.id}.mp4`)
      );
      expect(clip.variants.aimh_visual_host.platePath).toBe(
        join(EPISODE_DIR, "plates", "aimh_visual_host", `${clip.id}.mp4`)
      );
      expect(clip.variants.dynamic_editorial.platePath).not.toBe(
        clip.variants.aimh_visual_host.platePath
      );
      expect(clip.variants.dynamic_editorial.narrationAudioPath).toBe(
        clip.variants.aimh_visual_host.narrationAudioPath
      );
      expect(clip.variants.dynamic_editorial.narrationAudioPath).toBe(
        narrationAssets[index]?.audioPath
      );
      expect(clip.durationSeconds).toBe(narrationAssets[index]?.durationSeconds);
    }
  });

  it("serializes without undefined values, placeholders, or dynamic Tella IDs", () => {
    const serialized = JSON.stringify(
      buildTellaPlan({ episodeDir: EPISODE_DIR, narrationAssets })
    );

    expect(serialized).not.toContain("undefined");
    expect(serialized).not.toMatch(/placeholder/i);
    expect(serialized).not.toMatch(/(?:video|clip|source)Id/);
    expect(JSON.parse(serialized)).toEqual(
      buildTellaPlan({ episodeDir: EPISODE_DIR, narrationAssets })
    );
  });
});

describe("GPT-Live production environment", () => {
  it("defaults logo and music paths from the resolved video-engine path", () => {
    const snapshot = loadEnvSnapshot({
      shellEnv: { AIMH_VIDEO_ENGINE_PATH: "/opt/aimh-video-engine" }
    });

    expect(DEFAULT_ENV_KEYS).toContain("AIMH_LOGO_PATH");
    expect(DEFAULT_ENV_KEYS).toContain("AIMH_BODY_MUSIC_PATH");
    expect(snapshot.values.AIMH_LOGO_PATH).toBe("/opt/aimh-video-engine/assets/logo.png");
    expect(snapshot.values.AIMH_BODY_MUSIC_PATH).toBe(
      "/opt/aimh-video-engine/assets/music/Body_Komorebi_Futuremono.mp3"
    );
  });

  it("preserves shell, local, and fallback precedence for explicit asset paths", () => {
    const snapshot = loadEnvSnapshot({
      shellEnv: { AIMH_LOGO_PATH: "/shell/logo.png" },
      localEnvText: "AIMH_LOGO_PATH=/local/logo.png\nAIMH_BODY_MUSIC_PATH=/local/music.mp3\n",
      fallbackEnvText:
        "AIMH_LOGO_PATH=/fallback/logo.png\nAIMH_BODY_MUSIC_PATH=/fallback/music.mp3\n"
    });

    expect(snapshot.values.AIMH_LOGO_PATH).toBe("/shell/logo.png");
    expect(snapshot.values.AIMH_BODY_MUSIC_PATH).toBe("/local/music.mp3");
    expect(snapshot.status.AIMH_LOGO_PATH).toEqual({ present: true, source: "shell" });
    expect(snapshot.status.AIMH_BODY_MUSIC_PATH).toEqual({ present: true, source: "local" });
  });
});

describe("GPT-Live production preparation", () => {
  const durationById = new Map<string, number>(
    GPT_LIVE_CONTENT.narration.map((item, index) => [item.id, 8.25 + index / 10])
  );

  const successfulVoiceResult = (voiceDir: string) => ({
    provider: "elevenlabs" as const,
    warnings: [],
    chunks: GPT_LIVE_CONTENT.narration.map((item) => ({
      id: item.id,
      text: item.text,
      file: join(voiceDir, `${item.id}.mp3`),
      durationSeconds: durationById.get(item.id)!,
      provider: "elevenlabs" as const,
      cached: false
    }))
  });

  it("builds a black 1080p H.264/AAC slate command around the exact voice duration", () => {
    expect(
      buildNarrationSlateArgs({
        audioPath: "/episode/voice/narration_hook.mp3",
        durationSeconds: 8.25,
        outputPath: "/episode/master/narration_hook.mp4"
      })
    ).toEqual([
      "-y",
      "-f",
      "lavfi",
      "-i",
      "color=c=black:s=1920x1080:r=30:d=8.250",
      "-i",
      "/episode/voice/narration_hook.mp3",
      "-map",
      "0:v:0",
      "-map",
      "1:a:0",
      "-c:v",
      "libx264",
      "-pix_fmt",
      "yuv420p",
      "-r",
      "30",
      "-c:a",
      "aac",
      "-b:a",
      "192k",
      "-ar",
      "48000",
      "-ac",
      "2",
      "-t",
      "8.250",
      "-movflags",
      "+faststart",
      "/episode/master/narration_hook.mp4"
    ]);
  });

  it("prepares media and persists only deterministic, secret-free production records", async () => {
    const episodeDir = await mkdtemp(join(tmpdir(), "gpt-live-prepare-"));
    const extractSourceClip = vi.fn(async () => undefined);
    const synthesizeNarration = vi.fn(async ({ outDir }: { outDir: string }) =>
      successfulVoiceResult(outDir)
    );
    const runCommand = vi.fn(async (_command: string, _args: string[]) => ({
      stdout: "",
      stderr: ""
    }));
    const ffprobeDurationSeconds = vi.fn(async (_ffprobePath: string, file: string) => {
      const id = basename(file, ".mp4");
      return durationById.get(id)!;
    });

    try {
      const result = await prepareGptLiveProduction(
        {
          episodeDir,
          env: {
            ELEVENLABS_API_KEY: "eleven-secret-do-not-write",
            ELEVENLABS_VOICE_ID: "voice-secret-do-not-write",
            AIMH_LOGO_PATH: "/assets/logo.png",
            AIMH_BODY_MUSIC_PATH: "/assets/music.mp3"
          },
          ffmpegPath: "/tools/ffmpeg",
          ffprobePath: "/tools/ffprobe"
        },
        {
          extractSourceClip,
          synthesizeNarration: synthesizeNarration as never,
          runCommand,
          ffprobeDurationSeconds,
          stat: async () => ({ size: 100, isFile: () => true })
        }
      );

      for (const name of [
        "source",
        "voice",
        "master",
        "plates",
        "tella",
        "exports",
        "final",
        "reports"
      ]) {
        expect((await fsStat(join(episodeDir, name))).isDirectory()).toBe(true);
      }
      expect(extractSourceClip).toHaveBeenCalledTimes(2);
      expect(extractSourceClip).toHaveBeenNthCalledWith(1, {
        playerConfigUrl: EXPECTED_SOURCE_CLIPS[0].playerConfigUrl,
        startSeconds: EXPECTED_SOURCE_CLIPS[0].startSeconds,
        endSeconds: EXPECTED_SOURCE_CLIPS[0].endSeconds,
        outputPath: join(episodeDir, "source", "clip_translation.mp4"),
        ffmpegPath: "/tools/ffmpeg",
        ffprobePath: "/tools/ffprobe"
      });
      expect(synthesizeNarration).toHaveBeenCalledWith(
        expect.objectContaining({
          outDir: join(episodeDir, "voice"),
          ffprobePath: "/tools/ffprobe",
          allowElevenLabs: true
        })
      );
      expect(runCommand).toHaveBeenCalledTimes(7);
      expect(runCommand.mock.calls.every(([command]) => command === "/tools/ffmpeg")).toBe(true);
      expect(ffprobeDurationSeconds).toHaveBeenCalledTimes(7);

      const productionText = await readFile(result.productionPath, "utf8");
      const voiceText = await readFile(result.voicePath, "utf8");
      const planText = await readFile(result.planPath, "utf8");
      const matrixText = await readFile(result.sourceMatrixPath, "utf8");
      const persistedText = [productionText, voiceText, planText, matrixText].join("\n");

      expect(JSON.parse(productionText)).toMatchObject({
        id: GPT_LIVE_CONTENT.id,
        branding: { logoPath: "/assets/logo.png" },
        musicPath: "/assets/music.mp3"
      });
      expect(JSON.parse(voiceText)).toEqual(successfulVoiceResult(join(episodeDir, "voice")));
      expect(JSON.parse(planText)).toEqual(result.plan);
      expect(result.plan.clips.map(({ id }) => id)).toEqual(
        GPT_LIVE_CONTENT.timeline.map(({ id }) => id)
      );
      for (const source of GPT_LIVE_CONTENT.sources) {
        expect(matrixText).toContain(source.title);
        expect(matrixText).toContain(source.url);
      }
      expect(persistedText).not.toMatch(/eleven-secret|voice-secret|playlist\.m3u8\?/);
      expect(result.episodeDir).toBe(episodeDir);
    } finally {
      await rm(episodeDir, { recursive: true, force: true });
    }
  });

  it.each([
    {
      name: "top-level fallback provider",
      mutate: (result: ReturnType<typeof successfulVoiceResult>) => ({
        ...result,
        provider: "silent_placeholder" as const
      }),
      expected: "ElevenLabs narration required"
    },
    {
      name: "synthesis warnings",
      mutate: (result: ReturnType<typeof successfulVoiceResult>) => ({
        ...result,
        warnings: ["fallback was attempted"]
      }),
      expected: "Narration synthesis returned warnings"
    },
    {
      name: "invalid chunk file",
      mutate: (result: ReturnType<typeof successfulVoiceResult>) => ({
        ...result,
        chunks: [{ ...result.chunks[0]!, file: "" }, ...result.chunks.slice(1)]
      }),
      expected: "Invalid ElevenLabs narration chunk"
    }
  ])("rejects $name instead of silently falling back", async ({ mutate, expected }) => {
    const episodeDir = await mkdtemp(join(tmpdir(), "gpt-live-reject-"));

    try {
      const preparation = prepareGptLiveProduction(
        {
          episodeDir,
          env: {},
          ffmpegPath: "ffmpeg",
          ffprobePath: "ffprobe"
        },
        {
          extractSourceClip: async () => undefined,
          synthesizeNarration: (async ({ outDir }: { outDir: string }) =>
            mutate(successfulVoiceResult(outDir))) as never,
          runCommand: async () => ({ stdout: "", stderr: "" }),
          ffprobeDurationSeconds: async () => 1,
          stat: async () => ({ size: 100, isFile: () => true })
        }
      );

      await expect(preparation).rejects.toThrow(expected);
    } finally {
      await rm(episodeDir, { recursive: true, force: true });
    }
  });
});

describe("GPT-Live preparation CLI", () => {
  it("accepts pnpm's extra separator and resolves preparation paths from cwd", async () => {
    const loadEnvSnapshotFromFiles = vi.fn(async () => ({
      values: {
        AIMH_VIDEO_ENGINE_PATH: "/video-engine",
        FFMPEG_PATH: "/tools/ffmpeg",
        FFPROBE_PATH: "/tools/ffprobe"
      },
      status: {}
    }));
    const prepareGptLiveProduction = vi.fn(async () => ({ ok: true }));

    await runGptLiveCli(["prepare", "--", "--episode-dir", "episodes/custom"], {
      cwd: () => "/project",
      loadEnvSnapshotFromFiles,
      prepareGptLiveProduction: prepareGptLiveProduction as never
    });

    expect(loadEnvSnapshotFromFiles).toHaveBeenCalledWith(
      "/project",
      "/Users/dennywii/Documents/dev/aimh-video-engine"
    );
    expect(prepareGptLiveProduction).toHaveBeenCalledWith({
      episodeDir: resolve("/project", "episodes/custom"),
      env: expect.objectContaining({ AIMH_VIDEO_ENGINE_PATH: "/video-engine" }),
      ffmpegPath: "/tools/ffmpeg",
      ffprobePath: "/tools/ffprobe"
    });
  });

  it("uses the manifest ID for the default episode directory", async () => {
    const prepareGptLiveProduction = vi.fn(async () => ({ ok: true }));

    await runGptLiveCli(["prepare"], {
      cwd: () => "/project",
      loadEnvSnapshotFromFiles: async () => ({ values: {}, status: {} }),
      prepareGptLiveProduction: prepareGptLiveProduction as never
    });

    expect(prepareGptLiveProduction).toHaveBeenCalledWith(
      expect.objectContaining({
        episodeDir: "/project/episodes/2026-07-10-gpt-live-tella-ab",
        ffmpegPath: "ffmpeg",
        ffprobePath: "ffprobe"
      })
    );
  });

  it.each([
    { args: ["prepare", "--episode-dir"], error: "Missing value for --episode-dir" },
    { args: ["finish"], error: "Command not yet implemented: finish" },
    { args: ["qa"], error: "Command not yet implemented: qa" },
    { args: ["unexpected"], error: "Unknown command: unexpected" }
  ])("rejects invalid command input: $args", async ({ args, error }) => {
    await expect(runGptLiveCli(args)).rejects.toThrow(error);
  });
});

describe("GPT-Live controlled production content", () => {
  it("pins every approved production field", () => {
    expect(GPT_LIVE_CONTENT.id).toBe("2026-07-10-gpt-live-tella-ab");
    expect(GPT_LIVE_CONTENT.variants).toEqual(["dynamic_editorial", "aimh_visual_host"]);
    expect(GPT_LIVE_CONTENT.sources).toEqual(EXPECTED_SOURCES);
    expect(GPT_LIVE_CONTENT.claims).toEqual(EXPECTED_CLAIMS);
    expect(GPT_LIVE_CONTENT.narration).toEqual(EXPECTED_NARRATION);
    expect(GPT_LIVE_CONTENT.branding).toEqual({
      logoPath: "/Users/dennywii/Documents/dev/aimh-video-engine/assets/logo.png",
      width: 150,
      marginTop: 24,
      marginRight: 24,
      opacity: 0.85
    });
    expect(GPT_LIVE_CONTENT.musicPath).toBe(
      "/Users/dennywii/Documents/dev/aimh-video-engine/assets/music/Body_Komorebi_Futuremono.mp3"
    );
  });

  it("pins the ordered timeline IDs and kinds", () => {
    expect(GPT_LIVE_TIMELINE.map(({ id }) => id)).toEqual([
      "clip_translation",
      "narration_hook",
      "clip_interruption",
      "narration_full_duplex",
      "narration_use_cases",
      "narration_evidence",
      "narration_availability",
      "narration_future",
      "narration_cta"
    ]);
    expect(GPT_LIVE_TIMELINE.map(({ kind }) => kind)).toEqual([
      "source_clip",
      "narration",
      "source_clip",
      "narration",
      "narration",
      "narration",
      "narration",
      "narration",
      "narration"
    ]);
    expect(GPT_LIVE_CONTENT.timeline).toBe(GPT_LIVE_TIMELINE);
  });

  it("pins the exact source clip contract", () => {
    expect(GPT_LIVE_TIMELINE.filter(({ kind }) => kind === "source_clip")).toEqual(EXPECTED_SOURCE_CLIPS);
  });

  it("uses exact equality for the approved CTA", () => {
    expect(GPT_LIVE_CONTENT.narration.at(-1)).toEqual(EXPECTED_NARRATION.at(-1));
  });

  it.each([
    {
      name: "duplicate source IDs",
      expectedError: 'Invalid GPT-Live production: duplicate source id "src_openai_article"',
      build: () => {
        const production = cloneProduction();
        return { ...production, sources: [...production.sources, production.sources[0]!] };
      }
    },
    {
      name: "duplicate claim IDs",
      expectedError: 'Invalid GPT-Live production: duplicate claim id "claim_full_duplex"',
      build: () => {
        const production = cloneProduction();
        return { ...production, claims: [...production.claims, production.claims[0]!] };
      }
    },
    {
      name: "duplicate narration IDs",
      expectedError: 'Invalid GPT-Live production: duplicate narration id "narration_hook"',
      build: () => {
        const production = cloneProduction();
        return { ...production, narration: [...production.narration, production.narration[0]!] };
      }
    },
    {
      name: "duplicate timeline IDs",
      expectedError: 'Invalid GPT-Live production: duplicate timeline id "clip_translation"',
      build: () => {
        const production = cloneProduction();
        return { ...production, timeline: [...production.timeline, production.timeline[0]!] };
      }
    },
    {
      name: "unknown claim source IDs",
      expectedError:
        'Invalid GPT-Live production: claim "claim_full_duplex" references unknown source "src_missing"',
      build: () => {
        const production = cloneProduction();
        const [claim, ...claims] = production.claims;
        return { ...production, claims: [{ ...claim!, sourceIds: ["src_missing"] }, ...claims] };
      }
    },
    {
      name: "unknown narration claim IDs",
      expectedError:
        'Invalid GPT-Live production: narration "narration_hook" references unknown claim "claim_missing"',
      build: () => {
        const production = cloneProduction();
        const [narration, ...narrations] = production.narration;
        return { ...production, narration: [{ ...narration!, claimIds: ["claim_missing"] }, ...narrations] };
      }
    },
    {
      name: "unknown source clip source IDs",
      expectedError:
        'Invalid GPT-Live production: source clip "clip_translation" references unknown source "src_missing"',
      build: () => {
        const production = cloneProduction();
        const firstClip = production.timeline.find((item): item is SourceClipSpec => item.kind === "source_clip")!;
        return {
          ...production,
          timeline: production.timeline.map((item) =>
            item.id === firstClip.id ? { ...firstClip, sourceId: "src_missing" } : item
          )
        };
      }
    },
    {
      name: "altered timeline narration",
      expectedError:
        'Invalid GPT-Live production: timeline narration "narration_hook" does not exactly match canonical narration',
      build: () => {
        const production = cloneProduction();
        return {
          ...production,
          timeline: production.timeline.map((item) =>
            item.id === "narration_hook" ? { ...item, text: "Altered narration." } : item
          )
        };
      }
    },
    {
      name: "missing timeline narration",
      expectedError:
        'Invalid GPT-Live production: canonical narration "narration_hook" must appear exactly once in timeline; found 0',
      build: () => {
        const production = cloneProduction();
        return {
          ...production,
          timeline: production.timeline.filter((item) => item.id !== "narration_hook")
        };
      }
    },
    {
      name: "duplicated timeline narration",
      expectedError:
        'Invalid GPT-Live production: canonical narration "narration_hook" must appear exactly once in timeline; found 2',
      build: () => {
        const production = cloneProduction();
        const narration = production.timeline.find((item) => item.id === "narration_hook")!;
        return { ...production, timeline: [...production.timeline, narration] };
      }
    },
    {
      name: "undeclared timeline narration",
      expectedError:
        'Invalid GPT-Live production: timeline narration "narration_extra" is not declared in canonical narration',
      build: () => {
        const production = cloneProduction();
        const narration = production.narration[0]!;
        return {
          ...production,
          timeline: [...production.timeline, { ...narration, id: "narration_extra" }]
        };
      }
    },
    {
      name: "claims without sources",
      expectedError: 'Invalid GPT-Live production: claim "claim_full_duplex" must reference at least one source',
      build: () => {
        const production = cloneProduction();
        const [claim, ...claims] = production.claims;
        return { ...production, claims: [{ ...claim!, sourceIds: [] }, ...claims] };
      }
    },
    {
      name: "narration without claims",
      expectedError: 'Invalid GPT-Live production: narration "narration_hook" must reference at least one claim',
      build: () => {
        const production = cloneProduction();
        const [narration, ...narrations] = production.narration;
        return { ...production, narration: [{ ...narration!, claimIds: [] }, ...narrations] };
      }
    }
  ])("rejects $name", ({ build, expectedError }) => {
    expect(() => validateProductionManifest(build())).toThrow(expectedError);
  });

  it("recursively freezes the exported production graph", () => {
    const representativeValues = [
      GPT_LIVE_CONTENT,
      GPT_LIVE_CONTENT.variants,
      GPT_LIVE_CONTENT.sources,
      GPT_LIVE_CONTENT.sources[0],
      GPT_LIVE_CONTENT.claims,
      GPT_LIVE_CONTENT.claims[0],
      GPT_LIVE_CONTENT.claims[0]?.sourceIds,
      GPT_LIVE_CONTENT.narration,
      GPT_LIVE_CONTENT.narration[0],
      GPT_LIVE_CONTENT.narration[0]?.claimIds,
      GPT_LIVE_TIMELINE,
      GPT_LIVE_TIMELINE[0],
      GPT_LIVE_CONTENT.branding
    ];

    for (const value of representativeValues) {
      expect(Object.isFrozen(value)).toBe(true);
    }
  });

  it("prevents mutation of frozen nested records and arrays", () => {
    const mutableBranding = GPT_LIVE_CONTENT.branding as unknown as { width: number };
    const mutableTimeline = GPT_LIVE_TIMELINE as unknown as unknown[];

    expect(() => {
      mutableBranding.width = 200;
    }).toThrow(TypeError);
    expect(() => mutableTimeline.push({})).toThrow(TypeError);
    expect(GPT_LIVE_CONTENT.branding.width).toBe(150);
    expect(GPT_LIVE_TIMELINE).toHaveLength(9);
  });
});
