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

**User tests.** Confirmed, 2026-11-18.
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

**Baseline (2026-11-17), the official numbers later phases are compared against.**
Run: `npm run eval -- --engine verified --fixture notes` (26 tasks: 20 change + 6 ceiling).
Full log: `eval/runs/1794938192815-verified-notes.json` (gitignored; re-run to regenerate if lost).

| Metric | Value |
|---|---|
| First-pass rate | 11/26 (42%) |
| Verified and committed | 20/26 (77%) |
| Ended in `needs_user` | 6/26 (5 of these are a correct `<question>`, not a failure; 1 real failure — see below) |
| Repair rounds (total) | 17 |
| Time to verified, p50 / p90 | 21.1s / 44.3s |
| Model vs gate time | 490.5s vs 64.9s |
| Avg tokens in / out | 9920 / 2685 |
| "Broken, but today's (pre-verified) checks would accept" | 2/26 — the gate catching exactly the bug class this architecture exists for |

First-pass by category: edit 3/5, screen 0/3, data 3/4, logic 2/3, layout 2/3, flow 0/2,
ceiling 1/6 (all categories still reach "committed" or a correct `<question>` except one).

Biggest rejection reason: `policy import_not_resolved` ×8 — the model referencing a new
component file it forgot to actually write in the same reply. Worth tightening the coder
prompt on later; not urgent.

The one real failure: task #25, "swipe an item left to delete it, with a smooth animation" —
tried `Swipeable` from `react-native-gesture-handler`, which isn't exported there, and gave up
after exhausting the repair budget. (This is also one of the two cases the pre-verified checks
would have let through unchecked.)

Out-of-scope requests (map, push notification, camera, Google Sheets sync, "make it better")
all got a sensible answer: either a clear "can't do this, here's why" or a reasonable local
fallback (a daily local notification; a camera-attach flow stored via `useSetting` since the
fixture's schema has no photo field).

**A note on the fixture.** The first attempt at this baseline used `eval/fixtures/clearlist.json`
and `rhythm.json` (both exported from real, already-built projects) and the result was
dominated by one thing: every screen in every existing project (`clearlist` 510 lines, `rhythm`
980-1232 lines, even the newest "Tickly" at 356) is already over the 300-line policy limit
*before* any edit, so almost every task failed `file_too_long` on attempt 1 regardless of edit
quality. `eval/fixtures/notes.json` (generated by `scripts/make-fixture.ts`, a small hand-written
"Jot" notes app, zero AI cost) is deliberately well under the limit and is now the standard
fixture for this baseline. The underlying gap — real projects built before stricter decomposition
guidance (Phase 7's kit/prompt work) already violate the 300-line gate — is still open; see
`docs/verified-code-pending.md`.

**User tests.** Done, 2026-11-17 (see baseline above).
1. ~~Run `npm run eval -- --engine verified --fixture <name>` and read the summary.~~ Done.
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

**User tests.** Confirmed, 2026-11-18.
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

**User tests.** Confirmed, 2026-11-18.
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

**User tests.** Confirmed, 2026-11-18.
1. On a verified project, ask "add a Settings tab with notification toggles". It appears in
   the tab bar with an icon, every time (try it 3 times on a fresh project).
2. Ask "rename the Profile tab to You": only the manifest and layout change, no screen rewrite.
3. As a regression check: after renaming a tab via chat, ask for a brand-new screen to be
   added (an "additive" rebuild) and confirm the rename survives.
4. Tabs no longer sit under the phone's navigation bar (checked fully on device in Phase 10;
   in the browser preview, check the tab bar still looks right).
5. Run the eval and compare.

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

**Status: done, including item 4.**
- Items 1-3 done as specified, with two simplifications the real architecture made possible:
  `@/kit` (`lib/app-project/kit.ts`) needs no separate preview-runtime mapping and no
  type-bundle entry, because it ships as a normal platform file in the Workspace FileMap —
  the existing generic file resolver (`preview-runtime/modules.ts` `resolvePath`) and the
  `tsc` gate (which already type-checks every file in the workspace, platform files included)
  pick it up for free, the same way `@/theme` already does. Tests type-check and render-mount
  the kit for real (`lib/app-project/__tests__/kit.test.ts`), not just a props snapshot.
- Item 4, done 2026-11-18: `lib/agent/orchestrator.ts` `buildScreen` now writes every new screen
  through the same change gateway an edit uses — the verified coder (`@/kit`, typed `@/nav`
  and `@/data/types`), `lib/verify/run.ts` `runChange`'s bounded repair (up to 3 rounds fed with
  real diagnostics), then the parse/policy/tsc/render gates — instead of the old
  `SCREEN_INSTRUCTIONS`/`screenPrompt` designer agent and `checkAndFix`, which are removed.
  The blocker (losing the live-typing UX) is resolved: `ModelAdapter` (`lib/verify/run.ts`) now
  takes an optional `onDelta` callback, `RunOpts.onDelta` threads it through each attempt, and
  `lib/verify/coder.ts`'s `coderAdapter` streams the model's reply through it when given one
  (falling back to a single non-streaming call otherwise, e.g. for plain edits). `buildScreen`
  passes `onDelta` straight to `screen_delta` events and re-emits `screen_start` on each repair
  round, so the client's existing live-code view keeps working unchanged. A new prompt,
  `verifiedNewScreenPrompt` (`lib/verify/prompts.ts`), asks for just the screen's `<file>` (the
  manifest already declares it from the planner's own `<manifest_patch>`) in the one format the
  verified coder always answers in.

