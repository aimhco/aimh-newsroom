import { mkdtemp, readFile, readdir, rm, unlink } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it, vi } from "vitest";
import type { ScriptFile } from "../src/types";
import {
  buildSpeechRequestBody,
  buildSpeechRequestBodyForParagraph,
  buildVoiceCacheKey,
  buildVoiceCacheKeyForParagraph,
  synthesizeNarration,
  voiceCacheMetadataPath,
  type SynthesizeNarrationDependencies
} from "../src/voice/elevenLabsAdapter";

const scriptWithText = (text: string): ScriptFile => ({
  schema_version: "0.1.0",
  voice: {
    provider: "elevenlabs",
    voice_id_env: "ELEVENLABS_VOICE_ID",
    style: "test"
  },
  narration: [
    {
      id: "narration_test",
      segment_id: "test",
      text,
      estimated_seconds: 1,
      claim_ids: ["claim_test"],
      shot_ids: []
    }
  ]
});

const env = (overrides: Record<string, string> = {}) => ({
  ELEVENLABS_API_KEY: "api-secret-never-persist",
  ELEVENLABS_VOICE_ID: "voice-a",
  ELEVENLABS_MODEL_ID: "model-a",
  ...overrides
});

const successfulFetch = () =>
  vi.fn(async () => ({
    ok: true,
    status: 200,
    headers: new Headers(),
    text: async () => "",
    arrayBuffer: async () => Uint8Array.from([0x49, 0x44, 0x33, 1, 2, 3]).buffer
  })) as unknown as typeof fetch;

const dependencies = (fetchMock: typeof fetch): SynthesizeNarrationDependencies => ({
  fetch: fetchMock,
  ffprobeDurationSeconds: vi.fn(async () => 1.25),
  randomUUID: () => "stable-temp-id"
});

const render = (
  outDir: string,
  script: ScriptFile,
  renderEnv: Record<string, string>,
  injected: SynthesizeNarrationDependencies
) =>
  synthesizeNarration(
    {
      script,
      outDir,
      env: renderEnv,
      ffprobePath: "ffprobe",
      allowElevenLabs: true
    },
    injected
  );

describe("ElevenLabs pronunciation dictionaries", () => {
  it("uses speech_text for synthesis and cache identity while preserving display text", () => {
    const paragraph = {
      ...scriptWithText("Programmatic Tool Calling").narration[0]!,
      speech_text: "Programmatic tool-calling",
      critical_phrases: ["Programmatic Tool Calling"]
    };
    const request = buildSpeechRequestBodyForParagraph(paragraph, env());

    expect(request.text).toBe("Programmatic tool-calling");
    expect(buildVoiceCacheKeyForParagraph({ paragraph, env: env() })).not.toBe(
      buildVoiceCacheKey({ text: paragraph.text, env: env() })
    );
    expect(paragraph.text).toBe("Programmatic Tool Calling");
  });

  it("includes a pronunciation dictionary locator only when both values are configured", () => {
    const configured = buildSpeechRequestBody(
      "Mobile",
      env({
        ELEVENLABS_PRONUNCIATION_DICTIONARY_ID: "dictionary-a",
        ELEVENLABS_PRONUNCIATION_DICTIONARY_VERSION_ID: "version-a"
      })
    );
    const missingVersion = buildSpeechRequestBody(
      "Mobile",
      env({ ELEVENLABS_PRONUNCIATION_DICTIONARY_ID: "dictionary-a" })
    );
    const missingDictionary = buildSpeechRequestBody(
      "Mobile",
      env({ ELEVENLABS_PRONUNCIATION_DICTIONARY_VERSION_ID: "version-a" })
    );

    expect(configured.pronunciation_dictionary_locators).toEqual([
      {
        pronunciation_dictionary_id: "dictionary-a",
        version_id: "version-a"
      }
    ]);
    expect(missingVersion).not.toHaveProperty("pronunciation_dictionary_locators");
    expect(missingDictionary).not.toHaveProperty("pronunciation_dictionary_locators");
  });

  it("changes the voice cache key when a configured locator changes", () => {
    const base = {
      ELEVENLABS_PRONUNCIATION_DICTIONARY_ID: "dictionary-a",
      ELEVENLABS_PRONUNCIATION_DICTIONARY_VERSION_ID: "version-a"
    };
    const original = buildVoiceCacheKey({ text: "Mobile", env: env(base) });
    const changedDictionary = buildVoiceCacheKey({
      text: "Mobile",
      env: env({ ...base, ELEVENLABS_PRONUNCIATION_DICTIONARY_ID: "dictionary-b" })
    });
    const changedVersion = buildVoiceCacheKey({
      text: "Mobile",
      env: env({ ...base, ELEVENLABS_PRONUNCIATION_DICTIONARY_VERSION_ID: "version-b" })
    });

    expect(changedDictionary).not.toBe(original);
    expect(changedVersion).not.toBe(original);
  });
});

