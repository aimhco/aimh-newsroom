import type { EpisodeFile, EpisodePackage, MetadataFile, RankedStory, ScriptFile, ShotlistFile, SourcesFile } from "../types";
import { episodeIdForDate } from "../utils/time";

function assignRoles(stories: RankedStory[]): RankedStory[] {
  return stories.slice(0, 5).map((story, index) => ({
    ...story,
    selectionRole:
      index === 0
        ? "main_story"
        : index === 1
          ? "practical_demo"
          : index === 2
            ? "tool_to_watch"
            : "quick_hit"
  }));
}

function shotTypeForStory(story: RankedStory): ShotlistFile["shots"][number]["type"] {
  if (story.selectionRole === "practical_demo") return "browser_demo_clip";
  if (story.sourceTypes.includes("model")) return "model_card";
  if (story.sourceTypes.includes("repo")) return "repo_card";
  if (story.sourceTypes.includes("social")) return "social_card";
  return "source_screenshot";
}

export function buildEpisodePackage(input: {
  date: string;
  timezone: string;
  rankedStories: RankedStory[];
  sources: SourcesFile;
}): EpisodePackage {
  const selected = assignRoles(input.rankedStories);
  const episodeId = episodeIdForDate(input.date);
  const title = `Today in AI: ${selected[0]?.title ?? "Daily AI Briefing"}`;
  const description = "A fixture-backed AIMH daily AI briefing package generated for review.";

  const episode: EpisodeFile = {
    schema_version: "0.1.0",
    episode_id: episodeId,
    date: input.date,
    timezone: input.timezone,
    title,
    description,
    format: "daily_ai_briefing",
    target_duration_seconds: 240,
    status: "needs_review",
    segments: selected.map((story, index) => ({
      id: `seg_${String(index + 1).padStart(3, "0")}`,
      role: story.selectionRole ?? "quick_hit",
      title: story.title,
      story_id: story.id
    })),
    youtube: {},
    sources_file: "sources.json",
    script_file: "script.json",
    shotlist_file: "shotlist.json",
    metadata_file: "metadata.json"
  };

  const script: ScriptFile = {
    schema_version: "0.1.0",
    voice: {
      provider: "placeholder",
      voice_id_env: "ELEVENLABS_VOICE_ID",
      style: "clear, fast, useful, confident"
    },
    narration: selected.map((story, index) => {
      const n = String(index + 1).padStart(3, "0");
      return {
        id: `seg_${n}_para_001`,
        segment_id: `seg_${n}`,
        text:
          index === 0
            ? `Today in AI, the lead is this: ${story.summary}`
            : `${story.title}: ${story.summary}`,
        estimated_seconds: index === 0 ? 8 : 6,
        claim_ids: story.claimIds,
        shot_ids: [`shot_${n}`]
      };
    })
  };

  const shotlist: ShotlistFile = {
    schema_version: "0.1.0",
    shots: selected.map((story, index) => {
      const n = String(index + 1).padStart(3, "0");
      const source = input.sources.sources.find((item) => story.sourceIds.includes(item.id));
      return {
        id: `shot_${n}`,
        segment_id: `seg_${n}`,
        type: shotTypeForStory(story),
        duration_seconds: index === 0 ? 8 : 6,
        source_url: source?.url,
        highlight_text: story.title,
        fallback: {
          type: index === 0 ? "headline_card" : "source_screenshot",
          card_text: story.title
        },
        asset_path: null,
        status: "planned"
      };
    })
  };

  const metadata: MetadataFile = {
    schema_version: "0.1.0",
    youtube: {
      title,
      description,
      tags: ["AI news", "AIMH", "OpenAI", "Claude", "developer tools"],
      categoryId: "28",
      privacyStatus: "private",
      madeForKids: false,
      containsSyntheticMedia: true
    },
    thumbnail: {
      brief: "AIMH branded AI news thumbnail with bold daily briefing treatment.",
      text_options: ["Today in AI", "AI News Briefing", "What Changed Today"]
    }
  };

  return { episode, script, shotlist, sources: input.sources, metadata };
}
