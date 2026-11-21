"use client"

import * as React from "react"
import { useMutation, useQuery } from "@tanstack/react-query"
import {
  AlertCircle,
  Apple,
  Check,
  CheckCircle2,
  Clock,
  Copy,
  Download,
  ExternalLink,
  GitBranch,
  Github,
  Globe,
  KeyRound,
  RefreshCw,
  Rocket,
  Smartphone,
  Square,
  Terminal,
} from "lucide-react"

import type { BuildFormat, BuildPlatform, BuildRow, WebDeployRunRow, WebDeploymentRow } from "@app/shared/api-types"
import { apiClient, getApiErrorMessage } from "@/lib/api-client"
import { useStopWebDeploy } from "@/hooks/use-stop-web-deploy"
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert"
import { Badge } from "@/components/ui/badge"
import { Button, buttonVariants } from "@/components/ui/button"
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
import { Spinner } from "@/components/ui/spinner"
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs"

const SEMVER_REGEX = /^\d+\.\d+\.\d+(-[0-9A-Za-z.-]+)?(\+[0-9A-Za-z.-]+)?$/

function formatBuildError(rawError: string | null | undefined): string {
  if (!rawError) return "Build encountered an error."
  const trimmed = rawError.trim()

  try {
    const parsed = JSON.parse(trimmed)
    if (parsed && typeof parsed === "object") {
      if (typeof parsed.message === "string" && parsed.message.trim()) return parsed.message
      if (typeof parsed.error === "string" && parsed.error.trim()) return parsed.error
      if (parsed.error && typeof parsed.error === "object" && typeof parsed.error.message === "string") {
        return parsed.error.message
      }
    }
  } catch {}

  const msgMatch = trimmed.match(/"message"\s*:\s*"([^"]+)"/)
  if (msgMatch?.[1]) return msgMatch[1]

  if (
    trimmed.includes('"logFiles"') ||
    trimmed.includes('"initiatingActor"') ||
    trimmed.startsWith("{") ||
    trimmed.startsWith(": {") ||
    trimmed.includes("Goog-Signature")
  ) {
    return "EAS build failed. Check the workflow run log for details."
  }

  return trimmed
}

function WebRunStatusBadge({ status }: { status: WebDeployRunRow["status"] }) {
  const isInFlight =
    status === "queued" || status === "dispatching" || status === "building" || status === "deploying"

  if (isInFlight) {
    return (
      <Badge variant="outline" className="gap-1 border-blue-500/30 text-blue-500 bg-blue-500/10">
        <Spinner className="size-3" />
        {status === "queued"
          ? "Queued"
          : status === "dispatching"
          ? "Dispatching"
          : status === "building"
          ? "Building"
          : "Deploying"}
      </Badge>
    )
  }
  if (status === "ready") {
    return (
      <Badge variant="outline" className="gap-1 border-emerald-500/30 text-emerald-600 dark:text-emerald-400 bg-emerald-500/10">
        <CheckCircle2 className="size-3" />
        Live
      </Badge>
    )
  }
  return (
    <Badge variant="outline" className="gap-1 border-destructive/30 text-destructive bg-destructive/10">
      <AlertCircle className="size-3" />
      Failed
    </Badge>
  )
}

