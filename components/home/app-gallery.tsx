"use client"

import Link from "next/link"
import * as React from "react"
import {
  Activity,
  BookOpen,
  ChefHat,
  Luggage,
  Plus,
  Receipt,
  Repeat,
  Sparkles,
  type LucideIcon,
} from "lucide-react"

import { useAuth } from "@/components/auth/auth-provider"
import { statusLabel } from "@/lib/project-status"
import { Badge } from "@/components/ui/badge"
import { Card, CardContent } from "@/components/ui/card"
import { Button } from "@/components/ui/button"
import { Skeleton } from "@/components/ui/skeleton"

type GalleryApp = {
  id: string
  title: string
  description: string
  author?: string
  icon: LucideIcon
  tag: string
}

const COMMUNITY_APPS: GalleryApp[] = [
  {
    id: "1",
    title: "Pulse",
    description: "Log workouts and visualize weekly progress trends.",
    author: "Mia Chen",
    icon: Activity,
    tag: "Health",
  },
  {
    id: "2",
    title: "Nomad",
    description: "Collaborative itineraries with maps and budgets.",
    author: "Theo Russo",
    icon: Luggage,
    tag: "Travel",
  },
  {
    id: "3",
    title: "Ledger",
    description: "Split bills with friends and settle up instantly.",
    author: "Priya Nair",
    icon: Receipt,
    tag: "Finance",
  },
  {
    id: "4",
    title: "Brew",
    description: "Save recipes and auto-generate grocery lists.",
    author: "Jordan Lee",
    icon: ChefHat,
    tag: "Food",
  },
  {
    id: "5",
    title: "Flock",
    description: "Find local book clubs and track reading progress.",
    author: "Sam Walker",
    icon: BookOpen,
    tag: "Social",
  },
  {
    id: "6",
    title: "Nest",
    description: "Build streaks with gentle daily reminders.",
    author: "Alex Kim",
    icon: Repeat,
    tag: "Productivity",
  },
]

type MyProject = {
  id: string
  name: string
  prompt: string | null
  status: string | null
  assetCount: number
  createdAt: string
}

function ProjectCard({ project }: { project: MyProject }) {
  return (
    <Link href={`/workspace/${project.id}`} className="block rounded-3xl outline-none focus-visible:ring-3 focus-visible:ring-ring/50">
      <Card className="group h-full cursor-pointer gap-0 overflow-hidden rounded-3xl border border-border p-0 ring-0 transition-all duration-300 hover:-translate-y-1 hover:shadow-[0_24px_48px_-20px_rgba(17,17,17,0.2)]">
        <div className="relative">
          <AppPreview icon={Sparkles} />
          <Badge variant="outline" className="absolute left-3 top-3 border-border bg-background text-foreground">
            {statusLabel(project.status)}
          </Badge>
        </div>
        <CardContent className="px-5 py-4">
          <h3 className="truncate text-base font-medium tracking-tight">{project.name}</h3>
          <p className="mt-1 line-clamp-2 text-sm text-muted-foreground">{project.prompt}</p>
          <p className="mt-2 text-xs font-medium text-muted-foreground/80">
            {new Date(project.createdAt).toLocaleDateString("en-US", { dateStyle: "medium" })}
            {project.assetCount > 0 && ` · ${project.assetCount} ${project.assetCount === 1 ? "file" : "files"}`}
          </p>
        </CardContent>
      </Card>
    </Link>
  )
}

function AppPreview({ icon: Icon }: { icon: LucideIcon }) {
  return (
    <div className="relative flex h-52 items-end justify-center overflow-hidden bg-(--surface) bg-[radial-gradient(ellipse_80%_70%_at_50%_0%,color-mix(in_oklch,var(--action),transparent_92%),transparent)]">
      <div className="w-36 translate-y-4 rounded-t-3xl border border-b-0 border-border bg-background p-3 pb-10 shadow-[0_-8px_30px_-12px_rgba(17,17,17,0.2)] transition-transform duration-300 group-hover:-translate-y-0">
        <div className="mx-auto mb-3 h-1 w-10 rounded-full bg-foreground/10" />
        <div className="flex items-center gap-2">
          <span className="flex size-8 items-center justify-center rounded-xl bg-primary text-primary-foreground">
            <Icon className="size-4" />
          </span>
          <div className="space-y-1.5">
            <div className="h-1.5 w-14 rounded-full bg-foreground/15" />
            <div className="h-1.5 w-9 rounded-full bg-foreground/8" />
          </div>
        </div>
        <div className="mt-3 h-12 rounded-xl bg-(--surface)" />
        <div className="mt-2 h-2 w-full rounded-full bg-(--surface)" />
        <div className="mt-2 h-2 w-2/3 rounded-full bg-(--surface)" />
      </div>
    </div>
  )
}

function GalleryCard({ app }: { app: GalleryApp }) {
  return (
    <Card className="group cursor-pointer gap-0 overflow-hidden rounded-3xl p-0 ring-0 border border-border transition-all duration-300 hover:-translate-y-1 hover:shadow-[0_24px_48px_-20px_rgba(17,17,17,0.2)]">
      <div className="relative">
        <AppPreview icon={app.icon} />
        <Badge variant="outline" className="absolute left-3 top-3 border-border bg-background text-foreground">
          {app.tag}
        </Badge>
      </div>
      <CardContent className="px-5 py-4">
        <h3 className="truncate text-base font-medium tracking-tight">{app.title}</h3>
        <p className="mt-1 line-clamp-2 text-sm text-muted-foreground">{app.description}</p>
        {app.author && (
          <p className="mt-2 text-xs font-medium text-muted-foreground/80">by {app.author}</p>
        )}
      </CardContent>
    </Card>
  )
}

function GallerySkeleton() {
  return (
    <div className="grid grid-cols-1 gap-6 sm:grid-cols-2 lg:grid-cols-3">
      {Array.from({ length: 6 }).map((_, i) => (
        <Card key={i} className="overflow-hidden p-0">
          <Skeleton className="h-36 w-full rounded-none" />
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
  const [mine, setMine] = React.useState<MyProject[] | null>(null)
  const [loadFailed, setLoadFailed] = React.useState(false)
  const [reloadKey, setReloadKey] = React.useState(0)

  React.useEffect(() => {
    if (!user) {
      setMine(null)
      return
    }
    let cancelled = false
    setLoadFailed(false)
    fetch("/api/projects", { cache: "no-store" })
      .then((r) => {
        if (!r.ok) throw new Error("load failed")
        return r.json()
      })
      .then((d) => !cancelled && setMine(d.projects))
      .catch(() => !cancelled && (setMine([]), setLoadFailed(true)))
    return () => {
      cancelled = true
    }
  }, [user, reloadKey])

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
            <Button variant="outline" className="h-11 rounded-(--r-sm) px-6 text-base" onClick={() => { setMine(null); setReloadKey((k) => k + 1) }}>
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

  return (
    <section id="community" className="mx-auto max-w-7xl px-6 pb-24 lg:px-10">
      <div className="mb-10 flex items-end justify-between">
        <div>
          <h2 className="text-3xl font-medium tracking-[-0.03em]">Built by the community</h2>
          <p className="mt-2 text-base text-muted-foreground">
            Real apps shipped by other builders — sign in to start your own.
          </p>
        </div>
      </div>

      <div className="grid grid-cols-1 gap-6 sm:grid-cols-2 lg:grid-cols-3">
        {COMMUNITY_APPS.map((app) => (
          <GalleryCard key={app.id} app={app} />
        ))}
      </div>
    </section>
  )
}
