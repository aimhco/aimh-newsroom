import { BlockList, isIP } from "node:net";

type UnknownRecord = Record<string, unknown>;

const DEFAULT_TIMEOUT_MS = 15_000;
const SAFE_ERROR_CODE = /^[A-Z][A-Z0-9_-]{0,31}$/;

const blockedAddresses = new BlockList();
for (const [network, prefix] of [
  ["0.0.0.0", 8],
  ["10.0.0.0", 8],
  ["100.64.0.0", 10],
  ["127.0.0.0", 8],
  ["169.254.0.0", 16],
  ["172.16.0.0", 12],
  ["192.168.0.0", 16],
  ["198.18.0.0", 15],
  ["224.0.0.0", 4],
  ["240.0.0.0", 4]
] as const) {
  blockedAddresses.addSubnet(network, prefix, "ipv4");
}
for (const [network, prefix] of [
  ["::", 96],
  ["::ffff:0:0", 96],
  ["fc00::", 7],
  ["fe80::", 10],
  ["ff00::", 8]
] as const) {
  blockedAddresses.addSubnet(network, prefix, "ipv6");
}

export type VimeoHlsErrorCategory =
  | "invalid_config_url"
  | "request_timeout"
  | "request_failed"
  | "http_status"
  | "invalid_response_url"
  | "invalid_json"
  | "invalid_playlist";

export class VimeoHlsError extends Error {
  readonly category: VimeoHlsErrorCategory;
  readonly status?: number;

  constructor(category: VimeoHlsErrorCategory, message: string, status?: number) {
    super(message);
    this.name = "VimeoHlsError";
    this.category = category;
    this.status = status;
  }
}

export interface VimeoHlsDependencies {
  readonly fetch?: typeof fetch;
  readonly timeoutMs?: number;
  readonly createTimeoutSignal?: (timeoutMs: number) => AbortSignal;
}

const asRecord = (value: unknown): UnknownRecord | undefined =>
  value !== null && typeof value === "object" && !Array.isArray(value)
    ? (value as UnknownRecord)
    : undefined;

const normalizedHostname = (hostname: string): string => {
  const unwrapped =
    hostname.startsWith("[") && hostname.endsWith("]")
      ? hostname.slice(1, -1).toLowerCase()
      : hostname.toLowerCase();
  return unwrapped.endsWith(".") ? unwrapped.slice(0, -1) : unwrapped;
};

const isPublicDestination = (hostname: string): boolean => {
  const normalized = normalizedHostname(hostname);
  if (normalized === "localhost" || normalized.endsWith(".localhost")) return false;

  const family = isIP(normalized);
  if (family === 0) return true;
  return !blockedAddresses.check(normalized, family === 4 ? "ipv4" : "ipv6");
};

const isVimeoCdnDestination = (hostname: string): boolean => {
  const normalized = normalizedHostname(hostname);
  return normalized === "vimeocdn.com" || normalized.endsWith(".vimeocdn.com");
};

const isAllowedConfigQuery = (url: URL): boolean => {
  const entries = [...url.searchParams.entries()];
  if (entries.length === 0) return true;
  return (
    entries.length === 1 &&
    entries[0]![0] === "h" &&
    /^[A-Za-z0-9_-]+$/.test(entries[0]![1])
  );
};

const parsePlayerConfigUrl = (
  value: string,
  category: "invalid_config_url" | "invalid_response_url",
  message: string
): URL => {
  let parsed: URL;
  try {
    parsed = new URL(value);
  } catch {
    throw new VimeoHlsError(category, message);
  }

  if (
    parsed.protocol !== "https:" ||
    parsed.hostname !== "player.vimeo.com" ||
    parsed.port !== "" ||
    parsed.username !== "" ||
    parsed.password !== "" ||
    !/^\/video\/\d+\/config$/.test(parsed.pathname) ||
    parsed.hash !== "" ||
    !isAllowedConfigQuery(parsed)
  ) {
    throw new VimeoHlsError(category, message);
  }

  return parsed;
};

