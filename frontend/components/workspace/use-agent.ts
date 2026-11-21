"use client"

import * as React from "react"
import { useMutation, useQuery } from "@tanstack/react-query"

import type { AgentEvent, AgentPhase, BackendInfo, GeneratedScreen } from "@app/shared/agent/types"
import { providerInfo, type BackendProviderId, type BackendProviderStatus } from "@app/shared/app-backend/providers"
import type { DataModel } from "@app/shared/app-runtime/data-model"
import type { ThemePackage } from "@app/shared/app-runtime/theme"
import type { ElementEdit, ElementRef } from "@app/shared/preview/protocol"
import { apiClient, getApiErrorData, getApiErrorStatus } from "@/lib/api-client"
import type { ChatMessage } from "./types"

type CanvasEditResponse = {
  files?: Record<string, string>
  error?: string
  failed?: { eid: string; error: string }[]
  extraFiles?: Record<string, string>
}

type Action = "start" | "resume" | "message" | "approve" | "backend"
type Request = { action: Action; text?: string; screenId?: string; element?: ElementRef; provider?: BackendProviderId; services?: string[] }

export type AgentError = { message: string; retry?: Request }

// A retry re-attaches or continues; the user's message is already saved.
const retryFor = (req: Request): Request =>
  req.action === "message" || req.action === "approve" ? { action: "resume" } : req

const RUNNING: AgentPhase[] = ["draft", "planning", "generating"]
// Streaming code is pushed to the screen (and the Code tab) this often.
const CODE_FLUSH_MS = 400

