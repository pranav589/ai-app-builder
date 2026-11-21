"use client"

import * as React from "react"
import { useQuery } from "@tanstack/react-query"
import { useProjectStatusStream } from "@/hooks/use-project-status-stream"
import { useStopWebDeploy } from "@/hooks/use-stop-web-deploy"
import {
  Check,
  ChevronLeft,
  ChevronRight,
  Code2,
  Copy,
  DatabaseZap,
  Eye,
  GitCompare,
  Globe,
  MoreVertical,
  QrCode,
  RotateCw,
  Square,
} from "lucide-react"
import { cn } from "cn"

import type { WebDeploymentRow } from "@app/shared/api-types"
import { apiClient } from "@/lib/api-client"
import { Button } from "@/components/ui/button"
import { Spinner } from "@/components/ui/spinner"
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs"
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu"
import { ChangesView } from "./changes-view"
import { CodeView } from "./code-view"
import { SCREEN_HEIGHT, SCREEN_WIDTH } from "./dummy-data"
import { ExpoQrDialog, QrPattern } from "./expo-qr"
import { AppPreview, useResetAppData } from "./app-preview"
import { PhoneFrame, type DevicePlatform } from "./screen-mock"
import type { FileNode, ScreenNode } from "./types"

// Scales the fixed-size device to whatever room the panel has.
function useFitScale(ref: React.RefObject<HTMLDivElement | null>, w: number, h: number, pad = 24) {
  const [scale, setScale] = React.useState(1)
  React.useEffect(() => {
    const el = ref.current
    if (!el) return
    const ro = new ResizeObserver(([entry]) => {
      const { width, height } = entry.contentRect
      setScale(Math.max(0.3, Math.min(1.2, (width - pad * 2) / w, (height - pad * 2) / h)))
    })
    ro.observe(el)
    return () => ro.disconnect()
  }, [ref, w, h, pad])
  return scale
}

function DevicePreview({
  screens,
  activeId,
  onActiveChange,
  platform,
  reloadKey,
  appName,
}: {
  screens: ScreenNode[]
  activeId: string | null
  onActiveChange: (id: string) => void
  platform: DevicePlatform
  reloadKey: number
  appName: string
}) {
  const stageRef = React.useRef<HTMLDivElement>(null)
  const scale = useFitScale(stageRef, SCREEN_WIDTH, SCREEN_HEIGHT)
  const index = Math.max(0, screens.findIndex((s) => s.id === activeId))
  const screen = screens[index]
  // The screen the running app is on, which moves as the user taps around.
  const [topId, setTopId] = React.useState<string | null>(null)
  const current = screens.find((s) => s.id === topId) ?? screen

  const go = (delta: number) => {
    if (!screens.length) return
    onActiveChange(screens[(index + delta + screens.length) % screens.length].id)
  }

  return (
    <div className="flex h-full min-h-0 flex-col">
      <div ref={stageRef} className="relative flex min-h-0 flex-1 items-center justify-center overflow-hidden">
        <div style={{ width: SCREEN_WIDTH * scale, height: SCREEN_HEIGHT * scale }}>
          <div className="origin-top-left" style={{ transform: `scale(${scale})`, width: SCREEN_WIDTH, height: SCREEN_HEIGHT }}>
            <PhoneFrame platform={platform} className="size-full">
              {screen ? (
                // A restart or platform switch starts the app fresh.
                <div key={`${reloadKey}-${platform}`} className="size-full animate-in fade-in-0 duration-300">
                  <AppPreview
                    rootId={screen.id}
                    platform={platform}
                    appName={appName}
                    onTopChange={setTopId}
                  />
                </div>
              ) : (
                <div className="flex size-full flex-col items-center justify-center gap-2 p-8 text-center">
                  <p className="text-sm font-medium">No screens yet</p>
                  <p className="text-xs text-muted-foreground">Approve the plan in chat and your screens will show up here as they&apos;re designed.</p>
                </div>
              )}
            </PhoneFrame>
          </div>
        </div>
      </div>

      {screens.length > 0 && (
        <div className="flex shrink-0 items-center justify-center gap-1 pb-3">
          <Button variant="ghost" size="icon-xs" aria-label="Previous screen" onClick={() => go(-1)}>
            <ChevronLeft />
          </Button>
          <span className="min-w-24 text-center text-xs text-muted-foreground">
            <span className="font-medium text-foreground">{current?.name ?? "Not built yet"}</span> · {index + 1}/{screens.length}
          </span>
          <Button variant="ghost" size="icon-xs" aria-label="Next screen" onClick={() => go(1)}>
            <ChevronRight />
          </Button>
        </div>
      )}
    </div>
  )
}

