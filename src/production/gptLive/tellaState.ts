import type { GptLiveVariant } from "./types";

export interface TellaTimelinePlan {
  readonly clips: readonly {
    readonly id: string;
    readonly kind: "source_clip" | "narration";
    readonly durationSeconds: number;
  }[];
}

export const TELLA_TIMELINE_AUDIT_SCHEMA_VERSION = "0.1.0" as const;
export const TELLA_LAYOUT_DURATION_TOLERANCE_MS = 100;
export const TELLA_STORY_DURATION_TOLERANCE_MS = 1_000 / 30;

const COMPATIBILITY_VARIANTS = ["dynamic_editorial", "aimh_visual_host"] as const;
const AUDIT_KEYS = [
  "schemaVersion",
  "compatibilityVideoIds",
  "orderedClipIds",
  "remoteStoryDurationMs",
  "narrationLayouts",
  "soundEffectIds"
] as const;
const LAYOUT_KEYS = [
  "clipId",
  "layoutId",
  "sourceId",
  "startTimeMs",
  "durationMs",
  "transitionStyle"
] as const;

export interface TellaNarrationLayoutAudit {
  readonly clipId: string;
  readonly layoutId: string;
  readonly sourceId: string;
  readonly startTimeMs: 0;
  readonly durationMs: number;
  readonly transitionStyle: "hardCut";
}

export interface TellaTimelineAudit {
  readonly schemaVersion: typeof TELLA_TIMELINE_AUDIT_SCHEMA_VERSION;
  readonly compatibilityVideoIds: Record<GptLiveVariant, string>;
  readonly orderedClipIds: Record<GptLiveVariant, readonly string[]>;
  readonly remoteStoryDurationMs: Record<GptLiveVariant, number>;
  readonly narrationLayouts: Record<GptLiveVariant, readonly TellaNarrationLayoutAudit[]>;
  readonly soundEffectIds: Record<GptLiveVariant, readonly []>;
}

export interface TellaStateForTimelineAudit {
  readonly variantVideoIds: Record<GptLiveVariant, string>;
  readonly sourceIds: Record<string, string>;
  readonly variantClipIds: Record<GptLiveVariant, Record<string, string>>;
  readonly layoutIds: Record<string, string>;
  readonly timelineAudit?: unknown;
}

export interface BuildTellaTimelineAuditOptions {
  readonly plan: TellaTimelinePlan;
  readonly state: TellaStateForTimelineAudit;
  readonly remoteStoryDurationMs: Record<GptLiveVariant, number>;
  readonly narrationLayoutDurationMs: Record<GptLiveVariant, Record<string, number>>;
}

const invalid = (detail: string): never => {
  throw new Error(`Invalid Tella timeline audit: ${detail}`);
};

const isRecord = (value: unknown): value is Record<string, unknown> =>
  value !== null && typeof value === "object" && !Array.isArray(value);

const requireRecord = (value: unknown, label: string): Record<string, unknown> =>
  isRecord(value) ? value : invalid(`${label} must be an object`);

const requireExactKeys = (
  value: Record<string, unknown>,
  expected: readonly string[],
  label: string
): void => {
  const actual = Object.keys(value);
  if (actual.length !== expected.length || !expected.every((key) => Object.hasOwn(value, key))) {
    invalid(`${label} keys must be exact`);
  }
};

const requireVariantRecord = (
  value: unknown,
  label: string
): Record<GptLiveVariant, unknown> => {
  const record = requireRecord(value, label);
  requireExactKeys(record, COMPATIBILITY_VARIANTS, label);
  return record as Record<GptLiveVariant, unknown>;
};

export const isUnsafeTellaReference = (value: string): boolean => {
  const trimmed = value.trim();
  return trimmed !== value || /^(?:[a-z][a-z0-9+.-]*:|\/\/)/i.test(trimmed);
};

const requireId = (value: unknown, label: string): string => {
  if (
    typeof value !== "string" ||
    !value ||
    isUnsafeTellaReference(value) ||
    !/^[a-z0-9][a-z0-9_-]*$/i.test(value)
  ) {
    invalid(`${label} must be a non-URL ID`);
  }
  return value as string;
};

const requireIdMap = (value: unknown, label: string): Record<string, string> => {
  const record = requireRecord(value, label);
  return Object.fromEntries(
    Object.entries(record).map(([key, id]) => [key, requireId(id, `${label}.${key}`)])
  );
};

const expectedProgramDurationMs = (plan: TellaTimelinePlan): number =>
  Math.round(plan.clips.reduce((total, clip) => total + clip.durationSeconds, 0) * 1_000);

