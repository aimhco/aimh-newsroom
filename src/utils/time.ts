export function episodeIdForDate(date: string): string {
  return `${date}-daily-ai-briefing`;
}

export function nowIso(): string {
  return new Date().toISOString();
}

export function accessedAtForDate(date: string): string {
  return `${date}T09:00:00-04:00`;
}
