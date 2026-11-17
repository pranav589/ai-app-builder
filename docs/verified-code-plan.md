# Verified-Code Engine: Implementation Plan

For the coding agent implementing this in this repository. Read the whole document before
starting Phase 0. Work one phase at a time, stop after each phase, and report using the
template in [Reporting after each phase](#reporting-after-each-phase). Do not start the next
phase until the user says so.

## 1. What we are building and why

Today the AI writes whole React Native screens and the platform accepts them after a few
regex checks (`lib/app-project/project.ts` `checkFile`) and a name check that runs TypeScript
with `noResolve` (`lib/app-project/analyze.ts`). Broken code reaches the preview often, small
edits rewrite whole screens, repair can loop, and new screens sometimes don't appear.

The decided architecture ("verified code"):

1. **Code stays the source of truth for screens.** The AI keeps writing real TSX. Users see it
   in the Code tab. We do **not** move to a JSON spec for screens.
2. **Structure is declared.** Navigation, routes, the data model, theme and allowed packages
   live in an **app manifest**. A deterministic **compiler** writes the files that hold the
   app together (layouts, typed navigation, typed data access, theme). The AI cannot write
   those files.
3. **Nothing unverified reaches the user.** Every model output is a **ChangeSet**. A change
   gateway applies it to a copy of the project and runs gates, cheapest first:
   parse, policy, real type check, render smoke test. Only a passing change is committed.
4. **Every change is a transaction and a version.** A commit creates a **snapshot**. Undo is
   moving the project's head to an earlier snapshot.
5. **Repair is bounded.** At most 3 repair rounds per run, fed with structured diagnostics.
   Then the agent stops and asks the user. The app stays exactly as it was.
6. **Providers are swappable.** Model, backend and preview sit behind small interfaces.

A proof of concept in `poc/verified-code/` validated this end to end. Results with
`anthropic/claude-haiku-5.5` on 28 tasks: 96% passed on the first attempt, 100% were verified
within one repair round, median 7 s to a verified change, gates under 2 s. Ten stacked changes
grew an app from 4 to 10 screens with every step committed. The exported app bundled with real
Metro and ran on a real phone in Expo Go. The bug class today's checks miss most often was an
unchecked `null` (`habit.data.title` when the record doesn't exist), which the real type check
caught every time.

**Reuse the POC.** Each phase names the POC files to port. Port the ideas and code, adapting
them to this app's structure (Expo Router file routing, `@/theme`, `@/lib/backend`, the preview
runtime, Postgres). Do not import from `poc/` at runtime; copy what you need into `lib/`.

## 2. Ground rules for the implementing agent

- **Read `AGENTS.md` first.** This is Next.js 16 with breaking changes; check
  `node_modules/next/dist/docs/` before writing Next.js code.
- **Feature flag.** All new behavior runs only when `projects.engine = 'verified'`. The
  current pipeline (`engine = 'legacy'`, the default) must keep working unchanged until
  Phase 11. Exceptions are called out explicitly (Phase 1 snapshots and the Phase 2 repair
  cap apply to both engines because they only make the legacy engine safer).
- **No deletions of the legacy engine** without the user's explicit confirmation (Phase 11).
- **Database changes** follow the existing convention: SQL files in `db/sql/` applied with
  `npm run db:sql`, plus matching Drizzle table definitions in `db/schema.ts`. The `projects`
  and `messages` tables are not managed by drizzle-kit; never run `db:push` against them.
  Every SQL file must be safe to run more than once (`if not exists`).
- **The AI gateway** (`AI_BASE_URL`) is OpenAI-compatible and does not pass tool calls
  through. Keep the tagged-block reply protocol (like `<plan>`, `<edit>`); parse with Zod.
- **Determinism.** The compiler and gates are pure functions of their inputs: no timestamps,
  random ids or unordered iteration in generated files.
- **Model output is untrusted.** It only ever becomes a ChangeSet. No model output may write
  files, run commands or fetch URLs.
- **Tests.** Every phase adds tests (Vitest, added in Phase 0). `npm test` and
  `npx tsc --noEmit` must pass at the end of every phase.
- **Git.** The repository has no commits yet. In Phase 0, ask the user before making the
  first commit. After that, work on a branch `feat/verified-code` with at least one commit
  per phase. Check `git status` before committing and never commit `.env` or anything with
  secrets.
- **Stop and ask** when a phase needs a product decision not covered here, when an existing
  feature has no equivalent in the new design, or when a step would change user-visible
  behavior of the legacy engine.
- **Debug switches for testing.** Phases 2 to 5 add environment switches that force failures
  so the user can test failure paths. They must be ignored when `NODE_ENV === "production"`.

## 3. Vocabulary and core contracts

Put shared types in `lib/verify/types.ts` (server and browser safe, no Node imports).

```ts
export type FileMap = Record<string, string>

/** The project as the engine sees it: manifest (from Phase 6) and every file. */
export interface Workspace {
  manifest?: AppManifest      // undefined until Phase 6; legacy projects use AppPlan + AppDoc
  files: FileMap              // screens, components, platform files, generated files
}

export type FileChange =
  | { path: string; op: "write"; content: string }
  | { path: string; op: "edit"; hunks: { search: string; replace: string }[] }
  | { path: string; op: "delete" }

/** The only thing a model produces. */
export interface ChangeSet {
  intent: string
  manifestPatch: JsonPatchOp[]   // RFC 6902 subset; empty until Phase 6
  files: FileChange[]
}

export type GateName = "manifest" | "parse" | "policy" | "tsc" | "render" | "bundle"

export interface Diagnostic {
  gate: GateName
  code: string                   // "TS2322", "import_not_allowed", "render_error", ...
  message: string                // readable by people and models
  severity: "error" | "warning"  // only errors block
  file?: string; line?: number; column?: number
  related?: { file: string; line: number; text: string }[]  // e.g. the props type violated
}

export interface GateResult { gate: GateName; ok: boolean; ms: number; diagnostics: Diagnostic[] }

export type RunState =
  | "received" | "routed" | "planned" | "writing" | "verifying"
  | "repairing" | "committed" | "answered" | "needs_user" | "failed"
```

File ownership (enforced by the policy gate from Phase 2, extended in Phase 6):

| Owner | Paths | Who may write |
|---|---|---|
| Platform | `theme/index.tsx`, `theme/themes.json`, `lib/backend/index.ts`, `data/seed.json`, `data/schema.json`, `package.json`, `app.json`, `tsconfig.json`; from Phase 7 also `kit/**` | Platform code only |
| Compiler (Phase 6) | `app/_layout.tsx`, group `_layout.tsx` files, `app/index.tsx`, `lib/nav.ts`, `data/types.ts` | Manifest compiler only |
| App | Screen files under `app/`, `components/**`, `lib/**` except the above | AI and user, through gates |

## 4. Phases

Each phase lists: goal, work, POC references, done-when checks (automated), and what the user
tests by hand. Keep phases small; if a phase grows past what is described, stop and ask.

---

### Phase 0: Baseline and guardrails (no behavior change)

**Goal.** A safe starting point: version control, a test runner, the feature flag, and
per-role model configuration. The app behaves exactly as before.

**Work.**
1. Ask the user to confirm the first commit. Before committing, check that `.gitignore`
   covers `.env`, `poc/verified-code/node_modules/`, `poc/verified-code/.data/`, `.next/`,
   `public/preview/`. Commit everything else as the baseline on the default branch, then create
   `feat/verified-code`.
2. Add Vitest (`vitest` dev dependency, `vitest.config.ts` resolving the `@/*` alias, script
   `"test": "vitest run"`). Exclude `poc/` from the test glob.
3. First tests, covering existing behavior that later phases must not break:
   `lib/agent/protocol.ts` (`parsePlannerReply`, `parseEditTag`, `TagStreamFilter`),
   `lib/app-project/patch.ts` (`parseEdits`, `applyHunks`), `lib/app-project/project.ts`
   (`checkFile`, `autoImport`, `screenPath`).
4. Feature flag. Add `lib/verify/engine.ts`:
   `export type Engine = "legacy" | "verified"`, `engineOf(project)`, and
   `DEFAULT_ENGINE` from env (default `"legacy"`). New projects created in
   `app/api/projects/route.ts` get `engine = DEFAULT_ENGINE`. Add a dev-only way to flip a
   project's engine (a small script `scripts/set-engine.mjs <projectId> <engine>` using
   `--env-file=.env`).
