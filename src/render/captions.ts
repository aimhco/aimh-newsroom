import type { ScriptFile } from "../types";

export function formatSrtTime(seconds: number): string {
  const safe = Math.max(0, seconds);
  const hours = Math.floor(safe / 3600);
  const minutes = Math.floor((safe % 3600) / 60);
  const wholeSeconds = Math.floor(safe % 60);
  const milliseconds = Math.round((safe - Math.floor(safe)) * 1000);
  const pad2 = (value: number) => String(value).padStart(2, "0");
  const pad3 = (value: number) => String(value).padStart(3, "0");
  return `${pad2(hours)}:${pad2(minutes)}:${pad2(wholeSeconds)},${pad3(milliseconds)}`;
}

export function buildCaptionsSrt(
  narration: ScriptFile["narration"],
  durationsSeconds: number[]
): string {
  let cursor = 0;
  const cues = narration.map((paragraph, index) => {
    const duration = durationsSeconds[index] ?? paragraph.estimated_seconds;
    const start = cursor;
    const end = cursor + duration;
    cursor = end;
    return [
      String(index + 1),
      `${formatSrtTime(start)} --> ${formatSrtTime(end)}`,
      paragraph.text,
      ""
    ].join("\n");
  });
  return `${cues.join("\n")}\n`;
}
