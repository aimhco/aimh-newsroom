import { join, relative } from "node:path";
import { fixtureRawItems } from "../collectors/fixtures";
import { loadEnvSnapshotFromFiles } from "../config/env";
import { generateFallbackCardPng } from "../capture/generateFallbackCard";
import { detectVideoEngine } from "../integrations/video-engine/detectVideoEngine";
import { normalizeRawItems } from "../normalize/normalize";
import { buildEpisodePackage } from "../plan/episodeBuilder";
import { runPackageQa } from "../qa/qaRunner";
import { rankStories } from "../rank/scoreStory";
import { renderLocalFallbackVideo, type LocalRenderResult } from "../render/localFallbackRenderer";
import { renderMorningHandoff } from "../reports/morningHandoff";
import { renderQuestionsForDenny } from "../reports/questionsForDenny";
import type { EpisodePackage, QaReport, QuestionForDenny, RunEvent } from "../types";
import { ensureDir, writeJson, writeJsonl, writeText } from "../utils/fs";
import { nowIso, episodeIdForDate } from "../utils/time";

export interface RunOvernightOptions {
  projectRoot: string;
  date: string;
  fixtures: boolean;
  dryRun: boolean;
  noUpload: boolean;
  renderVideo?: boolean;
  videoEnginePath?: string;
  renderer?: (options: {
    episodeDir: string;
    package: EpisodePackage;
    env: Record<string, string | undefined>;
    allowElevenLabs: boolean;
  }) => Promise<LocalRenderResult>;
}

export interface RunOvernightResult {
  episodeId: string;
  episodeDir: string;
  qa: QaReport;
  package: EpisodePackage;
  render?: LocalRenderResult;
}

function runEvent(task_id: string, status: RunEvent["status"], fallback_used = false): RunEvent {
  const now = nowIso();
  return {
    run_id: `run_${now.replace(/[-:.TZ]/g, "_")}`,
    task_id,
    status,
    started_at: now,
    finished_at: now,
    attempts: 1,
    fallback_used
  };
}

function buildQuestions(options: {
  noUpload: boolean;
  dryRun: boolean;
  uploadEnabled: boolean;
  hasVoiceCreds: boolean;
  hasLlmCreds: boolean;
  episodeId: string;
}): QuestionForDenny[] {
  const questions: QuestionForDenny[] = [];
  if (!options.hasLlmCreds) {
    questions.push({
      title: "LLM provider key missing",
      neededFor: "live story summarization and script generation",
      defaultUsed: "deterministic fixture script planner",
      impact: "dry-run package is reviewable, but live editorial writing is not enabled",
      toResolve: "add OPENAI_API_KEY, ANTHROPIC_API_KEY, or GOOGLE_API_KEY to .env and set AIMH_LLM_PROVIDER",
      resumeCommand: `pnpm newsroom:resume --episode ${options.episodeId} --from-stage plan`
    });
  }
  if (!options.hasVoiceCreds) {
    questions.push({
      title: "ElevenLabs credentials missing",
      neededFor: "real narration audio",
      defaultUsed: "placeholder voice manifest",
      impact: "episode package has script timing but no synthesized narration",
      toResolve: "add ELEVENLABS_API_KEY and ELEVENLABS_VOICE_ID to .env",
      resumeCommand: `pnpm newsroom:voice --episode ${options.episodeId}`
    });
  }
  if (options.noUpload || options.dryRun || !options.uploadEnabled) {
    questions.push({
      title: "YouTube private upload disabled",
      neededFor: "automatic private YouTube upload",
      defaultUsed: "skipped upload and kept local episode package",
      impact: "video can be reviewed locally but was not uploaded",
      toResolve: "set YOUTUBE_UPLOAD_ENABLED=true and provide YOUTUBE_CLIENT_ID, YOUTUBE_CLIENT_SECRET, and YOUTUBE_REFRESH_TOKEN",
      resumeCommand: `pnpm newsroom:upload --episode ${options.episodeId} --private`
    });
  }
  return questions;
}

