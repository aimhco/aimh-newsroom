import { createHash } from "node:crypto";
import { mkdtemp, mkdir, readFile, rm, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it, vi } from "vitest";
import {
  parseTellaExportReceipt,
  sealTellaExports,
  validateSealedTellaExports,
  type TellaExportReceipt
} from "../src/production/gptLive/tellaExportReceipt";

const sha256 = (value: string): string => createHash("sha256").update(value).digest("hex");
const REAL_TELLA_WORKFLOW_ID =
  "Export-Story-vid_cmrfrx6lc006c04l4fjh0alem/2026-07-12T17:23:26.147Z/Story/1920x1080/30FPS";

const state = {
  variantVideoIds: {
    dynamic_editorial: "vid_dynamic",
    aimh_visual_host: "vid_host"
  }
};

const receipt = (): TellaExportReceipt => ({
  schemaVersion: "0.1.0",
  productionId: "2026-07-10-gpt-live-tella-ab",
  exports: [
    {
      version: "version-a",
      sourceVariant: "dynamic_editorial",
      remoteVideoId: "vid_dynamic",
      workflowId: "Export-Story-vid_dynamic/Story",
      exportPath: "exports/tella-a.mp4",
      sha256: sha256("export-a"),
      byteSize: 8
    },
    {
      version: "version-b",
      sourceVariant: "aimh_visual_host",
      remoteVideoId: "vid_host",
      workflowId: "Export-Story-vid_host/Story",
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
      workflowId: "Export-Story-vid_dynamic/Story",
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
        exports: [
          {
            version: "version-a",
            sourceVariant: "dynamic_editorial",
            remoteVideoId: "vid_dynamic",
            workflowId: "Export-Story-vid_dynamic/Story"
          },
          {
            version: "version-b",
            sourceVariant: "aimh_visual_host",
            remoteVideoId: "vid_host",
            workflowId: "Export-Story-vid_host/Story"
          }
        ]
      });

      expect(result.receiptPath).toBe(join(episodeDir, "reports", "tella-export-receipt.json"));
      expect(result.receipt).toEqual(receipt());
      expect(JSON.parse(await readFile(result.receiptPath, "utf8"))).toEqual(receipt());

      const writeJsonAtomic = vi.fn(async () => undefined);
      await rm(join(episodeDir, "exports", "tella-b.mp4"));
      await expect(sealTellaExports({
        episodeDir,
        exports: receipt().exports.map(({ version, sourceVariant, remoteVideoId, workflowId }) => ({
          version,
          sourceVariant,
          remoteVideoId,
          workflowId
        }))
      }, { writeJsonAtomic })).rejects.toThrow();
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

    try {
      await expect(sealTellaExports({
        episodeDir,
        exports: receipt().exports.map(({ version, sourceVariant, remoteVideoId, workflowId }) => ({
          version,
          sourceVariant,
          remoteVideoId,
          workflowId
        }))
      }, {
        readFile: readFileText,
        readFileBytes,
        writeJsonAtomic
      })).rejects.toThrow(/symlink|escape/i);
      expect(readFileText).not.toHaveBeenCalled();
      expect(readFileBytes).not.toHaveBeenCalled();
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
