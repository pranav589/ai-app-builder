"use client"

import * as React from "react"
import { LayoutGrid, MessageSquare, Smartphone } from "lucide-react"
import { cn } from "cn"

import { ResizableHandle, ResizablePanel, ResizablePanelGroup } from "@/components/ui/resizable"
import { CanvasPanel } from "./canvas-panel"
import { ChatPanel } from "./chat-panel"
import type { BackendConfig } from "@/lib/app-runtime/app-doc"
import { AppRuntimeProvider } from "./app-runtime"
import { appFileTree } from "./app-files"
import { SCREEN_GAP, SCREEN_WIDTH } from "./dummy-data"
import { PreviewPanel } from "./preview-panel"
import type { ChatMessage, ScreenNode, WorkspaceProject } from "./types"
import { useAgent } from "./use-agent"
import { WorkspaceHeader } from "./workspace-header"

type Pane = "chat" | "canvas" | "preview"

function useIsDesktop() {
  const [desktop, setDesktop] = React.useState(true)
  React.useEffect(() => {
    const mql = window.matchMedia("(min-width: 1024px)")
    const update = () => setDesktop(mql.matches)
    update()
    mql.addEventListener("change", update)
    return () => mql.removeEventListener("change", update)
  }, [])
  return desktop
}

export function WorkspaceShell({
  project,
  initialMessages,
}: {
  project: WorkspaceProject
  initialMessages: ChatMessage[]
}) {
  const isDesktop = useIsDesktop()
  const agent = useAgent({
    projectId: project.id,
    initialPhase: project.phase,
    initialMessages,
    initialScreens: project.screens,
    initialName: project.name,
    initialThemes: project.themes,
    initialData: project.dataModel,
    initialFiles: project.files ?? {},
    initialBackend: project.backendInfo,
  })

  const [pane, setPane] = React.useState<Pane>(project.phase === "draft" || project.phase === "planning" ? "chat" : "canvas")
  const [positions, setPositions] = React.useState<Record<string, { x: number; y: number }>>({})
  const [selectedId, setSelectedId] = React.useState<string | null>(null)
  const [previewPick, setPreviewPick] = React.useState<string | null>(null)
  const [editTargetId, setEditTargetId] = React.useState<string | null>(null)
  const chatInputRef = React.useRef<HTMLTextAreaElement>(null)
  // The app runs on CloudHike once its backend is ready (live, without a reload); otherwise on-device storage.
  const cloudRef = agent.backend?.status === "ready" ? agent.backend.projectId : null
  const backendConfig = React.useMemo<BackendConfig>(
    () => (cloudRef ? { provider: "cloudhike", projectRef: cloudRef } : { provider: "local" }),
    [cloudRef]
  )
  const files = React.useMemo(
    () => appFileTree({ files: agent.files, screens: agent.screens, backend: backendConfig }),
    [agent.files, agent.screens, backendConfig]
  )
  // What the preview runs: every project file plus each finished screen
  // (a screen still streaming in isn't complete code yet).
  const readyCode = agent.screens.map((s) => (s.state === "ready" && s.code && s.path ? `${s.path}:${s.code.length}:${s.code.slice(-64)}` : "")).join("|")
  const projectFiles = React.useMemo(() => {
    const out: Record<string, string> = { ...agent.files }
    for (const s of agent.screens) if (s.state === "ready" && s.code && s.path) out[s.path] = s.code
    return out
  }, [agent.files, readyCode]) // eslint-disable-line react-hooks/exhaustive-deps
  const plannedKey = agent.screens.map((s) => `${s.id}:${s.state}`).join(",")
  const planned = React.useMemo(
    () => agent.screens.map((s) => ({ pathname: `/${s.id}`, name: s.name, state: s.state })),
    [plannedKey] // eslint-disable-line react-hooks/exhaustive-deps
  )
  const themeList = React.useMemo(() => agent.themes?.themes ?? [], [agent.themes])
  const activeTheme = agent.themes?.themes.find((t) => t.id === agent.themes?.activeId) ?? agent.themes?.themes[0] ?? null

  // Screens come from the agent; where they sit on the canvas is local.
  const nodes: ScreenNode[] = React.useMemo(
    () => agent.screens.map((s, i) => ({ ...s, ...(positions[s.id] ?? { x: i * (SCREEN_WIDTH + SCREEN_GAP), y: 0 }) })),
    [agent.screens, positions]
  )
  const setNodes = React.useCallback(
    (updater: (prev: ScreenNode[]) => ScreenNode[]) => {
      const next = updater(nodes)
      setPositions((p) => {
        const out = { ...p }
        for (const n of next) out[n.id] = { x: n.x, y: n.y }
        return out
      })
    },
    [nodes]
  )

  // While building, the preview follows the screen being designed.
  const followId = agent.phase === "generating" ? agent.activeScreenId : null
  const pick = followId ?? previewPick
  const previewId = nodes.some((s) => s.id === pick) ? pick : (nodes.find((s) => s.state === "ready")?.id ?? nodes[0]?.id ?? null)
  const editTarget = nodes.find((s) => s.id === editTargetId) ?? null

  const select = React.useCallback((id: string | null) => {
    setSelectedId(id)
    if (id) setPreviewPick(id)
  }, [])

  const editScreen = (screen: ScreenNode) => {
    setEditTargetId(screen.id)
    if (!isDesktop) setPane("chat")
    requestAnimationFrame(() => chatInputRef.current?.focus())
  }

  const send = (text: string) => {
    agent.sendMessage(text, editTarget?.id)
    setEditTargetId(null)
  }

  // On small screens, jump to the canvas when the build starts.
  const prevPhase = React.useRef(agent.phase)
  React.useEffect(() => {
    if (!isDesktop && prevPhase.current !== "generating" && agent.phase === "generating") setPane("canvas")
    prevPhase.current = agent.phase
  }, [agent.phase, isDesktop])

  const chat = (
    <ChatPanel
      messages={agent.messages}
      streaming={agent.streaming}
      status={agent.status}
      statusSince={agent.statusSince}
      planProgress={agent.planProgress}
      phase={agent.phase}
      busy={agent.busy}
      error={agent.error}
      onSend={send}
      onApprove={agent.approve}
      onRetry={agent.retry}
      onDismissError={agent.dismissError}
      editTarget={editTarget}
      onClearEditTarget={() => setEditTargetId(null)}
      inputRef={chatInputRef}
    />
  )
  const canvas = (
    <CanvasPanel
      screens={nodes}
      onScreensChange={setNodes}
      selectedId={selectedId}
      onSelect={select}
      onEdit={editScreen}
      busy={agent.busy}
      themes={agent.themes}
      onThemeChange={agent.setActiveTheme}
      buildingThemes={agent.phase === "generating"}
      appName={agent.name}
      notice={agent.repairing ? `Fixing a crash in ${agent.screens.find((x) => x.path === agent.repairing)?.name ?? agent.repairing.split("/").pop()}…` : null}
    />
  )
  const preview = (
    <PreviewPanel
      projectId={project.id}
      appName={agent.name}
      screens={nodes}
      activeId={previewId}
      onActiveChange={(id) => {
        setPreviewPick(id)
        setSelectedId(id)
      }}
      files={files}
    />
  )

  const panes: { id: Pane; label: string; icon: typeof MessageSquare }[] = [
    { id: "chat", label: "Chat", icon: MessageSquare },
    { id: "canvas", label: "Canvas", icon: LayoutGrid },
    { id: "preview", label: "Preview", icon: Smartphone },
  ]

  return (
    <AppRuntimeProvider
      appId={project.id}
      theme={activeTheme}
      themes={themeList}
      dataModel={agent.dataModel}
      backendConfig={backendConfig}
      files={projectFiles}
      planned={planned}
      onThemeChange={agent.setActiveTheme}
      onRuntimeError={agent.reportCrash}
    >
    <div className="flex h-dvh flex-col overflow-hidden bg-background">
      <WorkspaceHeader
        projectId={project.id}
        name={agent.name}
        status={agent.phase}
        onRename={agent.setName}
        backend={agent.backend}
        cloudhike={project.cloudhike}
        agentBusy={agent.busy}
        onSetupBackend={agent.setupBackend}
        onBackendDisconnected={() => agent.setBackend(null)}
      />

      {isDesktop ? (
        <ResizablePanelGroup orientation="horizontal" className="min-h-0 flex-1">
          <ResizablePanel id="chat" defaultSize="26%" minSize={300} maxSize="40%">
            {chat}
          </ResizablePanel>
          <ResizableHandle />
          <ResizablePanel id="canvas" minSize="30%">
            {canvas}
          </ResizablePanel>
          <ResizableHandle />
          <ResizablePanel id="preview" defaultSize="28%" minSize={340} maxSize="42%">
            {preview}
          </ResizablePanel>
        </ResizablePanelGroup>
      ) : (
        <>
          <main className="min-h-0 flex-1">{pane === "chat" ? chat : pane === "canvas" ? canvas : preview}</main>
          <nav className="flex shrink-0 justify-center border-t border-border bg-background px-4 py-2" aria-label="Workspace panels">
            <div role="tablist" className="grid w-full max-w-sm grid-cols-3 gap-1 rounded-(--r-md) bg-muted p-1">
              {panes.map((p) => (
                <button
                  key={p.id}
                  type="button"
                  role="tab"
                  aria-selected={pane === p.id}
                  onClick={() => setPane(p.id)}
                  className={cn(
                    "relative flex h-9 items-center justify-center gap-1.5 rounded-(--r-sm) text-sm font-medium transition-colors",
                    pane === p.id ? "bg-background text-foreground shadow-sm" : "text-muted-foreground"
                  )}
                >
                  <p.icon className="size-4" /> {p.label}
                  {p.id === "chat" && pane !== "chat" && agent.phase === "awaiting_approval" && (
                    <span className="absolute top-1.5 right-2 size-1.5 rounded-full bg-amber-500" aria-label="Waiting for you" />
                  )}
                </button>
              ))}
            </div>
          </nav>
        </>
      )}
    </div>
    </AppRuntimeProvider>
  )
}
