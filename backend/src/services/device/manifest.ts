// Builds the Expo Updates manifest (docs.expo.dev/technical-specs/expo-updates-1) Expo Go
// expects from the public GET /api/device/[projectId]/manifest route, from a ready build's
// S3 output (lib/device/build.ts). Modeled on Expo's own reference implementation
// (github.com/expo/custom-expo-updates-server) and @expo/cli's ExpoGoManifestHandlerMiddleware,
// with one deliberate difference found by this project's own real-device POC: a fresh `id` and
// `createdAt` on every response, always -- Expo Go stores manifests in SQLite with
// UNIQUE(scope_key, commit_time) and crashes (SQLiteConstraintException) on a repeat of the
// same pair, which a content-derived id (the reference server's approach) would risk on a
// second launch of the same build.

import { randomUUID } from "node:crypto"
import path from "node:path"
import FormData from "form-data"

import { slug as slugify } from "@app/shared/app-project/scaffold"
import { SDK_RUNTIME_VERSION, SDK_VERSION } from "@/lib/device/export"
import { getObjectText, signedDownloadUrl } from "@/lib/storage"

export type DeviceManifestPlatform = "ios" | "android"

type ExportMetadata = {
  fileMetadata: Partial<Record<DeviceManifestPlatform, { bundle: string; assets: { path: string; ext: string }[] }>>
}

const ASSET_CONTENT_TYPE: Record<string, string> = {
  png: "image/png",
  jpg: "image/jpeg",
  jpeg: "image/jpeg",
  gif: "image/gif",
  webp: "image/webp",
  ttf: "font/ttf",
  otf: "font/otf",
  xml: "application/xml",
  json: "application/json",
}

const SIGNED_URL_TTL_SECONDS = 3600

function assetKey(assetPath: string): string {
  return assetPath.split(/[\\/]/).pop()!
}

/** null when this build's export didn't include `platform` (shouldn't happen -- the build always exports "all"). */
export async function buildDeviceManifest(opts: {
  s3Prefix: string
  platform: DeviceManifestPlatform
  projectId: string
  projectName: string
}): Promise<{ contentType: string; body: Buffer } | null> {
  const { s3Prefix, platform, projectId, projectName } = opts

  const [metadataText, appJsonText, hashesText] = await Promise.all([
    getObjectText(`${s3Prefix}metadata.json`),
    getObjectText(`${s3Prefix}app.json`),
    getObjectText(`${s3Prefix}hashes.json`),
  ])
  const metadata: ExportMetadata = JSON.parse(metadataText)
  const hashes: Record<string, string> = JSON.parse(hashesText)
  const fileMeta = metadata.fileMetadata[platform]
  if (!fileMeta) return null

  const appJson = JSON.parse(appJsonText)
  // Metro fills `sdkVersion` in via @expo/config's full resolution (from the installed `expo`
  // package version); raw app.json never has it, since modern apps use `runtimeVersion` instead.
  // Expo Go's native side still requires the field to be present on this older manifest shape.
  const expoClient = { sdkVersion: SDK_VERSION, ...(appJson.expo ?? appJson) }
  const slug = expoClient.slug ?? slugify(projectName)

  const bundleRelKey = fileMeta.bundle.split("\\").join("/")
  const [launchAssetUrl, assets] = await Promise.all([
    signedDownloadUrl(s3Prefix + bundleRelKey, SIGNED_URL_TTL_SECONDS),
    Promise.all(
      fileMeta.assets.map(async (a) => {
        const relKey = a.path.split("\\").join("/")
        return {
          key: assetKey(a.path),
          contentType: ASSET_CONTENT_TYPE[a.ext] ?? "application/octet-stream",
          url: await signedDownloadUrl(s3Prefix + relKey, SIGNED_URL_TTL_SECONDS),
          hash: hashes[relKey],
          // Optional in the spec, but Expo's reference server always sends it: the client names
          // the downloaded file key + fileExtension, and a font saved without ".ttf" never loads
          // (icons rendered blank with no error).
          fileExtension: `.${a.ext}`,
        }
      })
    ),
  ])

  const manifest = {
    id: randomUUID(),
    createdAt: new Date().toISOString(),
    runtimeVersion: SDK_RUNTIME_VERSION,
    // Not Metro's fixed "bundle": Expo Go caches downloaded assets by key and skips the download
    // when it already has that key, so a fixed key made it run whichever bundle it fetched first
    // (another project's, or a stale build). expo export's filename embeds a content hash.
    launchAsset: {
      key: path.posix.basename(bundleRelKey, path.posix.extname(bundleRelKey)),
      contentType: "application/javascript",
      url: launchAssetUrl,
      hash: hashes[bundleRelKey],
    },
    assets,
    metadata: {},
    extra: {
      expoClient,
      // Stable across rebuilds of the same project, so Expo Go's "recently opened" list treats
      // repeat builds as the same app rather than creating a new entry each time.
      scopeKey: `@anonymous/${slug}-${projectId}`,
    },
  }

  return encodeManifestMultipart(manifest)
}

function encodeManifestMultipart(manifest: unknown): { contentType: string; body: Buffer } {
  const form = new FormData()
  form.append("manifest", JSON.stringify(manifest), { contentType: "application/json" })
  form.append("extensions", JSON.stringify({ assetRequestHeaders: {} }), { contentType: "application/json" })
  const boundary = form.getBoundary()
  return { contentType: `multipart/mixed; boundary=${boundary}`, body: form.getBuffer() }
}
