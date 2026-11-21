"use client"

import * as React from "react"
import { useMutation } from "@tanstack/react-query"
import {
  AlertTriangle,
  Check,
  Cloud,
  Database,
  ExternalLink,
  HardDrive,
  KeyRound,
  Mail,
  RefreshCw,
  Settings2,
  ShieldCheck,
  Timer,
  Unplug,
  type LucideIcon,
} from "lucide-react"
import { cn } from "cn"

import type { BackendInfo } from "@app/shared/agent/types"
import { apiClient, getApiErrorMessage } from "@/lib/api-client"
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert"
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Checkbox } from "@/components/ui/checkbox"
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog"
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover"
import { Spinner } from "@/components/ui/spinner"

type ServiceId = "postgres" | "auth" | "storage" | "email" | "jobs"

const SERVICES: { id: ServiceId; label: string; body: string; icon: LucideIcon; required?: boolean }[] = [
  { id: "postgres", label: "Database", body: "Postgres for the app's records, synced live.", icon: Database, required: true },
  { id: "auth", label: "Authentication", body: "Sign up, sign in and password reset for your users.", icon: KeyRound, required: true },
  { id: "storage", label: "File storage", body: "Photos and files your users upload.", icon: HardDrive, required: true },
  { id: "email", label: "Email", body: "Transactional email from your app.", icon: Mail },
  { id: "jobs", label: "Background jobs", body: "Scheduled and long-running tasks.", icon: Timer },
]
const LABEL = Object.fromEntries(SERVICES.map((s) => [s.id, s.label])) as Record<string, string>

const ERRORS: Record<string, string> = {
  denied: "You cancelled the CloudHike authorization. Connect again whenever you're ready.",
  expired: "The CloudHike authorization expired before it finished. Please try again.",
  not_configured: "CloudHike Connect isn't configured on this server yet. Ask an administrator to set the CloudHike client credentials.",
  failed: "We couldn't complete the CloudHike authorization. Please try again.",
}

type Cloudhike = { configured: boolean; accountConnected: boolean }

function ServiceList({ services, compact }: { services: string[]; compact?: boolean }) {
  return (
    <ul className={cn("grid gap-1.5", compact ? "text-xs" : "text-sm")}>
      {SERVICES.filter((s) => services.includes(s.id)).map((s) => (
        <li key={s.id} className="flex items-center gap-2">
          <s.icon className="size-3.5 text-muted-foreground" />
          <span className="flex-1">{s.label}</span>
          <Check className="size-3.5 text-emerald-600 dark:text-emerald-400" />
        </li>
      ))}
    </ul>
  )
}

function ProviderMark({ className }: { className?: string }) {
  return (
    <span className={cn("flex size-9 shrink-0 items-center justify-center rounded-(--r-sm) bg-sky-500/10 text-sky-600 dark:text-sky-400", className)}>
      <Cloud className="size-4.5" />
    </span>
  )
}

