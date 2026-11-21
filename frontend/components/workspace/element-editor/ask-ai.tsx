import * as React from "react"
import { ArrowUp, Sparkles } from "lucide-react"

import { Button } from "@/components/ui/button"
import { SUGGESTIONS } from "./constants"

/** The "Edit with AI" box: sends an instruction about this element to the chat's AI agent. */
export function AskAI({
  value,
  onChange,
  onSend,
  disabled,
}: {
  value: string
  onChange: (v: string) => void
  onSend: () => void
  disabled?: boolean
}) {
  const canSend = !!value.trim() && !disabled
  return (
    <div className="space-y-2.5">
      <p className="flex items-center gap-1.5 text-sm font-semibold">
        <Sparkles className="size-4 text-primary" /> Edit with AI
      </p>
      <div className="flex items-end gap-1.5 rounded-(--r-md) border border-input bg-background p-2 focus-within:border-ring focus-within:ring-2 focus-within:ring-ring/30">
        <textarea
          autoFocus
          value={value}
          rows={3}
          placeholder="Describe the change to this element…"
          aria-label="Edit this element with AI"
          onChange={(e) => onChange(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter" && !e.shiftKey && !e.nativeEvent.isComposing) {
              e.preventDefault()
              if (canSend) onSend()
            }
          }}
          className="block max-h-28 min-h-14 flex-1 resize-none bg-transparent px-1 text-sm outline-none placeholder:text-muted-foreground"
        />
        <Button type="button" size="icon-sm" disabled={!canSend} onClick={onSend} aria-label="Send to AI" className="shrink-0">
          <ArrowUp />
        </Button>
      </div>
      <div className="flex flex-wrap gap-1.5">
        {SUGGESTIONS.map((s) => (
          <button
            key={s}
            type="button"
            onClick={() => onChange(s)}
            className="rounded-full border border-border px-2.5 py-1 text-xs text-muted-foreground transition-colors hover:border-foreground/20 hover:text-foreground"
          >
            {s}
          </button>
        ))}
      </div>
      {disabled && <p className="text-xs text-muted-foreground">The agent is busy. Try again in a moment.</p>}
    </div>
  )
}
