export type MediaKind =
  | "video"
  | "interactive"
  | "iframe"
  | "gallery"
  | "image"
  | "text_evidence";

export interface MediaItem {
  readonly id: string;
  readonly kind: MediaKind;
  readonly source_url: string;
  readonly local_asset?: string;
  readonly decision: "selected" | "rejected";
  readonly rationale: string;
  readonly review_status: "inspected" | "watched" | "operated";
  readonly review_notes: string;
}

export interface MediaManifest {
  readonly schema_version: "0.1.0";
  readonly primary_url: string;
  readonly audit_complete: boolean;
  readonly items: readonly MediaItem[];
}

const requirePublicWebUrl = (value: string, label: string): void => {
  let parsed: URL;
  try {
    parsed = new URL(value);
  } catch {
    throw new Error(`${label} must be a valid URL`);
  }
  if (parsed.protocol !== "https:" && parsed.protocol !== "http:") {
    throw new Error(`${label} must use HTTP or HTTPS`);
  }
};

export function validateMediaManifest(manifest: MediaManifest): void {
  requirePublicWebUrl(manifest.primary_url, "Primary media URL");
  if (!manifest.audit_complete) {
    throw new Error("Primary-page media audit is incomplete");
  }

  const seen = new Set<string>();
  for (const item of manifest.items) {
    if (!item.id.trim()) throw new Error("Media item requires an id");
    if (seen.has(item.id)) throw new Error(`Duplicate media item: ${item.id}`);
    seen.add(item.id);
    requirePublicWebUrl(item.source_url, `Media item ${item.id} URL`);
    if (!item.rationale.trim()) {
      throw new Error(`Media item ${item.id} needs a decision rationale`);
    }
    if (!item.review_notes.trim()) {
      throw new Error(`Media item ${item.id} needs review notes`);
    }
    if (item.kind === "video" && item.review_status !== "watched") {
      throw new Error(`Media item ${item.id} is a video and must be watched before its decision`);
    }
    if (item.kind === "interactive" && item.review_status !== "operated") {
      throw new Error(`Media item ${item.id} is interactive and must be operated before its decision`);
    }
    if (
      item.kind === "iframe" &&
      item.review_status !== "watched" &&
      item.review_status !== "operated"
    ) {
      throw new Error(`Media item ${item.id} is an iframe and must be watched or operated before its decision`);
    }
    if (item.local_asset?.startsWith("/") || item.local_asset?.includes("..")) {
      throw new Error(`Media item ${item.id} local asset must be episode-relative`);
    }
  }
}
