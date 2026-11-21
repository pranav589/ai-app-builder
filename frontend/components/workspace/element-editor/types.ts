import type * as React from "react"
import type { ElementEdit, SelectedElement } from "@app/shared/preview/protocol"

/** Every style value is held as the CSS string it was read as / will be sent as. */
export type Vals = Record<string, string>

export type Shadow = { y: number; blur: number; opacity: number }

export type Option = {
  value: string
  label?: string
  icon?: React.ComponentType<{ className?: string }>
  title?: string
}

export type TabId = "image" | "text" | "colors" | "spacing" | "layout" | "border" | "effects"

export type PendingEdit = { text?: string; style?: Record<string, string>; imageSrc?: string }

export type SaveResult = { ok: boolean; error?: string; resynced?: boolean; aborted?: boolean }

export type SizeMode = "auto" | "fill" | "fixed"

export interface ElementEditorProps {
  element: SelectedElement
  screenName?: string
  advanced: boolean
  onAdvancedChange: (advanced: boolean) => void
  onClose: () => void
  onSelectParent: () => void
  onPreview: (edit: ElementEdit) => void
  onSave: (edit: ElementEdit, signal?: AbortSignal) => Promise<SaveResult>
  onViewCode: () => void
  /** Sends an instruction about this element to the AI (through the chat). */
  onAskAI: (instruction: string) => void
  disabledAI?: boolean
}