function ConnectDialog({
  open,
  onOpenChange,
  projectId,
  cloudhike,
  backend,
  notice,
  agentBusy,
  onSetup,
}: {
  open: boolean
  onOpenChange: (o: boolean) => void
  projectId: string
  cloudhike: Cloudhike
  backend: BackendInfo | null
  notice: string | null
  agentBusy: boolean
  onSetup: (services: ServiceId[]) => void
}) {
  const [picked, setPicked] = React.useState<Set<ServiceId>>(
    () => new Set((backend?.services as ServiceId[] | undefined) ?? ["postgres", "auth", "storage", "email", "jobs"])
  )
  const [leaving, setLeaving] = React.useState(false)
  const services = SERVICES.filter((s) => s.required || picked.has(s.id)).map((s) => s.id)
  const reconnect = backend?.error === "reconnect"
  const needsAuth = !cloudhike.accountConnected || reconnect
  const failed = backend?.status === "error" && !reconnect ? backend.error : null

  const go = () => {
    if (needsAuth) {
      setLeaving(true)
      const q = new URLSearchParams({ projectId, services: services.join(",") })
      if (reconnect) q.set("reconnect", "1")
      window.location.assign(`/api/cloudhike/connect?${q}`)
      return
    }
    onSetup(services)
    onOpenChange(false)
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="gap-5 p-5 sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>Connect a backend</DialogTitle>
          <DialogDescription>
            Give your app a real database, user accounts and file storage. The agent sets everything up for you.
          </DialogDescription>
        </DialogHeader>

        {(notice || failed) && (
          <Alert variant="destructive">
            <AlertTriangle />
            <AlertTitle>{notice ? "Connection not completed" : "Setup didn't finish"}</AlertTitle>
            <AlertDescription>{notice ?? failed}</AlertDescription>
          </Alert>
        )}

        <div role="radiogroup" aria-label="Backend provider" className="grid gap-2">
          <div
            role="radio"
            aria-checked
            className="flex items-start gap-3 rounded-(--r-md) border border-primary/50 bg-primary/5 p-3"
          >
            <ProviderMark />
            <span className="min-w-0 flex-1">
              <span className="flex items-center gap-2 text-sm font-medium">
                CloudHike
                <Badge variant="secondary" className="h-5 px-1.5 text-[10px]">
                  Default
                </Badge>
              </span>
              <span className="block text-xs text-muted-foreground">
                Managed Postgres, Auth, Storage, Email and Jobs, in your own CloudHike workspace.
              </span>
            </span>
            <span className="mt-1 flex size-4 shrink-0 items-center justify-center rounded-full border border-primary bg-primary text-primary-foreground">
              <Check className="size-2.5" strokeWidth={3} />
            </span>
          </div>
        </div>

        <fieldset className="grid gap-2">
          <legend className="mb-2 text-xs font-medium text-muted-foreground">Services</legend>
          {SERVICES.map((s) => {
            const checked = s.required || picked.has(s.id)
            return (
              <label
                key={s.id}
                className={cn(
                  "flex items-center gap-3 rounded-(--r-sm) px-1 py-1",
                  s.required ? "cursor-default" : "cursor-pointer hover:bg-muted/60"
                )}
              >
                <Checkbox
                  checked={checked}
                  disabled={s.required}
                  onCheckedChange={(v) =>
                    setPicked((p) => {
                      const next = new Set(p)
                      if (v) next.add(s.id)
                      else next.delete(s.id)
                      return next
                    })
                  }
                  aria-label={s.label}
                />
                <s.icon className="size-4 text-muted-foreground" />
                <span className="min-w-0 flex-1">
                  <span className="block text-sm">{s.label}</span>
                  <span className="block text-xs text-muted-foreground">{s.body}</span>
                </span>
                {s.required && <span className="text-[11px] text-muted-foreground">Required</span>}
              </label>
            )
          })}
        </fieldset>

        {backend && !needsAuth && (
          <p className="-mt-2 text-xs text-muted-foreground">
            Unchecking a service stops this app from using it; anything already deployed stays in your CloudHike workspace.
          </p>
        )}

        <div className="flex items-start gap-2.5 rounded-(--r-md) bg-muted/60 p-3 text-xs text-muted-foreground">
          <ShieldCheck className="mt-0.5 size-4 shrink-0 text-foreground/70" />
          <p>
            {needsAuth ? "You'll sign in to CloudHike and allow access. " : "Your CloudHike account is connected. "}
            The agent then creates a project and deploys the services. Keys stay encrypted on our servers and are never shown to the AI or
            put in your app&apos;s code. Usage is billed to your CloudHike workspace, and deploying needs about a day of the services&apos; cost in credits.
          </p>
        </div>

        {!cloudhike.configured && (
          <p className="-mt-2 text-xs text-destructive">CloudHike Connect isn&apos;t configured on this server yet.</p>
        )}

        <div className="flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">
          <Button variant="outline" onClick={() => onOpenChange(false)}>
            Cancel
          </Button>
          <Button onClick={go} disabled={!cloudhike.configured || leaving || agentBusy}>
            {leaving ? <Spinner /> : <Cloud />}
            {needsAuth ? (reconnect ? "Reconnect CloudHike" : "Continue with CloudHike") : backend ? "Save and deploy" : "Set up backend"}
          </Button>
        </div>
        {agentBusy && <p className="-mt-3 text-right text-xs text-muted-foreground">Available once the agent finishes its current task.</p>}
      </DialogContent>
    </Dialog>
  )
}