export function useAgent({
  projectId,
  initialPhase,
  initialMessages,
  initialScreens,
  initialName,
  initialThemes,
  initialData,
  initialFiles,
  initialBackend,
  initialProviders,
}: {
  initialBackend: BackendInfo | null
  initialFiles: Record<string, string>
  initialThemes: ThemePackage | null
  initialData: DataModel | null
  projectId: string
  initialPhase: AgentPhase
  initialMessages: ChatMessage[]
  initialScreens: GeneratedScreen[]
  initialName: string
  /** Which backend providers the creator has linked. Can go stale (a disconnect in another tab, another project); refreshed on a failed backend action. */
  initialProviders: BackendProviderStatus[]
}) {
  const [phase, setPhase] = React.useState<AgentPhase>(initialPhase)
  const [messages, setMessages] = React.useState<ChatMessage[]>(initialMessages)
  const [streaming, setStreaming] = React.useState<{ id: string; text: string } | null>(null)
  const [status, setStatus] = React.useState<string | null>(null)
  /** When the current status label started (epoch ms), so the chat can count elapsed seconds itself. */
  const [statusSince, setStatusSince] = React.useState<number | null>(null)
  const [planProgress, setPlanProgress] = React.useState<string[]>([])
  const [screens, setScreens] = React.useState<GeneratedScreen[]>(initialScreens)
  const [activeScreenId, setActiveScreenId] = React.useState<string | null>(null)
  const [name, setName] = React.useState(initialName)
  const [busy, setBusy] = React.useState(false)
  const [error, setError] = React.useState<AgentError | null>(null)
  const [themes, setThemes] = React.useState<ThemePackage | null>(initialThemes)
  const [dataModel, setDataModel] = React.useState<DataModel | null>(initialData)
  const [files, setFiles] = React.useState<Record<string, string>>(initialFiles)
  const filesRef = React.useRef(files)
  filesRef.current = files
  const [backend, setBackend] = React.useState<BackendInfo | null>(initialBackend)
  const [providers, setProviders] = React.useState(initialProviders)

  const backendQuery = useQuery({
    queryKey: ["project-backend", projectId],
    queryFn: async () => {
      const res = await apiClient.get<{ providers: BackendProviderStatus[]; backend: BackendInfo | null }>(
        `/api/projects/${projectId}/backend`
      )
      return res.data
    },
    enabled: false,
  })

  /**
   * The provider links and backend state as the server sees them right
   * now: both are rendered once at page load and otherwise only move through
   * SSE events, so they can go stale (the account disconnected from another
   * tab or another project, or revoked directly on the provider's side). Called after
   * a "backend" action fails, so the header's next state (and the dialog's
   * needsAuth) reflect reality instead of repeating the same failure.
   */
  const refreshBackend = React.useCallback(async () => {
    try {
      const { data } = await backendQuery.refetch()
      if (!data) return
      setProviders(data.providers)
      setBackend(data.backend)
    } catch {
      // Keep whatever we had; the next action will try again.
    }
  }, [backendQuery])

  // Streaming code is buffered and flushed on a timer, not per token.
  const codeBuf = React.useRef(new Map<string, string>())
  const flushTimer = React.useRef<ReturnType<typeof setTimeout> | null>(null)
  const flushCode = React.useCallback(() => {
    flushTimer.current = null
    const buf = codeBuf.current
    if (!buf.size) return
    setScreens((prev) => prev.map((s) => (buf.has(s.id) ? { ...s, code: buf.get(s.id) } : s)))
  }, [])
  const scheduleFlush = React.useCallback(() => {
    flushTimer.current ??= setTimeout(flushCode, CODE_FLUSH_MS)
  }, [flushCode])

  const upsertMessage = (m: ChatMessage) =>
    setMessages((prev) => (prev.some((x) => x.id === m.id) ? prev.map((x) => (x.id === m.id ? { ...x, ...m } : x)) : [...prev, m]))

  const handle = React.useCallback(
    (e: AgentEvent) => {
      switch (e.type) {
        case "phase":
          setPhase(e.phase)
          break
        case "status":
          setStatus(e.text)
          setStatusSince(e.since ?? Date.now())
          break
        case "project":
          setName(e.name)
          break
        case "message_start":
          setStreaming({ id: e.id, text: "" })
          setPlanProgress([])
          break
        case "text":
          setStreaming((s) => (s && s.id === e.id ? { ...s, text: s.text + e.delta } : s))
          break
        case "plan_progress":
          setPlanProgress(e.screens)
          break
        case "message_done":
          upsertMessage(e.message)
          setStreaming((s) => (s?.id === e.message.id ? null : s))
          setPlanProgress([])
          break
        case "build_start":
          upsertMessage(e.message)
          codeBuf.current.clear()
          setScreens(e.screens)
          break
        case "files":
          setFiles(e.files)
          break
        case "foundation":
          setThemes(e.themes)
          setDataModel(e.data)
          break
        case "build_progress":
          setMessages((prev) => prev.map((m) => (m.id === e.messageId ? { ...m, build: e.build } : m)))
          break
        case "screen_start":
          codeBuf.current.set(e.id, "")
          setActiveScreenId(e.id)
          setScreens((prev) => prev.map((s) => (s.id === e.id ? { ...s, state: "generating", code: undefined, error: undefined } : s)))
          break
        case "screen_delta":
          codeBuf.current.set(e.id, (codeBuf.current.get(e.id) ?? "") + e.delta)
          scheduleFlush()
          break
        case "screen_done":
          codeBuf.current.delete(e.screen.id)
          setScreens((prev) => prev.map((s) => (s.id === e.screen.id ? e.screen : s)))
          break
        case "snapshot":
          // Joined a run that was already going (e.g. after a reload).
          setStatus(e.status)
          setStatusSince(e.status ? Date.now() : null)
          if (e.message) setStreaming(e.message)
          if (e.screen) {
            codeBuf.current.set(e.screen.id, e.screen.code)
            setActiveScreenId(e.screen.id)
            setScreens((prev) => prev.map((s) => (s.id === e.screen!.id ? { ...s, state: "generating" } : s)))
            scheduleFlush()
          }
          break
        case "backend":
          setBackend(e.backend)
          break
        case "error":
          setError({ message: e.message })
          setStreaming(null)
          break
        case "done":
          setStatus(null)
          setStatusSince(null)
          setPlanProgress([])
          break
      }
    },
    [scheduleFlush]
  )

  const agentMutation = useMutation({
    mutationFn: async (req: Request) => {
      const res = await apiClient.post<ReadableStream>(
        `/api/projects/${projectId}/agent`,
        req,
        {
          adapter: "fetch",
          responseType: "stream",
        }
      )
      return res
    },
  })

  const send = React.useCallback(
    async (req: Request) => {
      setError(null)
      setBusy(true)
      setStatus(
        req.action === "approve" ? "Starting the build" : req.action === "message" ? "Sending" : req.action === "backend" && req.provider ? `Connecting to ${providerInfo(req.provider).label}` : "Connecting to the agent"
      )
      setStatusSince(Date.now())
      try {
        let stream: ReadableStream | null = null
        try {
          const res = await agentMutation.mutateAsync(req)
          stream = res.data ?? (res.request?.response as Response | undefined)?.body ?? null
          if (!stream) {
            throw new Error("No response body")
          }
        } catch (err) {
          const status = getApiErrorStatus(err)
          const data = getApiErrorData<{ error?: string }>(err)
          // The account/backend state this request relied on may be stale (disconnected
          // elsewhere, revoked on the provider's side): resync it so the header and the
          // Connect dialog show what's actually true, instead of repeating the same failure.
          if (req.action === "backend") void refreshBackend()
          setError({ message: data?.error ?? "The agent couldn't start. Please try again.", retry: status === 409 ? undefined : req })
          return
        }
        const reader = stream.pipeThrough(new TextDecoderStream()).getReader()
        let buf = ""
        let sawDone = false
        for (;;) {
          const { value, done } = await reader.read()
          if (done) break
          buf += value
          let sep: number
          while ((sep = buf.indexOf("\n\n")) !== -1) {
            const chunk = buf.slice(0, sep)
            buf = buf.slice(sep + 2)
            const data = chunk
              .split("\n")
              .filter((l) => l.startsWith("data:"))
              .map((l) => l.slice(5).trimStart())
              .join("\n")
            if (!data) continue
            try {
              const event = JSON.parse(data) as AgentEvent
              if (event.type === "done") sawDone = true
              if (event.type === "error") {
                if (req.action === "backend") void refreshBackend()
                setError({ message: event.message, retry: event.retryable ? retryFor(req) : undefined })
              }
              else handle(event)
            } catch {
              // Ignore a malformed event rather than dropping the stream.
            }
          }
        }
        if (!sawDone) {
          setError({ message: "Lost the connection to the agent. It may still be working.", retry: { action: "resume" } })
        }
      } catch {
        setError({ message: "Lost the connection to the agent. It may still be working.", retry: { action: "resume" } })
      } finally {
        if (flushTimer.current) {
          clearTimeout(flushTimer.current)
          flushCode()
        }
        setBusy(false)
        setStatus(null)
        setStatusSince(null)
        setStreaming((s) => (s && s.text ? s : null))
      }
    },
    [projectId, handle, flushCode, refreshBackend, agentMutation]
  )

  // Start working as soon as the workspace opens on a fresh project, or
  // re-attach to a run that was going when the page was reloaded.
  const started = React.useRef(false)
  React.useEffect(() => {
    if (started.current) return
    started.current = true
    if (RUNNING.includes(initialPhase)) void send({ action: initialPhase === "draft" ? "start" : "resume" })
  }, [initialPhase, send])

  const sendMessage = React.useCallback(
    (text: string, screenId?: string, element?: ElementRef) => {
      upsertMessage({ id: `local-${Date.now()}`, sender: "user", kind: "standard", text, createdAt: new Date().toISOString(), element })
      void send({ action: "message", text, screenId, element })
    },
    [send]
  )

  const approve = React.useCallback(() => {
    const text = "Looks good, start building."
    upsertMessage({ id: `local-${Date.now()}`, sender: "user", kind: "standard", text, createdAt: new Date().toISOString() })
    void send({ action: "approve", text })
  }, [send])

  const themeMutation = useMutation({
    mutationFn: async (themeId: string) => {
      await apiClient.patch(`/api/projects/${projectId}/theme`, { themeId })
    },
  })

  /** Switches theme instantly in every screen, then saves the choice. */
  const setActiveTheme = React.useCallback(
    (themeId: string) => {
      let previous: string | undefined
      setThemes((t) => {
        previous = t?.activeId
        return t ? { ...t, activeId: themeId } : t
      })
      themeMutation.mutateAsync(themeId).catch(() => {
        // Keep the look the server has, so a reload doesn't surprise anyone.
        if (previous) setThemes((t) => (t && t.activeId === themeId ? { ...t, activeId: previous! } : t))
      })
    },
    [projectId, themeMutation]
  )

  // ---- Self-repair: a file that crashes in the preview is sent to the agent,
  // at most MAX_REPAIRS times per file per session, whatever the outcome
  // (fixed, not fixed, busy, server or network error). Never a loop.
  const MAX_REPAIRS = 2
  const BUSY_RETRY_MS = 8000
  const [repairing, setRepairing] = React.useState<string | null>(null)
  const repairCalls = React.useRef(new Map<string, number>()) // path -> calls made
  const waiting = React.useRef(new Map<string, string>()) // path -> latest crash message
  const repairBusy = React.useRef(false)
  const retryTimer = React.useRef<ReturnType<typeof setTimeout> | null>(null)
  const agentBusy = busy || phase === "generating" || phase === "planning"
  const agentBusyRef = React.useRef(agentBusy)
  agentBusyRef.current = agentBusy

  const repairMutation = useMutation({
    mutationFn: async ({ path, message }: { path: string; message: string }) => {
      const res = await apiClient.post<{ fixed: boolean; path?: string; code?: string; screenId?: string }>(
        `/api/projects/${projectId}/repair`,
        { path, message }
      )
      return res.data
    },
  })

  const pumpRepairs = React.useCallback(async () => {
    if (repairBusy.current || agentBusyRef.current || retryTimer.current) return
    const next = waiting.current.entries().next()
    if (next.done) return
    const [path, message] = next.value
    waiting.current.delete(path)
    const calls = repairCalls.current.get(path) ?? 0
    if (calls >= MAX_REPAIRS) return void pumpRepairs()
    repairCalls.current.set(path, calls + 1)
    repairBusy.current = true
    setRepairing(path)
    let retryLater = false
    try {
      const data = await repairMutation.mutateAsync({ path, message })
      if (data.fixed && data.code) {
        if (data.screenId) setScreens((prev) => prev.map((s) => (s.id === data.screenId ? { ...s, code: data.code } : s)))
        else setFiles((prev) => ({ ...prev, [data.path!]: data.code! }))
      }
    } catch (err) {
      if (getApiErrorStatus(err) === 409) {
        // The agent is busy with other work: try once more later (this call still counts).
        waiting.current.set(path, message)
        retryLater = true
      }
      // Network trouble: the call still counts toward the limit.
    } finally {
      repairBusy.current = false
      setRepairing(null)
      if (retryLater) {
        retryTimer.current = setTimeout(() => {
          retryTimer.current = null
          void pumpRepairs()
        }, BUSY_RETRY_MS)
      } else void pumpRepairs()
    }
  }, [repairMutation])

  React.useEffect(() => () => {
    if (retryTimer.current) clearTimeout(retryTimer.current)
  }, [])

  /** Called for every runtime error any frame reports. */
  const reportCrash = React.useCallback(
    (message: string, file?: string) => {
      if (!file || (repairCalls.current.get(file) ?? 0) >= MAX_REPAIRS) return
      waiting.current.set(file, message)
      void pumpRepairs()
    },
    [pumpRepairs]
  )

  // Crashes reported during a build are repaired once it finishes.
  React.useEffect(() => {
    if (!agentBusy) void pumpRepairs()
  }, [agentBusy, pumpRepairs])

  const retry = React.useCallback(() => {
    if (error?.retry) void send(error.retry)
  }, [error, send])

  const canvasEditMutation = useMutation({
    mutationFn: async (edits: ElementEdit[]) => {
      const res = await apiClient.post<CanvasEditResponse>(`/api/projects/${projectId}/canvas-edit`, { edits })
      return res.data
    },
  })

  /**
   * Canvas inspector edits (Phase 8, item 3), saved in one request: no AI
   * call, just the AST codemod and the usual gates. Applies the saved code
   * to whichever of `screens`/`files` holds each path, same as a repair
   * result. `error` is the first reason anything wasn't saved.
   */
  const applyElementEdits = React.useCallback(
    async (edits: ElementEdit[]): Promise<{ error?: string; resynced: boolean }> => {
      let data: CanvasEditResponse | undefined
      try {
        data = await canvasEditMutation.mutateAsync(edits)
      } catch (e) {
        // A refused batch (422) still carries the reason and any extraFiles.
        data = getApiErrorData<CanvasEditResponse>(e)
        if (!data) return { error: "Couldn't reach the server.", resynced: false }
      }
      // A platform file (e.g. a kit fix) that this project's stored copy
      // predates: picked up right away, whether or not the edits themselves
      // succeeded. The server keeps sending it until an edit is saved, so
      // only a copy that differs from what the preview already runs counts
      // as a resync.
      const extra = data.extraFiles
      const resynced = !!extra && Object.entries(extra).some(([p, c]) => filesRef.current[p] !== c)
      if (extra && resynced) setFiles((prev) => ({ ...prev, ...extra }))
      const saved = data.files
      if (saved) {
        setScreens((prev) => prev.map((s) => (s.path && saved[s.path] !== undefined ? { ...s, code: saved[s.path] } : s)))
        setFiles((prev) => {
          const next = { ...prev }
          for (const [p, c] of Object.entries(saved)) if (next[p] !== undefined) next[p] = c
          return next
        })
      }
      return { error: data.error ?? data.failed?.[0]?.error, resynced }
    },
    [canvasEditMutation]
  )

  return {
    phase,
    messages,
    streaming,
    status,
    statusSince,
    planProgress,
    screens,
    activeScreenId,
    name,
    setName,
    busy,
    error,
    themes,
    dataModel,
    files,
    reportCrash,
    repairing,
    setActiveTheme,
    sendMessage,
    approve,
    retry,
    dismissError: () => setError(null),
    backend,
    setBackend,
    providers,
    refreshBackend,
    /** Sets up (or repairs) the app's backend on `provider`; progress streams into the chat. */
    setupBackend: (provider: BackendProviderId, services: string[]) => send({ action: "backend", provider, services }),
    applyElementEdits,
  }
}
