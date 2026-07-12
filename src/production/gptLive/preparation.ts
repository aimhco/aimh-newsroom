import { createHash } from "node:crypto";

export interface PreparationFingerprintInput {
  readonly production: unknown;
  readonly voice: unknown;
  readonly plan: unknown;
  readonly sourceMatrix: string;
  readonly sourceManifest: unknown;
}

export interface PreparedGenerationRecord {
  readonly schemaVersion: "0.1.0";
  readonly status: "prepared";
  readonly productionId: string;
  readonly manifestFingerprint: string;
}

const HASH = /^[a-f0-9]{64}$/;
const PREPARED_KEYS = [
  "schemaVersion",
  "status",
  "productionId",
  "manifestFingerprint"
] as const;

const isRecord = (value: unknown): value is Record<string, unknown> =>
  value !== null && typeof value === "object" && !Array.isArray(value);

export function buildPreparationFingerprint(input: PreparationFingerprintInput): string {
  return createHash("sha256").update(JSON.stringify(input)).digest("hex");
}

export function parsePreparedGenerationRecord(
  value: unknown,
  expectedProductionId: string
): PreparedGenerationRecord {
  if (!isRecord(value)) throw new Error("Invalid prepared generation record");
  const keys = Object.keys(value);
  if (
    keys.length !== PREPARED_KEYS.length ||
    !PREPARED_KEYS.every((key) => Object.hasOwn(value, key)) ||
    value.schemaVersion !== "0.1.0" ||
    value.status !== "prepared" ||
    value.productionId !== expectedProductionId ||
    typeof value.manifestFingerprint !== "string" ||
    !HASH.test(value.manifestFingerprint)
  ) {
    throw new Error("Invalid prepared generation record");
  }
  return value as unknown as PreparedGenerationRecord;
}

export function validatePreparedGeneration(
  preparedValue: unknown,
  expectedProductionId: string,
  input: PreparationFingerprintInput
): PreparedGenerationRecord {
  const prepared = parsePreparedGenerationRecord(preparedValue, expectedProductionId);
  const currentFingerprint = buildPreparationFingerprint(input);
  if (prepared.manifestFingerprint !== currentFingerprint) {
    throw new Error(
      "Prepared generation fingerprint does not match current production records"
    );
  }
  return prepared;
}
