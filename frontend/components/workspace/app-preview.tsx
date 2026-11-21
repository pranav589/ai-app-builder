"use client"

import * as React from "react"
import { AlertTriangle, Check, Copy, Mail, MessageCircle, MoreHorizontal, ScanFace, X } from "lucide-react"
import { cn } from "cn"

import { RuntimeFrame, useAppRuntime, type FrameHandlers } from "./app-runtime"
import { DEVICE_HEIGHT, DEVICE_WIDTH } from "./dummy-data"
import { HomeIndicator, StatusBarOverlay, useDeviceScale, type DevicePlatform } from "./screen-mock"
import type { ElementEdit, SelectedElement } from "@app/shared/preview/protocol"

// The running app inside the preview device: one frame running the whole
// React Native app (its own navigation), plus the system UI the app asks
// for (toasts, alerts, action and share sheets, Face ID, permission
// prompts, notification banners), drawn like the real OS.

// ---------------------------------------------------------------- system UI

type DialogAction = { label: string; value: string; style?: "cancel" | "destructive" | "default" }
type Dialog = { title: string; message?: string; actions: DialogAction[]; resolve: (v: string) => void }
type Toast = { id: number; text: string; tone: "default" | "success" | "error" }
type Sheet = { kind: "share"; text: string; resolve: (v: boolean) => void } | { kind: "actions"; title: string; actions: DialogAction[]; resolve: (v: string) => void }
type Banner = { id: number; title: string; body: string }

