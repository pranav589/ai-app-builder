"use client"

import * as React from "react"
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query"
import qrcode from "qrcode-generator"
import { Check, Copy, Loader2, Play, QrCode, RotateCw, Smartphone, Square } from "lucide-react"

import { Button } from "@/components/ui/button"
import { apiClient, getApiErrorMessage } from "@/lib/api-client"
import { useProjectStatusStream } from "@/hooks/use-project-status-stream"
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog"

/** A real, scannable QR code (Phase 10) of `text`, drawn as plain SVG rects so it matches the rest of this dialog's styling. */
export function QrPattern({ text, className }: { text: string; className?: string }) {
  const cells = React.useMemo(() => {
    const qr = qrcode(0, "M")
    qr.addData(text)
    qr.make()
    const n = qr.getModuleCount()
    return Array.from({ length: n }, (_, r) => Array.from({ length: n }, (_, c) => qr.isDark(r, c)))
  }, [text])
  const size = cells.length

  return (
    <svg viewBox={`-2 -2 ${size + 4} ${size + 4}`} className={className} role="img" aria-label="Expo QR code">
      <rect x={-2} y={-2} width={size + 4} height={size + 4} fill="#ffffff" />
      {cells.flatMap((row, r) => row.map((on, c) => (on ? <rect key={`${r}-${c}`} x={c} y={r} width={1.02} height={1.02} fill="#111111" /> : null)))}
    </svg>
  )
}

type BuildStatus = "none" | "building" | "ready" | "failed"
type Build = { status: BuildStatus; error?: string | null; stale?: boolean; manifestUrl?: string | null }

/**
 * Phase 10b's hosted device preview (app/api/projects/[projectId]/device-build): follows
 * build status (pushed over SSE) while the dialog is open, and triggers a build (`expo export` + S3 upload,
 * lib/device/build.ts). The QR encodes the public manifest route
 * (app/api/device/[projectId]/manifest), which Expo Go opens directly -- confirmed on a
 * real phone with no Metro process running (docs/verified-code-plan.md, Phase 10b).
 */
function useDeviceBuild(projectId: string, active: boolean) {
  const endpoint = `/api/projects/${projectId}/device-build`
  const queryClient = useQueryClient()
  const [customError, setCustomError] = React.useState<string | null>(null)

  const buildQuery = useQuery({
    queryKey: ["device-build", projectId],
    queryFn: async () => (await apiClient.get<Build>(endpoint)).data,
    enabled: active,
  })
  useProjectStatusStream(projectId, active)

  const startMutation = useMutation({
    mutationFn: async () => (await apiClient.post<Build>(endpoint)).data,
    onSuccess: (data) => {
      if (data) queryClient.setQueryData(["device-build", projectId], data)
    },
    onError: (err) => setCustomError(getApiErrorMessage(err)),
  })

  const stopMutation = useMutation({
    mutationFn: async () => (await apiClient.delete<Build>(endpoint)).data,
    onSuccess: (data) => {
      if (data) queryClient.setQueryData(["device-build", projectId], data)
    },
    onError: (err) => setCustomError(getApiErrorMessage(err, "Couldn't stop the build.")),
  })

  const build = buildQuery.data ?? { status: "none" as const }

  return {
    build,
    busy: startMutation.isPending,
    stopping: stopMutation.isPending,
    stop: () => {
      setCustomError(null)
      stopMutation.mutate()
    },
    error: customError,
    start: () => {
      setCustomError(null)
      startMutation.mutate()
    },
  }
}

