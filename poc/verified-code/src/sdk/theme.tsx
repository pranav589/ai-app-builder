import * as React from "react"

// @app/theme — design tokens. App code reads colors and spacing only from here.

export type Space = "none" | "xs" | "sm" | "md" | "lg" | "xl"
export type ColorToken = "primary" | "onPrimary" | "background" | "surface" | "text" | "textMuted" | "border" | "success" | "danger"

export type Theme = {
  mode: "light" | "dark"
  colors: Record<ColorToken, string>
  space: Record<Space, number>
  radius: { sm: number; md: number; lg: number; pill: number }
}

const ThemeContext = React.createContext<Theme | null>(null)

export function ThemeProvider({ theme, children }: { theme: Theme; children?: React.ReactNode }) {
  return <ThemeContext.Provider value={theme}>{children}</ThemeContext.Provider>
}

export function useTheme(): Theme {
  const theme = React.useContext(ThemeContext)
  if (!theme) throw new Error("useTheme() was called outside <ThemeProvider>.")
  return theme
}
