import { createHash } from "node:crypto";
import { readFile as defaultReadFile } from "node:fs/promises";
import { join } from "node:path";
import { writeJsonAtomic as defaultWriteJsonAtomic } from "./atomicFiles";
import { GPT_LIVE_CONTENT } from "./content";
import { validateContainedEpisodePaths } from "./qa/paths";
import type { GptLiveVariant } from "./types";

export const TELLA_EXPORT_RECEIPT_SCHEMA_VERSION = "0.1.0" as const;
export const TELLA_EXPORT_RECEIPT_RELATIVE_PATH = "reports/tella-export-receipt.json" as const;

export type TellaExportVersion = "version-a" | "version-b";

export interface TellaExportReceiptRecord {
  readonly version: TellaExportVersion;
  readonly sourceVariant: GptLiveVariant;
  readonly remoteVideoId: string;
  readonly workflowId: string;
  readonly exportPath: "exports/tella-a.mp4" | "exports/tella-b.mp4";
  readonly sha256: string;
  readonly byteSize: number;
}

export interface TellaExportReceipt {
  readonly schemaVersion: typeof TELLA_EXPORT_RECEIPT_SCHEMA_VERSION;
  readonly productionId: string;
  readonly exports: readonly [TellaExportReceiptRecord, TellaExportReceiptRecord];
}

export interface TellaExportSealIdentity {
  readonly version: TellaExportVersion;
  readonly sourceVariant: GptLiveVariant;
  readonly remoteVideoId: string;
  readonly workflowId: string;
}

export interface SealTellaExportsOptions {
  readonly episodeDir: string;
  readonly exports: readonly TellaExportSealIdentity[];
}

export interface ValidateSealedTellaExportsOptions {
  readonly episodeDir: string;
  readonly receipt: unknown;
  readonly tellaState: unknown;
}

type ReadText = (path: string, encoding: "utf8") => Promise<string>;
type ReadBytes = (path: string) => Promise<Uint8Array>;

export interface TellaExportReceiptDependencies {
  readonly readFile?: ReadText;
  readonly readFileBytes?: ReadBytes;
  readonly writeJsonAtomic?: typeof defaultWriteJsonAtomic;
}

const DEFINITIONS = [
  { version: "version-a", exportPath: "exports/tella-a.mp4" },
  { version: "version-b", exportPath: "exports/tella-b.mp4" }
] as const;
const RECEIPT_KEYS = ["schemaVersion", "productionId", "exports"] as const;
const RECORD_KEYS = [
  "version",
  "sourceVariant",
  "remoteVideoId",
  "workflowId",
  "exportPath",
  "sha256",
  "byteSize"
] as const;
const VARIANTS = ["dynamic_editorial", "aimh_visual_host"] as const;
const HASH = /^[a-f0-9]{64}$/;
const SAFE_ID = /^[a-z0-9][a-z0-9._-]{0,199}$/i;
const SAFE_WORKFLOW_ID = /^[a-z0-9][-a-z0-9._/:]{0,255}$/i;
const LEADING_URI_SCHEME = /^[A-Za-z][A-Za-z0-9+.-]*:/;
const PATH_SEGMENT_URI_SCHEME = /(?:^|\/)[A-Za-z][A-Za-z0-9+.-]*:/;
const SECRET_LIKE = /(?:api[_-]?key|bearer|credential|password|secret|signature|signed|token|x-amz)/i;

