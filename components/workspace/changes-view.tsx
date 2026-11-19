"use client"

import * as React from "react"
import { useQuery } from "@tanstack/react-query"
import { ChevronDown, FilePlus, FileMinus, FilePen } from "lucide-react"
import { cn } from "cn"

import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu"
import { apiClient, getApiErrorMessage } from "@/lib/api-client"

type DiffLine = { type: "context" | "add" | "remove"; line: string }
type FileDiff = { path: string; status: "added" | "removed" | "modified"; lines: DiffLine[] }
type VersionRow = { version: number; intent: string | null; createdAt: string }

const STATUS_ICON: Record<FileDiff["status"], typeof FilePlus> = { added: FilePlus, removed: FileMinus, modified: FilePen }
const STATUS_LABEL: Record<FileDiff["status"], string> = { added: "Added", removed: "Removed", modified: "Modified" }

function DiffFile({ file }: { file: FileDiff }) {
  const Icon = STATUS_ICON[file.status]
  return (
    <div className="overflow-hidden rounded-(--r-md) border border-border">
      <div className="flex items-center gap-2 border-b border-border bg-muted/40 px-3 py-1.5">
        <Icon className="size-3.5 shrink-0 text-muted-foreground" />
        <span className="min-w-0 flex-1 truncate font-mono text-xs">{file.path}</span>
        <span className="shrink-0 text-[11px] font-medium text-muted-foreground">{STATUS_LABEL[file.status]}</span>
      </div>
      <div className="overflow-x-auto bg-background font-mono text-[12.5px] leading-5">
        {file.lines.map((l, i) => (
          <div
            key={i}
            className={cn(
              "flex gap-2 px-3 whitespace-pre",
              l.type === "add" && "bg-green-500/10",
              l.type === "remove" && "bg-destructive/10",
              l.line === "…" && "text-muted-foreground italic"
            )}
          >
            <span className="w-3 shrink-0 select-none text-muted-foreground">{l.type === "add" ? "+" : l.type === "remove" ? "-" : ""}</span>
            <span className="min-w-0 flex-1">{l.line || " "}</span>
          </div>
        ))}
      </div>
    </div>
  )
}

/** What changed in a version, against the one it was committed on top of (Phase 9). */
export function ChangesView({ projectId }: { projectId: string }) {
  const [selectedVersion, setSelectedVersion] = React.useState<number | null>(null)

  const versionsQuery = useQuery({
    queryKey: ["project-versions", projectId],
    queryFn: async () => {
      const res = await apiClient.get<{ versions: VersionRow[]; current: number | null }>(
        `/api/projects/${projectId}/versions`
      )
      return res.data
    },
  })

  const versions = versionsQuery.data?.versions ?? []
  const currentVersion = versionsQuery.data?.current ?? null
  const version = selectedVersion ?? currentVersion

  const diffQuery = useQuery({
    queryKey: ["version-diff", projectId, version],
    queryFn: async () => {
      const res = await apiClient.get<{ files?: FileDiff[]; intent?: string | null; error?: string }>(
        `/api/projects/${projectId}/versions/${version}/diff`
      )
      if (res.data.error) throw new Error(res.data.error)
      return res.data
    },
    enabled: version !== null,
  })

  const files = diffQuery.data?.files ?? null
  const intent = diffQuery.data?.intent ?? null
  const error = diffQuery.isError ? getApiErrorMessage(diffQuery.error, "Couldn't load that version's changes.") : null
  const loading = diffQuery.isLoading

  const setVersion = (v: number) => setSelectedVersion(v)

  return (
    <div className="flex h-full min-h-0 flex-col">
      <div className="flex h-10 shrink-0 items-center gap-2 border-b border-border px-3">
        <DropdownMenu>
          <DropdownMenuTrigger
            render={
              <button
                type="button"
                className="flex h-7 items-center gap-1.5 rounded-md border border-border bg-background px-2.5 text-xs font-medium transition-colors hover:bg-muted"
              >
                Version {version ?? "—"} <ChevronDown className="size-3.5 text-muted-foreground" />
              </button>
            }
          />
          <DropdownMenuContent align="start" className="max-h-72 overflow-y-auto">
            {versions.map((v) => (
              <DropdownMenuItem key={v.version} onClick={() => setVersion(v.version)}>
                Version {v.version} {v.version === currentVersion && <span className="text-muted-foreground">(current)</span>}
              </DropdownMenuItem>
            ))}
            {!versions.length && <div className="px-2 py-3 text-sm text-muted-foreground">No versions yet.</div>}
          </DropdownMenuContent>
        </DropdownMenu>
        {intent && <p className="min-w-0 flex-1 truncate text-xs text-muted-foreground">{intent}</p>}
      </div>

      <div className="min-h-0 flex-1 overflow-y-auto p-3">
        {loading && <p className="p-3 text-sm text-muted-foreground">Loading…</p>}
        {error && <p className="p-3 text-sm text-destructive">{error}</p>}
        {!loading && !error && files && files.length === 0 && <p className="p-3 text-sm text-muted-foreground">Nothing changed in this version.</p>}
        {!loading && !error && files && files.length > 0 && (
          <div className="flex flex-col gap-3">
            {files.map((f) => (
              <DiffFile key={f.path} file={f} />
            ))}
          </div>
        )}
      </div>
    </div>
  )
}