describe("ElevenLabs narration cache provenance", () => {
  it("uses a stable SHA-256 key and caches only with matching metadata and valid audio", async () => {
    const outDir = await mkdtemp(join(tmpdir(), "voice-cache-"));
    const fetchMock = successfulFetch();
    const injected = dependencies(fetchMock);

    try {
      const first = await render(outDir, scriptWithText("Hello AIMH.co"), env(), injected);
      const second = await render(outDir, scriptWithText("Hello AIMH.co"), env(), injected);
      const audioPath = join(outDir, "narration_test.mp3");
      const metadataText = await readFile(voiceCacheMetadataPath(audioPath), "utf8");
      const metadata = JSON.parse(metadataText) as Record<string, unknown>;

      expect(fetchMock).toHaveBeenCalledTimes(1);
      expect(first.chunks[0]?.cached).toBe(false);
      expect(second.chunks[0]?.cached).toBe(true);
      expect(metadata.cacheKey).toMatch(/^[a-f0-9]{64}$/);
      expect(metadata.cacheKey).toBe(
        buildVoiceCacheKey({ text: "Hello AIMH.co", env: env() })
      );
      expect(metadataText).not.toContain("api-secret-never-persist");
      expect(metadataText).not.toContain("ELEVENLABS_API_KEY");
    } finally {
      await rm(outDir, { recursive: true, force: true });
    }
  });

  it.each([
    {
      name: "prepared text",
      firstText: "First text",
      secondText: "Changed text",
      firstEnv: env(),
      secondEnv: env()
    },
    {
      name: "voice",
      firstText: "Same text",
      secondText: "Same text",
      firstEnv: env(),
      secondEnv: env({ ELEVENLABS_VOICE_ID: "voice-b" })
    },
    {
      name: "model",
      firstText: "Same text",
      secondText: "Same text",
      firstEnv: env(),
      secondEnv: env({ ELEVENLABS_MODEL_ID: "model-b" })
    },
    {
      name: "pronunciation dictionary locator",
      firstText: "Same text",
      secondText: "Same text",
      firstEnv: env({
        ELEVENLABS_PRONUNCIATION_DICTIONARY_ID: "dictionary-a",
        ELEVENLABS_PRONUNCIATION_DICTIONARY_VERSION_ID: "version-a"
      }),
      secondEnv: env({
        ELEVENLABS_PRONUNCIATION_DICTIONARY_ID: "dictionary-a",
        ELEVENLABS_PRONUNCIATION_DICTIONARY_VERSION_ID: "version-b"
      })
    }
  ])("re-synthesizes when $name changes", async ({ firstText, secondText, firstEnv, secondEnv }) => {
    const outDir = await mkdtemp(join(tmpdir(), "voice-provenance-"));
    const fetchMock = successfulFetch();
    const injected = dependencies(fetchMock);

    try {
      await render(outDir, scriptWithText(firstText), firstEnv, injected);
      const second = await render(outDir, scriptWithText(secondText), secondEnv, injected);

      expect(fetchMock).toHaveBeenCalledTimes(2);
      expect(second.chunks[0]?.cached).toBe(false);
    } finally {
      await rm(outDir, { recursive: true, force: true });
    }
  });

  it.each([
    { name: "missing", metadata: undefined },
    { name: "corrupt", metadata: "{" },
    { name: "partial", metadata: JSON.stringify({ schemaVersion: "0.1.0" }) }
  ])("does not cache with $name metadata", async ({ metadata }) => {
    const outDir = await mkdtemp(join(tmpdir(), "voice-metadata-"));
    const fetchMock = successfulFetch();
    const injected = dependencies(fetchMock);

    try {
      await render(outDir, scriptWithText("Same text"), env(), injected);
      const metadataPath = voiceCacheMetadataPath(join(outDir, "narration_test.mp3"));
      if (metadata === undefined) {
        await unlink(metadataPath);
      } else {
        await import("node:fs/promises").then(({ writeFile }) => writeFile(metadataPath, metadata));
      }

      const second = await render(outDir, scriptWithText("Same text"), env(), injected);

      expect(fetchMock).toHaveBeenCalledTimes(2);
      expect(second.chunks[0]?.cached).toBe(false);
    } finally {
      await rm(outDir, { recursive: true, force: true });
    }
  });

  it("cleans same-directory temp files and leaves no cache metadata when publication fails", async () => {
    const outDir = await mkdtemp(join(tmpdir(), "voice-atomic-"));
    const fetchMock = successfulFetch();
    const realFs = await import("node:fs/promises");
    const rename = vi.fn(async (from: string, to: string) => {
      if (to.endsWith(".json")) throw new Error("injected metadata rename failure");
      await realFs.rename(from, to);
    });

    try {
      const result = await render(outDir, scriptWithText("Atomic text"), env(), {
        ...dependencies(fetchMock),
        rename
      });
      const files = await readdir(outDir);

      expect(result.provider).toBe("silent_placeholder");
      expect(files.some((file) => file.includes(".tmp-"))).toBe(false);
      expect(files).not.toContain("narration_test.mp3.json");
    } finally {
      await rm(outDir, { recursive: true, force: true });
    }
  });
});