5. Model roles. In `lib/agent/config.ts` add `getCoderModel()` reading `AI_MODEL_CODER`
   (falls back to `AI_MODEL`) next to `getModel()` and `getFastModel()`. Use it only in the
   verified engine (later phases). Document `AI_MODEL_CODER`, `DEFAULT_ENGINE` in
   `.env.example`. Recommended values from the POC: `AI_MODEL_FAST` and `AI_MODEL_CODER` =
   `anthropic/claude-haiku-5.5`.

**Done when.** `npm test` passes; `npx tsc --noEmit` passes; `npm run build` passes;
nothing in the legacy flow changed (diff touches only new files, config, tests, `.env.example`,
project creation default).

**User tests.**
1. `npm run dev`, create an app from a prompt, approve the plan, wait for the build, make one
   chat edit. Everything should work exactly as before.
2. Run `npm test` and see it pass.

---

### Phase 1: Snapshots, transactions and undo (both engines)

**Goal.** Every completed run creates a version. A failed or partial run never replaces a
working screen. The user can restore any earlier version.

**Work.**
1. SQL `db/sql/snapshots.sql` and Drizzle definition:
   `app_snapshots(id text pk, project_id fk cascade, version int, parent_version int null,
   doc jsonb not null, author text, intent text, run_id text null, verified jsonb null,
   created_at timestamptz default now())`, unique `(project_id, version)`.
   `doc` stores the full `AppDoc` (`lib/app-runtime/app-doc.ts`); docs are small, so no blob
   store yet. Keep the newest 50 snapshots per project; prune older ones on commit.