function ConnectedPopover({
  backend,
  agentBusy,
  onRerun,
  onEditServices,
  onDisconnect,
}: {
  backend: BackendInfo
  agentBusy: boolean
  onRerun: () => void
  /** Opens the provider dialog again, pre-filled, so services can be added or dropped. */
  onEditServices: () => void
  onDisconnect: () => void
}) {
  return (
    <Popover>
      <PopoverTrigger
        render={
          <button
            type="button"
            className="flex h-8 items-center gap-2 rounded-full border border-emerald-600/25 bg-emerald-500/10 px-3 text-xs font-medium text-emerald-700 outline-none transition-colors hover:bg-emerald-500/15 focus-visible:ring-3 focus-visible:ring-ring/50 dark:text-emerald-300 max-sm:px-2.5"
            aria-label="CloudHike backend connected"
          />
        }
      >
        <span className="relative flex size-2">
          <span className="absolute inline-flex size-full animate-ping rounded-full bg-emerald-500/60 [animation-duration:2.5s]" />
          <span className="relative inline-flex size-2 rounded-full bg-emerald-500" />
        </span>
        <span className="hidden lg:inline">CloudHike Backend Connected</span>
        <span className="hidden sm:inline lg:hidden">Connected</span>
      </PopoverTrigger>
      <PopoverContent align="end" className="w-80 gap-3 p-3.5">
        <div className="flex items-center gap-3">
          <ProviderMark />
          <div className="min-w-0 flex-1">
            <p className="text-sm font-medium">CloudHike backend</p>
            <p className="truncate text-xs text-muted-foreground">{backend.projectName ?? "CloudHike project"}</p>
          </div>
          <Badge className="h-5 bg-emerald-500/15 px-1.5 text-[10px] text-emerald-700 dark:text-emerald-300">Live</Badge>
        </div>
        <ServiceList services={backend.services} compact />
        <p className="text-xs text-muted-foreground">
          The preview reads and writes real data in this project and refreshes when it changes elsewhere.
        </p>
        {backend.error && backend.error !== "reconnect" && (
          <p className="rounded-(--r-sm) bg-amber-500/10 p-2 text-xs text-amber-800 dark:text-amber-300">Last setup attempt: {backend.error}</p>
        )}
        <div className="grid gap-1.5">
          <Button variant="outline" className="h-8 justify-start" render={<a href="https://cloudhike.dev" target="_blank" rel="noreferrer noopener" />}>
            <ExternalLink /> Open CloudHike dashboard
          </Button>
          <Button variant="ghost" className="h-8 justify-start" onClick={onEditServices} disabled={agentBusy}>
            <Settings2 /> Edit services
          </Button>
          <Button variant="ghost" className="h-8 justify-start" onClick={onRerun} disabled={agentBusy}>
            <RefreshCw /> Check and repair setup
          </Button>
          <Button variant="ghost" className="h-8 justify-start text-destructive hover:text-destructive" onClick={onDisconnect} disabled={agentBusy}>
            <Unplug /> Disconnect app
          </Button>
        </div>
      </PopoverContent>
    </Popover>
  )
}

/**
 * Connect Backend in the workspace header: the provider dialog, the setup
 * status while the agent works, and a clear connected state afterwards.
 */
