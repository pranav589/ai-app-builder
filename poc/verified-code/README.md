# Verified-code POC

Proof of concept for the verified-code architecture: the AI writes real React Native
code, the app's structure comes from a manifest, and a change is committed only if it
passes every fast gate. Nothing here touches the main app.

## What it proves

| Claim | Where |
|---|---|
| Navigation, routes, data hooks and theme can be compiled deterministically from a manifest | `src/compiler/compile.ts` |
| A real, strict type check against React Native 0.88's own types runs in well under a second when warm | `src/gates/typecheck.ts` |
| Typed routes and data turn cross-file mistakes (missing screen, wrong params, unknown field, wrong kit prop) into precise type errors | `src/sdk/nav-runtime.tsx`, generated `nav/` and `data/` |
| A render smoke test catches crashes on mount, missing-record crashes, render loops, blank screens and crashing buttons | `src/gates/render.ts` |
| Changes are transactions: HEAD moves only on a passing commit | `src/store/snapshots.ts` |
| A bounded repair loop (max 3 rounds) with structured diagnostics | `src/agent/run.ts` |

## Commands

Run from `poc/verified-code/`. The model commands read `AI_BASE_URL` and `AI_API_KEY`
from the app's `../../.env`. The model is `anthropic/claude-haiku-5.5` unless `POC_MODEL`
or `--model` says otherwise; the main app's `AI_MODEL` is not used.

```sh
npm install --ignore-scripts
npm run selftest                     # 21 gate cases + determinism, no model calls
npm run init                         # commit the base fixture as the first snapshot
npm run change -- "Add a Streaks tab" [--dry] [--model name]
npm run history                      # snapshots from HEAD back
npm run history -- --undo            # move HEAD to its parent
npm run preview                      # HEAD as a tappable phone preview: .data/preview/app.html
npm run eval [-- --model name --only 1,3 --concurrency 4 --focused]
npm run preview -- --eval .data/runs/eval-….json   # gallery of every verified eval result
npm run eval -- --set ceiling        # requests the platform can't fully do: fallback or question?
npm run chain [-- --focused]         # 10 changes stacked on each other, final app previewed
```

The current app is written to `.data/app/` after every commit. Run logs, including every
model output and diagnostic, are in `.data/runs/`.

The eval also runs today's engine's checks (`src/gates/legacy.ts`: syntax, imports, default
export, literal colors, undefined names) on each first output, and reports how many broken
changes those checks would have accepted. `--focused` sends only the files a request names.

## Layout

```
src/core/       contracts, manifest schema + validation + JSON Patch, workspace + ChangeSet apply
src/compiler/   manifest -> nav/index.ts, data/index.ts, theme/index.ts, app/routes.tsx
src/sdk/        @app/kit, @app/theme, @app/data-runtime, @app/nav-runtime, @app/shell
src/gates/      parse + policy, typecheck (warm language service), render (jsdom + react-native-web), pipeline
src/agent/      reply protocol, context builder, model adapter, run state machine
src/store/      content-addressed snapshots and HEAD
fixtures/base/  a 4-screen habit tracker used as the starting app
```

## Known limits of the POC

- The render gate runs on react-native-web in jsdom, not on a device. A Metro bundle gate
  is still needed before publishing.
- Only React and React Native types are real; Expo packages are not in the allowlist yet.
- The context builder sends every app file; a large project needs file selection.
- Snapshots are stored on disk instead of Postgres + S3.
