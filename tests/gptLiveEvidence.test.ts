import { createHash } from "node:crypto";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Resvg } from "@resvg/resvg-js";
import { describe, expect, it } from "vitest";
import { GPT_LIVE_CONTENT } from "../src/production/gptLive/content";
import {
  inspectEvidenceAssets,
  resolveEvidenceAssetPath
} from "../src/production/gptLive/evidence";

const evidence = GPT_LIVE_CONTENT.evidence.find(
  (item) => item.playbackDecision === "captured_source"
)!;

const renderPng = (width: number, height: number, body: string): Buffer =>
  Buffer.from(new Resvg(
    `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" viewBox="0 0 ${width} ${height}">${body}</svg>`
  ).render().asPng());

const contentPng = renderPng(1280, 720, `
  <defs>
    <linearGradient id="background" x1="0" y1="0" x2="1" y2="1">
      <stop offset="0" stop-color="#ffffff"/>
      <stop offset="0.5" stop-color="#3b82f6"/>
      <stop offset="1" stop-color="#111827"/>
    </linearGradient>
  </defs>
  <rect width="1280" height="720" fill="url(#background)"/>
  <rect x="80" y="80" width="520" height="120" fill="#ffffff"/>
  <rect x="80" y="250" width="1120" height="48" fill="#111827"/>
  <rect x="80" y="340" width="880" height="32" fill="#facc15"/>
  <circle cx="1080" cy="520" r="110" fill="#ef4444"/>
`);

const crc32 = (bytes: Uint8Array): number => {
  let crc = 0xffffffff;
  for (const byte of bytes) {
    crc ^= byte;
    for (let bit = 0; bit < 8; bit += 1) {
      crc = (crc >>> 1) ^ (0xedb88320 & -(crc & 1));
    }
  }
  return (crc ^ 0xffffffff) >>> 0;
};

const addPngTextChunk = (png: Buffer, keyword: string, text: string): Buffer => {
  const type = Buffer.from("tEXt", "ascii");
  const data = Buffer.concat([
    Buffer.from(keyword, "latin1"),
    Buffer.from([0]),
    Buffer.from(text, "latin1")
  ]);
  const chunk = Buffer.alloc(12 + data.length);
  chunk.writeUInt32BE(data.length, 0);
  type.copy(chunk, 4);
  data.copy(chunk, 8);
  chunk.writeUInt32BE(crc32(Buffer.concat([type, data])), 8 + data.length);
  const ihdrEnd = 8 + 4 + 4 + 13 + 4;
  return Buffer.concat([png.subarray(0, ihdrEnd), chunk, png.subarray(ihdrEnd)]);
};

const withEvidenceFile = async (
  bytes: Uint8Array,
  action: (episodeDir: string) => Promise<void>
): Promise<void> => {
  const episodeDir = await mkdtemp(join(tmpdir(), "gpt-live-evidence-inspection-"));
  try {
    await mkdir(join(episodeDir, "evidence"));
    await writeFile(resolveEvidenceAssetPath(episodeDir, evidence), bytes);
    await action(episodeDir);
  } finally {
    await rm(episodeDir, { recursive: true, force: true });
  }
};

describe("GPT-Live evidence raster inspection", () => {
  it("decodes a content-bearing 1280x720 PNG and binds canonical source metadata to its hash", async () => {
    await withEvidenceFile(contentPng, async (episodeDir) => {
      const [inspection] = await inspectEvidenceAssets(
        episodeDir,
        [evidence],
        { ffmpegPath: process.env.FFMPEG_PATH ?? "ffmpeg" }
      );
      const source = GPT_LIVE_CONTENT.sources.find((item) => item.id === evidence.sourceId)!;

      expect(inspection).toMatchObject({
        evidenceId: evidence.id,
        sourceId: evidence.sourceId,
        canonicalUrl: source.url,
        assetPath: evidence.assetPath,
        sha256: createHash("sha256").update(contentPng).digest("hex"),
        byteSize: contentPng.byteLength,
        width: 1280,
        height: 720
      });
      expect(inspection!.lumaRange).toBeGreaterThanOrEqual(16);
      expect(inspection!.lumaVariance).toBeGreaterThanOrEqual(25);
      expect(inspection!.normalizedEntropy).toBeGreaterThanOrEqual(0.02);
    });
  });

  it("rejects a genuinely decodable 1x1 PNG", async () => {
    const onePixel = renderPng(1, 1, '<rect width="1" height="1" fill="#ffffff"/>');
    await withEvidenceFile(onePixel, async (episodeDir) => {
      await expect(inspectEvidenceAssets(
        episodeDir,
        [evidence],
        { ffmpegPath: process.env.FFMPEG_PATH ?? "ffmpeg" }
      )).rejects.toThrow(/1280x720|dimensions/i);
    });
  });

  it("rejects a forged PNG header with trailing bytes", async () => {
    const forged = Buffer.alloc(256, 0x41);
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]).copy(forged, 0);
    forged.writeUInt32BE(13, 8);
    forged.write("IHDR", 12, "ascii");
    forged.writeUInt32BE(1280, 16);
    forged.writeUInt32BE(720, 20);

    await withEvidenceFile(forged, async (episodeDir) => {
      await expect(inspectEvidenceAssets(
        episodeDir,
        [evidence],
        { ffmpegPath: process.env.FFMPEG_PATH ?? "ffmpeg" }
      )).rejects.toThrow(/decode|PNG|raster/i);
    });
  });

  it("rejects a uniform high-resolution PNG", async () => {
    const uniform = renderPng(
      1280,
      720,
      '<rect width="1280" height="720" fill="#f8fafc"/>'
    );
    await withEvidenceFile(uniform, async (episodeDir) => {
      await expect(inspectEvidenceAssets(
        episodeDir,
        [evidence],
        { ffmpegPath: process.env.FFMPEG_PATH ?? "ffmpeg" }
      )).rejects.toThrow(/uniform|blank|content/i);
    });
  });

  it("rejects near-uniform PNG pixels despite spoofed lavfi metrics in tEXt metadata", async () => {
    const nearUniform = renderPng(
      1280,
      720,
      '<rect width="1280" height="720" fill="#f8fafc"/><rect width="20" height="20" fill="#000000"/>'
    );
    const spoofed = addPngTextChunk(nearUniform, "Comment", [
      "lavfi.signalstats.YMIN=0",
      "lavfi.signalstats.YMAX=255",
      "lavfi.entropy.normalized_entropy.normal.Y=0.99"
    ].join("\n"));

    await withEvidenceFile(spoofed, async (episodeDir) => {
      await expect(inspectEvidenceAssets(
        episodeDir,
        [evidence],
        { ffmpegPath: process.env.FFMPEG_PATH ?? "ffmpeg" }
      )).rejects.toThrow(/uniform|blank|content/i);
    });
  });
});
