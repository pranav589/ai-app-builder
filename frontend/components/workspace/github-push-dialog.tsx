"use client"

import * as React from "react"
import { useQuery, useQueryClient } from "@tanstack/react-query"
import {
  AlertCircle,
  Check,
  CheckCircle2,
  ExternalLink,
  GitBranch,
  Github,
  Lock,
  Radio,
} from "lucide-react"

import { apiClient, getApiErrorData, getApiErrorStatus } from "@/lib/api-client"
import { slug } from "@app/shared/app-project/scaffold"
import type { PushStep } from "@app/shared/api-types"
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert"
import { Button } from "@/components/ui/button"
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { NativeSelect, NativeSelectOption } from "@/components/ui/native-select"
import { RadioGroup, RadioGroupItem } from "@/components/ui/radio-group"
import { Spinner } from "@/components/ui/spinner"
import { Switch } from "@/components/ui/switch"
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs"

const PUSH_STEPS: { id: PushStep; label: string }[] = [
  { id: "resolving-repo", label: "Resolving repository" },
  { id: "reading-branch", label: "Reading branch" },
  { id: "building-tree", label: "Building tree" },
  { id: "committing", label: "Creating commit" },
  { id: "updating-branch", label: "Updating branch" },
]

function defaultBranchName(): string {
  const now = new Date()
  const pad = (n: number) => String(n).padStart(2, "0")
  const yyyy = now.getFullYear()
  const mm = pad(now.getMonth() + 1)
  const dd = pad(now.getDate())
  const hh = pad(now.getHours())
  const min = pad(now.getMinutes())
  return `export-${yyyy}${mm}${dd}-${hh}${min}`
}

type PushResult = {
  owner: string
  name: string
  branch: string
  commitSha: string
  htmlUrl: string
}

type PushError = {
  code: string
  message: string
}