2. Use the existing `projects.current_version` column as the head pointer (it exists and is
   unused). `projects.preview_screens` stays the working copy the UI and preview read, so no
   reader has to change: head and working copy are always written together.
3. `lib/versions/store.ts`: `commitSnapshot(projectId, doc, { author, intent, runId })`
   (inserts version = max+1, sets `current_version`, writes `preview_screens`, in one
   transaction), `listSnapshots(projectId)`, `restoreSnapshot(projectId, version)` (copies that
   doc into `preview_screens`, creates a new snapshot "Restored version N" on top, so history
   is never rewritten), `getSnapshot`.
4. Call `commitSnapshot` once at the end of `runGeneration` and `runEdit` and after a
   successful `repairFile` (`lib/agent/orchestrator.ts`), replacing their final `saveDoc` /
   `saveScreens` write for the finished doc. Intermediate progress saves during a build stay as
   they are (they update the working copy for live progress). Initial snapshot: when a project
   with screens has `current_version = 0`, commit its current doc as version 1 lazily on the
   next run.
5. Generation guard: in `runGeneration`, when a screen that was `ready` before the run fails to
   regenerate, keep its previous code and state (today it becomes `error`). Report it in the
   summary message as "kept the previous version of X".
6. API (same auth pattern as other project routes): `GET /api/projects/[projectId]/versions`
   → `{ current, versions: [{ version, intent, author, createdAt }] }`;
   `POST /api/projects/[projectId]/versions/[version]/restore` → `{ version }`. Restore is
   refused with 409 while a run is active (`activeRun`).
7. UI: a "Versions" menu in `components/workspace/workspace-header.tsx` listing versions with
   their intent and time, marking the current one, with "Restore". After restore, refresh the
   workspace state (screens, files, themes, data) from the response or a reload of
   `preview_screens`. Each assistant message that produced a version shows a small
   "Version N" label.

**Tests.** Store functions against a mocked db layer or pure helpers (version numbering,
pruning selection); restore creates a new version on top; generation guard keeps a ready
screen.

**Done when.** Tests pass; versions appear after each build/edit; restore works and survives
a page reload.

**User tests.**
1. Create an app and let it build. Open Versions: version 1 exists.
2. Make two chat edits. Versions shows 3 entries with the edit descriptions.
3. Restore version 1. Canvas, preview and Code tab show the original app. Reload the page:
   still version 1 content, and Versions now shows a 4th entry "Restored version 1".
4. Make a new edit after restoring: it applies on top of the restored app.
5. Try Restore while a build is running: it is refused with a clear message.

---

### Phase 2: Change gateway, bounded repair and quieter events (verified engine)

**Goal.** In the verified engine, edits go through ChangeSet → apply → gates → commit or
reject, with at most 3 repair rounds. Repair can no longer loop in either engine. The event
stream stops sending the same status every second.

