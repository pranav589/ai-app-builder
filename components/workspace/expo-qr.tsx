"use client"

import * as React from "react"
import qrcode from "qrcode-generator"
import { Check, Copy, Loader2, Play, QrCode, RotateCw, Smartphone, Square } from "lucide-react"

import { Button } from "@/components/ui/button"
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

type LaneStatus = "stopped" | "starting" | "running" | "failed" | "external"
type Lane = { url: string | null; status: LaneStatus; error?: string }

/**
 * The dev-only device lane (app/api/projects/[projectId]/device): polls its
 * status while the dialog is open, and starts/stops Metro on this machine,
 * so the QR appears without the user touching a terminal.
 */
function useDeviceLane(projectId: string, active: boolean) {
  const [lane, setLane] = React.useState<Lane>({ url: null, status: "stopped" })
  const [busy, setBusy] = React.useState(false)
  const [error, setError] = React.useState<string | null>(null)
  const endpoint = `/api/projects/${projectId}/device`

  React.useEffect(() => {
    if (!active) return
    let cancelled = false
    const poll = () =>
      fetch(endpoint)
        .then((r) => (r.ok ? r.json() : null))
        .then((data) => data && !cancelled && setLane(data))
        .catch(() => {})
    void poll()
    // Faster while Metro is starting, so the QR appears promptly.
    const t = setInterval(poll, lane.status === "starting" ? 1500 : 3000)
    return () => {
      cancelled = true
      clearInterval(t)
    }
  }, [endpoint, active, lane.status])

  const send = React.useCallback(
    async (method: "POST" | "DELETE") => {
      setBusy(true)
      setError(null)
      try {
        const res = await fetch(endpoint, { method })
        const data = await res.json().catch(() => null)
        if (!res.ok) setError(data?.error ?? "Something went wrong.")
        else if (data) setLane(data)
      } catch {
        setError("Couldn't reach the server.")
      } finally {
        setBusy(false)
      }
    },
    [endpoint],
  )

  return { lane, busy, error, start: () => send("POST"), stop: () => send("DELETE") }
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
  const { lane, busy, error, start, stop } = useDeviceLane(projectId, open)
  const ready = lane.status === "running" || lane.status === "external"
  const url = ready ? lane.url : null
  const running = lane.status === "running" || lane.status === "starting"
  const [copied, setCopied] = React.useState(false)

  React.useEffect(() => {
    if (!copied) return
    const t = setTimeout(() => setCopied(false), 2000)
    return () => clearTimeout(t)
  }, [copied])

  const steps = url
    ? [
        "Install Expo Go from the App Store or Google Play.",
        "Open your phone's camera (iOS) or Expo Go (Android) and scan the code.",
        "Made more changes? Press Restart to load the latest version.",
      ]
    : [
        "Keep your phone on the same Wi-Fi network as this computer.",
        "Press Start. The first start takes a little while.",
        "Scan the QR code with Expo Go when it appears.",
      ]
  const overlay = lane.status === "starting" ? "Starting Metro..." : lane.status === "failed" ? "Couldn't start" : "Not running"
  const problem = error ?? (lane.status === "failed" ? lane.error : null)

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="gap-5 p-5 sm:max-w-md">
        <DialogHeader>
          <DialogTitle>Test on your phone</DialogTitle>
          <DialogDescription>Scan with Expo Go to run this app on a real device.</DialogDescription>
        </DialogHeader>

        <div className="flex flex-col items-center gap-4 sm:flex-row sm:items-start">
          <div className="relative shrink-0 rounded-(--r-md) border border-border bg-white p-2">
            {url ? (
              <QrPattern text={url} className="size-40" />
            ) : (
              <>
                <QrPattern text={`exp://device-preview-not-running/${projectId}`} className="size-40 opacity-25 blur-[1.5px]" />
                <div className="absolute inset-0 flex flex-col items-center justify-center gap-1.5 text-center">
                  <span className="flex size-9 items-center justify-center rounded-full bg-background shadow-sm">
                    <QrCode className="size-4" />
                  </span>
                  <span className="px-4 text-xs font-medium text-foreground">{overlay}</span>
                </div>
              </>
            )}
          </div>
          <ol className="space-y-3 text-sm">
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

        <div className="flex items-center gap-2 rounded-(--r-md) border border-border bg-muted/50 p-1 pl-3">
          <Smartphone className="size-4 shrink-0 text-muted-foreground" />
          <code className="min-w-0 flex-1 truncate font-mono text-xs text-muted-foreground">{url ?? "Not running"}</code>
          <Button
            variant="ghost"
            size="sm"
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
          <pre className="max-h-40 overflow-auto whitespace-pre-wrap rounded-(--r-md) border border-destructive/40 bg-destructive/5 p-2 font-mono text-xs text-destructive">
            {problem}
          </pre>
        )}

        <div className="flex justify-end gap-2">
          {lane.status === "external" ? (
            <span className="text-xs text-muted-foreground">Started from a terminal. Stop it there with Ctrl-C.</span>
          ) : (
            <>
              {running && (
                <Button variant="outline" size="sm" disabled={busy} onClick={stop}>
                  <Square /> Stop
                </Button>
              )}
              <Button size="sm" disabled={busy} onClick={start}>
                {busy ? <Loader2 className="animate-spin" /> : running ? <RotateCw /> : <Play />} {running ? "Restart" : "Start"}
              </Button>
            </>
          )}
        </div>
      </DialogContent>
    </Dialog>
  )
}
