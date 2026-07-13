export const DEFAULT_CAPTURE_ALLOWLIST = [
  "openai.com",
  "platform.openai.com",
  "anthropic.com",
  "docs.anthropic.com",
  "blog.google",
  "ai.google.dev",
  "deepmind.google",
  "github.com",
  "huggingface.co",
  "mistral.ai",
  "ai.meta.com",
  "cursor.com",
  "replit.com",
  "perplexity.ai",
  "x.com",
  "reddit.com",
  "news.ycombinator.com"
];

export function isAllowedCaptureUrl(url: string, allowlist = DEFAULT_CAPTURE_ALLOWLIST): boolean {
  let hostname: string;
  try {
    const parsed = new URL(url);
    if (parsed.protocol !== "https:" && parsed.protocol !== "http:") return false;
    hostname = parsed.hostname.toLowerCase();
  } catch {
    return false;
  }

  return allowlist.some((domain) => hostname === domain || hostname.endsWith(`.${domain}`));
}
