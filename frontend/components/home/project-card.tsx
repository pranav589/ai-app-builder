"use client"

import Link from "next/link"
import * as React from "react"
import { useMutation, useQueryClient } from "@tanstack/react-query"
import {
  Check,
  Copy,
  Download,
  Globe,
  MoreVertical,
  Pencil,
  Share2,
  Trash2,
} from "lucide-react"

import { Badge } from "@/components/ui/badge"
import { Card, CardContent } from "@/components/ui/card"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Switch } from "@/components/ui/switch"
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu"
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogDescription,
} from "@/components/ui/dialog"
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog"
import { apiClient, getApiErrorMessage } from "@/lib/api-client"
import { statusLabel } from "@app/shared/project-status"
import { CardPreview } from "./card-preview"
import type { MyProject } from "./types"

function downloadExport(projectId: string) {
  const a = document.createElement("a")
  a.href = `/api/projects/${projectId}/export/zip`
  a.rel = "noopener"
  document.body.appendChild(a)
  a.click()
  a.remove()
}

function RenameDialog({ project, open, onOpenChange }: { project: MyProject; open: boolean; onOpenChange: (open: boolean) => void }) {
  const [name, setName] = React.useState(project.name)
  const queryClient = useQueryClient()
  React.useEffect(() => {
    if (open) setName(project.name)
  }, [open, project.name])

  const mutation = useMutation({
    mutationFn: async (nextName: string) => {
      await apiClient.patch(`/api/projects/${project.id}`, { name: nextName })
    },
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ["projects"] })
      onOpenChange(false)
    },
  })

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Rename project</DialogTitle>
        </DialogHeader>
        <Input
          value={name}
          onChange={(e) => setName(e.target.value)}
          maxLength={120}
          autoFocus
          onKeyDown={(e) => {
            if (e.key === "Enter" && name.trim()) mutation.mutate(name.trim())
          }}
        />
        {mutation.isError && <p className="text-sm text-destructive">{getApiErrorMessage(mutation.error)}</p>}
        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>
            Cancel
          </Button>
          <Button disabled={!name.trim() || mutation.isPending} onClick={() => mutation.mutate(name.trim())}>
            Save
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}

function ShareDialog({ project, open, onOpenChange }: { project: MyProject; open: boolean; onOpenChange: (open: boolean) => void }) {
  const queryClient = useQueryClient()
  const [copied, setCopied] = React.useState(false)

  const mutation = useMutation({
    mutationFn: async (isPublic: boolean) => {
      const res = await apiClient.patch<{ isPublic: boolean; publicSlug: string | null }>(
        `/api/projects/${project.id}/visibility`,
        { isPublic }
      )
      return res.data
    },
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ["projects"] })
    },
  })

  const isPublic = mutation.data?.isPublic ?? project.isPublic
  const publicSlug = mutation.data?.publicSlug ?? project.publicSlug
  const publicUrl = isPublic && publicSlug && typeof window !== "undefined" ? `${window.location.origin}/p/${publicSlug}` : null

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Share project</DialogTitle>
          <DialogDescription>
            Make this app visible on the homepage so signed-out visitors can try it, without being able to see your prompt, files, or data.
          </DialogDescription>
        </DialogHeader>

        <div className="flex items-center justify-between rounded-lg border border-border px-4 py-3">
          <span className="flex items-center gap-2 text-sm font-medium">
            <Globe className="size-4 text-muted-foreground" /> Public
          </span>
          <Switch checked={isPublic} disabled={mutation.isPending} onCheckedChange={(checked) => mutation.mutate(checked)} />
        </div>

        {publicUrl && (
          <div className="flex items-center gap-2 rounded-lg border border-border px-3 py-2">
            <span className="min-w-0 flex-1 truncate text-sm text-muted-foreground">{publicUrl}</span>
            <Button
              variant="ghost"
              size="icon-sm"
              onClick={() => {
                void navigator.clipboard.writeText(publicUrl).then(() => {
                  setCopied(true)
                  setTimeout(() => setCopied(false), 1500)
                })
              }}
            >
              {copied ? <Check className="text-emerald-600" /> : <Copy />}
            </Button>
          </div>
        )}

        {mutation.isError && <p className="text-sm text-destructive">{getApiErrorMessage(mutation.error)}</p>}
      </DialogContent>
    </Dialog>
  )
}

