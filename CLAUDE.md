# CLAUDE.md

Project conventions for anyone (human or AI) working in this repo. Follow these rules in addition to anything in `AGENTS.md` (Next.js version-specific notes, auto-generated — don't remove its block).

## Stack

- Next.js 16 (App Router), React 19, TypeScript (strict)
- Tailwind CSS v4, shadcn/ui components (`components/ui`)
- Drizzle ORM + Postgres (`db/`)
- Vitest for tests
- better-auth for authentication

## Code style rules

1. **Keep files small.** A file doing too many things should be split by responsibility (e.g. route handler vs. business logic vs. db queries). If a file is hard to summarize in one sentence, split it.
2. **No duplicated logic.** If the same code (or near-identical code) appears in two or more places, extract it into a shared function/hook/util instead of copy-pasting. Check `lib/` and `hooks/` for an existing helper before writing a new one.
3. **No overengineering.** Don't add abstractions, config options, or indirection for cases that don't exist yet. Prefer the direct, obvious solution over a "flexible" one unless there's a concrete current need for the flexibility.
4. **Use React Query + Axios for all API calls from client components.** Don't call `fetch` directly from components/hooks for data fetching or mutations — wrap it in a `useQuery`/`useMutation` hook backed by an Axios client. Keep a shared Axios instance (base URL, interceptors) in one place rather than instantiating per-call.
5. **Server-side code** (route handlers in `app/api/**`, server actions, scripts) uses plain `fetch`/direct DB calls as appropriate — the React Query + Axios rule applies to client-side data fetching, not server internals.
6. **Co-locate tests** in `__tests__` folders next to the code they test (matches current convention under `lib/*/__tests__`).
7. **Prefer editing existing files** over creating new ones; don't scaffold new folders/abstractions speculatively.
8. **No dead code.** Delete unused exports, components, and files instead of commenting them out or prefixing with `_`.
9. **Types over `any`.** This project runs `strict` TypeScript — don't introduce `any` or `@ts-ignore` to silence errors; fix the underlying type issue.
10. **Comments explain "why", not "what".** Only comment non-obvious constraints, workarounds, or invariants — not what the code visibly does.

## Keeping docs in sync

This repo has three living reference docs under `docs/` (each also has a companion
Claude Artifact):

- `docs/architecture.md` — system architecture, subsystems, diagrams
- `docs/codebase-walkthrough.md` — feature-by-feature tour (what a feature does, which files implement it)
- `docs/api-reference.md` — every `app/api/**` route with sample request/response payloads

Whenever a change touches one of the following, update the matching doc (and its
artifact) as part of the same change, not as a follow-up:

- **Architecture change** (new subsystem, changed data/control flow, new major dependency) → update `docs/architecture.md`
- **Codebase feature change** (a feature's behavior changes, or files implementing it move/are added/removed) → update `docs/codebase-walkthrough.md`
- **API change** (new/removed/renamed route, changed request or response shape, changed status codes) → update `docs/api-reference.md`

Don't let these drift — a stale doc is worse than no doc.

## Before committing

- Run `npm run test` for anything touching `lib/` logic.
- Run `npm run lint` for anything touching `app/` or `components/`.
- Don't commit `AGENTS.md` changes made by `next dev` unless they're part of your diff anyway (see note at the top of that file).
