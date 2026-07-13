import { describe, expect, it, vi } from "vitest";
import { buildClipArgs, extractSourceClip } from "../src/production/gptLive/media";
import { resolveVimeoHlsUrl, selectVimeoHlsUrl } from "../src/production/gptLive/vimeo";

const preferredConfig = {
  request: {
    files: {
      hls: {
        cdns: {
          fastly_skyfire: { url: "https://skyfire.vimeocdn.com/playlist.m3u8" },
          akfire_interconnect_quic: {
            url: "https://vod-adaptive-ak.vimeocdn.com/playlist.m3u8"
          }
        }
      }
    }
  }
};

const playerConfigUrl = "https://player.vimeo.com/video/123/config?h=config-secret";

const configWithPlaylist = (url: string) => ({
  request: { files: { hls: { cdns: { candidate: { url } } } } }
});

describe("Vimeo HLS URL resolution", () => {
  it("prefers the Fastly Skyfire playlist", () => {
    expect(selectVimeoHlsUrl(preferredConfig)).toBe(
      "https://skyfire.vimeocdn.com/playlist.m3u8"
    );
  });

  it("falls back to Akamai and then the first valid CDN playlist", () => {
    expect(
      selectVimeoHlsUrl({
        request: {
          files: {
            hls: {
              cdns: {
                fastly_skyfire: { url: "http://skyfire.vimeocdn.com/playlist.m3u8" },
                akfire_interconnect_quic: {
                  url: "https://vod-adaptive-ak.vimeocdn.com/playlist.m3u8?token=signed"
                },
                other: { url: "https://other.vimeocdn.com/playlist.m3u8" }
              }
            }
          }
        }
      })
    ).toBe("https://vod-adaptive-ak.vimeocdn.com/playlist.m3u8?token=signed");

    expect(
      selectVimeoHlsUrl({
        request: {
          files: {
            hls: {
              cdns: {
                invalid: { url: "https://cdn.example/video.mp4" },
                firstValid: { url: "https://first.vimeocdn.com/playlist.m3u8?token=fresh" },
                secondValid: { url: "https://second.vimeocdn.com/playlist.m3u8" }
              }
            }
          }
        }
      })
    ).toBe("https://first.vimeocdn.com/playlist.m3u8?token=fresh");
  });

  it.each([
    "https://vimeocdn.com/playlist.m3u8",
    "https://skyfire.vimeocdn.com/playlist.m3u8",
    "https://vod-adaptive-ak.vimeocdn.com/playlist.m3u8"
  ])("accepts approved Vimeo CDN host %s", (url) => {
    expect(selectVimeoHlsUrl(configWithPlaylist(url))).toBe(url);
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

  it.each([
    "https://localhost/playlist.m3u8",
    "https://localhost./playlist.m3u8",
    "https://127.0.0.1/playlist.m3u8",
    "https://169.254.10.20/playlist.m3u8",
    "https://10.0.0.1/playlist.m3u8",
    "https://192.168.1.1/playlist.m3u8",
    "https://172.16.0.1/playlist.m3u8",
    "https://172.31.255.255/playlist.m3u8",
    "https://[::1]/playlist.m3u8",
    "https://[::]/playlist.m3u8",
    "https://[fc00::1]/playlist.m3u8",
    "https://[fe80::1]/playlist.m3u8",
    "https://user:password@cdn.example/playlist.m3u8",
    "https://cdn.example:8443/playlist.m3u8",
    "https://cdn.example/playlist.m3u8",
    "https://127.0.0.1.nip.io/playlist.m3u8",
    "https://vimeocdn.com.evil.example/playlist.m3u8",
    "https://evilvimeocdn.com/playlist.m3u8",
    "https://skyfire.vimeocdn.com.nip.io/playlist.m3u8"
  ])("rejects non-public playlist destination %s", (url) => {
    expect(() => selectVimeoHlsUrl(configWithPlaylist(url))).toThrow(
      "Vimeo player config does not contain a valid HLS playlist"
    );
  });

  it.each([
    "http://player.vimeo.com/video/123/config?h=hash",
    "https://player.vimeo.com.evil.example/video/123/config?h=hash",
    "https://player.vimeo.com./video/123/config?h=hash",
    "https://127.0.0.1/video/123/config?h=hash",
    "https://169.254.1.1/video/123/config?h=hash",
    "https://user:password@player.vimeo.com/video/123/config?h=hash",
    "https://player.vimeo.com:8443/video/123/config?h=hash",
    "https://player.vimeo.com/video/not-numeric/config?h=hash",
    "https://player.vimeo.com/video/123/config/extra?h=hash",
    "https://player.vimeo.com/video/123/config?redirect=https://10.0.0.1",
    "https://player.vimeo.com/video/123/config?h=hash&extra=value",
    "https://player.vimeo.com/video/123/config?h=hash#fragment"
  ])("rejects unsafe Vimeo config URL %s before fetch", async (url) => {
    const fetchConfig = vi.fn();
    const resolution = resolveVimeoHlsUrl(url, {
      fetch: fetchConfig as unknown as typeof fetch,
      createTimeoutSignal: () => new AbortController().signal
    });

    await expect(resolution).rejects.toThrow("Invalid Vimeo player config URL");
    await expect(resolution).rejects.not.toThrow(/hash|password|redirect=|10\.0\.0\.1/);
    expect(fetchConfig).not.toHaveBeenCalled();
  });

  it("fetches a fresh config and rejects HTTP or JSON failures with redacted errors", async () => {
    const signal = new AbortController().signal;
    const createTimeoutSignal = vi.fn(() => signal);
    const fetchConfig = vi.fn(async () => ({
      ok: true,
      status: 200,
      url: playerConfigUrl,
      json: async () => preferredConfig
    })) as unknown as typeof fetch;

    await expect(
      resolveVimeoHlsUrl(playerConfigUrl, { fetch: fetchConfig, createTimeoutSignal })
    ).resolves.toBe("https://skyfire.vimeocdn.com/playlist.m3u8");
    expect(createTimeoutSignal).toHaveBeenCalledWith(15_000);
    expect(fetchConfig).toHaveBeenCalledWith(playerConfigUrl, { redirect: "error", signal });

    const failedFetch = vi.fn(async () => ({
      ok: false,
      status: 403,
      url: playerConfigUrl,
      json: async () => ({ token: "body-secret" })
    })) as unknown as typeof fetch;
    const rejected = resolveVimeoHlsUrl(playerConfigUrl, {
      fetch: failedFetch,
      createTimeoutSignal
    });
    await expect(rejected).rejects.toThrow("Vimeo player config request failed with status 403");
    await expect(rejected).rejects.not.toThrow(/config-secret|body-secret|token=/);

    const invalidJsonFetch = vi.fn(async () => ({
      ok: true,
      status: 200,
      url: playerConfigUrl,
      json: async () => {
        throw new Error("Unexpected token body-secret");
      }
    })) as unknown as typeof fetch;
    const invalidJson = resolveVimeoHlsUrl(playerConfigUrl, {
      fetch: invalidJsonFetch,
      createTimeoutSignal
    });
    await expect(invalidJson).rejects.toThrow("Vimeo player config response was not valid JSON");
    await expect(invalidJson).rejects.not.toThrow(/config-secret|body-secret|token=/);
  });

  it("rejects an unsafe response URL even when an injected fetch ignores redirect policy", async () => {
    const fetchConfig = vi.fn(async () => ({
      ok: true,
      status: 200,
      url: "https://player.vimeo.com.evil.example/video/123/config?h=response-secret",
      json: async () => preferredConfig
    })) as unknown as typeof fetch;

    const resolution = resolveVimeoHlsUrl(playerConfigUrl, {
      fetch: fetchConfig,
      createTimeoutSignal: () => new AbortController().signal
    });

    await expect(resolution).rejects.toThrow("Vimeo player config response URL was invalid");
    await expect(resolution).rejects.not.toThrow(/evil\.example|response-secret|config-secret/);
  });

  it("uses an injectable timeout and preserves only a safe timeout category", async () => {
    const fetchConfig = vi.fn(async () => {
      const error = new Error(`Timed out fetching ${playerConfigUrl}`);
      error.name = "TimeoutError";
      throw error;
    }) as unknown as typeof fetch;

    const createTimeoutSignal = vi.fn(() => new AbortController().signal);
    const resolution = resolveVimeoHlsUrl(playerConfigUrl, {
      fetch: fetchConfig,
      timeoutMs: 2_500,
      createTimeoutSignal
    });

    await expect(resolution).rejects.toThrow("Vimeo player config request timed out after 2500ms");
    await expect(resolution).rejects.not.toThrow(/config-secret|player\.vimeo\.com|token=/);
    expect(createTimeoutSignal).toHaveBeenCalledWith(2_500);
  });

  it("preserves a safe network error code without retaining request URLs", async () => {
    const fetchConfig = vi.fn(async () => {
      throw Object.assign(new Error(`connect failed for ${playerConfigUrl}`), { code: "ETIMEDOUT" });
    }) as unknown as typeof fetch;

    const resolution = resolveVimeoHlsUrl(playerConfigUrl, {
      fetch: fetchConfig,
      createTimeoutSignal: () => new AbortController().signal
    });

    await expect(resolution).rejects.toThrow("Vimeo player config request failed (code ETIMEDOUT)");
    await expect(resolution).rejects.not.toThrow(/config-secret|player\.vimeo\.com|token=/);
  });

  it("sanitizes timeout signal setup failures before fetch", async () => {
    const fetchConfig = vi.fn();
    const resolution = resolveVimeoHlsUrl(playerConfigUrl, {
      fetch: fetchConfig as unknown as typeof fetch,
      createTimeoutSignal: () => {
        throw Object.assign(new Error(`signal setup failed for ${playerConfigUrl}`), {
          code: "ERR_INVALID_ARG_VALUE"
        });
      }
    });

    await expect(resolution).rejects.toThrow(
      "Vimeo player config timeout setup failed (code ERR_INVALID_ARG_VALUE)"
    );
    await expect(resolution).rejects.not.toThrow(/config-secret|player\.vimeo\.com|token=/);
    expect(fetchConfig).not.toHaveBeenCalled();
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
    const mkdir = vi.fn(async () => undefined);
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
      { resolveVimeoHlsUrl: resolveHlsUrl, mkdir, runCommand: run, ffprobeDurationSeconds: probe }
    );

    expect(resolveHlsUrl).toHaveBeenCalledWith(
      "https://player.vimeo.com/video/123/config?h=config-secret"
    );
    expect(mkdir).toHaveBeenCalledWith("/tmp", { recursive: true });
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
    expect(mkdir.mock.invocationCallOrder[0]).toBeLessThan(run.mock.invocationCallOrder[0]!);
  });

  it("sanitizes resolver failures that contain a signed playlist URL", async () => {
    const signedUrl = "https://cdn.example/playlist.m3u8?token=resolver-secret&expires=123";
    const extraction = extractSourceClip(
      {
        playerConfigUrl: "https://player.vimeo.com/video/123/config?h=config-secret",
        startSeconds: 5,
        endSeconds: 15,
        outputPath: "/tmp/source.mp4",
        ffmpegPath: "ffmpeg",
        ffprobePath: "ffprobe"
      },
      {
        resolveVimeoHlsUrl: async () => {
          throw new Error(`Vimeo resolver failed for ${signedUrl}`);
        }
      }
    );

    await expect(extraction).rejects.toThrow("Source clip playlist resolution failed");
    await expect(extraction).rejects.not.toThrow(
      /cdn\.example|playlist\.m3u8|resolver-secret|token=|expires=/
    );
  });

  it("preserves a safe HTTP status from playlist resolution without URLs", async () => {
    const signedUrl = "https://cdn.example/playlist.m3u8?token=resolver-secret";
    const extraction = extractSourceClip(
      {
        playerConfigUrl,
        startSeconds: 5,
        endSeconds: 15,
        outputPath: "/tmp/source.mp4",
        ffmpegPath: "ffmpeg",
        ffprobePath: "ffprobe"
      },
      {
        resolveVimeoHlsUrl: async () => {
          throw new Error(`Vimeo player config request failed with status 403 at ${signedUrl}`);
        }
      }
    );

    await expect(extraction).rejects.toThrow(
      "Source clip playlist resolution failed: Vimeo player config request failed with status 403"
    );
    await expect(extraction).rejects.not.toThrow(/cdn\.example|resolver-secret|token=|playlist\.m3u8/);
  });

  it("sanitizes command failures that contain a signed playlist URL", async () => {
    const signedUrl = "https://cdn.example/playlist.m3u8?token=command-secret&expires=123";
    const extraction = extractSourceClip(
      {
        playerConfigUrl: "https://player.vimeo.com/video/123/config?h=config-secret",
        startSeconds: 5,
        endSeconds: 15,
        outputPath: "/tmp/source.mp4",
        ffmpegPath: "ffmpeg",
        ffprobePath: "ffprobe"
      },
      {
        resolveVimeoHlsUrl: async () => signedUrl,
        mkdir: async () => undefined,
        runCommand: async () => {
          throw new Error(`ffmpeg exited 7 while reading ${signedUrl}`);
        }
      }
    );

    await expect(extraction).rejects.toThrow("Source clip extraction command failed (exit 7)");
    await expect(extraction).rejects.not.toThrow(
      /cdn\.example|playlist\.m3u8|command-secret|token=|expires=/
    );
  });

  it("preserves a safe command OS code without executable paths or URLs", async () => {
    const signedUrl = "https://cdn.example/playlist.m3u8?token=os-secret";
    const extraction = extractSourceClip(
      {
        playerConfigUrl,
        startSeconds: 5,
        endSeconds: 15,
        outputPath: "/tmp/source.mp4",
        ffmpegPath: "/secret/bin/ffmpeg",
        ffprobePath: "ffprobe"
      },
      {
        resolveVimeoHlsUrl: async () => signedUrl,
        mkdir: async () => undefined,
        runCommand: async () => {
          throw Object.assign(new Error(`spawn /secret/bin/ffmpeg for ${signedUrl}`), {
            code: "ENOENT"
          });
        }
      }
    );

    await expect(extraction).rejects.toThrow("Source clip extraction command failed (code ENOENT)");
    await expect(extraction).rejects.not.toThrow(/secret\/bin|cdn\.example|os-secret|token=/);
  });

  it("reports output directory creation failures with only a safe OS code", async () => {
    const run = vi.fn();
    const extraction = extractSourceClip(
      {
        playerConfigUrl,
        startSeconds: 5,
        endSeconds: 15,
        outputPath: "/private/output/source.mp4",
        ffmpegPath: "ffmpeg",
        ffprobePath: "ffprobe"
      },
      {
        resolveVimeoHlsUrl: async () => "https://cdn.example/playlist.m3u8?token=dir-secret",
        mkdir: async () => {
          throw Object.assign(new Error("mkdir /private/output token=dir-secret"), { code: "EACCES" });
        },
        runCommand: run as never
      }
    );

    await expect(extraction).rejects.toThrow(
      "Source clip output directory creation failed (code EACCES)"
    );
    await expect(extraction).rejects.not.toThrow(/private\/output|dir-secret|token=/);
    expect(run).not.toHaveBeenCalled();
  });

  it.each([9.75, 10.25])("accepts exact duration tolerance boundary %s", async (actualDuration) => {
    await expect(
      extractSourceClip(
        {
          playerConfigUrl,
          startSeconds: 5,
          endSeconds: 15,
          outputPath: "/tmp/source.mp4",
          ffmpegPath: "ffmpeg",
          ffprobePath: "ffprobe"
        },
        {
          resolveVimeoHlsUrl: async () => "https://cdn.example/playlist.m3u8",
          mkdir: async () => undefined,
          runCommand: async () => ({ stdout: "", stderr: "" }),
          ffprobeDurationSeconds: async () => actualDuration
        }
      )
    ).resolves.toBeUndefined();
  });

  it.each([12.1, 12.6])(
    "accepts exact 0.25 boundary around requested duration 12.350: %s",
    async (actualDuration) => {
      await expect(
        extractSourceClip(
          {
            playerConfigUrl,
            startSeconds: 50.82,
            endSeconds: 63.17,
            outputPath: "/tmp/source.mp4",
            ffmpegPath: "ffmpeg",
            ffprobePath: "ffprobe"
          },
          {
            resolveVimeoHlsUrl: async () => "https://cdn.example/playlist.m3u8",
            mkdir: async () => undefined,
            runCommand: async () => ({ stdout: "", stderr: "" }),
            ffprobeDurationSeconds: async () => actualDuration
          }
        )
      ).resolves.toBeUndefined();
    }
  );

  it.each([9.9, 10.1])("accepts ordinary duration within tolerance %s", async (actualDuration) => {
    await expect(
      extractSourceClip(
        {
          playerConfigUrl,
          startSeconds: 5,
          endSeconds: 15,
          outputPath: "/tmp/source.mp4",
          ffmpegPath: "ffmpeg",
          ffprobePath: "ffprobe"
        },
        {
          resolveVimeoHlsUrl: async () => "https://cdn.example/playlist.m3u8",
          mkdir: async () => undefined,
          runCommand: async () => ({ stdout: "", stderr: "" }),
          ffprobeDurationSeconds: async () => actualDuration
        }
      )
    ).resolves.toBeUndefined();
  });

  it.each([9.7499999995, 10.2500000005])(
    "rejects every representable decimal beyond the exact tolerance %s",
    async (actualDuration) => {
      await expect(
        extractSourceClip(
          {
            playerConfigUrl,
            startSeconds: 5,
            endSeconds: 15,
            outputPath: "/tmp/source.mp4",
            ffmpegPath: "ffmpeg",
            ffprobePath: "ffprobe"
          },
          {
            resolveVimeoHlsUrl: async () => "https://cdn.example/playlist.m3u8",
            mkdir: async () => undefined,
            runCommand: async () => ({ stdout: "", stderr: "" }),
            ffprobeDurationSeconds: async () => actualDuration
          }
        )
      ).rejects.toThrow("Source clip duration mismatch");
    }
  );

  it.each([9.7496, 10.2504])(
    "rejects duration beyond tolerance boundary %s",
    async (actualDuration) => {
      await expect(
        extractSourceClip(
          {
            playerConfigUrl,
            startSeconds: 5,
            endSeconds: 15,
            outputPath: "/tmp/source.mp4",
            ffmpegPath: "ffmpeg",
            ffprobePath: "ffprobe"
          },
          {
            resolveVimeoHlsUrl: async () => "https://cdn.example/playlist.m3u8",
            mkdir: async () => undefined,
            runCommand: async () => ({ stdout: "", stderr: "" }),
            ffprobeDurationSeconds: async () => actualDuration
          }
        )
      ).rejects.toThrow("Source clip duration mismatch");
    }
  );

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
        mkdir: async () => undefined,
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
