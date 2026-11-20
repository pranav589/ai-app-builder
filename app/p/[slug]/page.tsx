import { notFound } from "next/navigation"
import Link from "next/link"

import { getPublicProjectBySlug } from "@/db/projects"
import { readAppDoc } from "@/lib/app-runtime/app-doc"
import { SiteHeader } from "@/components/home/site-header"
import { Button } from "@/components/ui/button"
import { PublicAppPlayer, type PublicProjectPayload } from "@/components/home/public-app-player"

export const dynamic = "force-dynamic"

async function loadPublicProject(slug: string): Promise<PublicProjectPayload | null> {
  const project = await getPublicProjectBySlug(slug)
  if (!project) return null
  const doc = readAppDoc(project.previewScreens)
  return {
    id: project.id,
    name: project.name,
    themeColor: project.themeColor,
    screens: doc.screens,
    themes: doc.themes ?? null,
    dataModel: doc.data ?? null,
    files: doc.files ?? {},
  }
}

export async function generateMetadata({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params
  const data = await loadPublicProject(slug)
  return { title: data ? `${data.name} — Anything` : "App preview — Anything" }
}

export default async function PublicAppPage({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params
  const data = await loadPublicProject(slug)
  if (!data) notFound()

  return (
    <div className="min-h-screen bg-background">
      <SiteHeader />
      <section className="mx-auto flex max-w-5xl flex-col items-center gap-8 px-6 py-16 text-center lg:px-10">
        <div>
          <h1 className="text-3xl font-medium tracking-[-0.03em]">{data.name}</h1>
          <p className="mt-2 text-base text-muted-foreground">
            Try it out below — this is a live, interactive preview.
          </p>
        </div>

        <PublicAppPlayer data={data} className="h-[700px] w-[340px]" />

        <div>
          <p className="mb-3 text-sm text-muted-foreground">Want to build something like this?</p>
          <Button className="h-11 rounded-(--r-sm) px-6 text-base" nativeButton={false} render={<Link href="/">Start building for free</Link>} />
        </div>
      </section>
    </div>
  )
}
