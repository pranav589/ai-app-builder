"use client"

import * as React from "react"
import { AlertTriangle, Clock } from "lucide-react"
import { cn } from "cn"

import type { ScreenState } from "@/lib/agent/types"
import type { ElementEdit } from "@/lib/preview/protocol"
import { RuntimeFrame, useAppTheme, type FrameHandlers } from "./app-runtime"
import { DEVICE_HEIGHT, DEVICE_WIDTH } from "./dummy-data"

export type DevicePlatform = "ios" | "android"

/** Scale that fits the 390x844 design into the element. */
export function useDeviceScale(ref: React.RefObject<HTMLDivElement | null>) {
  const [scale, setScale] = React.useState(0)
  React.useLayoutEffect(() => {
    const el = ref.current
    if (!el) return
    const update = () => setScale(Math.min(el.clientWidth / DEVICE_WIDTH, el.clientHeight / DEVICE_HEIGHT))
    update()
    const ro = new ResizeObserver(update)
    ro.observe(el)
    return () => ro.disconnect()
  }, [ref])
  return scale
}

export function StatusBarOverlay({ platform }: { platform: DevicePlatform }) {
  const dark = useAppTheme()?.mode === "dark"
  return (
    <div
      className={cn(
        "pointer-events-none absolute inset-x-0 top-0 z-30 flex h-[54px] items-center justify-between px-8 text-[15px] font-semibold",
        dark ? "text-white/90" : "text-black/80 mix-blend-multiply"
      )}
    >
      <span>9:41</span>
      {platform === "ios" ? (
        <span className="h-[34px] w-[120px] rounded-full bg-black" />
      ) : (
        <span className="size-[18px] rounded-full bg-black" />
      )}
      <span className="flex items-center gap-1.5">
        <span className="h-[12px] w-[24px] rounded-[4px] border-[1.5px] border-current/60 p-px">
          <span className="block h-full w-3/4 rounded-[2px] bg-current/80" />
        </span>
      </span>
    </div>
  )
}

export function HomeIndicator() {
  const dark = useAppTheme()?.mode === "dark"
  return (
    <div className="pointer-events-none absolute inset-x-0 bottom-2 z-30 flex justify-center">
      <span className={cn("h-[5px] w-[134px] rounded-full", dark ? "bg-white/85" : "bg-black/80")} />
    </div>
  )
}

export function Placeholder({ state, name, error }: { state: ScreenState; name: string; error?: string }) {
  const theme = useAppTheme()
  // Placeholders sit in the app's own colors, so a dark theme stays dark.
  const tone = theme ? { background: theme.colors.background, color: theme.colors.textMuted } : undefined

  if (state === "error") {
    return (
      <div className="flex size-full flex-col items-center justify-center gap-3 bg-(--surface) p-10 text-center" style={tone}>
        <span className="flex size-14 items-center justify-center rounded-2xl bg-destructive/10">
          <AlertTriangle className="size-6 text-destructive" />
        </span>
        <p className="text-xl font-medium">{name} didn&apos;t build</p>
        <p className="text-base text-muted-foreground">{error ?? "Ask the agent to retry."}</p>
      </div>
    )
  }
  if (state === "pending") {
    return (
      <div className="flex size-full flex-col items-center justify-center gap-3 bg-(--surface) text-muted-foreground" style={tone}>
        <Clock className="size-8" />
        <p className="text-xl font-medium">Queued</p>
      </div>
    )
  }
  // Generating, before any markup has arrived.
  return (
    <div className="size-full animate-pulse space-y-6 bg-(--surface) px-8 pt-20" style={tone}>
      <div className="h-6 w-40 rounded-full bg-current/12" />
      <div className="h-11 w-64 rounded-2xl bg-current/12" />
      <div className="h-44 rounded-3xl bg-current/8" />
      {[0, 1, 2].map((i) => (
        <div key={i} className="flex items-center gap-4">
          <div className="size-14 rounded-2xl bg-current/12" />
          <div className="flex-1 space-y-3">
            <div className="h-4 w-3/4 rounded-full bg-current/12" />
            <div className="h-3 w-1/2 rounded-full bg-current/8" />
          </div>
        </div>
      ))}
    </div>
  )
}

/** A generated screen (or its placeholder) at device resolution, scaled to fill its parent. Static: no taps. */
export function ScreenView({
  id,
  name,
  state,
  code,
  error,
  appName,
  platform = "ios",
  editing,
}: {
  id: string
  name: string
  state: ScreenState
  code?: string
  error?: string
  appName: string
  platform?: DevicePlatform
  /** Edit Mode (inline editor): taps select elements instead of using the app. */
  editing?: {
    edit: ElementEdit | null
    deselectKey: unknown
    selectParentKey: unknown
    handlers: FrameHandlers
  }
}) {
  const ref = React.useRef<HTMLDivElement>(null)
  const scale = useDeviceScale(ref)
  const showApp = !!code && state === "ready"

  return (
    <div ref={ref} className="relative size-full overflow-hidden">
      <div
        className="absolute top-1/2 left-1/2 origin-center"
        style={{
          width: DEVICE_WIDTH,
          height: DEVICE_HEIGHT,
          transform: `translate(-50%, -50%) scale(${scale})`,
          visibility: scale ? "visible" : "hidden",
        }}
      >
        {showApp ? (
          <RuntimeFrame
            route={`/${id}`}
            mode="static"
            platform={platform}
            appName={appName}
            handlers={editing?.handlers}
            inspect={!!editing}
            edit={editing?.edit}
            deselectKey={editing?.deselectKey}
            selectParentKey={editing?.selectParentKey}
            className={cn("absolute inset-0 size-full border-0 bg-transparent", !editing && "pointer-events-none")}
            style={{ width: DEVICE_WIDTH, height: DEVICE_HEIGHT }}
          />
        ) : (
          <Placeholder state={state} name={name} error={error} />
        )}
        <StatusBarOverlay platform={platform} />
        <HomeIndicator />
        {state === "generating" && (
          <div className="pointer-events-none absolute inset-0 z-20 bg-gradient-to-b from-transparent via-primary/[0.06] to-transparent bg-[length:100%_200%] animate-[shimmer-y_2.4s_linear_infinite]" />
        )}
      </div>
    </div>
  )
}

/** A device bezel. Size it from outside with width/height. */
export function PhoneFrame({
  className,
  platform = "ios",
  children,
}: {
  className?: string
  platform?: DevicePlatform
  children: React.ReactNode
}) {
  const theme = useAppTheme()
  return (
    <div
      className={cn(
        "bg-foreground p-[7px] shadow-[0_30px_60px_-24px_rgba(17,17,17,0.35),0_0_0_1px_rgba(17,17,17,0.06)]",
        platform === "ios" ? "rounded-[44px]" : "rounded-[30px]",
        className
      )}
    >
      <div
        className={cn(
          "relative size-full overflow-hidden bg-(--surface)",
          platform === "ios" ? "rounded-[37px]" : "rounded-[23px]"
        )}
        // The app's own background, so no workspace color shows at the rounded edges.
        style={theme ? { background: theme.colors.background } : undefined}
      >
        {children}
      </div>
    </div>
  )
}
