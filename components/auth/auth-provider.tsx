"use client"

import * as React from "react"

import { AuthDialog } from "@/components/auth/auth-dialog"

export type AuthUser = {
  id: string
  name: string | null
  email: string
  credits: number
}

export type AuthMode = "sign-in" | "sign-up"
export type SocialProvider = "github" | "google"

type OpenOptions = {
  mode?: AuthMode
  /** Runs once, after a successful sign-in or sign-up from this dialog. */
  onSuccess?: (user: AuthUser) => void
  /** Runs just before the browser leaves for GitHub/Google; use it to stash state. */
  onBeforeSocialRedirect?: () => void
}

type AuthContextValue = {
  user: AuthUser | null
  isPending: boolean
  openAuthDialog: (options?: OpenOptions) => void
  signOut: () => Promise<void>
}

const AuthContext = React.createContext<AuthContextValue | null>(null)

export function useAuth() {
  const ctx = React.useContext(AuthContext)
  if (!ctx) throw new Error("useAuth must be used inside <AuthProvider>")
  return ctx
}

// A token in the URL is only honoured if this tab started a social sign-in recently.
// Without this, a crafted "#token=..." link could sign a visitor into someone else's account.
const SOCIAL_FLOW_KEY = "ch_social_flow"
const SOCIAL_FLOW_TTL_MS = 10 * 60 * 1000

function consumeSocialFlow() {
  try {
    const started = Number(sessionStorage.getItem(SOCIAL_FLOW_KEY))
    sessionStorage.removeItem(SOCIAL_FLOW_KEY)
    return Boolean(started) && Date.now() - started < SOCIAL_FLOW_TTL_MS
  } catch {
    return false
  }
}

type InitResult = { user: AuthUser | null; error: string | null }

// Runs once per page load (shared across React Strict Mode's double effect).
let initPromise: Promise<InitResult> | null = null

function initAuth(): Promise<InitResult> {
  initPromise ??= (async () => {
    const params = new URLSearchParams(location.hash.slice(1))
    const token = params.get("token")
    const providerError = params.get("error")

    if (token || providerError) {
      history.replaceState(null, "", location.pathname + location.search)
      const trusted = consumeSocialFlow()

      if (trusted && token) {
        try {
          const res = await fetch("/api/auth/social", {
            method: "POST",
            headers: { "content-type": "application/json" },
            body: JSON.stringify({ token }),
          })
          const data = await res.json().catch(() => ({}))
          if (res.ok) return { user: data.user as AuthUser, error: null }
          return { user: null, error: data.error ?? "We couldn't sign you in. Try again." }
        } catch {
          return { user: null, error: "Network error. Check your connection and try again." }
        }
      }
      if (trusted && providerError) {
        return {
          user: null,
          error:
            providerError === "access_denied"
              ? "Sign-in was cancelled."
              : "We couldn't complete sign-in with that provider. Try again.",
        }
      }
    }

    try {
      const res = await fetch("/api/auth/session", { cache: "no-store" })
      const data = await res.json()
      return { user: (data.user as AuthUser | null) ?? null, error: null }
    } catch {
      return { user: null, error: null }
    }
  })()
  return initPromise
}

export function AuthProvider({ children }: { children: React.ReactNode }) {
  const [user, setUser] = React.useState<AuthUser | null>(null)
  const [isPending, setIsPending] = React.useState(true)
  const [dialog, setDialog] = React.useState<{
    open: boolean
    mode: AuthMode
    error: string | null
  }>({ open: false, mode: "sign-in", error: null })
  const onSuccessRef = React.useRef<OpenOptions["onSuccess"]>(undefined)
  const onBeforeRedirectRef = React.useRef<OpenOptions["onBeforeSocialRedirect"]>(undefined)

  React.useEffect(() => {
    initAuth().then(({ user, error }) => {
      setUser(user)
      setIsPending(false)
      if (error) setDialog({ open: true, mode: "sign-in", error })
    })
  }, [])

  const openAuthDialog = React.useCallback((options: OpenOptions = {}) => {
    onSuccessRef.current = options.onSuccess
    onBeforeRedirectRef.current = options.onBeforeSocialRedirect
    setDialog({ open: true, mode: options.mode ?? "sign-in", error: null })
  }, [])

  const closeDialog = React.useCallback(() => {
    onSuccessRef.current = undefined
    onBeforeRedirectRef.current = undefined
    setDialog((d) => ({ ...d, open: false, error: null }))
  }, [])

  const handleSuccess = React.useCallback((next: AuthUser) => {
    const callback = onSuccessRef.current
    onSuccessRef.current = undefined
    onBeforeRedirectRef.current = undefined
    setUser(next)
    setDialog((d) => ({ ...d, open: false, error: null }))
    // Let the signed-in UI render before resuming whatever the user was doing.
    if (callback) setTimeout(() => callback(next), 0)
  }, [])

  const startSocialSignIn = React.useCallback((provider: SocialProvider) => {
    onBeforeRedirectRef.current?.()
    try {
      sessionStorage.setItem(SOCIAL_FLOW_KEY, String(Date.now()))
    } catch {
      // Without sessionStorage the return can't be verified; the sign-in will be ignored.
    }
    const to = encodeURIComponent(location.origin + "/")
    location.href = `${process.env.NEXT_PUBLIC_AUTH_URL}/social/${provider}?to=${to}`
  }, [])

  const signOut = React.useCallback(async () => {
    await fetch("/api/auth/sign-out", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: "{}",
    }).catch(() => undefined)
    setUser(null)
  }, [])

  const value = React.useMemo(
    () => ({ user, isPending, openAuthDialog, signOut }),
    [user, isPending, openAuthDialog, signOut]
  )

  return (
    <AuthContext.Provider value={value}>
      {children}
      <AuthDialog
        open={dialog.open}
        mode={dialog.mode}
        initialError={dialog.error}
        onModeChange={(mode) => setDialog((d) => ({ ...d, mode, error: null }))}
        onClose={closeDialog}
        onSuccess={handleSuccess}
        onSocial={startSocialSignIn}
      />
    </AuthContext.Provider>
  )
}