function RunOnDeviceCard({ projectId, onOpen }: { projectId: string; onOpen: () => void }) {
  return (
    <button
      type="button"
      onClick={onOpen}
      className="group mx-3 mb-3 flex shrink-0 items-center gap-3 rounded-(--r-md) border border-border bg-background p-2.5 text-left transition-colors hover:border-foreground/20 hover:bg-muted/60"
    >
      <span className="relative shrink-0 overflow-hidden rounded-md border border-border bg-white p-0.5">
        <QrPattern text={`exp://device-preview-not-running/${projectId}`} className="size-10 opacity-60" />
      </span>
      <span className="min-w-0 flex-1">
        <span className="block text-sm font-medium">Test on your phone</span>
        <span className="block truncate text-xs text-muted-foreground">Scan the QR code with Expo Go</span>
      </span>
      <span className="flex size-7 shrink-0 items-center justify-center rounded-md bg-muted text-muted-foreground transition-colors group-hover:bg-background group-hover:text-foreground">
        <QrCode className="size-4" />
      </span>
    </button>
  )
}

export function PreviewPanel({
  projectId,
  appName,
  screens,
  activeId,
  onActiveChange,
  files,
  jumpTo,
}: {
  projectId: string
  appName: string
  screens: ScreenNode[]
  activeId: string | null
  onActiveChange: (id: string) => void
  files: FileNode[]
  /** Opens the Code tab at this line (set by the canvas editor's "View in Code tab"). */
  jumpTo: { path: string; line: number; nonce: number } | null
}) {
  const resetData = useResetAppData()
  const [tab, setTab] = React.useState<"preview" | "code" | "changes">("preview")
  const [platform, setPlatform] = React.useState<DevicePlatform>("ios")
  const [reloadKey, setReloadKey] = React.useState(0)
  const [qrOpen, setQrOpen] = React.useState(false)
  const [copiedUrl, setCopiedUrl] = React.useState(false)

  const webDeployQuery = useQuery({
    queryKey: ["project-web-deploy", projectId],
    queryFn: async () =>
      (
        await apiClient.get<{ deployment: WebDeploymentRow | null }>(
          `/api/projects/${projectId}/publish/web`
        )
      ).data,
  })
  const stopWebDeploy = useStopWebDeploy(projectId)
  const deployStatus = webDeployQuery.data?.deployment?.status
  useProjectStatusStream(projectId, Boolean(deployStatus) && deployStatus !== "ready" && deployStatus !== "failed")

  const handleCopyUrl = (e: React.MouseEvent, url: string) => {
    e.preventDefault()
    e.stopPropagation()
    navigator.clipboard.writeText(url)
    setCopiedUrl(true)
    setTimeout(() => setCopiedUrl(false), 1500)
  }

  React.useEffect(() => {
    if (jumpTo) setTab("code")
  }, [jumpTo])

  return (
    <Tabs value={tab} onValueChange={(v) => setTab(v as "preview" | "code" | "changes")} className="@container h-full min-h-0 gap-0 bg-background">
      <div className="flex h-11 shrink-0 items-center justify-between gap-1 border-b border-border px-1.5">
        <TabsList className="h-8">
          <TabsTrigger value="preview" aria-label="Preview" className="px-1.5 @sm:px-2.5">
            <Eye /> <span className="hidden @sm:inline">Preview</span>
          </TabsTrigger>
          <TabsTrigger value="code" aria-label="Code" className="px-1.5 @sm:px-2.5">
            <Code2 /> <span className="hidden @sm:inline">Code</span>
          </TabsTrigger>
          <TabsTrigger value="changes" aria-label="Changes" className="px-1.5 @sm:px-2.5">
            <GitCompare /> <span className="hidden @sm:inline">Changes</span>
          </TabsTrigger>
        </TabsList>

        {tab === "preview" && (
          <div className="flex items-center gap-1">
            {(() => {
              const deployment = webDeployQuery.data?.deployment
              if (!deployment) return null
              const status = deployment.status

              if (
                status === "queued" ||
                status === "dispatching" ||
                status === "building" ||
                status === "deploying"
              ) {
                const label =
                  status === "deploying"
                    ? "Deploying…"
                    : status === "building"
                    ? "Building…"
                    : "Preparing…"
                return (
                  <div className="flex items-center gap-1.5 rounded-full border border-border bg-muted/60 px-2.5 py-0.5 text-xs text-muted-foreground">
                    <Spinner className="size-3 text-primary" />
                    <span className="font-medium text-[11px]">{label}</span>
                    <button
                      type="button"
                      title="Stop deployment"
                      aria-label="Stop deployment"
                      disabled={stopWebDeploy.isPending}
                      onClick={() => stopWebDeploy.mutate()}
                      className="rounded-full p-0.5 hover:bg-foreground/10 disabled:opacity-50"
                    >
                      <Square className="size-3" />
                    </button>
                  </div>
                )
              }

              if (status === "ready" && deployment.url) {
                let host = deployment.url
                try {
                  host = new URL(deployment.url).host
                } catch {}

                return (
                  <div className="flex items-center rounded-full border border-border bg-muted/40 pl-2 pr-1 py-0.5 text-xs text-muted-foreground transition-colors hover:border-foreground/30 hover:bg-muted">
                    <a
                      href={deployment.url}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="flex items-center gap-1.5 font-mono text-[11px] text-foreground hover:underline"
                      title={deployment.url}
                    >
                      <Globe className="size-3 text-emerald-500" />
                      <span className="max-w-[110px] truncate @sm:max-w-[160px]">{host}</span>
                    </a>
                    <button
                      type="button"
                      onClick={(e) => handleCopyUrl(e, deployment.url!)}
                      className="flex size-5 items-center justify-center rounded-full text-muted-foreground hover:text-foreground hover:bg-background/80 transition-colors ml-0.5"
                      title={copiedUrl ? "Copied!" : "Copy Link"}
                      aria-label="Copy Link"
                    >
                      {copiedUrl ? <Check className="size-3 text-emerald-500" /> : <Copy className="size-3" />}
                    </button>
                  </div>
                )
              }

              return null
            })()}

            <div role="radiogroup" aria-label="Device" className="flex items-center rounded-lg bg-muted p-[3px]">
              {(["ios", "android"] as const).map((p) => (
                <button
                  key={p}
                  type="button"
                  role="radio"
                  aria-checked={platform === p}
                  aria-label={p === "ios" ? "iOS" : "Android"}
                  onClick={() => setPlatform(p)}
                  className={cn(
                    "h-6 rounded-md px-1.5 text-xs font-medium transition-colors @sm:px-2",
                    platform === p ? "bg-background text-foreground shadow-sm" : "text-muted-foreground hover:text-foreground"
                  )}
                >
                  <span className="@sm:hidden">{p === "ios" ? "iOS" : "And"}</span>
                  <span className="hidden @sm:inline">{p === "ios" ? "iOS" : "Android"}</span>
                </button>
              ))}
            </div>
            <DropdownMenu>
              <DropdownMenuTrigger
                render={
                  <Button variant="ghost" size="icon-sm" aria-label="More preview actions" title="More actions">
                    <MoreVertical />
                  </Button>
                }
              />
              <DropdownMenuContent align="end" className="w-52">
                <DropdownMenuItem onClick={() => setReloadKey((k) => k + 1)}>
                  <RotateCw /> Restart app
                </DropdownMenuItem>
                <DropdownMenuItem
                  onClick={() => {
                    void resetData().then(() => setReloadKey((k) => k + 1))
                  }}
                >
                  <DatabaseZap /> Reset app data
                </DropdownMenuItem>
                <DropdownMenuItem onClick={() => setQrOpen(true)}>
                  <QrCode /> Open on device
                </DropdownMenuItem>
              </DropdownMenuContent>
            </DropdownMenu>
          </div>
        )}
      </div>

      <TabsContent value="preview" className="flex min-h-0 flex-col bg-[radial-gradient(ellipse_80%_60%_at_50%_40%,color-mix(in_oklch,var(--action),transparent_94%),transparent_70%)]">
        <DevicePreview
          screens={screens}
          activeId={activeId}
          onActiveChange={onActiveChange}
          platform={platform}
          reloadKey={reloadKey}
          appName={appName}
        />
        <RunOnDeviceCard projectId={projectId} onOpen={() => setQrOpen(true)} />
      </TabsContent>

      <TabsContent value="code" className="min-h-0">
        <CodeView tree={files} jumpTo={jumpTo} />
      </TabsContent>

      <TabsContent value="changes" className="min-h-0">
        <ChangesView projectId={projectId} />
      </TabsContent>

      <ExpoQrDialog open={qrOpen} onOpenChange={setQrOpen} projectId={projectId} />
    </Tabs>
  )
}
