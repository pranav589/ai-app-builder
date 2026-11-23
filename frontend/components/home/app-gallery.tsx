"use client"

import * as React from "react"
import { useQuery } from "@tanstack/react-query"
import { Plus, Sparkles } from "lucide-react"

import { useAuth } from "@/components/auth/auth-provider"
import { Card, CardContent } from "@/components/ui/card"
import { Button } from "@/components/ui/button"
import { Skeleton } from "@/components/ui/skeleton"
import { apiClient } from "@/lib/api-client"
import { ProjectCard } from "./project-card"
import { PublicProjectCard } from "./public-project-card"
import { PublicPreviewDialog } from "./public-preview-dialog"
import type { MyProject, PublicProject } from "./types"

function GallerySkeleton() {
  return (
    <div className="grid grid-cols-1 gap-6 sm:grid-cols-2 lg:grid-cols-3">
      {Array.from({ length: 6 }).map((_, i) => (
        <Card key={i} className="overflow-hidden p-0">
          <Skeleton className="h-52 w-full rounded-none" />
          <CardContent className="space-y-2 px-4 py-3.5">
            <Skeleton className="h-4 w-3/4" />
            <Skeleton className="h-3 w-full" />
          </CardContent>
        </Card>
      ))}
    </div>
  )
}

export function AppGallery() {
  const { user, isPending } = useAuth()
  const isSignedIn = Boolean(user)
  const [previewSlug, setPreviewSlug] = React.useState<string | null>(null)

  const projectsQuery = useQuery({
    queryKey: ["projects", user?.id],
    queryFn: async () => {
      const res = await apiClient.get<{ projects: MyProject[] }>("/api/projects")
      return res.data.projects
    },
    enabled: isSignedIn,
  })

  const publicQuery = useQuery({
    queryKey: ["public-projects"],
    queryFn: async () => {
      const res = await apiClient.get<{ projects: PublicProject[] }>("/api/public/projects")
      return res.data.projects
    },
    enabled: !isSignedIn,
  })

  const mine = !isSignedIn
    ? null
    : projectsQuery.isLoading || (projectsQuery.isFetching && !projectsQuery.data)
      ? null
      : (projectsQuery.data ?? (projectsQuery.isError ? [] : null))
  const loadFailed = isSignedIn && projectsQuery.isError

  if (isPending) {
    return (
      <section className="mx-auto max-w-7xl px-6 pb-24 lg:px-10">
        <GallerySkeleton />
      </section>
    )
  }

  if (isSignedIn) {
    return (
      <section className="mx-auto max-w-7xl px-6 pb-24 lg:px-10">
        <div className="mb-10 flex items-center justify-between">
          <h2 className="text-3xl font-medium tracking-[-0.03em]">Your projects</h2>
          <Button
            variant="outline"
            className="h-11 rounded-(--r-sm) px-6 text-base"
            onClick={() => {
              window.scrollTo({ top: 0, behavior: "smooth" })
              document.querySelector<HTMLTextAreaElement>("textarea")?.focus({ preventScroll: true })
            }}
          >
            <Plus /> New project
          </Button>
        </div>

        {mine === null ? (
          <GallerySkeleton />
        ) : loadFailed ? (
          <div className="flex flex-col items-center justify-center gap-3 rounded-(--r-lg) border border-dashed border-border py-16 text-center">
            <p className="text-sm font-medium">We couldn&apos;t load your projects</p>
            <Button variant="outline" className="h-11 rounded-(--r-sm) px-6 text-base" onClick={() => { void projectsQuery.refetch() }}>
              Try again
            </Button>
          </div>
        ) : mine.length === 0 ? (
          <div className="flex flex-col items-center justify-center gap-3 rounded-(--r-lg) border border-dashed border-border py-16 text-center">
            <div className="flex size-11 items-center justify-center rounded-full bg-(--surface) text-foreground">
              <Sparkles className="size-5" />
            </div>
            <p className="text-sm font-medium">You haven&apos;t built anything yet</p>
            <p className="max-w-sm text-sm text-muted-foreground">
              Describe an idea above and we&apos;ll turn it into a working app in minutes.
            </p>
          </div>
        ) : (
          <div className="grid grid-cols-1 gap-6 sm:grid-cols-2 lg:grid-cols-3">
            {mine.map((project) => (
              <ProjectCard key={project.id} project={project} />
            ))}
          </div>
        )}
      </section>
    )
  }

  const community = publicQuery.data ?? []

  return (
    <section id="community" className="mx-auto max-w-7xl px-6 pb-24 lg:px-10">
      <div className="mb-10 flex items-end justify-between">
        <div>
          <h2 className="text-3xl font-medium tracking-[-0.03em]">Built by the community</h2>
          <p className="mt-2 text-base text-muted-foreground">
            Real apps shipped by other builders — tap one to try it, then sign in to start your own.
          </p>
        </div>
      </div>

      {publicQuery.isLoading ? (
        <GallerySkeleton />
      ) : community.length === 0 ? (
        <div className="flex flex-col items-center justify-center gap-3 rounded-(--r-lg) border border-dashed border-border py-16 text-center">
          <div className="flex size-11 items-center justify-center rounded-full bg-(--surface) text-foreground">
            <Sparkles className="size-5" />
          </div>
          <p className="text-sm font-medium">No public apps yet</p>
          <p className="max-w-sm text-sm text-muted-foreground">Be the first to share something you&apos;ve built.</p>
        </div>
      ) : (
        <div className="grid grid-cols-1 gap-6 sm:grid-cols-2 lg:grid-cols-3">
          {community.map((app) => (
            <PublicProjectCard key={app.id} app={app} onPreview={setPreviewSlug} />
          ))}
        </div>
      )}

      <PublicPreviewDialog slug={previewSlug} onOpenChange={(open) => !open && setPreviewSlug(null)} />
    </section>
  )
}
