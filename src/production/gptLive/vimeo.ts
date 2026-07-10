type UnknownRecord = Record<string, unknown>;

export interface VimeoHlsDependencies {
  readonly fetch?: typeof fetch;
}

const asRecord = (value: unknown): UnknownRecord | undefined =>
  value !== null && typeof value === "object" && !Array.isArray(value)
    ? (value as UnknownRecord)
    : undefined;

const asHlsUrl = (value: unknown): string | undefined => {
  const url = asRecord(value)?.url;
  if (typeof url !== "string") return undefined;

  try {
    const parsed = new URL(url);
    return parsed.protocol === "https:" && parsed.pathname.toLowerCase().endsWith(".m3u8")
      ? url
      : undefined;
  } catch {
    return undefined;
  }
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

  throw new Error("Vimeo player config does not contain a valid HLS playlist");
}

export async function resolveVimeoHlsUrl(
  playerConfigUrl: string,
  dependencies: VimeoHlsDependencies = {}
): Promise<string> {
  let response: Response;

  try {
    response = await (dependencies.fetch ?? globalThis.fetch)(playerConfigUrl);
  } catch {
    throw new Error("Vimeo player config request failed");
  }

  if (!response.ok) {
    throw new Error(`Vimeo player config request failed with status ${response.status}`);
  }

  let config: unknown;
  try {
    config = await response.json();
  } catch {
    throw new Error("Vimeo player config response was not valid JSON");
  }

  return selectVimeoHlsUrl(config);
}
