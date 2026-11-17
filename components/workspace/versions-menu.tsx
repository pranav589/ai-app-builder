"use client"

import * as React from "react"
import { Clock, History, RotateCcw } from "lucide-react"

import { Button } from "@/components/ui/button"
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuGroup,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu"

type VersionRow = { version: number; intent: string | null; author: string | null; createdAt: string }

function relativeTime(iso: string) {
  const mins = Math.round((Date.now() - new Date(iso).getTime()) / 60000)
  if (mins < 1) return "just now"
  if (mins < 60) return `${mins}m ago`
  const hours = Math.round(mins / 60)
  if (hours < 24) return `${hours}h ago`
  return `${Math.round(hours / 24)}d ago`
}

/** Lists this project's versions and restores an earlier one on top (never rewrites history). */
export function VersionsMenu({ projectId, disabled }: { projectId: string; disabled?: boolean }) {
  const [loading, setLoading] = React.useState(false)
  const [error, setError] = React.useState<string | null>(null)
  const [current, setCurrent] = React.useState<number | null>(null)
  const [versions, setVersions] = React.useState<VersionRow[]>([])
  const [restoring, setRestoring] = React.useState<number | null>(null)

  const load = React.useCallback(async () => {
    setLoading(true)
    setError(null)
    try {
      const res = await fetch(`/api/projects/${projectId}/versions`)
      const data = await res.json()
      if (!res.ok) throw new Error(data?.error ?? "Couldn't load versions.")
      setCurrent(data.current)
      setVersions(data.versions)
    } catch (e) {
      setError(e instanceof Error ? e.message : "Couldn't load versions.")
    } finally {
      setLoading(false)
    }
  }, [projectId])

  const restore = async (version: number) => {
    setRestoring(version)
    setError(null)
    try {
      const res = await fetch(`/api/projects/${projectId}/versions/${version}/restore`, { method: "POST" })
      const data = await res.json()
      if (!res.ok) throw new Error(data?.error ?? "Couldn't restore that version.")
      window.location.reload()
    } catch (e) {
      setError(e instanceof Error ? e.message : "Couldn't restore that version.")
      setRestoring(null)
    }
  }

  return (
    <DropdownMenu onOpenChange={(open) => open && void load()}>
      <DropdownMenuTrigger
        render={
          <Button variant="outline" className="h-8 px-2.5 max-sm:w-8 max-sm:px-0" aria-label="Versions" disabled={disabled}>
            <History />
            <span className="hidden sm:inline">Versions</span>
          </Button>
        }
      />
      <DropdownMenuContent align="end" className="w-80">
        <DropdownMenuGroup>
          <DropdownMenuLabel>Versions</DropdownMenuLabel>
        </DropdownMenuGroup>
        <DropdownMenuSeparator />
        {loading && <div className="px-2 py-3 text-sm text-muted-foreground">Loading…</div>}
        {error && <div className="px-2 py-2 text-sm text-destructive">{error}</div>}
        {!loading && !error && !versions.length && <div className="px-2 py-3 text-sm text-muted-foreground">No versions yet.</div>}
        {!loading &&
          versions.map((v) => (
            <DropdownMenuItem key={v.version} closeOnClick={false} className="flex items-start justify-between gap-2 py-2">
              <div className="min-w-0">
                <p className="truncate text-sm font-medium">
                  Version {v.version} {v.version === current && <span className="text-xs font-normal text-muted-foreground">(current)</span>}
                </p>
                <p className="truncate text-xs text-muted-foreground">{v.intent || "—"}</p>
                <p className="flex items-center gap-1 text-xs text-muted-foreground">
                  <Clock className="size-3" /> {relativeTime(v.createdAt)}
                </p>
              </div>
              {v.version !== current && (
                <Button
                  size="sm"
                  variant="outline"
                  className="h-7 shrink-0 px-2 text-xs"
                  disabled={restoring !== null}
                  onClick={(e) => {
                    e.preventDefault()
                    e.stopPropagation()
                    void restore(v.version)
                  }}
                >
                  <RotateCcw /> {restoring === v.version ? "Restoring…" : "Restore"}
                </Button>
              )}
            </DropdownMenuItem>
          ))}
      </DropdownMenuContent>
    </DropdownMenu>
  )
}