const asHlsUrl = (value: unknown): string | undefined => {
  const url = asRecord(value)?.url;
  if (typeof url !== "string") return undefined;

  try {
    const parsed = new URL(url);
    return parsed.protocol === "https:" &&
      parsed.port === "" &&
      parsed.username === "" &&
      parsed.password === "" &&
      parsed.pathname.toLowerCase().endsWith(".m3u8") &&
      isVimeoCdnDestination(parsed.hostname) &&
      isPublicDestination(parsed.hostname)
      ? url
      : undefined;
  } catch {
    return undefined;
  }
};

const safeErrorCode = (error: unknown): string | undefined => {
  const code = asRecord(error)?.code;
  const value = typeof code === "number" ? String(code) : code;
  return typeof value === "string" && SAFE_ERROR_CODE.test(value) ? value : undefined;
};

const isTimeoutError = (error: unknown): boolean => {
  const name = error instanceof Error ? error.name : asRecord(error)?.name;
  return name === "AbortError" || name === "TimeoutError";
};

export function selectVimeoHlsUrl(config: unknown): string {
  const request = asRecord(config)?.request;
  const files = asRecord(request)?.files;
  const hls = asRecord(files)?.hls;
  const cdns = asRecord(asRecord(hls)?.cdns);

  if (cdns) {
    for (const preferredCdn of ["fastly_skyfire", "akfire_interconnect_quic"] as const) {
      const preferredUrl = asHlsUrl(cdns[preferredCdn]);
      if (preferredUrl) return preferredUrl;
    }

    for (const cdn of Object.values(cdns)) {
      const fallbackUrl = asHlsUrl(cdn);
      if (fallbackUrl) return fallbackUrl;
    }
  }

  throw new VimeoHlsError(
    "invalid_playlist",
    "Vimeo player config does not contain a valid HLS playlist"
  );
}

export async function resolveVimeoHlsUrl(
  playerConfigUrl: string,
  dependencies: VimeoHlsDependencies = {}
): Promise<string> {
  parsePlayerConfigUrl(playerConfigUrl, "invalid_config_url", "Invalid Vimeo player config URL");

  const timeoutMs = dependencies.timeoutMs ?? DEFAULT_TIMEOUT_MS;
  if (!Number.isFinite(timeoutMs) || timeoutMs <= 0) {
    throw new VimeoHlsError("request_failed", "Invalid Vimeo player config request timeout");
  }
  const createTimeoutSignal =
    dependencies.createTimeoutSignal ?? ((milliseconds: number) => AbortSignal.timeout(milliseconds));
  let signal: AbortSignal;
  try {
    signal = createTimeoutSignal(timeoutMs);
  } catch (error) {
    const code = safeErrorCode(error);
    throw new VimeoHlsError(
      "request_failed",
      `Vimeo player config timeout setup failed${code ? ` (code ${code})` : ""}`
    );
  }
  let response: Response;

  try {
    response = await (dependencies.fetch ?? globalThis.fetch)(playerConfigUrl, {
      redirect: "error",
      signal
    });
  } catch (error) {
    if (isTimeoutError(error)) {
      throw new VimeoHlsError(
        "request_timeout",
        `Vimeo player config request timed out after ${timeoutMs}ms`
      );
    }
    const code = safeErrorCode(error);
    throw new VimeoHlsError(
      "request_failed",
      `Vimeo player config request failed${code ? ` (code ${code})` : ""}`
    );
  }

  if (response.url) {
    parsePlayerConfigUrl(
      response.url,
      "invalid_response_url",
      "Vimeo player config response URL was invalid"
    );
  }
  if (!response.ok) {
    throw new VimeoHlsError(
      "http_status",
      `Vimeo player config request failed with status ${response.status}`,
      response.status
    );
  }

  let config: unknown;
  try {
    config = await response.json();
  } catch {
    throw new VimeoHlsError("invalid_json", "Vimeo player config response was not valid JSON");
  }

  return selectVimeoHlsUrl(config);
}
