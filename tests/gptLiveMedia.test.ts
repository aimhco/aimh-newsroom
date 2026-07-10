import { describe, expect, it, vi } from "vitest";
import { buildClipArgs, extractSourceClip } from "../src/production/gptLive/media";
import { resolveVimeoHlsUrl, selectVimeoHlsUrl } from "../src/production/gptLive/vimeo";

const preferredConfig = {
  request: {
    files: {
      hls: {
        cdns: {
          fastly_skyfire: { url: "https://skyfire.example/playlist.m3u8" },
          akfire_interconnect_quic: { url: "https://ak.example/playlist.m3u8" }
        }
      }
    }
  }
};

describe("Vimeo HLS URL resolution", () => {
  it("prefers the Fastly Skyfire playlist", () => {
    expect(selectVimeoHlsUrl(preferredConfig)).toBe("https://skyfire.example/playlist.m3u8");
  });

  it("falls back to Akamai and then the first valid CDN playlist", () => {
    expect(
      selectVimeoHlsUrl({
        request: {
          files: {
            hls: {
              cdns: {
                fastly_skyfire: { url: "http://skyfire.example/playlist.m3u8" },
                akfire_interconnect_quic: { url: "https://ak.example/playlist.m3u8?token=signed" },
                other: { url: "https://other.example/playlist.m3u8" }
              }
            }
          }
        }
      })
    ).toBe("https://ak.example/playlist.m3u8?token=signed");

    expect(
      selectVimeoHlsUrl({
        request: {
          files: {
            hls: {
              cdns: {
                invalid: { url: "https://cdn.example/video.mp4" },
                firstValid: { url: "https://first.example/playlist.m3u8?token=fresh" },
                secondValid: { url: "https://second.example/playlist.m3u8" }
              }
            }
          }
        }
      })
    ).toBe("https://first.example/playlist.m3u8?token=fresh");
  });

  it.each([
    undefined,
    {},
    { request: { files: { hls: { cdns: [] } } } },
    {
      request: {
        files: {
          hls: {
            cdns: {
              insecure: { url: "http://cdn.example/playlist.m3u8?token=do-not-leak" },
              wrongType: { url: "https://cdn.example/video.mp4?token=do-not-leak" },
              malformed: { url: "not a URL containing do-not-leak" }
            }
          }
        }
      }
    }
  ])("rejects malformed configs and invalid playlist URLs without leaking details", (config) => {
    expect(() => selectVimeoHlsUrl(config)).toThrow(
      "Vimeo player config does not contain a valid HLS playlist"
    );

    try {
      selectVimeoHlsUrl(config);
    } catch (error) {
      expect((error as Error).message).not.toContain("do-not-leak");
      expect((error as Error).message).not.toContain("token=");
    }
  });

  it("fetches a fresh config and rejects HTTP or JSON failures with redacted errors", async () => {
    const fetchConfig = vi.fn(async () => ({
      ok: true,
      status: 200,
      json: async () => preferredConfig
    })) as unknown as typeof fetch;

    await expect(
      resolveVimeoHlsUrl("https://player.vimeo.com/video/123/config?h=config-secret", { fetch: fetchConfig })
    ).resolves.toBe("https://skyfire.example/playlist.m3u8");
    expect(fetchConfig).toHaveBeenCalledWith(
      "https://player.vimeo.com/video/123/config?h=config-secret"
    );

    const failedFetch = vi.fn(async () => ({
      ok: false,
      status: 403,
      json: async () => ({ token: "body-secret" })
    })) as unknown as typeof fetch;
    const rejected = resolveVimeoHlsUrl(
      "https://player.vimeo.com/video/123/config?h=config-secret",
      { fetch: failedFetch }
    );
    await expect(rejected).rejects.toThrow("Vimeo player config request failed with status 403");
    await expect(rejected).rejects.not.toThrow(/config-secret|body-secret|token=/);

    const invalidJsonFetch = vi.fn(async () => ({
      ok: true,
      status: 200,
      json: async () => {
        throw new Error("Unexpected token body-secret");
      }
    })) as unknown as typeof fetch;
    const invalidJson = resolveVimeoHlsUrl(
      "https://player.vimeo.com/video/123/config?h=config-secret",
      { fetch: invalidJsonFetch }
    );
    await expect(invalidJson).rejects.toThrow("Vimeo player config response was not valid JSON");
    await expect(invalidJson).rejects.not.toThrow(/config-secret|body-secret|token=/);
  });
});

