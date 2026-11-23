// Only run during the backend-conversion step (agent/backend-conversion.ts),
// never the normal edit loop: that step is only supposed to change how a
// screen gets its data (store reads -> useQuery/useMutation, or back), never
// its look. This gate blocks a reply that also changed the JSX structure or
// a createStyles(...) call of a file the conversion touched, the same way
// the other gates block a reply with a type error -- it goes back through
// the repair loop with a diagnostic explaining what changed.
//
// A real AST (ts.createSourceFile), not a regex over the source text: JSX
// attribute values routinely contain "<", ">" and nested braces (style={{...}})
// that a tag-matching regex would misread.

import ts from "typescript"
import type { Diagnostic, GateResult, Workspace } from "@app/shared/verify/types"

function parse(fileName: string, code: string): ts.SourceFile | null {
  try {
    return ts.createSourceFile(fileName, code, ts.ScriptTarget.ES2022, true, ts.ScriptKind.TSX)
  } catch {
    return null
  }
}

/** Every JSX tag, as "Tag(attr1,attr2,...)" with attributes sorted (order doesn't change the shape), in document order. Attribute *values* are deliberately not part of the signature: a conversion is expected to change what feeds a prop, just not which props or elements exist. */
function jsxSignature(sf: ts.SourceFile): string[] {
  const out: string[] = []
  const visit = (node: ts.Node) => {
    if (ts.isJsxElement(node) || ts.isJsxSelfClosingElement(node)) {
      const opening = ts.isJsxElement(node) ? node.openingElement : node
      const tag = opening.tagName.getText(sf)
      const attrs = opening.attributes.properties
        .map((p) => (ts.isJsxAttribute(p) ? p.name.getText(sf) : "{...spread}"))
        .sort()
      out.push(`${tag}(${attrs.join(",")})`)
    }
    ts.forEachChild(node, visit)
  }
  visit(sf)
  return out
}

/** Every top-level createStyles(...) call's full source, whitespace-normalized, in document order -- these must be byte-for-byte the same, not just shaped the same. */
function stylesSignature(sf: ts.SourceFile, code: string): string[] {
  const out: string[] = []
  const visit = (node: ts.Node) => {
    if (ts.isCallExpression(node) && node.expression.getText(sf) === "createStyles") out.push(code.slice(node.getStart(sf), node.getEnd()).replace(/\s+/g, " ").trim())
    ts.forEachChild(node, visit)
  }
  visit(sf)
  return out
}

export function uiFreezeGate(ws: Workspace, changed: string[] = [], _key?: string, base?: Workspace): GateResult {
  const t0 = performance.now()
  const diagnostics: Diagnostic[] = []
  for (const file of changed) {
    if (!/\.tsx?$/.test(file)) continue
    const prevCode = base?.files[file]
    const nextCode = ws.files[file]
    // A brand-new or deleted file has no "before" to freeze against.
    if (prevCode === undefined || nextCode === undefined) continue
    const prevSf = parse(file, prevCode)
    const nextSf = parse(file, nextCode)
    if (!prevSf || !nextSf) continue // a syntax error here is the parse gate's job, not this one's

    const prevJsx = jsxSignature(prevSf)
    const nextJsx = jsxSignature(nextSf)
    if (JSON.stringify(prevJsx) !== JSON.stringify(nextJsx)) {
      diagnostics.push({
        gate: "uiFreeze",
        code: "jsx_changed",
        severity: "error",
        file,
        message: `This file's JSX structure changed (had ${prevJsx.length} element(s), now ${nextJsx.length}). Only how data is read or written may change here -- keep every element, prop name and nesting exactly as it was.`,
      })
      continue
    }

    const prevStyles = stylesSignature(prevSf, prevCode)
    const nextStyles = stylesSignature(nextSf, nextCode)
    if (JSON.stringify(prevStyles) !== JSON.stringify(nextStyles)) {
      diagnostics.push({
        gate: "uiFreeze",
        code: "styles_changed",
        severity: "error",
        file,
        message: `This file's createStyles(...) changed. Styling must stay exactly as it was -- only how data is read or written may change.`,
      })
    }
  }
  const blocking = diagnostics.filter((d) => d.severity === "error")
  return { gate: "uiFreeze", ok: blocking.length === 0, ms: performance.now() - t0, diagnostics }
}
