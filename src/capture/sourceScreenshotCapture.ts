import { mkdir } from "node:fs/promises";
import { dirname, join } from "node:path";
import type { Browser, Page } from "playwright";
import { isAllowedCaptureUrl } from "../config/allowlist";
import type { EpisodePackage, SourceType } from "../types";
import { ensureDir, writeJson } from "../utils/fs";

export interface CaptureTarget {
  shotId: string;
  url: string;
  outPath: string;
  assetPath: string;
}

export interface CaptureResult extends CaptureTarget {
  ok: boolean;
  error?: string;
}

export interface CaptureSummary {
  attempted: number;
  captured: number;
  failed: number;
  skipped: number;
  results: CaptureResult[];
}

const CAPTURABLE_SOURCE_TYPES = new Set<SourceType>(["official", "repo", "model", "news", "trend", "other"]);
const BLOCKED_PAGE_PATTERNS = [
  /cloudflare/i,
  /verifying/i,
  /captcha/i,
  /checking your browser/i,
  /just a moment/i,
  /access denied/i,
  /enable javascript/i
];

function sourceTypeForUrl(pkg: EpisodePackage, url: string): SourceType | undefined {
  return pkg.sources.sources.find((source) => source.url === url)?.source_type;
}

export function buildCaptureTargets(episodeDir: string, pkg: EpisodePackage): CaptureTarget[] {
  const seen = new Set<string>();
  const targets: CaptureTarget[] = [];

  for (const shot of pkg.shotlist.shots) {
    if (!shot.source_url) continue;
    if (!isAllowedCaptureUrl(shot.source_url)) continue;
    const sourceType = sourceTypeForUrl(pkg, shot.source_url);
    if (sourceType && !CAPTURABLE_SOURCE_TYPES.has(sourceType)) continue;
    if (seen.has(shot.id)) continue;
    seen.add(shot.id);
    const assetPath = `assets/screenshots/${shot.id}.png`;
    targets.push({
      shotId: shot.id,
      url: shot.source_url,
      outPath: join(episodeDir, assetPath),
      assetPath
    });
  }

  return targets;
}

export function applyCaptureResults(pkg: EpisodePackage, results: CaptureResult[]): CaptureSummary {
  let captured = 0;
  let failed = 0;

  for (const result of results) {
    const shot = pkg.shotlist.shots.find((candidate) => candidate.id === result.shotId);
    if (!shot) continue;
    if (result.ok) {
      shot.asset_path = result.assetPath;
      shot.status = "captured";
      captured += 1;
    } else {
      shot.status = shot.asset_path ? "fallback_generated" : "failed";
      failed += 1;
    }
  }

  return {
    attempted: results.length,
    captured,
    failed,
    skipped: Math.max(0, pkg.shotlist.shots.length - results.length),
    results
  };
}

export function isBlockedCapturePage(title: string, bodyText: string): boolean {
  const combined = `${title}\n${bodyText}`;
  return BLOCKED_PAGE_PATTERNS.some((pattern) => pattern.test(combined));
}

async function preparePage(page: Page, url: string): Promise<void> {
  await page.setViewportSize({ width: 1440, height: 1200 });
  await page.goto(url, { waitUntil: "domcontentloaded", timeout: 25_000 });
  await page.waitForTimeout(1_500);
}

async function captureOne(browser: Browser, target: CaptureTarget): Promise<CaptureResult> {
  const page = await browser.newPage();
  try {
    await preparePage(page, target.url);
    const title = await page.title().catch(() => "");
    const bodyText = await page.locator("body").innerText({ timeout: 2_000 }).catch(() => "");
    if (isBlockedCapturePage(title, bodyText)) {
      return { ...target, ok: false, error: "blocked_or_challenge_page" };
    }
    await mkdir(dirname(target.outPath), { recursive: true });
    await page.screenshot({ path: target.outPath, fullPage: false });
    return { ...target, ok: true };
  } catch (error) {
    return { ...target, ok: false, error: (error as Error).message };
  } finally {
    await page.close().catch(() => undefined);
  }
}

export async function captureSourceScreenshots(options: {
  episodeDir: string;
  package: EpisodePackage;
  headless?: boolean;
  launchBrowser?: () => Promise<Browser>;
}): Promise<CaptureSummary> {
  const targets = buildCaptureTargets(options.episodeDir, options.package);
  await ensureDir(join(options.episodeDir, "assets", "screenshots"));

  if (!targets.length) {
    const summary: CaptureSummary = { attempted: 0, captured: 0, failed: 0, skipped: options.package.shotlist.shots.length, results: [] };
    await writeJson(join(options.episodeDir, "reports", "capture-summary.json"), summary);
    return summary;
  }

  const launchBrowser =
    options.launchBrowser ??
    (async () => {
      const { chromium } = await import("playwright");
      return await chromium.launch({ headless: options.headless ?? true });
    });

  let browser: Browser;
  try {
    browser = await launchBrowser();
  } catch (error) {
    const results = targets.map((target): CaptureResult => ({ ...target, ok: false, error: (error as Error).message }));
    const summary = applyCaptureResults(options.package, results);
    await writeJson(join(options.episodeDir, "reports", "capture-summary.json"), summary);
    return summary;
  }

  try {
    const results: CaptureResult[] = [];
    for (const target of targets) {
      results.push(await captureOne(browser, target));
    }
    const summary = applyCaptureResults(options.package, results);
    await writeJson(join(options.episodeDir, "reports", "capture-summary.json"), summary);
    return summary;
  } finally {
    await browser.close();
  }
}
