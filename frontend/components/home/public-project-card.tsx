"use client"

import { Card, CardContent } from "@/components/ui/card"
import { CardPreview } from "./card-preview"
import type { PublicProject } from "./types"

export function PublicProjectCard({ app, onPreview }: { app: PublicProject; onPreview: (slug: string) => void }) {
  return (
    <Card
      role="button"
      tabIndex={0}
      onClick={() => onPreview(app.publicSlug)}
      onKeyDown={(e) => {
        if (e.key === "Enter" || e.key === " ") onPreview(app.publicSlug)
      }}
      className="group cursor-pointer gap-0 overflow-hidden rounded-3xl border border-border p-0 ring-0 outline-none transition-all duration-300 hover:-translate-y-1 hover:shadow-[0_24px_48px_-20px_rgba(17,17,17,0.2)] focus-visible:ring-3 focus-visible:ring-ring/50"
    >
      <CardPreview projectId={app.id} name={app.name} previewScreens={app.previewScreens} />
      <CardContent className="px-5 py-4">
        <h3 className="truncate text-base font-medium tracking-tight">{app.name}</h3>
        {app.tagline && <p className="mt-1 line-clamp-2 text-sm text-muted-foreground">{app.tagline}</p>}
      </CardContent>
    </Card>
  )
}