export function GithubPushDialog({
  open,
  onOpenChange,
  projectId,
  projectName,
}: {
  open: boolean
  onOpenChange: (open: boolean) => void
  projectId: string
  projectName: string
}) {
  const queryClient = useQueryClient()

  const statusQuery = useQuery({
    queryKey: ["github-status"],
    queryFn: async () => {
      const res = await apiClient.get<{ configured: boolean; connected: boolean; login?: string }>(
        "/api/github/status"
      )
      return res.data
    },
    enabled: open,
  })

  const linkQuery = useQuery({
    queryKey: ["project-github", projectId],
    queryFn: async () => {
      const res = await apiClient.get<{
        link: {
          repoOwner: string
          repoName: string
          lastBranch: string
          lastCommitSha?: string | null
        } | null
        suggestedMessage: string
      }>(`/api/projects/${projectId}/github`)
      return res.data
    },
    enabled: open && Boolean(statusQuery.data?.connected),
  })

  const reposQuery = useQuery({
    queryKey: ["github-repos"],
    queryFn: async () => {
      const res = await apiClient.get<{
        repos: Array<{
          id: number
          name: string
          full_name: string
          owner: { login: string }
          private: boolean
          default_branch?: string
          html_url: string
        }>
      }>("/api/github/repos")
      return res.data
    },
    enabled: open && Boolean(statusQuery.data?.connected) && !linkQuery.data?.link,
  })

  // Form states
  const [targetTab, setTargetTab] = React.useState<"create" | "existing">("create")
  const [newRepoName, setNewRepoName] = React.useState("")
  const [isPrivate, setIsPrivate] = React.useState(true)
  const [selectedRepoFullName, setSelectedRepoFullName] = React.useState("")
  const [branchMode, setBranchMode] = React.useState<"existing" | "new">("existing")
  const [newBranchName, setNewBranchName] = React.useState("")
  const [commitMessage, setCommitMessage] = React.useState("")

  // Push progress & result states
  const [pushing, setPushing] = React.useState(false)
  const [currentStep, setCurrentStep] = React.useState<PushStep | null>(null)
  const [pushResult, setPushResult] = React.useState<PushResult | null>(null)
  const [pushError, setPushError] = React.useState<PushError | null>(null)
  const [oauthNotice, setOauthNotice] = React.useState<string | null>(null)

  // Initialize defaults when query data resolves
  React.useEffect(() => {
    if (projectName && !newRepoName) {
      setNewRepoName(slug(projectName))
    }
  }, [projectName, newRepoName])

  React.useEffect(() => {
    if (linkQuery.data?.suggestedMessage && !commitMessage) {
      setCommitMessage(linkQuery.data.suggestedMessage)
    }
  }, [linkQuery.data?.suggestedMessage, commitMessage])

  React.useEffect(() => {
    if (!newBranchName) {
      setNewBranchName(defaultBranchName())
    }
  }, [newBranchName])

  React.useEffect(() => {
    if (reposQuery.data?.repos?.length && !selectedRepoFullName) {
      setSelectedRepoFullName(reposQuery.data.repos[0].full_name)
    }
  }, [reposQuery.data?.repos, selectedRepoFullName])

  // OAuth return handler from URL params (?github=connected|error&reason=...)
  const handledOauth = React.useRef(false)
  React.useEffect(() => {
    if (handledOauth.current) return
    handledOauth.current = true
    const url = new URL(window.location.href)
    const result = url.searchParams.get("github")
    if (!result) return
    const reason = url.searchParams.get("reason")
    for (const k of ["github", "reason"]) url.searchParams.delete(k)
    window.history.replaceState(null, "", url.pathname + (url.search ? url.search : "") + url.hash)

    if (result === "connected") {
      void queryClient.invalidateQueries({ queryKey: ["github-status"] })
      void queryClient.invalidateQueries({ queryKey: ["project-github", projectId] })
      void queryClient.invalidateQueries({ queryKey: ["github-repos"] })
      onOpenChange(true)
    } else {
      const messages: Record<string, string> = {
        denied: "You cancelled the GitHub authorization.",
        expired: "The GitHub authorization expired. Please try again.",
        not_configured: "GitHub integration is not configured on this server.",
        failed: "Failed to connect to GitHub. Please try again.",
      }
      setOauthNotice(messages[reason ?? "failed"] ?? messages.failed)
      onOpenChange(true)
    }
  }, [onOpenChange, projectId, queryClient])

  const handleStartPush = async () => {
    setPushError(null)
    setPushResult(null)
    setPushing(true)
    setCurrentStep("resolving-repo")

    const linked = linkQuery.data?.link
    let targetPayload: Record<string, unknown>

    if (linked) {
      targetPayload = {
        kind: "existing",
        owner: linked.repoOwner,
        name: linked.repoName,
      }
    } else if (targetTab === "create") {
      targetPayload = {
        kind: "create",
        name: newRepoName.trim() || slug(projectName),
        private: isPrivate,
      }
    } else {
      const [owner, name] = selectedRepoFullName.split("/")
      targetPayload = {
        kind: "existing",
        owner,
        name,
      }
    }

    const branchPayload =
      linked && branchMode === "new"
        ? { mode: "new", name: newBranchName.trim() || defaultBranchName() }
        : { mode: "existing" }

    const body = {
      target: targetPayload,
      branch: branchPayload,
      message: commitMessage.trim() || linkQuery.data?.suggestedMessage || "Update project files",
    }

    try {
      const res = await apiClient.post<ReadableStream>(
        `/api/projects/${projectId}/github/push`,
        body,
        {
          adapter: "fetch",
          responseType: "stream",
        }
      )

      const stream = res.data ?? (res.request?.response as Response | undefined)?.body ?? null
      if (!stream) throw new Error("No response body received from server.")

      const reader = stream.pipeThrough(new TextDecoderStream()).getReader()
      let buf = ""

      for (;;) {
        const { value, done } = await reader.read()
        if (done) break
        buf += value
        let sep: number
        while ((sep = buf.indexOf("\n\n")) !== -1) {
          const chunk = buf.slice(0, sep)
          buf = buf.slice(sep + 2)
          const data = chunk
            .split("\n")
            .filter((l) => l.startsWith("data:"))
            .map((l) => l.slice(5).trimStart())
            .join("\n")
          if (!data) continue
          try {
            const event = JSON.parse(data) as
              | { type: "step"; step: PushStep }
              | ({ type: "done" } & PushResult)
              | { type: "error"; code: string; message: string }

            if (event.type === "step") {
              setCurrentStep(event.step)
            } else if (event.type === "done") {
              setPushResult({
                owner: event.owner,
                name: event.name,
                branch: event.branch,
                commitSha: event.commitSha,
                htmlUrl: event.htmlUrl,
              })
              void queryClient.invalidateQueries({ queryKey: ["project-github", projectId] })
            } else if (event.type === "error") {
              setPushError({ code: event.code, message: event.message })
              if (event.code === "auth_expired") {
                void queryClient.invalidateQueries({ queryKey: ["github-status"] })
              }
            }
          } catch {
            // Ignore parse errors on individual chunks
          }
        }
      }
    } catch (err) {
      const status = getApiErrorStatus(err)
      const data = getApiErrorData<{ error?: string; message?: string }>(err)
      if (status === 409 || data?.error === "not_connected") {
        setPushError({
          code: "auth_expired",
          message: "Your GitHub account is not connected or authorization expired.",
        })
        void queryClient.invalidateQueries({ queryKey: ["github-status"] })
      } else {
        setPushError({
          code: "push_failed",
          message: data?.message || data?.error || "Failed to push to GitHub.",
        })
      }
    } finally {
      setPushing(false)
    }
  }

  const handleDone = () => {
    setPushResult(null)
    setPushError(null)
    setCurrentStep(null)
    onOpenChange(false)
  }

  const stepOrder = PUSH_STEPS.map((s) => s.id)
  const currentStepIndex = currentStep ? stepOrder.indexOf(currentStep) : -1

  const isConnected = Boolean(statusQuery.data?.connected)
  const isConfigured = statusQuery.data?.configured !== false
  const linked = linkQuery.data?.link

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <div className="flex items-center justify-between gap-2">
            <div className="flex items-center gap-2">
              <span className="flex size-8 items-center justify-center rounded-lg bg-zinc-900 text-white dark:bg-white dark:text-zinc-900">
                <Github className="size-4" />
              </span>
              <div>
                <DialogTitle>Push to GitHub</DialogTitle>
                <DialogDescription>
                  {statusQuery.data?.login
                    ? `Connected as @${statusQuery.data.login}`
                    : "Export your project directly to a GitHub repository"}
                </DialogDescription>
              </div>
            </div>
            {statusQuery.data?.login && (
              <Button
                variant="outline"
                size="sm"
                className="h-7 text-xs"
                onClick={() => {
                  window.location.assign(`/api/github/connect?projectId=${encodeURIComponent(projectId)}&reconnect=1`)
                }}
              >
                Reconnect
              </Button>
            )}
          </div>
        </DialogHeader>

        {oauthNotice && (
          <Alert variant="destructive" className="py-2.5">
            <AlertCircle className="size-4" />
            <AlertTitle>Connection note</AlertTitle>
            <AlertDescription className="text-xs">{oauthNotice}</AlertDescription>
          </Alert>
        )}

        {statusQuery.isLoading || (isConnected && linkQuery.isLoading) ? (
          <div className="flex flex-col items-center justify-center py-8">
            <Spinner className="size-6 text-primary" />
            <p className="mt-2 text-xs text-muted-foreground">Checking GitHub connection…</p>
          </div>
        ) : !isConfigured ? (
          <div className="space-y-4 py-2">
            <Alert variant="destructive">
              <AlertCircle className="size-4" />
              <AlertTitle>GitHub not configured</AlertTitle>
              <AlertDescription className="text-xs">
                GitHub export isn't configured on this server yet. Set GITHUB_CLIENT_ID and
                GITHUB_CLIENT_SECRET to enable GitHub integration.
              </AlertDescription>
            </Alert>
            <DialogFooter>
              <Button variant="outline" onClick={() => onOpenChange(false)}>
                Close
              </Button>
            </DialogFooter>
          </div>
        ) : !isConnected ? (
          <div className="space-y-4 py-2">
            <p className="text-sm text-muted-foreground">
              Authorize Anything to access your repositories so you can export and update this app
              directly on GitHub.
            </p>
            <Button
              className="w-full"
              onClick={() => {
                window.location.assign(
                  `/api/github/connect?projectId=${encodeURIComponent(projectId)}`
                )
              }}
            >
              <Github className="mr-2 size-4" /> Connect GitHub
            </Button>
          </div>
        ) : pushResult ? (
          <div className="space-y-4 py-2">
            <div className="flex flex-col items-center justify-center rounded-lg border border-emerald-500/20 bg-emerald-500/10 p-4 text-center">
              <CheckCircle2 className="size-8 text-emerald-600 dark:text-emerald-400" />
              <h3 className="mt-2 text-sm font-semibold text-emerald-950 dark:text-emerald-100">
                Push succeeded!
              </h3>
              <p className="mt-1 text-xs text-muted-foreground">
                Pushed to{" "}
                <span className="font-mono font-medium text-foreground">
                  {pushResult.owner}/{pushResult.name}
                </span>{" "}
                ({pushResult.branch})
              </p>
              <a
                href={pushResult.htmlUrl}
                target="_blank"
                rel="noopener noreferrer"
                className="mt-3 inline-flex items-center gap-1.5 text-xs font-medium text-primary hover:underline"
              >
                View commit on GitHub <ExternalLink className="size-3" />
              </a>
            </div>
            <DialogFooter>
              <Button className="w-full" onClick={handleDone}>
                Done
              </Button>
            </DialogFooter>
          </div>
        ) : pushing ? (
          <div className="space-y-4 py-2">
            <p className="text-xs text-muted-foreground">
              Exporting and pushing your project to GitHub…
            </p>
            <ul className="space-y-2.5 rounded-lg border border-border p-3">
              {PUSH_STEPS.map((step, idx) => {
                const isPassed = currentStepIndex > idx
                const isCurrent = currentStepIndex === idx
                return (
                  <li key={step.id} className="flex items-center gap-2.5 text-xs">
                    {isPassed ? (
                      <span className="flex size-4 items-center justify-center rounded-full bg-emerald-500/15 text-emerald-600 dark:text-emerald-400">
                        <Check className="size-2.5 stroke-[3]" />
                      </span>
                    ) : isCurrent ? (
                      <Spinner className="size-4 text-primary" />
                    ) : (
                      <span className="size-4 rounded-full border border-muted-foreground/30" />
                    )}
                    <span
                      className={
                        isPassed
                          ? "text-foreground font-medium"
                          : isCurrent
                            ? "text-primary font-medium"
                            : "text-muted-foreground"
                      }
                    >
                      {step.label}
                    </span>
                  </li>
                )
              })}
            </ul>
          </div>
        ) : (
          <div className="space-y-4 py-2">
            {pushError && (
              <Alert variant="destructive" className="py-2.5">
                <AlertCircle className="size-4" />
                <AlertTitle>Push failed</AlertTitle>
                <AlertDescription className="text-xs">
                  {pushError.code === "auth_expired" ? (
                    <div className="space-y-2">
                      <p>Your GitHub authorization has expired or was revoked.</p>
                      <Button
                        size="sm"
                        variant="outline"
                        className="h-7 text-xs"
                        onClick={() => {
                          window.location.assign(
                            `/api/github/connect?projectId=${encodeURIComponent(projectId)}&reconnect=1`
                          )
                        }}
                      >
                        Reconnect GitHub
                      </Button>
                    </div>
                  ) : pushError.code === "name_conflict" ? (
                    "A repository with this name already exists. Please pick a different name or use an existing repository."
                  ) : pushError.code === "rate_limited" ? (
                    "GitHub API rate limit exceeded. Please wait a moment and try again."
                  ) : (
                    pushError.message
                  )}
                </AlertDescription>
              </Alert>
            )}

            {linked ? (
              <div className="space-y-3">
                <div className="rounded-lg border border-border bg-muted/40 p-3">
                  <div className="flex items-center justify-between text-xs">
                    <span className="text-muted-foreground">Linked repository</span>
                    <a
                      href={`https://github.com/${linked.repoOwner}/${linked.repoName}`}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="inline-flex items-center gap-1 font-mono font-medium hover:underline text-foreground"
                    >
                      {linked.repoOwner}/{linked.repoName}
                      <ExternalLink className="size-3 text-muted-foreground" />
                    </a>
                  </div>
                </div>

                <div className="space-y-2">
                  <Label className="text-xs">Branch</Label>
                  <RadioGroup
                    value={branchMode}
                    onValueChange={(val) => setBranchMode(val as "existing" | "new")}
                    className="gap-2"
                  >
                    <label className="flex cursor-pointer items-center gap-2 rounded-lg border border-input p-2 text-xs hover:bg-muted/30">
                      <RadioGroupItem value="existing" id="branch-existing" />
                      <div className="flex-1">
                        <span className="font-medium">Commit to {linked.lastBranch}</span>
                        <p className="text-[11px] text-muted-foreground">Fast-forward the current branch tip</p>
                      </div>
                    </label>
                    <label className="flex cursor-pointer items-center gap-2 rounded-lg border border-input p-2 text-xs hover:bg-muted/30">
                      <RadioGroupItem value="new" id="branch-new" />
                      <div className="flex-1">
                        <span className="font-medium">Create a new branch</span>
                        <p className="text-[11px] text-muted-foreground">Branch off the current tip</p>
                      </div>
                    </label>
                  </RadioGroup>
                </div>

                {branchMode === "new" && (
                  <div className="space-y-1.5">
                    <Label htmlFor="new-branch-name" className="text-xs">
                      New branch name
                    </Label>
                    <Input
                      id="new-branch-name"
                      value={newBranchName}
                      onChange={(e) => setNewBranchName(e.target.value)}
                      placeholder="e.g. export-20261119-1200"
                      className="h-8 text-xs font-mono"
                    />
                  </div>
                )}
              </div>
            ) : (
              <Tabs
                value={targetTab}
                onValueChange={(val) => setTargetTab(val as "create" | "existing")}
              >
                <TabsList className="grid w-full grid-cols-2">
                  <TabsTrigger value="create" className="text-xs">
                    Create new repository
                  </TabsTrigger>
                  <TabsTrigger value="existing" className="text-xs">
                    Use existing
                  </TabsTrigger>
                </TabsList>

                <TabsContent value="create" className="space-y-3 pt-2">
                  <div className="space-y-1.5">
                    <Label htmlFor="repo-name" className="text-xs">
                      Repository name
                    </Label>
                    <Input
                      id="repo-name"
                      value={newRepoName}
                      onChange={(e) => setNewRepoName(e.target.value)}
                      placeholder="my-cool-app"
                      className="h-8 text-xs"
                    />
                  </div>

                  <div className="flex items-center justify-between rounded-lg border border-input p-2.5">
                    <div className="space-y-0.5">
                      <Label htmlFor="private-switch" className="text-xs font-medium cursor-pointer">
                        Private repository
                      </Label>
                      <p className="text-[11px] text-muted-foreground">
                        Only you can see this repository
                      </p>
                    </div>
                    <Switch
                      id="private-switch"
                      checked={isPrivate}
                      onCheckedChange={setIsPrivate}
                    />
                  </div>
                </TabsContent>

                <TabsContent value="existing" className="space-y-3 pt-2">
                  <div className="space-y-1.5">
                    <Label htmlFor="select-repo" className="text-xs">
                      Select repository
                    </Label>
                    {reposQuery.isLoading ? (
                      <div className="flex items-center gap-2 py-2 text-xs text-muted-foreground">
                        <Spinner className="size-3.5" /> Loading your repositories…
                      </div>
                    ) : reposQuery.data?.repos?.length ? (
                      <NativeSelect
                        id="select-repo"
                        value={selectedRepoFullName}
                        onChange={(e) => setSelectedRepoFullName(e.target.value)}
                        className="w-full"
                      >
                        {reposQuery.data.repos.map((r) => (
                          <NativeSelectOption key={r.id} value={r.full_name}>
                            {r.full_name} {r.private ? "(private)" : ""}
                          </NativeSelectOption>
                        ))}
                      </NativeSelect>
                    ) : (
                      <p className="text-xs text-muted-foreground">No repositories found.</p>
                    )}
                  </div>
                </TabsContent>
              </Tabs>
            )}

            <div className="space-y-1.5 pt-1">
              <Label htmlFor="commit-msg" className="text-xs">
                Commit message
              </Label>
              <Input
                id="commit-msg"
                value={commitMessage}
                onChange={(e) => setCommitMessage(e.target.value)}
                placeholder="Commit message"
                className="h-8 text-xs"
              />
            </div>

            <DialogFooter className="pt-2 sm:justify-between">
              <Button variant="outline" size="sm" onClick={() => onOpenChange(false)}>
                Cancel
              </Button>
              <Button
                size="sm"
                onClick={handleStartPush}
                disabled={
                  Boolean(
                    pushing ||
                    (!linked && targetTab === "create" && !newRepoName.trim()) ||
                    (!linked && targetTab === "existing" && !selectedRepoFullName) ||
                    (linked && branchMode === "new" && !newBranchName.trim())
                  )
                }
              >
                {linked ? "Push changes" : "Push to GitHub"}
              </Button>
            </DialogFooter>
          </div>
        )}
      </DialogContent>
    </Dialog>
  )
}
