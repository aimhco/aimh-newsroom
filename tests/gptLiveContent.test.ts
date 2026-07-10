import { describe, expect, it } from "vitest";
import * as contentModule from "../src/production/gptLive/content";
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
