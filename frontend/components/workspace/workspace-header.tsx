"use client"

import * as React from "react"
import Link from "next/link"
import { useMutation, useQueryClient } from "@tanstack/react-query"
import {
  AlertCircle,
  Check,
  ChevronDown,
  Coins,
  Copy,
  Download,
  FolderOpen,
  Github,
  Globe,
  Link2,
  Lock,
  LogOut,
  Pencil,
  Rocket,
  Settings,
  Share2,
  Smartphone,
  Sparkles,
  User,
} from "lucide-react"
import { cn } from "cn"

import { useAuth } from "@/components/auth/auth-provider"
import type { BackendInfo } from "@app/shared/agent/types"
import type { BackendProviderId, BackendProviderStatus } from "@app/shared/app-backend/providers"
import { apiClient, getApiErrorMessage } from "@/lib/api-client"
import { slug } from "@app/shared/app-project/scaffold"
import { BackendControl } from "./backend-connect"
import { ExpoConnectDialog } from "./expo-connect-dialog"
import { GithubPushDialog } from "./github-push-dialog"
import { PublishDialog } from "./publish-dialog"
import { VersionsMenu } from "./versions-menu"
import { statusLabel } from "@app/shared/project-status"
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert"
import { Avatar, AvatarFallback } from "@/components/ui/avatar"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Spinner } from "@/components/ui/spinner"
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog"
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuGroup,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuShortcut,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu"

function ProjectTitle({
  name,
  status,
  onRename,
}: {
  name: string
  status: string | null
  onRename: (name: string) => void
}) {
  const [editing, setEditing] = React.useState(false)
  const [draft, setDraft] = React.useState(name)
  const inputRef = React.useRef<HTMLInputElement>(null)

  React.useEffect(() => {
    if (editing) inputRef.current?.select()
  }, [editing])

  const commit = () => {
    const next = draft.trim()
    if (next && next !== name) onRename(next)
    else setDraft(name)
    setEditing(false)
  }

  if (editing) {
    return (
      <input
        ref={inputRef}
        value={draft}
        maxLength={60}
        aria-label="Project name"
        onChange={(e) => setDraft(e.target.value)}
        onBlur={commit}
        onKeyDown={(e) => {
          if (e.key === "Enter") commit()
          if (e.key === "Escape") {
            setDraft(name)
            setEditing(false)
          }
        }}
        className="h-8 w-64 max-w-full rounded-(--r-sm) border border-primary/40 bg-background px-2.5 text-center text-sm font-medium outline-none ring-3 ring-primary/15"
      />
    )
  }

  return (
    <DropdownMenu>
      <DropdownMenuTrigger
        className="group flex h-8 max-w-full min-w-0 items-center gap-2 rounded-(--r-sm) px-2.5 text-sm font-medium outline-none transition-colors hover:bg-muted aria-expanded:bg-muted focus-visible:ring-3 focus-visible:ring-ring/50"
      >
        <span className="truncate">{name}</span>
        <span className="hidden shrink-0 items-center gap-1.5 rounded-full bg-muted px-2 py-0.5 text-xs font-medium text-muted-foreground group-hover:bg-background sm:inline-flex">
          <span className="size-1.5 rounded-full bg-primary" />
          {statusLabel(status)}
        </span>
        <ChevronDown className="size-3.5 shrink-0 text-muted-foreground" />
      </DropdownMenuTrigger>
      <DropdownMenuContent align="center" className="w-56">
        <DropdownMenuItem onClick={() => setEditing(true)}>
          <Pencil /> Rename
        </DropdownMenuItem>
        <DropdownMenuItem disabled>
          <Copy /> Duplicate project
        </DropdownMenuItem>
        <DropdownMenuItem disabled>
          <Settings /> Project settings
        </DropdownMenuItem>
        <DropdownMenuSeparator />
        <DropdownMenuItem render={<Link href="/" />}>
          <FolderOpen /> All projects
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  )
}

