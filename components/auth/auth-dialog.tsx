"use client"

import * as React from "react"
import { AlertCircle, Eye, EyeOff, Gift, Sparkles } from "lucide-react"

import {
  validateEmail,
  validateName,
  validatePassword,
  type AuthField,
  type FieldErrors,
} from "@/lib/auth-validation"
import { Alert, AlertDescription } from "@/components/ui/alert"
import { Button } from "@/components/ui/button"
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Spinner } from "@/components/ui/spinner"
import { GitHubIcon, GoogleIcon } from "@/components/auth/social-icons"
import type { AuthMode, AuthUser, SocialProvider } from "@/components/auth/auth-provider"

type Props = {
  open: boolean
  mode: AuthMode
  initialError?: string | null
  onModeChange: (mode: AuthMode) => void
  onClose: () => void
  onSuccess: (user: AuthUser) => void
  onSocial: (provider: SocialProvider) => void
}

export function AuthDialog({ open, mode, initialError, onModeChange, onClose, onSuccess, onSocial }: Props) {
  const [loading, setLoading] = React.useState(false)

  return (
    <Dialog open={open} onOpenChange={(next) => !next && !loading && onClose()}>
      <DialogContent className="gap-6 rounded-3xl p-8 sm:max-w-md">
        {/* Remount per mode so every attempt starts from a clean form. */}
        <AuthForm
          key={mode}
          mode={mode}
          initialError={initialError}
          loading={loading}
          setLoading={setLoading}
          onModeChange={onModeChange}
          onSuccess={onSuccess}
          onSocial={onSocial}
        />
      </DialogContent>
    </Dialog>
  )
}

