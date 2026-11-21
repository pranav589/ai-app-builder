"use client"

import * as React from "react"
import { Sparkles } from "lucide-react"

import { AppRuntimeProvider } from "@/components/workspace/app-runtime"
import { ScreenView } from "@/components/workspace/screen-mock"
import { plannedRoutesFromScreens, projectFilesFromDoc, readAppDoc } from "@app/shared/app-runtime/app-doc"
import { activeThemeOf } from "@app/shared/app-runtime/theme"

/** True once the element has scrolled into view; stays true afterward. */
function useInView<T extends HTMLElement>() {
  const ref = React.useRef<T>(null)
  const [inView, setInView] = React.useState(false)
  React.useEffect(() => {
    const el = ref.current
    if (!el || inView) return
    const io = new IntersectionObserver(
      ([entry]) => {
        if (entry.isIntersecting) setInView(true)
      },
      { rootMargin: "200px" }
    )
    io.observe(el)
    return () => io.disconnect()
  }, [inView])
  return { ref, inView }
}

function PlaceholderPreview() {
  return (
    <div className="relative flex h-52 items-end justify-center overflow-hidden bg-(--surface) bg-[radial-gradient(ellipse_80%_70%_at_50%_0%,color-mix(in_oklch,var(--action),transparent_92%),transparent)]">
      <div className="w-36 translate-y-4 rounded-t-3xl border border-b-0 border-border bg-background p-3 pb-10 shadow-[0_-8px_30px_-12px_rgba(17,17,17,0.2)] transition-transform duration-300 group-hover:-translate-y-0">
        <div className="mx-auto mb-3 h-1 w-10 rounded-full bg-foreground/10" />
        <div className="flex items-center gap-2">
          <span className="flex size-8 items-center justify-center rounded-xl bg-primary text-primary-foreground">
            <Sparkles className="size-4" />
          </span>
          <div className="space-y-1.5">
            <div className="h-1.5 w-14 rounded-full bg-foreground/15" />
            <div className="h-1.5 w-9 rounded-full bg-foreground/8" />
          </div>
        </div>
        <div className="mt-3 h-12 rounded-xl bg-(--surface)" />
        <div className="mt-2 h-2 w-full rounded-full bg-(--surface)" />
        <div className="mt-2 h-2 w-2/3 rounded-full bg-(--surface)" />
      </div>
    </div>
  )
}

/**
 * A live mini render of a project's first screen, lazily mounted only once
 * the card scrolls into view. Always reflects the latest generated screens
 * (no captured/stale screenshot) by reusing the same sandboxed runtime the
 * workspace preview and canvas use.
 */
export function CardPreview({
  projectId,
  name,
  previewScreens,
}: {
  projectId: string
  name: string
  previewScreens: unknown
}) {
  const { ref, inView } = useInView<HTMLDivElement>()
  const doc = React.useMemo(() => readAppDoc(previewScreens), [previewScreens])
  const screen = doc.screens.find((s) => s.state === "ready") ?? doc.screens[0] ?? null
  const files = React.useMemo(() => projectFilesFromDoc(doc), [doc])
  const theme = activeThemeOf(doc.themes)

  return (
    <div ref={ref} className="relative h-52 overflow-hidden bg-(--surface)">
      {inView && screen ? (
        <AppRuntimeProvider
          appId={projectId}
          theme={theme}
          themes={doc.themes?.themes ?? (theme ? [theme] : [])}
          dataModel={doc.data ?? null}
          backendConfig={{ provider: "local" }}
          files={files}
          planned={plannedRoutesFromScreens(doc.screens)}
          active={inView}
        >
          <ScreenView id={screen.id} name={screen.name} state={screen.state} code={screen.code} error={screen.error} appName={name} />
        </AppRuntimeProvider>
      ) : (
        <PlaceholderPreview />
      )}
    </div>
  )
}