export function ExpoQrDialog({
  open,
  onOpenChange,
  projectId,
}: {
  open: boolean
  onOpenChange: (open: boolean) => void
  projectId: string
}) {
  const { build, busy, stopping, stop, error, start } = useDeviceBuild(projectId, open)
  const building = build.status === "building"
  const url = build.status === "ready" ? build.manifestUrl ?? null : null
  const [copied, setCopied] = React.useState(false)

  React.useEffect(() => {
    if (!copied) return
    const t = setTimeout(() => setCopied(false), 2000)
    return () => clearTimeout(t)
  }, [copied])

  const steps = url
    ? [
        "Install Expo Go from the App Store or Google Play.",
        'Open Expo Go, tap "Enter URL manually", and paste the link below.',
        "Made more changes? Press Rebuild, then force-close and reopen the app on your phone.",
      ]
    : [
        "Press Build for phone. The first build takes a little while.",
        "Install Expo Go from the App Store or Google Play.",
        'Open Expo Go, tap "Enter URL manually", and paste the link once it\'s ready.',
      ]
  const overlay = building ? "Building..." : build.status === "failed" ? "Couldn't build" : "Not built yet"
  const problem = error ?? (build.status === "failed" ? build.error : null)

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="gap-5 p-5 sm:max-w-lg min-w-0 overflow-hidden">
        <DialogHeader>
          <DialogTitle>Test on your phone</DialogTitle>
          <DialogDescription>Build this app and open it in Expo Go on a real device.</DialogDescription>
        </DialogHeader>

        <div className="flex flex-col items-center gap-4 sm:flex-row sm:items-start min-w-0">
          <div className="relative shrink-0 rounded-(--r-md) border border-border bg-white p-2">
            {url ? (
              <QrPattern text={url} className="size-40" />
            ) : (
              <>
                <QrPattern text={`exp://device-preview-not-built/${projectId}`} className="size-40 opacity-25 blur-[1.5px]" />
                <div className="absolute inset-0 flex flex-col items-center justify-center gap-1.5 text-center">
                  <span className="flex size-9 items-center justify-center rounded-full bg-background shadow-sm">
                    <QrCode className="size-4" />
                  </span>
                  <span className="px-4 text-xs font-medium text-foreground">{overlay}</span>
                </div>
              </>
            )}
          </div>
          <ol className="min-w-0 flex-1 space-y-3 text-sm">
            {steps.map((s, i) => (
              <li key={s} className="flex gap-2.5">
                <span className="flex size-5 shrink-0 items-center justify-center rounded-full bg-muted text-xs font-medium">
                  {i + 1}
                </span>
                <span className="text-muted-foreground">{s}</span>
              </li>
            ))}
          </ol>
        </div>

        <div className="flex min-w-0 w-full items-center gap-2 rounded-(--r-md) border border-border bg-muted/50 p-1 pl-3">
          <Smartphone className="size-4 shrink-0 text-muted-foreground" />
          <code
            className="block min-w-0 flex-1 truncate font-mono text-xs text-muted-foreground"
            title={url ?? undefined}
          >
            {url ?? "Not built yet"}
          </code>
          <Button
            variant="ghost"
            size="sm"
            className="shrink-0"
            disabled={!url}
            onClick={() => {
              if (!url) return
              navigator.clipboard
                .writeText(url)
                .then(() => setCopied(true))
                .catch(() => {})
            }}
          >
            {copied ? <Check /> : <Copy />} Copy
          </Button>
        </div>

        {problem && (
          <pre className="max-h-40 min-w-0 max-w-full overflow-auto whitespace-pre-wrap break-all rounded-(--r-md) border border-destructive/40 bg-destructive/5 p-2 font-mono text-xs text-destructive">
            {problem}
          </pre>
        )}

        <div className="flex min-w-0 w-full items-center justify-end gap-2">
          {build.stale && !building && (
            <span className="min-w-0 flex-1 text-xs text-muted-foreground">Rebuild to include your latest changes.</span>
          )}
          {building && (
            <Button size="sm" variant="outline" className="shrink-0" disabled={stopping} onClick={stop}>
              {stopping ? <Loader2 className="animate-spin" /> : <Square />} Stop
            </Button>
          )}
          <Button size="sm" className="shrink-0" disabled={busy || building} onClick={start}>
            {busy || building ? <Loader2 className="animate-spin" /> : url ? <RotateCw /> : <Play />}{" "}
            {url ? "Rebuild" : "Build for phone"}
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  )
}
