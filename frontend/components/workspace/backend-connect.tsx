"use client";

import * as React from "react";
import { useMutation } from "@tanstack/react-query";
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
} from "lucide-react";
import { cn } from "cn";

import type { BackendInfo } from "@app/shared/agent/types";
import {
  BACKEND_PROVIDER_IDS,
  BACKEND_SERVICE_INFO,
  DEFAULT_BACKEND_PROVIDER,
  isBackendProviderId,
  providerInfo,
  type BackendProviderId,
  type BackendProviderStatus,
  type BackendService,
} from "@app/shared/app-backend/providers";
import { apiClient, getApiErrorMessage } from "@/lib/api-client";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import { Spinner } from "@/components/ui/spinner";

const SERVICE_ICONS: Record<BackendService, LucideIcon> = {
  postgres: Database,
  auth: KeyRound,
  storage: HardDrive,
  email: Mail,
  jobs: Timer,
};
const SERVICE_IDS = Object.keys(BACKEND_SERVICE_INFO) as BackendService[];

/** Why a provider's authorization round trip didn't finish (the callback's `reason`). */
function connectError(reason: string, label: string) {
  switch (reason) {
    case "denied":
      return `You cancelled the ${label} authorization. Connect again whenever you're ready.`;
    case "expired":
      return `The ${label} authorization expired before it finished. Please try again.`;
    case "not_configured":
      return `${label} isn't configured on this server yet. Ask an administrator to set its client credentials.`;
    default:
      return `We couldn't complete the ${label} authorization. Please try again.`;
  }
}

function ServiceList({
  services,
  compact,
}: {
  services: string[];
  compact?: boolean;
}) {
  return (
    <ul className={cn("grid gap-1.5", compact ? "text-xs" : "text-sm")}>
      {SERVICE_IDS.filter((id) => services.includes(id)).map((id) => {
        const Icon = SERVICE_ICONS[id];
        return (
          <li key={id} className="flex items-center gap-2">
            <Icon className="size-3.5 text-muted-foreground" />
            <span className="flex-1">{BACKEND_SERVICE_INFO[id].label}</span>
            <Check className="size-3.5 text-emerald-600 dark:text-emerald-400" />
          </li>
        );
      })}
    </ul>
  );
}

function ProviderMark({ className }: { className?: string }) {
  return (
    <span
      className={cn(
        "flex size-9 shrink-0 items-center justify-center rounded-(--r-sm) bg-sky-500/10 text-sky-600 dark:text-sky-400",
        className,
      )}
    >
      <Cloud className="size-4.5" />
    </span>
  );
}

