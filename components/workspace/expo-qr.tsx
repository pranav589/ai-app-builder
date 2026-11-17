"use client"

import * as React from "react"
import { Check, Copy, QrCode, Smartphone } from "lucide-react"

import { Button } from "@/components/ui/button"
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog"

const SIZE = 25

// A QR-looking placeholder (finder patterns + seeded noise). It is NOT scannable;
// swap for a real QR encoder once the Expo dev server URL exists.
function placeholderMatrix(seed: string) {
  let h = 2166136261
  for (const ch of seed) h = Math.imul(h ^ ch.charCodeAt(0), 16777619)
  const rand = () => {
    h ^= h << 13
    h ^= h >>> 17
    h ^= h << 5
    return ((h >>> 0) % 1000) / 1000
  }
  const m = Array.from({ length: SIZE }, () => Array.from({ length: SIZE }, () => rand() > 0.52))
  const finder = (r0: number, c0: number) => {
    for (let r = -1; r <= 7; r++)
      for (let c = -1; c <= 7; c++) {
        const rr = r0 + r
        const cc = c0 + c
        if (rr < 0 || cc < 0 || rr >= SIZE || cc >= SIZE) continue
        const edge = r === 0 || r === 6 || c === 0 || c === 6
        const core = r >= 2 && r <= 4 && c >= 2 && c <= 4
        m[rr][cc] = r >= 0 && r <= 6 && c >= 0 && c <= 6 && (edge || core)
      }
  }
  finder(0, 0)
  finder(0, SIZE - 7)
  finder(SIZE - 7, 0)
  return m
}

export function QrPattern({ seed, className }: { seed: string; className?: string }) {
  const m = React.useMemo(() => placeholderMatrix(seed), [seed])
  return (
    <svg viewBox={`-2 -2 ${SIZE + 4} ${SIZE + 4}`} className={className} role="img" aria-label="Expo QR code (placeholder)">
      <rect x={-2} y={-2} width={SIZE + 4} height={SIZE + 4} fill="#ffffff" />
      {m.flatMap((row, r) =>
        row.map((on, c) => (on ? <rect key={`${r}-${c}`} x={c} y={r} width={1.02} height={1.02} fill="#111111" /> : null))
      )}
    </svg>
  )
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
  const expoUrl = `exp://u.expo.dev/${projectId}`
  const [copied, setCopied] = React.useState(false)

  React.useEffect(() => {
    if (!copied) return
    const t = setTimeout(() => setCopied(false), 2000)
    return () => clearTimeout(t)
  }, [copied])

  const steps = [
    "Install Expo Go from the App Store or Google Play.",
    "Open your phone's camera (iOS) or Expo Go (Android) and scan the code.",
    "Your app opens on the device and reloads as you make changes.",
  ]

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="gap-5 p-5 sm:max-w-md">
        <DialogHeader>
          <DialogTitle>Test on your phone</DialogTitle>
          <DialogDescription>Scan with Expo Go to run this app on a real device.</DialogDescription>
        </DialogHeader>

        <div className="flex flex-col items-center gap-4 sm:flex-row sm:items-start">
          <div className="relative shrink-0 rounded-(--r-md) border border-border bg-white p-2">
            <QrPattern seed={projectId} className="size-40 opacity-25 blur-[1.5px]" />
            <div className="absolute inset-0 flex flex-col items-center justify-center gap-1.5 text-center">
              <span className="flex size-9 items-center justify-center rounded-full bg-background shadow-sm">
                <QrCode className="size-4" />
              </span>
              <span className="px-4 text-xs font-medium text-foreground">Available after the first build</span>
            </div>
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
          <code className="min-w-0 flex-1 truncate font-mono text-xs text-muted-foreground">{expoUrl}</code>
          <Button
            variant="ghost"
            size="sm"
            disabled
            onClick={() =>
              navigator.clipboard
                .writeText(expoUrl)
                .then(() => setCopied(true))
                .catch(() => {})
            }
          >
            {copied ? <Check /> : <Copy />} Copy
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  )
}