function AuthForm({
  mode,
  initialError,
  loading,
  setLoading,
  onModeChange,
  onSuccess,
  onSocial,
}: Pick<Props, "mode" | "initialError" | "onModeChange" | "onSuccess" | "onSocial"> & {
  loading: boolean
  setLoading: (v: boolean) => void
}) {
  const isSignUp = mode === "sign-up"
  const [values, setValues] = React.useState({ name: "", email: "", password: "" })
  const [errors, setErrors] = React.useState<FieldErrors>({})
  const [formError, setFormError] = React.useState<string | null>(initialError ?? null)
  const [socialLoading, setSocialLoading] = React.useState<SocialProvider | null>(null)
  const busy = loading || socialLoading !== null

  // Coming back via the browser's back button restores this page from cache mid-redirect.
  React.useEffect(() => {
    const reset = (e: PageTransitionEvent) => e.persisted && setSocialLoading(null)
    window.addEventListener("pageshow", reset)
    return () => window.removeEventListener("pageshow", reset)
  }, [])

  const handleSocial = (provider: SocialProvider) => {
    if (busy) return
    setFormError(null)
    setSocialLoading(provider)
    onSocial(provider)
  }
  const [showPassword, setShowPassword] = React.useState(false)
  const nameRef = React.useRef<HTMLInputElement>(null)
  const emailRef = React.useRef<HTMLInputElement>(null)
  const passwordRef = React.useRef<HTMLInputElement>(null)
  const refs = { name: nameRef, email: emailRef, password: passwordRef }

  const validators: Record<AuthField, (v: string) => string | undefined> = {
    name: validateName,
    email: validateEmail,
    password: (v) => validatePassword(v, mode),
  }

  const setField = (field: AuthField, value: string) => {
    setValues((v) => ({ ...v, [field]: value }))
    if (errors[field]) setErrors((e) => ({ ...e, [field]: validators[field](value) }))
  }

  const blurField = (field: AuthField) => {
    if (values[field]) setErrors((e) => ({ ...e, [field]: validators[field](values[field]) }))
  }

  const focusFirstError = (next: FieldErrors) => {
    const first = (["name", "email", "password"] as AuthField[]).find((f) => next[f])
    if (first) refs[first].current?.focus()
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    if (busy) return

    const next: FieldErrors = {
      email: validateEmail(values.email),
      password: validatePassword(values.password, mode),
      ...(isSignUp ? { name: validateName(values.name) } : {}),
    }
    for (const k of Object.keys(next) as AuthField[]) if (!next[k]) delete next[k]
    setErrors(next)
    setFormError(null)
    if (Object.keys(next).length) return focusFirstError(next)

    setLoading(true)
    try {
      const res = await fetch(`/api/auth/${mode}`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          ...(isSignUp ? { name: values.name } : {}),
          email: values.email,
          password: values.password,
        }),
      })
      const data = await res.json().catch(() => ({}))
      if (!res.ok) {
        if (data.fieldErrors) {
          setErrors(data.fieldErrors)
          focusFirstError(data.fieldErrors)
        }
        setFormError(data.error ?? "Something went wrong. Try again.")
        setLoading(false)
        return
      }
      setLoading(false)
      onSuccess(data.user)
    } catch {
      setFormError("Network error. Check your connection and try again.")
      setLoading(false)
    }
  }

  const fieldProps = (field: AuthField) => ({
    id: `auth-${field}`,
    ref: refs[field],
    value: values[field],
    disabled: busy,
    "aria-invalid": Boolean(errors[field]),
    "aria-describedby": errors[field] ? `auth-${field}-error` : undefined,
    onChange: (e: React.ChangeEvent<HTMLInputElement>) => setField(field, e.target.value),
    onBlur: () => blurField(field),
    className: "h-11 rounded-(--r-md) px-3.5 text-base",
  })

  const fieldError = (field: AuthField) =>
    errors[field] ? (
      <p id={`auth-${field}-error`} className="text-sm text-destructive">
        {errors[field]}
      </p>
    ) : null

  return (
    <>
      <DialogHeader className="items-center gap-3 text-center">
        <span className="flex size-11 items-center justify-center rounded-(--r-md) bg-primary text-primary-foreground">
          <Sparkles className="size-5" />
        </span>
        <DialogTitle className="text-2xl font-medium tracking-[-0.03em]">
          {isSignUp ? "Create your account" : "Welcome back"}
        </DialogTitle>
        <DialogDescription className="text-base">
          {isSignUp
            ? "Sign up to start building mobile apps with AI."
            : "Sign in to keep building where you left off."}
        </DialogDescription>
      </DialogHeader>

      {isSignUp && (
        <div className="flex items-center gap-2 rounded-(--r-md) bg-muted px-3.5 py-2.5 text-sm">
          <Gift className="size-4 shrink-0 text-primary" />
          <span>
            Get <strong className="font-medium">100 free credits</strong> when you join.
          </span>
        </div>
      )}

      {formError && (
        <Alert variant="destructive">
          <AlertCircle />
          <AlertDescription>{formError}</AlertDescription>
        </Alert>
      )}

      <div className="grid gap-3 sm:grid-cols-2">
        {(
          [
            { id: "google", label: "Google", Icon: GoogleIcon },
            { id: "github", label: "GitHub", Icon: GitHubIcon },
          ] as const
        ).map(({ id, label, Icon }) => (
          <Button
            key={id}
            type="button"
            variant="outline"
            disabled={busy}
            onClick={() => handleSocial(id)}
            className="h-11 rounded-(--r-md) text-base"
          >
            {socialLoading === id ? <Spinner /> : <Icon className="size-5" />}
            {label}
          </Button>
        ))}
      </div>

      <div className="flex items-center gap-3 text-xs text-muted-foreground">
        <span className="h-px flex-1 bg-border" />
        or continue with email
        <span className="h-px flex-1 bg-border" />
      </div>

      <form onSubmit={handleSubmit} noValidate className="grid gap-4">

        {isSignUp && (
          <div className="grid gap-1.5">
            <Label htmlFor="auth-name">Name</Label>
            <Input {...fieldProps("name")} autoComplete="name" placeholder="Ada Lovelace" autoFocus />
            {fieldError("name")}
          </div>
        )}

        <div className="grid gap-1.5">
          <Label htmlFor="auth-email">Email</Label>
          <Input
            {...fieldProps("email")}
            type="email"
            inputMode="email"
            autoComplete="email"
            placeholder="you@example.com"
            autoFocus={!isSignUp}
          />
          {fieldError("email")}
        </div>

        <div className="grid gap-1.5">
          <Label htmlFor="auth-password">Password</Label>
          <div className="relative">
            <Input
              {...fieldProps("password")}
              type={showPassword ? "text" : "password"}
              autoComplete={isSignUp ? "new-password" : "current-password"}
              placeholder={isSignUp ? "At least 8 characters" : "Your password"}
              className="h-11 rounded-(--r-md) pr-11 pl-3.5 text-base"
            />
            <button
              type="button"
              onClick={() => setShowPassword((s) => !s)}
              aria-label={showPassword ? "Hide password" : "Show password"}
              className="absolute inset-y-0 right-0 flex w-11 items-center justify-center text-muted-foreground transition-colors hover:text-foreground"
            >
              {showPassword ? <EyeOff className="size-4" /> : <Eye className="size-4" />}
            </button>
          </div>
          {fieldError("password")}
        </div>

        <Button type="submit" disabled={busy} className="mt-1 h-11 rounded-(--r-md) text-base">
          {loading ? (
            <>
              <Spinner /> {isSignUp ? "Creating account…" : "Signing in…"}
            </>
          ) : isSignUp ? (
            "Create account"
          ) : (
            "Sign in"
          )}
        </Button>
      </form>

      <p className="text-center text-sm text-muted-foreground">
        {isSignUp ? "Already have an account?" : "New here?"}{" "}
        <button
          type="button"
          disabled={busy}
          onClick={() => onModeChange(isSignUp ? "sign-in" : "sign-up")}
          className="font-medium text-primary underline-offset-4 hover:underline"
        >
          {isSignUp ? "Sign in" : "Create an account"}
        </button>
      </p>
    </>
  )
}
