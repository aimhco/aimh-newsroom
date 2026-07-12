import { createHash } from "node:crypto";
import { mkdtemp, mkdir, readFile, rm, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it, vi } from "vitest";
import {
  TELLA_EXPORT_MAX_BYTES,
  parseTellaExportReceipt,
  sealTellaExports,
  validateSealedTellaExports,
  type TellaExportReceipt
} from "../src/production/gptLive/tellaExportReceipt";

const sha256 = (value: string): string => createHash("sha256").update(value).digest("hex");
const REAL_TELLA_WORKFLOW_ID =
  "Export-Story-vid_cmrfrx6lc006c04l4fjh0alem/2026-07-12T17:23:26.147Z/Story/1920x1080/30FPS";
const WORKFLOW_A =
  "Export-Story-vid_dynamic/2026-07-12T17:23:26.147Z/Story/1920x1080/30FPS";
const WORKFLOW_B =
  "Export-Story-vid_host/2026-07-12T17:24:26.147Z/Story/1920x1080/30FPS";
const DOWNLOAD_URL_A =
  "https://prod-compose.tella.tv/vid_dynamic/2026-07-12T17:23:26.147Z/video/1920x1080/30FPS/video.mp4?signature=SECRET_A";
const DOWNLOAD_URL_B =
  "https://prod-compose.tella.tv/vid_host/2026-07-12T17:24:26.147Z/video/1920x1080/30FPS/video.mp4?signature=SECRET_B";

const state = {
  variantVideoIds: {
    dynamic_editorial: "vid_dynamic",
    aimh_visual_host: "vid_host"
  }
};

const receipt = (): TellaExportReceipt => ({
  schemaVersion: "0.2.0",
  productionId: "2026-07-10-gpt-live-tella-ab",
  exports: [
    {
      version: "version-a",
      sourceVariant: "dynamic_editorial",
      remoteVideoId: "vid_dynamic",
      workflowId: WORKFLOW_A,
      exportPath: "exports/tella-a.mp4",
      sha256: sha256("export-a"),
      byteSize: 8
    },
    {
      version: "version-b",
      sourceVariant: "aimh_visual_host",
      remoteVideoId: "vid_host",
      workflowId: WORKFLOW_B,
      exportPath: "exports/tella-b.mp4",
      sha256: sha256("export-b"),
      byteSize: 8
    }
  ]
});

