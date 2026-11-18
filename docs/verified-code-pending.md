# Verified-Code Engine: What's Pending

Snapshot as of 2026-11-18, taken from [verified-code-plan.md](verified-code-plan.md). The plan
is the source of truth; this file only collects its open items in one place.

## 1. Phases not started

| Phase | What | Notes |
|---|---|---|
| 10b · Hosted device preview | Static `expo export` → S3 → self-hosted expo-updates manifest, so deployed users can scan a QR without a terminal or shared Wi-Fi. The bundle gate moves to the export step. | Check first that Expo Go for SDK 58 opens a self-hosted manifest URL; if not, fall back to Snack. Section 6 ("Out of scope") still lists hosted device sandboxes; update it to point at 10b. |

Phase 11 is done, as a full removal rather than a flag flip — see verified-code-plan.md Phase
11's status note. There is no "legacy engine" left to switch away from or migrate later; every
project (new and existing) runs the one pipeline. The `projects.engine` column itself was kept
(not dropped) since the table reads as owned by the hosting platform, not this repo.

## 2. Work deferred inside finished phases

| From | Item | Blocked on |
|---|---|---|
| Phase 7, item 4 | New screens still go through today's screen-builder prompt (gate-checked, but not through `@/kit`), not the coder + `@/kit` + gateway + bounded repair that edits use. | Streaming support in the coder model adapter, so the live-typing UX survives. |
| Phase 8, item 3 | Canvas inline text/style edits: an AST codemod at an `eid` location, run through the gates, no model call. | The canvas inspector (select an element in the preview), which doesn't exist yet. Only the message types (`SelectedElement`, `ElementEdit`, `apply-edit`) are defined. |
| Phase 9, item 3 | Clicking an element in the preview jumps the Code tab to its source lines. | The same canvas inspector. |
| Phase 10, item 4 | `bundleGate()` exists but nothing calls it. | A "publish" action (none exists yet), or Phase 10b. |
| Phase 10 | Uncommitted: device lane, Start/Stop dialog, bundle gate, scripts. | Testing on a real phone (section 3) — now partly done, see below. |
| Found 2026-11-17, Phase 3 eval | Every real project's main screen is already over the 300-line policy gate limit (`clearlist` 510, `rhythm` 980–1232, even the newest "Tickly" 356) — any edit to one almost always trips `file_too_long` on attempt 1 regardless of edit quality. **Fully addressed 2026-11-18**: `lib/agent/prompts.ts` `SCREEN_INSTRUCTIONS` keeps a *newly generated* screen under 280 lines, and `lib/verify/gates/policy.ts`'s line check now only blocks a file for getting *longer* than it already was, so pre-existing oversized screens can be edited again. See section 4. |  — |

## 3. Manual tests not yet run

### Needs a live `AI_API_KEY` top-up

- **Phase 2:** tests 1, 2 and 4: make a small edit, and check that the `VERIFY_DEBUG_FAIL=policy:2` and `policy:9` cases behave as described.
- **Phase 3:** ~~run `npm run eval -- --engine verified --fixture <name>` and keep the baseline numbers.~~ Done, 2026-11-17, against `eval/fixtures/notes.json` (a hand-written fixture, see below): 42% first-pass, 77% committed, 1 real failure out of 26. Baseline recorded in [verified-code-plan.md](verified-code-plan.md) Phase 3. Every later phase is compared against it.
- **Phase 4:**
  - Re-run the eval and compare with Phase 3: more errors should be caught at `tsc`, and gate time should stay under ~2 s per change.
  - Try the "show the habit's category" edit.
  - Check that normal edits still feel fast.
- **Phase 5:**
  - With `VERIFY_DEBUG_INJECT=crash`, the crash never reaches the canvas.
  - The "add a delete button" edit works.
  - Re-run the eval.

### Can be done any time

- **Phase 2:**
  - Test 3: the event stream sends a handful of events, not one per second.
  - Test 5: repair runs at most once per version.

### "To be tested later"

- **Phase 6:**
  - "Add a Settings tab" shows up with an icon (3 tries on a fresh project).
  - Renaming the Profile tab changes only the manifest and layout.
  - The rename survives a later additive rebuild.
  - The tab bar still looks right in the browser preview.
  - Re-run the eval.
- **Phase 7:**
  - A kit-style edit imports from `@/kit`.
  - "Add a map" gets a clear "not supported" answer.
  - "Make it better" gets a question with concrete options.
- **Phase 8:**
  - "Add a scroll to the home screen" finishes in about 10–15 s and changes only that screen.
  - "What screens does my app have?" gets an answer and creates no new version.
- **Phase 9:**
  - Code tab badges are correct: App / Generated / Platform.
  - The Changes tab lists only the touched files, with a readable diff.

### Needs a real phone on the same Wi-Fi

Run `npm run device:deps` once first.

- **Phase 10:**
  - ~~Press Start in "Test on your phone", scan the QR with Expo Go.~~ Done, 2026-11-17, on
    `proj-1794910414759-b2d193` (Android). Found and fixed a real, platform-wide bug in the
    process: the device backend's `useCollection`/`useRecord`/`useSetting` could get stuck
    showing stale data forever under the React Compiler — see
    [verified-code-plan.md](verified-code-plan.md) Phase 10's "Real-device finding" note.
    Fixed in `lib/app-project/templates.ts`; regression-tested in
    `lib/app-project/__tests__/backend-device.test.ts`.
  - Still to check: Stop resets the dialog to "Not running"; tabs sit above the phone's
    navigation bar and have icons; multiple screens; delete an item (only add + live update
    were exercised); `bundleGate()` passes while running and fails readably when stopped.
  - This also covers the device half of Phase 6, test 4: tabs not under the navigation bar.

## 4. Decisions still to make

- **Phase 4:** which `tsc` warning codes to promote to errors. The eval report lists the most frequent ones.
- **Phase 4:** retiring the `autoImport` pre-pass, once first-pass rates show it isn't needed. It logs each import it adds.
- **Phase 7:** what to change in the kit and prompt, based on real editing experience (the
  look-comparison test itself no longer applies — there's no separate legacy app to compare
  against).
- Still open: should `eval/fixtures/notes.json` (hand-written, clean) replace
  `clearlist`/`rhythm` as the primary eval fixture going forward, or should those two be fixed
  (manually decomposed) so eval also covers a realistic, previously-messy app?

**Resolved (2026-11-18, Phase 11):** the policy gate's 300-line check is now lenient on files
already over the limit before an edit — it only blocks a file for getting *longer*
(`lib/verify/gates/policy.ts`). This had to be resolved before migrating real projects onto
verified-only editing; without it, almost every edit to an existing main screen would have
failed outright on attempt 1.

## 5. Found while removing the legacy engine (2026-11-18, Phase 11)

- `latestPlan()` (`lib/agent/orchestrator.ts`) cast the stored `messages.plan` JSON straight to
  `AppPlan` with no validation. 8 of the 13 projects in the database are dead/abandoned (zero
  successfully-built screens) and predate the current plan schema entirely — their stored plan
  has no `appName` at all. Building a manifest for them crashed on `plan.appName.toLowerCase()`.
  Fixed: `latestPlan` now validates each candidate through `normalizePlan` and returns the first
  one that's actually valid, treating an incompatible or malformed stored plan as no plan at
  all rather than crashing. This would have broken editing on those (admittedly dead) projects
  the moment anything tried to touch them, now that there's no legacy edit path to silently
  avoid the manifest step.
- The `projects.engine` column was not dropped — see section 1's note above.