function ShareDialog({
  open,
  onOpenChange,
  projectId,
  initialIsPublic,
  initialPublicSlug,
}: {
  open: boolean
  onOpenChange: (o: boolean) => void
  projectId: string
  initialIsPublic: boolean
  initialPublicSlug: string | null
}) {
  const queryClient = useQueryClient()
  const [copied, setCopied] = React.useState(false)

  const mutation = useMutation({
    mutationFn: async (isPublic: boolean) => {
      const res = await apiClient.patch<{ isPublic: boolean; publicSlug: string | null }>(
        `/api/projects/${projectId}/visibility`,
        { isPublic }
      )
      return res.data
    },
    onSuccess: () => {
      // Keeps the homepage gallery (and its own cached list) in sync next time it's visited.
      void queryClient.invalidateQueries({ queryKey: ["projects"] })
      void queryClient.invalidateQueries({ queryKey: ["public-projects"] })
    },
  })

  const isPublic = mutation.data?.isPublic ?? initialIsPublic
  const publicSlug = mutation.data?.publicSlug ?? initialPublicSlug
  const url = publicSlug && typeof window !== "undefined" ? `${window.location.origin}/p/${publicSlug}` : ""
  const access = isPublic ? "link" : "private"

  React.useEffect(() => {
    if (!copied) return
    const t = setTimeout(() => setCopied(false), 2000)
    return () => clearTimeout(t)
  }, [copied])

  const options = [
    { id: "private", icon: Lock, title: "Only you", body: "Nobody else can open this project." },
    { id: "link", icon: Globe, title: "Anyone with the link", body: "Visitors can try a live, interactive preview of your app — never your real data." },
  ] as const

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="gap-5 p-5 sm:max-w-md">
        <DialogHeader>
          <DialogTitle>Share project</DialogTitle>
          <DialogDescription>Choose who can see this project and its live preview.</DialogDescription>
        </DialogHeader>

        <div role="radiogroup" aria-label="Who can access" className="grid gap-2">
          {options.map((o) => (
            <button
              key={o.id}
              type="button"
              role="radio"
              aria-checked={access === o.id}
              disabled={mutation.isPending}
              onClick={() => mutation.mutate(o.id === "link")}
              className={cn(
                "flex items-start gap-3 rounded-(--r-md) border p-3 text-left transition-colors disabled:opacity-60",
                access === o.id ? "border-primary/50 bg-primary/5" : "border-border hover:bg-muted"
              )}
            >
              <span className="flex size-8 shrink-0 items-center justify-center rounded-(--r-sm) bg-muted">
                <o.icon className="size-4" />
              </span>
              <span className="min-w-0 flex-1">
                <span className="block text-sm font-medium">{o.title}</span>
                <span className="block text-xs text-muted-foreground">{o.body}</span>
              </span>
              <span
                className={cn(
                  "mt-1 flex size-4 shrink-0 items-center justify-center rounded-full border",
                  access === o.id ? "border-primary bg-primary text-primary-foreground" : "border-border"
                )}
              >
                {access === o.id && <Check className="size-2.5" strokeWidth={3} />}
              </span>
            </button>
          ))}
        </div>

        <div className="flex gap-2">
          <div className="relative flex-1">
            <Link2 className="pointer-events-none absolute top-1/2 left-2.5 size-4 -translate-y-1/2 text-muted-foreground" />
            <Input readOnly value={url} disabled={!isPublic} className="h-9 pl-8 text-sm" aria-label="Share link" />
          </div>
          <Button
            className="h-9 px-3.5"
            disabled={!isPublic}
            onClick={() =>
              navigator.clipboard
                .writeText(url)
                .then(() => setCopied(true))
                .catch(() => {})
            }
          >
            {copied ? <Check /> : <Copy />}
            {copied ? "Copied" : "Copy link"}
          </Button>
        </div>
        {mutation.isError ? (
          <p className="-mt-2 text-xs text-destructive">{getApiErrorMessage(mutation.error)}</p>
        ) : (
          <p className="-mt-2 text-xs text-muted-foreground">
            {isPublic ? "This app also shows up in the homepage gallery for signed-out visitors." : "Sharing goes live once your first build is ready."}
          </p>
        )}
      </DialogContent>
    </Dialog>
  )
}

