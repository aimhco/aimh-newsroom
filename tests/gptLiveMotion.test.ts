import {
  mkdir,
  mkdtemp,
  readFile,
  readdir,
  rm,
  stat as fsStat,
  symlink,
  writeFile
} from "node:fs/promises";
import { readFileSync, readdirSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, sep } from "node:path";
import { fileURLToPath } from "node:url";
import { bundle as bundleRemotion } from "@remotion/bundler";
import { Resvg } from "@resvg/resvg-js";
import {
  openBrowser,
  renderStill,
  selectComposition as selectRemotionComposition
} from "@remotion/renderer";
import { describe, expect, it, vi } from "vitest";
import { GPT_LIVE_CONTENT, GPT_LIVE_VISUAL_CONTENT } from "../src/production/gptLive/content";
import {
  evidenceForScene,
  stageEvidencePublicAssets
} from "../src/production/gptLive/evidence";
import {
  SCENE_STATE_COUNTS,
  normalizedBeatIndex,
  normalizedBeatPlan,
  sceneStateIndex
} from "../src/production/gptLive/motion/beatState";
import {
  calculateGptLivePlateMetadata,
  resolveEvidenceAssetUrl,
  type GptLivePlateProps
} from "../src/production/gptLive/motion/Root";
import {
  GPT_LIVE_SCENES,
  sceneStyle,
  type SceneRect
} from "../src/production/gptLive/motion/sceneStyle";
import {
  evidencePlacementGeometry
} from "../src/production/gptLive/motion/scenePrimitives";
import * as plateModule from "../src/production/gptLive/motion/GptLivePlate";
import * as primitiveModule from "../src/production/gptLive/motion/scenePrimitives";
import {
  evidenceSequenceState,
  evidenceStage
} from "../src/production/gptLive/motion/SceneRenderer";
import {
  assertUniformSafeAreaMetadata,
  buildSmokeFramePlan,
  useCaseTemporalFrames
} from "../src/production/gptLive/motion/smokePlan";
import * as smokePlanModule from "../src/production/gptLive/motion/smokePlan";
import {
  assertPlateContract,
  buildPlateRenderJobs,
  readPlateNarrationRecords,
  renderGptLivePlates,
  type PlateNarrationRecord
} from "../src/production/gptLive/renderPlates";
import type { MediaInspection } from "../src/production/gptLive/mediaInspection";
import type {
  EvidenceSpec,
  GptLiveVariant
} from "../src/production/gptLive/types";
import { runCommand } from "../src/render/process";

const VARIANTS = ["dynamic_editorial", "aimh_visual_host"] as const satisfies readonly GptLiveVariant[];
const SAFE_AREA: SceneRect = { x: 1722, y: 0, width: 198, height: 198 };
const VALID_PNG = Buffer.from(new Resvg(`
  <svg xmlns="http://www.w3.org/2000/svg" width="1280" height="720">
    <defs><linearGradient id="g"><stop stop-color="#fff"/><stop offset="1" stop-color="#172554"/></linearGradient></defs>
    <rect width="1280" height="720" fill="url(#g)"/>
    <rect x="80" y="90" width="900" height="90" fill="#fff"/>
    <rect x="80" y="240" width="1100" height="42" fill="#111827"/>
    <circle cx="1060" cy="520" r="110" fill="#ef4444"/>
  </svg>
`).render().asPng());
const MOTION_DIR = fileURLToPath(
  new URL("../src/production/gptLive/motion/", import.meta.url)
);
const TEST_EVIDENCE_DIMENSIONS = Object.fromEntries(
  GPT_LIVE_CONTENT.evidence
    .filter((item) => item.playbackDecision === "captured_source")
    .map((item) => [item.assetPath, { width: 1920, height: 1080 }])
);
const calculateContainedRect = (
  primitiveModule as unknown as {
    calculateContainedRect?: (
      viewportWidth: number,
      viewportHeight: number,
      assetWidth: number,
      assetHeight: number
    ) => SceneRect;
  }
).calculateContainedRect;
const calculateFocalRect = (
  primitiveModule as unknown as {
    calculateFocalRect?: (containedRect: SceneRect, focalRect: EvidenceSpec["focalRect"]) => SceneRect;
  }
).calculateFocalRect;
const spotlightMaskRects = (
  primitiveModule as unknown as {
    spotlightMaskRects?: (
      viewportWidth: number,
      viewportHeight: number,
      spotlightRect: SceneRect
    ) => readonly SceneRect[];
  }
).spotlightMaskRects;
const evidencePlateLayout = (
  plateModule as unknown as {
    evidencePlateLayout?: (
      stage: "establish" | "explain" | "spotlight",
      frameRect: SceneRect,
      contentRect: SceneRect
    ) => {
      readonly rect: SceneRect;
      readonly animateEntrance: boolean;
      readonly maskReservedTopRight: boolean;
    };
  }
).evidencePlateLayout;
const plateEntranceStyle = (
  plateModule as unknown as {
    plateEntranceStyle?: (
      animateEntrance: boolean,
      entranceProgress: number
    ) => { readonly transform: string; readonly opacity: number };
  }
).plateEntranceStyle;
const resolveSmokeEvidenceDimensions = (
  smokePlanModule as unknown as {
    resolveSmokeEvidenceDimensions?: (
      evidence: EvidenceSpec,
      dimensions: Readonly<Record<string, { readonly width: number; readonly height: number }>>
    ) => { readonly width: number; readonly height: number } | undefined;
  }
).resolveSmokeEvidenceDimensions;
const assertContentfulFrameMetadata = (
  smokePlanModule as unknown as {
    assertContentfulFrameMetadata?: (metadata: string) => void;
  }
).assertContentfulFrameMetadata;

const renderedLumaRange = async (file: string): Promise<readonly [number, number]> => {
  const result = await runCommand(process.env.FFMPEG_PATH ?? "ffmpeg", [
    "-hide_banner",
    "-i",
    file,
    "-vf",
    "signalstats,metadata=print",
    "-frames:v",
    "1",
    "-f",
    "null",
    "-"
  ]);
  const metadata = `${result.stdout}\n${result.stderr}`;
  const minimum = Number(metadata.match(/lavfi\.signalstats\.YMIN=(\d+)/)?.[1]);
  const maximum = Number(metadata.match(/lavfi\.signalstats\.YMAX=(\d+)/)?.[1]);
  if (!Number.isFinite(minimum) || !Number.isFinite(maximum)) {
    throw new Error(`Rendered frame luma metadata is incomplete for ${file}`);
  }
  return [minimum, maximum];
};