function ConnectDialog({
  open,
  onOpenChange,
  projectId,
  providers,
  provider,
  onProviderChange,
  backend,
  notice,
  agentBusy,
  onSetup,
}: {
  open: boolean;
  onOpenChange: (o: boolean) => void;
  projectId: string;
  providers: BackendProviderStatus[];
  provider: BackendProviderId;
  onProviderChange: (p: BackendProviderId) => void;
  backend: BackendInfo | null;
  notice: string | null;
  agentBusy: boolean;
  onSetup: (provider: BackendProviderId, services: BackendService[]) => void;
}) {
  const info = providerInfo(provider);
  const status = providers.find((p) => p.id === provider) ?? {
    configured: false,
    accountConnected: false,
  };
  const [picked, setPicked] = React.useState<Set<string>>(
    () => new Set(backend?.services ?? SERVICE_IDS),
  );
  const [leaving, setLeaving] = React.useState(false);
  const isRequired = (id: BackendService) => info.required.includes(id);
  const services = info.services.filter(
    (id) => isRequired(id) || picked.has(id),
  );
  // Picking another provider than the app is on means a fresh setup there, not a repair of this one.
  const sameProvider = backend?.provider === provider;
  const reconnect = sameProvider && backend?.error === "reconnect";
  const needsAuth = !status.accountConnected || reconnect;
  const failed =
    sameProvider && backend?.status === "error" && !reconnect
      ? backend.error
      : null;

  const go = () => {
    if (needsAuth) {
      setLeaving(true);
      const q = new URLSearchParams({
        projectId,
        services: services.join(","),
      });
      if (reconnect) q.set("reconnect", "1");
      window.location.assign(`/api/backend-providers/${provider}/connect?${q}`);
      return;
    }
    onSetup(provider, services);
    onOpenChange(false);
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="flex max-h-[80vh] flex-col gap-0 p-0 sm:max-w-lg">
        <DialogHeader className="shrink-0 p-5 pb-3">
          <DialogTitle>Connect a backend</DialogTitle>
          <DialogDescription>
            Give your app a real database, user accounts and file storage. The
            agent sets everything up for you.
          </DialogDescription>
        </DialogHeader>

        <div className="flex min-h-0 flex-1 flex-col gap-5 overflow-y-auto px-5 py-1 scrollbar-none">
          {(notice || failed) && (
            <Alert variant="destructive">
              <AlertTriangle />
              <AlertTitle>
                {notice ? "Connection not completed" : "Setup didn't finish"}
              </AlertTitle>
              <AlertDescription>{notice ?? failed}</AlertDescription>
            </Alert>
          )}

          <div
            role="radiogroup"
            aria-label="Backend provider"
            className="grid gap-2"
          >
            {BACKEND_PROVIDER_IDS.map((id) => {
              const checked = id === provider;
              const p = providerInfo(id);
              return (
                <button
                  key={id}
                  type="button"
                  role="radio"
                  aria-checked={checked}
                  onClick={() => onProviderChange(id)}
                  className={cn(
                    "flex items-start gap-3 rounded-(--r-md) border p-3 text-left outline-none focus-visible:ring-3 focus-visible:ring-ring/50",
                    checked
                      ? "border-primary/50 bg-primary/5"
                      : "border-border hover:bg-muted/60",
                  )}
                >
                  <ProviderMark />
                  <span className="min-w-0 flex-1">
                    <span className="flex items-center gap-2 text-sm font-medium">
                      {p.label}
                      {id === DEFAULT_BACKEND_PROVIDER && (
                        <Badge
                          variant="secondary"
                          className="h-5 px-1.5 text-[10px]"
                        >
                          Default
                        </Badge>
                      )}
                    </span>
                    <span className="block text-xs text-muted-foreground">
                      {p.tagline}
                    </span>
                  </span>
                  <span
                    className={cn(
                      "mt-1 flex size-4 shrink-0 items-center justify-center rounded-full border",
                      checked
                        ? "border-primary bg-primary text-primary-foreground"
                        : "border-muted-foreground/40",
                    )}
                  >
                    {checked && <Check className="size-2.5" strokeWidth={3} />}
                  </span>
                </button>
              );
            })}
          </div>

          <fieldset className="grid gap-2">
            <legend className="mb-2 text-xs font-medium text-muted-foreground">
              Services
            </legend>
            {info.services.map((id) => {
              const required = isRequired(id);
              const Icon = SERVICE_ICONS[id];
              return (
                <label
                  key={id}
                  className={cn(
                    "flex items-center gap-3 rounded-(--r-sm) px-1 py-1",
                    required
                      ? "cursor-default"
                      : "cursor-pointer hover:bg-muted/60",
                  )}
                >
                  <Checkbox
                    checked={required || picked.has(id)}
                    disabled={required}
                    onCheckedChange={(v) =>
                      setPicked((p) => {
                        const next = new Set(p);
                        if (v) next.add(id);
                        else next.delete(id);
                        return next;
                      })
                    }
                    aria-label={BACKEND_SERVICE_INFO[id].label}
                  />
                  <Icon className="size-4 text-muted-foreground" />
                  <span className="min-w-0 flex-1">
                    <span className="block text-sm">
                      {BACKEND_SERVICE_INFO[id].label}
                    </span>
                    <span className="block text-xs text-muted-foreground">
                      {BACKEND_SERVICE_INFO[id].body}
                    </span>
                  </span>
                  {required && (
                    <span className="text-[11px] text-muted-foreground">
                      Required
                    </span>
                  )}
                </label>
              );
            })}
          </fieldset>

          {sameProvider && !needsAuth && (
            <p className="-mt-2 text-xs text-muted-foreground">
              Unchecking a service stops this app from using it; anything already
              deployed stays in your {info.label} workspace.
            </p>
          )}

          <div className="flex items-start gap-2.5 rounded-(--r-md) bg-muted/60 p-3 text-xs text-muted-foreground">
            <ShieldCheck className="mt-0.5 size-4 shrink-0 text-foreground/70" />
            <p>
              {needsAuth
                ? `You'll sign in to ${info.label} and allow access. `
                : `Your ${info.label} account is connected. `}
              The agent then creates a project and deploys the services. Keys stay
              encrypted on our servers and are never shown to the AI or put in
              your app&apos;s code. {info.billing}
            </p>
          </div>

          {!status.configured && (
            <p className="-mt-2 text-xs text-destructive">
              {info.label} isn&apos;t configured on this server yet.
            </p>
          )}
        </div>

        <div className="shrink-0 border-t p-5 pt-4">
          <div className="flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">
            <Button variant="outline" onClick={() => onOpenChange(false)}>
              Cancel
            </Button>
            <Button
              onClick={go}
              disabled={!status.configured || leaving || agentBusy}
            >
              {leaving ? <Spinner /> : <Cloud />}
              {needsAuth
                ? reconnect
                  ? `Reconnect ${info.label}`
                  : `Continue with ${info.label}`
                : sameProvider
                  ? "Save and deploy"
                  : "Set up backend"}
            </Button>
          </div>
          {agentBusy && (
            <p className="mt-2 text-right text-xs text-muted-foreground">
              Available once the agent finishes its current task.
            </p>
          )}
        </div>
      </DialogContent>
    </Dialog>
  );
}