function renderEpisodeReview(pkg: EpisodePackage, qa: QaReport): string {
  return `# ${pkg.episode.title}

## Summary

${pkg.episode.description}

## Script

${pkg.script.narration.map((paragraph) => `- **${paragraph.id}** (${paragraph.estimated_seconds}s): ${paragraph.text}`).join("\n")}

## Shot List

${pkg.shotlist.shots.map((shot) => `- **${shot.id}** ${shot.type}: ${shot.fallback.card_text} (${shot.asset_path ?? "no asset"})`).join("\n")}

## Sources

${pkg.sources.sources.map((source) => `- ${source.publisher}: ${source.title} - ${source.url}`).join("\n")}

## QA

${qa.checks.map((check) => `- ${check.pass ? "PASS" : "FAIL"} ${check.name}: ${check.detail}`).join("\n")}
`;
}

function renderReviewHtml(markdown: string): string {
  const escaped = markdown.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
  return `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>AIMH Newsroom Review</title>
  <style>
    body { margin: 0; font-family: Arial, sans-serif; background: #f8f4e8; color: #101820; }
    main { max-width: 980px; margin: 0 auto; padding: 48px 24px; }
    pre { white-space: pre-wrap; line-height: 1.55; font-size: 15px; }
  </style>
</head>
<body><main><pre>${escaped}</pre></main></body>
</html>
`;
}

async function attachFallbackCards(episodeDir: string, pkg: EpisodePackage): Promise<void> {
  for (const shot of pkg.shotlist.shots) {
    const assetRel = `assets/cards/${shot.id}.png`;
    const assetPath = join(episodeDir, assetRel);
    await generateFallbackCardPng({
      outPath: assetPath,
      title: shot.fallback.card_text,
      label: shot.type.replace(/_/g, " ").toUpperCase()
    });
    shot.asset_path = assetRel;
    shot.status = "fallback_generated";
  }
}

async function writePackage(episodeDir: string, pkg: EpisodePackage): Promise<void> {
  await writeJson(join(episodeDir, "episode.json"), pkg.episode);
  await writeJson(join(episodeDir, "script.json"), pkg.script);
  await writeJson(join(episodeDir, "shotlist.json"), pkg.shotlist);
  await writeJson(join(episodeDir, "sources.json"), pkg.sources);
  await writeJson(join(episodeDir, "metadata.json"), pkg.metadata);
}