const withTimeout = async <T>(
  operation: Promise<T>,
  timeoutMilliseconds: number,
  label: string,
  onTimeout?: () => void
): Promise<T> => {
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    return await Promise.race([
      operation,
      new Promise<never>((_resolve, reject) => {
        timer = setTimeout(() => {
          onTimeout?.();
          reject(new Error(`${label} timed out after ${timeoutMilliseconds}ms`));
        }, timeoutMilliseconds);
      })
    ]);
  } finally {
    if (timer) clearTimeout(timer);
  }
};

const overlaps = (left: SceneRect, right: SceneRect): boolean =>
  left.x < right.x + right.width &&
  left.x + left.width > right.x &&
  left.y < right.y + right.height &&
  left.y + left.height > right.y;

const narrationRecords: readonly PlateNarrationRecord[] = GPT_LIVE_CONTENT.narration.map(
  (item, index) => ({
    id: item.id,
    text: item.text,
    durationSeconds: 8 + index / 10
  })
);

const validInspection = (durationSeconds = 8): MediaInspection => ({
  durationSeconds,
  video: {
    codecName: "h264",
    width: 1920,
    height: 1080,
    framesPerSecond: 30
  }
});

const validSlateInspection = (durationSeconds = 8): MediaInspection => ({
  ...validInspection(durationSeconds),
  audio: { codecName: "aac" }
});

const isMasterPath = (path: string): boolean => path.includes(`${sep}master${sep}`);

const virtualAtomicFs = (episodeDir: string, finalExists = false) => {
  const stagingPath = join(episodeDir, ".plates-staging-test");
  const platesPath = join(episodeDir, "plates");
  const evidencePublicDir = join(episodeDir, ".evidence-public-test");
  const cleanupEvidence = vi.fn(async () => undefined);
  return {
    access: async (path: string) => {
      if (finalExists && path === platesPath) return;
      throw Object.assign(new Error("not found"), { code: "ENOENT" });
    },
    makeTempDirectory: async () => stagingPath,
    removeDirectory: vi.fn(async (_path: string) => undefined),
    renameDirectory: vi.fn(async (_from: string, _to: string) => undefined),
    evidencePublicDir,
    cleanupEvidence,
    stageEvidencePublicAssets: vi.fn(async () => ({
      publicDir: evidencePublicDir,
      dimensions: TEST_EVIDENCE_DIMENSIONS,
      cleanup: cleanupEvidence
    }))
  };
};

const virtualEvidenceStage = (episodeDir: string) => ({
  publicDir: join(episodeDir, ".evidence-public-test"),
  dimensions: TEST_EVIDENCE_DIMENSIONS,
  cleanup: async () => undefined
});

