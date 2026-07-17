import { describe, expect, it } from "vitest";
import {
  assertElevenLabsVoiceResult,
  buildGpt56FinalRenderArgs,
  buildGpt56PlateJobs,
  buildGpt56SegmentMuxArgs,
  GPT56_EPISODE,
  parseGpt56Command,
  SUPPORTED_GPT56_COMMANDS,
  validateGpt56Episode
} from "../src/production/gpt56Episode";

describe("GPT-5.6 episode manifest", () => {
  it("defines eight ordered, source-covered scenes and no upload command", () => {
    expect(() => validateGpt56Episode(GPT56_EPISODE)).not.toThrow();
    expect(GPT56_EPISODE.narration.map(({ id }) => id)).toEqual([
      "narration_launch",
      "narration_tiers",
      "narration_controls",
      "narration_practical",
      "narration_evidence",
      "narration_safety",
      "narration_availability",
      "narration_takeaway"
    ]);
    expect(SUPPORTED_GPT56_COMMANDS).toEqual(["voice", "render", "qa", "all"]);
    expect(SUPPORTED_GPT56_COMMANDS).not.toContain("upload");
  });

  it("rejects duplicate narration ids and unsafe evidence paths", () => {
    const duplicate = {
      ...GPT56_EPISODE,
      narration: GPT56_EPISODE.narration.map((item, index) =>
        index === 1 ? { ...item, id: GPT56_EPISODE.narration[0]!.id } : item
      )
    };
    expect(() => validateGpt56Episode(duplicate)).toThrow(/duplicate narration id/);

    const unsafe = {
      ...GPT56_EPISODE,
      evidence: GPT56_EPISODE.evidence.map((item, index) =>
        index === 0 ? { ...item, assetPath: "../secret.png" } : item
      )
    };
    expect(() => validateGpt56Episode(unsafe)).toThrow(/relative and below evidence/);
  });

  it("requires complete ElevenLabs narration with measured durations", () => {
    const voice = {
      provider: "elevenlabs" as const,
      chunks: GPT56_EPISODE.narration.map((item, index) => ({
        id: item.id,
        text: item.text,
        file: `/tmp/${item.id}.mp3`,
        durationSeconds: 10 + index,
        provider: "elevenlabs" as const,
        cached: false
      })),
      warnings: []
    };

    expect(assertElevenLabsVoiceResult(voice)).toHaveLength(8);
    expect(() =>
      assertElevenLabsVoiceResult({
        ...voice,
        provider: "silent_placeholder",
        warnings: ["fallback"]
      })
    ).toThrow(/ElevenLabs narration is required/);
  });

  it("builds one duration-bound evidence plate per narration chunk", () => {
    const voice = GPT56_EPISODE.narration.map((item, index) => ({
      id: item.id,
      text: item.text,
      file: `/tmp/${item.id}.mp3`,
      durationSeconds: 10 + index,
      provider: "elevenlabs" as const,
      cached: false
    }));
    const evidenceDimensions = Object.fromEntries(
      GPT56_EPISODE.evidence.map(({ assetPath }) => [assetPath, { width: 1440, height: 900 }])
    );
    const jobs = buildGpt56PlateJobs(voice, evidenceDimensions, "/episode");

    expect(jobs).toHaveLength(8);
    expect(jobs[0]!.durationSeconds).toBe(10);
    expect(jobs[3]!.inputProps.evidences).toHaveLength(3);
    expect(jobs[7]!.inputProps.evidences).toBeUndefined();
    expect(jobs[7]!.inputProps.sceneContent.scene).toBe("cta");
    expect(jobs[7]!.inputProps.sceneContent).toHaveProperty("seriesLabel", "GPT-5.6");
  });

  it("constructs deterministic narration mux and branded outro commands", () => {
    const mux = buildGpt56SegmentMuxArgs({
      platePath: "/tmp/plate.mp4",
      narrationPath: "/tmp/voice.mp3",
      outputPath: "/tmp/segment.mp4",
      durationSeconds: 12.345
    });
    expect(mux).toEqual(expect.arrayContaining(["-c:v", "copy", "-c:a", "aac", "-ar", "48000", "-ac", "2"]));
    expect(mux).toContain("12.345");

    const finish = buildGpt56FinalRenderArgs({
      assembledPath: "/tmp/assembled.mp4",
      logoPath: "/tmp/logo.png",
      outroPath: "/tmp/outro.mp3",
      outputPath: "/tmp/final.mp4",
      durationSeconds: 160
    });
    const graph = finish[finish.indexOf("-filter_complex") + 1]!;
    expect(graph).toContain("colorchannelmixer=aa=0.85");
    expect(graph).toContain("overlay=W-w-24:24");
    expect(graph).toContain("adelay=153000:all=1");
    expect(graph).toContain("amix=inputs=2:duration=first");
  });

  it("rejects upload as a CLI command", () => {
    expect(parseGpt56Command("all")).toBe("all");
    expect(() => parseGpt56Command("upload")).toThrow(/Unsupported GPT-5.6 command/);
  });
});
