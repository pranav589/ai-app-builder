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
| Phase 10, item 4 | `bundleGate()` exists but nothing calls it. | A "publish" action (none exists yet), or Phase 10b. |
| Phase 10 | Uncommitted: device lane, Start/Stop dialog, bundle gate, scripts. | Testing on a real phone (section 3) — now partly done, see below. |
| Found 2026-11-17, Phase 3 eval | Every real project's main screen is already over the 300-line policy gate limit (`clearlist` 510, `rhythm` 980–1232, even the newest "Tickly" 356) — any edit to one almost always trips `file_too_long` on attempt 1 regardless of edit quality. **Fully addressed 2026-11-18**: `lib/agent/prompts.ts` `SCREEN_INSTRUCTIONS` keeps a *newly generated* screen under 280 lines, and `lib/verify/gates/policy.ts`'s line check now only blocks a file for getting *longer* than it already was, so pre-existing oversized screens can be edited again. See section 4. |  — |

## 3. Manual tests

All manual tests across every phase were run and confirmed by the user (2026-11-18), as of that
point in the plan.

**New since then:**
- Phase 7 item 4 (needs a live `AI_API_KEY`): new-screen generation rewritten to go through the
  verified coder + `@/kit` + gateway, with streaming restored — see verified-code-plan.md
  Phase 7's status note. Its own manual test 1 (and the "new screen" half of test 2) needs
  re-running against this new code path: create a fresh project and confirm screens still
  stream into view live and come out built from `@/kit`.
- Phase 8 item 3 (no AI involved, can be done any time): the canvas inspector UI (an "Inspect"
  toggle in the Preview toolbar, tap an element, edit its text/style in the panel that appears)
  is built but not yet clicked through by hand — see verified-code-plan.md Phase 8's user test 3.
- Phase 9 item 3 (no AI involved, can be done any time), done 2026-11-18: the inspector's "View
  in Code tab" button — tap an element, press the code icon, confirm the Code tab opens to the
  right file and line. See verified-code-plan.md Phase 9's user test 3.

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
