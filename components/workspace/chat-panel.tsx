"use client"

import * as React from "react"
import {
  AlertCircle,
  ArrowUp,
  Check,
  ChevronDown,
  FileText,
  Layers,
  Loader2,
  Paperclip,
  RotateCw,
  Sparkles,
  X,
} from "lucide-react"
import { cn } from "cn"

import type { AgentPhase, AppPlan, BuildProgress } from "@/lib/agent/types"
import { MAX_PROMPT_LENGTH } from "@/lib/project-rules"
import { Button } from "@/components/ui/button"
import type { AgentError } from "./use-agent"
import type { ChatMessage, ScreenNode } from "./types"

// ---------------------------------------------------------------- light Markdown

function Inline({ text }: { text: string }) {
  const parts = text.split(/(\*\*[^*]+\*\*|`[^`]+`)/g)
  return (
    <>
      {parts.map((p, i) =>
        p.startsWith("**") && p.endsWith("**") && p.length > 4 ? (
          <strong key={i} className="font-semibold">
            {p.slice(2, -2)}
          </strong>
        ) : p.startsWith("`") && p.endsWith("`") && p.length > 2 ? (
          <code key={i} className="rounded bg-muted px-1 py-0.5 font-mono text-[0.85em]">
            {p.slice(1, -1)}
          </code>
        ) : (
          <React.Fragment key={i}>{p}</React.Fragment>
        )
      )}
    </>
  )
}

/** Paragraphs, "- " and "1. " lists, **bold** and `code`. Never renders raw HTML. */
function RichText({ text, caret }: { text: string; caret?: boolean }) {
  const blocks = text.trim().split(/\n{2,}/)
  return (
    <div className="space-y-2.5 text-sm leading-relaxed">
      {blocks.map((block, bi) => {
        const lines = block.split("\n")
        const last = bi === blocks.length - 1
        const isList = lines.every((l) => /^\s*([-*•]|\d+[.)])\s+/.test(l))
        if (isList) {
          const ordered = /^\s*\d/.test(lines[0])
          const List = ordered ? "ol" : "ul"
          return (
            <List key={bi} className={cn("space-y-1 pl-5", ordered ? "list-decimal" : "list-disc")}>
              {lines.map((l, li) => (
                <li key={li} className="pl-0.5 marker:text-muted-foreground">
                  <Inline text={l.replace(/^\s*([-*•]|\d+[.)])\s+/, "")} />
                  {caret && last && li === lines.length - 1 && <Caret />}
                </li>
              ))}
            </List>
          )
        }
        return (
          <p key={bi} className="break-words whitespace-pre-wrap">
            <Inline text={block.replace(/^#+\s*/gm, "")} />
            {caret && last && <Caret />}
          </p>
        )
      })}
      {caret && !text.trim() && <Caret />}
    </div>
  )
}

const Caret = () => <span aria-hidden className="ml-0.5 inline-block h-[1.05em] w-[2px] translate-y-[2px] animate-pulse bg-foreground/70" />

// ---------------------------------------------------------------- cards

function PlanCard({
  plan,
  current,
  phase,
  busy,
  onApprove,
  onRequestChanges,
}: {
  plan: AppPlan
  current: boolean
  phase: AgentPhase
  busy: boolean
  onApprove: () => void
  onRequestChanges: () => void
}) {
  const [open, setOpen] = React.useState(current)
  React.useEffect(() => setOpen(current), [current])
  const awaiting = current && phase === "awaiting_approval"
  const approved = current && (phase === "generating" || phase === "ready")
  const d = plan.design

  return (
    <div className={cn("mt-3 overflow-hidden rounded-(--r-md) border bg-background", awaiting ? "border-primary/40 shadow-[0_0_0_3px_color-mix(in_oklch,var(--action),transparent_92%)]" : "border-border")}>
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        aria-expanded={open}
        className="flex w-full items-center gap-3 px-3.5 py-3 text-left transition-colors hover:bg-muted/50"
      >
        <span className="flex size-8 shrink-0 items-center justify-center rounded-(--r-sm) text-white" style={{ background: d.primaryColor }}>
          <Layers className="size-4" />
        </span>
        <span className="min-w-0 flex-1">
          <span className="block truncate text-sm font-semibold">{plan.appName}</span>
          <span className="block text-xs text-muted-foreground">
            {plan.screens.length} screens · {current ? (approved ? "Approved" : "Proposed plan") : "Earlier version"}
          </span>
        </span>
        {approved && (
          <span className="inline-flex items-center gap-1 rounded-full bg-primary/10 px-2 py-0.5 text-[11px] font-medium text-primary">
            <Check className="size-3" /> Approved
          </span>
        )}
        <ChevronDown className={cn("size-4 shrink-0 text-muted-foreground transition-transform", open && "rotate-180")} />
      </button>

      {open && (
        <div className="space-y-4 border-t border-border px-3.5 py-3.5">
          {plan.summary && <p className="text-sm leading-relaxed text-muted-foreground">{plan.summary}</p>}

          <section>
            <h4 className="mb-2 text-[11px] font-medium tracking-wide text-muted-foreground uppercase">Screens</h4>
            <ol className="space-y-2">
              {plan.screens.map((s, i) => (
                <li key={s.id} className="flex gap-2.5 rounded-(--r-sm) bg-muted/50 p-2.5">
                  <span className="flex size-5 shrink-0 items-center justify-center rounded-full bg-background text-[11px] font-medium tabular-nums shadow-sm">
                    {i + 1}
                  </span>
                  <div className="min-w-0">
                    <p className="text-sm font-medium">{s.name}</p>
                    {s.purpose && <p className="text-xs leading-relaxed text-muted-foreground">{s.purpose}</p>}
                    {s.keyElements.length > 0 && (
                      <ul className="mt-1.5 flex flex-wrap gap-1">
                        {s.keyElements.slice(0, 6).map((k) => (
                          <li key={k} className="rounded-md border border-border bg-background px-1.5 py-0.5 text-[11px] text-foreground/75">
                            {k}
                          </li>
                        ))}
                      </ul>
                    )}
                  </div>
                </li>
              ))}
            </ol>
          </section>

          {plan.coreFeatures.length > 0 && (
            <section>
              <h4 className="mb-1.5 text-[11px] font-medium tracking-wide text-muted-foreground uppercase">Core features</h4>
              <ul className="list-disc space-y-0.5 pl-4 text-sm marker:text-muted-foreground">
                {plan.coreFeatures.map((f) => (
                  <li key={f}>{f}</li>
                ))}
              </ul>
            </section>
          )}

          <section>
            <h4 className="mb-1.5 text-[11px] font-medium tracking-wide text-muted-foreground uppercase">Look and feel</h4>
            <div className="mb-2 flex gap-1.5">
              {[d.primaryColor, d.accentColor, d.backgroundColor, d.surfaceColor, d.textColor].map((c, i) => (
                <span key={i} title={c} className="size-6 rounded-md ring-1 ring-foreground/10" style={{ background: c }} />
              ))}
            </div>
            <p className="text-sm text-muted-foreground">{d.style}</p>
          </section>

          {plan.navigation && (
            <section>
              <h4 className="mb-1.5 text-[11px] font-medium tracking-wide text-muted-foreground uppercase">Navigation</h4>
              <p className="text-sm text-muted-foreground">{plan.navigation}</p>
            </section>
          )}
        </div>
      )}

      {awaiting && (
        <div className="flex flex-wrap items-center gap-2 border-t border-border bg-muted/40 px-3.5 py-2.5">
          <Button size="sm" className="h-8 rounded-(--r-sm) px-3" disabled={busy} onClick={onApprove}>
            <Sparkles /> Approve & build
          </Button>
          <Button size="sm" variant="ghost" className="h-8 rounded-(--r-sm) px-3" disabled={busy} onClick={onRequestChanges}>
            Request changes
          </Button>
        </div>
      )}
    </div>
  )
}

function BuildCard({ build }: { build: BuildProgress }) {
  const total = build.screens.length
  const done = build.screens.filter((s) => s.state === "ready").length
  const running = build.screens.some((s) => s.state === "generating" || s.state === "pending")
  return (
    <div className="mt-3 rounded-(--r-md) border border-border bg-background p-3">
      <div className="mb-2.5 flex items-center justify-between text-xs">
        <span className="font-medium">{running ? "Designing screens" : "Screens"}</span>
        <span className="text-muted-foreground tabular-nums">
          {done}/{total}
        </span>
      </div>
      <div className="mb-3 h-1 overflow-hidden rounded-full bg-muted">
        <div className="h-full rounded-full bg-primary transition-[width] duration-500" style={{ width: `${total ? (done / total) * 100 : 0}%` }} />
      </div>
      <ol className="space-y-1.5">
        {build.screens.map((s) => (
          <li key={s.id} className="flex items-center gap-2.5 text-sm">
            <span
              className={cn(
                "flex size-4 shrink-0 items-center justify-center rounded-full",
                s.state === "ready" && "bg-primary text-primary-foreground",
                s.state === "pending" && "border border-border",
                s.state === "error" && "bg-destructive/15 text-destructive"
              )}
            >
              {s.state === "ready" && <Check className="size-2.5" strokeWidth={3} />}
              {s.state === "generating" && <Loader2 className="size-4 animate-spin text-primary" />}
              {s.state === "error" && <X className="size-2.5" strokeWidth={3} />}
            </span>
            <span className={cn(s.state === "pending" && "text-muted-foreground", s.state === "generating" && "font-medium")}>{s.name}</span>
            {s.state === "generating" && <span className="shimmer-text text-xs">designing…</span>}
            {s.state === "error" && <span className="text-xs text-destructive">failed</span>}
          </li>
        ))}
      </ol>
    </div>
  )
}

// ---------------------------------------------------------------- messages

const AgentAvatar = ({ active }: { active?: boolean }) => (
  <span className={cn("relative flex size-7 shrink-0 items-center justify-center rounded-(--r-sm) bg-muted", active && "bg-primary/10 text-primary")}>
    <Sparkles className={cn("size-3.5", active && "animate-pulse")} />
  </span>
)

function UserMessage({ message }: { message: ChatMessage }) {
  return (
    <div className="flex flex-col items-end gap-2">
      <div className="max-w-[88%] rounded-2xl rounded-br-md bg-primary px-3.5 py-2.5 text-sm leading-relaxed text-primary-foreground">
        <p className="break-words whitespace-pre-wrap">{message.text}</p>
      </div>
      {message.assets && message.assets.length > 0 && (
        <div className="flex max-w-[88%] flex-wrap justify-end gap-1.5">
          {message.assets.map((a) => (
            <a
              key={a.id}
              href={a.url ?? undefined}
              target="_blank"
              rel="noopener noreferrer"
              className="flex max-w-44 items-center gap-2 rounded-(--r-sm) border border-border bg-background p-1 pr-2.5 text-xs transition-colors hover:bg-muted"
            >
              {a.url && a.type.startsWith("image/") ? (
                // eslint-disable-next-line @next/next/no-img-element
                <img src={a.url} alt="" className="size-7 shrink-0 rounded-md object-cover" />
              ) : (
                <span className="flex size-7 shrink-0 items-center justify-center rounded-md bg-muted">
                  <FileText className="size-3.5 text-muted-foreground" />
                </span>
              )}
              <span className="truncate">{a.name}</span>
            </a>
          ))}
        </div>
      )}
    </div>
  )
}

function AgentBlock({ children, active }: { children: React.ReactNode; active?: boolean }) {
  return (
    <div className="flex items-start gap-2.5">
      <AgentAvatar active={active} />
      <div className="min-w-0 flex-1 pt-0.5">
        <p className="mb-1 text-xs font-medium text-muted-foreground">Anything Agent</p>
        {children}
      </div>
    </div>
  )
}

/**
 * The server sends a new status line only when the label itself changes (not
 * once a second), each carrying `since`; the elapsed-seconds counter here is
 * purely a client-side tick, so the SSE stream stays quiet while this still visibly counts.
 */
function ActivityLine({ text, since }: { text: string; since: number | null }) {
  const [now, setNow] = React.useState(() => Date.now())
  React.useEffect(() => {
    if (!since) return
    const timer = setInterval(() => setNow(Date.now()), 1000)
    return () => clearInterval(timer)
  }, [since])
  const secs = since ? Math.max(0, Math.round((now - since) / 1000)) : null

  return (
    <p role="status" className="flex items-center gap-2 text-sm">
      <Loader2 className="size-3.5 shrink-0 animate-spin text-primary" />
      <span className="shimmer-text truncate">
        {text}
        {secs !== null && secs > 0 ? ` · ${secs}s` : ""}
      </span>
    </p>
  )
}

// ---------------------------------------------------------------- panel

export function ChatPanel({
  messages,
  streaming,
  status,
  statusSince,
  planProgress,
  phase,
  busy,
  error,
  onSend,
  onApprove,
  onRetry,
  onDismissError,
  editTarget,
  onClearEditTarget,
  inputRef,
}: {
  messages: ChatMessage[]
  streaming: { id: string; text: string } | null
  status: string | null
  statusSince: number | null
  planProgress: string[]
  phase: AgentPhase
  busy: boolean
  error: AgentError | null
  onSend: (text: string) => void
  onApprove: () => void
  onRetry: () => void
  onDismissError: () => void
  editTarget: ScreenNode | null
  onClearEditTarget: () => void
  inputRef: React.RefObject<HTMLTextAreaElement | null>
}) {
  const [value, setValue] = React.useState("")
  const scrollRef = React.useRef<HTMLDivElement>(null)
  const pinned = React.useRef(true)

  const currentPlanId = React.useMemo(() => [...messages].reverse().find((m) => m.kind === "plan" && m.plan)?.id, [messages])

  // Follow new output unless the user has scrolled up to read.
  React.useEffect(() => {
    const el = scrollRef.current
    if (el && pinned.current) el.scrollTop = el.scrollHeight
  }, [messages, streaming?.text, status, planProgress.length, error])

  React.useLayoutEffect(() => {
    const el = inputRef.current
    if (!el) return
    el.style.height = "auto"
    el.style.height = `${Math.min(el.scrollHeight, 180)}px`
  }, [value, inputRef])

  const canSend = !!value.trim() && !busy
  const submit = () => {
    if (!canSend) return
    onSend(value.trim())
    setValue("")
    pinned.current = true
  }

  const requestChanges = () => {
    inputRef.current?.focus()
    if (!value) setValue("")
  }

  // While prose streams in, the text itself is the progress; otherwise show what the agent is doing.
  const showActivity = busy && !!status && status !== "Writing"

  return (
    <div className="flex h-full min-h-0 flex-col bg-background">
      <div className="flex h-11 shrink-0 items-center justify-between border-b border-border pr-2 pl-4">
        <p className="text-sm font-medium">Chat</p>
        <span className={cn("inline-flex items-center gap-1.5 text-xs", busy ? "text-primary" : "text-muted-foreground")}>
          <span className={cn("size-1.5 rounded-full", busy ? "animate-pulse bg-primary" : phase === "awaiting_approval" ? "bg-amber-500" : "bg-emerald-500")} />
          {busy ? "Working" : phase === "awaiting_approval" ? "Waiting for you" : "Ready"}
        </span>
      </div>

      <div
        ref={scrollRef}
        onScroll={(e) => {
          const el = e.currentTarget
          pinned.current = el.scrollHeight - el.scrollTop - el.clientHeight < 80
        }}
        className="min-h-0 flex-1 overflow-y-auto px-4 py-5"
        role="log"
        aria-live="polite"
        aria-busy={busy}
      >
        <div className="space-y-5">
          {messages.map((m) =>
            m.sender === "user" ? (
              <UserMessage key={m.id} message={m} />
            ) : (
              <AgentBlock key={m.id}>
                {m.text && <RichText text={m.text} />}
                {m.kind === "plan" && m.plan && (
                  <PlanCard
                    plan={m.plan}
                    current={m.id === currentPlanId}
                    phase={phase}
                    busy={busy}
                    onApprove={onApprove}
                    onRequestChanges={requestChanges}
                  />
                )}
                {m.kind === "build" && m.build && <BuildCard build={m.build} />}
                {m.version !== undefined && (
                  <span className="mt-2 inline-flex items-center rounded-full bg-muted px-2 py-0.5 text-xs font-medium text-muted-foreground">
                    Version {m.version}
                  </span>
                )}
              </AgentBlock>
            )
          )}

          {(streaming || showActivity) && (
            <AgentBlock active>
              {streaming && streaming.text && <RichText text={streaming.text} caret={!planProgress.length} />}
              {planProgress.length > 0 && (
                <div className="mt-3 rounded-(--r-md) border border-dashed border-primary/40 bg-primary/[0.03] p-3">
                  <p className="mb-2 text-xs font-medium text-primary">Drafting the plan</p>
                  <ol className="flex flex-wrap gap-1.5">
                    {planProgress.map((n, i) => (
                      <li key={`${n}-${i}`} className="animate-in fade-in-0 slide-in-from-bottom-1 rounded-md bg-background px-2 py-1 text-xs shadow-sm ring-1 ring-border">
                        {i + 1}. {n}
                      </li>
                    ))}
                  </ol>
                </div>
              )}
              {showActivity && <div className={cn(streaming?.text && "mt-2.5")}><ActivityLine text={status!} since={statusSince} /></div>}
            </AgentBlock>
          )}

          {error && (
            <div role="alert" className="flex items-start gap-2.5 rounded-(--r-md) border border-destructive/25 bg-destructive/5 p-3 text-sm">
              <AlertCircle className="mt-0.5 size-4 shrink-0 text-destructive" />
              <div className="min-w-0 flex-1">
                <p>{error.message}</p>
                {error.retry && (
                  <Button size="sm" variant="outline" className="mt-2 h-7" onClick={onRetry}>
                    <RotateCw /> Try again
                  </Button>
                )}
              </div>
              <button type="button" onClick={onDismissError} aria-label="Dismiss" className="text-muted-foreground hover:text-foreground">
                <X className="size-4" />
              </button>
            </div>
          )}
        </div>
      </div>

      <div className="shrink-0 p-3 pt-0">
        <div className="rounded-(--r-lg) border border-border bg-card p-2 shadow-[0_1px_2px_rgba(17,17,17,0.04),0_12px_24px_-12px_rgba(17,17,17,0.12)] transition-all focus-within:border-primary/40 focus-within:shadow-[0_0_0_3px_color-mix(in_oklch,var(--action),transparent_88%)]">
          {editTarget && (
            <div className="mb-1 flex px-1 pt-0.5">
              <span className="inline-flex items-center gap-1.5 rounded-full bg-primary/10 py-0.5 pr-1 pl-2.5 text-xs font-medium text-primary">
                Editing: {editTarget.name}
                <button
                  type="button"
                  onClick={onClearEditTarget}
                  aria-label="Stop editing this screen"
                  className="flex size-4 items-center justify-center rounded-full hover:bg-primary/15"
                >
                  <X className="size-3" />
                </button>
              </span>
            </div>
          )}
          <textarea
            ref={inputRef}
            value={value}
            rows={2}
            maxLength={MAX_PROMPT_LENGTH}
            onChange={(e) => setValue(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter" && !e.shiftKey && !e.nativeEvent.isComposing) {
                e.preventDefault()
                submit()
              }
            }}
            placeholder={
              editTarget
                ? `Describe changes to ${editTarget.name}…`
                : phase === "awaiting_approval"
                  ? "Ask for changes to the plan, or approve it…"
                  : busy
                    ? "The agent is working. You can type your next message…"
                    : "Ask for changes or new features…"
            }
            className="block max-h-[180px] min-h-12 w-full resize-none bg-transparent px-2 py-1.5 text-sm leading-relaxed outline-none placeholder:text-muted-foreground"
          />
          <div className="flex items-center justify-between pt-1">
            <Button variant="ghost" size="icon-sm" aria-label="Attach files (coming soon)" title="Attach files (coming soon)" className="text-muted-foreground" disabled>
              <Paperclip />
            </Button>
            <div className="flex items-center gap-2">
              <span className="hidden text-[11px] text-muted-foreground sm:inline">Shift + Enter for new line</span>
              <Button size="icon-sm" disabled={!canSend} onClick={submit} aria-label="Send message" className="rounded-(--r-sm)">
                {busy ? <Loader2 className="animate-spin" /> : <ArrowUp />}
              </Button>
            </div>
          </div>
        </div>
      </div>
    </div>
  )
}
