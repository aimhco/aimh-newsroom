import { staticFile } from "remotion";

export const resolveEvidenceAssetUrl = (assetPath: string): string => {
  const segments = assetPath.split("/");
  if (
    !assetPath ||
    assetPath.startsWith("/") ||
    assetPath.includes("\\") ||
    segments.some((segment) => segment === "." || segment === "..")
  ) {
    throw new Error("Evidence asset path must be relative");
  }
  return staticFile(assetPath);
};
