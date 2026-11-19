// Canvas inline edits (Phase 8, item 3): turns a tap-to-select text/style
// edit into a source change, by rewriting the JSX element's source text
// directly (not re-emitting from the AST, so everything else in the file
// stays byte-for-byte the same). No model call: the result still goes
// through the full change gateway (lib/verify/pipeline.ts) before it's kept.

import ts from "typescript"

import { THEME_COLOR_KEYS } from "@/lib/app-runtime/theme"
import type { ElementEdit } from "@/lib/preview/protocol"

/** Style properties the inline editor may write into source (the key is written as code, so it's a closed list). */
export const EDITABLE_STYLE_KEYS: ReadonlySet<string> = new Set([
  "color", "backgroundColor", "fontSize", "fontWeight", "fontStyle", "textAlign", "lineHeight", "letterSpacing", "textDecorationLine",
  "borderRadius", "borderWidth", "borderColor", "borderStyle", "opacity", "width", "height", "gap",
  "padding", "paddingTop", "paddingRight", "paddingBottom", "paddingLeft",
  "margin", "marginTop", "marginRight", "marginBottom", "marginLeft",
  "flexDirection", "justifyContent", "alignItems", "flexWrap", "alignSelf", "flexGrow", "overflow",
  "borderTopLeftRadius", "borderTopRightRadius", "borderBottomLeftRadius", "borderBottomRightRadius",
  "shadowColor", "shadowOffset", "shadowOpacity", "shadowRadius", "elevation",
])

/** Properties whose value may be a theme color: written as `theme.colors.<token>`. */
const COLOR_KEYS: ReadonlySet<string> = new Set(["color", "backgroundColor", "borderColor", "shadowColor"])
const TOKENS: ReadonlySet<string> = new Set(THEME_COLOR_KEYS)

/** Written as bare numbers: React Native takes no units. */
const RN_NUMERIC_KEYS: ReadonlySet<string> = new Set([
  "fontSize", "borderRadius", "borderWidth", "lineHeight", "letterSpacing", "opacity", "gap",
  "flexGrow", "shadowOpacity", "shadowRadius", "elevation",
  "borderTopLeftRadius", "borderTopRightRadius", "borderBottomLeftRadius", "borderBottomRightRadius",
  "padding", "paddingTop", "paddingRight", "paddingBottom", "paddingLeft",
  "margin", "marginTop", "marginRight", "marginBottom", "marginLeft",
])

export type EidTarget = { file: string; line: number; tag: string }

/** "app/(tabs)/home.tsx:42:Text" -> { file, line: 42, tag: "Text" } (preview-runtime/modules.ts makeJsx). */
export function parseEid(eid: string): EidTarget | null {
  const m = /^(.*):(\d+):([^:]+)$/.exec(eid)
  if (!m) return null
  return { file: m[1], line: Number(m[2]), tag: m[3] }
}

type Span = { start: number; end: number; text: string }
type JsxNode = ts.JsxElement | ts.JsxSelfClosingElement

/** JSX text as React renders it: lines trimmed, blank lines dropped, joined with a space. */
function jsxTextValue(raw: string): string {
  if (!raw.includes("\n")) return raw
  return raw
    .split(/\r?\n/)
    .map((l) => l.trim())
    .filter(Boolean)
    .join(" ")
}

/** `text` as JSX child text: written bare when that's safe, else as a {"..."} expression. */
function jsxChild(text: string): string {
  return /[{}<>\n]/.test(text) || text !== text.trim() ? `{${JSON.stringify(text)}}` : text
}