const expectedOrderedClipIds = (
  plan: TellaTimelinePlan,
  state: TellaStateForTimelineAudit,
  variant: GptLiveVariant
): string[] => {
  const clipIds = requireIdMap(state.variantClipIds[variant], `${variant} variant clip IDs`);
  return plan.clips.map((clip) => requireId(clipIds[clip.id], `${variant} clip ${clip.id}`));
};

const expectedNarrationLayouts = (
  plan: TellaTimelinePlan,
  state: TellaStateForTimelineAudit,
  variant: GptLiveVariant
): TellaNarrationLayoutAudit[] => {
  const clipIds = requireIdMap(state.variantClipIds[variant], `${variant} variant clip IDs`);
  const sourceIds = requireIdMap(state.sourceIds, "Tella source IDs");
  const layoutIds = requireIdMap(state.layoutIds, "Tella layout IDs");
  return plan.clips.filter((clip) => clip.kind === "narration").map((clip) => ({
    clipId: requireId(clipIds[clip.id], `${variant} narration clip ${clip.id}`),
    layoutId: requireId(layoutIds[`${variant}:${clip.id}`], `${variant} layout ${clip.id}`),
    sourceId: requireId(
      sourceIds[`plate:${variant}:${clip.id}`],
      `${variant} plate source ${clip.id}`
    ),
    startTimeMs: 0,
    durationMs: Math.round(clip.durationSeconds * 1_000),
    transitionStyle: "hardCut"
  }));
};

export function buildTellaTimelineAudit(
  options: BuildTellaTimelineAuditOptions
): TellaTimelineAudit {
  const narrationIds = options.plan.clips
    .filter((clip) => clip.kind === "narration")
    .map((clip) => clip.id);
  const audit: TellaTimelineAudit = {
    schemaVersion: TELLA_TIMELINE_AUDIT_SCHEMA_VERSION,
    compatibilityVideoIds: { ...options.state.variantVideoIds },
    orderedClipIds: Object.fromEntries(
      COMPATIBILITY_VARIANTS.map((variant) => [
        variant,
        expectedOrderedClipIds(options.plan, options.state, variant)
      ])
    ) as unknown as Record<GptLiveVariant, readonly string[]>,
    remoteStoryDurationMs: { ...options.remoteStoryDurationMs },
    narrationLayouts: Object.fromEntries(
      COMPATIBILITY_VARIANTS.map((variant) => {
        const durations = options.narrationLayoutDurationMs[variant];
        requireExactKeys(durations, narrationIds, `${variant} queried layout durations`);
        return [
          variant,
          expectedNarrationLayouts(options.plan, options.state, variant).map((layout, index) => {
            const durationMs = durations[narrationIds[index]!];
            if (!Number.isSafeInteger(durationMs) || durationMs <= 0) {
              invalid(`${variant} queried layout duration is invalid: ${narrationIds[index]}`);
            }
            return { ...layout, durationMs };
          })
        ];
      })
    ) as unknown as Record<GptLiveVariant, readonly TellaNarrationLayoutAudit[]>,
    soundEffectIds: {
      dynamic_editorial: [],
      aimh_visual_host: []
    }
  };
  validateTellaTimelineAudit(options.plan, { ...options.state, timelineAudit: audit });
  return audit;
}

