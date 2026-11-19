"use client"

import * as React from "react"
import { useRouter } from "next/navigation"
import { useMutation } from "@tanstack/react-query"
import {
  AlertCircle,
  ArrowUp,
  CheckCircle2,
  FileIcon,
  ImageIcon,
  Paperclip,
  Sparkles,
  X,
} from "lucide-react"

import { cn } from "cn"
import { useAuth } from "@/components/auth/auth-provider"
import { apiClient, getApiErrorMessage, getApiErrorStatus } from "@/lib/api-client"
import {
  ASSET_ACCEPT,
  MAX_ASSETS,
  MAX_PROMPT_LENGTH,
  MAX_TOTAL_BYTES,
  formatBytes,
  validateAsset,
} from "@/lib/project-rules"
import { Textarea } from "@/components/ui/textarea"
import { Button } from "@/components/ui/button"
import { Spinner } from "@/components/ui/spinner"
import {
  Attachment,
  AttachmentContent,
  AttachmentDescription,
  AttachmentGroup,
  AttachmentMedia,
  AttachmentTitle,
} from "@/components/ui/attachment"

type PendingFile = {
  id: string
  file: File
  previewUrl?: string
}

// idle -> (uploading ->) creating -> done, then we navigate to the workspace.
type Phase = "idle" | "uploading" | "creating" | "done"

const PENDING_PROMPT_KEY = "ch_pending_prompt"

const SUGGESTIONS = [
  "A habit tracker with streaks and reminders",
  "A minimalist recipe app with grocery lists",
  "A budgeting app that syncs with my bank",
  "A social app for local book clubs",
  "A workout planner with progress charts",
  "A marketplace for secondhand furniture",
]