describe("GPT-Live Tella export receipt", () => {
  it("accepts the exact deterministic receipt and approved duplicate dynamic export", () => {
    expect(parseTellaExportReceipt(receipt(), state)).toEqual(receipt());

    const duplicate = receipt();
    (duplicate.exports as any)[1] = {
      ...duplicate.exports[1],
      sourceVariant: "dynamic_editorial",
      remoteVideoId: "vid_dynamic",
      workflowId: WORKFLOW_A,
      sha256: duplicate.exports[0].sha256,
      byteSize: duplicate.exports[0].byteSize
    };
    expect(parseTellaExportReceipt(duplicate, state)).toEqual(duplicate);
  });

  it("accepts the real Tella workflow grammar and one shared compatibility export workflow", () => {
    const realState = {
      variantVideoIds: {
        dynamic_editorial: "vid_cmrfrx6lc006c04l4fjh0alem",
        aimh_visual_host: "vid_unused_host"
      }
    };
    const compatible = receipt();
    (compatible.exports as any)[0] = {
      ...compatible.exports[0],
      sourceVariant: "dynamic_editorial",
      remoteVideoId: "vid_cmrfrx6lc006c04l4fjh0alem",
      workflowId: REAL_TELLA_WORKFLOW_ID
    };
    (compatible.exports as any)[1] = {
      ...compatible.exports[1],
      sourceVariant: "dynamic_editorial",
      remoteVideoId: "vid_cmrfrx6lc006c04l4fjh0alem",
      workflowId: REAL_TELLA_WORKFLOW_ID,
      sha256: compatible.exports[0].sha256,
      byteSize: compatible.exports[0].byteSize
    };

    expect(parseTellaExportReceipt(compatible, realState)).toEqual(compatible);
  });

  it.each([
    ["wrong video ID", (value: any) => { value.exports[0].remoteVideoId = "vid_host"; }],
    ["workflow URL", (value: any) => { value.exports[0].workflowId = "https://tella.example/export"; }],
    ["workflow scheme", (value: any) => { value.exports[0].workflowId = "file://vid_dynamic/export"; }],
    ["workflow single-slash URI scheme", (value: any) => {
      value.exports[0].workflowId = "file:/Export-Story-vid_dynamic/Story";
    }],
    ["workflow scheme without slashes", (value: any) => {
      value.exports[0].workflowId = "https:Export-Story-vid_dynamic/Story";
    }],
    ["workflow embedded URL", (value: any) => {
      value.exports[0].workflowId = "Export-Story-vid_dynamic/https://example.com";
    }],
    ["workflow embedded protocol-relative URL", (value: any) => {
      value.exports[0].workflowId = "Export-Story-vid_dynamic//example.com/private/path";
    }],
    ["workflow extended video ID prefix", (value: any) => {
      value.exports[0].workflowId = "Export-Story-vid_dynamic_extra/Story";
    }],
    ["workflow whitespace", (value: any) => { value.exports[0].workflowId = "Export vid_dynamic/Story"; }],
    ["workflow query", (value: any) => { value.exports[0].workflowId = "Export-vid_dynamic/Story?download=1"; }],
    ["workflow hash", (value: any) => { value.exports[0].workflowId = "Export-vid_dynamic/Story#frame"; }],
    ["workflow backslash", (value: any) => { value.exports[0].workflowId = "Export-vid_dynamic\\Story"; }],
    ["workflow unsupported character", (value: any) => { value.exports[0].workflowId = "Export-vid_dynamic@Story"; }],
    ["workflow too long", (value: any) => { value.exports[0].workflowId = `Export-vid_dynamic/${"a".repeat(300)}`; }],
    ["workflow secret", (value: any) => { value.exports[0].workflowId = "token-vid_dynamic-secret"; }],
    ["workflow without video", (value: any) => { value.exports[0].workflowId = "export-job-a"; }],
    ["wrong source variant", (value: any) => { value.exports[0].sourceVariant = "aimh_visual_host"; }],
    ["wrong path", (value: any) => { value.exports[0].exportPath = "exports/tella-b.mp4"; }],
    ["absolute path", (value: any) => { value.exports[0].exportPath = "/tmp/tella-a.mp4"; }],
    ["missing record", (value: any) => { value.exports.pop(); }],
    ["extra record", (value: any) => { value.exports.push({ ...value.exports[1] }); }],
    ["reordered records", (value: any) => { value.exports.reverse(); }],
    ["missing field", (value: any) => { delete value.exports[0].workflowId; }],
    ["extra field", (value: any) => { value.exports[0].downloadUrl = "https://secret"; }],
    ["extra top-level field", (value: any) => { value.signedUrl = "https://secret"; }],
    ["invalid hash", (value: any) => { value.exports[0].sha256 = "bad"; }],
    ["invalid byte size", (value: any) => { value.exports[0].byteSize = 0; }]
  ])("rejects %s", (_name, mutate) => {
    const value: any = receipt();
    mutate(value);
    expect(() => parseTellaExportReceipt(value, state)).toThrow(/Tella export receipt/i);
  });

  it.each([
    ["wrong host", DOWNLOAD_URL_A.replace("prod-compose.tella.tv", "example.com")],
    ["HTTP", DOWNLOAD_URL_A.replace("https:", "http:")],
    ["wrong video", DOWNLOAD_URL_A.replace("/vid_dynamic/", "/vid_host/")],
    ["wrong timestamp", DOWNLOAD_URL_A.replace("17:23:26.147Z", "17:23:27.147Z")],
    ["wrong rendition path", DOWNLOAD_URL_A.replace("/1920x1080/30FPS/", "/1280x720/30FPS/")]
  ])("rejects a %s download URL without exposing it", async (_name, downloadUrl) => {
    const harness = await createSealHarness();
    const fetch = vi.fn(async () => new Response("export-a"));
    try {
      await expect(sealTellaExports({
        episodeDir: harness.episodeDir,
        exports: sealInputs([{ downloadUrl }])
      }, { fetch })).rejects.toSatisfy((error: unknown) => {
        const message = String(error);
        return !message.includes(downloadUrl) && !message.includes("SECRET_A");
      });
      expect(fetch).not.toHaveBeenCalled();
    } finally {
      await harness.cleanup();
    }
  });

  it("rejects off-host redirects before following them and keeps the signed URL secret", async () => {
    const harness = await createSealHarness();
    const fetch = vi.fn(async (
      _input: string | URL | Request,
      _init?: RequestInit
    ) => new Response(null, {
      status: 302,
      headers: { location: "https://evil.example/download.mp4?stolen=SECRET_A" }
    }));
    try {
      await expect(sealTellaExports({
        episodeDir: harness.episodeDir,
        exports: sealInputs()
      }, { fetch })).rejects.toSatisfy((error: unknown) => {
        const message = String(error);
        return !message.includes("evil.example") && !message.includes("SECRET_A");
      });
      expect(fetch).toHaveBeenCalledTimes(2);
      expect(fetch.mock.calls.every(([input]) =>
        new URL(String(input)).hostname === "prod-compose.tella.tv"
      )).toBe(true);
      expect(fetch.mock.calls[0]?.[1]).toEqual(expect.objectContaining({ redirect: "manual" }));
    } finally {
      await harness.cleanup();
    }
  });

  it.each([
    ["non-2xx response", async () => new Response("denied SECRET_A", { status: 403 })],
    ["oversized response", async () => new Response("", {
      headers: { "content-length": String(TELLA_EXPORT_MAX_BYTES + 1) }
    })],
    ["network timeout", async () => {
      throw new Error(`request failed for ${DOWNLOAD_URL_A}`);
    }]
  ])("rejects a %s without exposing URL material or writing", async (_name, fetchResult) => {
    const harness = await createSealHarness();
    const writeJsonAtomic = vi.fn(async () => undefined);
    try {
      await expect(sealTellaExports({
        episodeDir: harness.episodeDir,
        exports: sealInputs()
      }, { fetch: vi.fn(fetchResult), writeJsonAtomic })).rejects.toSatisfy((error: unknown) => {
        const message = String(error);
        return !message.includes(DOWNLOAD_URL_A) && !message.includes("SECRET_A");
      });
      expect(writeJsonAtomic).not.toHaveBeenCalled();
    } finally {
      await harness.cleanup();
    }
  });

  it("cancels a rejected response body before failing the seal", async () => {
    const harness = await createSealHarness();
    const cancel = vi.fn();
    const rejectedBody = new ReadableStream<Uint8Array>({ cancel });
    const fetch = vi.fn(async (input: string | URL | Request) =>
      new URL(String(input)).pathname.includes("vid_dynamic")
        ? new Response(rejectedBody, { status: 403 })
        : new Response("export-b")
    );
    try {
      await expect(sealTellaExports({
        episodeDir: harness.episodeDir,
        exports: sealInputs()
      }, { fetch })).rejects.toThrow(/remote Tella export download failed/i);
      expect(cancel).toHaveBeenCalledOnce();
    } finally {
      await harness.cleanup();
    }
  });

  it("rejects remote bytes that do not match the fixed local export before writing", async () => {
    const harness = await createSealHarness();
    const writeJsonAtomic = vi.fn(async () => undefined);
    try {
      await expect(sealTellaExports({
        episodeDir: harness.episodeDir,
        exports: sealInputs()
      }, {
        fetch: vi.fn(async () => new Response("same-size")),
        writeJsonAtomic
      })).rejects.toThrow(/remote.*version-a.*mismatch/i);
      expect(writeJsonAtomic).not.toHaveBeenCalled();
    } finally {
      await harness.cleanup();
    }
  });

  it("accepts one shared compatibility workflow and URL, fetching it once for both local copies", async () => {
    const harness = await createSealHarness({ exportB: "export-a", sharedState: true });
    const fetch = vi.fn(async () => new Response("export-a"));
    const consoleSpies = (["log", "info", "warn", "error"] as const).map((method) =>
      vi.spyOn(console, method).mockImplementation(() => undefined)
    );
    try {
      const result = await sealTellaExports({
        episodeDir: harness.episodeDir,
        exports: sealInputs([{}, {
          sourceVariant: "dynamic_editorial",
          remoteVideoId: "vid_dynamic",
          workflowId: WORKFLOW_A,
          downloadUrl: DOWNLOAD_URL_A
        }])
      }, { fetch });

      expect(fetch).toHaveBeenCalledOnce();
      expect(JSON.stringify(result)).not.toMatch(/SECRET_A|downloadUrl|prod-compose\.tella\.tv/);
      expect(await readFile(result.receiptPath, "utf8"))
        .not.toMatch(/SECRET_A|downloadUrl|prod-compose\.tella\.tv/);
      expect(JSON.stringify(consoleSpies.flatMap((spy) => spy.mock.calls)))
        .not.toMatch(/SECRET_A|downloadUrl|prod-compose\.tella\.tv/);
    } finally {
      consoleSpies.forEach((spy) => spy.mockRestore());
      await harness.cleanup();
    }
  });

  it("seals both current export byte streams and writes only after both are readable", async () => {
    const root = await mkdtemp(join(tmpdir(), "gpt-live-seal-"));
    const episodeDir = join(root, "episode");
    await mkdir(join(episodeDir, "exports"), { recursive: true });
    await mkdir(join(episodeDir, "tella"), { recursive: true });
    await Promise.all([
      writeFile(join(episodeDir, "exports", "tella-a.mp4"), "export-a"),
      writeFile(join(episodeDir, "exports", "tella-b.mp4"), "export-b"),
      writeFile(join(episodeDir, "tella", "state.json"), JSON.stringify(state))
    ]);

    try {
      const result = await sealTellaExports({
        episodeDir,
        exports: sealInputs()
      }, { fetch: matchingFetch() });

      expect(result.receiptPath).toBe(join(episodeDir, "reports", "tella-export-receipt.json"));
      expect(result.receipt).toEqual(receipt());
      expect(JSON.parse(await readFile(result.receiptPath, "utf8"))).toEqual(receipt());

      const writeJsonAtomic = vi.fn(async () => undefined);
      await rm(join(episodeDir, "exports", "tella-b.mp4"));
      await expect(sealTellaExports({
        episodeDir,
        exports: sealInputs()
      }, { fetch: matchingFetch(), writeJsonAtomic })).rejects.toThrow();
      expect(writeJsonAtomic).not.toHaveBeenCalled();
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  it.each([
    ["Tella directory", async (episodeDir: string, outsideDir: string) => {
      await rm(join(episodeDir, "tella"), { recursive: true });
      await symlink(outsideDir, join(episodeDir, "tella"), "dir");
    }],
    ["Tella state", async (episodeDir: string, outsideDir: string) => {
      await rm(join(episodeDir, "tella", "state.json"));
      await symlink(join(outsideDir, "sentinel"), join(episodeDir, "tella", "state.json"));
    }],
    ["version A export", async (episodeDir: string, outsideDir: string) => {
      await rm(join(episodeDir, "exports", "tella-a.mp4"));
      await symlink(join(outsideDir, "sentinel"), join(episodeDir, "exports", "tella-a.mp4"));
    }],
    ["version B export", async (episodeDir: string, outsideDir: string) => {
      await rm(join(episodeDir, "exports", "tella-b.mp4"));
      await symlink(join(outsideDir, "sentinel"), join(episodeDir, "exports", "tella-b.mp4"));
    }],
    ["reports directory", async (episodeDir: string, outsideDir: string) => {
      await rm(join(episodeDir, "reports"), { recursive: true });
      await symlink(outsideDir, join(episodeDir, "reports"), "dir");
    }],
    ["receipt target", async (episodeDir: string, outsideDir: string) => {
      await symlink(
        join(outsideDir, "sentinel"),
        join(episodeDir, "reports", "tella-export-receipt.json")
      );
    }]
  ])("rejects a symlinked %s before reading or writing", async (_name, attack) => {
    const root = await mkdtemp(join(tmpdir(), "gpt-live-seal-symlink-"));
    const episodeDir = join(root, "episode");
    const outsideDir = join(root, "outside");
    await Promise.all([
      mkdir(join(episodeDir, "tella"), { recursive: true }),
      mkdir(join(episodeDir, "exports"), { recursive: true }),
      mkdir(join(episodeDir, "reports"), { recursive: true }),
      mkdir(outsideDir, { recursive: true })
    ]);
    await Promise.all([
      writeFile(join(episodeDir, "tella", "state.json"), JSON.stringify(state)),
      writeFile(join(episodeDir, "exports", "tella-a.mp4"), "export-a"),
      writeFile(join(episodeDir, "exports", "tella-b.mp4"), "export-b"),
      writeFile(join(outsideDir, "state.json"), JSON.stringify(state)),
      writeFile(join(outsideDir, "sentinel"), "outside-unchanged")
    ]);
    await attack(episodeDir, outsideDir);
    const readFileText = vi.fn(async () => "must-not-read");
    const readFileBytes = vi.fn(async () => new Uint8Array([1]));
    const writeJsonAtomic = vi.fn(async () => undefined);
    const fetch = matchingFetch();

    try {
      await expect(sealTellaExports({
        episodeDir,
        exports: sealInputs()
      }, {
        fetch,
        readFile: readFileText,
        readFileBytes,
        writeJsonAtomic
      })).rejects.toThrow(/symlink|escape/i);
      expect(readFileText).not.toHaveBeenCalled();
      expect(readFileBytes).not.toHaveBeenCalled();
      expect(fetch).not.toHaveBeenCalled();
      expect(writeJsonAtomic).not.toHaveBeenCalled();
      expect(await readFile(join(outsideDir, "sentinel"), "utf8")).toBe("outside-unchanged");
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  it("rejects a same-size export substitution after sealing", async () => {
    const root = await mkdtemp(join(tmpdir(), "gpt-live-seal-mutate-"));
    const episodeDir = join(root, "episode");
    await mkdir(join(episodeDir, "exports"), { recursive: true });
    await Promise.all([
      writeFile(join(episodeDir, "exports", "tella-a.mp4"), "export-a"),
      writeFile(join(episodeDir, "exports", "tella-b.mp4"), "export-b")
    ]);

    try {
      await writeFile(join(episodeDir, "exports", "tella-a.mp4"), "changed!");
      await expect(validateSealedTellaExports({
        episodeDir,
        receipt: receipt(),
        tellaState: state
      })).rejects.toThrow(/version-a.*bytes|version-a.*sha256|version-a.*mismatch/i);
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });
});

const sealInputs = (overrides: readonly Record<string, unknown>[] = []) => ([
  {
    version: "version-a" as const,
    sourceVariant: "dynamic_editorial" as const,
    remoteVideoId: "vid_dynamic",
    workflowId: WORKFLOW_A,
    downloadUrl: DOWNLOAD_URL_A,
    ...overrides[0]
  },
  {
    version: "version-b" as const,
    sourceVariant: "aimh_visual_host" as const,
    remoteVideoId: "vid_host",
    workflowId: WORKFLOW_B,
    downloadUrl: DOWNLOAD_URL_B,
    ...overrides[1]
  }
] as const);

const matchingFetch = () => vi.fn(async (input: string | URL | Request) => {
  const url = new URL(String(input));
  return new Response(url.pathname.includes("vid_dynamic") ? "export-a" : "export-b");
});

const createSealHarness = async (
  options: { exportB?: string; sharedState?: boolean } = {}
) => {
  const root = await mkdtemp(join(tmpdir(), "gpt-live-seal-harness-"));
  const episodeDir = join(root, "episode");
  await mkdir(join(episodeDir, "exports"), { recursive: true });
  await mkdir(join(episodeDir, "tella"), { recursive: true });
  await Promise.all([
    writeFile(join(episodeDir, "exports", "tella-a.mp4"), "export-a"),
    writeFile(join(episodeDir, "exports", "tella-b.mp4"), options.exportB ?? "export-b"),
    writeFile(join(episodeDir, "tella", "state.json"), JSON.stringify(options.sharedState ? {
      variantVideoIds: { dynamic_editorial: "vid_dynamic", aimh_visual_host: "vid_host" }
    } : state))
  ]);
  return {
    episodeDir,
    cleanup: () => rm(root, { recursive: true, force: true })
  };
};
