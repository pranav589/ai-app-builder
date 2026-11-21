import type { AgentEvent } from "@app/shared/agent/types"

// What the orchestrator writes to while it works. The run's events are
// persisted (lib/agent/run-store.ts) and streamed to the workspace from the
// database, so a run can execute in a Cloudhike Jobs worker, in this process,
// or anywhere else, and a reloaded page can join it.
export type LiveRun = {
  projectId: string
  /** The agent_runs row this run is persisted under, when there is one. */
  runId?: string
  emit: (e: AgentEvent) => void
}

export type RunSnapshot = {
  status: string | null
  message?: { id: string; text: string }
  screen?: { id: string; code: string }
}

/** Folds a run's events into what a late subscriber needs to catch up. */
export function foldSnapshot(events: Iterable<AgentEvent>): RunSnapshot {
  const s: RunSnapshot = { status: null }
  for (const e of events) {
    switch (e.type) {
      case "status":
        s.status = e.text
        break
      case "message_start":
        s.message = { id: e.id, text: "" }
        break
      case "text":
        if (s.message?.id === e.id) s.message.text += e.delta
        break
      case "message_done":
        s.message = undefined
        break
      case "screen_start":
        s.screen = { id: e.id, code: "" }
        break
      case "screen_delta":
        if (s.screen?.id === e.id) s.screen.code += e.delta
        break
      case "screen_done":
        s.screen = undefined
        break
    }
  }
  return s
}
