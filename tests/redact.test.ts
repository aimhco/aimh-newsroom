import { describe, expect, it } from "vitest";
import { loadEnvSnapshot, parseEnvText } from "../src/config/env";
import { redactText, scanTextForSecretLeaks } from "../src/utils/redact";

describe("env loading and redaction", () => {
  it("parses env files without exposing values", () => {
    expect(parseEnvText("OPENAI_API_KEY=sk-test\n# ignored\nAIMH_BRAND_NAME=AIMH\n")).toEqual({
      OPENAI_API_KEY: "sk-test",
      AIMH_BRAND_NAME: "AIMH"
    });
  });

  it("reports variable presence by name and source only", () => {
    const snapshot = loadEnvSnapshot({
      shellEnv: { OPENAI_API_KEY: "sk-shell" },
      localEnvText: "ELEVENLABS_API_KEY=eleven-secret\n",
      fallbackEnvText: "YOUTUBE_REFRESH_TOKEN=refresh-secret\n"
    });

    expect(snapshot.status.OPENAI_API_KEY).toEqual({ present: true, source: "shell" });
    expect(snapshot.status.ELEVENLABS_API_KEY).toEqual({ present: true, source: "local" });
    expect(snapshot.status.YOUTUBE_REFRESH_TOKEN).toEqual({ present: true, source: "video-engine" });
    expect(JSON.stringify(snapshot.status)).not.toContain("secret");
    expect(JSON.stringify(snapshot.status)).not.toContain("sk-shell");
  });

  it("redacts likely secrets and detects leaks", () => {
    const text = "OPENAI_API_KEY=sk-1234567890abcdef Bearer abcdefghijklmnop client_secret=my-secret";

    expect(redactText(text)).toBe("OPENAI_API_KEY=*** Bearer *** client_secret=***");
    expect(scanTextForSecretLeaks(text).map((finding) => finding.pattern)).toContain("key-assignment");
  });
});