function ConnectedPopover({
  backend,
  agentBusy,
  onRerun,
  onEditServices,
  onDisconnect,
}: {
  backend: BackendInfo;
  agentBusy: boolean;
  onRerun: () => void;
  /** Opens the provider dialog again, pre-filled, so services can be added or dropped. */
  onEditServices: () => void;
  onDisconnect: () => void;
}) {
  const { label, dashboardUrl } = providerInfo(backend.provider);
  return (
    <Popover>
      <PopoverTrigger
        render={
          <button
            type="button"
            className="flex h-8 items-center gap-2 rounded-full border border-emerald-600/25 bg-emerald-500/10 px-3 text-xs font-medium text-emerald-700 outline-none transition-colors hover:bg-emerald-500/15 focus-visible:ring-3 focus-visible:ring-ring/50 dark:text-emerald-300 max-sm:px-2.5"
            aria-label={`${label} backend connected`}
          />
        }
      >
        <span className="relative flex size-2">
          <span className="absolute inline-flex size-full animate-ping rounded-full bg-emerald-500/60 [animation-duration:2.5s]" />
          <span className="relative inline-flex size-2 rounded-full bg-emerald-500" />
        </span>
        <span className="hidden lg:inline">{label} Backend Connected</span>
        <span className="hidden sm:inline lg:hidden">Connected</span>
      </PopoverTrigger>
      <PopoverContent align="end" className="w-80 gap-3 p-3.5">
        <div className="flex items-center gap-3">
          <ProviderMark />
          <div className="min-w-0 flex-1">
            <p className="text-sm font-medium">{label} backend</p>
            <p className="truncate text-xs text-muted-foreground">
              {backend.projectName ?? `${label} project`}
            </p>
          </div>
          <Badge className="h-5 bg-emerald-500/15 px-1.5 text-[10px] text-emerald-700 dark:text-emerald-300">
            Live
          </Badge>
        </div>
        <ServiceList services={backend.services} compact />
        <p className="text-xs text-muted-foreground">
          The preview reads and writes real data in this project and refreshes
          when it changes elsewhere.
        </p>
        {backend.error && backend.error !== "reconnect" && (
          <p className="rounded-(--r-sm) bg-amber-500/10 p-2 text-xs text-amber-800 dark:text-amber-300">
            Last setup attempt: {backend.error}
          </p>
        )}
        <div className="grid gap-1.5">
          <Button
            variant="outline"
            className="h-8 justify-start"
            render={
              <a
                href={dashboardUrl}
                target="_blank"
                rel="noreferrer noopener"
              />
            }
          >
            <ExternalLink /> Open {label} dashboard
          </Button>
          <Button
            variant="ghost"
            className="h-8 justify-start"
            onClick={onEditServices}
            disabled={agentBusy}
          >
            <Settings2 /> Edit services
          </Button>
          <Button
            variant="ghost"
            className="h-8 justify-start"
            onClick={onRerun}
            disabled={agentBusy}
          >
            <RefreshCw /> Check and repair setup
          </Button>
          <Button
            variant="ghost"
            className="h-8 justify-start text-destructive hover:text-destructive"
            onClick={onDisconnect}
            disabled={agentBusy}
          >
            <Unplug /> Disconnect app
          </Button>
        </div>
      </PopoverContent>
    </Popover>
  );
}