export function PublishDialog({
  open,
  onOpenChange,
  projectId,
  projectName,
  onOpenGithubDialog,
  onOpenExpoDialog,
}: {
  open: boolean
  onOpenChange: (open: boolean) => void
  projectId: string
  projectName: string
  onOpenGithubDialog?: () => void
  onOpenExpoDialog?: () => void
}) {
  const [platform, setPlatform] = React.useState<BuildPlatform>("android")
  const [format, setFormat] = React.useState<BuildFormat>("apk")
  const [version, setVersion] = React.useState("1.0.0")
  const [errorMessage, setErrorMessage] = React.useState<string | null>(null)
  const [activeTab, setActiveTab] = React.useState<"mobile" | "web">("mobile")
  const [copiedUrl, setCopiedUrl] = React.useState(false)

  const handleCopyUrl = (url: string) => {
    navigator.clipboard.writeText(url)
    setCopiedUrl(true)
    setTimeout(() => setCopiedUrl(false), 1500)
  }

  // Synchronize format whenever platform changes
  React.useEffect(() => {
    if (platform === "android") {
      if (format !== "apk" && format !== "aab") setFormat("apk")
    } else {
      setFormat("ipa")
    }
  }, [platform, format])

  // Reset errors when dialog opens
  React.useEffect(() => {
    if (open) {
      setErrorMessage(null)
    }
  }, [open])

  // 1. Check GitHub connection & link status
  const githubLinkQuery = useQuery({
    queryKey: ["project-github", projectId],
    queryFn: async () => {
      const res = await apiClient.get<{
        link: {
          repoOwner: string
          repoName: string
          lastBranch: string
          lastCommitSha?: string | null
        } | null
      }>(`/api/projects/${projectId}/github`)
      return res.data
    },
    enabled: open,
    staleTime: Infinity,
  })

  // 2. Check Expo account connection status
  const expoStatusQuery = useQuery({
    queryKey: ["expo-status"],
    queryFn: async () => {
      const res = await apiClient.get<{ connected: boolean; username?: string | null }>(
        "/api/expo/status"
      )
      return res.data
    },
    enabled: open,
    staleTime: Infinity,
  })

  // These four queries are never stale on their own (staleTime: Infinity), so reopening the
  // dialog doesn't refetch them. Builds and the web deploy are refreshed by the workspace's
  // status stream (useProjectStatusStream); the GitHub link and Expo status by the dialogs
  // that change them.

  // 3. Query all builds for this project
  const buildsQuery = useQuery({
    queryKey: ["project-builds", projectId],
    queryFn: async () => {
      const res = await apiClient.get<{ builds: BuildRow[] }>(
        `/api/projects/${projectId}/builds`
      )
      return res.data.builds
    },
    enabled: open,
    staleTime: Infinity,
  })

  const builds = buildsQuery.data || []
  const hasBuilds = builds.length > 0
  const isLinked = Boolean(githubLinkQuery.data?.link)
  const isExpoConnected = Boolean(expoStatusQuery.data?.connected)

  // Publish mutation
  const publishMutation = useMutation({
    mutationFn: async () => {
      const res = await apiClient.post<{ buildId: string }>(
        `/api/projects/${projectId}/publish`,
        {
          platform,
          format,
          version,
        }
      )
      return res.data
    },
    // No refetch in these three mutations: the status stream reports the change.
    onSuccess: () => setErrorMessage(null),
    onError: (err) => {
      setErrorMessage(getApiErrorMessage(err, "Failed to start publish workflow."))
    },
  })

  // Retry mutation
  const retryMutation = useMutation({
    mutationFn: async (buildId: string) => {
      const res = await apiClient.post<{ buildId: string }>(
        `/api/projects/${projectId}/builds/${buildId}/retry`
      )
      return res.data
    },
    onSuccess: () => setErrorMessage(null),
    onError: (err) => {
      setErrorMessage(getApiErrorMessage(err, "Failed to retry build."))
    },
  })

  // Stop: a workflow that never reports back leaves a build "in flight" forever, which blocks new ones.
  const stopBuildMutation = useMutation({
    mutationFn: async (buildId: string) => {
      await apiClient.post(`/api/projects/${projectId}/builds/${buildId}/stop`, {})
    },
    // No refetch: the status stream reports the change.
    onSuccess: () => setErrorMessage(null),
    onError: (err) => {
      setErrorMessage(getApiErrorMessage(err, "Failed to stop the build."))
    },
  })
  const stopWebMutation = useStopWebDeploy(projectId, setErrorMessage)

  // Web deploy query & mutation
  const webDeployQuery = useQuery({
    queryKey: ["project-web-deploy", projectId],
    queryFn: async () =>
      (
        await apiClient.get<{ deployment: WebDeploymentRow | null; runs: WebDeployRunRow[] }>(
          `/api/projects/${projectId}/publish/web`
        )
      ).data,
    enabled: open,
    staleTime: Infinity,
  })

  const webDeployMutation = useMutation({
    mutationFn: async () => {
      const res = await apiClient.post<{ ok: true; deployment?: WebDeploymentRow }>(
        `/api/projects/${projectId}/publish/web`,
        {}
      )
      return res.data
    },
    onSuccess: () => setErrorMessage(null),
    onError: (err) => {
      setErrorMessage(getApiErrorMessage(err, "Failed to start web deployment."))
    },
  })

  const isVersionValid = SEMVER_REGEX.test(version.trim())
  const canPublish = isLinked && isExpoConnected && isVersionValid && !publishMutation.isPending

  const webDeployment = webDeployQuery.data?.deployment
  const webRuns = webDeployQuery.data?.runs || []
  const webStatus = webDeployment?.status
  const isWebInFlight =
    webStatus === "queued" ||
    webStatus === "dispatching" ||
    webStatus === "building" ||
    webStatus === "deploying"
  const canDeployWeb = isLinked && isExpoConnected && !isWebInFlight && !webDeployMutation.isPending

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-4xl max-h-[min(90vh,780px)] flex flex-col min-w-0 overflow-hidden">
        <DialogHeader className="shrink-0">
          <DialogTitle className="flex items-center gap-2">
            <Rocket className="size-5 text-primary" />
            Publish & Export
          </DialogTitle>
          <DialogDescription>
            Publish and export <span className="font-medium text-foreground">{projectName}</span> as a web application or native Android/iOS package.
          </DialogDescription>
        </DialogHeader>

        <Tabs
          value={activeTab}
          onValueChange={(val) => setActiveTab(val as "mobile" | "web")}
          className="flex flex-col flex-1 min-h-0 min-w-0 w-full overflow-hidden"
        >
          <TabsList className="grid w-full grid-cols-2 shrink-0">
            <TabsTrigger value="mobile" className="gap-1.5">
              <Smartphone className="size-3.5" />
              Mobile
            </TabsTrigger>
            <TabsTrigger value="web" className="gap-1.5">
              <Globe className="size-3.5" />
              Web
            </TabsTrigger>
          </TabsList>

          <TabsContent
            value="mobile"
            className="flex-1 min-h-0 min-w-0 grid grid-cols-1 lg:grid-cols-2 gap-4 pt-3 overflow-hidden"
          >
            {/* Left: build form */}
            <div className="flex flex-col min-h-0 overflow-y-auto pr-1 space-y-4">
              {isLinked && (
                <div className="flex items-center gap-2 rounded-lg border border-border bg-muted/40 px-3 py-2 text-xs text-muted-foreground">
                  <GitBranch className="size-3.5 shrink-0 text-primary" />
                  <span>
                    The <span className="font-semibold text-foreground">main</span> branch will be pushed to GitHub & Expo EAS for this build.
                  </span>
                </div>
              )}
              {errorMessage && (
                <Alert variant="destructive">
                  <AlertCircle className="size-4" />
                  <AlertTitle>Publish Error</AlertTitle>
                  <AlertDescription className="space-y-2 mt-1">
                    <p className="text-xs">{errorMessage}</p>
                    {errorMessage.toLowerCase().includes("workflow") && (
                      <Button
                        size="sm"
                        variant="outline"
                        className="border-destructive/30 hover:bg-destructive/20 h-7 text-xs"
                        onClick={() => {
                          window.location.assign(`/api/github/connect?projectId=${encodeURIComponent(projectId)}&reconnect=1`)
                        }}
                      >
                        <Github className="size-3.5 mr-1.5" />
                        Reconnect GitHub
                      </Button>
                    )}
                  </AlertDescription>
                </Alert>
              )}

              {/* Gating check 1: GitHub Link */}
              {!githubLinkQuery.isLoading && !isLinked && (
                <Alert className="border-amber-500/20 bg-amber-500/10 text-amber-900 dark:text-amber-200">
                  <Github className="size-4 text-amber-600 dark:text-amber-400" />
                  <AlertTitle>GitHub Repository Required</AlertTitle>
                  <AlertDescription className="mt-1 space-y-2">
                    <p className="text-xs">
                      This project must be linked to a GitHub repository so GitHub Actions can run your build compute for free.
                    </p>
                    <Button
                      size="sm"
                      variant="outline"
                      className="border-amber-500/30 hover:bg-amber-500/20"
                      onClick={() => {
                        onOpenGithubDialog?.()
                      }}
                    >
                      <Github className="size-3.5 mr-1.5" />
                      Push to GitHub first
                    </Button>
                  </AlertDescription>
                </Alert>
              )}

              {/* Gating check 2: Expo Connection */}
              {!expoStatusQuery.isLoading && !isExpoConnected && (
                <Alert className="border-amber-500/20 bg-amber-500/10 text-amber-900 dark:text-amber-200">
                  <KeyRound className="size-4 text-amber-600 dark:text-amber-400" />
                  <AlertTitle>Expo / EAS Account Required</AlertTitle>
                  <AlertDescription className="mt-1 space-y-2">
                    <p className="text-xs">
                      Builds are created via your Expo Personal Access Token. Connect your token to enable EAS builds.
                    </p>
                    <Button
                      size="sm"
                      variant="outline"
                      className="border-amber-500/30 hover:bg-amber-500/20"
                      onClick={() => {
                        onOpenExpoDialog?.()
                      }}
                    >
                      <KeyRound className="size-3.5 mr-1.5" />
                      Connect Expo
                    </Button>
                  </AlertDescription>
                </Alert>
              )}

              <div className="grid gap-4 py-1">
                {/* Platform selector */}
                <div className="space-y-2">
                  <Label>Target Platform</Label>
                  <div className="grid grid-cols-2 gap-3">
                    <button
                      type="button"
                      onClick={() => setPlatform("android")}
                      className={`flex items-center gap-2.5 rounded-lg border p-3 text-left transition-colors ${
                        platform === "android"
                          ? "border-primary bg-primary/5 ring-1 ring-primary"
                          : "border-border hover:bg-muted/50"
                      }`}
                    >
                      <Smartphone className="size-5 text-emerald-500" />
                      <div>
                        <p className="text-sm font-medium leading-none">Android</p>
                        <p className="text-xs text-muted-foreground mt-1">.apk (Device) / .aab (Play Store)</p>
                      </div>
                    </button>

                    <button
                      type="button"
                      onClick={() => setPlatform("ios")}
                      className={`flex items-center gap-2.5 rounded-lg border p-3 text-left transition-colors ${
                        platform === "ios"
                          ? "border-primary bg-primary/5 ring-1 ring-primary"
                          : "border-border hover:bg-muted/50"
                      }`}
                    >
                      <Apple className="size-5 text-foreground" />
                      <div>
                        <p className="text-sm font-medium leading-none">iOS</p>
                        <p className="text-xs text-muted-foreground mt-1">.ipa (Apple Archive)</p>
                      </div>
                    </button>
                  </div>
                </div>

                {/* Format selector */}
                <div className="space-y-2">
                  <Label htmlFor="build-format">Build Format</Label>
                  {platform === "android" ? (
                    <NativeSelect
                      id="build-format"
                      value={format}
                      onChange={(e) => setFormat(e.target.value as BuildFormat)}
                      className="w-full"
                    >
                      <NativeSelectOption value="apk">
                        APK — Install directly on Android devices (.apk)
                      </NativeSelectOption>
                      <NativeSelectOption value="aab">
                        AAB — Android App Bundle for Google Play Store (.aab)
                      </NativeSelectOption>
                    </NativeSelect>
                  ) : (
                    <div className="rounded-lg border border-input bg-muted/30 px-3 py-2 text-sm text-foreground">
                      IPA — iOS Release Archive (.ipa)
                    </div>
                  )}
                </div>

                {/* Version input */}
                <div className="space-y-2">
                  <div className="flex items-center justify-between">
                    <Label htmlFor="version-input">Release Version</Label>
                    <span className="text-xs text-muted-foreground">Semver format (e.g. 1.0.0)</span>
                  </div>
                  <Input
                    id="version-input"
                    value={version}
                    onChange={(e) => setVersion(e.target.value)}
                    placeholder="1.0.0"
                    className={!isVersionValid && version ? "border-destructive focus-visible:ring-destructive" : ""}
                  />
                  {!isVersionValid && version && (
                    <p className="text-xs text-destructive">Please enter a valid semver version (e.g. 1.0.0).</p>
                  )}
                </div>

                {/* iOS credentials note */}
                {platform === "ios" && (
                  <div className="flex items-start gap-2.5 rounded-lg border border-blue-500/20 bg-blue-500/10 p-3 text-xs text-blue-900 dark:text-blue-200">
                    <Terminal className="size-4 shrink-0 text-blue-600 dark:text-blue-400 mt-0.5" />
                    <div>
                      <p className="font-medium">iOS Apple Developer Credentials Note</p>
                      <p className="mt-0.5 text-blue-800/80 dark:text-blue-300/80">
                        EAS requires an Apple Developer account and signing credentials configured in your Expo account to build .ipa files.
                      </p>
                    </div>
                  </div>
                )}
              </div>
            </div>

            {/* Right: build history */}
            <div className="flex flex-col min-h-0 overflow-hidden border-t pt-4 lg:border-t-0 lg:border-l lg:pt-0 lg:pl-4">
              <h4 className="shrink-0 text-sm font-semibold mb-2.5 flex items-center justify-between">
                Build History {hasBuilds ? <span className="text-xs font-normal text-muted-foreground">({builds.length})</span> : null}
              </h4>
              {buildsQuery.isLoading ? (
                <div className="flex items-center justify-center py-10">
                  <Spinner className="size-6 text-muted-foreground" />
                </div>
              ) : builds.length === 0 ? (
                <div className="flex flex-col items-center justify-center py-10 text-center flex-1">
                  <Smartphone className="size-10 text-muted-foreground/40 mb-3" />
                  <p className="text-sm font-medium">No builds yet</p>
                  <p className="text-xs text-muted-foreground mt-1 max-w-sm">
                    Start your first native build using the form on the left.
                  </p>
                </div>
              ) : (
                <div className="flex-1 min-h-0 overflow-y-auto space-y-3 pr-1 min-w-0">
                  {builds.map((build) => {
                    const isReady = build.status === "ready"
                    const isFailed = build.status === "failed"
                    const isInProgress =
                      build.status === "queued" ||
                      build.status === "dispatching" ||
                      build.status === "building"
                    const isIosCredentialsError = Boolean(build.needsIosCredentials)

                    return (
                      <div
                        key={build.id}
                        className="rounded-lg border bg-card p-3.5 text-card-foreground space-y-2.5 transition-all min-w-0 overflow-hidden"
                      >
                        <div className="flex items-center justify-between gap-2">
                          <div className="flex items-center gap-2">
                            {build.platform === "android" ? (
                              <Smartphone className="size-4 text-emerald-500" />
                            ) : (
                              <Apple className="size-4 text-foreground" />
                            )}
                            <span className="font-semibold text-sm">
                              {build.platform === "android" ? "Android" : "iOS"}{" "}
                              <span className="uppercase text-xs font-mono font-medium text-muted-foreground">
                                ({build.format})
                              </span>
                            </span>
                            <span className="text-xs text-muted-foreground font-mono">v{build.version}</span>
                          </div>

                          <div className="flex items-center gap-1.5 shrink-0">
                            {isInProgress && (
                              <Badge variant="outline" className="gap-1 border-blue-500/30 text-blue-500 bg-blue-500/10">
                                <Spinner className="size-3" />
                                {build.status === "queued"
                                  ? "Queued"
                                  : build.status === "dispatching"
                                  ? "Dispatching"
                                  : "Building"}
                              </Badge>
                            )}
                            {isReady && (
                              <Badge variant="outline" className="gap-1 border-emerald-500/30 text-emerald-600 dark:text-emerald-400 bg-emerald-500/10">
                                <CheckCircle2 className="size-3" />
                                Ready
                              </Badge>
                            )}
                            {isFailed && (
                              <Badge variant="outline" className="gap-1 border-destructive/30 text-destructive bg-destructive/10">
                                <AlertCircle className="size-3" />
                                Failed
                              </Badge>
                            )}
                          </div>
                        </div>

                        {/* Error details if failed */}
                        {isFailed && (
                          <div className="rounded-md bg-destructive/10 border border-destructive/20 p-2.5 text-xs text-destructive space-y-1 min-w-0 overflow-hidden">
                            {isIosCredentialsError ? (
                              <div className="space-y-1">
                                <p className="font-semibold">Apple Developer Credentials Required</p>
                                <p className="text-muted-foreground">
                                  EAS reported that your Apple Developer signing credentials (Distribution Certificate or Provisioning Profile) are not configured. Run <code className="bg-destructive/20 px-1 py-0.5 rounded font-mono">eas credentials</code> or configure credentials on <a href="https://expo.dev" target="_blank" rel="noopener noreferrer" className="underline font-medium">expo.dev</a>.
                                </p>
                              </div>
                            ) : (
                              <p className="font-mono text-xs break-all [overflow-wrap:anywhere] line-clamp-3">
                                {formatBuildError(build.error)}
                              </p>
                            )}
                          </div>
                        )}

                        {/* Action buttons & links */}
                        <div className="flex items-center justify-between pt-1 text-xs gap-2">
                          <div className="flex items-center gap-2 text-muted-foreground truncate min-w-0">
                            <Clock className="size-3 shrink-0" />
                            <span className="truncate">{new Date(build.createdAt).toLocaleString()}</span>
                          </div>

                          <div className="flex items-center gap-2 shrink-0">
                            {build.workflowRunUrl && (
                              <a
                                href={build.workflowRunUrl}
                                target="_blank"
                                rel="noopener noreferrer"
                                className="inline-flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground"
                              >
                                Log <ExternalLink className="size-3" />
                              </a>
                            )}

                            {isReady && build.artifactUrl && (
                              <a
                                href={build.artifactUrl}
                                target="_blank"
                                rel="noopener noreferrer"
                                className={buttonVariants({ size: "sm", className: "h-7 px-2.5 text-xs inline-flex items-center gap-1" })}
                              >
                                <Download className="size-3 mr-1" />
                                .{build.format}
                              </a>
                            )}

                            {isInProgress && (
                              <Button
                                size="sm"
                                variant="outline"
                                className="h-7 px-2.5 text-xs"
                                disabled={stopBuildMutation.isPending}
                                onClick={() => stopBuildMutation.mutate(build.id)}
                              >
                                {stopBuildMutation.isPending && stopBuildMutation.variables === build.id ? (
                                  <Spinner className="size-3 mr-1" />
                                ) : (
                                  <Square className="size-3 mr-1" />
                                )}
                                Stop
                              </Button>
                            )}

                            {isFailed && (
                              <Button
                                size="sm"
                                variant="outline"
                                className="h-7 px-2.5 text-xs"
                                disabled={retryMutation.isPending}
                                onClick={() => retryMutation.mutate(build.id)}
                              >
                                {retryMutation.isPending ? (
                                  <Spinner className="size-3 mr-1" />
                                ) : (
                                  <RefreshCw className="size-3 mr-1" />
                                )}
                                Retry
                              </Button>
                            )}
                          </div>
                        </div>
                      </div>
                    )
                  })}
                </div>
              )}

              <div className="shrink-0 mt-3 rounded-lg bg-muted/40 p-2.5 text-center text-[11px] text-muted-foreground">
                Build artifacts are hosted directly by Expo Application Services with standard ~30-day retention.
              </div>
            </div>
          </TabsContent>

          <TabsContent
            value="web"
            className="flex-1 min-h-0 min-w-0 grid grid-cols-1 lg:grid-cols-2 gap-4 pt-3 overflow-hidden"
          >
            {/* Left: status & action */}
            <div className="flex flex-col min-h-0 overflow-y-auto pr-1 space-y-4">
              {isLinked && (
                <div className="flex items-center gap-2 rounded-lg border border-border bg-muted/40 px-3 py-2 text-xs text-muted-foreground">
                  <GitBranch className="size-3.5 shrink-0 text-primary" />
                  <span>
                    The <span className="font-semibold text-foreground">main</span> branch will be exported and published to EAS Hosting.
                  </span>
                </div>
              )}
              {errorMessage && (
                <Alert variant="destructive">
                  <AlertCircle className="size-4" />
                  <AlertTitle>Deploy Error</AlertTitle>
                  <AlertDescription className="space-y-2 mt-1">
                    <p className="text-xs">{errorMessage}</p>
                    {errorMessage.toLowerCase().includes("workflow") && (
                      <Button
                        size="sm"
                        variant="outline"
                        className="border-destructive/30 hover:bg-destructive/20 h-7 text-xs"
                        onClick={() => {
                          window.location.assign(`/api/github/connect?projectId=${encodeURIComponent(projectId)}&reconnect=1`)
                        }}
                      >
                        <Github className="size-3.5 mr-1.5" />
                        Reconnect GitHub
                      </Button>
                    )}
                  </AlertDescription>
                </Alert>
              )}

              {/* Gating check 1: GitHub Link */}
              {!githubLinkQuery.isLoading && !isLinked && (
                <Alert className="border-amber-500/20 bg-amber-500/10 text-amber-900 dark:text-amber-200">
                  <Github className="size-4 text-amber-600 dark:text-amber-400" />
                  <AlertTitle>GitHub Repository Required</AlertTitle>
                  <AlertDescription className="mt-1 space-y-2">
                    <p className="text-xs">
                      This project must be linked to a GitHub repository so GitHub Actions can run your web deployment.
                    </p>
                    <Button
                      size="sm"
                      variant="outline"
                      className="border-amber-500/30 hover:bg-amber-500/20"
                      onClick={() => {
                        onOpenGithubDialog?.()
                      }}
                    >
                      <Github className="size-3.5 mr-1.5" />
                      Push to GitHub first
                    </Button>
                  </AlertDescription>
                </Alert>
              )}

              {/* Gating check 2: Expo Connection */}
              {!expoStatusQuery.isLoading && !isExpoConnected && (
                <Alert className="border-amber-500/20 bg-amber-500/10 text-amber-900 dark:text-amber-200">
                  <KeyRound className="size-4 text-amber-600 dark:text-amber-400" />
                  <AlertTitle>Expo / EAS Account Required</AlertTitle>
                  <AlertDescription className="mt-1 space-y-2">
                    <p className="text-xs">
                      Web deployments are hosted on your Expo account using EAS Hosting. Connect your token to enable deployments.
                    </p>
                    <Button
                      size="sm"
                      variant="outline"
                      className="border-amber-500/30 hover:bg-amber-500/20"
                      onClick={() => {
                        onOpenExpoDialog?.()
                      }}
                    >
                      <KeyRound className="size-3.5 mr-1.5" />
                      Connect Expo
                    </Button>
                  </AlertDescription>
                </Alert>
              )}

              {/* Live URL banner (preserved across republishes) */}
              {webDeployment?.url && (
                <div className="flex items-center justify-between rounded-lg border border-border bg-card p-3 text-xs min-w-0 overflow-hidden">
                  <div className="flex items-center gap-2.5 min-w-0 flex-1">
                    <Globe className="size-4 shrink-0 text-emerald-500" />
                    <div className="min-w-0 flex-1">
                      <p className="text-[11px] font-medium text-muted-foreground">Production URL</p>
                      <a
                        href={webDeployment.url}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="truncate font-mono font-medium text-foreground hover:underline block max-w-full"
                      >
                        {webDeployment.url}
                      </a>
                    </div>
                  </div>
                  <div className="flex items-center gap-1.5 shrink-0 ml-2">
                    <Button
                      size="sm"
                      variant="outline"
                      className="h-7 px-2.5 text-xs gap-1"
                      onClick={() => handleCopyUrl(webDeployment.url!)}
                    >
                      {copiedUrl ? <Check className="size-3.5 text-emerald-500" /> : <Copy className="size-3.5" />}
                      {copiedUrl ? "Copied!" : "Copy Link"}
                    </Button>
                    <a
                      href={webDeployment.url}
                      target="_blank"
                      rel="noopener noreferrer"
                      className={buttonVariants({ variant: "outline", size: "sm", className: "h-7 px-2.5 text-xs gap-1" })}
                    >
                      <ExternalLink className="size-3.5" />
                      Open
                    </a>
                  </div>
                </div>
              )}

              {/* 4-step status section */}
              {webDeployment ? (
                <div className="rounded-lg border bg-card p-3.5 space-y-3 min-w-0 overflow-hidden">
                  <div className="flex items-center justify-between text-xs">
                    <span className="font-semibold text-foreground">Deployment Status</span>
                    <div className="flex items-center gap-1.5 shrink-0">
                      {isWebInFlight && (
                        <Badge variant="outline" className="gap-1 border-blue-500/30 text-blue-500 bg-blue-500/10">
                          <Spinner className="size-3" />
                          {webStatus === "queued"
                            ? "Queued"
                            : webStatus === "dispatching"
                            ? "Dispatching"
                            : webStatus === "building"
                            ? "Building"
                            : "Deploying"}
                        </Badge>
                      )}
                      {webStatus === "ready" && (
                        <Badge variant="outline" className="gap-1 border-emerald-500/30 text-emerald-600 dark:text-emerald-400 bg-emerald-500/10">
                          <CheckCircle2 className="size-3" />
                          Live
                        </Badge>
                      )}
                      {webStatus === "failed" && (
                        <Badge variant="outline" className="gap-1 border-destructive/30 text-destructive bg-destructive/10">
                          <AlertCircle className="size-3" />
                          Failed
                        </Badge>
                      )}
                    </div>
                  </div>

                  {/* 4-step progress row */}
                  <div className="grid grid-cols-4 gap-2 pt-1">
                    {(() => {
                      const isPrepActive = webStatus === "queued" || webStatus === "dispatching"
                      const isPrepDone = webStatus === "building" || webStatus === "deploying" || webStatus === "ready"
                      const isPrepFailed = webStatus === "failed" && isPrepActive

                      const isBuildActive = webStatus === "building"
                      const isBuildDone = webStatus === "deploying" || webStatus === "ready"
                      const isBuildFailed = webStatus === "failed" && !isPrepDone && !isBuildDone

                      const isDeployActive = webStatus === "deploying"
                      const isDeployDone = webStatus === "ready"
                      const isDeployFailed = webStatus === "failed" && isBuildDone && !isDeployDone

                      const isLive = webStatus === "ready"

                      const steps = [
                        { label: "Preparing", active: isPrepActive, done: isPrepDone, failed: isPrepFailed },
                        { label: "Building", active: isBuildActive, done: isBuildDone, failed: isBuildFailed },
                        { label: "Deploying", active: isDeployActive, done: isDeployDone, failed: isDeployFailed },
                        { label: "Live", active: false, done: isLive, failed: false },
                      ]

                      return steps.map((s, idx) => (
                        <div
                          key={s.label}
                          className={`flex flex-col items-center gap-1 rounded-md p-2 text-center text-xs transition-colors ${
                            s.active
                              ? "bg-primary/5 border border-primary/20"
                              : s.done
                              ? "bg-muted/40"
                              : s.failed
                              ? "bg-destructive/10 border border-destructive/20"
                              : "opacity-60"
                          }`}
                        >
                          {s.active ? (
                            <Spinner className="size-4 text-primary" />
                          ) : s.done ? (
                            <CheckCircle2 className="size-4 text-emerald-500" />
                          ) : s.failed ? (
                            <AlertCircle className="size-4 text-destructive" />
                          ) : (
                            <span className="flex size-4 items-center justify-center rounded-full border border-muted-foreground/40 text-[10px] text-muted-foreground">
                              {idx + 1}
                            </span>
                          )}
                          <span
                            className={`text-[11px] font-medium ${
                              s.active
                                ? "text-primary"
                                : s.done
                                ? "text-foreground"
                                : s.failed
                                ? "text-destructive"
                                : "text-muted-foreground"
                            }`}
                          >
                            {s.label}
                          </span>
                        </div>
                      ))
                    })()}
                  </div>

                  {/* Failure error message */}
                  {webStatus === "failed" && (
                    <div className="rounded-md bg-destructive/10 border border-destructive/20 p-2.5 text-xs text-destructive space-y-1 min-w-0 overflow-hidden">
                      <p className="font-mono text-xs break-all [overflow-wrap:anywhere] line-clamp-3">
                        {formatBuildError(webDeployment.error)}
                      </p>
                    </div>
                  )}

                  {/* Footer metadata & link */}
                  <div className="flex items-center justify-between text-xs text-muted-foreground pt-1">
                    <div className="flex items-center gap-1.5">
                      <Clock className="size-3" />
                      <span>
                        {webDeployment.lastDeployedAt
                          ? `Last deployed: ${new Date(webDeployment.lastDeployedAt).toLocaleString()}`
                          : `Started: ${new Date(webDeployment.createdAt).toLocaleString()}`}
                      </span>
                    </div>
                    <div className="flex items-center gap-2">
                      {isWebInFlight && (
                        <Button
                          size="sm"
                          variant="outline"
                          className="h-7 px-2.5 text-xs"
                          disabled={stopWebMutation.isPending}
                          onClick={() => stopWebMutation.mutate()}
                        >
                          {stopWebMutation.isPending ? <Spinner className="size-3 mr-1" /> : <Square className="size-3 mr-1" />}
                          Stop
                        </Button>
                      )}
                      {webDeployment.workflowRunUrl && (
                        <a
                          href={webDeployment.workflowRunUrl}
                          target="_blank"
                          rel="noopener noreferrer"
                          className="inline-flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground"
                        >
                          View deploy log <ExternalLink className="size-3" />
                        </a>
                      )}
                    </div>
                  </div>
                </div>
              ) : (
                <div className="flex flex-col items-center justify-center py-8 text-center rounded-lg border border-dashed p-6">
                  <Globe className="size-10 text-muted-foreground/40 mb-3" />
                  <p className="text-sm font-medium">No web deployment yet</p>
                  <p className="text-xs text-muted-foreground mt-1 max-w-sm">
                    Export and host your app with a production URL on Expo EAS Hosting.
                  </p>
                </div>
              )}
            </div>

            {/* Right: deployment history */}
            <div className="flex flex-col min-h-0 overflow-hidden border-t pt-4 lg:border-t-0 lg:border-l lg:pt-0 lg:pl-4">
              <h4 className="shrink-0 text-sm font-semibold mb-2.5 flex items-center justify-between">
                Deployment History {webRuns.length ? <span className="text-xs font-normal text-muted-foreground">({webRuns.length})</span> : null}
              </h4>
              {webDeployQuery.isLoading ? (
                <div className="flex items-center justify-center py-10">
                  <Spinner className="size-6 text-muted-foreground" />
                </div>
              ) : webRuns.length === 0 ? (
                <div className="flex flex-col items-center justify-center py-10 text-center flex-1">
                  <Globe className="size-10 text-muted-foreground/40 mb-3" />
                  <p className="text-sm font-medium">No deployments yet</p>
                  <p className="text-xs text-muted-foreground mt-1 max-w-sm">
                    Publish your first web deployment using the panel on the left.
                  </p>
                </div>
              ) : (
                <div className="flex-1 min-h-0 overflow-y-auto space-y-3 pr-1 min-w-0">
                  {webRuns.map((run) => {
                    const isFailed = run.status === "failed"

                    return (
                      <div
                        key={run.id}
                        className="rounded-lg border bg-card p-3.5 text-card-foreground space-y-2.5 transition-all min-w-0 overflow-hidden"
                      >
                        <div className="flex items-center justify-between gap-2">
                          <div className="flex items-center gap-2 min-w-0">
                            <Globe className="size-4 text-blue-500 shrink-0" />
                            <span className="font-semibold text-sm truncate">Web Deploy</span>
                          </div>
                          <div className="shrink-0">
                            <WebRunStatusBadge status={run.status} />
                          </div>
                        </div>

                        {isFailed && (
                          <div className="rounded-md bg-destructive/10 border border-destructive/20 p-2.5 text-xs text-destructive space-y-1 min-w-0 overflow-hidden">
                            <p className="font-mono text-xs break-all [overflow-wrap:anywhere] line-clamp-3">
                              {formatBuildError(run.error)}
                            </p>
                          </div>
                        )}

                        <div className="flex items-center justify-between pt-1 text-xs gap-2">
                          <div className="flex items-center gap-2 text-muted-foreground truncate min-w-0">
                            <Clock className="size-3 shrink-0" />
                            <span className="truncate">{new Date(run.createdAt).toLocaleString()}</span>
                          </div>

                          <div className="flex items-center gap-2 shrink-0">
                            {run.workflowRunUrl && (
                              <a
                                href={run.workflowRunUrl}
                                target="_blank"
                                rel="noopener noreferrer"
                                className="inline-flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground"
                              >
                                Log <ExternalLink className="size-3" />
                              </a>
                            )}
                            {run.status === "ready" && run.url && (
                              <a
                                href={run.url}
                                target="_blank"
                                rel="noopener noreferrer"
                                className={buttonVariants({ size: "sm", className: "h-7 px-2.5 text-xs inline-flex items-center gap-1" })}
                              >
                                <ExternalLink className="size-3 mr-1" />
                                Open
                              </a>
                            )}
                          </div>
                        </div>
                      </div>
                    )
                  })}
                </div>
              )}

              <div className="shrink-0 mt-3 rounded-lg bg-muted/40 p-2.5 text-center text-[11px] text-muted-foreground">
                Republishing updates the same production URL — it never creates a new site.
              </div>
            </div>
          </TabsContent>
        </Tabs>

        <DialogFooter className="pt-2 mx-0 shrink-0">
          <Button variant="outline" onClick={() => onOpenChange(false)}>
            Cancel
          </Button>
          {activeTab === "mobile" ? (
            <Button disabled={!canPublish} onClick={() => publishMutation.mutate()}>
              {publishMutation.isPending && <Spinner className="size-4 mr-2" />}
              <Rocket className="size-4 mr-2" />
              Build & Publish
            </Button>
          ) : (
            <Button disabled={!canDeployWeb} onClick={() => webDeployMutation.mutate()}>
              {webDeployMutation.isPending && <Spinner className="size-4 mr-2" />}
              <Globe className="size-4 mr-2" />
              {webDeployment?.url ? "Republish" : "Publish to Web"}
            </Button>
          )}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