/** `text` as a JSX attribute value. */
function jsxAttr(text: string): string {
  return /["\\\n]/.test(text) ? `{${JSON.stringify(text)}}` : `"${text}"`
}

const stringOf = (e: ts.Expression | undefined): string | null =>
  e && (ts.isStringLiteral(e) || ts.isNoSubstitutionTemplateLiteral(e)) ? e.text : null

/**
 * Where an element's visible text lives in the source, and how to replace
 * it: its one literal child, or (a kit component like <Button label="Save" />)
 * the string prop whose value is the text shown. Null when the text is
 * dynamic or can't be told apart.
 */
function textSpan(sf: ts.SourceFile, node: JsxNode, from: string | undefined, text: string): { span: Span; current: string } | null {
  if (ts.isJsxElement(node)) {
    const kids = node.children.filter((c) => !(ts.isJsxText(c) && c.containsOnlyTriviaWhiteSpaces))
    if (kids.length === 1 && ts.isJsxText(kids[0])) {
      // Keep the surrounding whitespace/newlines: the line count must not change.
      const raw = kids[0].text
      const lead = raw.length - raw.trimStart().length
      const trail = raw.length - raw.trimEnd().length
      const start = kids[0].pos + lead
      return { span: { start, end: start + raw.trim().length, text: jsxChild(text) }, current: jsxTextValue(raw) }
    }
    if (kids.length === 1 && ts.isJsxExpression(kids[0])) {
      const value = stringOf(kids[0].expression)
      if (value !== null) return { span: { start: kids[0].getStart(sf), end: kids[0].getEnd(), text: `{${JSON.stringify(text)}}` }, current: value }
    }
    if (!kids.length && !from) {
      const at = node.openingElement.getEnd()
      return { span: { start: at, end: at, text: jsxChild(text) }, current: "" }
    }
    if (kids.length) return null
  }
  if (from === undefined) return null
  const opening = ts.isJsxElement(node) ? node.openingElement : node
  const matches: Span[] = []
  for (const p of opening.attributes.properties) {
    if (!ts.isJsxAttribute(p) || !p.initializer) continue
    const init = p.initializer
    const value = ts.isStringLiteral(init) ? init.text : ts.isJsxExpression(init) ? stringOf(init.expression) : null
    if (value !== null && value.trim() === from.trim()) matches.push({ start: init.getStart(sf), end: init.getEnd(), text: jsxAttr(text) })
  }
  return matches.length === 1 ? { span: matches[0], current: from } : null
}

/**
 * How to reach the theme from this element's code: the variable a component
 * already holds `useTheme()` in, or one added on the same line as the
 * component's opening brace (line numbers must not move: every element id is
 * a line number). Null when there's no safe way (no useTheme import, a class
 * component...), and the caller writes the color's hex instead.
 */
function themeAccess(sf: ts.SourceFile, node: ts.Node, code: string): { name: string; insert?: Span } | null {
  let fn: ts.FunctionDeclaration | ts.FunctionExpression | ts.ArrowFunction | ts.MethodDeclaration | undefined
  for (let n: ts.Node | undefined = node; n; n = n.parent) if (ts.isFunctionDeclaration(n) || ts.isFunctionExpression(n) || ts.isArrowFunction(n) || ts.isMethodDeclaration(n)) fn = n as typeof fn
  // A class component's method can't hold a hook.
  if (!fn || ts.isMethodDeclaration(fn) || !fn.body || !ts.isBlock(fn.body)) return null
  for (const st of fn.body.statements) {
    if (!ts.isVariableStatement(st)) continue
    for (const d of st.declarationList.declarations) {
      const call = d.initializer
      if (ts.isIdentifier(d.name) && call && ts.isCallExpression(call) && ts.isIdentifier(call.expression) && call.expression.text === "useTheme") return { name: d.name.text }
    }
  }
  let local: string | null = null
  for (const st of sf.statements) {
    if (!ts.isImportDeclaration(st) || !ts.isStringLiteral(st.moduleSpecifier) || st.moduleSpecifier.text !== "@/theme") continue
    const named = st.importClause?.namedBindings
    if (named && ts.isNamedImports(named)) for (const e of named.elements) if ((e.propertyName ?? e.name).text === "useTheme") local = e.name.text
  }
  if (!local) return null
  const body = code.replace(/^import .*$/gm, "")
  const name = !/\btheme\b/.test(body) ? "theme" : !/\bappTheme\b/.test(body) ? "appTheme" : null
  if (!name) return null
  const at = fn.body.getStart(sf) + 1
  return { name, insert: { start: at, end: at, text: ` const ${name} = ${local}();` } }
}

export type CodemodResult = { code: string } | { error: string }

/**
 * Rewrites the JSX element at `target.line` (1-indexed, the line its opening
 * tag starts on) whose tag name is `target.tag`. Returns the new file
 * content, or why the edit can't be applied there safely (e.g. a text edit
 * on an element whose text is dynamic, or several matching elements on that
 * line that can't be told apart). Never edits a different element than the
 * one meant: when in doubt, it refuses.
 */
export function applyElementEdit(
  code: string,
  target: Omit<EidTarget, "file">,
  edit: Pick<ElementEdit, "text" | "style" | "from" | "imageSrc">
): CodemodResult {
  const sf = ts.createSourceFile("file.tsx", code, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX)

  const onLine: JsxNode[] = []
  const visit = (node: ts.Node) => {
    if (ts.isJsxElement(node) || ts.isJsxSelfClosingElement(node)) {
      const opening = ts.isJsxElement(node) ? node.openingElement : node
      if (sf.getLineAndCharacterOfPosition(opening.getStart(sf)).line + 1 === target.line) onLine.push(node)
    }
    ts.forEachChild(node, visit)
  }
  visit(sf)
  const tagOf = (n: JsxNode) => (ts.isJsxElement(n) ? n.openingElement : n).tagName.getText(sf)
  // The runtime name can differ from the source tag (an import alias, a
  // forwardRef's displayName), so a lone element on the line still counts,
  // but only for a text-only edit, which the `from` check below verifies.
  let candidates = onLine.filter((n) => tagOf(n) === target.tag || tagOf(n).split(".").pop() === target.tag)
  if (!candidates.length && onLine.length === 1 && (edit.from !== undefined || edit.imageSrc !== undefined) && !edit.style) candidates = onLine
  if (!candidates.length && edit.imageSrc !== undefined) candidates = onLine.filter((n) => /image/i.test(tagOf(n)))
  if (!candidates.length) return { error: "That element has moved in the code. Tap it again." }

  if (candidates.length > 1 && edit.imageSrc !== undefined) {
    const imgs = candidates.filter((n) => /image/i.test(tagOf(n)))
    if (imgs.length === 1) candidates = imgs
  }

  const wantsText = edit.text !== undefined
  if (candidates.length > 1 && wantsText && edit.from !== undefined) {
    const from = edit.from.trim()
    candidates = candidates.filter((n) => textSpan(sf, n, edit.from, edit.text!)?.current.trim() === from)
  }
  if (candidates.length !== 1) return { error: "Several elements share that line in the code, so this one can't be edited here. Ask in chat instead." }
  const found = candidates[0]

  const opening = ts.isJsxElement(found) ? found.openingElement : found
  const spans: Span[] = []

  if (wantsText) {
    const t = textSpan(sf, found, edit.from, edit.text!)
    if (!t || (edit.from !== undefined && t.current.trim() !== edit.from.trim())) {
      return { error: "That text comes from data or code, not a fixed string, so it can't be edited here. Ask in chat instead." }
    }
    spans.push(t.span)
  }

  if (edit.imageSrc !== undefined) {
    const srcLiteral = JSON.stringify(edit.imageSrc)
    const sourceAttr = opening.attributes.properties.find(
      (p): p is ts.JsxAttribute =>
        ts.isJsxAttribute(p) && (p.name.getText(sf) === "source" || p.name.getText(sf) === "src")
    )

    if (sourceAttr) {
      if (sourceAttr.name.getText(sf) === "src") {
        if (sourceAttr.initializer) {
          spans.push({ start: sourceAttr.initializer.getStart(sf), end: sourceAttr.initializer.getEnd(), text: srcLiteral })
        } else {
          spans.push({ start: sourceAttr.getStart(sf), end: sourceAttr.getEnd(), text: `src=${srcLiteral}` })
        }
      } else {
        const init = sourceAttr.initializer
        if (init && ts.isJsxExpression(init) && init.expression && ts.isObjectLiteralExpression(init.expression)) {
          const uriProp = init.expression.properties.find(
            (pr): pr is ts.PropertyAssignment =>
              ts.isPropertyAssignment(pr) && (pr.name.getText(sf) === "uri" || (ts.isIdentifier(pr.name) && pr.name.text === "uri"))
          )
          if (uriProp) {
            spans.push({ start: uriProp.initializer.getStart(sf), end: uriProp.initializer.getEnd(), text: srcLiteral })
          } else {
            spans.push({ start: init.getStart(sf), end: init.getEnd(), text: `{{ uri: ${srcLiteral} }}` })
          }
        } else if (init) {
          spans.push({ start: init.getStart(sf), end: init.getEnd(), text: `{{ uri: ${srcLiteral} }}` })
        } else {
          spans.push({ start: sourceAttr.getStart(sf), end: sourceAttr.getEnd(), text: `source={{ uri: ${srcLiteral} }}` })
        }
      }
    } else {
      spans.push({ start: opening.tagName.getEnd(), end: opening.tagName.getEnd(), text: ` source={{ uri: ${srcLiteral} }}` })
    }
  }

  if (edit.style && Object.keys(edit.style).length) {
    const bad = Object.keys(edit.style).find((k) => !EDITABLE_STYLE_KEYS.has(k))
    if (bad) return { error: `"${bad}" can't be edited here.` }
    // React Native expects a bare number (no unit) for these; everything
    // else (colors, fontWeight, textAlign...) is a string, same as the DOM
    // CSS value the inspector read it from.
    let theme: ReturnType<typeof themeAccess> | undefined
    const literal = (k: string, v: string): string => {
      // "theme:<token>:<hex>": follows the app's theme when it can be reached, else the hex as of now.
      const tok = /^theme:([A-Za-z]+):(#[0-9a-fA-F]{3,8})$/.exec(v)
      if (tok && COLOR_KEYS.has(k) && TOKENS.has(tok[1])) {
        theme ??= themeAccess(sf, found, code)
        if (!theme) return JSON.stringify(tok[2])
        if (theme.insert && !spans.includes(theme.insert)) spans.push(theme.insert)
        return `${theme.name}.colors.${tok[1]}`
      }
      if (k === "shadowOffset") {
        const m = /^(-?\d+(?:\.\d+)?),\s*(-?\d+(?:\.\d+)?)$/.exec(v.trim())
        return m ? `{ width: ${Number(m[1])}, height: ${Number(m[2])} }` : "{ width: 0, height: 0 }"
      }
      if (RN_NUMERIC_KEYS.has(k) || ((k === "width" || k === "height") && /^-?\d+(\.\d+)?px$/.test(v.trim()))) {
        if (/^-?\d+(\.\d+)?(px)?$/.test(v.trim())) return String(parseFloat(v))
      }
      return JSON.stringify(v)
    }
    const newProps = Object.entries(edit.style).map(([k, v]) => `${k}: ${literal(k, v)}`)
    const styleAttr = opening.attributes.properties.find((p): p is ts.JsxAttribute => ts.isJsxAttribute(p) && p.name.getText(sf) === "style")

    if (!styleAttr) {
      spans.push({ start: opening.tagName.getEnd(), end: opening.tagName.getEnd(), text: ` style={{ ${newProps.join(", ")} }}` })
    } else {
      const init = styleAttr.initializer
      if (!init || !ts.isJsxExpression(init) || !init.expression) return { error: "Couldn't change that element's style." }
      const expr = init.expression
      if (ts.isObjectLiteralExpression(expr)) {
        const existing = new Map(expr.properties.filter(ts.isPropertyAssignment).map((p) => [p.name.getText(sf), p]))
        const toAppend: string[] = []
        for (const [k, v] of Object.entries(edit.style)) {
          const prop = existing.get(k)
          if (prop) spans.push({ start: prop.initializer.getStart(sf), end: prop.initializer.getEnd(), text: literal(k, v) })
          else toAppend.push(`${k}: ${literal(k, v)}`)
        }
        if (toAppend.length) {
          // Right after the last property (so a trailing comma stays valid), or inside an empty {}.
          const last = expr.properties[expr.properties.length - 1]
          if (last) spans.push({ start: last.getEnd(), end: last.getEnd(), text: `, ${toAppend.join(", ")}` })
          else spans.push({ start: expr.getEnd() - 1, end: expr.getEnd() - 1, text: ` ${toAppend.join(", ")} ` })
        }
      } else {
        // style={styles.foo} (or any other expression): wrap it in an array
        // so the override always wins without needing to understand what it
        // referenced. React Native accepts an array of styles.
        spans.push({ start: expr.getStart(sf), end: expr.getEnd(), text: `[${expr.getText(sf)}, { ${newProps.join(", ")} }]` })
      }
    }
  }

  if (!spans.length) return { error: "Nothing to change." }
  spans.sort((a, b) => b.start - a.start)
  let out = code
  for (const s of spans) out = out.slice(0, s.start) + s.text + out.slice(s.end)
  return { code: out }
}