**Work.**
1. `lib/verify/`:
   - `types.ts` (Section 3).
   - `workspace.ts`: `workspaceFromDoc(doc)` (screens' code + `doc.files` into one `FileMap`),
     `docFromWorkspace(doc, ws)` (writes back screen code by path and other files),
     `applyChangeSet(ws, cs)` returning `{ ws?, changed, diagnostics }` (port
     `poc/verified-code/src/core/workspace.ts` `applyChangeSet` and its `locate` matcher).
   - `ownership.ts`: `isPlatformOwned(path)`, `isAppOwned(path)` per Section 3.
   - `gates/parse.ts`, `gates/policy.ts`: port `checkFile` into structured diagnostics:
     syntax (Sucrase) → `parse`; imports outside `ALLOWED_PACKAGES`/unresolved project
     imports, writes to platform-owned paths, missing default export in route files,
     literal colors, raw `fetch`/`XMLHttpRequest`/`WebSocket`/`eval`, file over 300 lines →
     `policy`. Reference: `poc/verified-code/src/gates/parse-policy.ts`.
   - `pipeline.ts`: `verifyChange(base, cs)` runs gates in order and stops at the first
     failing gate; a module-level lock serializes verification (render gate state is global).
     `formatDiagnostics(results)` for prompts and logs. Reference:
     `poc/verified-code/src/gates/pipeline.ts`.
2. Reply protocol for the verified engine: `<intent>`, `<file path>`, `<edit path>` with
   SEARCH/REPLACE, `<delete path/>`, `<question>`, and (Phase 6) `<manifest_patch>`. Port
   `poc/verified-code/src/agent/protocol.ts` into `lib/verify/protocol.ts`. A malformed reply
   is a `parse` diagnostic (code `protocol`), not a crash.
3. `lib/verify/run.ts`: the run state machine. Port `poc/verified-code/src/agent/run.ts`:
   write → verify → (repair → verify)×≤3 → `committed` | `needs_user`. The budget belongs to
   the run. Repair prompt = the previous assistant reply + diagnostics + "reply with the
   complete corrected change; it replaces your previous reply". Port `repairPrompt` from
   `poc/verified-code/src/agent/context.ts`.
4. Wire the verified engine into the edit path: in `lib/agent/execute.ts`, when the planner
   returns an `<edit>` and the project is verified, call a new `runVerifiedEdit` that builds a
   Workspace from the AppDoc, runs `lib/verify/run.ts` with the coder model and the existing
   edit context (targets, screens list, data model), and on `committed` writes back with
   `commitSnapshot`. On `needs_user`, post an assistant message that names what failed in
   plain words, and leave the app unchanged. The legacy `runEdit` stays for legacy projects.
   Keep the engine core (`lib/verify/*`) free of DB access; `execute.ts`/orchestrator does
   persistence. Phase 3 depends on this split.
5. Repair cap (both engines, fixes `fixes.txt` #6): server-side, the repair route refuses a
   second repair of the same `(project, current_version, path)` and returns
   `{ fixed: false, reason: "already_tried" }`. Track attempts in memory with a TTL plus the
   client-side cap already in `use-agent.ts` (`MAX_REPAIRS`). Verified projects run repairs
   through the same `lib/verify/run.ts` (the crash message becomes a `render` diagnostic).
6. Quieter events (both engines, fixes `fixes.txt` #3): `heartbeat()` in
   `lib/agent/orchestrator.ts` stops emitting `"<label> · Ns"` every second. Emit a `status`
   event only when the label changes, with a `since` timestamp. The client
   (`use-agent.ts`, chat status line) renders the elapsed seconds itself. Add a `run_state`
   event (`{ type: "run_state", state: RunState, round?: number }`) for verified runs.
7. Attempt log: every verified model call appends an event to the run's `agent_events`
   (`{ type: "attempt", n, modelMs, gatesMs, ok, failedAt, diagnostics, tokens }`), so runs
   can be inspected and evaluated. The browser ignores unknown event types.
8. Debug switch: `VERIFY_DEBUG_FAIL=<gate>:<n>` makes the named gate fail the first `n`
   attempts of each verified run with a synthetic diagnostic. Ignored in production.

**Tests.** `applyChangeSet` (write, edit, delete, non-matching hunk, platform-owned path);
parse and policy gates (port the POC selftest cases that apply); protocol parsing; run state
machine with a fake model adapter (pass first time; pass after 2 repairs; give up after 3;
question → needs_user).

**Done when.** Tests pass; a verified project's edit commits a version through the gateway;
the legacy engine is unchanged except the repair cap and quieter status events.

**User tests.**
1. Set one project to verified: `node --env-file=.env scripts/set-engine.mjs <projectId> verified`.
2. Ask for a small edit ("make the header text bigger"). It applies and a new version appears.
3. Open the browser's Network tab during an edit: the event stream sends a handful of events,
   not one per second, and the status line still counts seconds.
4. Restart dev with `VERIFY_DEBUG_FAIL=policy:2` and make an edit. The chat shows it took 3
   attempts and then succeeded. With `VERIFY_DEBUG_FAIL=policy:9`, the edit ends with a clear
   "couldn't apply this change" message and the app is unchanged (check Versions).
5. On a legacy project, a screen that crashes in the preview is repaired at most once per
   version; no repeated repair requests in the Network tab.

---

### Phase 3: Evaluation harness (baseline numbers)

**Goal.** Measure the engines on fixed tasks so every later phase is judged by numbers, not by
feel. Port the POC evaluation.

**Work.**
1. `scripts/export-fixture.ts --project <id> --name <fixture>`: reads a project's current doc
   and latest plan from the DB and writes `eval/fixtures/<fixture>.json`
   (`{ plan, doc }`). Ask the user which 2 or 3 existing projects to export (pick a small
   one and a larger one).
2. `eval/tasks.ts`: tasks with categories, adapted from
   `poc/verified-code/src/cli/eval.ts` `TASKS` and `CEILING_TASKS` to the fixtures' apps. At
   least 20 change tasks and 6 out-of-scope tasks (map, push notification, camera, network
   sync, a gesture, "make it better").
3. `scripts/eval.ts --engine verified|legacy --fixture <name> [--only] [--concurrency 4]`:
   runs each task against the fixture in memory using the engine core directly (no DB, no
   commits). For legacy, call the existing edit pipeline through a thin in-memory adapter if
   that is practical; if it is not, run only the legacy *checks* on the verified engine's
   first outputs, as the POC did (`poc/verified-code/src/gates/legacy.ts`), and say so in the
   report.
4. Report (port the POC summary): tasks, first-pass rate, verified rate, needs_user count,
   repair rounds, p50/p90 time to verified, model vs gate time, average tokens, rejections by
   gate and code, first-pass by category, "broken but today's checks would accept" count, and
   outcomes of out-of-scope tasks. Write the full log to `eval/runs/<timestamp>.json`
   (gitignored).
5. `npm run eval` script; stop early on provider billing/auth errors (401/402/403), as the
   POC does.

**Done when.** The harness runs end to end on at least one fixture with the verified engine;
results are saved; the report prints.

**User tests.**
1. Run `npm run eval -- --engine verified --fixture <name>` and read the summary. Expected
   cost with Haiku 5.5 for ~26 tasks: about ₹5.
2. Keep the numbers; the next phases are compared against them.

---

### Phase 4: Real type-check gate

**Goal.** Replace the `noResolve` name check with a real TypeScript check against the real
types of React Native, Expo Router and every allowed package, plus typed data access. This is
the gate that caught most of the POC's real bugs.

**Work.**
1. Type bundle: `vendor/type-bundle/package.json` listing every package in
   `ALLOWED_PACKAGES` at the exact versions in `lib/app-project/templates.ts` `packageJson`
   (Expo SDK 58), plus `@types/react`. Script `npm run typebundle:install` runs
   `npm ci --ignore-scripts` there. Commit `package.json` and `package-lock.json`, gitignore
   its `node_modules`. The checker resolves modules from this folder only, never from the
   app's own `node_modules`.
2. `lib/verify/gates/typecheck.ts`: port `poc/verified-code/src/gates/typecheck.ts`: a warm
   `LanguageService` over a virtual project rooted inside `vendor/type-bundle/` (so module
   resolution finds its `node_modules`), `strict: true`, `jsx: react-jsx`,
   `moduleResolution: bundler`, `paths: { "@/*": [virtual root] }`, `resolveJsonModule`.
   Keep one service per project in an LRU (max 8, evict after 10 minutes idle). Include
   `relatedInformation` in diagnostics.
3. Typed data access. Today `useCollection(name)` returns untyped records, so a strict check
   would flag every `item.title`. Generate `data/types.ts` from the `DataModel` (one type per
   collection, fields typed from `FieldType`, plus `id`, `createdAt`, `updatedAt?`) and typed
   overloads in the device backend (`useCollection("habits")` returns `Habit[]`,
   `useRecord("habits", id)` returns `Habit | null`). Keep the preview shim's runtime behavior
   identical; only types change. Generated deterministically in `platformFiles`.
4. Blocking profile. Start with a blocking set and treat everything else as a warning, so
   existing apps aren't suddenly unfixable. Block on: syntax errors (TS1xxx); 2304, 2552
   (missing name); 2305, 2614, 2724 (missing export); 2307 (missing module); 2322, 2741, 2769
   (props and assignment, including JSX props); 2345, 2554, 2555 (wrong arguments); 2339
   (property doesn't exist); 18047, 18048 (possibly null/undefined); 2786 (not a valid JSX
   component). Put the list in one constant. In the report, list the warning codes that
   appear most on the fixtures so the user can decide to promote them later.
5. Pipeline: add `tsc` after `policy`. `undefinedNames` from `analyze.ts` is no longer used by
   the verified engine. `autoImport` still runs as a pre-pass for now, but log each time it
   adds an import (the plan is to retire it once first-pass rates show it isn't needed).
6. Prompt: the verified coder prompt states that code is type-checked strictly, records from
   `useRecord` can be `null`, and data types come from `@/data/types`.
7. Debug switch: `VERIFY_DEBUG_FAIL=tsc:<n>` works through the same mechanism.

**Tests.** Port the POC type cases adapted to this app: wrong prop on a React Native
component, missing import, missing module, unknown collection field, unchecked `useRecord`
null, wrong `router.push` argument type. Warm re-check under 500 ms on a fixture (assert a
generous bound, e.g. 2 s, in CI).

**Done when.** Tests pass; eval shows the tsc gate catching errors (rejections by `tsc`
codes), and first-pass/verified rates are reported against the Phase 3 baseline.

**User tests.**
1. Run the eval again and compare with Phase 3. Expect more rejections caught at `tsc` and
   the same or better verified rate. Gate time per change should stay under ~2 s.
2. On a verified project, ask for "show the habit's category on the detail screen" (or a
   similar field the model might get wrong). Open the run's events in the DB or the server
   log: if the first attempt had a type error, it was repaired before you saw anything.
3. Normal edits still feel as fast as before.

---

### Phase 5: Render smoke gate

**Goal.** Mount every changed screen headlessly before committing: catch crashes on mount,
crashes when a record is missing, render loops, blank screens and crashes on button press.

**Work.**
1. `lib/verify/gates/render.ts`. Reuse the real preview runtime so the gate and the live
   preview behave identically: load the built `public/preview/runtime.js` into a `jsdom`
   window (`runScripts: "dangerously"`, `pretendToBeVisual`) and act as the host by speaking
   the bridge protocol in `lib/preview/protocol.ts`:
   - compile files with `compileForPreview` exactly as `components/workspace/app-runtime.tsx`
     does, and post `modules` (with `planned` routes), `theme`, `data` (seed collections) and
     `reset` (route);
   - answer `rpc` messages using the same local-backend semantics the workspace uses
     (`lib/backend/local-backend.ts` or the logic `app-runtime.tsx` uses), in memory;
   - collect `error` frame messages, uncaught errors and `console.error` render-loop
     messages ("Maximum update depth", "Too many re-renders");
   - for each changed route: render with sample params (ids from seed data), render again
     with an id that doesn't exist, check the screen is not blank, then press each pressable
     (`[role="button"]`, up to 12) in a fresh mount and collect errors.
   If driving the built bundle proves impractical, fall back to the POC approach
   (`poc/verified-code/src/gates/render.ts`: an in-process loader with the preview shims),
   and tell the user which approach was used and why.
   POC lessons: define `ShadowRoot`, `HTMLStyleElement`, `ResizeObserver`, `matchMedia` on the
   jsdom window; React reports event-handler errors through the global `reportError`, so define
   it to capture them; map stack frames to files with the `project:///` source URLs.
2. Time budget: aim under 3 s per change; only changed screens and screens that import a
   changed component are rendered.
3. Add `render` after `tsc` in the pipeline. Debug switch `VERIFY_DEBUG_INJECT=crash` adds a
   throw to the first changed screen of each attempt (development only), to prove the gate
   blocks it.

**Tests.** Fixture-based: a screen that throws on mount, throws on missing record, has a render
loop, renders nothing, crashes on press: each is rejected with the right code; a valid screen
passes.

**Done when.** Tests pass; eval shows render-gate rejections being repaired; gate time within
budget.

**User tests.**
1. Restart dev with `VERIFY_DEBUG_INJECT=crash`, make an edit on a verified project. The crash
   never appears in the canvas; the chat shows the change was repaired or that it couldn't be
   applied, and the app is unchanged.
2. Without the switch, ask for "add a delete button on the detail screen". It works; pressing
   it in the preview doesn't crash.
3. Run the eval and compare.

---

### Phase 6: App manifest and compiler

**Goal.** Structure becomes declared: navigation, screens, params, data model and theme come
from a validated manifest, and a deterministic compiler writes the files that hold the app
together. Fixes "screen added but not showing" (`fixes.txt` #9) and the safe-area and tab-icon
problems found on a real device.

**Work.**
1. `lib/manifest/schema.ts`: Zod schema, a superset of today's `AppPlan` + `DataModel` +
   theme selection. Port the validation style of `poc/verified-code/src/core/manifest.ts`
   (schema plus reference checks with fix-friendly messages) and its `applyPatch`. Required
   content: app name/slug; screens keyed by id with `title`, `presentation`
   (`tab|stack|modal`), `params`, and `icon` (an Ionicons name, required for tabs);
   navigation (tabs order, initial screen); collections (from `DataModel`); allowed packages;
   `schemaVersion`.
2. `lib/manifest/migrate.ts`: `fromLegacy(plan, doc)` builds a manifest for existing projects.
   Store the manifest in `AppDoc` (`doc.manifest`) and in snapshots.
3. `lib/manifest/compile.ts`: generates (deterministically):
   - `app/_layout.tsx` (root stack, `ThemeProvider`, `SafeAreaProvider`, modal
     presentation per screen) and `app/(tabs)/_layout.tsx` (tabs with icons from the manifest,
     bottom inset handled through `react-native-safe-area-context`);
   - `lib/nav.ts`: typed navigation over expo-router (`go(screen, params)`, `back()`,
     `useParams(screen)`), typed from the manifest so a wrong screen or missing params is a
     type error. Port the tuple-union typing from `poc/verified-code/src/sdk/nav-runtime.tsx`
     (`GoArgs`), which produces readable errors;
   - `data/types.ts` (moves here from Phase 4's generator).
   Add golden-file tests and a determinism test (compile twice, compare bytes).
4. The AI-written shell (`SHELL_INSTRUCTIONS` layouts) is replaced by compiler output for
   verified projects. Shared components remain AI-written.
5. Planner: for verified projects, plan changes are expressed as `<manifest_patch>` ops.
   Adding a screen = manifest patch + the screen file in one ChangeSet; the gateway validates
   the patch, recompiles, and the type check rejects a manifest screen without a file.
6. Preview runtime: keep working unchanged (it already routes from `app/` files); verify that
   compiled layouts render in it, and that tab icons show.
7. Prompt: the coder uses `go()`/`useParams()` from `@/nav` instead of string paths.

**Tests.** Manifest validation (unknown tab, tab with params, unknown collection reference,
missing tab icon); patch application; compiler golden files and determinism; a ChangeSet that
adds a screen without its file is rejected.

**Done when.** Tests pass; existing verified projects migrate on first open; adding a screen by
chat always shows it in navigation.

**User tests.**
1. On a verified project, ask "add a Settings tab with notification toggles". It appears in
   the tab bar with an icon, every time (try it 3 times on a fresh project).
2. Ask "rename the Profile tab to You": only the manifest and layout change, no screen rewrite.
3. Tabs no longer sit under the phone's navigation bar (checked fully on device in Phase 10;
   in the browser preview, check the tab bar still looks right).
4. Run the eval and compare.

---

### Phase 7: Platform kit, coder prompt and context engine

**Goal.** Give the model a strong, typed component vocabulary and a smaller, sharper prompt,
so screens look consistent and pass on the first attempt more often.

**Work.**
1. `@/kit` platform module: port `poc/verified-code/src/sdk/kit.tsx` (Screen, Stack, Row,
   Text, Card, Button, IconButton, ListItem, Stat, ProgressBar, TextField, Toggle,
   EmptyState, Badge, Icon, Section, Divider) adapted to this app's theme tokens
   (`@/theme`: `colors`, `radius`, `spacing`) and to `@expo/vector-icons` Ionicons for icons.
   Ship it in three places, from one source file: the device project (`platformFiles`), the
   preview runtime (`preview-runtime/modules.ts` maps `@/kit`), and the type bundle (the
   checker reads the same source). Strict prop types; the props section is marked with
   `// #region props` so the prompt can include it verbatim.
2. Coder prompt (verified engine): rewrite from `poc/verified-code/src/agent/context.ts`
   `SYSTEM_PROMPT`, keeping what the current `SCREEN_INSTRUCTIONS` gets right about design
   quality. Include: project layout and ownership, kit reference, `@/nav`, `@/data/types`,
   null handling, keys in lists, no setState in render, files under 250 lines with
   `components/<screen>/` for parts, theme tokens only. Add the two rules the POC validated:
   - requests that need unsupported capabilities (maps, push, camera, payments, network,
     outside packages): build the closest working version and say what's missing, or reply
     with a `<question>`; never fake or import them;
   - vague requests ("make it better"): reply with a `<question>` offering 2 or 3 concrete
     directions.
3. Context engine `lib/verify/context.ts`: stable prefix first (instructions, kit reference,
   platform API docs) so the gateway can cache it; then manifest, generated APIs, a repo map
   (exports and props per file, from the language service), then full text of only the files
   the request needs. Port `selectFiles` (focused context) from the POC as the default; fall
   back to all files when nothing matches.
4. New-screen generation for verified projects uses the same coder, one screen per task,
   screens in parallel (existing `SCREEN_CONCURRENCY`) after the manifest is compiled.

**Tests.** Kit renders each component with default props in the render harness; prompt
builder snapshot test; `selectFiles` cases.

**Done when.** Tests pass; eval first-pass rate is at or above the Phase 6 number; a new app
builds fully on the verified engine.

**User tests.**
1. Create a new project on the verified engine (`DEFAULT_ENGINE=verified` in `.env` for dev)
   from a fresh prompt. Compare its look with a legacy project from the same prompt. Tell the
   agent what looks worse; that feeds back into the kit and prompt.
2. Open the Code tab: screens import from `@/kit`, files are short, parts live under
   `components/<screen>/`.
3. Ask "add a map of nearby gyms": you get a clear answer that maps aren't supported yet, with
   an alternative, and nothing changes.
4. Ask "make it better": you get a question with concrete options.

---

### Phase 8: Router and fast edit path

**Goal.** Small edits skip planning and finish fast (`fixes.txt` #2 and #4).

**Work.**
1. Router step for verified projects: a small, fast model call (or the coder model) that
   classifies the message as `question | edit | add_screen | structure | integration |
   unsupported`, using a tagged reply parsed with Zod. Fall back to the planner when unsure.
2. Paths:
   - `question`: answer from the project (manifest, repo map), no ChangeSet, state `answered`;
   - `edit`: straight to the coder with focused context;
   - `add_screen` and `structure`: planner → manifest patch → coder;
   - `integration` / `unsupported`: an answer explaining what's possible.
3. Canvas inline edits (`apply-edit` from the preview inspector) for verified projects become
   ChangeSets applied without a model call: change the JSX text or style prop at the `eid`
   location (an AST codemod with the TypeScript compiler API), then run the gates.
4. Emit `run_state` events so the chat shows "Editing Home" instead of "Planning".

**Tests.** Router parsing; routing table; codemod for text and style edits.

**Done when.** Tests pass; eval p50 time to verified for `edit` tasks is lower than Phase 7.

**User tests.**
1. Ask "add a scroll to the home screen": it finishes in roughly 10 to 15 seconds and the
   Versions entry shows only that screen changed.
2. Ask "what screens does my app have?": you get an answer and no new version.
3. Edit a text inline on the canvas: it saves instantly as a new version without an AI call.

---

### Phase 9: Code tab, ownership and diffs

**Goal.** The Code tab shows exactly what the engine owns and what changed.

**Work.**
1. `components/workspace/code-view.tsx` and `app-files.ts`: mark files as Platform,
   Generated (compiler) or App, with a small badge; Platform and Generated files show a
   read-only note "Generated from the app's structure".
2. "Changes" view: for the current version, list changed files and show a unified diff against
   the previous version (from snapshots). A version picker reuses the Phase 1 API.
3. Selecting an element in the preview highlights its source lines (the `data-eid`
   `file:line` already exists); verify this still works for compiler-generated layouts and
   kit components (kit lines should point to the screen's usage, not inside the kit).

**Tests.** Ownership classification; diff of two docs.

**Done when.** Tests pass; badges and diffs render.

**User tests.**
1. Open the Code tab: screens are marked App, layouts and `lib/nav.ts` are Generated, theme
   and backend are Platform.
2. Make an edit, open Changes: only the touched files are listed, with a readable diff.
3. Click an element in the preview: the Code tab jumps to its lines.

---

### Phase 10: Real device preview and bundle gate

**Goal.** Open the current version on a real phone through Expo Go, and add the Metro bundle
check proven in the POC.

**Work.**
1. Local device lane (development first): `lib/device/export.ts` writes the head snapshot as a
   real Expo project to `.device/<projectId>/` (the main app's projects are already real Expo
   Router projects; port the remaining pieces from `poc/verified-code/src/expo/export.ts`:
   babel and metro config, `.gitignore`). Share an installed `node_modules` per Expo SDK
   version (install once into `.device/_deps/sdk-58/`, link or copy into each project) so
   starting is fast.
2. `scripts/device-preview.ts <projectId>`: exports, starts `npx expo start` without `CI=1`
   (CI mode hides the LAN URL), finds the LAN IPv4 address, and prints
   `exp://<lan-ip>:8081`. POC lessons: never delete or rotate the log file while Metro is
   running; Metro prints only `http://localhost:8081` when not attached to a terminal, so
   build the `exp://` URL from the LAN IP; Windows Firewall must allow Node on port 8081.
3. Real QR code: replace the placeholder matrix in `components/workspace/expo-qr.tsx` with a
   real QR (add a small QR library) of the URL the device lane reports; show the URL as
   copyable text too. In development the URL comes from a dev-only API route that reads the
   running device lane's state; hosted sandboxes are a later project.
4. Bundle gate (on demand and before publish, not on every edit): request
   `http://localhost:8081/node_modules/expo-router/entry.bundle?platform=ios&dev=true` and
   `platform=android`; HTTP 200 passes, anything else becomes a `bundle` diagnostic with the
   Metro error message.

**Done when.** A verified project opens in Expo Go on a phone on the same Wi-Fi; the bundle
gate passes for it and fails with a readable message for a deliberately broken export.

**User tests.**
1. Run `npm run device -- <projectId>`, open the printed `exp://` URL (or scan the QR in the
   Device dialog) in Expo Go on a phone on the same Wi-Fi.
2. The app opens; tabs are above the phone's navigation bar and have icons; navigate every
   screen; add and delete an item.
3. Note anything that differs from the browser preview and report it.

---

### Phase 11: Switch the default

**Goal.** New projects use the verified engine; the legacy engine stays available until the
user confirms removal.

**Work.**
1. Set `DEFAULT_ENGINE=verified` in `.env.example` and the production configuration (ask the
   user before changing production settings).
2. Offer per-project migration for existing projects (manifest `fromLegacy`, first verified
   commit as a new version).
3. List what removing the legacy engine would delete (files and functions) and wait for the
   user's confirmation before deleting anything.

**User tests.**
1. Create a new project without any switch: it is verified (Versions, gates, Code tab badges).
2. Open an old project: it still works; migrate it and confirm nothing visible changed.

## 5. What each phase fixes from `fixes.txt`

| Item | Fixed in |
|---|---|
| 2 · Small edit rewrites the whole screen | Phase 2 (ChangeSet edits), Phase 7 (small files), Phase 8 (router skips planning) |
| 3 · Same SSE event every second | Phase 2 |
| 4 · Simple changes are slow | Phases 7 and 8; model choice in Phase 0 |
| 5 · Smallest usable model | Phase 0 config, measured by Phase 3 eval |
| 6 · Repair retries forever | Phase 2 |
| 7 · Expo skills | Phase 7 (feed into kit/platform docs in the prompt) |
| 8 · LangGraph with parallel workflows | Not needed; the run state machine and worker concurrency cover it |
| 9 · Screen added but not showing | Phase 6 |

## 6. Out of scope for this plan

Hosted device sandboxes (containers per active project), EAS Build/Update and store
publishing, generated end-to-end flows (Maestro) and visual diff, deterministic CloudHike
provisioning from the manifest, and a visual spec layer for canvas editing beyond inline
text/style edits. Note ideas for these in the phase reports instead of building them.

## 7. Reporting after each phase

End every phase with a message to the user in this shape, then stop:

```
Phase N: <name> — done

What changed
- <3 to 6 bullets in plain language>

Files
- <new and changed files, grouped>

Checks I ran
- npm test: <result>   tsc: <result>   build: <result>
- eval (if applicable): <first-pass, verified, p50, vs previous phase>

Please test
1. <exact steps from this plan, adjusted to what was built>
2. ...

Known issues / decisions for you
- <anything incomplete, any deviation from the plan and why, questions>
```

If a check fails and you cannot fix it within the phase's scope, report it under "Known
issues" with the exact error instead of working around it silently.