export function BackendControl({
  projectId,
  backend,
  cloudhike,
  agentBusy,
  onSetupBackend,
  onDisconnected,
  onRefresh,
}: {
  projectId: string
  backend: BackendInfo | null
  cloudhike: Cloudhike
  agentBusy: boolean
  onSetupBackend: (services: string[]) => void
  onDisconnected: () => void
  /** Re-checks the CloudHike connection and this app's backend with the server, in case either went stale (disconnected elsewhere, revoked on CloudHike's side). */
  onRefresh: () => void
}) {
  const [open, setOpen] = React.useState(false)
  const [notice, setNotice] = React.useState<string | null>(null)
  const [confirm, setConfirm] = React.useState(false)
  const [forgetAccount, setForgetAccount] = React.useState(false)
  const [disconnectError, setDisconnectError] = React.useState<string | null>(null)
  // After "also remove my authorization" the server-rendered flag is stale.
  const [accountForgotten, setAccountForgotten] = React.useState(false)
  const account = { ...cloudhike, accountConnected: cloudhike.accountConnected && !accountForgotten }

  // Back from CloudHike's Allow screen: set up right away, or explain what went wrong.
  const handled = React.useRef(false)
  React.useEffect(() => {
    if (handled.current) return
    handled.current = true
    const url = new URL(window.location.href)
    const result = url.searchParams.get("backend")
    if (!result) return
    const services = (url.searchParams.get("services") ?? "").split(",").filter(Boolean)
    const reason = url.searchParams.get("reason") ?? "failed"
    for (const k of ["backend", "services", "reason"]) url.searchParams.delete(k)
    window.history.replaceState(null, "", url.pathname + (url.search ? url.search : "") + url.hash)
    if (result === "connected") onSetupBackend(services.length ? services : ["postgres", "auth", "storage"])
    else {
      setNotice(ERRORS[reason] ?? ERRORS.failed)
      setOpen(true)
    }
  }, [onSetupBackend])

  const disconnectMutation = useMutation({
    mutationFn: async ({ forget }: { forget: boolean }) => {
      const res = await apiClient.delete<{ error?: string }>(
        `/api/projects/${encodeURIComponent(projectId)}/backend`,
        { data: { forgetAccount: forget } }
      )
      return res.data
    },
    onSuccess: (_, { forget }) => {
      setConfirm(false)
      if (forget) setAccountForgotten(true)
      onDisconnected()
    },
    onError: (e) => {
      setDisconnectError(getApiErrorMessage(e, "Couldn't disconnect. Try again."))
    },
  })

  const disconnecting = disconnectMutation.isPending

  const disconnect = () => {
    setDisconnectError(null)
    disconnectMutation.mutate({ forget: forgetAccount })
  }

  // The connection/backend state shown here is a snapshot: resync before
  // opening anything, so the dialog's needsAuth and the buttons below reflect
  // the real thing (not a connection dropped in another tab, or on CloudHike's side).
  const openDialog = () => {
    onRefresh()
    setOpen(true)
  }

  const status = backend?.status
  let trigger: React.ReactNode
  if (status === "provisioning") {
    trigger = (
      <span className="flex h-8 items-center gap-2 rounded-full border border-border bg-muted/60 px-3 text-xs font-medium text-muted-foreground" role="status">
        <Spinner className="size-3.5" />
        <span className="hidden sm:inline">Setting up CloudHike…</span>
      </span>
    )
  } else if (status === "ready") {
    trigger = (
      <ConnectedPopover
        backend={backend!}
        agentBusy={agentBusy}
        onRerun={() => onSetupBackend(backend!.services)}
        onEditServices={openDialog}
        onDisconnect={() => setConfirm(true)}
      />
    )
  } else if (status === "error") {
    trigger = (
      <Button
        variant="outline"
        className="h-8 border-amber-500/40 px-2.5 text-amber-700 hover:text-amber-800 dark:text-amber-300 max-sm:w-8 max-sm:px-0"
        onClick={openDialog}
        aria-label="Backend needs attention"
      >
        <AlertTriangle />
        <span className="hidden sm:inline">{backend?.error === "reconnect" ? "Reconnect backend" : "Finish backend setup"}</span>
      </Button>
    )
  } else {
    trigger = (
      <Button variant="outline" className="h-8 px-2.5 max-sm:w-8 max-sm:px-0" onClick={openDialog} aria-label="Connect Backend">
        <Database />
        <span className="hidden sm:inline">Connect Backend</span>
      </Button>
    )
  }

  return (
    <>
      {trigger}
      <ConnectDialog
        open={open}
        onOpenChange={(o) => {
          setOpen(o)
          if (!o) setNotice(null)
        }}
        projectId={projectId}
        cloudhike={account}
        backend={backend}
        notice={notice}
        agentBusy={agentBusy}
        onSetup={onSetupBackend}
      />
      <AlertDialog open={confirm} onOpenChange={setConfirm}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Disconnect this app from CloudHike?</AlertDialogTitle>
            <AlertDialogDescription>
              The preview goes back to data stored on this device. Your CloudHike project and everything in it stay in your CloudHike
              workspace; you can delete them there.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <label className="flex cursor-pointer items-start gap-2.5 text-sm">
            <Checkbox checked={forgetAccount} onCheckedChange={(v) => setForgetAccount(!!v)} className="mt-0.5" />
            <span>
              Also remove my CloudHike authorization
              <span className="block text-xs text-muted-foreground">You can revoke it in CloudHike too, under Settings → API &amp; apps.</span>
            </span>
          </label>
          {disconnectError && <p className="text-xs text-destructive">{disconnectError}</p>}
          <AlertDialogFooter>
            <AlertDialogCancel disabled={disconnecting}>Cancel</AlertDialogCancel>
            <AlertDialogAction variant="destructive" onClick={disconnect} disabled={disconnecting}>
              {disconnecting ? <Spinner /> : <Unplug />} Disconnect
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  )
}

export { LABEL as BACKEND_SERVICE_LABELS }
