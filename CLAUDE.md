# CLAUDE.md

Project conventions for anyone (human or AI) working in this repo. Follow these rules in addition to anything in `AGENTS.md` (Next.js version-specific notes, auto-generated — don't remove its block).

## Stack & Repo Layout

The repository is structured as an npm workspaces monorepo:
- **`frontend/`**: Next.js 16 (App Router), React 19, TypeScript (strict), Tailwind CSS v4, shadcn/ui components (`components/ui`). Pure UI layer, client-only data fetching, no database, no server secrets.
- **`backend/`**: Express 5 REST API, Drizzle ORM + Postgres (`backend/db/`), services (`backend/src/services/`), routes & controllers (`backend/src/routes/`, `backend/src/controllers/`), Vitest for tests, better-auth for authentication.
- **`shared/` (`@app/shared`)**: Pure TypeScript schemas, types, and logic shared between frontend and backend. Zero Node APIs, zero database, zero React.

## Architectural Boundaries

Enforced strictly with ESLint (`no-restricted-imports`) and CI checks:
1. **`frontend` never imports `backend`**, and **`backend` never imports `frontend`**.
2. **`shared` imports nothing from either side**, and has no `node:*`, `pg`, or `react` imports.
3. **`controllers` never touch `db` directly** — controllers only handle HTTP (params/body), call domain services in `services/`, and send JSON responses.
4. **`services` never import `express`** — services contain pure business logic and throw typed errors (e.g. `AppBackendError`, `NotFoundError`).
5. **No `server-only` in backend** — backend runs as a standalone Express server.

## Code style rules

1. **Keep files small.** A file doing too many things should be split by responsibility (e.g. route handler vs. controller vs. business logic vs. db queries). If a file is hard to summarize in one sentence, split it.
2. **No duplicated logic.** If the same code (or near-identical code) appears in two or more places, extract it into a shared function/hook/util instead of copy-pasting. Check `shared/` and `hooks/` for an existing helper before writing a new one.
3. **No overengineering.** Don't add abstractions, config options, or indirection for cases that don't exist yet. Prefer the direct, obvious solution over a "flexible" one unless there's a concrete current need for the flexibility.
4. **Use React Query + Axios for all API calls from client components.** Don't call `fetch` directly from components/hooks for data fetching or mutations — wrap it in a `useQuery`/`useMutation` hook backed by `apiClient` (`frontend/lib/api-client.ts`). Keep the shared Axios instance configured with `withCredentials: true` and `baseURL: process.env.NEXT_PUBLIC_API_URL`.
5. **Server-side frontend code** (SSR pages in `frontend/app/workspace/[projectId]` and `frontend/app/p/[slug]`) calls the Express backend via `lib/server-api.ts` (`serverFetch`), forwarding cookies. No direct DB access or backend imports in `frontend/`.
6. **Co-locate tests** in `__tests__` folders next to the code they test (e.g. `backend/src/services/*/__tests__`, `backend/src/controllers/__tests__`, `shared/*/__tests__`).
7. **Prefer editing existing files** over creating new ones; don't scaffold new folders/abstractions speculatively.
8. **No dead code.** Delete unused exports, components, and files instead of commenting them out or prefixing with `_`.
9. **Types over `any`.** This project runs `strict` TypeScript — don't introduce `any` or `@ts-ignore` to silence errors; fix the underlying type issue.
10. **Comments explain "why", not "what".** Only comment non-obvious constraints, workarounds, or invariants — not what the code visibly does.

## Running Locally

- **`npm run dev`**: Runs `frontend` (`next dev`, port 3000), `backend` (`tsx watch src/index.ts`, port 4000), and preview-runtime watcher concurrently.
- **`npm run build`**: Builds both `backend` (`tsc`) and `frontend` (`scripts/build-preview.mjs` + `next build`).
- **`npm test`**: Runs Vitest test suites across all workspaces.
- **`npm run lint`**: Runs ESLint boundary checks and linting across the monorepo.

## Database changes

All schema changes go through a migration — never a manual/ad-hoc change against the live database. Run these from root:
- **`npm run db:generate`**: Generates migrations in `backend/drizzle/` from `backend/db/schema.ts`.
- **`npm run db:push`**: Applies Drizzle migrations to the database.
- **`npm run db:sql`**: Applies hand-written idempotent `.sql` files in `backend/db/sql/`.

## Keeping docs in sync

This repo has living reference docs under `docs/`:
- `docs/architecture.md` — system architecture, subsystems, diagrams
- `docs/codebase-walkthrough.md` — feature-by-feature tour (what a feature does, which files implement it)
- `docs/api-reference.md` — every Express API route (`/api/...`) with sample request/response payloads

Whenever a change touches one of the following, update the matching doc as part of the same change:
- **Architecture change** (new subsystem, changed data/control flow, new major dependency) → update `docs/architecture.md`
- **Codebase feature change** (a feature's behavior changes, or files implementing it move/are added/removed) → update `docs/codebase-walkthrough.md`
- **API change** (new/removed/renamed route, changed request or response shape, changed status codes) → update `docs/api-reference.md`

## Before committing

- Run `npm run test` for backend and shared logic.
- Run `npm run lint` for ESLint boundary rules across all workspaces.
- Run `npm run build` to confirm TypeScript and production builds succeed.
