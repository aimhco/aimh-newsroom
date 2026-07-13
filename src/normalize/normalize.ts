import type { CandidateStory, ClaimRecord, RawItem, SourceRecord, StoryCluster } from "../types";
import { accessedAtForDate } from "../utils/time";

const sourceId = (index: number): string => `source_${String(index + 1).padStart(3, "0")}`;
const claimId = (index: number): string => `claim_${String(index + 1).padStart(3, "0")}`;
const storyId = (index: number): string => `story_${String(index + 1).padStart(3, "0")}`;

export function normalizeRawItems(items: RawItem[], date: string): {
  stories: CandidateStory[];
  sources: SourceRecord[];
  claims: ClaimRecord[];
  clusters: StoryCluster[];
} {
  const sources: SourceRecord[] = [];
  const claims: ClaimRecord[] = [];
  const stories: CandidateStory[] = [];
  const clusters: StoryCluster[] = [];

  items.forEach((item, index) => {
    const sid = sourceId(index);
    const cid = claimId(index);
    const story = storyId(index);
    sources.push({
      id: sid,
      url: item.url,
      title: item.title,
      publisher: item.publisher,
      source_type: item.source_type,
      ...(item.published_at ? { published_at: item.published_at } : {}),
      accessed_at: accessedAtForDate(date)
    });
    claims.push({
      id: cid,
      text: item.summary,
      source_ids: [sid],
      verification_status:
        item.source_type === "official" || item.source_type === "repo" || item.source_type === "model"
          ? "verified"
          : item.source_type === "social" || item.source_type === "newsletter"
            ? "partially_verified"
            : "unverified",
      risk_notes:
        item.source_type === "social" || item.source_type === "newsletter"
          ? ["Used for context only unless corroborated by an official source."]
          : []
    });
    stories.push({
      id: story,
      title: item.title,
      summary: item.summary,
      sourceIds: [sid],
      claimIds: [cid],
      sourceTypes: [item.source_type],
      scores: item.scores
    });
    clusters.push({
      id: `cluster_${String(index + 1).padStart(3, "0")}`,
      title: item.title,
      storyIds: [story],
      sourceIds: [sid],
      claimIds: [cid]
    });
  });

  return { stories, sources, claims, clusters };
}