describe("GPT-Live scene styles", () => {
  it("pins the approved OpenAI-reported GPQA comparison for the evidence scene", () => {
    expect(GPT_LIVE_VISUAL_CONTENT.evidence).toMatchObject({
      benchmarkAttribution: "OPENAI-REPORTED / VENDOR-REPORTED",
      benchmarkComparison: "GPT-LIVE-1 VS ADVANCED VOICE MODE",
      benchmarkName: "ON GPQA",
      benchmarkStatement:
        "OpenAI reports GPT-Live-1 substantially outperforms Advanced Voice Mode on GPQA.",
      qualification: "Not independent validation."
    });
  });

  it.each(VARIANTS)("uses the approved white evidence style for %s", (variant) => {
    expect(sceneStyle(variant, "full_duplex")).toMatchObject({
      persistentHost: false,
      maxStaticFrames: 180,
      reservedTopRight: SAFE_AREA,
      contentRegions: [{ x: 72, y: 90, width: 1580, height: 900 }],
      layout: "evidence_editorial",
      motion: "editorial_cuts",
      palette: {
        background: "#F7F8F6",
        foreground: "#111315",
        paper: "#FFFFFF",
        signal: "#E85B50",
        accent: "#3E8F86",
        support: "#5E8500",
        muted: "#6E7472"
      }
    });
  });

  it.each(VARIANTS)("returns deterministic style decisions for every %s scene", (variant) => {
    for (const scene of GPT_LIVE_SCENES) {
      const first = sceneStyle(variant, scene);
      const second = sceneStyle(variant, scene);

      expect(first).toEqual(second);
      expect(first.variant).toBe(variant);
      expect(first.scene).toBe(scene);
      expect(first.palette).toEqual(
        expect.objectContaining({
          background: expect.stringMatching(/^#/),
          foreground: expect.stringMatching(/^#/),
          signal: expect.stringMatching(/^#/),
          accent: expect.stringMatching(/^#/)
        })
      );
      expect(first.layout).toEqual(expect.any(String));
      expect(first.motion).toEqual(expect.any(String));
    }
  });

  it.each(VARIANTS)("reserves the final-logo safe area for all %s scenes", (variant) => {
    for (const scene of GPT_LIVE_SCENES) {
      const style = sceneStyle(variant, scene);
      expect(style.reservedTopRight).toEqual(SAFE_AREA);
      expect(style.contentRegions.length).toBeGreaterThan(0);
      expect(style.contentRegions.every((region) => !overlaps(region, SAFE_AREA))).toBe(true);
    }
  });

  it.each(VARIANTS)("changes visual beats every 2-6 seconds for all %s scenes", (variant) => {
    for (const scene of GPT_LIVE_SCENES) {
      const style = sceneStyle(variant, scene);
      const gaps = style.beatFrames.slice(1).map((frame, index) => frame - style.beatFrames[index]!);

      expect(style.beatFrames[0]).toBe(0);
      expect(gaps.length).toBeGreaterThan(0);
      expect(gaps.every((gap) => gap >= 60 && gap <= 180)).toBe(true);
      expect(style.maxStaticFrames).toBeLessThanOrEqual(180);
      expect(Math.max(...gaps)).toBeLessThanOrEqual(style.maxStaticFrames);
    }
  });

  it("defines six distinct fast reveals for the use-cases scene", () => {
    for (const variant of VARIANTS) {
      expect(sceneStyle(variant, "use_cases").beatFrames).toHaveLength(6);
    }
  });
});

describe("GPT-Live Remotion composition metadata", () => {
  const props: GptLivePlateProps = {
    variant: "dynamic_editorial",
    durationSeconds: 4.51,
    sceneContent: GPT_LIVE_VISUAL_CONTENT.hook
  };

  it("ceilings measured seconds at 30fps so the plate covers narration", async () => {
    await expect(calculateGptLivePlateMetadata({ props })).resolves.toMatchObject({
      durationInFrames: 136,
      fps: 30,
      width: 1920,
      height: 1080
    });
    await expect(
      calculateGptLivePlateMetadata({ props: { ...props, durationSeconds: 22.941315 } })
    ).resolves.toMatchObject({ durationInFrames: 689 });
  });

  it("never returns fewer than one frame for a positive duration", async () => {
    await expect(
      calculateGptLivePlateMetadata({ props: { ...props, durationSeconds: 0.001 } })
    ).resolves.toMatchObject({ durationInFrames: 1 });
  });

  it.each([Number.NaN, Number.POSITIVE_INFINITY, 0, -1])(
    "rejects invalid duration %s",
    async (durationSeconds) => {
      await expect(
        calculateGptLivePlateMetadata({ props: { ...props, durationSeconds } })
      ).rejects.toThrow("durationSeconds must be finite and positive");
    }
  );

  it("resolves relative evidence paths through Remotion staticFile", () => {
    expect(resolveEvidenceAssetUrl("evidence/capture name.png")).toBe(
      "/evidence/capture%20name.png"
    );
    expect(() => resolveEvidenceAssetUrl("/evidence/raw.png")).toThrow(
      "Evidence asset path must be relative"
    );
  });
});

describe("GPT-Live evidence-first motion contracts", () => {
  it("builds a bounded four-panel spotlight mask around the focal rectangle", () => {
    expect(spotlightMaskRects).toBeTypeOf("function");
    expect(spotlightMaskRects?.(640, 1080, { x: 100, y: 200, width: 300, height: 400 }))
      .toEqual([
        { x: 0, y: 0, width: 640, height: 200 },
        { x: 0, y: 200, width: 100, height: 400 },
        { x: 400, y: 200, width: 240, height: 400 },
        { x: 0, y: 600, width: 640, height: 480 }
      ]);
  });

  it("removes internal host, footer, and use-case labels from all motion source", () => {
    const motionSource = readdirSync(MOTION_DIR, { recursive: true })
      .filter((path): path is string => typeof path === "string" && /\.tsx?$/.test(path))
      .map((path) => readFileSync(join(MOTION_DIR, path), "utf8"))
      .join("\n");
    const editorialSource = readFileSync(
      join(MOTION_DIR, "scenes", "EditorialScenes.tsx"),
      "utf8"
    );

    expect(motionSource).not.toMatch(
      /HostRail|DYNAMIC EDITORIAL|AIMH VISUAL HOST|PLATE \//
    );
    expect(editorialSource).not.toMatch(/progressLabel|OF \{content\.items\.length\}/);
  });

  it("keeps the Node-side smoke planner free of React renderer imports", () => {
    const smokePlanSource = readFileSync(join(MOTION_DIR, "smokePlan.ts"), "utf8");
    expect(smokePlanSource).not.toMatch(/from "\.\/SceneRenderer"/);
  });

  it("uses Remotion evidence images with contain and never cover", () => {
    const primitivesSource = readFileSync(join(MOTION_DIR, "scenePrimitives.tsx"), "utf8");

    expect(primitivesSource).toMatch(/<Img\b/);
    expect(primitivesSource).toMatch(/objectFit:\s*"contain"/);
    expect(primitivesSource).not.toMatch(/objectFit:\s*"cover"/);
  });

  it.each([
    [
      "left",
      {
        gridTemplateColumns: "36% 64%",
        gridTemplateRows: "100%",
        bandGridArea: "1 / 1",
        viewportGridArea: "1 / 2"
      }
    ],
    [
      "right",
      {
        gridTemplateColumns: "64% 36%",
        gridTemplateRows: "100%",
        bandGridArea: "1 / 2",
        viewportGridArea: "1 / 1"
      }
    ],
    [
      "top",
      {
        gridTemplateColumns: "100%",
        gridTemplateRows: "28% 72%",
        bandGridArea: "1 / 1",
        viewportGridArea: "2 / 1"
      }
    ],
    [
      "bottom",
      {
        gridTemplateColumns: "100%",
        gridTemplateRows: "72% 28%",
        bandGridArea: "2 / 1",
        viewportGridArea: "1 / 1"
      }
    ]
  ] as const)("uses approved %s evidence placement geometry", (placement, expected) => {
    expect(evidencePlacementGeometry(placement)).toEqual(expected);
  });

  it("calculates a 16:9 contained rect in the narrow side viewport", () => {
    expect(calculateContainedRect).toBeTypeOf("function");
    const rect = calculateContainedRect?.(1011.2, 900, 1920, 1080);
    expect(rect?.x).toBeCloseTo(0, 5);
    expect(rect?.y).toBeCloseTo(165.6, 5);
    expect(rect?.width).toBeCloseTo(1011.2, 5);
    expect(rect?.height).toBeCloseTo(568.8, 5);
  });

  it("calculates the contained rect for the 1271x658 GPT-Live capture", () => {
    expect(calculateContainedRect).toBeTypeOf("function");
    const rect = calculateContainedRect?.(1011.2, 900, 1271, 658);
    expect(rect?.x).toBeCloseTo(0, 5);
    expect(rect?.y).toBeCloseTo(188.25, 2);
    expect(rect?.width).toBeCloseTo(1011.2, 5);
    expect(rect?.height).toBeCloseTo(523.501, 3);
  });

  it("maps focal geometry inside the actual contained image rect", () => {
    expect(calculateFocalRect).toBeTypeOf("function");
    const rect = calculateFocalRect?.(
      { x: 0, y: 165.6, width: 1011.2, height: 568.8 },
      { x: 0.08, y: 0.22, width: 0.78, height: 0.46 }
    );
    expect(rect?.x).toBeCloseTo(80.896, 5);
    expect(rect?.y).toBeCloseTo(290.736, 5);
    expect(rect?.width).toBeCloseTo(788.736, 5);
    expect(rect?.height).toBeCloseTo(261.648, 5);
  });

  it("uses a genuine full-frame wrapper only during evidence establish", () => {
    expect(evidencePlateLayout).toBeTypeOf("function");
    const frameRect = { x: 0, y: 0, width: 1920, height: 1080 };
    const contentRect = { x: 72, y: 90, width: 1580, height: 900 };
    expect(evidencePlateLayout?.("establish", frameRect, contentRect)).toEqual({
      rect: frameRect,
      animateEntrance: false,
      maskReservedTopRight: true
    });
    expect(evidencePlateLayout?.("explain", frameRect, contentRect)).toEqual({
      rect: contentRect,
      animateEntrance: false,
      maskReservedTopRight: false
    });
  });

  it("keeps entrance content opaque from frame zero while translating non-evidence scenes", () => {
    expect(plateEntranceStyle).toBeTypeOf("function");
    expect(plateEntranceStyle?.(true, 0)).toEqual({
      transform: "translateX(-28px)",
      opacity: 1
    });
    expect(plateEntranceStyle?.(true, 1)).toEqual({
      transform: "translateX(0px)",
      opacity: 1
    });
    expect(plateEntranceStyle?.(false, 1)).toEqual({
      transform: "none",
      opacity: 1
    });
  });

  it("uses deterministic establish, explain, and spotlight stages", () => {
    expect([0, 59, 60, 173, 174, 299].map((frame) => evidenceStage(frame, 300))).toEqual([
      "establish",
      "establish",
      "explain",
      "explain",
      "spotlight",
      "spotlight"
    ]);
    expect([0, 47, 48, 138, 139, 239].map((frame) => evidenceStage(frame, 240))).toEqual([
      "establish",
      "establish",
      "explain",
      "explain",
      "spotlight",
      "spotlight"
    ]);
  });
});

describe("GPT-Live normalized beat scheduling", () => {
  const durations = [
    { name: "short", frames: 8 * 30 },
    { name: "nominal", frames: 22 * 30 },
    { name: "long", frames: 75 * 30 }
  ] as const;

  it.each(durations)("shows all six use cases during a $name plate", ({ frames }) => {
    const seen = new Set<number>();
    for (let frame = 0; frame < frames; frame += 1) {
      seen.add(sceneStateIndex("use_cases", frame, frames, 180));
    }
    expect([...seen].sort()).toEqual([0, 1, 2, 3, 4, 5]);
  });

  it.each(durations)("makes every required scene state reachable in a $name plate", ({ frames }) => {
    for (const scene of GPT_LIVE_SCENES) {
      const seen = new Set<number>();
      for (let frame = 0; frame < frames; frame += 1) {
        seen.add(sceneStateIndex(scene, frame, frames, 180));
      }
      expect(seen.size, scene).toBe(SCENE_STATE_COUNTS[scene]);
    }
  });

  it("never holds a state longer than maxStaticFrames in a long plate", () => {
    const durationInFrames = 120 * 30;
    for (const scene of GPT_LIVE_SCENES) {
      let longestRun = 0;
      let currentRun = 0;
      let previous = -1;
      for (let frame = 0; frame < durationInFrames; frame += 1) {
        const current = sceneStateIndex(scene, frame, durationInFrames, 180);
        currentRun = current === previous ? currentRun + 1 : 1;
        longestRun = Math.max(longestRun, currentRun);
        previous = current;
      }
      expect(longestRun, scene).toBeLessThanOrEqual(180);
    }
  });

  it("cycles deterministically after the first complete pass", () => {
    const options = { durationInFrames: 75 * 30, itemCount: 6, maxStaticFrames: 180 };
    const plan = normalizedBeatPlan(options);
    expect(plan.firstPassFrames).toBe(plan.holdFrames * options.itemCount);
    for (let offset = 0; offset < plan.firstPassFrames; offset += 1) {
      expect(normalizedBeatIndex(plan.firstPassFrames + offset, options)).toBe(
        normalizedBeatIndex(offset, options)
      );
    }
  });
});

describe("GPT-Live rendered smoke planning", () => {
  it("enforces the rendered safe-area assertion for every smoke stage", () => {
    const renderSmokeSource = readFileSync(join(MOTION_DIR, "renderSmoke.ts"), "utf8");
    expect(renderSmokeSource).not.toMatch(/item\.stage\s*!==\s*"establish"/);
  });

  it("resolves dimensions by the staged public basename for nested evidence", () => {
    expect(resolveSmokeEvidenceDimensions).toBeTypeOf("function");
    const evidence = {
      ...GPT_LIVE_CONTENT.evidence.find(
        (item) => item.playbackDecision === "captured_source"
      )!,
      assetPath: "evidence/nested/capture.png"
    };
    expect(
      resolveSmokeEvidenceDimensions?.(evidence, {
        "evidence/capture.png": { width: 1280, height: 720 }
      })
    ).toEqual({ width: 1280, height: 720 });
  });

  it("plans every evidence item and stage plus stills for non-evidence scenes", () => {
    const plan = buildSmokeFramePlan(8 * 30);
    expect(plan).toHaveLength(48);
    expect(new Set(plan.map(({ outputName }) => outputName)).size).toBe(48);
    expect(new Set(plan.map(({ sceneContent }) => sceneContent.scene))).toEqual(
      new Set(GPT_LIVE_SCENES)
    );
    expect(new Set(plan.map(({ variant }) => variant))).toEqual(new Set(VARIANTS));

    for (const variant of VARIANTS) {
      for (const scene of ["hook", "use_cases", "cta"] as const) {
        const items = plan.filter(
          (item) => item.variant === variant && item.sceneContent.scene === scene
        );
        expect(items).toHaveLength(2);
        expect(items.some(({ frame, outputName }) => frame === 0 && outputName.endsWith("-start.png")))
          .toBe(true);
      }
    }
  });

  it("samples establish, explain, and spotlight for every captured evidence item", () => {
    const plan = buildSmokeFramePlan(8 * 30);
    const captures = GPT_LIVE_CONTENT.evidence.filter(
      (evidence) => evidence.playbackDecision === "captured_source"
    );
    for (const variant of VARIANTS) {
      for (const evidence of captures) {
        const items = plan.filter(
          (item) => item.variant === variant && item.evidence?.id === evidence.id
        ) as readonly (typeof plan[number] & { readonly stage?: string })[];
        expect(items.map(({ stage }) => stage)).toEqual([
          "establish",
          "explain",
          "spotlight"
        ]);
        expect(items.map(({ frame }) =>
          evidenceSequenceState(frame, 240, evidenceForScene(evidence.scene).length).stage
        )).toEqual([
          "establish",
          "explain",
          "spotlight"
        ]);
        expect(items.every((item) => item.evidence?.id === evidence.id)).toBe(true);
      }
    }
  });

  it("selects six 8-second use-case frames that render states zero through five", () => {
    const durationInFrames = 8 * 30;
    const frames = useCaseTemporalFrames(durationInFrames);
    expect(frames).toHaveLength(6);
    expect(frames.map((frame) => sceneStateIndex("use_cases", frame, durationInFrames, 180))).toEqual(
      [0, 1, 2, 3, 4, 5]
    );
  });

  it("accepts a uniform safe area and rejects visible pixel variance", () => {
    expect(() =>
      assertUniformSafeAreaMetadata(
        [
          "lavfi.signalstats.YMIN=26",
          "lavfi.signalstats.YMAX=26",
          "lavfi.signalstats.UMIN=129",
          "lavfi.signalstats.UMAX=129",
          "lavfi.signalstats.VMIN=127",
          "lavfi.signalstats.VMAX=127"
        ].join("\n")
      )
    ).not.toThrow();
    expect(() =>
      assertUniformSafeAreaMetadata(
        [
          "lavfi.signalstats.YMIN=26",
          "lavfi.signalstats.YMAX=26",
          "lavfi.signalstats.UMIN=129",
          "lavfi.signalstats.UMAX=200",
          "lavfi.signalstats.VMIN=127",
          "lavfi.signalstats.VMAX=127"
        ].join("\n")
      )
    ).toThrow("safe area is not uniform");
    expect(() => assertUniformSafeAreaMetadata("missing metadata")).toThrow(
      "safe area metadata is incomplete"
    );
  });

  it("accepts visible frame luma variation and rejects a uniform base canvas", () => {
    expect(assertContentfulFrameMetadata).toBeTypeOf("function");
    expect(() =>
      assertContentfulFrameMetadata?.(
        "lavfi.signalstats.YMIN=34\nlavfi.signalstats.YMAX=228"
      )
    ).not.toThrow();
    expect(() =>
      assertContentfulFrameMetadata?.(
        "lavfi.signalstats.YMIN=228\nlavfi.signalstats.YMAX=228"
      )
    ).toThrow("frame has no visible luma variation");
    expect(() => assertContentfulFrameMetadata?.("missing metadata")).toThrow(
      "frame metadata is incomplete"
    );
  });

  it("renders meaningful content at frame zero for every non-evidence scene", async () => {
    const integrationDir = await mkdtemp(join(tmpdir(), "gpt-live-frame-zero-"));
    const bundleOutput = join(integrationDir, "bundle");
    let browser: Awaited<ReturnType<typeof openBrowser>> | undefined;
    try {
      const entryPoint = fileURLToPath(
        new URL("../src/production/gptLive/motion/Root.tsx", import.meta.url)
      );
      await withTimeout(
        bundleRemotion({ entryPoint, outDir: bundleOutput }),
        15_000,
        "Remotion frame-zero bundle"
      );
      browser = await withTimeout(
        openBrowser("chrome", { logLevel: "error" }),
        10_000,
        "Remotion frame-zero browser open"
      );

      for (const scene of ["hook", "use_cases", "cta"] as const) {
        const inputProps: GptLivePlateProps = {
          variant: "dynamic_editorial",
          durationSeconds: 8,
          sceneContent: GPT_LIVE_VISUAL_CONTENT[scene]
        };
        const composition = await withTimeout(
          selectRemotionComposition({
            serveUrl: bundleOutput,
            id: "GptLivePlate",
            inputProps,
            puppeteerInstance: browser,
            timeoutInMilliseconds: 10_000,
            logLevel: "error"
          }),
          12_000,
          `Remotion ${scene} composition selection`
        );
        const output = join(integrationDir, `${scene}-frame-0.png`);
        await withTimeout(
          renderStill({
            composition,
            serveUrl: bundleOutput,
            inputProps,
            frame: 0,
            output,
            imageFormat: "png",
            overwrite: true,
            puppeteerInstance: browser,
            timeoutInMilliseconds: 10_000,
            logLevel: "error"
          }),
          15_000,
          `Remotion ${scene} frame-zero render`
        );
        const [minimum, maximum] = await renderedLumaRange(output);
        expect(maximum, `${scene} YMIN=${minimum} YMAX=${maximum}`).toBeGreaterThan(minimum);
      }
    } finally {
      const cleanupResults = await Promise.allSettled([
        ...(browser ? [browser.close({ silent: true })] : []),
        rm(integrationDir, { recursive: true, force: true })
      ]);
      const cleanupFailure = cleanupResults.find(
        (result): result is PromiseRejectedResult => result.status === "rejected"
      );
      if (cleanupFailure) throw cleanupFailure.reason;
    }
  }, 70_000);
});

describe("GPT-Live plate render planning", () => {
  it("rejects malformed persisted voice data with a clear error", async () => {
    await expect(
      readPlateNarrationRecords("/tmp/gpt-live-motion", async () => "{not-json")
    ).rejects.toThrow("Invalid GPT-Live voice data");
  });

  it("builds exactly one job per narration and variant with shared measured durations", () => {
    const episodeDir = "/tmp/gpt-live-motion";
    const jobs = buildPlateRenderJobs({
      episodeDir,
      narrationRecords,
      evidenceDimensions: TEST_EVIDENCE_DIMENSIONS
    });

    expect(jobs).toHaveLength(14);
    for (const [index, narration] of GPT_LIVE_CONTENT.narration.entries()) {
      const matching = jobs.filter((job) => job.narrationId === narration.id);
      expect(matching).toHaveLength(2);
      expect(matching.map(({ variant }) => variant)).toEqual(VARIANTS);
      expect(new Set(matching.map(({ durationSeconds }) => durationSeconds))).toEqual(
        new Set([narrationRecords[index]!.durationSeconds])
      );
      expect(matching.map(({ outputPath }) => outputPath)).toEqual([
        join(episodeDir, "plates", "dynamic_editorial", `${narration.id}.mp4`),
        join(episodeDir, "plates", "aimh_visual_host", `${narration.id}.mp4`)
      ]);
      expect(new Set(matching.map(({ outputPath }) => outputPath)).size).toBe(2);
      expect(matching[0]!.inputProps).toHaveProperty("sceneContent.scene", narration.scene);
      expect(matching[0]!.inputProps).toHaveProperty("sceneContent.narrationText", narration.text);
      expect(matching[0]!.inputProps).toHaveProperty("sceneContent.claimIds", narration.claimIds);
      const capturedEvidence = GPT_LIVE_CONTENT.evidence.filter(
        (item) => item.scene === narration.scene && item.playbackDecision === "captured_source"
      );
      if (capturedEvidence.length > 0) {
        expect(matching[0]!.inputProps.evidences).toEqual(
          capturedEvidence.map((evidence) => ({
            ...evidence,
            assetWidth: 1920,
            assetHeight: 1080
          }))
        );
        expect(matching[0]!.inputProps.evidences).not.toHaveProperty("0.assetUrl");
      } else {
        expect(matching[0]!.inputProps).not.toHaveProperty("evidences");
      }
    }
  });

  it("never creates plate jobs for source clips", () => {
    const jobs = buildPlateRenderJobs({
      episodeDir: "/tmp/gpt-live-motion",
      narrationRecords,
      evidenceDimensions: TEST_EVIDENCE_DIMENSIONS
    });
    const sourceIds = new Set<string>(GPT_LIVE_CONTENT.timeline
      .filter((item) => item.kind === "source_clip")
      .map(({ id }) => id));

    expect(jobs.every((job) => !sourceIds.has(job.narrationId))).toBe(true);
  });

  it.each([
    ["audio", { ...validInspection(), audio: { codecName: "aac" } }, "must not contain audio"],
    ["width", { ...validInspection(), video: { ...validInspection().video, width: 1280 } }, "1920x1080"],
    ["height", { ...validInspection(), video: { ...validInspection().video, height: 720 } }, "1920x1080"],
    ["fps", { ...validInspection(), video: { ...validInspection().video, framesPerSecond: 29.97 } }, "30fps"],
    ["codec", { ...validInspection(), video: { ...validInspection().video, codecName: "hevc" } }, "H.264"],
    ["duration", validInspection(8.101), "duration mismatch"]
  ])("rejects an invalid plate %s contract", (_name, inspection, message) => {
    expect(() =>
      assertPlateContract(inspection as MediaInspection, validSlateInspection(8))
    ).toThrow(message as string);
  });

  it("accepts an inclusive 0.1s plate-versus-slate duration delta", () => {
    expect(() =>
      assertPlateContract(validInspection(20.1), validSlateInspection(20))
    ).not.toThrow();
  });

  it("bundles once, renders 14 muted H.264 plates, validates them, then atomically publishes the plan", async () => {
    const episodeDir = "/tmp/gpt-live-motion";
    const events: string[] = [];
    const bundle = vi.fn(async () => "serve-url");
    const selectComposition = vi.fn(async (_options: unknown) => ({ id: "GptLivePlate" }));
    const renderMedia = vi.fn(async (options: {
      outputLocation: string;
      muted?: boolean;
      codec: string;
      inputProps: GptLivePlateProps;
    }) => {
      events.push(`render:${options.outputLocation}`);
    });
    const inspectMediaFile = vi.fn(async (_ffprobe: string, outputPath: string) => {
      const narration = narrationRecords.find(({ id }) => outputPath.includes(id))!;
      events.push(`inspect:${outputPath}`);
      return isMasterPath(outputPath)
        ? validSlateInspection(narration.durationSeconds)
        : validInspection(narration.durationSeconds);
    });
    const writeJsonAtomic = vi.fn(async (path: string) => {
      events.push(`publish:${path}`);
    });
    const atomicFs = virtualAtomicFs(episodeDir);

    const result = await renderGptLivePlates(
      { episodeDir, ffprobePath: "ffprobe", narrationRecords },
      {
        bundle,
        ensureDir: async () => undefined,
        inspectMediaFile,
        renderMedia,
        selectComposition,
        writeJsonAtomic,
        ...atomicFs
      }
    );

    expect(bundle).toHaveBeenCalledTimes(1);
    expect(bundle).toHaveBeenCalledWith({
      entryPoint: expect.stringContaining("motion/Root.tsx"),
      publicDir: atomicFs.evidencePublicDir
    });
    expect(atomicFs.stageEvidencePublicAssets).toHaveBeenCalledWith(episodeDir);
    expect(atomicFs.cleanupEvidence).toHaveBeenCalledOnce();
    expect(atomicFs.removeDirectory).not.toHaveBeenCalledWith("serve-url");
    expect(renderMedia).toHaveBeenCalledTimes(14);
    expect(
      renderMedia.mock.calls.every(([options]) =>
        options.outputLocation.includes(`${sep}.plates-staging-test${sep}`)
      )
    ).toBe(true);
    expect(inspectMediaFile).toHaveBeenCalledTimes(28);
    for (const narration of narrationRecords) {
      expect(inspectMediaFile).toHaveBeenCalledWith(
        "ffprobe",
        join(episodeDir, "master", `${narration.id}.mp4`)
      );
    }
    expect(renderMedia.mock.calls.every(([options]) => options.codec === "h264")).toBe(true);
    expect(renderMedia.mock.calls.every(([options]) => options.muted === true)).toBe(true);
    expect(
      renderMedia.mock.calls
        .flatMap(([options]) => options.inputProps.evidences ?? [])
        .every((evidence) =>
          evidence.assetWidth === 1920 && evidence.assetHeight === 1080
        )
    ).toBe(true);
    expect(writeJsonAtomic).toHaveBeenCalledOnce();
    expect(atomicFs.renameDirectory).toHaveBeenCalledWith(
      join(episodeDir, ".plates-staging-test"),
      join(episodeDir, "plates")
    );
    expect(atomicFs.renameDirectory.mock.invocationCallOrder.at(-1)).toBeLessThan(
      writeJsonAtomic.mock.invocationCallOrder[0]!
    );
    expect(writeJsonAtomic).toHaveBeenCalledWith(join(episodeDir, "tella", "plan.json"), result.plan);
    expect(events.at(-1)).toBe(`publish:${join(episodeDir, "tella", "plan.json")}`);
  });

  it("reads measured narration records from voice/narration.json when records are not supplied", async () => {
    const episodeDir = "/tmp/gpt-live-motion";
    const readFile = vi.fn(async () =>
      JSON.stringify({
        provider: "elevenlabs",
        warnings: [],
        chunks: narrationRecords
      })
    );
    const result = await renderGptLivePlates(
      { episodeDir, ffprobePath: "ffprobe" },
      {
        bundle: async () => "serve-url",
        ensureDir: async () => undefined,
        inspectMediaFile: async (_ffprobe, outputPath) => {
          const narration = narrationRecords.find(({ id }) => outputPath.includes(id))!;
          return isMasterPath(outputPath)
            ? validSlateInspection(narration.durationSeconds)
            : validInspection(narration.durationSeconds);
        },
        readFile,
        renderMedia: async () => undefined,
        selectComposition: async () => ({ id: "GptLivePlate" }),
        writeJsonAtomic: async () => undefined,
        ...virtualAtomicFs(episodeDir)
      }
    );

    expect(readFile).toHaveBeenCalledWith(
      join(episodeDir, "voice", "narration.json"),
      "utf8"
    );
    expect(result.jobs).toHaveLength(14);
  });

  it("cleans evidence and plate staging when bundling fails", async () => {
    const episodeDir = "/tmp/gpt-live-bundle-failure";
    const atomicFs = virtualAtomicFs(episodeDir);

    await expect(
      renderGptLivePlates(
        { episodeDir, ffprobePath: "ffprobe", narrationRecords },
        {
          bundle: async () => {
            throw new Error("injected bundle failure");
          },
          ensureDir: async () => undefined,
          ...atomicFs
        }
      )
    ).rejects.toThrow("injected bundle failure");

    expect(atomicFs.cleanupEvidence).toHaveBeenCalledOnce();
    expect(atomicFs.removeDirectory).toHaveBeenCalledWith(
      join(episodeDir, ".plates-staging-test")
    );
  });

  it("boundedly bundles, selects, and loads staged evidence through Remotion", async () => {
    const episodeDir = await mkdtemp(join(tmpdir(), "gpt-live-remotion-evidence-"));
    const integrationDir = await mkdtemp(join(tmpdir(), "gpt-live-remotion-integration-"));
    const bundleOutput = join(integrationDir, "bundle");
    let staged: Awaited<ReturnType<typeof stageEvidencePublicAssets>> | undefined;
    let browser: Awaited<ReturnType<typeof openBrowser>> | undefined;
    try {
      await mkdir(join(episodeDir, "evidence"));
      await Promise.all(
        GPT_LIVE_CONTENT.evidence
          .filter((item) => item.playbackDecision === "captured_source")
          .map((evidence) => writeFile(join(episodeDir, evidence.assetPath), VALID_PNG))
      );
      staged = await stageEvidencePublicAssets(episodeDir);
      const entryPoint = fileURLToPath(
        new URL("../src/production/gptLive/motion/Root.tsx", import.meta.url)
      );
      await withTimeout(
        bundleRemotion({ entryPoint, publicDir: staged.publicDir, outDir: bundleOutput }),
        15_000,
        "Remotion evidence bundle"
      );

      let browserOpenTimedOut = false;
      const browserPromise = openBrowser("chrome", { logLevel: "error" });
      void browserPromise
        .then(async (lateBrowser) => {
          if (browserOpenTimedOut) await lateBrowser.close({ silent: true });
        })
        .catch(() => undefined);
      browser = await withTimeout(
        browserPromise,
        10_000,
        "Remotion browser open",
        () => {
          browserOpenTimedOut = true;
        }
      );

      const evidenceJob = buildPlateRenderJobs({
        episodeDir,
        narrationRecords,
        evidenceDimensions: staged.dimensions
      }).find((job) => job.inputProps.evidences && job.inputProps.evidences.length > 0)!;
      const composition = await withTimeout(
        selectRemotionComposition({
          serveUrl: bundleOutput,
          id: "GptLivePlate",
          inputProps: evidenceJob.inputProps,
          puppeteerInstance: browser,
          timeoutInMilliseconds: 10_000,
          logLevel: "error"
        }),
        12_000,
        "Remotion composition selection"
      );

      expect(composition).toMatchObject({ id: "GptLivePlate" });
      const assetUrl = resolveEvidenceAssetUrl(evidenceJob.inputProps.evidences![0]!.assetPath);
      await expect(
        readFile(join(bundleOutput, "public", decodeURIComponent(assetUrl.slice(1))))
      ).resolves.toEqual(VALID_PNG);
    } finally {
      const cleanupResults = await Promise.allSettled([
        ...(browser ? [browser.close({ silent: true })] : []),
        ...(staged ? [staged.cleanup()] : []),
        rm(integrationDir, { recursive: true, force: true }),
        rm(episodeDir, { recursive: true, force: true })
      ]);
      const cleanupFailure = cleanupResults.find(
        (result): result is PromiseRejectedResult => result.status === "rejected"
      );
      if (cleanupFailure) throw cleanupFailure.reason;
    }
    await expect(fsStat(bundleOutput)).rejects.toMatchObject({ code: "ENOENT" });
    if (staged) {
      await expect(fsStat(staged.publicDir)).rejects.toMatchObject({ code: "ENOENT" });
    }
  }, 35_000);

  it("rejects plate-versus-slate drift above 0.1s even when both match voice within 0.1s", async () => {
    const episodeDir = "/tmp/gpt-live-motion";
    const records = narrationRecords.map((record) => ({ ...record, durationSeconds: 8 }));
    const inspectMediaFile = vi.fn(async (_ffprobe: string, outputPath: string) =>
      isMasterPath(outputPath)
        ? validSlateInspection(7.94)
        : validInspection(8.06)
    );
    const writeJsonAtomic = vi.fn(async () => undefined);

    await expect(
      renderGptLivePlates(
        { episodeDir, ffprobePath: "ffprobe", narrationRecords: records },
        {
          bundle: async () => "serve-url",
          ensureDir: async () => undefined,
          inspectMediaFile,
          renderMedia: async () => undefined,
          selectComposition: async () => ({ id: "GptLivePlate" }),
          writeJsonAtomic,
          ...virtualAtomicFs(episodeDir)
        }
      )
    ).rejects.toThrow("plate/slate duration mismatch");
    expect(inspectMediaFile).toHaveBeenCalledWith(
      "ffprobe",
      join(episodeDir, "master", "narration_hook.mp4")
    );
    expect(writeJsonAtomic).not.toHaveBeenCalled();
  });

  it("does not publish a plan when any plate fails validation", async () => {
    const writeJsonAtomic = vi.fn(async () => undefined);
    await expect(
      renderGptLivePlates(
        { episodeDir: "/tmp/gpt-live-motion", ffprobePath: "ffprobe", narrationRecords },
        {
          bundle: async () => "serve-url",
          ensureDir: async () => undefined,
          inspectMediaFile: async (_ffprobe, outputPath) =>
            isMasterPath(outputPath)
              ? validSlateInspection()
              : { ...validInspection(), audio: { codecName: "aac" } },
          renderMedia: async () => undefined,
          selectComposition: async () => ({ id: "GptLivePlate" }),
          writeJsonAtomic,
          ...virtualAtomicFs("/tmp/gpt-live-motion")
        }
      )
    ).rejects.toThrow("must not contain audio");
    expect(writeJsonAtomic).not.toHaveBeenCalled();
  });

  it.each(["render", "validation"] as const)(
    "preserves the prior plate set and removes staging when %s fails",
    async (failurePoint) => {
    const episodeDir = await mkdtemp(join(tmpdir(), "gpt-live-atomic-plates-"));
    const platesDir = join(episodeDir, "plates");
    const oldDynamic = join(platesDir, "dynamic_editorial", "old.txt");
    const oldHost = join(platesDir, "aimh_visual_host", "old.txt");
    await mkdir(join(platesDir, "dynamic_editorial"), { recursive: true });
    await mkdir(join(platesDir, "aimh_visual_host"), { recursive: true });
    await writeFile(oldDynamic, "old-dynamic", "utf8");
    await writeFile(oldHost, "old-host", "utf8");

    try {
      const rendering = renderGptLivePlates(
        { episodeDir, ffprobePath: "ffprobe", narrationRecords },
        {
          bundle: async () => "serve-url",
          inspectMediaFile: async (_ffprobe, outputPath) =>
            isMasterPath(outputPath)
              ? validSlateInspection(narrationRecords[0]!.durationSeconds)
              : { ...validInspection(narrationRecords[0]!.durationSeconds), audio: { codecName: "aac" } },
          renderMedia: async ({ outputLocation }) => {
            await writeFile(outputLocation, "partial-new-plate", "utf8");
            if (failurePoint === "render") throw new Error("injected render failure");
          },
          selectComposition: async () => ({ id: "GptLivePlate" }),
          stageEvidencePublicAssets: async () => virtualEvidenceStage(episodeDir),
          writeJsonAtomic: async () => undefined
        }
      );
      await expect(rendering).rejects.toThrow(
        failurePoint === "render" ? "injected render failure" : "must not contain audio"
      );

      expect(await readFile(oldDynamic, "utf8")).toBe("old-dynamic");
      expect(await readFile(oldHost, "utf8")).toBe("old-host");
      expect((await readdir(platesDir, { recursive: true })).filter((file) => file.endsWith(".mp4"))).toEqual([]);
      expect((await readdir(episodeDir)).filter((file) => file.startsWith(".plates-staging-"))).toEqual([]);
    } finally {
      await rm(episodeDir, { recursive: true, force: true });
    }
    }
  );

  it("rejects symlinked captured evidence before standalone rendering bundles", async () => {
    const episodeDir = await mkdtemp(join(tmpdir(), "gpt-live-render-evidence-link-"));
    const outsideDir = await mkdtemp(join(tmpdir(), "gpt-live-render-evidence-outside-"));
    const evidence = GPT_LIVE_CONTENT.evidence.find(
      (item) => item.playbackDecision === "captured_source"
    )!;
    const bundle = vi.fn(async () => "serve-url");
    try {
      await mkdir(join(episodeDir, "evidence"));
      const outsidePath = join(outsideDir, "outside.png");
      await writeFile(outsidePath, "not relevant");
      await symlink(outsidePath, join(episodeDir, evidence.assetPath));

      await expect(
        renderGptLivePlates(
          { episodeDir, ffprobePath: "ffprobe", narrationRecords },
          { bundle }
        )
      ).rejects.toThrow(/symlink/i);
      expect(bundle).not.toHaveBeenCalled();
    } finally {
      await rm(episodeDir, { recursive: true, force: true });
      await rm(outsideDir, { recursive: true, force: true });
    }
  });

  it("rolls the previous plate set back when atomic promotion fails", async () => {
    const episodeDir = "/tmp/gpt-live-promotion-failure";
    const platesPath = join(episodeDir, "plates");
    const stagingPath = join(episodeDir, ".plates-staging-test");
    const backupPath = `${stagingPath}.backup`;
    const atomicFs = virtualAtomicFs(episodeDir, true);
    atomicFs.renameDirectory.mockImplementation(async (from, to) => {
      if (from === stagingPath && to === platesPath) {
        throw new Error("injected promotion failure");
      }
    });
    const writeJsonAtomic = vi.fn(async () => undefined);

    await expect(
      renderGptLivePlates(
        { episodeDir, ffprobePath: "ffprobe", narrationRecords },
        {
          bundle: async () => "serve-url",
          ensureDir: async () => undefined,
          inspectMediaFile: async (_ffprobe, outputPath) => {
            const narration = narrationRecords.find(({ id }) => outputPath.includes(id))!;
            return isMasterPath(outputPath)
              ? validSlateInspection(narration.durationSeconds)
              : validInspection(narration.durationSeconds);
          },
          renderMedia: async () => undefined,
          selectComposition: async () => ({ id: "GptLivePlate" }),
          writeJsonAtomic,
          ...atomicFs
        }
      )
    ).rejects.toThrow("injected promotion failure");

    expect(atomicFs.renameDirectory.mock.calls).toEqual([
      [platesPath, backupPath],
      [stagingPath, platesPath],
      [backupPath, platesPath]
    ]);
    expect(atomicFs.removeDirectory).toHaveBeenCalledWith(stagingPath);
    expect(writeJsonAtomic).not.toHaveBeenCalled();
  });
});