function UserMenu() {
  const { user, signOut } = useAuth()
  if (!user) return null
  return (
    <DropdownMenu>
      <DropdownMenuTrigger className="rounded-full outline-none focus-visible:ring-3 focus-visible:ring-ring/50">
        <Avatar className="size-8 cursor-pointer">
          <AvatarFallback className="text-xs">{(user.name ?? user.email).charAt(0).toUpperCase()}</AvatarFallback>
        </Avatar>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="w-56">
        <div className="px-2 py-1.5">
          <p className="truncate text-sm font-medium">{user.name}</p>
          <p className="truncate text-xs text-muted-foreground">{user.email}</p>
        </div>
        <div className="mx-1 mb-1 flex items-center justify-between rounded-md bg-muted px-2 py-1.5 text-sm">
          <span className="flex items-center gap-1.5 text-muted-foreground">
            <Coins className="size-3.5" /> Credits
          </span>
          <span className="font-medium">{user.credits}</span>
        </div>
        <DropdownMenuSeparator />
        <DropdownMenuItem>
          <User /> Profile
        </DropdownMenuItem>
        <DropdownMenuItem>
          <Settings /> Settings
        </DropdownMenuItem>
        <DropdownMenuSeparator />
        <DropdownMenuItem onClick={() => signOut()}>
          <LogOut /> Sign out
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  )
}