function DeleteAlert({ project, open, onOpenChange }: { project: MyProject; open: boolean; onOpenChange: (open: boolean) => void }) {
  const queryClient = useQueryClient()
  const mutation = useMutation({
    mutationFn: async () => {
      await apiClient.delete(`/api/projects/${project.id}`)
    },
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ["projects"] })
      onOpenChange(false)
    },
  })

  return (
    <AlertDialog open={open} onOpenChange={onOpenChange}>
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>Delete “{project.name}”?</AlertDialogTitle>
          <AlertDialogDescription>
            This permanently deletes the project, its chat history, and its generated app. This can&apos;t be undone.
          </AlertDialogDescription>
        </AlertDialogHeader>
        {mutation.isError && <p className="text-sm text-destructive">{getApiErrorMessage(mutation.error)}</p>}
        <AlertDialogFooter>
          <AlertDialogCancel disabled={mutation.isPending}>Cancel</AlertDialogCancel>
          <AlertDialogAction
            variant="destructive"
            disabled={mutation.isPending}
            onClick={(e) => {
              e.preventDefault()
              mutation.mutate()
            }}
          >
            Delete
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  )
}

function ProjectActions({ project }: { project: MyProject }) {
  const queryClient = useQueryClient()
  const [dialog, setDialog] = React.useState<"rename" | "share" | "delete" | null>(null)

  const duplicate = useMutation({
    mutationFn: async () => {
      await apiClient.post(`/api/projects/${project.id}/duplicate`)
    },
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ["projects"] })
    },
  })

  return (
    <>
      <DropdownMenu>
        <DropdownMenuTrigger
          render={
            <Button
              variant="ghost"
              size="icon-sm"
              className="absolute right-2.5 top-2.5 z-10 bg-background/80 backdrop-blur-sm"
              aria-label="Project actions"
              onClick={(e) => e.preventDefault()}
            >
              <MoreVertical />
            </Button>
          }
        />
        <DropdownMenuContent align="end" className="w-48">
          <DropdownMenuItem render={<Link href={`/workspace/${project.id}`} />}>Open project</DropdownMenuItem>
          <DropdownMenuItem onClick={() => setDialog("rename")}>
            <Pencil /> Rename
          </DropdownMenuItem>
          <DropdownMenuItem disabled={duplicate.isPending} onClick={() => duplicate.mutate()}>
            <Copy /> Duplicate
          </DropdownMenuItem>
          <DropdownMenuItem onClick={() => setDialog("share")}>
            <Share2 /> Share
          </DropdownMenuItem>
          <DropdownMenuItem onClick={() => downloadExport(project.id)}>
            <Download /> Export
          </DropdownMenuItem>
          <DropdownMenuSeparator />
          <DropdownMenuItem variant="destructive" onClick={() => setDialog("delete")}>
            <Trash2 /> Delete
          </DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>

      <RenameDialog project={project} open={dialog === "rename"} onOpenChange={(o) => setDialog(o ? "rename" : null)} />
      <ShareDialog project={project} open={dialog === "share"} onOpenChange={(o) => setDialog(o ? "share" : null)} />
      <DeleteAlert project={project} open={dialog === "delete"} onOpenChange={(o) => setDialog(o ? "delete" : null)} />
    </>
  )
}

export function ProjectCard({ project }: { project: MyProject }) {
  return (
    <Card className="group relative h-full gap-0 overflow-hidden rounded-3xl border border-border p-0 ring-0 transition-all duration-300 hover:-translate-y-1 hover:shadow-[0_24px_48px_-20px_rgba(17,17,17,0.2)]">
      <ProjectActions project={project} />
      <Link href={`/workspace/${project.id}`} className="block outline-none focus-visible:ring-3 focus-visible:ring-ring/50">
        <div className="relative">
          <CardPreview projectId={project.id} name={project.name} previewScreens={project.previewScreens} />
          <Badge variant="outline" className="absolute left-3 top-3 border-border bg-background text-foreground">
            {statusLabel(project.status)}
          </Badge>
          {project.isPublic && (
            <Badge variant="outline" className="absolute left-3 top-10 gap-1 border-border bg-background text-foreground">
              <Globe className="size-3" /> Public
            </Badge>
          )}
        </div>
        <CardContent className="px-5 py-4">
          <h3 className="truncate text-base font-medium tracking-tight">{project.name}</h3>
          <p className="mt-1 line-clamp-2 text-sm text-muted-foreground">{project.prompt}</p>
          <p className="mt-2 text-xs font-medium text-muted-foreground/80">
            {new Date(project.createdAt).toLocaleDateString("en-US", { dateStyle: "medium" })}
            {project.assetCount > 0 && ` · ${project.assetCount} ${project.assetCount === 1 ? "file" : "files"}`}
          </p>
        </CardContent>
      </Link>
    </Card>
  )
}
