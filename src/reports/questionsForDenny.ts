import type { QuestionForDenny } from "../types";

export function renderQuestionsForDenny(questions: QuestionForDenny[]): string {
  if (!questions.length) return "# Questions for Denny\n\nNo open questions.\n";
  return [
    "# Questions for Denny",
    "",
    ...questions.flatMap((question, index) => [
      `## Question ${String(index + 1).padStart(3, "0")}: ${question.title}`,
      "",
      `- Needed for: ${question.neededFor}`,
      `- Default used overnight: ${question.defaultUsed}`,
      `- Impact: ${question.impact}`,
      `- To resolve: ${question.toResolve}`,
      `- Pipeline command to resume: \`${question.resumeCommand}\``,
      ""
    ])
  ].join("\n");
}
