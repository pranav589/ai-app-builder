"use client"

import { AppRuntimeProvider } from "@/components/workspace/app-runtime"
import { AppPreview } from "@/components/workspace/app-preview"
import { PhoneFrame } from "@/components/workspace/screen-mock"
import { mergeScreensIntoFiles, plannedRoutesFromScreens } from "@/lib/app-runtime/app-doc"
import { activeThemeOf } from "@/lib/app-runtime/theme"
import type { ThemePackage } from "@/lib/app-runtime/theme"
import type { DataModel } from "@/lib/app-runtime/data-model"
import type { GeneratedScreen } from "@/lib/agent/types"

export type PublicProjectPayload = {
  id: string
  name: string
  themeColor: string | null
  screens: GeneratedScreen[]
  themes: ThemePackage | null
  dataModel: DataModel | null
  files: Record<string, string>
}

/**
 * Runs a public project's app interactively, always against a fresh
 * local-only backend (seeded from the project's own sample data) regardless
 * of what backend the owner actually connected — a visitor's taps never
 * reach the owner's real data.
 */
export function PublicAppPlayer({ data, className }: { data: PublicProjectPayload; className?: string }) {
  const theme = activeThemeOf(data.themes)
  const rootScreen = data.screens.find((s) => s.state === "ready") ?? data.screens[0] ?? null

  if (!rootScreen) {
    return <p className="text-sm text-muted-foreground">Nothing to preview yet.</p>
  }

  return (
    <PhoneFrame className={className}>
      <AppRuntimeProvider
        appId={data.id}
        theme={theme}
        themes={data.themes?.themes ?? (theme ? [theme] : [])}
        dataModel={data.dataModel}
        backendConfig={{ provider: "local" }}
        files={mergeScreensIntoFiles(data.files, data.screens)}
        planned={plannedRoutesFromScreens(data.screens)}
        active
      >
        <AppPreview rootId={rootScreen.id} platform="ios" appName={data.name} />
      </AppRuntimeProvider>
    </PhoneFrame>
  )
}