export function validateTellaTimelineAudit(
  plan: TellaTimelinePlan,
  stateValue: unknown
): TellaTimelineAudit {
  const state = requireRecord(stateValue, "Tella state");
  const variantVideoIds = requireVariantRecord(state.variantVideoIds, "variant video IDs");
  const variantClipIds = requireVariantRecord(state.variantClipIds, "variant clip ID groups");
  const typedState: TellaStateForTimelineAudit = {
    variantVideoIds: Object.fromEntries(
      COMPATIBILITY_VARIANTS.map((variant) => [
        variant,
        requireId(variantVideoIds[variant], `${variant} video ID`)
      ])
    ) as Record<GptLiveVariant, string>,
    sourceIds: requireIdMap(state.sourceIds, "source IDs"),
    variantClipIds: Object.fromEntries(
      COMPATIBILITY_VARIANTS.map((variant) => [
        variant,
        requireIdMap(variantClipIds[variant], `${variant} clip IDs`)
      ])
    ) as Record<GptLiveVariant, Record<string, string>>,
    layoutIds: requireIdMap(state.layoutIds, "layout IDs")
  };
  const timelineIds = plan.clips.map((clip) => clip.id);
  const narrationIds = plan.clips
    .filter((clip) => clip.kind === "narration")
    .map((clip) => clip.id);
  for (const variant of COMPATIBILITY_VARIANTS) {
    requireExactKeys(typedState.variantClipIds[variant], timelineIds, `${variant} clip IDs`);
  }
  requireExactKeys(
    typedState.layoutIds,
    COMPATIBILITY_VARIANTS.flatMap((variant) =>
      narrationIds.map((id) => `${variant}:${id}`)
    ),
    "layout IDs"
  );
  requireExactKeys(
    typedState.sourceIds,
    [
      ...timelineIds,
      ...COMPATIBILITY_VARIANTS.flatMap((variant) =>
        narrationIds.map((id) => `plate:${variant}:${id}`)
      )
    ],
    "source IDs"
  );
  const audit = requireRecord(state.timelineAudit, "timeline audit");
  requireExactKeys(audit, AUDIT_KEYS, "timeline audit");
  if (audit.schemaVersion !== TELLA_TIMELINE_AUDIT_SCHEMA_VERSION) {
    invalid("schema version is unsupported");
  }

  const compatibilityVideoIds = requireVariantRecord(
    audit.compatibilityVideoIds,
    "compatibility video IDs"
  );
  const orderedClipIds = requireVariantRecord(audit.orderedClipIds, "ordered clip IDs");
  const remoteStoryDurationMs = requireVariantRecord(
    audit.remoteStoryDurationMs,
    "remote story durations"
  );
  const narrationLayouts = requireVariantRecord(audit.narrationLayouts, "narration layouts");
  const soundEffectIds = requireVariantRecord(audit.soundEffectIds, "sound-effect IDs");
  const expectedDurationMs = expectedProgramDurationMs(plan);

  for (const variant of COMPATIBILITY_VARIANTS) {
    if (compatibilityVideoIds[variant] !== typedState.variantVideoIds[variant]) {
      invalid(`${variant} compatibility video ID does not match state`);
    }
    const actualOrder = orderedClipIds[variant];
    const expectedOrder = expectedOrderedClipIds(plan, typedState, variant);
    if (!Array.isArray(actualOrder) || JSON.stringify(actualOrder) !== JSON.stringify(expectedOrder)) {
      invalid(`${variant} clip order does not match the plan`);
    }

    const storyDurationMs = remoteStoryDurationMs[variant];
    if (
      !Number.isSafeInteger(storyDurationMs) ||
      (storyDurationMs as number) <= 0 ||
      Math.abs((storyDurationMs as number) - expectedDurationMs) > TELLA_STORY_DURATION_TOLERANCE_MS
    ) {
      invalid(`${variant} remote story duration does not match the plan within one 30fps frame`);
    }

    const actualLayouts = narrationLayouts[variant];
    const expectedLayouts = expectedNarrationLayouts(plan, typedState, variant);
    if (!Array.isArray(actualLayouts) || actualLayouts.length !== expectedLayouts.length) {
      invalid(`${variant} narration layout count does not match the plan`);
    }
    const layoutRecords = actualLayouts as unknown[];
    for (const [index, expected] of expectedLayouts.entries()) {
      const actual = requireRecord(layoutRecords[index], `${variant} narration layout ${index + 1}`);
      requireExactKeys(actual, LAYOUT_KEYS, `${variant} narration layout ${index + 1}`);
      if (
        actual.clipId !== expected.clipId ||
        actual.layoutId !== expected.layoutId ||
        actual.sourceId !== expected.sourceId ||
        actual.startTimeMs !== 0 ||
        actual.transitionStyle !== "hardCut" ||
        !Number.isSafeInteger(actual.durationMs) ||
        Math.abs((actual.durationMs as number) - expected.durationMs) >
          TELLA_LAYOUT_DURATION_TOLERANCE_MS
      ) {
        invalid(`${variant} narration layout ${index + 1} does not match current state`);
      }
    }

    if (!Array.isArray(soundEffectIds[variant]) || soundEffectIds[variant].length !== 0) {
      invalid(`${variant} sound-effect IDs must be empty`);
    }
  }

  return audit as unknown as TellaTimelineAudit;
}

export function assertTellaProgramDuration(
  plan: TellaTimelinePlan,
  durationSeconds: number,
  label: string
): void {
  const expectedSeconds = expectedProgramDurationMs(plan) / 1_000;
  if (
    !Number.isFinite(durationSeconds) ||
    durationSeconds <= 0 ||
    Math.abs(durationSeconds - expectedSeconds) > 1 / 30
  ) {
    invalid(`${label} duration does not match the plan within one 30fps frame`);
  }
}
