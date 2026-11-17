"use client"

import * as React from "react"

import type { AgentEvent, AgentPhase, BackendInfo, GeneratedScreen } from "@/lib/agent/types"
import type { DataModel } from "@/lib/app-runtime/data-model"
import type { ThemePackage } from "@/lib/app-runtime/theme"
import type { ChatMessage } from "./types"

type Action = "start" | "resume" | "message" | "approve" | "backend"
type Request = { action: Action; text?: string; screenId?: string; services?: string[] }

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
}) {
  const [phase, setPhase] = React.useState<AgentPhase>(initialPhase)
  const [messages, setMessages] = React.useState<ChatMessage[]>(initialMessages)
  const [streaming, setStreaming] = React.useState<{ id: string; text: string } | null>(null)
  const [status, setStatus] = React.useState<string | null>(null)
  const [planProgress, setPlanProgress] = React.useState<string[]>([])
  const [screens, setScreens] = React.useState<GeneratedScreen[]>(initialScreens)
  const [activeScreenId, setActiveScreenId] = React.useState<string | null>(null)
  const [name, setName] = React.useState(initialName)
  const [busy, setBusy] = React.useState(false)
  const [error, setError] = React.useState<AgentError | null>(null)
  const [themes, setThemes] = React.useState<ThemePackage | null>(initialThemes)
  const [dataModel, setDataModel] = React.useState<DataModel | null>(initialData)
  const [files, setFiles] = React.useState<Record<string, string>>(initialFiles)
  const [backend, setBackend] = React.useState<BackendInfo | null>(initialBackend)

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
          setPlanProgress([])
          break
      }
    },
    [scheduleFlush]
  )

  const send = React.useCallback(
    async (req: Request) => {
      setError(null)
      setBusy(true)
      setStatus(
        req.action === "approve" ? "Starting the build" : req.action === "message" ? "Sending" : req.action === "backend" ? "Connecting to CloudHike" : "Connecting to the agent"
      )
      try {
        const res = await fetch(`/api/projects/${projectId}/agent`, {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify(req),
        })
        if (!res.ok || !res.body) {
          const data = (await res.json().catch(() => ({}))) as { error?: string }
          setError({ message: data.error ?? "The agent couldn't start. Please try again.", retry: res.status === 409 ? undefined : req })
          return
        }
        const reader = res.body.pipeThrough(new TextDecoderStream()).getReader()
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
              if (event.type === "error") setError({ message: event.message, retry: event.retryable ? retryFor(req) : undefined })
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
        setStreaming((s) => (s && s.text ? s : null))
      }
    },
    [projectId, handle, flushCode]
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
    (text: string, screenId?: string) => {
      upsertMessage({ id: `local-${Date.now()}`, sender: "user", kind: "standard", text, createdAt: new Date().toISOString() })
      void send({ action: "message", text, screenId })
    },
    [send]
  )

  const approve = React.useCallback(() => {
    const text = "Looks good, start building."
    upsertMessage({ id: `local-${Date.now()}`, sender: "user", kind: "standard", text, createdAt: new Date().toISOString() })
    void send({ action: "approve", text })
  }, [send])

  /** Switches theme instantly in every screen, then saves the choice. */
  const setActiveTheme = React.useCallback(
    (themeId: string) => {
      let previous: string | undefined
      setThemes((t) => {
        previous = t?.activeId
        return t ? { ...t, activeId: themeId } : t
      })
      void fetch(`/api/projects/${projectId}/theme`, {
        method: "PATCH",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ themeId }),
      })
        .then((res) => {
          if (!res.ok) throw new Error(String(res.status))
        })
        .catch(() => {
          // Keep the look the server has, so a reload doesn't surprise anyone.
          if (previous) setThemes((t) => (t && t.activeId === themeId ? { ...t, activeId: previous! } : t))
        })
    },
    [projectId]
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
      const res = await fetch(`/api/projects/${projectId}/repair`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ path, message }),
      })
      if (res.status === 409) {
        // The agent is busy with other work: try once more later (this call still counts).
        waiting.current.set(path, message)
        retryLater = true
      } else if (res.ok) {
        const data = (await res.json()) as { fixed: boolean; path?: string; code?: string; screenId?: string }
        if (data.fixed && data.code) {
          if (data.screenId) setScreens((prev) => prev.map((s) => (s.id === data.screenId ? { ...s, code: data.code } : s)))
          else setFiles((prev) => ({ ...prev, [data.path!]: data.code! }))
        }
      }
    } catch {
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
  }, [projectId])

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

  return {
    phase,
    messages,
    streaming,
    status,
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
    /** Sets up (or repairs) the app's CloudHike backend; progress streams into the chat. */
    setupBackend: (services: string[]) => send({ action: "backend", services }),
  }
}
