// Shared by the browser (early feedback) and the server (the real check).
export const MAX_PROMPT_LENGTH = 4000;
export const MAX_ASSETS = 8;
export const MAX_ASSET_BYTES = 10 * 1024 * 1024;
export const MAX_TOTAL_BYTES = 25 * 1024 * 1024;

export const ALLOWED_ASSET_TYPES: Record<string, string> = {
  "image/png": "png",
  "image/jpeg": "jpg",
  "image/webp": "webp",
  "image/gif": "gif",
  "application/pdf": "pdf",
  "text/plain": "txt",
  "text/markdown": "md",
  "application/json": "json",
  "text/csv": "csv",
};

export const ASSET_ACCEPT = Object.keys(ALLOWED_ASSET_TYPES).join(",") + ",.md";

export function formatBytes(bytes: number) {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(0)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

// Browsers report no MIME type for some files (e.g. .md); fall back to the extension.
const EXT_TYPES: Record<string, string> = { md: "text/markdown" };
export function resolveAssetType(name: string, reported: string) {
  if (reported in ALLOWED_ASSET_TYPES) return reported;
  const ext = name.split(".").pop()?.toLowerCase() ?? "";
  return !reported || reported === "application/octet-stream" ? EXT_TYPES[ext] : undefined;
}

export function validateAsset(file: { name: string; size: number; type: string }) {
  if (!resolveAssetType(file.name, file.type))
    return `${file.name}: this file type isn't supported (use images, PDF, text, Markdown, JSON or CSV)`;
  if (file.size === 0) return `${file.name}: the file is empty`;
  if (file.size > MAX_ASSET_BYTES)
    return `${file.name}: larger than ${formatBytes(MAX_ASSET_BYTES)}`;
  return undefined;
}
