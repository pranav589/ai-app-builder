"use client"

import * as React from "react"
import { useQueryClient } from "@tanstack/react-query"

type StatusEvent = { table: "device_builds" | "builds" | "web_deployments" | "web_deploy_runs" } | { resync: true }

const KEYS = {
  device_builds: "device-build",
  builds: "project-builds",
  web_deployments: "project-web-deploy",
  web_deploy_runs: "project-web-deploy",
} as const

const ALL_KEYS = ["device-build", "project-builds", "project-web-deploy"] as const

const QUIET_MS = 300
const MAX_WAIT_MS = 1000

/**
 * Keeps the project's build and deploy queries current for as long as the workspace is open.
 * Mounted once per workspace; because it is always connected, those queries can use
 * `staleTime: Infinity` and are only refetched when the backend reports a change.
 */
export function useProjectStatusStream(projectId: string) {
  const queryClient = useQueryClient()
  React.useEffect(() => {
    const source = new EventSource(`${process.env.NEXT_PUBLIC_API_URL}/api/projects/${projectId}/status-stream`, {
      withCredentials: true,
    })
    // One change often touches several rows (a run, then its deployment pointer), each sending
    // its own notification. Wait until the notifications go quiet so every query refetches once,
    // but never longer than MAX_WAIT_MS.
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
    // The first open happens before any of these queries has fetched, so it needs no refetch.
    // Every later open is an automatic reconnect: anything that changed while the stream was
    // down is picked up here.
    let firstOpen = true
    source.onopen = () => {
      if (firstOpen) firstOpen = false
      else refetch(...ALL_KEYS)
    }
    source.onmessage = (m) => {
      const e = JSON.parse(m.data) as StatusEvent
      refetch(...("resync" in e ? ALL_KEYS : [KEYS[e.table]]))
    }
    return () => {
      if (flush) clearTimeout(flush)
      source.close()
    }
  }, [projectId, queryClient])
}
