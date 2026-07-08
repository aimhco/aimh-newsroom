export interface SecretFinding {
  pattern: string;
  snippet: string;
}

const SNIPPET_MAX = 72;

const SECRET_PATTERNS: Array<{ name: string; regex: RegExp }> = [
  {
    name: "key-assignment",
    regex:
      /\b[A-Z0-9_]*(?:API[_-]?KEY|SECRET|ACCESS[_-]?KEY|AUTH[_-]?TOKEN|TOKEN|PASSWORD|PASSWD|PRIVATE[_-]?KEY|CLIENT_SECRET|REFRESH_TOKEN)[A-Z0-9_]*\s*=\s*(?:"[^"\s]+"|'[^'\s]+'|\S+)/gi
  },
  { name: "openai-stripe-key", regex: /\bsk-[A-Za-z0-9]{8,}\b/g },
  { name: "google-api-key", regex: /\bAIza[A-Za-z0-9_-]{12,}\b/g },
  { name: "bearer-token", regex: /\bBearer\s+[A-Za-z0-9._-]{8,}/gi },
  { name: "github-token", regex: /\bgh[pousr]_[A-Za-z0-9]{16,}\b/g },
  { name: "slack-token", regex: /\bxox[baprs]-[A-Za-z0-9-]{10,}/g },
  { name: "private-key-block", regex: /-----BEGIN [A-Z ]*PRIVATE KEY-----/g }
];

const truncate = (value: string): string =>
  value.length > SNIPPET_MAX ? `${value.slice(0, SNIPPET_MAX - 1)}...` : value;

export function scanTextForSecretLeaks(text: string): SecretFinding[] {
  const findings: SecretFinding[] = [];
  for (const { name, regex } of SECRET_PATTERNS) {
    for (const match of text.matchAll(regex)) {
      findings.push({ pattern: name, snippet: truncate(match[0] ?? "") });
    }
  }
  return findings;
}

export function redactText(text: string, knownSecretValues: string[] = []): string {
  let redacted = text;

  redacted = redacted.replace(
    /\b([A-Z0-9_]*(?:API[_-]?KEY|SECRET|ACCESS[_-]?KEY|AUTH[_-]?TOKEN|TOKEN|PASSWORD|PASSWD|PRIVATE[_-]?KEY|CLIENT_SECRET|REFRESH_TOKEN)[A-Z0-9_]*)\s*=\s*(?:"[^"\s]+"|'[^'\s]+'|\S+)/gi,
    "$1=***"
  );
  redacted = redacted.replace(/\bBearer\s+[A-Za-z0-9._-]{8,}/gi, "Bearer ***");
  redacted = redacted.replace(/\bsk-[A-Za-z0-9]{8,}\b/g, "sk-***");
  redacted = redacted.replace(/\bAIza[A-Za-z0-9_-]{12,}\b/g, "AIza***");
  redacted = redacted.replace(/\bgh[pousr]_[A-Za-z0-9]{16,}\b/g, "gh_***");
  redacted = redacted.replace(/\bxox[baprs]-[A-Za-z0-9-]{10,}/g, "xox-***");

  for (const secret of knownSecretValues.filter((value) => value.length >= 6)) {
    redacted = redacted.split(secret).join("***");
  }

  return redacted;
}
