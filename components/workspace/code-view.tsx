"use client"

import * as React from "react"
import { Braces, ChevronRight, FileCode2, FileJson, Folder, FolderOpen, PanelLeft, Search } from "lucide-react"
import { cn } from "cn"

import { useHighlightedCode } from "@/hooks/use-highlighted-code"
import {
  CodeBlock,
  CodeBlockContent,
  CodeBlockCopyButton,
  CodeBlockLine,
} from "@/components/ui/code-block"
import { Button } from "@/components/ui/button"
import type { FileNode } from "./types"

type FileLeaf = Extract<FileNode, { type: "file" }>

function fileIcon(name: string) {
  if (name.endsWith(".json")) return FileJson
  if (name.endsWith(".ts")) return Braces
  return FileCode2
}

const OWNER_LABEL: Record<FileLeaf["owner"], string> = { app: "App", platform: "Platform", generated: "Generated" }

function OwnerBadge({ owner, className }: { owner: FileLeaf["owner"]; className?: string }) {
  if (owner === "app") return null
  return (
    <span className={cn("shrink-0 rounded-md bg-muted px-1.5 py-0.5 text-[10px] font-medium text-muted-foreground", className)}>
      {OWNER_LABEL[owner]}
    </span>
  )
}

function flatten(nodes: FileNode[]): FileLeaf[] {
  return nodes.flatMap((n): FileLeaf[] => (n.type === "file" ? [n] : flatten(n.children)))
}

function filterTree(nodes: FileNode[], q: string): FileNode[] {
  if (!q) return nodes
  return nodes.flatMap((n): FileNode[] => {
    if (n.type === "file") return n.path.toLowerCase().includes(q) ? [n] : []
    const children = filterTree(n.children, q)
    return children.length ? [{ ...n, children }] : []
  })
}

function TreeItem({
  node,
  depth,
  activePath,
  open,
  onToggle,
  onOpenFile,
}: {
  node: FileNode
  depth: number
  activePath: string
  open: Set<string>
  onToggle: (path: string) => void
  onOpenFile: (file: FileLeaf) => void
}) {
  const pad = { paddingLeft: 8 + depth * 12 }
  if (node.type === "folder") {
    const isOpen = open.has(node.path)
    return (
      <li role="treeitem" aria-expanded={isOpen} aria-selected={false}>
        <button
          type="button"
          onClick={() => onToggle(node.path)}
          className="flex h-7 w-full items-center gap-1.5 rounded-md pr-2 text-left text-[13px] text-foreground/80 transition-colors hover:bg-muted"
          style={pad}
        >
          <ChevronRight className={cn("size-3.5 shrink-0 text-muted-foreground transition-transform", isOpen && "rotate-90")} />
          {isOpen ? (
            <FolderOpen className="size-3.5 shrink-0 text-muted-foreground" />
          ) : (
            <Folder className="size-3.5 shrink-0 text-muted-foreground" />
          )}
          <span className="truncate">{node.name}</span>
        </button>
        {isOpen && (
          <ul role="group">
            {node.children.map((c) => (
              <TreeItem
                key={c.path}
                node={c}
                depth={depth + 1}
                activePath={activePath}
                open={open}
                onToggle={onToggle}
                onOpenFile={onOpenFile}
              />
            ))}
          </ul>
        )}
      </li>
    )
  }
  const Icon = fileIcon(node.name)
  const active = node.path === activePath
  return (
    <li role="treeitem" aria-selected={active}>
      <button
        type="button"
        onClick={() => onOpenFile(node)}
        className={cn(
          "flex h-7 w-full items-center gap-1.5 rounded-md pr-2 text-left text-[13px] transition-colors",
          active ? "bg-primary/10 font-medium text-primary" : "text-foreground/80 hover:bg-muted"
        )}
        style={{ paddingLeft: 8 + depth * 12 + 20 }}
      >
        <Icon className="size-3.5 shrink-0 opacity-70" />
        <span className="min-w-0 flex-1 truncate">{node.name}</span>
        <OwnerBadge owner={node.owner} />
      </button>
    </li>
  )
}

function CodeViewer({ file, highlightLine }: { file: FileLeaf; highlightLine?: number }) {
  const lines = useHighlightedCode(file.content, file.language)
  const lineRef = React.useRef<HTMLSpanElement>(null)

  React.useEffect(() => {
    if (highlightLine) lineRef.current?.scrollIntoView({ block: "center" })
  }, [file.path, highlightLine])

  return (
    <CodeBlock className="h-full rounded-none border-0 bg-background">
      <CodeBlockContent lineNumbers className="h-full px-4 py-3 text-[12.5px]">
        {lines.map((line, i) => (
          <CodeBlockLine
            key={i}
            ref={i + 1 === highlightLine ? lineRef : undefined}
            variant={i + 1 === highlightLine ? "highlighted" : "default"}
            className="-mx-4 px-4"
          >
            {line}
          </CodeBlockLine>
        ))}
      </CodeBlockContent>
    </CodeBlock>
  )
}

