"use client"

import { useQuery } from "@tanstack/react-query"
import { AlertTriangle } from "lucide-react"

import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog"
import { Spinner } from "@/components/ui/spinner"
import { apiClient, getApiErrorMessage } from "@/lib/api-client"
import { PublicAppPlayer, type PublicProjectPayload } from "./public-app-player"

/**
 * Visitor-facing preview opened from a public project card: the actual
 * generated app, running interactively in a sandboxed local backend.
 */
export function PublicPreviewDialog({
  slug,
  onOpenChange,
}: {
  /** The project to preview; the dialog is open whenever this is set. */
  slug: string | null
  onOpenChange: (open: boolean) => void
}) {
  const query = useQuery({
    queryKey: ["public-project", slug],
    queryFn: async () => {
      const res = await apiClient.get<PublicProjectPayload>(`/api/public/projects/${slug}`)
      return res.data
    },
    enabled: !!slug,
    staleTime: 60_000,
  })

  return (
    <Dialog open={!!slug} onOpenChange={onOpenChange}>
      <DialogContent className="flex max-h-[min(44rem,90vh)] w-full max-w-sm flex-col overflow-hidden p-0 sm:max-w-sm">
        <DialogHeader className="border-b border-border px-5 py-4">
          <DialogTitle>{query.data?.name ?? "App preview"}</DialogTitle>
        </DialogHeader>

        <div className="flex min-h-0 flex-1 items-center justify-center bg-(--surface) p-6">
          {query.isLoading ? (
            <Spinner className="size-6 text-muted-foreground" />
          ) : query.isError ? (
            <div className="flex flex-col items-center gap-2 text-center">
              <AlertTriangle className="size-6 text-destructive" />
              <p className="text-sm text-muted-foreground">{getApiErrorMessage(query.error, "This app isn't available right now.")}</p>
            </div>
          ) : query.data ? (
            <PublicAppPlayer data={query.data} className="h-[560px] w-[270px]" />
          ) : null}
        </div>
      </DialogContent>
    </Dialog>
  )
}