export function PromptBox() {
  const router = useRouter()
  const { user, isPending, openAuthDialog } = useAuth()
  const [value, setValue] = React.useState("")
  const [files, setFiles] = React.useState<PendingFile[]>([])
  const [phase, setPhase] = React.useState<Phase>("idle")
  const [progress, setProgress] = React.useState(0)
  const [error, setError] = React.useState<string | null>(null)
  const [droppedFiles, setDroppedFiles] = React.useState(0)
  const fileInputRef = React.useRef<HTMLInputElement>(null)
  const filesRef = React.useRef(files)
  filesRef.current = files

  const busy = phase !== "idle"

  React.useEffect(
    () => () => filesRef.current.forEach((f) => f.previewUrl && URL.revokeObjectURL(f.previewUrl)),
    []
  )

  const addFiles = (fileList: FileList | null) => {
    if (!fileList || busy) return
    const problems: string[] = []
    const accepted: PendingFile[] = []
    let total = files.reduce((n, f) => n + f.file.size, 0)

    for (const file of Array.from(fileList)) {
      const problem = validateAsset(file)
      if (problem) problems.push(problem)
      else if (files.length + accepted.length >= MAX_ASSETS)
        problems.push(`You can attach up to ${MAX_ASSETS} files`)
      else if (total + file.size > MAX_TOTAL_BYTES)
        problems.push(`${file.name}: total size would exceed ${formatBytes(MAX_TOTAL_BYTES)}`)
      else if (files.some((f) => f.file.name === file.name && f.file.size === file.size))
        continue
      else {
        total += file.size
        accepted.push({
          id: `${file.name}-${file.size}-${Math.random().toString(36).slice(2)}`,
          file,
          previewUrl: file.type.startsWith("image/") ? URL.createObjectURL(file) : undefined,
        })
      }
    }
    setError(problems.length ? [...new Set(problems)].join(". ") : null)
    if (accepted.length) setFiles((prev) => [...prev, ...accepted])
  }

  const removeFile = (id: string) => {
    if (busy) return
    setFiles((prev) => {
      const gone = prev.find((f) => f.id === id)
      if (gone?.previewUrl) URL.revokeObjectURL(gone.previewUrl)
      return prev.filter((f) => f.id !== id)
    })
    setError(null)
  }

  const createProjectMutation = useMutation({
    mutationFn: async ({
      form,
      onProgress,
    }: {
      form: FormData
      onProgress: (percent: number) => void
    }) => {
      const res = await apiClient.post<{ projectId?: string; error?: string }>("/api/projects", form, {
        headers: { "Content-Type": "multipart/form-data" },
        onUploadProgress: (e) => {
          if (e.total) onProgress(Math.round((e.loaded / e.total) * 100))
        },
      })
      return res.data
    },
  })

  // Nothing is uploaded or saved until this runs, i.e. until the user presses Send.
  const createProject = async (prompt: string, attached: PendingFile[]) => {
    setError(null)
    setProgress(0)
    setPhase(attached.length ? "uploading" : "creating")

    const form = new FormData()
    form.append("prompt", prompt)
    attached.forEach((f) => form.append("assets", f.file, f.file.name))

    const fail = (message: string) => {
      setPhase("idle")
      setError(message)
    }

    try {
      const data = await createProjectMutation.mutateAsync({
        form,
        onProgress: (pct) => {
          setProgress(pct)
          if (pct >= 100) setPhase("creating")
        },
      })
      if (data.projectId) {
        setPhase("done")
        router.push(`/workspace/${data.projectId}`)
      } else {
        fail(data.error ?? "We couldn't create your project. Please try again.")
      }
    } catch (err) {
      if (getApiErrorStatus(err) === 401) {
        // Session expired while the page was open: sign in again, then retry.
        setPhase("idle")
        openAuthDialog({ mode: "sign-in", onSuccess: () => createProject(prompt, attached) })
        return
      }
      fail(getApiErrorMessage(err, "We couldn't create your project. Please try again."))
    }
  }

  const handleSubmit = () => {
    const prompt = value.trim()
    if (!prompt || busy) return
    setError(null)

    if (!user) {
      // The prompt and files stay in this component's state while the dialog is
      // open, so nothing is lost; the project is created right after signing in.
      openAuthDialog({
        mode: "sign-up",
        onSuccess: () => createProject(prompt, files),
        // A GitHub/Google sign-in reloads the page: keep the text across it.
        // Files can't survive a reload; remember how many so we can say so.
        onBeforeSocialRedirect: () => {
          try {
            sessionStorage.setItem(
              PENDING_PROMPT_KEY,
              JSON.stringify({ prompt, fileCount: files.length })
            )
          } catch {
            // storage unavailable: the prompt is simply not restored
          }
        },
      })
      return
    }
    createProject(prompt, files)
  }

  // After a GitHub/Google round trip the page has reloaded: restore what the user typed.
  // With no files to re-attach and a signed-in user, carry straight on.
  const resumedRef = React.useRef(false)
  React.useEffect(() => {
    if (isPending || resumedRef.current) return
    resumedRef.current = true
    let pending: { prompt: string; fileCount: number } | null = null
    try {
      const raw = sessionStorage.getItem(PENDING_PROMPT_KEY)
      sessionStorage.removeItem(PENDING_PROMPT_KEY)
      pending = raw ? JSON.parse(raw) : null
    } catch {
      return
    }
    if (!pending?.prompt) return
    setValue(pending.prompt)
    setDroppedFiles(pending.fileCount)
    if (user && pending.fileCount === 0) createProject(pending.prompt, [])
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isPending])

  const statusText =
    phase === "uploading"
      ? `Uploading ${files.length} ${files.length === 1 ? "file" : "files"}… ${progress}%`
      : phase === "creating"
        ? "Creating your project…"
        : phase === "done"
          ? "Project created. Opening your workspace…"
          : null

  return (
    <div className="w-full">
      <div
        className="rounded-3xl border border-border bg-card p-4 text-left shadow-[0_1px_2px_rgba(17,17,17,0.04),0_24px_48px_-16px_rgba(17,17,17,0.14)] transition-all focus-within:border-primary/40 focus-within:shadow-[0_0_0_4px_color-mix(in_oklch,var(--action),transparent_88%),0_24px_48px_-16px_rgba(17,17,17,0.18)]"
        onDragOver={(e) => e.preventDefault()}
        onDrop={(e) => {
          e.preventDefault()
          addFiles(e.dataTransfer.files)
        }}
      >
        <Textarea
          value={value}
          disabled={busy}
          maxLength={MAX_PROMPT_LENGTH}
          onChange={(e) => setValue(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter" && !e.shiftKey && !e.nativeEvent.isComposing) {
              e.preventDefault()
              handleSubmit()
            }
          }}
          placeholder="Ask Anything to build a habit tracker with streaks and reminders…"
          className="min-h-28 resize-none border-0 bg-transparent px-1 text-lg shadow-none ring-0 focus-visible:ring-0 md:text-lg"
        />

        {files.length > 0 && (
          <AttachmentGroup className="px-1 pb-1">
            {files.map((f) => (
              <Attachment key={f.id} size="sm" state={phase === "uploading" ? "uploading" : "done"}>
                <AttachmentMedia variant={f.previewUrl ? "image" : "icon"}>
                  {f.previewUrl ? (
                    // eslint-disable-next-line @next/next/no-img-element
                    <img src={f.previewUrl} alt={f.file.name} />
                  ) : f.file.type.startsWith("image/") ? (
                    <ImageIcon />
                  ) : (
                    <FileIcon />
                  )}
                </AttachmentMedia>
                <AttachmentContent>
                  <AttachmentTitle>{f.file.name}</AttachmentTitle>
                  <AttachmentDescription>{formatBytes(f.file.size)}</AttachmentDescription>
                </AttachmentContent>
                <button
                  type="button"
                  disabled={busy}
                  onClick={() => removeFile(f.id)}
                  className="relative z-20 flex size-5 shrink-0 items-center justify-center self-center rounded-full text-muted-foreground hover:bg-muted hover:text-foreground disabled:opacity-40"
                  aria-label={`Remove ${f.file.name}`}
                >
                  <X className="size-3.5" />
                </button>
              </Attachment>
            ))}
          </AttachmentGroup>
        )}

        <div className="flex items-center justify-between px-1 pt-1">
          <input
            ref={fileInputRef}
            type="file"
            multiple
            accept={ASSET_ACCEPT}
            className="hidden"
            onChange={(e) => {
              addFiles(e.target.files)
              e.target.value = ""
            }}
          />
          <Button
            type="button"
            variant="outline"
            disabled={busy}
            className="h-10 gap-2 rounded-xl px-3.5 text-sm text-muted-foreground"
            onClick={() => fileInputRef.current?.click()}
          >
            <Paperclip /> Attach
          </Button>

          <Button
            type="button"
            disabled={!value.trim() || busy}
            onClick={handleSubmit}
            className="h-10 gap-2 rounded-xl px-4 text-sm"
          >
            {busy ? (
              <>
                <Spinner /> Sending…
              </>
            ) : (
              <>
                Send <ArrowUp />
              </>
            )}
          </Button>
        </div>

        {phase === "uploading" && (
          <div
            role="progressbar"
            aria-valuenow={progress}
            aria-valuemin={0}
            aria-valuemax={100}
            className="mx-1 mt-3 h-1 overflow-hidden rounded-full bg-muted"
          >
            <div className="h-full bg-primary transition-[width]" style={{ width: `${progress}%` }} />
          </div>
        )}
      </div>

      {statusText && (
        <p role="status" className="mt-4 flex items-center justify-center gap-2 text-sm text-muted-foreground">
          {phase === "done" ? <CheckCircle2 className="size-4 text-primary" /> : <Spinner />}
          {statusText}
        </p>
      )}
      {error && (
        <p role="alert" className="mt-4 flex items-center justify-center gap-2 text-sm text-destructive">
          <AlertCircle className="size-4 shrink-0" />
          {error}
        </p>
      )}
      {droppedFiles > 0 && !busy && (
        <p role="status" className="mt-2 text-center text-sm text-muted-foreground">
          Signing in reloaded the page, so please re-attach your {droppedFiles}{" "}
          {droppedFiles === 1 ? "file" : "files"}, then press Send.
        </p>
      )}

      <div className="mt-6 flex flex-wrap justify-center gap-2.5">
        {SUGGESTIONS.map((suggestion) => (
          <button
            key={suggestion}
            type="button"
            disabled={busy}
            onClick={() => setValue(suggestion)}
            className={cn(
              "inline-flex items-center gap-2 rounded-full border border-border bg-background/80 px-4 py-2 text-sm text-muted-foreground shadow-sm backdrop-blur transition-all hover:-translate-y-0.5 disabled:pointer-events-none disabled:opacity-50",
              "hover:border-foreground/20 hover:bg-muted hover:text-foreground"
            )}
          >
            <Sparkles className="size-3.5 text-muted-foreground" />
            {suggestion}
          </button>
        ))}
      </div>
    </div>
  )
}