export async function runOvernight(options: RunOvernightOptions): Promise<RunOvernightResult> {
  const videoEnginePath = options.videoEnginePath ?? "/Users/dennywii/Documents/dev/aimh-video-engine";
  const episodeId = episodeIdForDate(options.date);
  const episodeDir = join(options.projectRoot, "episodes", episodeId);
  const reportDir = join(episodeDir, "reports");
  await ensureDir(reportDir);
  await ensureDir(join(options.projectRoot, "reports"));
  await ensureDir(join(options.projectRoot, ".state"));

  const commandsRun = [{ command: "runOvernight", result: "started" }];
  const env = await loadEnvSnapshotFromFiles(options.projectRoot, videoEnginePath);
  const videoEngine = await detectVideoEngine(videoEnginePath);
  const rawItems = fixtureRawItems();
  const normalized = normalizeRawItems(rawItems, options.date);
  const ranked = rankStories(normalized.stories);
  const sources = {
    schema_version: "0.1.0" as const,
    claims: normalized.claims,
    sources: normalized.sources
  };
  const pkg = buildEpisodePackage({
    date: options.date,
    timezone: env.values.AIMH_TIMEZONE ?? "America/New_York",
    rankedStories: ranked,
    sources
  });

  await attachFallbackCards(episodeDir, pkg);
  let renderResult: LocalRenderResult | undefined;
  if (options.renderVideo) {
    const renderer = options.renderer ?? renderLocalFallbackVideo;
    try {
      renderResult = await renderer({
        episodeDir,
        package: pkg,
        env: env.values,
        allowElevenLabs: !options.dryRun
      });
    } catch (error) {
      renderResult = {
        mode: "local_fallback_render",
        status: "failed",
        voice: { provider: "silent_placeholder", chunks: [], warnings: [] },
        warnings: [(error as Error).message],
        qaCheck: {
          name: "local_render",
          pass: false,
          detail: (error as Error).message
        }
      };
    }
  }

  const qa = runPackageQa(pkg);
  if (renderResult?.qaCheck) qa.checks.push(renderResult.qaCheck);
  qa.ok = qa.checks.every((item) => item.pass);
  const uploadEnabled = env.values.YOUTUBE_UPLOAD_ENABLED === "true";
  const questions = buildQuestions({
    noUpload: options.noUpload,
    dryRun: options.dryRun,
    uploadEnabled,
    hasVoiceCreds: Boolean(env.values.ELEVENLABS_API_KEY && env.values.ELEVENLABS_VOICE_ID),
    hasLlmCreds: Boolean(env.values.OPENAI_API_KEY || env.values.ANTHROPIC_API_KEY || env.values.GOOGLE_API_KEY),
    episodeId
  });

  await writeJsonl(join(episodeDir, "raw_items.jsonl"), rawItems);
  await writeJson(join(episodeDir, "clusters.json"), normalized.clusters);
  await writeJson(join(episodeDir, "rankings.json"), ranked);
  await writePackage(episodeDir, pkg);
  await writeJson(join(episodeDir, "qa.json"), qa);
  if (renderResult) {
    await writeJson(join(episodeDir, "render/render-status.json"), renderResult);
  } else {
    await writeJson(join(episodeDir, "voice/narration.json"), {
      provider: "placeholder",
      status: "skipped",
      reason: "Real voice generation requires ElevenLabs credentials and is skipped in dry-run mode."
    });
    await writeJson(join(episodeDir, "render/render-status.json"), {
      mode: "package_only",
      status: "skipped",
      reason: "Existing video engine expects screen-recording inputs; newsroom episode package was produced for integration."
    });
  }
  await writeJson(join(episodeDir, "reports/video-engine-inspection.json"), videoEngine);
  await writeText(
    join(episodeDir, "reports/video-engine-integration-requests.md"),
    `# Video Engine Integration Requests

- What needs to change: add a CLI or library entrypoint that accepts an AIMH Newsroom episode package folder.
- Why: the current detected renderer expects \`videos/<slug>/script.json\` plus \`recording.mp4\`.
- Proposed interface: \`bun run make-episode-package <episode-dir>\` or equivalent.
- Files likely affected: \`scripts/make-video.ts\`, \`src/types.ts\`, and rendering assembly code.
- Whether it blocks this repo: no.
- Workaround used overnight: package-only output with fallback visual cards.
`
  );

  const questionsMd = renderQuestionsForDenny(questions);
  await writeText(join(reportDir, "questions-for-denny.md"), questionsMd);
  await writeText(join(options.projectRoot, "reports/questions-for-denny.md"), questionsMd);
  await writeJson(join(episodeDir, "reports/rate-limits.json"), []);
  await writeJsonl(join(episodeDir, "reports/run-events.jsonl"), [
    runEvent("collect_fixture_items", "succeeded"),
    runEvent("capture_fallback_cards", "fallback_used", true),
    runEvent("voice_placeholder", "skipped", true),
    renderResult
      ? runEvent("render_local_fallback_video", renderResult.status === "rendered" ? "succeeded" : "failed", renderResult.voice.provider === "silent_placeholder")
      : runEvent("render_package_only", "skipped", true),
    runEvent("upload_private", "skipped", true)
  ]);
  await writeText(
    join(episodeDir, "reports/run-log.md"),
    [
      "# Run Log",
      "",
      `- Project root: ${options.projectRoot}`,
      `- Episode dir: ${relative(options.projectRoot, episodeDir)}`,
      `- Fixtures: ${options.fixtures}`,
      `- Dry run: ${options.dryRun}`,
      "- Upload: skipped by policy/default"
    ].join("\n") + "\n"
  );

  const reviewMd = renderEpisodeReview(pkg, qa);
  await writeText(join(episodeDir, "episode-review.md"), reviewMd);
  await writeText(join(episodeDir, "review.html"), renderReviewHtml(reviewMd));

  commandsRun[0] = { command: "runOvernight", result: qa.ok ? "completed with passing package QA" : "completed with failing package QA" };
  const handoff = renderMorningHandoff({
    date: options.date,
    episodeDir,
    commandsRun,
    qa,
    questions,
    videoEngine,
    usedFixtures: options.fixtures,
    ...(renderResult ? { render: renderResult } : {})
  });
  await writeText(join(options.projectRoot, "reports/morning-handoff-2026-07-09.md"), handoff);
  await writeText(join(episodeDir, "reports/morning-handoff-2026-07-09.md"), handoff);

  return { episodeId, episodeDir, qa, package: pkg, ...(renderResult ? { render: renderResult } : {}) };
}
