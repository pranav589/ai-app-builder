"use client"

import * as React from "react"
import { Check, ChevronDown, Moon, Palette, Sun } from "lucide-react"
import { cn } from "cn"

import type { AppTheme, ThemePackage } from "@app/shared/app-runtime/theme"
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuGroup,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu"

function Swatch({ theme, size = "md" }: { theme: AppTheme; size?: "sm" | "md" }) {
  const c = theme.colors
  return (
    // A tiny preview of the theme: background, a surface card, primary and accent.
    <span
      aria-hidden
      className={cn(
        "relative inline-flex shrink-0 overflow-hidden rounded-[6px] ring-1 ring-black/10",
        size === "sm" ? "h-5 w-7" : "h-7 w-10"
      )}
      style={{ background: c.background }}
    >
      <span className="absolute inset-y-[22%] left-[14%] w-[44%] rounded-[3px]" style={{ background: c.surface, boxShadow: `0 0 0 0.5px ${c.border}` }} />
      <span className="absolute top-[22%] right-[12%] size-[30%] rounded-full" style={{ background: c.primary }} />
      <span className="absolute right-[12%] bottom-[18%] size-[22%] rounded-full" style={{ background: c.accent }} />
    </span>
  )
}

/** Live theme picker. Switching only swaps CSS variables in every screen. */
export function ThemeSwitcher({
  themes,
  onChange,
  building,
}: {
  themes: ThemePackage | null
  onChange: (id: string) => void
  /** The package is being generated right now. */
  building: boolean
}) {
  if (!themes?.themes.length) {
    if (!building) return null
    return (
      <div className="flex h-9 items-center gap-2 rounded-full border border-border bg-background px-3.5 text-[13px] text-muted-foreground shadow-sm">
        <Palette className="size-4 animate-pulse" /> Creating theme package…
      </div>
    )
  }
  const active = themes.themes.find((t) => t.id === themes.activeId) ?? themes.themes[0]

  return (
    <DropdownMenu>
      <DropdownMenuTrigger
        aria-label={`Theme: ${active.name}. Change theme`}
        className="group flex h-9 items-center gap-2 rounded-full border border-border bg-background py-1 pr-3 pl-1.5 text-[13px] font-medium shadow-sm outline-none transition-colors hover:bg-muted aria-expanded:bg-muted focus-visible:ring-3 focus-visible:ring-ring/50"
      >
        <Swatch theme={active} size="sm" />
        <span className="max-w-32 truncate">{active.name}</span>
        <ChevronDown className="size-3.5 text-muted-foreground transition-transform group-aria-expanded:rotate-180" />
      </DropdownMenuTrigger>
      <DropdownMenuContent align="center" sideOffset={8} className="w-64 p-1.5">
        <DropdownMenuGroup>
          <DropdownMenuLabel className="flex items-center justify-between">
            Theme package <span className="font-normal tabular-nums">{themes.themes.length} themes</span>
          </DropdownMenuLabel>
          {themes.themes.map((t) => (
            <DropdownMenuItem key={t.id} onClick={() => onChange(t.id)} className="gap-3 py-1.5">
              <Swatch theme={t} />
              <span className="min-w-0 flex-1">
                <span className="block truncate font-medium">{t.name}</span>
                <span className="flex items-center gap-1 text-xs text-muted-foreground">
                  {t.mode === "dark" ? <Moon className="size-3" /> : <Sun className="size-3" />}
                  {t.mode === "dark" ? "Dark" : "Light"}
                  {t.id === "original" && " · from your plan"}
                </span>
              </span>
              {t.id === active.id && <Check className="size-4 text-primary" />}
            </DropdownMenuItem>
          ))}
        </DropdownMenuGroup>
        <DropdownMenuSeparator />
        <p className="px-2 py-1.5 text-xs leading-relaxed text-muted-foreground">
          Every screen uses theme tokens, so switching is instant and nothing is rebuilt.
        </p>
      </DropdownMenuContent>
    </DropdownMenu>
  )
}