function useSystemUI(appName: string) {
  const [toasts, setToasts] = React.useState<Toast[]>([])
  const [dialog, setDialog] = React.useState<Dialog | null>(null)
  const [sheet, setSheet] = React.useState<Sheet | null>(null)
  const [biometric, setBiometric] = React.useState<"scanning" | "done" | null>(null)
  const [banner, setBanner] = React.useState<Banner | null>(null)
  const seq = React.useRef(0)
  const granted = React.useRef(new Set<string>())

  const toast = React.useCallback((text: string, tone: Toast["tone"] = "default") => {
    const id = ++seq.current
    setToasts((t) => [...t.slice(-2), { id, text, tone }])
    setTimeout(() => setToasts((t) => t.filter((x) => x.id !== id)), 2400)
  }, [])

  const ask = React.useCallback(
    (title: string, message: string | undefined, actions: DialogAction[]) =>
      new Promise<string>((resolve) => setDialog({ title, message, actions, resolve })),
    []
  )

  const showBanner = React.useCallback((title: string, body: string) => {
    const id = ++seq.current
    setBanner({ id, title, body })
    setTimeout(() => setBanner((b) => (b?.id === id ? null : b)), 3800)
  }, [])

  const permission = React.useCallback(
    async (what: string) => {
      if (granted.current.has(what)) return true
      const copy: Record<string, [string, string, string]> = {
        location: [`Allow “${appName}” to use your location?`, "Your location is used to show places and results near you.", "Allow While Using App"],
        notifications: [`“${appName}” Would Like to Send You Notifications`, "Notifications may include alerts, sounds and icon badges.", "Allow"],
        camera: [`“${appName}” Would Like to Access the Camera`, "The camera is used to take photos in the app.", "Allow"],
      }
      const [title, body, yes] = copy[what] ?? [`Allow “${appName}” to access ${what}?`, "", "Allow"]
      const v = await ask(title, body, [
        { label: "Don’t Allow", value: "no", style: "cancel" },
        { label: yes, value: "yes" },
      ])
      if (v === "yes") granted.current.add(what)
      return v === "yes"
    },
    [appName, ask]
  )

  const request = React.useCallback(
    async (method: string, args: Record<string, unknown>): Promise<unknown> => {
      const s = (k: string) => (typeof args[k] === "string" ? (args[k] as string) : "")
      if (method === "ui.toast") {
        toast(s("text"), (s("tone") as Toast["tone"]) || "default")
        return null
      }
      if (method === "ui.alert") {
        // Alert.alert(title, message, buttons): resolves with the tapped button's index.
        const buttons = (Array.isArray(args.buttons) ? args.buttons : [{ text: "OK" }]) as { text?: string; style?: string }[]
        const actions: DialogAction[] = buttons.map((b, i) => ({
          label: b.text || "OK",
          value: String(i),
          style: b.style === "cancel" ? "cancel" : b.style === "destructive" ? "destructive" : "default",
        }))
        const v = await ask(s("title") || appName, s("message") || undefined, actions)
        if (actions[Number(v)]?.style === "destructive") navigator.vibrate?.(8)
        return Number(v)
      }
      if (method === "ui.actionSheet") {
        const options = (Array.isArray(args.options) ? args.options : []) as string[]
        const cancel = typeof args.cancelButtonIndex === "number" ? args.cancelButtonIndex : -1
        const destructive = ([] as unknown[]).concat(args.destructiveButtonIndex ?? [])
        const v = await new Promise<string>((resolve) =>
          setSheet({
            kind: "actions",
            title: s("title") || s("message"),
            actions: options.map((label, i) => ({
              label,
              value: String(i),
              style: i === cancel ? "cancel" : destructive.includes(i) ? "destructive" : "default",
            })),
            resolve,
          })
        )
        return v === "cancel" ? (cancel >= 0 ? cancel : options.length - 1) : Number(v)
      }
      const kind = s("kind")
      const arg = s("arg")
      switch (kind) {
        case "haptic":
          navigator.vibrate?.(arg === "heavy" ? 20 : 8)
          return null
        case "share":
          return new Promise<boolean>((resolve) => setSheet({ kind: "share", text: s("text") || appName, resolve }))
        case "copy":
          await navigator.clipboard?.writeText(arg || s("text")).catch(() => {})
          toast("Copied to clipboard", "success")
          return true
        case "biometric": {
          setBiometric("scanning")
          await new Promise((r) => setTimeout(r, 1100))
          setBiometric("done")
          navigator.vibrate?.(10)
          await new Promise((r) => setTimeout(r, 600))
          setBiometric(null)
          return true
        }
        case "permission":
          return permission(arg)
        case "location": {
          if (!(await permission("location"))) return null
          return new Promise<{ latitude: number; longitude: number; label: string }>((resolve) => {
            const fallback = { latitude: 37.7749, longitude: -122.4194, label: "San Francisco" }
            if (!navigator.geolocation) return resolve(fallback)
            navigator.geolocation.getCurrentPosition(
              (p) => resolve({ latitude: p.coords.latitude, longitude: p.coords.longitude, label: "Current location" }),
              () => resolve(fallback),
              { timeout: 6000, maximumAge: 600_000 }
            )
          })
        }
        case "notify": {
          if (!(await permission("notifications"))) return false
          setTimeout(() => showBanner(s("text") || appName, arg || "Here’s your reminder."), 1600)
          return true
        }
        case "call":
        case "email":
        case "link": {
          const label = kind === "call" ? `Call ${arg}` : kind === "email" ? `Email ${arg}` : "Open in browser"
          const v = await new Promise<string>((resolve) =>
            setSheet({ kind: "actions", title: arg, actions: [{ label, value: "go" }, { label: "Cancel", value: "no", style: "cancel" }], resolve })
          )
          if (v !== "go") return false
          if (kind === "link" && /^https:\/\//.test(arg)) window.open(arg, "_blank", "noopener,noreferrer")
          else toast(kind === "call" ? "Opens the Phone app on a device" : kind === "email" ? "Opens Mail on a device" : "Opens the browser on a device")
          return true
        }
        default:
          toast("Available in the installed app")
          return null
      }
    },
    [appName, ask, permission, showBanner, toast]
  )

  const ui = (
    <SystemOverlay
      toasts={toasts}
      dialog={dialog}
      onDialog={(v) => {
        dialog?.resolve(v)
        setDialog(null)
      }}
      sheet={sheet}
      onSheet={(v) => {
        if (sheet?.kind === "share") sheet.resolve(v === "done")
        else sheet?.resolve(v)
        setSheet(null)
        if (sheet?.kind === "share" && v === "copy") {
          void navigator.clipboard?.writeText(sheet.text).catch(() => {})
          toast("Copied to clipboard", "success")
        } else if (sheet?.kind === "share" && v !== "cancel") toast("Shared", "success")
      }}
      biometric={biometric}
      banner={banner}
      appName={appName}
    />
  )
  return { request, toast, ui }
}

function SystemOverlay({
  toasts,
  dialog,
  onDialog,
  sheet,
  onSheet,
  biometric,
  banner,
  appName,
}: {
  toasts: Toast[]
  dialog: Dialog | null
  onDialog: (v: string) => void
  sheet: Sheet | null
  onSheet: (v: string) => void
  biometric: "scanning" | "done" | null
  banner: Banner | null
  appName: string
}) {
  const { theme } = useAppRuntime()
  const dark = theme?.mode === "dark"
  const glass = dark ? "bg-[#2c2c2e]/95 text-white" : "bg-white/95 text-[#111]"
  return (
    <>
      {/* Notification banner */}
      {banner && (
        <div key={banner.id} className="absolute inset-x-3 top-[52px] z-50 animate-in slide-in-from-top-6 fade-in-0 duration-300">
          <div className={cn("flex gap-3 rounded-[22px] p-3.5 shadow-xl backdrop-blur-xl", glass)}>
            <span className="flex size-10 shrink-0 items-center justify-center rounded-[10px] bg-(--app-primary) text-sm font-semibold text-(--app-on-primary)">
              {appName.slice(0, 1).toUpperCase()}
            </span>
            <span className="min-w-0 flex-1 text-[15px] leading-snug">
              <span className="flex justify-between">
                <b className="font-semibold">{banner.title}</b>
                <span className="text-[13px] opacity-50">now</span>
              </span>
              <span className="line-clamp-2 opacity-80">{banner.body}</span>
            </span>
          </div>
        </div>
      )}

      {/* Toasts */}
      <div className="pointer-events-none absolute inset-x-0 bottom-[112px] z-50 flex flex-col items-center gap-2">
        {toasts.map((t) => (
          <div
            key={t.id}
            role="status"
            className={cn(
              "flex max-w-[320px] items-center gap-2 rounded-full px-4 py-2.5 text-[15px] font-medium shadow-lg backdrop-blur-xl animate-in fade-in-0 slide-in-from-bottom-3 zoom-in-95 duration-200",
              dark ? "bg-white/95 text-[#111]" : "bg-[#1c1c1e]/92 text-white"
            )}
          >
            {t.tone === "success" && <Check className="size-4 shrink-0 text-emerald-400" strokeWidth={2.5} />}
            {t.tone === "error" && <AlertTriangle className="size-4 shrink-0 text-red-400" />}
            <span className="truncate">{t.text}</span>
          </div>
        ))}
      </div>

      {/* Alert */}
      {dialog && (
        <div className="absolute inset-0 z-50 flex items-center justify-center bg-black/35 animate-in fade-in-0 duration-150">
          <div role="alertdialog" aria-label={dialog.title} className={cn("w-[270px] overflow-hidden rounded-[14px] text-center backdrop-blur-xl animate-in zoom-in-110 fade-in-0 duration-200", glass)}>
            <div className="px-4 pt-5 pb-4">
              <p className="text-[17px] leading-snug font-semibold">{dialog.title}</p>
              {dialog.message && <p className="mt-1 text-[13px] leading-snug opacity-75">{dialog.message}</p>}
            </div>
            <div className={cn("grid border-t", dialog.actions.length === 2 ? "grid-cols-2" : "grid-cols-1", dark ? "border-white/15" : "border-black/10")}>
              {dialog.actions.map((a, i) => (
                <button
                  key={a.value}
                  type="button"
                  onClick={() => onDialog(a.value)}
                  className={cn(
                    "h-11 text-[17px] transition-colors active:bg-black/5",
                    i > 0 && (dark ? "border-l border-white/15" : "border-l border-black/10"),
                    a.style === "destructive" ? "font-semibold text-[#ff3b30]" : a.style === "cancel" ? "text-[#0a84ff]" : "font-semibold text-[#0a84ff]"
                  )}
                >
                  {a.label}
                </button>
              ))}
            </div>
          </div>
        </div>
      )}

      {/* Share / action sheets */}
      {sheet && (
        <div className="absolute inset-0 z-50 flex flex-col justify-end bg-black/35 animate-in fade-in-0 duration-150" onClick={() => onSheet("cancel")}>
          <div className="space-y-2 px-2 pb-[34px] animate-in slide-in-from-bottom-10 duration-300" onClick={(e) => e.stopPropagation()}>
            {sheet.kind === "share" ? (
              <div className={cn("rounded-[14px] p-4 backdrop-blur-xl", glass)}>
                <div className="mb-4 flex items-center gap-3">
                  <span className="flex size-11 items-center justify-center rounded-[10px] bg-(--app-primary) font-semibold text-(--app-on-primary)">
                    {appName.slice(0, 1).toUpperCase()}
                  </span>
                  <span className="min-w-0">
                    <span className="block truncate text-[15px] font-semibold">{sheet.text}</span>
                    <span className="block text-[13px] opacity-60">{appName}</span>
                  </span>
                  <button type="button" aria-label="Close" onClick={() => onSheet("cancel")} className="ml-auto flex size-7 items-center justify-center rounded-full bg-black/10">
                    <X className="size-4" />
                  </button>
                </div>
                <div className="grid grid-cols-4 gap-2 text-center text-[11px]">
                  {[
                    { v: "messages", label: "Messages", icon: MessageCircle, bg: "bg-[#34c759]" },
                    { v: "mail", label: "Mail", icon: Mail, bg: "bg-[#0a84ff]" },
                    { v: "copy", label: "Copy", icon: Copy, bg: "bg-[#8e8e93]" },
                    { v: "more", label: "More", icon: MoreHorizontal, bg: "bg-[#8e8e93]/60" },
                  ].map((o) => (
                    <button key={o.v} type="button" onClick={() => onSheet(o.v)} className="flex flex-col items-center gap-1.5">
                      <span className={cn("flex size-14 items-center justify-center rounded-[14px] text-white", o.bg)}>
                        <o.icon className="size-6" />
                      </span>
                      {o.label}
                    </button>
                  ))}
                </div>
              </div>
            ) : (
              <div className={cn("overflow-hidden rounded-[14px] text-center backdrop-blur-xl", glass)}>
                <p className="border-b border-black/10 px-4 py-3 text-[13px] opacity-60">{sheet.title}</p>
                {sheet.actions
                  .filter((a) => a.style !== "cancel")
                  .map((a) => (
                    <button key={a.value} type="button" onClick={() => onSheet(a.value)} className={cn("block h-14 w-full text-[19px]", a.style === "destructive" ? "text-[#ff3b30]" : "text-[#0a84ff]")}>
                      {a.label}
                    </button>
                  ))}
              </div>
            )}
            <button
              type="button"
              onClick={() => onSheet("cancel")}
              className={cn("h-14 w-full rounded-[14px] text-[19px] font-semibold text-[#0a84ff] backdrop-blur-xl", glass)}
            >
              Cancel
            </button>
          </div>
        </div>
      )}

      {/* Face ID */}
      {biometric && (
        <div className="absolute inset-0 z-50 flex items-center justify-center animate-in fade-in-0 duration-150">
          <div className={cn("flex size-[150px] flex-col items-center justify-center gap-3 rounded-[28px] backdrop-blur-xl", glass)}>
            {biometric === "scanning" ? (
              <ScanFace className="size-14 animate-pulse" strokeWidth={1.25} />
            ) : (
              <Check className="size-14 text-emerald-500 animate-in zoom-in-50 duration-200" strokeWidth={1.5} />
            )}
            <span className="text-[15px] font-medium">Face ID</span>
          </div>
        </div>
      )}
    </>
  )
}

// ---------------------------------------------------------------- the running app

export function AppPreview({
  rootId,
  platform,
  appName,
  restartKey,
  onTopChange,
  onError,
  inspect,
  edit,
  onSelectElement,
}: {
  rootId: string | null
  platform: DevicePlatform
  appName: string
  /** Changing it restarts the app on rootId. */
  restartKey?: unknown
  onTopChange?: (screenId: string) => void
  onError?: (message: string) => void
  /** Hover/select elements for the canvas inspector. */
  inspect?: boolean
  edit?: ElementEdit | null
  onSelectElement?: (el: SelectedElement) => void
}) {
  const { theme } = useAppRuntime()
  const ref = React.useRef<HTMLDivElement>(null)
  const scale = useDeviceScale(ref)
  const system = useSystemUI(appName)
  const colors = theme?.colors ?? null

  const handlers: FrameHandlers = React.useMemo(
    () => ({
      onNative: system.request,
      onRoute: (pathname) => onTopChange?.(pathname.replace(/^\//, "") || rootId || ""),
      onError: (message) => onError?.(message),
      onSelectElement,
    }),
    [system.request, onTopChange, onError, rootId, onSelectElement]
  )

  const themeVars = {
    "--app-primary": colors?.primary ?? "#2f5bea",
    "--app-on-primary": colors?.onPrimary ?? "#fff",
  } as React.CSSProperties

  return (
    <div ref={ref} className="relative size-full overflow-hidden" style={themeVars}>
      <div
        className="absolute top-1/2 left-1/2 origin-center overflow-hidden"
        style={{
          width: DEVICE_WIDTH,
          height: DEVICE_HEIGHT,
          transform: `translate(-50%, -50%) scale(${scale})`,
          visibility: scale ? "visible" : "hidden",
          background: colors?.background,
        }}
      >
        {rootId ? (
          <RuntimeFrame
            route={`/${rootId}`}
            mode="interactive"
            platform={platform}
            appName={appName}
            handlers={handlers}
            resetKey={restartKey}
            inspect={inspect}
            edit={edit}
            className="absolute inset-0 size-full border-0 bg-transparent"
            style={{ width: DEVICE_WIDTH, height: DEVICE_HEIGHT }}
          />
        ) : (
          <div className="flex size-full items-center justify-center p-10 text-center text-base text-muted-foreground">Nothing to run yet</div>
        )}
        {system.ui}
        <StatusBarOverlay platform={platform} />
        <HomeIndicator />
      </div>
    </div>
  )
}

/** Exposed for the preview toolbar. */
export function useResetAppData() {
  return useAppRuntime().resetData
}
