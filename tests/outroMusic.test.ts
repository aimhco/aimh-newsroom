import { describe, expect, it } from "vitest";
import {
  chooseEpisodeOutro,
  filterOutroCandidates,
  selectEpisodeOutroPath
} from "../src/render/outroMusic";

describe("episode outro music", () => {
  const files = ["Body_A.mp3", "Outro_A.mp3", "Outro_B.mp3", ".DS_Store"];

  it("uses only Outro MP3 files in stable order", () => {
    expect(filterOutroCandidates(files)).toEqual(["Outro_A.mp3", "Outro_B.mp3"]);
  });

  it("is stable for the same episode seed", () => {
    expect(chooseEpisodeOutro("episode-a", files)).toBe(
      chooseEpisodeOutro("episode-a", [...files].reverse())
    );
  });

  it("avoids the previous track when another candidate exists", () => {
    expect(chooseEpisodeOutro("episode-a", files, "Outro_A.mp3")).toBe("Outro_B.mp3");
  });

  it("returns an absolute selected path under the configured music directory", () => {
    expect(selectEpisodeOutroPath("episode-a", "/music", files, "Outro_A.mp3")).toBe(
      "/music/Outro_B.mp3"
    );
  });

  it("fails when there are no outro candidates", () => {
    expect(() => chooseEpisodeOutro("episode-a", ["Body_A.mp3"])).toThrow(
      /No outro music/
    );
  });
});