/**
 * Connect Backend in the workspace header: the provider dialog, the setup
 * status while the agent works, and a clear connected state afterwards.
 */
export function BackendControl({
  projectId,
  backend,
  providers,
  agentBusy,
  onSetupBackend,
  onDisconnected,
  onRefresh,
}: {
  projectId: string;
  backend: BackendInfo | null;
  providers: BackendProviderStatus[];
  agentBusy: boolean;
  onSetupBackend: (provider: BackendProviderId, services: string[]) => void;
  onDisconnected: () => void;
  /** Re-checks the provider links and this app's backend with the server, in case either went stale (disconnected elsewhere, revoked on the provider's side). */
  onRefresh: () => void;
}) {
  const [open, setOpen] = React.useState(false);
  const [notice, setNotice] = React.useState<string | null>(null);
  const [confirm, setConfirm] = React.useState(false);
  const [forgetAccount, setForgetAccount] = React.useState(false);
  const [disconnectError, setDisconnectError] = React.useState<string | null>(
    null,
  );
  const [provider, setProvider] = React.useState<BackendProviderId>(
    backend?.provider ?? DEFAULT_BACKEND_PROVIDER,
  );
  // After "also remove my authorization" the server-rendered link state is stale.
  const [forgotten, setForgotten] = React.useState<BackendProviderId | null>(
    null,
  );
  const linked = providers.map((p) =>
    p.id === forgotten ? { ...p, accountConnected: false } : p,
  );
  const currentLabel = providerInfo(backend?.provider ?? provider).label;

  // Back from the provider's Allow screen: set up right away, or explain what went wrong.
  const handled = React.useRef(false);
  React.useEffect(() => {
    if (handled.current) return;
    handled.current = true;
    const url = new URL(window.location.href);
    const result = url.searchParams.get("backend");
    if (!result) return;
    const services = (url.searchParams.get("services") ?? "")
      .split(",")
      .filter(Boolean);
    const reason = url.searchParams.get("reason") ?? "failed";
    const raw = url.searchParams.get("provider");
    const returned = isBackendProviderId(raw) ? raw : DEFAULT_BACKEND_PROVIDER;
    for (const k of ["backend", "services", "reason", "provider"])
      url.searchParams.delete(k);
    window.history.replaceState(
      null,
      "",
      url.pathname + (url.search ? url.search : "") + url.hash,
    );
    setProvider(returned);
    // An empty list is fine: the server always adds the provider's required services.
    if (result === "connected") onSetupBackend(returned, services);
    else {
      setNotice(connectError(reason, providerInfo(returned).label));
      setOpen(true);
    }
  }, [onSetupBackend]);

  const disconnectMutation = useMutation({
    mutationFn: async ({ forget }: { forget: boolean }) => {
      const res = await apiClient.delete<{ error?: string }>(
        `/api/projects/${encodeURIComponent(projectId)}/backend`,
        { data: { forgetAccount: forget } },
      );
      return res.data;
    },
    onSuccess: (_, { forget }) => {
      setConfirm(false);
      if (forget && backend) setForgotten(backend.provider);
      onDisconnected();
    },
    onError: (e) => {
      setDisconnectError(
        getApiErrorMessage(e, "Couldn't disconnect. Try again."),
      );
    },
  });

  const disconnecting = disconnectMutation.isPending;

  const disconnect = () => {
    setDisconnectError(null);
    disconnectMutation.mutate({ forget: forgetAccount });
  };

  // The connection/backend state shown here is a snapshot: resync before
  // opening anything, so the dialog's needsAuth and the buttons below reflect
  // the real thing (not a connection dropped in another tab, or on the provider's side).
  const openDialog = () => {
    onRefresh();
    if (backend) setProvider(backend.provider);
    setOpen(true);
  };

  const status = backend?.status;
  let trigger: React.ReactNode;
  if (status === "provisioning") {
    trigger = (
      <span
        className="flex h-8 items-center gap-2 rounded-full border border-border bg-muted/60 px-3 text-xs font-medium text-muted-foreground"
        role="status"
      >
        <Spinner className="size-3.5" />
        <span className="hidden sm:inline">Setting up {currentLabel}…</span>
      </span>
    );
  } else if (status === "ready") {
    trigger = (
      <ConnectedPopover
        backend={backend!}
        agentBusy={agentBusy}
        onRerun={() => onSetupBackend(backend!.provider, backend!.services)}
        onEditServices={openDialog}
        onDisconnect={() => setConfirm(true)}
      />
    );
  } else if (status === "error") {
    trigger = (
      <Button
        variant="outline"
        className="h-8 border-amber-500/40 px-2.5 text-amber-700 hover:text-amber-800 dark:text-amber-300 max-sm:w-8 max-sm:px-0"
        onClick={openDialog}
        aria-label="Backend needs attention"
      >
        <AlertTriangle />
        <span className="hidden sm:inline">
          {backend?.error === "reconnect"
            ? "Reconnect backend"
            : "Finish backend setup"}
        </span>
      </Button>
    );
  } else {
    trigger = (
      <Button
        variant="outline"
        className="h-8 px-2.5 max-sm:w-8 max-sm:px-0"
        onClick={openDialog}
        aria-label="Connect Backend"
      >
        <Database />
        <span className="hidden sm:inline">Connect Backend</span>
      </Button>
    );
  }

  return (
    <>
      {trigger}
      <ConnectDialog
        open={open}
        onOpenChange={(o) => {
          setOpen(o);
          if (!o) setNotice(null);
        }}
        projectId={projectId}
        providers={linked}
        provider={provider}
        onProviderChange={setProvider}
        backend={backend}
        notice={notice}
        agentBusy={agentBusy}
        onSetup={onSetupBackend}
      />
      <AlertDialog open={confirm} onOpenChange={setConfirm}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>
              Disconnect this app from {currentLabel}?
            </AlertDialogTitle>
            <AlertDialogDescription>
              The preview goes back to data stored on this device. Your{" "}
              {currentLabel} project and everything in it stay in your{" "}
              {currentLabel} workspace; you can delete them there.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <label className="flex cursor-pointer items-start gap-2.5 text-sm">
            <Checkbox
              checked={forgetAccount}
              onCheckedChange={(v) => setForgetAccount(!!v)}
              className="mt-0.5"
            />
            <span>
              Also remove my {currentLabel} authorization
              <span className="block text-xs text-muted-foreground">
                You can also revoke it from your {currentLabel} account
                settings.
              </span>
            </span>
          </label>
          {disconnectError && (
            <p className="text-xs text-destructive">{disconnectError}</p>
          )}
          <AlertDialogFooter>
            <AlertDialogCancel disabled={disconnecting}>
              Cancel
            </AlertDialogCancel>
            <AlertDialogAction
              variant="destructive"
              onClick={disconnect}
              disabled={disconnecting}
            >
              {disconnecting ? <Spinner /> : <Unplug />} Disconnect
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  );
}
