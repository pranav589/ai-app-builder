import { eq } from "drizzle-orm"

import { db, deviceBuilds, projects } from "@/db"
import { buildDeviceManifest, type DeviceManifestPlatform } from "@/lib/device/manifest"

export const runtime = "nodejs"

/**
 * Public, unauthenticated: what the QR in "Test on your phone"
 * (components/workspace/expo-qr.tsx) encodes as `exp://<host>/api/device/<projectId>/manifest`.
 * Expo Go fetches this directly -- it can't send an auth header -- so this only ever reads
 * the project's latest *built* output (lib/device/build.ts), never live source. 404s (not an
 * error manifest) whenever there's nothing ready to serve yet; Expo Go's own error screen for
 * a failed fetch is enough, no need to speak the protocol just to say "not built yet".
 */
function parsePlatform(req: Request): DeviceManifestPlatform {
  const header = (req.headers.get("expo-platform") ?? req.headers.get("exponent-platform") ?? "").toLowerCase()
  return header === "ios" ? "ios" : "android"
}

export async function GET(req: Request, { params }: { params: Promise<{ projectId: string }> }) {
  const { projectId } = await params

  const [project] = await db.select({ id: projects.id, name: projects.name }).from(projects).where(eq(projects.id, projectId)).limit(1)
  if (!project) return new Response("Not found.", { status: 404 })

  const [build] = await db.select().from(deviceBuilds).where(eq(deviceBuilds.projectId, projectId)).limit(1)
  if (!build || build.status !== "ready" || !build.s3Prefix) {
    return new Response("This app hasn't been built for phone preview yet.", { status: 404 })
  }

  const platform = parsePlatform(req)
  const manifest = await buildDeviceManifest({
    s3Prefix: build.s3Prefix,
    platform,
    projectId: project.id,
    projectName: project.name,
  })
  if (!manifest) return new Response(`This build has no ${platform} export.`, { status: 404 })

  return new Response(new Uint8Array(manifest.body), {
    status: 200,
    headers: {
      "expo-protocol-version": "0",
      "expo-sfv-version": "0",
      "cache-control": "private, max-age=0",
      "content-type": manifest.contentType,
    },
  })
}