**User tests.** Items 2-4 confirmed, 2026-11-18, before item 4's rewrite of new-screen
generation. Item 1 (and item 2's "new screen" half) needs re-running now that new screens go
through the verified coder + `@/kit` + gateway instead of the old designer prompt — there is
also no legacy project left to compare against, so "compare its look with a legacy project"
no longer applies; compare instead against how this app looked before this change.
1. Create a new project (every project is verified-engine now) from a fresh prompt. Confirm
   each screen streams into view live (the "Building ⟨screen⟩" status and live code view still
   work) and the finished screens use `@/kit` components rather than raw `View`/`Text`.
2. On a project, ask for an edit that would plausibly use the kit (e.g. "add a progress
   bar to the habit card"): the edited code imports from `@/kit` rather than rebuilding the same
   primitives by hand.
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

**Status: done, including item 3.**
- Items 1, 2 and 4 done: `lib/verify/router.ts` (route, parsing, prompt) plus
  `lib/agent/orchestrator.ts` `routeMessage`, called from `execute.ts` before the planner for a
  verified project that already has a built app. `edit` goes straight to `runVerifiedEdit`
  (focused context, no planner call); `question`/`integration`/`unsupported` are answered
  directly with no new version; `add_screen`/`structure`/an unparseable reply/no built app yet
  fall back to the existing planner path unchanged. Item 4 (the chat showing "Editing Home"
  instead of "Planning") falls out of this for free: skipping the planner also skips its
  `phase: "planning"` / "Thinking" status, so the first thing shown is `routeMessage`'s "Reading
  your message" and then `runVerifiedEdit`'s own "Editing Home" status.
- Item 3, done 2026-11-18. The earlier note here was wrong about why it was missing: the
  frame-side inspector (`preview-runtime/inspect.ts` — hover/select boxes, tap-to-select,
  `data-eid` lookup, an `applyEdit` handler for optimistic local DOM updates) and the bridge
  protocol (`lib/preview/protocol.ts` `SelectedElement`/`ElementEdit`/`apply-edit`,
  `RuntimeFrame`'s `inspect`/`edit`/`onSelectElement` props in `components/workspace/app-runtime.tsx`)
  were already in the codebase baseline, before this plan started — only the host-side UI that
  turns any of it on was missing. That's what this phase builds: an "Inspect" toggle in the
  Preview panel's toolbar (`components/workspace/preview-panel.tsx`); a new
  `components/workspace/element-inspector.tsx` panel that appears under the phone once an
  element is tapped, editing its text and a few style fields (text/fill color, bold, font size,
  corner radius) — each change applies instantly to the live preview (`edit` prop, no round
  trip) and is saved, debounced, through a new AST codemod. `lib/verify/codemod.ts`
  (`applyElementEdit`/`parseEid`) rewrites the JSX element at the edit's eid
  ("file:line:Tag", from `preview-runtime/modules.ts`'s dev JSX transform) directly in the
  source text: a plain string child for a text edit, and for a style edit either an existing
  inline `style={{...}}` object (overwriting/adding properties, numeric React Native properties
  like `fontSize` written as a bare number rather than a quoted CSS string), a new `style={{...}}`
  prop if there wasn't one, or — for `style={styles.foo}` — wrapping it in an array
  (`style={[styles.foo, {...}]}`) rather than trying to understand what it referenced. No model
  call: `lib/agent/orchestrator.ts` `applyCanvasEdit` runs the codemod's output through the same
  gates (parse/policy/tsc/render) an AI edit goes through before committing a version, behind a
  new `POST /api/projects/[projectId]/canvas-edit` route and the project's existing one-run-at-a-time
  lock (`lib/agent/run-store.ts`, `openRun`'s `kind` widened to include `"canvas-edit"`). Tests:
  `lib/verify/__tests__/codemod.test.ts` (13 cases: text replace/insert/skip-when-dynamic, each
  style-prop shape, self-closing elements, no-op).
- **Found and fixed while testing this by hand, 2026-11-18**: tapping almost anything on a real
  screen (every screen is built from `@/kit` since Phase 7) produced an eid pointing inside
  `kit/index.tsx` — platform-owned, so every edit failed with "Couldn't apply that edit there."
  Root cause: the dev JSX factory (`preview-runtime/modules.ts` `makeJsx`) attaches `data-eid`
  to the props object at the JSX call site that creates it, but every kit component (`Text`,
  `Button`, `Card`, ...) destructured only its own named props and dropped everything else — so
  the eid attached at the *screen's* `<Text>` usage never reached the actual host element; the
  `<RNText>` kit's own `Text` renders internally got a fresh eid of its own instead, pointing at
  kit's source. Fixed in `lib/app-project/kit.ts`: every component now destructures the rest of
  its props (`...rest`) and spreads them (before its own explicit props, so they can't override
  kit's own styling) onto the one host element it returns — `react-native-web`'s `dataSet` prop
  (how `data-eid` reaches the DOM) is included in that rest object and flows through. Regression
  test: `lib/app-project/__tests__/kit-eid.test.ts`, which compiles the real `KIT_SOURCE` and a
  sample screen with the same classic-JSX-dev transform the preview uses, mounts it with a real
  React root, and asserts the rendered element's `data-eid` is the screen's own usage line, not
  kit's.
- **Found right after, testing on an already-built project**: the fix above only helps a
  project once it's rebuilt — `kit/index.tsx` is written into a project's stored files once, at
  build time (`lib/agent/orchestrator.ts` `runGeneration`), and every edit path reads that
  stored copy as-is; nothing resyncs it on its own, so an already-built project keeps serving
  its stale, pre-fix kit forever and the exact same "Couldn't apply that edit there." kept
  happening. Unlike `theme/index.tsx`/`lib/backend/index.ts` (parameterized by the app's own
  slug/data, meant to be rebuilt), `kit/index.tsx` is a pure constant — always supposed to equal
  `KIT_SOURCE` — so resyncing it outside a full rebuild is safe. Fixed: `withCurrentKit()`
  (`lib/agent/orchestrator.ts`) refreshes it in the workspace every edit path builds
  (`runVerifiedEdit`, `repairFile`, `applyCanvasEdit`), so a kit fix reaches every project on its
  very next edit, no rebuild needed, and rides along in that edit's own commit. For the one still
  open in a browser tab, `applyCanvasEdit` also reports the refreshed file back as `extraFiles`
  (even when the tapped edit itself fails, e.g. because the eid still pointed at the stale kit) so
  the running preview and Code tab pick it up immediately and the *next* tap already resolves
  correctly, rather than needing a page reload.
- **Found testing that fix**: the user reported the exact same "Couldn't apply that edit there"
  (expected — the tap that triggers a resync is itself still the stale one, so it correctly
  fails), but also that editing one element's text visibly changed a *different* element's text
  on screen. Cause: before the resync lands, every `<Kit.Text>` anywhere in that screen shared
  the one stale eid `kit/index.tsx:89:Text` (the bug the first fix addresses); the inspector's
  optimistic preview (`preview-runtime/inspect.ts` `applyEdit`) finds the edited element with
  `document.querySelector('[data-eid="..."]')`, which only ever returns the *first* matching
  element — so it updated whichever same-eid `Text` happened to come first in the DOM, not
  necessarily the one tapped. Once resynced, each `Text` gets its own distinct eid again and this
  stops happening — but the editor panel was still bound to the stale eid from the tap that
  triggered the resync, so retyping kept hitting the same dead end. Fixed (UX, not the model):
  `components/workspace/preview-panel.tsx` now closes the inspector and shows "The preview just
  updated behind the scenes — tap the element again" whenever a save fails *and* the response
  resynced a platform file, instead of leaving the editor open on a now-meaningless eid.
- **Revisited and substantially hardened after that**: the eid scheme (`file:line:Tag`) is
  still per-source-location, not per-rendered-instance, but `lib/verify/codemod.ts` no longer
  guesses when a line has more than one candidate element. It now: matches by tag name (falling
  back to a lone element on the line for a text-only edit, since a runtime name can differ from
  the source tag); when several elements share a line and the edit has text, narrows to the one
  whose current text (`ElementEdit.from`, sent by the inspector) actually matches; and refuses
  outright ("Several elements share that line in the code...") rather than editing the wrong one
  when it still can't tell them apart. For several rendered *copies* of the same line (a `.map()`
  over a list), `preview-runtime/inspect.ts` now deliberately applies the optimistic preview edit
  to every copy (`handlers.applyEdit` uses `querySelectorAll`, not the first match) — correct
  *because* the saved source edit would change that one shared JSX call for all of them too, and
  a genuinely dynamic per-item value (`{item.title}`) is refused as non-static text anyway, so
  there's nothing it could silently get wrong. The remaining gap is small: two *different*,
  unrelated elements that happen to sit on the exact same source line and have the exact same
  current text are still indistinguishable; a real fix would need a per-instance id, which is
  more than this edge case is worth.

**User tests.** Confirmed, 2026-11-18, for items 1, 2 and 4. Item 3 needs a first pass — the
codemod has unit tests but the inspector UI itself hasn't been clicked through yet.
1. Ask "add a scroll to the home screen": it finishes in roughly 10 to 15 seconds and the
   Versions entry shows only that screen changed.
2. Ask "what screens does my app have?": you get an answer and no new version.
3. In the Preview tab, click the new select/pointer icon in the toolbar to turn on Inspect, tap
   an element in the running app, change its text and a couple of style fields in the panel that
   appears below the phone: the preview updates immediately, and shortly after a "saved" check
   appears and a new version shows up in Versions with only that screen changed. Try it on an
   element whose style comes from a `styles.foo` object (not inline) and on one with dynamic
   text content (e.g. bound to a variable) to see the dynamic-text case skip the text edit but
   still apply style.

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

**Status: done.**
- Item 1: `components/workspace/app-files.ts` `classifyOwner(path, engine)` (platform files are
  platform-owned in both engines; compiler paths like `app/_layout.tsx` and `lib/nav.ts` are
  "generated" only on the verified engine — on legacy the same paths are AI-written, so they're
  "app"). `FileNode` carries the owner; `code-view.tsx` shows a small badge in the tree and the
  open-file header, plus a read-only note for Platform/Generated files.
- Item 2: `lib/versions/diff.ts` (dependency-free LCS line diff, unified-context trimming) plus
  `GET /api/projects/[projectId]/versions/[version]/diff` and a new "Changes" tab
  (`components/workspace/changes-view.tsx`) next to Preview/Code, with a version picker that
  reuses the Phase 1 `/versions` list. Works for both engines (it diffs `AppDoc` snapshots,
  which both engines commit).
- Item 3, done 2026-11-18: a "View in Code tab" button in the canvas inspector's editor
  (`components/workspace/element-inspector.tsx`) parses the selected element's eid
  (`"file:line:Tag"`) and tells `components/workspace/code-view.tsx` (a new `jumpTo` prop) to
  open that file, expand its folders in the tree, and scroll to and highlight that line (a new
  `highlightLine` prop on `CodeViewer`, using `CodeBlockLine`'s existing `"highlighted"` variant;
  `components/ui/code-block.tsx` `CodeBlockLine` now forwards a `ref` so the viewer can scroll it
  into view). `components/workspace/preview-panel.tsx` owns the `jumpTo` state and switches to
  the Code tab when the button is pressed. Works for any file the eid points to, including a
  platform one like `kit/index.tsx` (useful for seeing *why* an element can't be edited there).

**User tests.** Confirmed, 2026-11-18, for items 1 and 2.
1. Open the Code tab: screens are marked App, layouts and `lib/nav.ts` are Generated, theme
   and backend are Platform.
2. Make an edit, open Changes: only the touched files are listed, with a readable diff.
3. In the Preview tab, turn on Inspect, tap an element, press the code icon in the editor panel
   that appears: the Code tab opens, the right file is selected (expanding its folder if it
   wasn't already), and the tapped line is highlighted and scrolled into view.

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

**Status: code done, not run (decided with the user).** The actual install/run/on-device
testing needs real time (an Expo SDK dependency install) and a real phone on the same Wi-Fi,
neither of which I have here, so the user chose to have me build it and run it themselves.
- Item 1: `lib/device/export.ts` `exportExpoProject(projectId, files)` writes a project's
  current files (no remapping needed: this app's own projects are already real Expo Router
  projects, unlike the POC) to `.device/<projectId>/`, plus `babel.config.js`,
  `metro.config.js` and `.gitignore`, and links `node_modules` (a Windows junction, a symlink
  elsewhere) to a shared install at `.device/_deps/sdk-58/` so export is instant.
  `lib/app-project/templates.ts` `packageJson()` is now exported and reused for that shared
  install's own `package.json`, so its dependency list can never drift from what a real export
  ships. `.device/` is gitignored.
- `npm run device:deps` (`scripts/device-deps.ts`) does the one-time shared install
  (`npm install --ignore-scripts`, mirroring the Phase 4 type-bundle's install pattern).
- Item 2: `npm run device -- <projectId>` (`scripts/device-preview.ts`) exports, computes the
  **machine's own LAN IPv4 address** directly (`os.networkInterfaces()`) rather than parsing
  Metro's output, builds `exp://<lan-ip>:8081`, writes it to a small state file
  (`device-lane.json`, cleared on exit/Ctrl-C) so the running server can see it, and starts
  `npx expo start --port 8081` with `CI` unset.
- Item 3: `components/workspace/expo-qr.tsx` now draws a real, scannable QR (the
  `qrcode-generator` package — small, dependency-free, MIT) of whatever URL a new dev-only
  route, `GET /api/projects/[projectId]/device` (refused outside development), reports from
  that state file; the dialog polls it every 3s while open and shows "not running yet" with the
  `npm run device` command until it sees one.
- Follow-up (no terminal needed): the dialog now has **Start / Restart / Stop** buttons.
  `lib/device/lane.ts` runs the same export + `expo start` as a child process of the Next dev
  server (one Metro at a time on port 8081; Restart re-exports the latest files; the process
  tree is killed with `taskkill /T` on Windows, a process group elsewhere; output goes to
  `.device/_logs/<projectId>.log` and its tail is shown if Metro exits). The device route
  gained `POST` (start/restart) and `DELETE` (stop) alongside `GET`, which reports
  `stopped | starting | running | failed | external` ("starting" until Metro's `/status`
  answers; "external" = started with `npm run device` in a terminal, which still works and
  shows Metro's output live). Still development-only: a hosted user's phone can't reach
  Metro on the server's LAN. That's Phase 10b.
- Item 4: `lib/verify/gates/bundle.ts` `bundleGate()` requests both platforms' bundle URLs
  against `localhost:8081` (`METRO_PORT`, shared with the preview script) and turns a non-200
  response, or a connection failure, into a `bundle` diagnostic. It is exported standalone, not
  added to `lib/verify/pipeline.ts`'s per-edit `GATES` list, matching "on demand... not on every
  edit" — nothing currently calls it (there is no "publish" action yet in this app), so it's
  ready for whenever that exists.

**Real-device finding (2026-11-17): a pre-existing, platform-wide data bug, found by this
phase doing exactly what it's for.** The user ran a legacy-engine todo-list app
(`proj-1794910414759-b2d193`) through the device lane on a real Android phone. Its data never
loaded — stuck on a spinner. Root cause, confirmed with a diagnostic build and then an
automated test: `lib/app-project/templates.ts`'s device backend (`useCollection`/`useRecord`/
`useSetting`, generated into every exported app's `lib/backend/index.ts`) read a mutated
module-level variable directly inside render and forced updates with a manual
`useReducer`/listener pattern. Under the React Compiler — on by default in every exported app
(`app.json` `experiments.reactCompiler: true`) — a render triggered that way can still be
served a memoized, stale result, because the compiler has no way to see that the external
variable is a tracked input. The browser preview never caught this because its shim
(`preview-runtime/shims/backend.ts`) already used the correct pattern. **Fixed**: rewrote the
device backend to use `React.useSyncExternalStore` with immutable state replacement (every
`db`/`kv`/`auth` write now produces a new `state` object rather than mutating in place), so
every hook reads only the snapshot the hook itself returns — matching the preview shim exactly.
Added `lib/app-project/__tests__/backend-device.test.ts`, which mounts the real generated
source with a real React root in jsdom and would have caught this (initial load resolves
without extra interaction; an insert shows up without a manual reload). This affects **every
exported app, legacy and verified**, not just this one project, and existed before Phase 10 —
it just had no way to surface until real on-device testing existed.

**User tests.** Confirmed, 2026-11-18 (all items, including Stop resetting the dialog, tabs/icons
above the nav bar, multiple screens, add and delete, and `bundleGate()` pass/fail behavior).
1. Open the "Test on your phone" dialog and press Start (or run `npm run device -- <projectId>`);
   when the QR appears, scan it in Expo Go on a phone on the same Wi-Fi. Press Stop and confirm
   the dialog returns to "Not running".
2. The app opens; tabs are above the phone's navigation bar and have icons; navigate every
   screen; add and delete an item.
3. Note anything that differs from the browser preview and report it.
4. With the device lane running, call `bundleGate()` (no UI for it yet) and confirm it passes;
   stop the device lane and confirm it fails with a readable "couldn't reach Metro" message.

---

### Phase 10b: Hosted device preview

**Goal.** A user of the deployed web app can scan the QR and open their app in Expo Go, with
no terminal and no shared Wi-Fi. Phase 10's lane can't do this: it runs Metro on the server's
machine and hands out a LAN `exp://` address.

**Approach (chosen): static export + self-hosted update manifest.** No long-running Metro per
user; the phone downloads a prebuilt bundle from a public URL.

**Work.**
1. Build step: for a project version, run `npx expo export` (iOS and Android) on the exported
   project in a build worker (a queue job, not the request handler), reusing Phase 10's
   `exportExpoProject` and shared SDK deps.
2. Upload the output (bundles and assets) to S3 under `device/<projectId>/<versionId>/`
   (`@aws-sdk/client-s3` is already a dependency).
3. Manifest route: a public `GET /api/device/<projectId>/manifest` that serves the newest built
   version in the expo-updates protocol format (platform from the `expo-platform` header),
   pointing at the S3 asset URLs. The QR encodes `exp://<public-host>/api/device/<projectId>/manifest`.
   **Check first** that Expo Go for SDK 58 opens a self-hosted manifest URL; if it doesn't,
   fall back to the alternative below.
4. Bundle gate moves here: a failed `expo export` is the `bundle` diagnostic (same shape as
   `lib/verify/gates/bundle.ts`), run before publish/preview and not on every edit.
5. Dialog: in production, "Start" becomes "Build for phone" (shows build progress, then the QR);
   each new version needs a rebuild, and the phone reloads to pick it up (no hot reload).
   Development keeps Phase 10's local Metro lane.

**Alternatives considered.** Expo Snack (`snack-sdk`): fastest to ship and needs no
infrastructure, but depends on Expo's service and Snack's supported SDKs, and isn't Metro. Use
it only as a stopgap. Per-session cloud sandbox running Metro behind a public URL: keeps live
reload, but it's the most expensive option and has the most moving parts.

**Done when.** From the deployed app, a user on mobile data scans the QR and the app opens;
a deliberately broken project shows a readable bundle error instead of a QR.

**User tests.**
1. On the deployed app, open a project, press "Build for phone", scan the QR with Wi-Fi off.
2. Make an edit, rebuild, reload in Expo Go: the change appears.

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

**Status: done, as full removal (decided with the user) — no `engine` flag or dual pipeline remains.**
The user asked to go further than "switch the default": remove the legacy pipeline entirely,
including for existing projects, rather than keep it available behind the flag.
- The `engine` flag is gone from application logic: `lib/verify/engine.ts` (`Engine`,
  `engineOf`, `DEFAULT_ENGINE`), `scripts/set-engine.mjs`, and every `engineOf(project)`
  branch (`lib/agent/orchestrator.ts` `routeMessage`/`repairFile`/`runGeneration`/`buildScreen`,
  `lib/agent/execute.ts` `dispatchEdit`, the Code tab's `classifyOwner`/`appFileTree`,
  `WorkspaceProject.engine`) are removed. Every project now always takes the path that used to
  be "verified only": manifest + compiler, the change gateway for edits and repairs, the
  platform kit. `app/api/projects/route.ts` creates new projects with `engine: "verified"`
  directly (no env flag).
- The legacy editor is gone: `runEdit` (`lib/agent/orchestrator.ts`), its prompts (`editPrompt`,
  `editRetryPrompt`), and the `editor` Agent. All edits go through `runVerifiedEdit` (the
  change gateway). `repairFile`'s legacy (`checkAndFix`-only) branch is gone; repair always
  goes through the gateway too.
- **The `projects.engine` database column was deliberately NOT dropped.** `db/schema.ts`'s own
  comment says this table "mirrors the live CloudHike `users`/`projects` table" and is "not
  managed by drizzle-kit here" — it reads as owned by the hosting platform, not this repo, so
  running `ALTER TABLE ... DROP COLUMN` against it was judged too risky for an unknown blast
  radius. The column stays, unread by any code now, for a future cleanup with more visibility
  into whatever else might reference it.
- **Existing projects were migrated against the live database** (`scripts/migrate-to-verified.ts`,
  new; no AI calls — the manifest is built deterministically from each project's latest plan via
  `fromLegacy` and compiled, same as the lazy migration every edit already does, just run for
  every project up front): of 13 projects, 4 had a real built app and were migrated (Rhythm,
  ClearList, Habit Tracker, Tickly), 1 already had a manifest (the Phase 10 device-test project),
  and 8 had zero successfully-built screens (dead/abandoned projects predating the current plan
  schema entirely — their stored `plan` JSON uses a different shape with no `appName` at all) and
  were left alone; there was nothing in them to migrate.
- **Found and fixed in the process**: `latestPlan()` (`lib/agent/orchestrator.ts`) cast
  `messages.plan` straight to `AppPlan` with no validation. The 8 dead projects above have a
  `plan` row in that old, incompatible shape, which crashed `fromLegacy` on `plan.appName
  .toLowerCase()` the moment anything tried to build a manifest for them — and after this
  phase's removal of the legacy edit path, every edit path does. `latestPlan` now runs each
  candidate through `normalizePlan` (already used for the planner's own replies) and returns the
  first one that's actually valid, so a project with an old or malformed stored plan is treated
  as having no plan (same as one that was never saved) instead of crashing.
- **Also fixed, found while preparing to migrate real projects**: the policy gate's 300-line
  check (`lib/verify/gates/policy.ts`, flagged as an open decision in
  `docs/verified-code-pending.md` section 4) now only blocks a file for getting *longer*; a file
  already over the limit before the edit (every real project's main screen, built before
  stricter decomposition guidance existed) is left alone as long as the edit doesn't grow it.
  Without this, migrating real projects onto verified-only editing would have made almost every
  edit to an existing screen fail outright on attempt 1, before repair even had a chance.
  `lib/verify/pipeline.ts`'s gates now receive the pre-change workspace (`base`) to compare
  against.

**User tests.**
1. ~~Create a new project without any switch: it is verified (Versions, gates, Code tab
   badges).~~ Structurally guaranteed now (no flag to get wrong), not separately re-verified by
   hand.
2. ~~Open an old project: it still works; migrate it and confirm nothing visible changed.~~
   Confirmed, 2026-11-18: Rhythm, ClearList, Habit Tracker and Tickly all still look and work as
   before, and an edit on each went through the gateway path (including the policy-gate leniency
   fix) correctly.

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
