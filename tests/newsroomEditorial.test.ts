import { mkdir, mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { validateMediaManifest } from "../src/capture/mediaManifest";
import { validateArticleEditorialGate } from "../src/editorial/articleEditorialGate";
import { validateArticleEpisodePreflight } from "../src/editorial/articleEpisodePreflight";
import { validateResearchManifest } from "../src/editorial/researchManifest";

describe("newsroom related-source research", () => {
  const candidateMetadata = {
    title: "Independent test",
    publisher: "Example Lab",
    url: "https://example.com/test",
    accessed_at: "2026-07-14"
  };

  it("allows fewer than two selected sources when rejected candidates have materiality reasons", () => {
    expect(() =>
      validateResearchManifest({
        schema_version: "0.1.0",
        primary_source_id: "primary",
        search_complete: true,
        hands_on_sought: true,
        search_notes: "Reviewed hands-on tests and independent reporting.",
        candidates: [
          {
            ...candidateMetadata,
            id: "hands-on",
            independent: true,
            evidence_type: "hands_on",
            novelty: 3,
            story_impact: 3,
            decision: "selected",
            rationale: "Tests a real task."
          },
          {
            ...candidateMetadata,
            id: "repeat",
            independent: true,
            evidence_type: "reporting",
            novelty: 0,
            story_impact: 0,
            decision: "rejected",
            rationale: "Repeats the announcement."
          }
        ]
      })
    ).not.toThrow();
  });

  it("allows no related candidates when a completed search documents why none were usable", () => {
    expect(() =>
      validateResearchManifest({
        schema_version: "0.1.0",
        primary_source_id: "primary",
        search_complete: true,
        hands_on_sought: true,
        search_notes: "No independent coverage or hands-on test added new evidence.",
        candidates: []
      })
    ).not.toThrow();
  });

  it("rejects an incomplete independent-source search", () => {
    expect(() =>
      validateResearchManifest({
        schema_version: "0.1.0",
        primary_source_id: "primary",
        search_complete: false,
        hands_on_sought: true,
        search_notes: "Search still running.",
        candidates: []
      })
    ).toThrow(/search is incomplete/);
  });

  it("rejects a selected source without a material contribution", () => {
    expect(() =>
      validateResearchManifest({
        schema_version: "0.1.0",
        primary_source_id: "primary",
        search_complete: true,
        hands_on_sought: true,
        search_notes: "Reviewed two candidates.",
        candidates: [
          {
            ...candidateMetadata,
            id: "repeat",
            independent: true,
            evidence_type: "reporting",
            novelty: 0,
            story_impact: 0,
            decision: "selected",
            rationale: "Repeats the release."
          }
        ]
      })
    ).toThrow(/material contribution/);
  });

  it("rejects a candidate without a decision rationale", () => {
    expect(() =>
      validateResearchManifest({
        schema_version: "0.1.0",
        primary_source_id: "primary",
        search_complete: true,
        hands_on_sought: true,
        search_notes: "Reviewed one candidate.",
        candidates: [
          {
            ...candidateMetadata,
            id: "candidate",
            independent: true,
            evidence_type: "analysis",
            novelty: 1,
            story_impact: 1,
            decision: "rejected",
            rationale: ""
          }
        ]
      })
    ).toThrow(/rationale/);
  });

  it("rejects a candidate without source provenance", () => {
    expect(() =>
      validateResearchManifest({
        schema_version: "0.1.0",
        primary_source_id: "primary",
        search_complete: true,
        hands_on_sought: true,
        search_notes: "Reviewed one candidate.",
        candidates: [
          {
            ...candidateMetadata,
            publisher: "",
            id: "candidate",
            independent: true,
            evidence_type: "analysis",
            novelty: 1,
            story_impact: 1,
            decision: "rejected",
            rationale: "Does not change the story."
          }
        ]
      })
    ).toThrow(/publisher/);
  });
});

describe("primary-page media inventory", () => {
  it("accepts selected and explicitly rejected media with editorial reasons", () => {
    expect(() =>
      validateMediaManifest({
        schema_version: "0.1.0",
        primary_url: "https://example.com/story",
        audit_complete: true,
        items: [
          {
            id: "hero",
            kind: "video",
            source_url: "https://example.com/hero.mp4",
            review_status: "watched",
            review_notes: "Watched the full launch clip and recorded its opening motion.",
            decision: "selected",
            rationale: "Opening motion evidence."
          },
          {
            id: "demo",
            kind: "interactive",
            source_url: "https://example.com/demo",
            review_status: "operated",
            review_notes: "Started the demo and tested its visible controls.",
            decision: "selected",
            rationale: "Shows the built result."
          },
          {
            id: "repeat",
            kind: "iframe",
            source_url: "https://example.com/repeat",
            review_status: "watched",
            review_notes: "Watched the embedded sequence and found it duplicative.",
            decision: "rejected",
            rationale: "Duplicates the selected demo."
          }
        ]
      })
    ).not.toThrow();
  });

  it("rejects an incomplete media audit", () => {
    expect(() =>
      validateMediaManifest({
        schema_version: "0.1.0",
        primary_url: "https://example.com/story",
        audit_complete: false,
        items: []
      })
    ).toThrow(/incomplete/);
  });

  it("rejects discovered media without a decision rationale", () => {
    expect(() =>
      validateMediaManifest({
        schema_version: "0.1.0",
        primary_url: "https://example.com/story",
        audit_complete: true,
        items: [
          {
            id: "hero",
            kind: "video",
            source_url: "https://example.com/hero.mp4",
            review_status: "watched",
            review_notes: "Watched the complete clip.",
            decision: "rejected",
            rationale: ""
          }
        ]
      })
    ).toThrow(/rationale/);
  });

  it("rejects duplicate item ids and malformed URLs", () => {
    expect(() =>
      validateMediaManifest({
        schema_version: "0.1.0",
        primary_url: "https://example.com/story",
        audit_complete: true,
        items: [
          {
            id: "same",
            kind: "video",
            source_url: "https://example.com/one.mp4",
            review_status: "watched",
            review_notes: "Watched the clip.",
            decision: "selected",
            rationale: "Useful."
          },
          {
            id: "same",
            kind: "iframe",
            source_url: "not a URL",
            review_status: "watched",
            review_notes: "Watched the embed.",
            decision: "rejected",
            rationale: "Duplicate."
          }
        ]
      })
    ).toThrow(/Duplicate media item/);
  });

  it("rejects video and interactive decisions made without the required review", () => {
    expect(() =>
      validateMediaManifest({
        schema_version: "0.1.0",
        primary_url: "https://example.com/story",
        audit_complete: true,
        items: [{
          id: "unwatched-video",
          kind: "video",
          source_url: "https://example.com/video.mp4",
          review_status: "inspected",
          review_notes: "Only inspected the poster frame.",
          decision: "rejected",
          rationale: "Appeared duplicative."
        }]
      })
    ).toThrow(/must be watched/);

    expect(() =>
      validateMediaManifest({
        schema_version: "0.1.0",
        primary_url: "https://example.com/story",
        audit_complete: true,
        items: [{
          id: "unoperated-demo",
          kind: "interactive",
          source_url: "https://example.com/demo",
          review_status: "watched",
          review_notes: "Observed the idle state only.",
          decision: "rejected",
          rationale: "Appeared duplicative."
        }]
      })
    ).toThrow(/must be operated/);
  });

  it("rejects a media decision without review notes", () => {
    expect(() =>
      validateMediaManifest({
        schema_version: "0.1.0",
        primary_url: "https://example.com/story",
        audit_complete: true,
        items: [{
          id: "hero",
          kind: "video",
          source_url: "https://example.com/hero.mp4",
          review_status: "watched",
          review_notes: "",
          decision: "selected",
          rationale: "Useful opening evidence."
        }]
      })
    ).toThrow(/review notes/);
  });
});

describe("article editorial sealing gate", () => {
  const research = {
    schema_version: "0.1.0" as const,
    primary_source_id: "primary",
    search_complete: true,
    hands_on_sought: true,
    search_notes: "Reviewed independent coverage and one hands-on test.",
    candidates: []
  };

  it("accepts used motion only when the completed media audit selected and captured it", () => {
    expect(() => validateArticleEditorialGate({
      researchManifest: research,
      mediaManifest: {
        schema_version: "0.1.0",
        primary_url: "https://example.com/article",
        audit_complete: true,
        items: [{
          id: "hero",
          kind: "video",
          source_url: "https://example.com/hero.mp4",
          local_asset: "source/hero.mp4",
          review_status: "watched",
          review_notes: "Watched the clip and verified visible motion.",
          decision: "selected",
          rationale: "Moving opening evidence."
        }]
      },
      usedPrimaryMotionAssets: ["source/hero.mp4"]
    })).not.toThrow();
  });

  it("rejects selected motion without a captured asset", () => {
    expect(() => validateArticleEditorialGate({
      researchManifest: research,
      mediaManifest: {
        schema_version: "0.1.0",
        primary_url: "https://example.com/article",
        audit_complete: true,
        items: [{
          id: "hero",
          kind: "video",
          source_url: "https://example.com/hero.mp4",
          review_status: "watched",
          review_notes: "Watched the clip and verified visible motion.",
          decision: "selected",
          rationale: "Moving opening evidence."
        }]
      },
      usedPrimaryMotionAssets: []
    })).toThrow(/captured local_asset/);
  });

  it("rejects motion used by the edit when it was not selected in the audit", () => {
    expect(() => validateArticleEditorialGate({
      researchManifest: research,
      mediaManifest: {
        schema_version: "0.1.0",
        primary_url: "https://example.com/article",
        audit_complete: true,
        items: [{
          id: "hero",
          kind: "video",
          source_url: "https://example.com/hero.mp4",
          local_asset: "source/hero.mp4",
          review_status: "watched",
          review_notes: "Watched the clip and verified visible motion.",
          decision: "selected",
          rationale: "Moving opening evidence."
        }]
      },
      usedPrimaryMotionAssets: ["source/unreviewed.mp4"]
    })).toThrow(/Used primary motion/);
  });

  it("provides a reusable episode preflight that verifies reviewed motion exists before rendering", async () => {
    const episodeDir = await mkdtemp(join(tmpdir(), "article-preflight-"));
    await mkdir(join(episodeDir, "source"));
    await writeFile(join(episodeDir, "source", "hero.mp4"), "captured motion");
    await writeFile(join(episodeDir, "research-manifest.json"), JSON.stringify(research));
    await writeFile(join(episodeDir, "media-manifest.json"), JSON.stringify({
      schema_version: "0.1.0",
      primary_url: "https://example.com/article",
      audit_complete: true,
      items: [{
        id: "hero",
        kind: "video",
        source_url: "https://example.com/hero.mp4",
        local_asset: "source/hero.mp4",
        review_status: "watched",
        review_notes: "Watched the full clip and chose its opening motion.",
        decision: "selected",
        rationale: "Moving opening evidence."
      }]
    }));

    await expect(validateArticleEpisodePreflight({
      episodeDir,
      usedPrimaryMotionAssets: ["source/hero.mp4"]
    })).resolves.toMatchObject({ selectedMotionAssets: ["source/hero.mp4"] });
  });

  it("rejects a reviewed and selected motion asset that is not present on disk", async () => {
    const episodeDir = await mkdtemp(join(tmpdir(), "article-preflight-missing-"));
    await writeFile(join(episodeDir, "research-manifest.json"), JSON.stringify(research));
    await writeFile(join(episodeDir, "media-manifest.json"), JSON.stringify({
      schema_version: "0.1.0",
      primary_url: "https://example.com/article",
      audit_complete: true,
      items: [{
        id: "hero",
        kind: "video",
        source_url: "https://example.com/hero.mp4",
        local_asset: "source/missing.mp4",
        review_status: "watched",
        review_notes: "Watched the full clip.",
        decision: "selected",
        rationale: "Moving opening evidence."
      }]
    }));

    await expect(validateArticleEpisodePreflight({
      episodeDir,
      usedPrimaryMotionAssets: ["source/missing.mp4"]
    })).rejects.toThrow(/unavailable/);
  });
});