const invalid = (detail: string): never => {
  throw new Error(`Invalid Tella export receipt: ${detail}`);
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

const requireSafeId = (value: unknown, label: string): string => {
  if (typeof value !== "string" || !SAFE_ID.test(value)) {
    invalid(`${label} must be a non-URL ID`);
  }
  return value as string;
};

const requireVariantVideoIds = (stateValue: unknown): Record<GptLiveVariant, string> => {
  const state = requireRecord(stateValue, "Tella state");
  const ids = requireRecord(state.variantVideoIds, "Tella state variant video IDs");
  for (const variant of VARIANTS) {
    requireSafeId(ids[variant], `Tella state ${variant} video ID`);
  }
  return ids as unknown as Record<GptLiveVariant, string>;
};

const requireWorkflowId = (value: unknown, remoteVideoId: string): string => {
  if (
    typeof value !== "string" ||
    !SAFE_WORKFLOW_ID.test(value) ||
    value.includes("//") ||
    LEADING_URI_SCHEME.test(value) ||
    PATH_SEGMENT_URI_SCHEME.test(value)
  ) {
    invalid("workflowId must use the bounded non-URL workflow grammar");
  }
  const workflowId = value as string;
  if (SECRET_LIKE.test(workflowId)) invalid("workflowId contains secret-like data");
  if (!workflowId.startsWith(`Export-Story-${remoteVideoId}/`)) {
    invalid("workflowId must start with the exact Tella remote videoId prefix");
  }
  return workflowId;
};

const digest = (bytes: Uint8Array) => ({
  sha256: createHash("sha256").update(bytes).digest("hex"),
  byteSize: bytes.byteLength
});

export const tellaExportReceiptPath = (episodeDir: string): string =>
  join(episodeDir, TELLA_EXPORT_RECEIPT_RELATIVE_PATH);

export const tellaExportPath = (episodeDir: string, version: TellaExportVersion): string => {
  const definition = DEFINITIONS.find((candidate) => candidate.version === version);
  if (!definition) return invalid(`unsupported version ${version}`);
  return join(episodeDir, definition.exportPath);
};

export function parseTellaExportReceipt(
  value: unknown,
  tellaState: unknown
): TellaExportReceipt {
  const receipt = requireRecord(value, "receipt");
  requireExactKeys(receipt, RECEIPT_KEYS, "receipt");
  if (
    receipt.schemaVersion !== TELLA_EXPORT_RECEIPT_SCHEMA_VERSION ||
    receipt.productionId !== GPT_LIVE_CONTENT.id ||
    !Array.isArray(receipt.exports) ||
    receipt.exports.length !== DEFINITIONS.length
  ) {
    invalid("header or export coverage is invalid");
  }
  const exportValues = receipt.exports as unknown[];

  const variantVideoIds = requireVariantVideoIds(tellaState);
  const records = DEFINITIONS.map((definition, index): TellaExportReceiptRecord => {
    const record = requireRecord(exportValues[index], `export ${definition.version}`);
    requireExactKeys(record, RECORD_KEYS, `export ${definition.version}`);
    if (record.version !== definition.version || record.exportPath !== definition.exportPath) {
      invalid(`${definition.version} identity or path does not match the derived export path`);
    }
    if (!VARIANTS.includes(record.sourceVariant as GptLiveVariant)) {
      invalid(`${definition.version} sourceVariant is invalid`);
    }
    const sourceVariant = record.sourceVariant as GptLiveVariant;
    const remoteVideoId = requireSafeId(record.remoteVideoId, `${definition.version} remoteVideoId`);
    if (remoteVideoId !== variantVideoIds[sourceVariant]) {
      invalid(`${definition.version} remoteVideoId does not match Tella state sourceVariant`);
    }
    const workflowId = requireWorkflowId(record.workflowId, remoteVideoId);
    if (typeof record.sha256 !== "string" || !HASH.test(record.sha256)) {
      invalid(`${definition.version} sha256 is invalid`);
    }
    if (!Number.isSafeInteger(record.byteSize) || (record.byteSize as number) <= 0) {
      invalid(`${definition.version} byteSize is invalid`);
    }
    return {
      version: definition.version,
      sourceVariant,
      remoteVideoId,
      workflowId,
      exportPath: definition.exportPath,
      sha256: record.sha256 as string,
      byteSize: record.byteSize as number
    };
  });

  return {
    schemaVersion: TELLA_EXPORT_RECEIPT_SCHEMA_VERSION,
    productionId: GPT_LIVE_CONTENT.id,
    exports: [records[0]!, records[1]!]
  };
}

export async function validateSealedTellaExports(
  options: ValidateSealedTellaExportsOptions,
  dependencies: Pick<TellaExportReceiptDependencies, "readFileBytes"> = {}
): Promise<TellaExportReceipt> {
  const receipt = parseTellaExportReceipt(options.receipt, options.tellaState);
  const readFileBytes = dependencies.readFileBytes ??
    ((path: string) => defaultReadFile(path) as Promise<Uint8Array>);

  for (const record of receipt.exports) {
    const actual = digest(await readFileBytes(tellaExportPath(options.episodeDir, record.version)));
    if (actual.byteSize !== record.byteSize || actual.sha256 !== record.sha256) {
      throw new Error(
        `Tella export receipt mismatch for ${record.version}: expected ` +
        `${record.byteSize} bytes/${record.sha256}, received ${actual.byteSize} bytes/${actual.sha256}`
      );
    }
  }
  return receipt;
}

export async function sealTellaExports(
  options: SealTellaExportsOptions,
  dependencies: TellaExportReceiptDependencies = {}
) {
  const readFile = dependencies.readFile ?? (defaultReadFile as ReadText);
  const readFileBytes = dependencies.readFileBytes ??
    ((path: string) => defaultReadFile(path) as Promise<Uint8Array>);
  const writeJsonAtomic = dependencies.writeJsonAtomic ?? defaultWriteJsonAtomic;
  const statePath = join(options.episodeDir, "tella", "state.json");
  const exportPaths = DEFINITIONS.map(({ version }) => tellaExportPath(options.episodeDir, version));
  const reportsDirectory = join(options.episodeDir, "reports");
  const receiptPath = tellaExportReceiptPath(options.episodeDir);
  await validateContainedEpisodePaths(
    options.episodeDir,
    [statePath, ...exportPaths, reportsDirectory, receiptPath],
    { context: "Tella export sealing" }
  );
  const stateText = await readFile(statePath, "utf8");
  let tellaState: unknown;
  try {
    tellaState = JSON.parse(stateText);
  } catch {
    throw new Error("Invalid Tella state JSON while sealing exports");
  }
  if (options.exports.length !== DEFINITIONS.length) {
    invalid("seal inputs must cover exactly version-a and version-b");
  }

  const bytes = await Promise.all(
    exportPaths.map((path) => readFileBytes(path))
  );
  const records = DEFINITIONS.map((definition, index) => {
    const identity = options.exports[index];
    if (!identity || identity.version !== definition.version) {
      invalid("seal inputs must be ordered version-a then version-b");
    }
    return {
      ...identity,
      exportPath: definition.exportPath,
      ...digest(bytes[index]!)
    };
  });
  const receipt = parseTellaExportReceipt({
    schemaVersion: TELLA_EXPORT_RECEIPT_SCHEMA_VERSION,
    productionId: GPT_LIVE_CONTENT.id,
    exports: records
  }, tellaState);
  await writeJsonAtomic(receiptPath, receipt);
  return { episodeDir: options.episodeDir, receiptPath, receipt };
}