export function WorkspaceHeader({
  projectId,
  name,
  status,
  onRename,
  backend,
  providers,
  agentBusy,
  onSetupBackend,
  onBackendDisconnected,
  onRefreshBackend,
  initialIsPublic,
  initialPublicSlug,
}: {
  projectId: string
  name: string
  status: string | null
  onRename: (name: string) => void
  backend: BackendInfo | null
  providers: BackendProviderStatus[]
  agentBusy: boolean
  onSetupBackend: (provider: BackendProviderId, services: string[]) => void
  onBackendDisconnected: () => void
  onRefreshBackend: () => void
  initialIsPublic: boolean
  initialPublicSlug: string | null
}) {
  const [shareOpen, setShareOpen] = React.useState(false)
  const [githubOpen, setGithubOpen] = React.useState(false)
  const [expoOpen, setExpoOpen] = React.useState(false)
  const [publishOpen, setPublishOpen] = React.useState(false)
  const [zipError, setZipError] = React.useState<string | null>(null)

  const zipMutation = useMutation({
    mutationFn: async () => {
      setZipError(null)
      const res = await apiClient.get<Blob>(
        `/api/projects/${encodeURIComponent(projectId)}/export/zip`,
        { responseType: "blob" }
      )
      return res.data
    },
    onSuccess: (data) => {
      const url = URL.createObjectURL(data)
      const a = document.createElement("a")
      a.href = url
      a.download = `${slug(name)}.zip`
      document.body.appendChild(a)
      a.click()
      a.remove()
      URL.revokeObjectURL(url)
    },
    onError: async (err: unknown) => {
      let message = "Failed to download project ZIP."
      try {
        const axiosErr = err as { response?: { data?: unknown } }
        if (axiosErr.response?.data instanceof Blob) {
          const text = await axiosErr.response.data.text()
          const parsed = JSON.parse(text)
          if (parsed?.error) message = parsed.error
        } else if (typeof axiosErr.response?.data === "object" && (axiosErr.response.data as { error?: string })?.error) {
          message = (axiosErr.response.data as { error: string }).error
        }
      } catch {}
      setZipError(message)
    },
  })

  return (
    <header className="relative z-30 grid h-14 shrink-0 grid-cols-[1fr_auto_1fr] items-center gap-3 border-b border-border bg-background px-3 sm:px-4">
      {zipError && (
        <div className="absolute top-full left-1/2 z-50 mt-1 w-full max-w-md -translate-x-1/2 px-2">
          <Alert variant="destructive" className="relative py-2 shadow-md">
            <AlertCircle className="size-4" />
            <div className="flex-1 pr-6">
              <AlertTitle className="text-xs font-semibold">Download failed</AlertTitle>
              <AlertDescription className="text-xs">{zipError}</AlertDescription>
            </div>
            <button
              onClick={() => setZipError(null)}
              className="absolute top-2 right-2 text-xs text-muted-foreground hover:text-foreground"
              aria-label="Close"
            >
              ✕
            </button>
          </Alert>
        </div>
      )}

      <div className="flex min-w-0 items-center gap-2">
        <Link
          href="/"
          aria-label="Anything home"
          className="flex items-center gap-2 rounded-(--r-sm) outline-none focus-visible:ring-3 focus-visible:ring-ring/50"
        >
          <span className="flex size-8 items-center justify-center rounded-(--r-sm) bg-primary text-primary-foreground">
            <Sparkles className="size-4" />
          </span>
          <span className="hidden text-base font-semibold tracking-tight md:inline">Anything</span>
        </Link>
      </div>

      <div className="flex min-w-0 max-w-[50vw] justify-center sm:max-w-md">
        <ProjectTitle name={name} status={status} onRename={onRename} />
      </div>

      <div className="flex items-center justify-end gap-1.5 sm:gap-2">
        <BackendControl
          projectId={projectId}
          backend={backend}
          providers={providers}
          agentBusy={agentBusy}
          onSetupBackend={onSetupBackend}
          onDisconnected={onBackendDisconnected}
          onRefresh={onRefreshBackend}
        />

        <VersionsMenu projectId={projectId} />

        <DropdownMenu>
          <DropdownMenuTrigger
            render={
              <Button variant="outline" className="h-8 px-2.5 max-sm:w-8 max-sm:px-0" aria-label="Share and export">
                <Share2 />
                <span className="hidden sm:inline">Export</span>
                <ChevronDown className="hidden size-3.5 text-muted-foreground sm:inline" />
              </Button>
            }
          />
          <DropdownMenuContent align="end" className="w-64">
            <DropdownMenuGroup>
              <DropdownMenuLabel>Share</DropdownMenuLabel>
              <DropdownMenuItem onClick={() => setShareOpen(true)}>
                <Share2 /> Share project…
              </DropdownMenuItem>
            </DropdownMenuGroup>
            <DropdownMenuSeparator />
            <DropdownMenuGroup>
              <DropdownMenuLabel>Export code</DropdownMenuLabel>
              <DropdownMenuItem
                disabled={zipMutation.isPending}
                onClick={() => zipMutation.mutate()}
              >
                {zipMutation.isPending ? <Spinner className="size-4" /> : <Download />}
                Download as ZIP
              </DropdownMenuItem>
              <DropdownMenuItem onClick={() => setGithubOpen(true)}>
                <Github /> Push to GitHub
              </DropdownMenuItem>
            </DropdownMenuGroup>
          </DropdownMenuContent>
        </DropdownMenu>

        <Button
          className="hidden h-8 px-3 md:inline-flex"
          title="Publish a native build (.apk / .aab / .ipa)"
          onClick={() => setPublishOpen(true)}
        >
          <Rocket /> Publish
        </Button>

        <span className="mx-0.5 hidden h-5 w-px bg-border sm:block" />
        <UserMenu />
      </div>

      <ShareDialog
        open={shareOpen}
        onOpenChange={setShareOpen}
        projectId={projectId}
        initialIsPublic={initialIsPublic}
        initialPublicSlug={initialPublicSlug}
      />
      <GithubPushDialog
        open={githubOpen}
        onOpenChange={setGithubOpen}
        projectId={projectId}
        projectName={name}
      />
      <ExpoConnectDialog
        open={expoOpen}
        onOpenChange={setExpoOpen}
      />
      <PublishDialog
        open={publishOpen}
        onOpenChange={setPublishOpen}
        projectId={projectId}
        projectName={name}
        onOpenGithubDialog={() => setGithubOpen(true)}
        onOpenExpoDialog={() => setExpoOpen(true)}
      />
    </header>
  )
}
