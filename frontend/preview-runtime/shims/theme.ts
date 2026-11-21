// "@/theme" in the preview. Same API as the generated theme/index.tsx that
// ships with the app (lib/app-project/templates.ts), but fed live by the
// host, so switching theme re-renders every screen without a rebuild.

import * as React from "react"
import type { AppTheme } from "@app/shared/app-runtime/theme"
import { rpc, themeStore } from "../bridge"

const RADII = {
  sharp: { sm: 4, md: 6, lg: 8, xl: 12, pill: 999 },
  soft: { sm: 8, md: 12, lg: 16, xl: 24, pill: 999 },
  round: { sm: 12, md: 18, lg: 24, xl: 32, pill: 999 },
}

export const spacing = { xxs: 2, xs: 4, sm: 8, md: 12, lg: 16, xl: 24, xxl: 32, xxxl: 48 }

export type Theme = {
  id: string
  name: string
  mode: "light" | "dark"
  dark: boolean
  colors: AppTheme["colors"] & { overlay: string }
  radius: (typeof RADII)["soft"]
  spacing: typeof spacing
}

const cache = new WeakMap<AppTheme, Theme>()
export function toTheme(t: AppTheme): Theme {
  let out = cache.get(t)
  if (!out) {
    out = {
      id: t.id,
      name: t.name,
      mode: t.mode,
      dark: t.mode === "dark",
      colors: { ...t.colors, overlay: t.mode === "dark" ? "rgba(0,0,0,0.6)" : "rgba(15,18,25,0.38)" },
      radius: RADII[t.radius] ?? RADII.soft,
      spacing,
    }
    cache.set(t, out)
  }
  return out
}

const useStore = () => React.useSyncExternalStore(themeStore.subscribe, themeStore.get)

export function useTheme(): Theme {
  return toTheme(useStore().theme)
}

/** Styles that follow the theme: const useStyles = createStyles((t) => ({ ... })) */
export function createStyles<T>(factory: (t: Theme) => T): () => T {
  const memo = new WeakMap<Theme, T>()
  return function useStyles() {
    const t = useTheme()
    let s = memo.get(t)
    if (!s) {
      s = factory(t)
      memo.set(t, s)
    }
    return s
  }
}

export function ThemeProvider({ children }: { children?: React.ReactNode }) {
  return React.createElement(React.Fragment, null, children)
}

export function useThemeSwitcher() {
  const s = useStore()
  return {
    themes: s.themes.map(toTheme),
    activeId: s.theme.id,
    setTheme: (id: string) => void rpc("theme.set", { id }),
  }
}

export default { useTheme, createStyles, ThemeProvider, useThemeSwitcher, spacing }
