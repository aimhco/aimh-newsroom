import type { QaReport, QuestionForDenny } from "../types";
import type { VideoEngineInspection } from "../integrations/video-engine/detectVideoEngine";
import { renderQuestionsForDenny } from "./questionsForDenny";

export function renderMorningHandoff(options: {
  date: string;
  episodeDir: string;
  commandsRun: Array<{ command: string; result: string }>;
  qa: QaReport;
  questions: QuestionForDenny[];
  videoEngine: VideoEngineInspection;
  usedFixtures: boolean;
}): string {
  return `# AIMH Newsroom Morning Handoff - ${options.date}

## Summary

Built the first local-first AIMH Newsroom MVP spine. The current run produced a reviewable episode package, deterministic script, shot list, fallback cards, QA report, review artifacts, and video-engine integration status. Upload remained disabled by policy.

## Finished artifacts

- Episode package: \`${options.episodeDir}\`
- QA report: \`${options.episodeDir}/qa.json\`
- Review markdown: \`${options.episodeDir}/episode-review.md\`
- Review HTML: \`${options.episodeDir}/review.html\`
- Questions: \`${options.episodeDir}/reports/questions-for-denny.md\`

## Commands run

${options.commandsRun.map((entry) => `- \`${entry.command}\`: ${entry.result}`).join("\n")}

## What worked

- Fixture collection, normalization, verification labeling, ranking, episode planning, fallback card generation, QA, and handoff reporting completed.
- YouTube metadata defaults to private.
- Video-engine repo was inspected without mutating it.

## What used fixtures/mocks

${options.usedFixtures ? "- Story collection used deterministic fixture raw items.\n- Voice generation used a placeholder manifest.\n- Browser capture used generated fallback cards." : "- No fixtures were requested for this run."}

## What failed or is incomplete

- Live source collectors, live Playwright MCP capture, direct ElevenLabs voice generation, full renderer integration, and YouTube upload are adapter skeletons or policy-disabled in this slice.
- Existing video engine currently expects a screen-recording-first input folder, so this run used package-only integration.

## Questions for Denny

${renderQuestionsForDenny(options.questions).replace(/^# Questions for Denny\n\n/, "")}
## Credentials/config needed

- OPENAI_API_KEY or another LLM provider key for live script generation.
- ELEVENLABS_API_KEY and ELEVENLABS_VOICE_ID for real narration.
- YOUTUBE_CLIENT_ID, YOUTUBE_CLIENT_SECRET, YOUTUBE_REFRESH_TOKEN, and YOUTUBE_UPLOAD_ENABLED=true for private upload.
- Sandbox account details only for any logged-in browser demos.

## Rate limits encountered

None in fixture dry-run mode.

## Video-engine integration status

- Path: \`${options.videoEngine.path}\`
- Exists: ${options.videoEngine.exists}
- Package manager: ${options.videoEngine.packageManager ?? "unknown"}
- Package name: ${options.videoEngine.packageName ?? "unknown"}
- Adapter mode used: ${options.videoEngine.adapterMode}
- Env variable names detected: ${options.videoEngine.envNames.length ? options.videoEngine.envNames.join(", ") : "none"}
- Notes: ${options.videoEngine.notes.join(" ")}

## QA status

- Overall: ${options.qa.ok ? "pass" : "fail"}
${options.qa.checks.map((check) => `- ${check.pass ? "PASS" : "FAIL"} ${check.name}: ${check.detail}`).join("\n")}

## Next recommended command

\`\`\`bash
pnpm newsroom:dry-run
\`\`\`
`;
}
