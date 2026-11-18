"use client"

import * as React from "react"
import { ChevronLeft, ChevronRight, Code2, DatabaseZap, Eye, GitCompare, MousePointerClick, QrCode, RotateCw } from "lucide-react"
import { cn } from "cn"

import { Button } from "@/components/ui/button"
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs"
import { ChangesView } from "./changes-view"
import { CodeView } from "./code-view"
import { SCREEN_HEIGHT, SCREEN_WIDTH } from "./dummy-data"
import { ElementInspector } from "./element-inspector"
import { ExpoQrDialog, QrPattern } from "./expo-qr"
import { AppPreview, useResetAppData } from "./app-preview"
import type { ElementEdit, SelectedElement } from "@/lib/preview/protocol"
import { PhoneFrame, type DevicePlatform } from "./screen-mock"
import type { FileNode, ScreenNode } from "./types"

/** "app/(tabs)/home.tsx:42:Text" -> { path: "app/(tabs)/home.tsx", line: 42 } (preview-runtime/modules.ts makeJsx). */
function parseEid(eid: string): { path: string; line: number } | null {
  const m = /^(.*):(\d+):[^:]+$/.exec(eid)
  return m ? { path: m[1], line: Number(m[2]) } : null
}

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
  inspecting,
  edit,
  onSelectElement,
}: {
  screens: ScreenNode[]
  activeId: string | null
  onActiveChange: (id: string) => void
  platform: DevicePlatform
  reloadKey: number
  appName: string
  inspecting: boolean
  edit: ElementEdit | null
  onSelectElement: (el: SelectedElement) => void
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
                    inspect={inspecting}
                    edit={edit}
                    onSelectElement={onSelectElement}
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
  onApplyElementEdit,
}: {
  projectId: string
  appName: string
  screens: ScreenNode[]
  activeId: string | null
  onActiveChange: (id: string) => void
  files: FileNode[]
  onApplyElementEdit: (edit: ElementEdit) => Promise<{ ok: boolean; error?: string; resynced?: boolean }>
}) {
  const resetData = useResetAppData()
  const [tab, setTab] = React.useState<"preview" | "code" | "changes">("preview")
  const [platform, setPlatform] = React.useState<DevicePlatform>("ios")
  const [reloadKey, setReloadKey] = React.useState(0)
  const [qrOpen, setQrOpen] = React.useState(false)
  const [inspecting, setInspecting] = React.useState(false)
  const [selected, setSelected] = React.useState<SelectedElement | null>(null)
  const [previewEdit, setPreviewEdit] = React.useState<ElementEdit | null>(null)
  const [inspectNotice, setInspectNotice] = React.useState<string | null>(null)
  const [jumpTo, setJumpTo] = React.useState<{ path: string; line: number } | null>(null)

  const toggleInspect = () => {
    setInspecting((on) => !on)
    setSelected(null)
    setPreviewEdit(null)
    setInspectNotice(null)
  }

  // A resync (e.g. an already-built project picking up a kit fix) means
  // whatever eid the editor had was pointing at stale code, not what's
  // actually selected; close it and ask for a fresh tap rather than letting
  // the user keep editing a location that no longer means what they think.
  const handleSave = async (edit: ElementEdit) => {
    const r = await onApplyElementEdit(edit)
    if (!r.ok && r.resynced) {
      setSelected(null)
      setPreviewEdit(null)
      setInspectNotice("The preview just updated behind the scenes — tap the element again.")
    }
    return r
  }
  React.useEffect(() => {
    if (!inspectNotice) return
    const t = setTimeout(() => setInspectNotice(null), 5000)
    return () => clearTimeout(t)
  }, [inspectNotice])

  const viewSelectedInCode = () => {
    if (!selected) return
    const at = parseEid(selected.eid)
    if (!at) return
    setJumpTo(at)
    setTab("code")
  }

  return (
    <Tabs value={tab} onValueChange={(v) => setTab(v as "preview" | "code" | "changes")} className="h-full min-h-0 gap-0 bg-background">
      <div className="flex h-11 shrink-0 items-center justify-between gap-2 border-b border-border px-2">
        <TabsList className="h-8">
          <TabsTrigger value="preview" className="px-2.5">
            <Eye /> Preview
          </TabsTrigger>
          <TabsTrigger value="code" className="px-2.5">
            <Code2 /> Code
          </TabsTrigger>
          <TabsTrigger value="changes" className="px-2.5">
            <GitCompare /> Changes
          </TabsTrigger>
        </TabsList>

        {tab === "preview" && (
          <div className="flex items-center gap-1">
            <div role="radiogroup" aria-label="Device" className="flex items-center rounded-lg bg-muted p-[3px]">
              {(["ios", "android"] as const).map((p) => (
                <button
                  key={p}
                  type="button"
                  role="radio"
                  aria-checked={platform === p}
                  onClick={() => setPlatform(p)}
                  className={cn(
                    "h-6 rounded-md px-2 text-xs font-medium transition-colors",
                    platform === p ? "bg-background text-foreground shadow-sm" : "text-muted-foreground hover:text-foreground"
                  )}
                >
                  {p === "ios" ? "iOS" : "Android"}
                </button>
              ))}
            </div>
            <Button variant="ghost" size="icon-sm" aria-label="Restart app" title="Restart app" onClick={() => setReloadKey((k) => k + 1)}>
              <RotateCw />
            </Button>
            <Button
              variant="ghost"
              size="icon-sm"
              aria-label="Reset app data"
              title="Reset app data to the sample data (stored on this device)"
              onClick={() => {
                void resetData().then(() => setReloadKey((k) => k + 1))
              }}
            >
              <DatabaseZap />
            </Button>
            <Button variant="ghost" size="icon-sm" aria-label="Open on device" title="Open on device" onClick={() => setQrOpen(true)}>
              <QrCode />
            </Button>
            <span className="mx-0.5 h-5 w-px bg-border" />
            <Button
              variant={inspecting ? "secondary" : "ghost"}
              size="icon-sm"
              aria-pressed={inspecting}
              aria-label="Select an element to edit its text or style"
              title="Select an element to edit (no AI call)"
              onClick={toggleInspect}
            >
              <MousePointerClick />
            </Button>
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
          inspecting={inspecting}
          edit={previewEdit}
          onSelectElement={setSelected}
        />
        {selected ? (
          <ElementInspector
            element={selected}
            onClose={() => setSelected(null)}
            onPreview={setPreviewEdit}
            onSave={handleSave}
            onViewCode={viewSelectedInCode}
          />
        ) : inspectNotice ? (
          <p role="status" className="mx-3 mb-3 shrink-0 rounded-(--r-md) border border-border bg-background px-3 py-2 text-xs text-muted-foreground shadow-sm">
            {inspectNotice}
          </p>
        ) : (
          <RunOnDeviceCard projectId={projectId} onOpen={() => setQrOpen(true)} />
        )}
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
