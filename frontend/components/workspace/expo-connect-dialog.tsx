"use client"

import * as React from "react"
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query"
import { AlertCircle, CheckCircle2, ExternalLink, KeyRound, LogOut } from "lucide-react"

import { apiClient, getApiErrorMessage } from "@/lib/api-client"
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
import { Spinner } from "@/components/ui/spinner"

export function ExpoConnectDialog({
  open,
  onOpenChange,
  onSuccess,
}: {
  open: boolean
  onOpenChange: (open: boolean) => void
  onSuccess?: () => void
}) {
  const queryClient = useQueryClient()
  const [token, setToken] = React.useState("")
  const [errorMessage, setErrorMessage] = React.useState<string | null>(null)

  const statusQuery = useQuery({
    queryKey: ["expo-status"],
    queryFn: async () => {
      const res = await apiClient.get<{ connected: boolean; username?: string | null }>(
        "/api/expo/status"
      )
      return res.data
    },
    enabled: open,
  })

  React.useEffect(() => {
    if (open) {
      setErrorMessage(null)
      setToken("")
    }
  }, [open])

  const connectMutation = useMutation({
    mutationFn: async (tokenValue: string) => {
      const res = await apiClient.post<{ ok: boolean; username?: string | null }>(
        "/api/expo/connect",
        { token: tokenValue }
      )
      return res.data
    },
    onSuccess: () => {
      setToken("")
      setErrorMessage(null)
      queryClient.invalidateQueries({ queryKey: ["expo-status"] })
      onSuccess?.()
    },
    onError: (err) => {
      setErrorMessage(getApiErrorMessage(err, "Failed to validate and save Expo token."))
    },
  })

  const disconnectMutation = useMutation({
    mutationFn: async () => {
      const res = await apiClient.post<{ ok: boolean }>("/api/expo/disconnect")
      return res.data
    },
    onSuccess: () => {
      setErrorMessage(null)
      queryClient.invalidateQueries({ queryKey: ["expo-status"] })
    },
    onError: (err) => {
      setErrorMessage(getApiErrorMessage(err, "Failed to disconnect Expo account."))
    },
  })

  const isConnected = Boolean(statusQuery.data?.connected)
  const username = statusQuery.data?.username

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <KeyRound className="size-5 text-primary" />
            Connect Expo / EAS
          </DialogTitle>
          <DialogDescription>
            Native builds run on your own Expo Application Services (EAS) account via your connected GitHub repository.
          </DialogDescription>
        </DialogHeader>

        {errorMessage && (
          <Alert variant="destructive">
            <AlertCircle className="size-4" />
            <AlertTitle>Connection Error</AlertTitle>
            <AlertDescription>{errorMessage}</AlertDescription>
          </Alert>
        )}

        {statusQuery.isLoading ? (
          <div className="flex items-center justify-center py-6">
            <Spinner className="size-6 text-muted-foreground" />
          </div>
        ) : isConnected ? (
          <div className="space-y-4 py-2">
            <div className="flex items-center gap-3 rounded-lg border border-emerald-500/20 bg-emerald-500/10 p-3.5 text-sm text-emerald-600 dark:text-emerald-400">
              <CheckCircle2 className="size-5 shrink-0" />
              <div className="flex-1">
                <p className="font-medium">
                  Connected to Expo {username ? `@${username}` : ""}
                </p>
                <p className="text-xs text-muted-foreground mt-0.5">
                  Your Expo Personal Access Token is saved and ready for builds.
                </p>
              </div>
            </div>

            <DialogFooter className="pt-2">
              <Button
                variant="outline"
                size="sm"
                className="text-destructive hover:bg-destructive/10"
                onClick={() => disconnectMutation.mutate()}
                disabled={disconnectMutation.isPending}
              >
                {disconnectMutation.isPending ? <Spinner className="size-4 mr-2" /> : <LogOut className="size-4 mr-2" />}
                Disconnect
              </Button>
              <Button variant="outline" onClick={() => onOpenChange(false)}>
                Done
              </Button>
            </DialogFooter>
          </div>
        ) : (
          <form
            onSubmit={(e) => {
              e.preventDefault()
              if (!token.trim()) return
              setErrorMessage(null)
              connectMutation.mutate(token.trim())
            }}
            className="space-y-4 py-2"
          >
            <div className="space-y-2">
              <div className="flex items-center justify-between">
                <Label htmlFor="expo-token">Personal Access Token</Label>
                <a
                  href="https://expo.dev/settings/access-tokens"
                  target="_blank"
                  rel="noopener noreferrer"
                  className="inline-flex items-center gap-1 text-xs text-primary hover:underline"
                >
                  Create token <ExternalLink className="size-3" />
                </a>
              </div>
              <Input
                id="expo-token"
                type="password"
                placeholder="expo_pat_..."
                value={token}
                onChange={(e) => setToken(e.target.value)}
                autoComplete="off"
                disabled={connectMutation.isPending}
              />
              <p className="text-xs text-muted-foreground">
                Your token is encrypted and only used to securely set up GitHub Actions secrets for EAS builds.
              </p>
            </div>

            <DialogFooter className="pt-2">
              <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>
                Cancel
              </Button>
              <Button type="submit" disabled={!token.trim() || connectMutation.isPending}>
                {connectMutation.isPending && <Spinner className="size-4 mr-2" />}
                Connect
              </Button>
            </DialogFooter>
          </form>
        )}
      </DialogContent>
    </Dialog>
  )
}
