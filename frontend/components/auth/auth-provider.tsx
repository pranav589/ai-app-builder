"use client"

import * as React from "react"
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query"

import { AuthDialog } from "@/components/auth/auth-dialog"
import { apiClient, getApiErrorMessage } from "@/lib/api-client"

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
          const res = await apiClient.post<{ user?: AuthUser; error?: string }>("/api/auth/social", { token })
          if (res.data.user) return { user: res.data.user, error: null }
          return { user: null, error: res.data.error ?? "We couldn't sign you in. Try again." }
        } catch (err) {
          return { user: null, error: getApiErrorMessage(err) }
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
      const res = await apiClient.get<{ user?: AuthUser | null }>("/api/auth/session")
      return { user: (res.data.user as AuthUser | null) ?? null, error: null }
    } catch {
      return { user: null, error: null }
    }
  })()
  return initPromise
}

export function AuthProvider({ children }: { children: React.ReactNode }) {
  const queryClient = useQueryClient()
  const [dialog, setDialog] = React.useState<{
    open: boolean
    mode: AuthMode
    error: string | null
  }>({ open: false, mode: "sign-in", error: null })
  const onSuccessRef = React.useRef<OpenOptions["onSuccess"]>(undefined)
  const onBeforeRedirectRef = React.useRef<OpenOptions["onBeforeSocialRedirect"]>(undefined)

  const sessionQuery = useQuery({
    queryKey: ["auth-session"],
    queryFn: initAuth,
    staleTime: Infinity,
  })

  const user = sessionQuery.data?.user ?? null
  const isPending = sessionQuery.isPending

  React.useEffect(() => {
    if (sessionQuery.data?.error) {
      setDialog({ open: true, mode: "sign-in", error: sessionQuery.data.error })
    }
  }, [sessionQuery.data?.error])

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

  const handleSuccess = React.useCallback(
    (next: AuthUser) => {
      const callback = onSuccessRef.current
      onSuccessRef.current = undefined
      onBeforeRedirectRef.current = undefined
      queryClient.setQueryData<InitResult>(["auth-session"], { user: next, error: null })
      setDialog((d) => ({ ...d, open: false, error: null }))
      // Let the signed-in UI render before resuming whatever the user was doing.
      if (callback) setTimeout(() => callback(next), 0)
    },
    [queryClient]
  )

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

  const signOutMutation = useMutation({
    mutationFn: async () => {
      await apiClient.post("/api/auth/sign-out", {})
    },
    onSuccess: () => {
      queryClient.setQueryData<InitResult>(["auth-session"], { user: null, error: null })
    },
  })

  const signOut = React.useCallback(async () => {
    await signOutMutation.mutateAsync().catch(() => undefined)
    queryClient.setQueryData<InitResult>(["auth-session"], { user: null, error: null })
  }, [signOutMutation, queryClient])

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
