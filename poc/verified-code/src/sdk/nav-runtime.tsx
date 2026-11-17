import * as React from "react"

// @app/nav-runtime — a small typed navigator. The generated "@/nav" module binds it to the
// manifest's screens, so navigating to a missing screen or with wrong params is a type error.
// On devices this module wraps expo-router; app code never sees the difference.

export type ParamList = Record<string, Record<string, string | number> | undefined>

type Entry = { screen: string; params?: Record<string, unknown> }

type NavValue = {
  stack: Entry[]
  go: (screen: string, params?: Record<string, unknown>) => void
  back: () => void
  switchTab: (screen: string) => void
}

const NavContext = React.createContext<NavValue | null>(null)

export function NavProvider({ initial, children }: { initial: Entry; children?: React.ReactNode }) {
  const [stack, setStack] = React.useState<Entry[]>([initial])
  const value = React.useMemo<NavValue>(
    () => ({
      stack,
      go: (screen, params) => setStack((s) => [...s, { screen, params }]),
      back: () => setStack((s) => (s.length > 1 ? s.slice(0, -1) : s)),
      switchTab: (screen) => setStack([{ screen }]),
    }),
    [stack]
  )
  return <NavContext.Provider value={value}>{children}</NavContext.Provider>
}

export function useNavState() {
  const v = React.useContext(NavContext)
  if (!v) throw new Error("Navigation hooks must be used inside <NavProvider>.")
  return v
}

/** One tuple per screen: [screen] or [screen, params]. A wrong screen name or missing params is a clear type error. */
export type GoArgs<P extends ParamList> = { [S in keyof P & string]: P[S] extends undefined ? [screen: S] : [screen: S, params: NonNullable<P[S]>] }[keyof P & string]

export function createNav<P extends ParamList>() {
  function useNav() {
    const v = useNavState()
    return {
      go: (...args: GoArgs<P>) => v.go(args[0], args[1] as Record<string, unknown> | undefined),
      back: v.back,
      canGoBack: v.stack.length > 1,
    }
  }
  function useParams<S extends keyof P & string>(_screen: S): P[S] extends undefined ? Record<string, never> : NonNullable<P[S]> {
    const v = useNavState()
    return (v.stack[v.stack.length - 1].params ?? {}) as never
  }
  return { useNav, useParams }
}
