import { Resvg } from "@resvg/resvg-js";
import { basename } from "node:path";
import { writeFile } from "node:fs/promises";
import { ensureDir } from "../utils/fs";

const escapeXml = (value: string): string =>
  value.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");

function wrapWords(text: string, maxChars = 28): string[] {
  const words = text.split(/\s+/).filter(Boolean);
  const lines: string[] = [];
  let current = "";
  for (const word of words) {
    const next = current ? `${current} ${word}` : word;
    if (next.length > maxChars && current) {
      lines.push(current);
      current = word;
    } else {
      current = next;
    }
  }
  if (current) lines.push(current);
  return lines.slice(0, 4);
}

export async function generateFallbackCardPng(options: {
  outPath: string;
  title: string;
  label?: string;
}): Promise<void> {
  await ensureDir(options.outPath.split("/").slice(0, -1).join("/"));
  const lines = wrapWords(options.title);
  const label = options.label ?? "AIMH NEWSROOM";
  const textLines = lines
    .map(
      (line, index) =>
        `<text x="140" y="${360 + index * 88}" font-family="Arial, sans-serif" font-size="76" font-weight="800" fill="#f8f4e8">${escapeXml(line)}</text>`
    )
    .join("\n");
  const svg = `
<svg width="1920" height="1080" viewBox="0 0 1920 1080" xmlns="http://www.w3.org/2000/svg">
  <rect width="1920" height="1080" fill="#101820"/>
  <rect x="72" y="72" width="1776" height="936" rx="0" fill="#f8f4e8"/>
  <rect x="96" y="96" width="1728" height="888" fill="#101820"/>
  <rect x="96" y="96" width="1728" height="14" fill="#28d7a3"/>
  <circle cx="1650" cy="210" r="70" fill="#ffcc33"/>
  <rect x="96" y="170" width="620" height="66" fill="#28d7a3"/>
  <text x="128" y="215" font-family="Arial, sans-serif" font-size="34" font-weight="700" fill="#101820">${escapeXml(label)}</text>
  ${textLines}
  <text x="140" y="912" font-family="Arial, sans-serif" font-size="30" font-weight="400" fill="#a7b3b0">Fallback visual generated for ${escapeXml(basename(options.outPath))}</text>
</svg>`;

  try {
    const png = new Resvg(svg).render().asPng();
    await writeFile(options.outPath, png);
  } catch {
    await writeFile(options.outPath, svg, "utf8");
  }
}