describe("official source clip extraction", () => {
  const clip = {
    inputUrl: "https://example/playlist.m3u8",
    startSeconds: 50.82,
    endSeconds: 63.17,
    outputPath: "/tmp/clip.mp4"
  };

  it("builds the exact normalized ffmpeg command arguments", () => {
    const args = buildClipArgs(clip);

    expect(args).toContain("12.350");
    expect(args).toEqual([
      "-y",
      "-i",
      clip.inputUrl,
      "-ss",
      "50.820",
      "-t",
      "12.350",
      "-vf",
      "scale=1920:1080:force_original_aspect_ratio=decrease,pad=1920:1080:(ow-iw)/2:(oh-ih)/2,setsar=1",
      "-r",
      "30",
      "-c:v",
      "libx264",
      "-crf",
      "18",
      "-preset",
      "medium",
      "-c:a",
      "aac",
      "-b:a",
      "192k",
      "-ar",
      "48000",
      "-ac",
      "2",
      clip.outputPath
    ]);
  });

  it.each([
    { startSeconds: Number.NaN, endSeconds: 1 },
    { startSeconds: Number.POSITIVE_INFINITY, endSeconds: 2 },
    { startSeconds: -0.001, endSeconds: 1 },
    { startSeconds: 0, endSeconds: Number.NaN },
    { startSeconds: 0, endSeconds: Number.POSITIVE_INFINITY },
    { startSeconds: 1, endSeconds: 1 },
    { startSeconds: 2, endSeconds: 1 }
  ])("rejects invalid clip ranges before command generation: %o", ({ startSeconds, endSeconds }) => {
    expect(() => buildClipArgs({ ...clip, startSeconds, endSeconds })).toThrow("Invalid clip range");
  });

  it("resolves a fresh playlist, runs ffmpeg, and accepts duration at the tolerance boundary", async () => {
    const signedUrl = "https://cdn.example/playlist.m3u8?token=fresh-secret";
    const resolveHlsUrl = vi.fn(async () => signedUrl);
    const run = vi.fn(async () => ({ stdout: "", stderr: "" }));
    const probe = vi.fn(async () => 10.25);

    await extractSourceClip(
      {
        playerConfigUrl: "https://player.vimeo.com/video/123/config?h=config-secret",
        startSeconds: 5,
        endSeconds: 15,
        outputPath: "/tmp/source.mp4",
        ffmpegPath: "/usr/local/bin/ffmpeg",
        ffprobePath: "/usr/local/bin/ffprobe"
      },
      { resolveVimeoHlsUrl: resolveHlsUrl, runCommand: run, ffprobeDurationSeconds: probe }
    );

    expect(resolveHlsUrl).toHaveBeenCalledWith(
      "https://player.vimeo.com/video/123/config?h=config-secret"
    );
    expect(run).toHaveBeenCalledWith(
      "/usr/local/bin/ffmpeg",
      buildClipArgs({
        inputUrl: signedUrl,
        startSeconds: 5,
        endSeconds: 15,
        outputPath: "/tmp/source.mp4"
      })
    );
    expect(probe).toHaveBeenCalledWith("/usr/local/bin/ffprobe", "/tmp/source.mp4");
  });

  it("reports duration mismatches without exposing signed source URLs", async () => {
    const signedUrl = "https://cdn.example/playlist.m3u8?token=fresh-secret";
    const extraction = extractSourceClip(
      {
        playerConfigUrl: "https://player.vimeo.com/video/123/config?h=config-secret",
        startSeconds: 50.82,
        endSeconds: 63.17,
        outputPath: "/tmp/source.mp4",
        ffmpegPath: "ffmpeg",
        ffprobePath: "ffprobe"
      },
      {
        resolveVimeoHlsUrl: async () => signedUrl,
        runCommand: async () => ({ stdout: "", stderr: "" }),
        ffprobeDurationSeconds: async () => 12.7
      }
    );

    await expect(extraction).rejects.toThrow(
      "Source clip duration mismatch: expected 12.350s, received 12.700s (tolerance 0.250s)"
    );
    await expect(extraction).rejects.not.toThrow(/fresh-secret|config-secret|token=|playlist\.m3u8/);
  });
});
