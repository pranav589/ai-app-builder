// The backend-conversion step's own prompt: much narrower than the verified
// coder's (agent/prompts.ts, verify/prompts.ts) on purpose. It changes
// exactly one thing -- how a screen reads and writes data -- and the
// uiFreeze gate (verify/gates/ui-freeze.ts) enforces that nothing else did.

import { describeDataModel, type DataModel } from "@app/shared/app-runtime/data-model"

export type ConversionDirection = "connect" | "disconnect"

const REST_ROUTES = `  GET    /collections/:name       -> the collection's records (an array)
  POST   /collections/:name       -> create one; body is its fields, answers the created record
  GET    /collections/:name/:id   -> one record
  PATCH  /collections/:name/:id   -> update it; body is the patch, answers the updated record
  DELETE /collections/:name/:id   -> remove it
  GET    /settings                -> the settings object
  PUT    /settings/:key           -> body { value: ... }
  POST   /auth/sign-up            -> body { name?, email, password } -> { token, user }
  POST   /auth/sign-in            -> body { email, password } -> { token, user } (the session is stored for you automatically)
  POST   /auth/sign-out           -> no body
  POST   /auth/reset-password     -> body { email }
  GET    /auth/me                 -> the signed-in user, or null
  POST   /uploads                 -> body { dataUrl } -> { url }`

export const CONVERSION_INSTRUCTIONS = `You are a precise React Native/Expo engineer doing exactly one job: change HOW a screen's data gets read and written, without changing anything else about it -- not a prop, not a style, not an element, not its behavior otherwise. A verifier checks your reply before anyone sees it, and one of its checks (on top of the usual syntax/type/import checks) is that every file you touch has the EXACT SAME JSX structure and the EXACT SAME createStyles(...) call as before -- only expressions, hooks and imports may differ. Reordering, adding or removing an element, a prop, or a style value fails that check and you get the diagnostics back for one more try.

# Reply format (strict) -- identical to any other change
<intent>One short sentence.</intent>
<edit path="app/(tabs)/home.tsx">
<<<<<<< SEARCH
exact lines copied from the current file
=======
the new lines
>>>>>>> REPLACE
</edit>
<file path="stores/useTasksStore.ts">
...the whole file...
</file>
<delete path="stores/useTasksStore.ts"/>

Rules:
- SEARCH must copy lines from the current file exactly, including indentation, and match the file exactly once. Never abbreviate with "...".
- Use <edit> for a small change; use <file> for a new file or a change big enough to touch most of it.
- Never use <manifest_patch> or <question>: this is always a mechanical rewrite, never a new screen or a question for the user.
- Reply with ONLY these blocks, no prose outside them.

TypeScript strict mode; function components and hooks only; keep every other import, type and helper exactly as it was unless it's part of the rewrite.`

function connectPrompt(targets: { path: string; code: string }[], data: DataModel): string {
  return `Connect this app's data to its backend. For every file below that currently reads or writes a Zustand store (or local useState backed by one):
- Replace the store read with a React Query "useQuery" call against the matching REST route (see below), using "api" from "@/lib/api": const { data, isPending } = useQuery({ queryKey: [...], queryFn: () => api.get("/collections/<name>").then((r) => r.data) }).
- Replace an insert/update/remove with a "useMutation" (also from "@tanstack/react-query"), calling the matching api.post/patch/delete, and invalidate the query it affects in onSuccess with useQueryClient(). Use other React Query features (select, enabled, optimistic updates) wherever they genuinely fit, not just the minimum.
- A screen that still needs a loading state should use the query's own "isPending" instead of a Zustand "hydrated" flag.
- Once every file importing a given store under "stores/" has been converted, delete that store file with <delete>. Keep a store that's genuinely UI-only (not generated app data) exactly as it is -- this step only converts data access.
- Import "api" (and "getApiErrorMessage" if a file already shows errors) from "@/lib/api"; it already exists and is configured, don't rewrite it.

REST routes (the axios instance "api" already has the right base URL and app key):
${REST_ROUTES}

Data model (collection names and fields to use in the routes above):
${describeDataModel(data)}

Files to convert:
${targets.map((f) => `<current path="${f.path}">\n${f.code.trimEnd()}\n</current>`).join("\n\n")}

Return the change now.`
}

function disconnectPrompt(targets: { path: string; code: string }[], data: DataModel): string {
  return `This app's backend was just disconnected. For every file below that currently calls "api" (from "@/lib/api") with useQuery/useMutation:
- Replace each useQuery read with a Zustand store instead: create (or reuse) a store under "stores/<name>Store.ts" (create<Store>()(persist((set, get) => ({...}), { name: "<name>", storage: createJSONStorage(() => AsyncStorage) }))), seeded from "@/data/seed.json", typed from "@/data/types". If more than one file in this batch needs the same collection, write that store once and have every file import it, not one copy each.
- Replace each useMutation write with a call to that store's own insert/update/remove action (defined on the store itself, not a separate hook).
- A screen whose data is only ever read by that one screen can use plain useState seeded from the store instead of reading the store directly, if that's simpler and doesn't need writes elsewhere.
- Remove the "@/lib/api"/"@tanstack/react-query" imports from every file you convert.

Data model (collection names, fields and seed data to use):
${describeDataModel(data)}

Files to convert:
${targets.map((f) => `<current path="${f.path}">\n${f.code.trimEnd()}\n</current>`).join("\n\n")}

Return the change now.`
}

export function conversionPrompt(direction: ConversionDirection, targets: { path: string; code: string }[], data: DataModel): string {
  return direction === "connect" ? connectPrompt(targets, data) : disconnectPrompt(targets, data)
}
