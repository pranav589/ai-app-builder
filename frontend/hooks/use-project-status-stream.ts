"use client"

import * as React from "react"
import { useQueryClient, type QueryClient } from "@tanstack/react-query"

type StatusEvent = { table: "device_builds" | "builds" | "web_deployments" | "web_deploy_runs" } | { resync: true }

const KEYS = {
  device_builds: "device-build",
  builds: "project-builds",
  web_deployments: "project-web-deploy",
  web_deploy_runs: "project-web-deploy",
} as const

const ALL_KEYS = ["device-build", "project-builds", "project-web-deploy"] as const

// One EventSource per project, shared by every component that asked for it, so the publish
// dialog and the preview panel together hold a single connection.
const streams = new Map<string, { source: EventSource; users: number }>()

const QUIET_MS = 300
const MAX_WAIT_MS = 1000

function open(projectId: string, queryClient: QueryClient) {
  const source = new EventSource(`${process.env.NEXT_PUBLIC_API_URL}/api/projects/${projectId}/status-stream`, {
    withCredentials: true,
  })
  // One change often touches several rows (a run, then its deployment pointer), each sending its
  // own notification, and the writes are separate round trips to the database. Wait until the
  // notifications go quiet so every query refetches once, but never longer than MAX_WAIT_MS.
  const pending = new Set<string>()
  let flush: ReturnType<typeof setTimeout> | undefined
  let firstAt = 0
  const refetch = (...roots: readonly string[]) => {
    for (const root of roots) pending.add(root)
    if (flush) clearTimeout(flush)
    else firstAt = Date.now()
    const wait = Math.min(QUIET_MS, Math.max(0, firstAt + MAX_WAIT_MS - Date.now()))
    flush = setTimeout(() => {
      flush = undefined
      for (const root of pending) void queryClient.invalidateQueries({ queryKey: [root, projectId] })
      pending.clear()
    }, wait)
  }
  // The queries fetch themselves when their component mounts, so the first connect needs no
  // refetch. Every later open is an automatic reconnect: anything that changed while the
  // stream was down is picked up here.
  let firstOpen = true
  source.onopen = () => {
    if (firstOpen) firstOpen = false
    else refetch(...ALL_KEYS)
  }
  source.onmessage = (m) => {
    const e = JSON.parse(m.data) as StatusEvent
    refetch(...("resync" in e ? ALL_KEYS : [KEYS[e.table]]))
  }
  return source
}

/** Refetches the project's build and deploy queries the moment the backend reports a change. */
export function useProjectStatusStream(projectId: string, enabled: boolean) {
  const queryClient = useQueryClient()
  React.useEffect(() => {
    if (!enabled) return
    let entry = streams.get(projectId)
    if (!entry) streams.set(projectId, (entry = { source: open(projectId, queryClient), users: 0 }))
    entry.users++
    return () => {
      if (--entry.users > 0) return
      entry.source.close()
      streams.delete(projectId)
    }
  }, [projectId, enabled, queryClient])
}
