"use client"

import * as React from "react"
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query"
import {
  AlertCircle,
  Apple,
  CheckCircle2,
  Clock,
  Download,
  ExternalLink,
  GitBranch,
  Github,
  KeyRound,
  RefreshCw,
  Rocket,
  Smartphone,
  Terminal,
} from "lucide-react"

import type { BuildFormat, BuildPlatform, BuildRow } from "@/db"
import { apiClient, getApiErrorMessage } from "@/lib/api-client"
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
  const queryClient = useQueryClient()
  const [platform, setPlatform] = React.useState<BuildPlatform>("android")
  const [format, setFormat] = React.useState<BuildFormat>("apk")
  const [version, setVersion] = React.useState("1.0.0")
  const [errorMessage, setErrorMessage] = React.useState<string | null>(null)
  const [activeTab, setActiveTab] = React.useState<"publish" | "builds">("publish")

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
  })

  // 3. Query all builds for this project with data-driven polling
  const buildsQuery = useQuery({
    queryKey: ["project-builds", projectId],
    queryFn: async () => {
      const res = await apiClient.get<{ builds: BuildRow[] }>(
        `/api/projects/${projectId}/builds`
      )
      return res.data.builds
    },
    enabled: open,
    refetchInterval: (query) => {
      const data = query.state.data
      if (!data || data.length === 0) return false
      const hasActive = data.some(
        (b) => b.status === "queued" || b.status === "dispatching" || b.status === "building"
      )
      return hasActive ? 4000 : false
    },
  })

  const builds = buildsQuery.data || []
  const hasBuilds = builds.length > 0
  const isLinked = Boolean(githubLinkQuery.data?.link)
  const isExpoConnected = Boolean(expoStatusQuery.data?.connected)

  // Switch to builds tab automatically if there are active in-flight builds on open
  React.useEffect(() => {
    if (open && hasBuilds) {
      const hasActive = builds.some(
        (b) => b.status === "queued" || b.status === "dispatching" || b.status === "building"
      )
      if (hasActive) {
        setActiveTab("builds")
      }
    }
  }, [open, hasBuilds, builds])

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
    onSuccess: () => {
      setErrorMessage(null)
      queryClient.invalidateQueries({ queryKey: ["project-builds", projectId] })
      setActiveTab("builds")
    },
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
    onSuccess: () => {
      setErrorMessage(null)
      queryClient.invalidateQueries({ queryKey: ["project-builds", projectId] })
      setActiveTab("builds")
    },
    onError: (err) => {
      setErrorMessage(getApiErrorMessage(err, "Failed to retry build."))
    },
  })

  const isVersionValid = SEMVER_REGEX.test(version.trim())
  const canPublish = isLinked && isExpoConnected && isVersionValid && !publishMutation.isPending

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-xl">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Rocket className="size-5 text-primary" />
            Publish & Export Native Builds
          </DialogTitle>
          <DialogDescription>
            Export <span className="font-medium text-foreground">{projectName}</span> as an installable Android (.apk / .aab) or iOS (.ipa) package. The <span className="font-medium text-foreground">main</span> branch will be pushed to GitHub and built with Expo EAS.
          </DialogDescription>
        </DialogHeader>

        <Tabs value={activeTab} onValueChange={(val) => setActiveTab(val as "publish" | "builds")} className="w-full">
          <TabsList className="grid w-full grid-cols-2">
            <TabsTrigger value="publish">New Build</TabsTrigger>
            <TabsTrigger value="builds">
              Build History {hasBuilds ? `(${builds.length})` : ""}
            </TabsTrigger>
          </TabsList>

          <TabsContent value="publish" className="space-y-4 pt-3">
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

            <DialogFooter className="pt-2">
              <Button variant="outline" onClick={() => onOpenChange(false)}>
                Cancel
              </Button>
              <Button
                disabled={!canPublish}
                onClick={() => publishMutation.mutate()}
              >
                {publishMutation.isPending && <Spinner className="size-4 mr-2" />}
                <Rocket className="size-4 mr-2" />
                Build & Publish
              </Button>
            </DialogFooter>
          </TabsContent>

          <TabsContent value="builds" className="space-y-4 pt-3">
            {buildsQuery.isLoading ? (
              <div className="flex items-center justify-center py-10">
                <Spinner className="size-6 text-muted-foreground" />
              </div>
            ) : builds.length === 0 ? (
              <div className="flex flex-col items-center justify-center py-10 text-center">
                <Smartphone className="size-10 text-muted-foreground/40 mb-3" />
                <p className="text-sm font-medium">No builds yet</p>
                <p className="text-xs text-muted-foreground mt-1 max-w-sm">
                  Start your first native build using the &quot;New Build&quot; tab.
                </p>
              </div>
            ) : (
              <div className="max-h-[420px] overflow-y-auto space-y-3 pr-1">
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
                      className="rounded-lg border bg-card p-3.5 text-card-foreground space-y-2.5 transition-all"
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

                        <div className="flex items-center gap-1.5">
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
                        <div className="rounded-md bg-destructive/10 border border-destructive/20 p-2.5 text-xs text-destructive space-y-1">
                          {isIosCredentialsError ? (
                            <div className="space-y-1">
                              <p className="font-semibold">Apple Developer Credentials Required</p>
                              <p className="text-muted-foreground">
                                EAS reported that your Apple Developer signing credentials (Distribution Certificate or Provisioning Profile) are not configured. Run <code className="bg-destructive/20 px-1 py-0.5 rounded font-mono">eas credentials</code> or configure credentials on <a href="https://expo.dev" target="_blank" rel="noopener noreferrer" className="underline font-medium">expo.dev</a>.
                              </p>
                            </div>
                          ) : (
                            <p className="font-mono break-words line-clamp-3">
                              {build.error || "Build encountered an error."}
                            </p>
                          )}
                        </div>
                      )}

                      {/* Action buttons & links */}
                      <div className="flex items-center justify-between pt-1 text-xs">
                        <div className="flex items-center gap-2 text-muted-foreground">
                          <Clock className="size-3" />
                          <span>{new Date(build.createdAt).toLocaleString()}</span>
                        </div>

                        <div className="flex items-center gap-2">
                          {build.workflowRunUrl && (
                            <a
                              href={build.workflowRunUrl}
                              target="_blank"
                              rel="noopener noreferrer"
                              className="inline-flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground"
                            >
                              View build log <ExternalLink className="size-3" />
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
                              Download .{build.format}
                            </a>
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

            <div className="rounded-lg bg-muted/40 p-2.5 text-center text-[11px] text-muted-foreground">
              Build artifacts are hosted directly by Expo Application Services with standard ~30-day retention.
            </div>
          </TabsContent>
        </Tabs>
      </DialogContent>
    </Dialog>
  )
}
