"use client"

import * as React from "react"
import { LayoutGrid, MessageSquare, Smartphone } from "lucide-react"
import { cn } from "cn"

import { ResizableHandle, ResizablePanel, ResizablePanelGroup } from "@/components/ui/resizable"
import { CanvasPanel, type InlineEditing } from "./canvas-panel"
import { ChatPanel } from "./chat-panel"
import type { BackendConfig } from "@app/shared/app-runtime/app-doc"
import { AppRuntimeProvider } from "./app-runtime"
import { appFileTree } from "./app-files"
import { SCREEN_GAP, SCREEN_WIDTH } from "./dummy-data"
import { PreviewPanel } from "./preview-panel"
import type { ChatMessage, ScreenNode, WorkspaceProject } from "./types"
import { useAgent } from "./use-agent"
import { useProjectStatusStream } from "@/hooks/use-project-status-stream"
import { WorkspaceHeader } from "./workspace-header"
import type { ElementEdit, ElementRef, SelectedElement } from "@app/shared/preview/protocol"

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
    initialProviders: project.backendProviders,
  })
  useProjectStatusStream(project.id)

  const [pane, setPane] = React.useState<Pane>(project.phase === "draft" || project.phase === "planning" ? "chat" : "canvas")
  // On desktop canvas and preview are both always on screen; on mobile only the active pane is.
  const appActive = isDesktop || pane !== "chat"
  const [positions, setPositions] = React.useState<Record<string, { x: number; y: number }>>({})
  const [selectedId, setSelectedId] = React.useState<string | null>(null)
  const [previewPick, setPreviewPick] = React.useState<string | null>(null)
  const [editTargetId, setEditTargetId] = React.useState<string | null>(null)
  const chatInputRef = React.useRef<HTMLTextAreaElement>(null)
  // The app runs on its connected provider once the backend is ready (live, without a reload); otherwise on-device storage.
  const ready = agent.backend?.status === "ready" && agent.backend.projectId ? agent.backend : null
  const readyProvider = ready?.provider ?? null
  const readyRef = ready?.projectId ?? null
  const backendConfig = React.useMemo<BackendConfig>(
    () => (readyProvider && readyRef ? { provider: readyProvider, projectRef: readyRef } : { provider: "local" }),
    [readyProvider, readyRef]
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

  // ---- Inline editing (Edit Mode on a canvas screen)
  const [editingId, setEditingId] = React.useState<string | null>(null)
  const [element, setElement] = React.useState<SelectedElement | null>(null)
  const [previewEdit, setPreviewEdit] = React.useState<ElementEdit | null>(null)
  const [deselectKey, setDeselectKey] = React.useState(0)
  const [selectParentKey, setSelectParentKey] = React.useState(0)
  const [advanced, setAdvanced] = React.useState(false)
  const [inlineNotice, setInlineNotice] = React.useState<string | null>(null)
  const [codeJump, setCodeJump] = React.useState<{ path: string; line: number; nonce: number } | null>(null)
  const editingScreen = nodes.find((s) => s.id === editingId) ?? null

  const deselect = React.useCallback(() => {
    setElement(null)
    setPreviewEdit(null)
    setDeselectKey((k) => k + 1)
  }, [])

  // Element changes show in the screen right away but only reach the server
  // when Edit Mode is closed with Done: one merged edit per element, all sent
  // in one canvas-edit request.
  const pendingEdits = React.useRef(new Map<string, ElementEdit>())
  const [savingId, setSavingId] = React.useState<string | null>(null)
  const changeElement = React.useCallback((edit: ElementEdit) => {
    setPreviewEdit(edit)
    const prev = pendingEdits.current.get(edit.eid)
    // The first `from` is the text in the source; later ones are what the preview already shows.
    const from = prev?.from ?? edit.from
    const text = edit.text ?? prev?.text
    pendingEdits.current.set(edit.eid, {
      eid: edit.eid,
      from,
      text: text === from ? undefined : text,
      style: { ...prev?.style, ...edit.style },
      imageSrc: edit.imageSrc ?? prev?.imageSrc,
    })
  }, [])

  const applyElementEdits = agent.applyElementEdits
  const saveEdits = React.useCallback(
    async (screenId: string | null) => {
      const edits: ElementEdit[] = []
      for (const { style, ...edit } of pendingEdits.current.values()) {
        const hasStyle = !!style && Object.keys(style).length > 0
        if (edit.text !== undefined || hasStyle || edit.imageSrc !== undefined) edits.push({ ...edit, style: hasStyle ? style : undefined })
      }
      pendingEdits.current.clear()
      if (!edits.length) return
      setSavingId(screenId)
      const r = await applyElementEdits(edits)
      setSavingId(null)
      // A resync (e.g. an already-built project picking up a kit fix) can
      // move elements, so what failed is asked for again rather than guessed.
      const failed = r.error && (r.resynced ? "The preview updated behind the scenes, so make that change again." : r.error)
      if (failed) setInlineNotice(`Some changes weren't saved. ${failed}`)
    },
    [applyElementEdits]
  )

  // Unsaved edits live only in this tab until Done.
  React.useEffect(() => {
    const warn = (e: BeforeUnloadEvent) => {
      if (pendingEdits.current.size) e.preventDefault()
    }
    window.addEventListener("beforeunload", warn)
    return () => window.removeEventListener("beforeunload", warn)
  }, [])

  const toggleEdit = React.useCallback(
    (screen: ScreenNode) => {
      setInlineNotice(null)
      setElement(null)
      setPreviewEdit(null)
      // Done on this screen, or Edit on another: either way the open edits are finished.
      void saveEdits(editingId)
      setEditingId(editingId === screen.id ? null : screen.id)
      select(screen.id)
    },
    [editingId, saveEdits, select]
  )
  const selectElement = React.useCallback((_screenId: string, el: SelectedElement) => {
    setElement(el)
    setPreviewEdit(null)
  }, [])
  const moveElement = React.useCallback(
    (eid: string, rect: SelectedElement["rect"]) => setElement((el) => (el && el.eid === eid ? { ...el, rect } : el)),
    []
  )
  // A screen that stops being ready (e.g. rebuilt) can't be edited in place,
  // and its unsaved edits point at code that's being replaced.
  React.useEffect(() => {
    if (editingId && editingScreen?.state !== "ready") {
      pendingEdits.current.clear()
      setEditingId(null)
      setElement(null)
    }
  }, [editingId, editingScreen?.state])
  React.useEffect(() => {
    if (!inlineNotice) return
    const t = setTimeout(() => setInlineNotice(null), 5000)
    return () => clearTimeout(t)
  }, [inlineNotice])

  // The selected element rides along with the next chat message, so "make this button blue" is unambiguous.
  const attached = React.useMemo<ElementRef | null>(
    () =>
      element && editingScreen
        ? { eid: element.eid, tag: element.tag, text: element.text, screenId: editingScreen.id, screenName: editingScreen.name }
        : null,
    [element, editingScreen]
  )

  const viewElementInCode = () => {
    const m = element && /^(.*):(\d+):[^:]+$/.exec(element.eid)
    if (!m) return
    setCodeJump({ path: m[1], line: Number(m[2]), nonce: Date.now() })
    if (!isDesktop) setPane("preview")
  }

  // The AI edits the saved code, so unsaved canvas edits are saved first.
  const askAboutElement = async (instruction: string) => {
    if (!attached || !instruction) return
    deselect()
    await saveEdits(editingId)
    agent.sendMessage(instruction, attached.screenId, attached)
  }

  const inline: InlineEditing = {
    screenId: editingId,
    element,
    edit: previewEdit,
    deselectKey,
    selectParentKey,
    advanced,
    onAdvancedChange: setAdvanced,
    onToggle: toggleEdit,
    onSelectElement: selectElement,
    onDeselect: deselect,
    onSelectParent: () => setSelectParentKey((k) => k + 1),
    onRect: moveElement,
    onChange: changeElement,
    savingId,
    onViewCode: viewElementInCode,
    onAskAI: (instruction) => void askAboutElement(instruction),
    aiDisabled: agent.busy,
  }

  const send = async (text: string) => {
    const screenId = attached?.screenId ?? editTarget?.id
    const element = attached ?? undefined
    setEditTargetId(null)
    if (attached) deselect()
    await saveEdits(editingId)
    agent.sendMessage(text, screenId, element)
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
      onSend={(text) => void send(text)}
      onApprove={agent.approve}
      onRetry={agent.retry}
      onDismissError={agent.dismissError}
      editTarget={editTarget}
      onClearEditTarget={() => setEditTargetId(null)}
      attachedElement={attached}
      onClearAttachedElement={deselect}
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
      inline={inline}
      notice={agent.repairing ? `Fixing a crash in ${agent.screens.find((x) => x.path === agent.repairing)?.name ?? agent.repairing.split("/").pop()}…` : inlineNotice}
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
      jumpTo={codeJump}
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
      active={appActive}
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
        providers={agent.providers}
        agentBusy={agent.busy}
        onSetupBackend={agent.setupBackend}
        onBackendDisconnected={() => agent.setBackend(null)}
        onRefreshBackend={agent.refreshBackend}
        initialIsPublic={project.isPublic}
        initialPublicSlug={project.publicSlug}
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