export function CodeView({ tree, jumpTo }: { tree: FileNode[]; jumpTo?: { path: string; line: number } | null }) {
  const files = React.useMemo(() => flatten(tree), [tree])
  const [active, setActive] = React.useState<FileLeaf | undefined>(
    () => files.find((f) => f.path.endsWith("(tabs)/index.tsx")) ?? files[0]
  )
  const [highlightLine, setHighlightLine] = React.useState<number | undefined>(undefined)
  const [open, setOpen] = React.useState<Set<string>>(() => new Set(["app", "app/(tabs)", "components"]))
  const [query, setQuery] = React.useState("")
  const [treeOpen, setTreeOpen] = React.useState(true)
  const visible = React.useMemo(() => filterTree(tree, query.trim().toLowerCase()), [tree, query])
  const searching = query.trim().length > 0

  // Jumped here from the preview's canvas inspector (Phase 9, item 3):
  // open the element's file, expand its folders, and highlight its line.
  React.useEffect(() => {
    if (!jumpTo) return
    const file = files.find((f) => f.path === jumpTo.path)
    if (!file) return
    setActive(file)
    setHighlightLine(jumpTo.line)
    setOpen((prev) => {
      const next = new Set(prev)
      const parts = file.path.split("/").slice(0, -1)
      let p = ""
      for (const part of parts) {
        p = p ? `${p}/${part}` : part
        next.add(p)
      }
      return next
    })
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [jumpTo, files])

  const openFile = (file: FileLeaf) => {
    setActive(file)
    setHighlightLine(undefined)
  }

  const toggle = (path: string) =>
    setOpen((prev) => {
      const next = new Set(prev)
      if (next.has(path)) next.delete(path)
      else next.add(path)
      return next
    })

  // While searching, show every matching folder expanded.
  const allFolders = React.useMemo(() => {
    const out = new Set<string>()
    const walk = (ns: FileNode[]) => ns.forEach((n) => n.type === "folder" && (out.add(n.path), walk(n.children)))
    walk(visible)
    return out
  }, [visible])

  return (
    <div className="@container flex h-full min-h-0">
      <aside
        className={cn("w-40 shrink-0 flex-col border-r border-border bg-background @xl:w-52", treeOpen ? "flex" : "hidden")}
        aria-label="Files"
      >
        <div className="flex h-10 shrink-0 items-center justify-between px-3">
          <p className="text-xs font-medium tracking-wide text-muted-foreground uppercase">Files</p>
          <span className="text-xs text-muted-foreground tabular-nums">{files.length}</span>
        </div>
        <div className="px-2 pb-2">
          <label className="relative block">
            <Search className="pointer-events-none absolute top-1/2 left-2 size-3.5 -translate-y-1/2 text-muted-foreground" />
            <input
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="Search files"
              aria-label="Search files"
              className="h-7 w-full rounded-md border border-border bg-background pr-2 pl-7 text-xs outline-none placeholder:text-muted-foreground focus:border-primary/40 focus:ring-3 focus:ring-primary/15"
            />
          </label>
        </div>
        <ul role="tree" className="min-h-0 flex-1 overflow-y-auto px-1.5 pb-3">
          {visible.map((n) => (
            <TreeItem
              key={n.path}
              node={n}
              depth={0}
              activePath={active?.path ?? ""}
              open={searching ? allFolders : open}
              onToggle={toggle}
              onOpenFile={openFile}
            />
          ))}
          {visible.length === 0 && <li className="px-2 py-4 text-center text-xs text-muted-foreground">No matching files</li>}
        </ul>
      </aside>

      <div className="flex min-w-0 flex-1 flex-col">
        {active ? (
          <>
            <div className="flex h-10 shrink-0 items-center gap-2 border-b border-border pr-3 pl-1.5">
              <Button
                variant="ghost"
                size="icon-sm"
                className="text-muted-foreground"
                aria-label={treeOpen ? "Hide files" : "Show files"}
                aria-pressed={treeOpen}
                title={treeOpen ? "Hide files" : "Show files"}
                onClick={() => setTreeOpen((o) => !o)}
              >
                <PanelLeft />
              </Button>
              <p className="min-w-0 flex-1 truncate font-mono text-xs text-muted-foreground">
                {active.path.split("/").map((part, i, arr) => (
                  <React.Fragment key={i}>
                    {i > 0 && <span className="mx-1 text-foreground/25">/</span>}
                    <span className={cn(i === arr.length - 1 && "text-foreground")}>{part}</span>
                  </React.Fragment>
                ))}
              </p>
              <div className="flex shrink-0 items-center gap-2">
                <OwnerBadge owner={active.owner} className="hidden @2xl:inline" />
                <span className="hidden rounded-md bg-muted px-1.5 py-0.5 text-[11px] font-medium text-muted-foreground @2xl:inline">Read-only</span>
                <CodeBlockCopyButton value={active.content} size="icon-sm" />
              </div>
            </div>
            {active.owner !== "app" && (
              <p className="shrink-0 border-b border-border bg-muted/40 px-3 py-1.5 text-xs text-muted-foreground">
                Generated from the app&apos;s structure{active.owner === "platform" ? " and configuration" : ""}; the AI never writes this file.
              </p>
            )}
            <div className="min-h-0 flex-1">
              <CodeViewer key={active.path} file={active} highlightLine={highlightLine} />
            </div>
          </>
        ) : (
          <div className="flex flex-1 items-center justify-center text-sm text-muted-foreground">Select a file</div>
        )}
      </div>
    </div>
  )
}
