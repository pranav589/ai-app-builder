# API Reference

All REST endpoints hosted by the Express 5 backend under `/api/**` (at `http://localhost:4000` locally). The URL paths and contracts are identical to the original routes, ensuring client compatibility while preparing for future mobile clients. Keep this doc in sync with the code — see the "Keeping docs in sync" section in [`CLAUDE.md`](../CLAUDE.md).

An interactive version of this doc was also published as a Claude Artifact.

## Cross-cutting conventions

- **Base URL**: `http://localhost:4000` (or `process.env.NEXT_PUBLIC_API_URL` on the frontend).
- **Auth**: Authenticated routes require user session via `ch_session` cookie or `Authorization: Bearer <token>` (supported for future mobile clients). Handled by `backend/src/middleware/auth.ts`. Returns `401` if signed out, `404` if project doesn't exist or isn't owned by the user, and `503` if database is unreachable.
- **CSRF guard**: Mutating routes validate request origin / content type headers.
- **Error shape**: JSON error responses are `{"error": string}`, optionally with extra fields (`fieldErrors`, `extraFiles`, `reconnect`).
- **Layered Architecture**: Express Router (`backend/src/routes/*`) -> Controller (`backend/src/controllers/*`) -> Domain Services (`backend/src/services/*`) -> Database (`backend/db/*`). Controllers never touch the DB directly.

---

## Projects

### `GET /api/projects/:projectId/workspace`
Assembles all project data required for workspace SSR loading and initial hydration (project details, initial message history, signed asset URLs, backend info, feature flags).

- **Auth**: required (401 if signed out, 404 if not found/unauthorized)
- **Request**: none

**Response 200**
```json
{
  "project": {
    "id": "proj-1700000000000-a1b2c3",
    "name": "Recipe Tracker",
    "prompt": "Build a recipe tracker app",
    "status": "ready",
    "createdAt": "2026-11-10T12:00:00.000Z",
    "themeColor": "#8b5cf6",
    "previewScreens": { "v": 2, "screens": ["..."] },
    "isPublic": false,
    "publicSlug": null
  },
  "initialMessages": [],
  "signedAssetUrls": {},
  "backendProviders": [{ "id": "cloudhike", "configured": true, "accountConnected": true }],
  "hasBackend": false,
  "backendInfo": null,
  "hasGitHub": false,
  "hasExpo": false,
  "flags": {
    "enableCustomDomain": false,
    "enableCustomCode": true
  }
}
```

---

### `GET /api/projects`
List the current user's projects.

- **Auth**: required (401 if signed out)
- **Request**: none

**Response 200**
```json
{
  "projects": [
    {
      "id": "proj-1700000000000-a1b2c3",
      "name": "Recipe Tracker",
      "prompt": "Build a recipe tracker app",
      "status": "ready",
      "createdAt": "2026-11-10T12:00:00.000Z",
      "assetCount": 1,
      "themeColor": "#8b5cf6",
      "previewScreens": { "v": 2, "screens": ["..."] },
      "isPublic": false,
      "publicSlug": null
    }
  ]
}
```

**Error 503**
```json
{ "error": "We're having trouble reaching our servers. Please try again in a moment." }
```

---

### `PATCH /api/projects/[projectId]`
Renames a project.

- **Auth**: required; must own the project (404 otherwise)
- **Request**: `{ "name": string }`

**Response 200**
```json
{ "ok": true, "name": "New name" }
```

---

### `DELETE /api/projects/[projectId]`
Deletes a project. Dependent rows (messages, snapshots, builds, backend,
GitHub link, web deployments...) cascade via FK constraints; uploaded assets
are removed from storage after the row is deleted.

- **Auth**: required; must own the project (404 otherwise)

**Response 200**
```json
{ "ok": true }
```

---

### `POST /api/projects/[projectId]/duplicate`
Clones a project (screens, assets list, engine...) into a new, private project
owned by the same user.

- **Auth**: required; must own the source project (404 otherwise)

**Response 200**
```json
{ "project": { "id": "proj-1700000000111-d4e5f6", "name": "Recipe Tracker (copy)", "...": "same shape as GET /api/projects" } }
```

---

### `PATCH /api/projects/[projectId]/visibility`
Turns public sharing on or off. A public project appears in the signed-out
homepage gallery and is viewable (read-only preview data) via its public slug,
without auth. Enabling it the first time generates a `publicSlug`, which is
kept (not rotated) across future toggles.

- **Auth**: required; must own the project (404 otherwise)
- **Request**: `{ "isPublic": boolean }`

**Response 200**
```json
{ "isPublic": true, "publicSlug": "app-9f8e7d6c5b", "publicUrl": "https://example.com/p/app-9f8e7d6c5b" }
```

---

### `GET /api/public/projects`
Public, unauthenticated list of projects their owners have made public, for
the signed-out homepage gallery. Only public-safe fields are returned (no
`prompt`, `assets`, or `userId`).

- **Auth**: none

**Response 200**
```json
{
  "projects": [
    { "id": "proj-...", "name": "Recipe Tracker", "tagline": null, "themeColor": "#8b5cf6", "previewScreens": { "...": "..." }, "publicSlug": "app-9f8e7d6c5b" }
  ]
}
```

---

### `GET /api/public/projects/[slug]`
Public, unauthenticated preview payload for one public project — everything
the sandboxed preview runtime (`AppRuntimeProvider`/`RuntimeFrame`) needs to
run the app interactively against a fresh local backend. 404s if the slug
doesn't exist or the project has since been made private.

- **Auth**: none

**Response 200**
```json
{
  "id": "proj-...",
  "name": "Recipe Tracker",
  "themeColor": "#8b5cf6",
  "screens": ["..."],
  "themes": { "themes": ["..."], "activeId": "light", "hash": "..." },
  "dataModel": { "collections": ["..."], "settings": {}, "user": { "name": "Alex" }, "hash": "..." },
  "files": { "app/_layout.tsx": "..." }
}
```

**Error 404**
```json
{ "error": "This app isn't available." }
```

---

### `POST /api/projects`
Create a project from a prompt (+ optional assets). This is what the homepage
prompt box submits to.

- **Auth**: required
- **Request**: `multipart/form-data` (not JSON) — `prompt` (string), `assets`
  (repeatable file fields, bounded by count and total size)

**Sample request** (form fields)
```
prompt=Build a recipe tracker app with photo uploads
assets=<file1.png>
assets=<file2.png>
```

**Response 200**
```json
{ "projectId": "proj-1700000000000-a1b2c3" }
```

**Error 413**
```json
{ "error": "Those files are too large to upload together." }
```

**Notes**: uploads land in storage first, then the `projects` + first `messages`
row are inserted in one DB transaction (`engine` is always `"verified"`). If the
DB insert fails, already-uploaded files are deleted.

---

## Agent

### `POST /api/projects/[projectId]/agent`
The main driver — chat, plan approval, and backend-connect all go through this
one endpoint. **Response is a Server-Sent Events stream**, not a single JSON body.

- **Auth**: required + project ownership
- **Request body**: `{ action, text?, screenId?, element?, provider?, services? }` (`provider` is a backend provider id from `shared/app-backend/providers.ts`, default `"cloudhike"`; used by `action: "backend"`)

**Sample request — chat message**
```json
{ "action": "message", "text": "Make the login screen use a card layout", "screenId": "login" }
```

**Sample request — approve a plan**
```json
{ "action": "approve", "text": "Looks good, start building." }
```

**Sample request — connect backend**
```json
{ "action": "backend", "provider": "cloudhike", "services": ["postgres", "auth", "storage"] }
```

**Response**: `text/event-stream`, one JSON event per line, union of event types
from `lib/agent/types.ts`:
```
data: {"type":"phase","phase":"planning"}

data: {"type":"status","text":"Thinking about your app...","since":1731941400000}

data: {"type":"text","id":"msg_1","delta":"I'll build a "}

data: {"type":"plan_progress","screens":["Home","Login","Profile"]}

data: {"type":"screen_start","id":"home","index":0,"total":3}

data: {"type":"screen_delta","id":"home","delta":"export default function Home() {"}

data: {"type":"screen_done","screen":{"id":"home","code":"...","state":"ready"}}

data: {"type":"run_state","state":"verifying","round":1}

data: {"type":"attempt","n":1,"modelMs":2400,"gatesMs":600,"ok":true}

data: {"type":"done"}
```

**Error responses** (returned as plain JSON instead of a stream, before a run starts)
```json
{ "error": "The agent is still working. Wait for it to finish, then send your message." }
```
Other cases: `400` bad request / empty message / message too long, `401` signed
out, `404` project not found, `409` plan not ready to approve / backend not
connected yet (`{"error": "...", "reconnect": true}`), `404` unknown backend `provider`, `503` unavailable.

**Notes**: `maxDuration = 800`. One run per project is enforced by a DB mutex
(`lib/agent/run-store.ts`); dispatches to the job queue (`lib/jobs`, Cloudhike Jobs today) in production,
runs inline in dev.

---

### `POST /api/projects/[projectId]/canvas-edit`
Save the Canvas inline edits made in one Edit Mode session (sent when the user clicks
**Done**) — **no AI model call**. Each edit is an AST codemod on the JSX element at its
`eid`; everything that could be placed is verified once and committed as one version.

- **Auth**: required + ownership
- **Request body**: `{ edits: Array<{ eid, text?, from?, style?, imageSrc? }> }` — 1 to 100
  edits, each with at least one of `text`, `style` (editable keys only) or `imageSrc`.
  `from` is the element's text as it is in the source, so a text edit targets exactly that text.

**Sample request**
```json
{
  "edits": [
    { "eid": "app/(tabs)/home.tsx:42:Text", "text": "Welcome back!", "from": "Welcome" },
    { "eid": "app/(tabs)/home.tsx:50:View", "style": { "backgroundColor": "#f5f5f5", "padding": "16px" } }
  ]
}
```

**Response 200** — the new code of every file that changed. `failed` lists edits the
codemod couldn't place; they were skipped, the rest were saved.
```json
{
  "files": { "app/(tabs)/home.tsx": "export default function Home() { … }" },
  "version": 12,
  "failed": [{ "eid": "app/(tabs)/home.tsx:60:Text", "error": "That text comes from data or code, not a fixed string, so it can't be edited here. Ask in chat instead." }]
}
```
May also include `extraFiles` (`{ path: code }`): a platform file (the kit) the project's
copy predates, for the preview to pick up.

**Error 422** — nothing was saved: no edit could be placed, or the combined change failed
verification (all-or-nothing).
```json
{ "error": "Nothing to change.", "failed": [], "extraFiles": { "kit/index.tsx": "…" } }
```
Other cases: `400` malformed body, `409` agent busy, `500` generic failure.

---

### `POST /api/projects/[projectId]/repair`
Self-repair after a runtime crash in the preview.

- **Auth**: required + ownership
- **Request body**: `{ path: string, message: string }` (message ≤ 1000 chars, `path` can't contain `..`)

**Sample request**
```json
{ "path": "screens/profile.tsx", "message": "TypeError: Cannot read properties of undefined (reading 'name')" }
```

**Response 200 — fixed**
```json
{ "fixed": true }
```

**Response 200 — already tried**
```json
{ "fixed": false, "reason": "already_tried" }
```

**Notes**: `maxDuration = 300`. At most one repair attempt per
`(project, version, path)` tuple is enforced server-side.

---

## Versions

### `GET /api/projects/[projectId]/versions`
List version history.

**Response 200**
```json
{
  "current": 7,
  "versions": [
    { "version": 7, "intent": "generate", "author": "usr_123", "createdAt": "2026-11-10T12:10:00.000Z" },
    { "version": 6, "intent": "edit", "author": "usr_123", "createdAt": "2026-11-10T12:05:00.000Z" }
  ]
}
```

### `GET /api/projects/[projectId]/versions/[version]/diff`
Diff a specific version against its parent.

**Response 200**
```json
{
  "version": 5,
  "parentVersion": 4,
  "intent": "edit",
  "files": {
    "screens/home.tsx": { "type": "modified", "before": "...", "after": "..." }
  }
}
```

**Error 400**: `version` path param isn't a positive integer.

### `POST /api/projects/[projectId]/versions/[version]/restore`
Restore an older version. **Non-destructive** — creates a *new* version on top of
history rather than rewriting it.

**Response 200**
```json
{ "version": 8 }
```

**Error 409**
```json
{ "error": "The agent is working on this project right now. Wait for it to finish, then restore." }
```

---

## Theme

### `PATCH /api/projects/[projectId]/theme`
Switch the active theme.

**Sample request**
```json
{ "themeId": "dark-forest" }
```

**Response 200**
```json
{ "ok": true, "themeId": "dark-forest" }
```

**Error 404**
```json
{ "error": "That theme doesn't exist." }
```

**Notes**: patches only `previewScreens.themes.activeId` via `jsonb_set`, so it
never conflicts with a concurrent build writing screens.

---

## Backend (pluggable providers)

An app's backend runs on a **provider** (`shared/app-backend/providers.ts`; only `cloudhike`
today). The routes below are the same for every provider: the server looks up which provider
the app is on and hands the work to that provider's adapter.

### `GET /api/projects/[projectId]/backend`
Backend connection status: which providers this creator has linked, and this app's backend.

**Response 200**
```json
{
  "providers": [{ "id": "cloudhike", "configured": true, "accountConnected": true }],
  "backend": {
    "provider": "cloudhike",
    "status": "ready",
    "projectId": "ch_proj_1",
    "projectName": "recipe-tracker-backend",
    "services": ["postgres", "auth"],
    "error": null,
    "connectedAt": "2026-11-10T12:05:00.000Z"
  }
}
```
Never returns credentials.

### `DELETE /api/projects/[projectId]/backend`
Disconnect the backend (keeps the actual project/data on the provider intact). `forgetAccount`
also forgets this creator's link to that provider.

**Sample request**
```json
{ "forgetAccount": true }
```

**Response 200**
```json
{ "ok": true }
```

**Error 409**
```json
{ "error": "The agent is working on this app. Try again when it's done." }
```

---

### `POST /api/projects/[projectId]/backend/data`
Generic data-access endpoint the *builder's own preview* calls at runtime (op-based RPC).
Requires the creator's session (same-origin JSON). Built apps (APK, Expo Go, web deploy,
exports) use `POST /api/app-runtime/[projectId]/data` below instead.
End-user auth for the generated app travels via the `x-app-session` header.

- **Request body**: `{ op, collection?, id?, ...op-specific fields }`
  Ops: `init`, `snapshot`, `version`, `list`, `get`, `insert`, `update`, `remove`,
  `settings`, `setSetting`, `upload`, `auth.current`, `auth.signUp`, `auth.signIn`,
  `auth.signOut`, `auth.resetPassword`.

**Sample request — list**
```json
{ "op": "list", "collection": "recipes" }
```

**Sample request — insert**
```json
{ "op": "insert", "collection": "recipes", "values": { "title": "Pasta", "minutes": 20 } }
```

**Sample request — sign in (generated app's end user)**
```json
{ "op": "auth.signIn", "email": "user@example.com", "password": "secret" }
```

**Response 200**
```json
{ "result": { "id": "rec_1", "title": "Pasta", "minutes": 20 } }
```

**Error 503**
```json
{ "error": "The app's database is waking up. Try again in a moment." }
```
Other cases: `400` unknown op, `409` app not connected to a backend.

**Notes**: `snapshot` op batches multiple reads (`collections[]`, `settings`,
`auth.current`, `version`) into one response. `init` (creator only) creates/updates the
database tables for the app's data model. Every other op is run by the provider-neutral
dispatcher in `lib/app-backend/app-ops.ts` (shared with the public route below) on the
provider's `AppServices`.

---

### `POST /api/app-runtime/[projectId]/data`
The data, auth and storage calls of a **built app** (APK, Expo Go preview, web deploy,
ZIP/GitHub export). Same op-based RPC as the route above, but it's public and cross-origin
(`Access-Control-Allow-Origin: *`, `OPTIONS` preflight answered with 204): nothing is
authorized by cookies. The caller proves itself with the project's app key.

- **Auth**: header `x-app-key` must equal the key stored for the project (`app_backends.app_key`,
  minted the first time a connected project is built or exported). End users add
  `x-app-session` (their token from the provider's auth) as usual.
- **Ops**: same as above except `init` (rejected as an unknown operation; schema setup stays
  creator-only).
- **Limits**: only collections the app's data model declares (`404 Unknown collection.` on
  others; a `snapshot` returns `[]` for them); 240 requests/minute per project and caller IP (`429`).

**Sample request**
```http
POST /api/app-runtime/p_123/data
x-app-key: <app key>
x-app-session: <end-user token, optional>
content-type: application/json

{ "op": "snapshot", "collections": ["recipes"] }
```

**Response 200**
```json
{ "result": { "collections": { "recipes": [] }, "settings": {}, "user": null, "version": 12 } }
```

**Errors**: `403` missing/wrong key or app not connected (disconnecting the backend deletes the
row, which revokes the key), `404` unknown collection, `429` rate limited, `503` database waking
up. Responses never include internal error details.

---

### REST routes (built app, same auth as the route above)
What a **connected** app's `lib/api.ts` (an Axios instance; `lib/app-project/api-client.ts`) actually
calls, generated since the state-management redesign -- a pre-redesign app still calls the single
`POST /data` route above instead. Same auth, rate limit and `declaredOnly` as that route (each maps
onto the identical `{ op, ...args }` dispatcher through `handleRuntimeDataOp`), but each answers with
the bare resource, not an `{ "result": ... }` envelope.

| Method & path | Op | Request body | Response |
|---|---|---|---|
| `GET /api/app-runtime/[projectId]/collections/:name` | `list` | — | `Record[]` |
| `POST /api/app-runtime/[projectId]/collections/:name` | `insert` | the record's fields | the created `Record` |
| `GET /api/app-runtime/[projectId]/collections/:name/:id` | `get` | — | `Record \| null` |
| `PATCH /api/app-runtime/[projectId]/collections/:name/:id` | `update` | the patch | the updated `Record` |
| `DELETE /api/app-runtime/[projectId]/collections/:name/:id` | `remove` | — | `null` |
| `GET /api/app-runtime/[projectId]/settings` | `settings` | — | the settings object |
| `PUT /api/app-runtime/[projectId]/settings/:key` | `setSetting` | `{ "value": ... }` | `null` |
| `POST /api/app-runtime/[projectId]/auth/sign-up` | `auth.signUp` | `{ name?, email, password }` | `{ token, user }` |
| `POST /api/app-runtime/[projectId]/auth/sign-in` | `auth.signIn` | `{ email, password }` | `{ token, user }` |
| `POST /api/app-runtime/[projectId]/auth/sign-out` | `auth.signOut` | — | `null` |
| `POST /api/app-runtime/[projectId]/auth/reset-password` | `auth.resetPassword` | `{ email }` | `null` |
| `GET /api/app-runtime/[projectId]/auth/me` | `auth.current` | — | `AppUser \| null` |
| `POST /api/app-runtime/[projectId]/uploads` | `upload` | `{ dataUrl, name? }` | `{ url }` |

**Sample request — insert**
```http
POST /api/app-runtime/p_123/collections/recipes
x-app-key: <app key>
content-type: application/json

{ "title": "Pasta", "minutes": 20 }
```

**Response 200**
```json
{ "id": "rec_1", "title": "Pasta", "minutes": 20, "createdAt": "2026-01-01T00:00:00.000Z" }
```

**Errors**: same shape as `POST /data` above (`{ "error": "..." }`), same status codes. A
ZIP/GitHub export's self-host server (`server/index.ts`) answers the identical routes, mapped by
hand (no Express there) in `cloudhike/self-host.ts` `SERVER_INDEX`.

---

### `GET /api/backend-providers/:provider/connect`
Start linking the creator's account on `provider` (e.g. `cloudhike`), an OAuth-like flow.
**Always a redirect**, not JSON. (Was `GET /api/cloudhike/connect`.)

- **Request**: query params `projectId` (required), `services` (comma list), `reconnect` ("1")
- **Response**: `303` redirect to the provider's authorize URL, or back to the
  workspace with `?provider=...&backend=connected` / `?provider=...&backend=error&reason=...`.
  Unknown `provider`: `404`.

### `GET /api/backend-providers/:provider/callback`
OAuth callback, the URL registered with the provider. **Always a redirect.**
(Was `GET /api/cloudhike/callback`; the URL registered with CloudHike must be updated, or
`CLOUDHIKE_REDIRECT_URI` set.)

- **Request**: query params `code`, `state`, or `error`
- **Response**: `303` redirect to `/` (not signed in), `/?backend=expired` (state cookie
  missing/expired/for another provider), or
  `/workspace/{projectId}?provider=...&backend=connected&services=...` /
  `?provider=...&backend=error&reason=denied|failed|expired|not_configured`

---

## Device preview

### `GET /api/projects/[projectId]/device`
Device lane status. **Dev-only — 404 in production.**

**Response 200**
```json
{ "status": "running", "url": "exp://192.168.1.50:8081" }
```

### `POST /api/projects/[projectId]/device`
Export the project and start a local Metro/Expo process.

**Response 200**
```json
{ "status": "starting" }
```

**Error 409**
```json
{ "error": "Metro port 8081 is already in use." }
```

### `DELETE /api/projects/[projectId]/device`
Stop the device lane (only if this project owns the currently running one).

**Response 200**
```json
{ "status": "stopped" }
```

---

## Hosted device preview (Phase 10b)

"Test on your phone" currently always uses this flow (not just production) -- see
`docs/verified-code-plan.md` Phase 10b. Unlike the dev-only lane above, no shared Wi-Fi is
needed: the phone downloads a prebuilt bundle from S3 via the public manifest route below,
rather than connecting to a locally-running Metro.

### `GET /api/projects/[projectId]/status-stream`
Server-Sent Events (`text/event-stream`) that tells the client when a project's builds, web deployment or device build changed. It carries no row data: the client refetches the relevant `GET` above.

- **Auth**: required (user must own project; browsers send the session cookie via `EventSource` with `withCredentials`)

**Events** (`data:` lines; `: ping` comments every 15s keep proxies from closing the stream)
```json
{ "table": "builds" }
```
`table` is one of `builds`, `web_deployments`, `web_deploy_runs`, `device_builds`.
```json
{ "resync": true }
```
Sent when the backend's database listener reconnected, so changes may have been missed: refetch everything.

### `GET /api/projects/[projectId]/device-build`
Current build status for this project (auth required, owner only).

**Response 200**
```json
{
  "status": "ready",
  "error": null,
  "stale": false,
  "manifestUrl": "exp://192.168.1.50:3000/api/device/proj-abc123/manifest"
}
```
`status` is `"none" | "building" | "ready" | "failed"`. `manifestUrl` is only present when
`status` is `"ready"`. `stale` is true once `projects.current_version` has moved past the
version this build was made from (a "Rebuild" prompt in the dialog, not an error).

### `DELETE /api/projects/[projectId]/device-build`
Stops a device build that is still `building`: kills its `expo export` if it runs in this backend process, and marks the row `failed` with `"Stopped by you."` (a build orphaned by a backend restart is released the same way).

- **Auth**: required (user must own project)

**Response 200**: the same shape as `GET` (`{"status": "failed", "error": "Stopped by you.", ...}`)

**Errors**: `404` project not found, `409` (`not_running`) when no build is running.

### `POST /api/projects/[projectId]/device-build`
Starts a build (`npx expo export` on the project's current files, uploaded to S3) if one
isn't already running; no-ops otherwise. Returns immediately with the same shape as the `GET`
above (usually `{"status": "building"}` on the first response) -- follow `GET` (kept fresh by `status-stream`) for completion.

### `GET /api/device/[projectId]/manifest`
**Public, unauthenticated.** What the QR code / "Enter URL manually" link in Expo Go actually
opens (`exp://<host>/api/device/[projectId]/manifest`). Reads the `expo-platform` request header
(`ios` or `android`, defaulting to `android`) and returns an Expo Updates protocol manifest
(`multipart/mixed`, a `manifest` JSON part and an empty `extensions` part) pointing at presigned
S3 URLs for that platform's bundle and assets. 404s (plain text, not a manifest) when the
project has no ready build yet, or no export for the requested platform.

---

## Export

### `GET /api/projects/[projectId]/export/zip`
Download the full project as a standalone, runnable Expo project in a `.zip` archive.

- **Auth**: required (401 if signed out, 404 if project not owned)
- **Response 200**: Binary zip stream with headers:
  - `Content-Type: application/zip`
  - `Content-Disposition: attachment; filename="<project-slug>.zip"`
  - `Cache-Control: no-store`
- **Connected apps generated since the state-management redesign**: the stored project already has
  `lib/api.ts`/`lib/api-config.ts` and screens calling the REST routes above (connecting a backend
  converts them -- see `docs/architecture.md` §6), so the zip just contains those files as stored;
  nothing is swapped at export time. It still includes the provider's self-host files: `server/`
  (a self-host server answering the same REST routes, `cloudhike/self-host.ts`), `server/.env.example`,
  `.env.example` and a README section with step-by-step instructions for running either way.
- **Connected apps generated before the redesign**: if the project still carries a legacy
  `lib/backend/index.ts` and its backend is connected (any provider), `lib/backend/index.ts` is
  swapped at export time for the one that calls the legacy `/api/app-runtime/[projectId]/data`
  route (with `lib/backend/config.ts` holding the endpoint and app key); the zip gets the same
  self-host files as above. `GET/POST /api/projects/[projectId]/github*` export the same file set
  either way.

---

## GitHub Export

### `GET /api/github/connect`
Initiate GitHub OAuth flow with `repo` scope. Sets signed `gh_connect` state cookie and redirects to GitHub.

- **Query**: `?projectId=<projectId>&reconnect=1`
- **Response 303**: Redirects to `https://github.com/login/oauth/authorize?...`

### `GET /api/github/callback`
GitHub OAuth callback handler. Verifies state against `gh_connect` cookie, exchanges code for token, fetches user profile, and stores encrypted token in `github_connections`.

- **Query**: `?code=<code>&state=<state>` (or `?error=access_denied&state=...`)
- **Response 303**: Redirects to `/workspace/<projectId>?github=connected` (or `?github=error&reason=...`)

### `GET /api/github/status`
Check whether GitHub export is configured on the server and whether the current user has connected their account.

- **Auth**: optional
- **Response 200**
```json
{
  "configured": true,
  "connected": true,
  "login": "octocat"
}
```

### `GET /api/github/repos`
List repositories accessible to the connected GitHub user for the repository picker.

- **Auth**: required (401 if signed out or token revoked/expired)
- **Response 200**
```json
{
  "repos": [
    {
      "id": 123456,
      "name": "my-mobile-app",
      "full_name": "octocat/my-mobile-app",
      "owner": { "login": "octocat" },
      "private": true,
      "default_branch": "main",
      "html_url": "https://github.com/octocat/my-mobile-app"
    }
  ]
}
```
- **Error 401**
```json
{ "error": "reconnect" }
```

### `GET /api/projects/[projectId]/github`
Fetch current GitHub repository linkage and server-computed suggested commit message for a project.

- **Auth**: required (401 if signed out, 404 if project not found)
- **Response 200**
```json
{
  "link": {
    "projectId": "proj-123",
    "userId": "usr_abc",
    "repoOwner": "octocat",
    "repoName": "my-mobile-app",
    "lastBranch": "main",
    "lastCommitSha": "6dcb09b5b57875f334f61aebed695e2e4193db5e",
    "updatedAt": "2026-11-19T12:00:00.000Z"
  },
  "suggestedMessage": "Update my-mobile-app: 24 files"
}
```
If unlinked: `"link": null`, `"suggestedMessage": "Export my-mobile-app: 24 files"`.

### `POST /api/projects/[projectId]/github/push`
Push full project to GitHub, streaming real-time SSE progress events.

- **Auth**: required (401 if signed out, 404 if project not found, 409 if GitHub not connected)
- **Headers**: `Content-Type: application/json`
- **Request (Create New Repo)**
```json
{
  "target": { "kind": "create", "name": "my-new-app", "private": true },
  "branch": { "mode": "existing" },
  "message": "Export my-new-app: 24 files"
}
```
- **Request (Existing Linked Repo / New Branch)**
```json
{
  "target": { "kind": "existing", "owner": "octocat", "name": "my-mobile-app" },
  "branch": { "mode": "new", "name": "export-20261119-1400" },
  "message": "Add authentication screen"
}
```
- **Response 200**: `text/event-stream; charset=utf-8`
  - Step progress: `data: {"type":"step","step":"resolving-repo"}\n\n`
    (Steps: `resolving-repo` → `reading-branch` → `building-tree` → `committing` → `updating-branch`)
  - Done:
    ```json
    data: {
      "type": "done",
      "owner": "octocat",
      "name": "my-new-app",
      "branch": "main",
      "commitSha": "6dcb09b5b57875f334f61aebed695e2e4193db5e",
      "htmlUrl": "https://github.com/octocat/my-new-app/commit/6dcb09b5b57875f334f61aebed695e2e4193db5e"
    }
    ```
  - Error:
    ```json
    data: { "type": "error", "code": "name_conflict", "message": "Repository name already exists" }
    ```

---

## Auth

### `GET /api/auth/session`
Current session, if any.

**Response 200**
```json
{ "user": { "id": "usr_123", "name": "Pranav", "email": "p@example.com" } }
```
Signed out: `{ "user": null }`.

### `POST /api/auth/sign-in`
**Sample request**
```json
{ "email": "pranav@example.com", "password": "hunter2" }
```
**Response 200**: `{ "user": { ... } }`, sets session cookie.
**Error 400**
```json
{ "error": "Check the highlighted fields", "fieldErrors": { "email": "Enter a valid email." } }
```

### `POST /api/auth/sign-up`
**Sample request**
```json
{ "name": "Pranav Bakale", "email": "pranav@example.com", "password": "hunter2" }
```
**Response 200**: `{ "user": { ... } }`.
**Error 500** (partial failure)
```json
{ "error": "Your account was created, but we couldn't finish setting it up. Please sign in." }
```

### `POST /api/auth/sign-out`
**Request**: none. **Response 200**: `{ "ok": true }`.

### `POST /api/auth/social`
Exchange a token issued by the identity provider (`lib/identity`; CloudHike Auth today) for a local session cookie.

**Sample request**
```json
{ "token": "ch_tok_abc123..." }
```
**Response 200**: `{ "user": { ... } }`.
**Error 401**
```json
{ "error": "Sign-in expired. Try again." }
```

---

## Internal / webhook

### `POST /api/jobs/agent`
The webhook the job queue's worker (`lib/jobs`; Cloudhike Jobs today) calls back into to actually execute an agent
run in production. Not called by the frontend.

- **Auth**: the queue's signature, checked by `jobQueue.verifySignature` (Cloudhike Jobs: HMAC in the `x-cloudhike-signature` header)
  (`verifyJobSignature`), not user auth.

**Sample request**
```json
{ "runId": "run_abc123" }
```

**Response 200** (always, even on internal failure — so Cloudhike doesn't retry)
```json
{ "runId": "run_abc123" }
```

**Error 401**
```json
{ "error": "Bad signature" }
```

**Notes**: `maxDuration = 3600`. Idempotent — redelivery of an already-claimed run is a no-op.

---

### `GET /api/app-files/[projectId]/[...key]`
Serves a stored asset (image, etc.) by key, scoped to a project.

- **Auth**: none — relies on an unguessable key plus the backend lookup
- **Response**: raw file bytes, `content-type` set from the asset, with
  `cache-control: private, max-age=86400, immutable` and a strict
  `content-security-policy: default-src 'none'; sandbox`

**Error 404** (plain text, not JSON): `Not found`

---

## Publish / EAS Builds

### `POST /api/projects/[projectId]/publish`
Initiates a new native build (`.aab` / `.apk` / `.ipa`) for an Expo project. Pushes the project files and build configurations (`eas.json`, `.github/workflows/eas-build.yml`, `.github/scripts/report-build.js`) to the user's connected GitHub repository, registers secrets (`EXPO_TOKEN`, `PUBLISH_WEBHOOK_SECRET`) via sealed box encryption, and triggers `workflow_dispatch`.

- **Auth**: required (user must own project)
- **CSRF guard**: required (`isSameOriginJson`)
- **Prerequisites**: project must be pushed to GitHub (`not_linked` 409), GitHub must be connected (`github_not_connected` 409), Expo PAT must be connected (`expo_not_connected` 409).
- **Concurrency**: rejected if an in-progress build exists for `(projectId, platform, format)` (`build_in_progress` 409).

**Sample request**
```json
{
  "platform": "android",
  "format": "apk",
  "version": "1.0.0"
}
```

**Response 200**
```json
{
  "buildId": "bld_98765432-abcd-ef01-2345-6789abcdef01"
}
```

**Errors**
- `400 {"error": "invalid_platform" | "invalid_format" | "invalid_version"}`
- `409 {"error": "not_linked" | "github_not_connected" | "expo_not_connected" | "build_in_progress"}`
- `401 {"error": "github_auth_expired"}`

---

### `GET /api/projects/[projectId]/builds`
Lists all build attempts for a project, ordered latest first. Refetched by `PublishDialog` whenever `GET /api/projects/[projectId]/status-stream` reports a change.

- **Auth**: required (user must own project)

**Response 200**
```json
{
  "builds": [
    {
      "id": "bld_123",
      "projectId": "proj_abc",
      "userId": "usr_xyz",
      "platform": "android",
      "format": "apk",
      "version": "1.0.0",
      "status": "ready",
      "repoOwner": "alice",
      "repoName": "my-app",
      "workflowRunId": "12345678",
      "workflowRunUrl": "https://github.com/alice/my-app/actions/runs/12345678",
      "easBuildId": "eas-build-uuid",
      "artifactUrl": "https://expo.dev/artifacts/eas/abc.apk",
      "error": null,
      "needsIosCredentials": 0,
      "createdAt": "2026-11-20T12:00:00.000Z",
      "dispatchedAt": "2026-11-20T12:00:05.000Z",
      "finishedAt": "2026-11-20T12:04:30.000Z"
    }
  ]
}
```

---

### `POST /api/projects/[projectId]/builds/[buildId]/retry`
Retries a failed build by inserting a **new** build row (preserving historical failed records) and re-running the publish pipeline with the previous target platform, format, and version.

- **Auth**: required (user must own project)
- **CSRF guard**: required (`isSameOriginJson`)

**Response 200**
```json
{
  "buildId": "bld_new_retry_uuid"
}
```

**Errors**
- `404 {"error": "not_found", "message": "Build not found."}`
- `409 {"error": "conflict", "message": "Only failed builds can be retried."}`
- `409 {"error": "not_linked" | "github_not_connected" | "expo_not_connected" | "build_in_progress"}`

---

### `POST /api/projects/[projectId]/builds/[buildId]/stop`
Marks a build that is still `queued`, `dispatching` or `building` as `failed` with `"Stopped by you."`, which frees the platform/format slot so a new build (or **Retry**) can start. It does not cancel the GitHub Actions run, so a late report from that run is ignored once the build has finished.

- **Auth**: required (user must own project)
- **CSRF guard**: required (`isSameOriginJson`)

**Response 200**: `{ "ok": true }`

**Errors**: `404` build not found for this project, `409` (`not_running`) when the build already finished.

---

### `POST /api/publish/webhook`
Webhook called by the GitHub Actions runner (`.github/scripts/report-build.js`) upon completion or failure of an EAS build.

- **Auth**: verified via Stripe-style HMAC-SHA256 signature in `x-publish-signature: t=<timestamp>,v1=<hmac>` header using `PUBLISH_WEBHOOK_SECRET`. No user session.
- **Idempotent**: always returns 200 if the build was already marked terminal (`ready` or `failed`).

**Sample request**
```json
{
  "buildId": "bld_123",
  "status": "ready",
  "easBuildId": "eas-build-uuid",
  "artifactUrl": "https://expo.dev/artifacts/eas/abc.apk",
  "error": null,
  "needsIosCredentials": 0,
  "workflowRunUrl": "https://github.com/alice/my-app/actions/runs/12345678",
  "easProjectId": "eas-project-uuid",
  "expoOwner": "alice"
}
```

**Response 200**
```json
{
  "ok": true
}
```

**Errors**
- `400 {"error": "Missing buildId" | "Invalid JSON body"}`
- `401 {"error": "Invalid webhook signature"}`
- `404 {"error": "Build not found"}`

---

### `POST /api/projects/[projectId]/publish/web`
Initiates a new web deployment to Expo EAS Hosting for an Expo project. Pushes the project files and web deploy configurations (`eas.json`, `.github/workflows/eas-web-deploy.yml`, `.github/scripts/report-web-deploy.js`) to the user's connected GitHub repository, registers secrets (`EXPO_TOKEN`, `PUBLISH_WEBHOOK_SECRET`), and triggers `workflow_dispatch`.

- **Auth**: required (user must own project)
- **CSRF guard**: required (`isSameOriginJson`)
- **Prerequisites**: project must be pushed to GitHub (`not_linked` 409), GitHub must be connected with `workflow` scope (`github_not_connected` / `github_workflow_scope_missing` 409), Expo PAT must be connected (`expo_not_connected` 409).
- **Concurrency**: rejected if an in-progress web deployment exists (`deploy_in_progress` 409).

**Sample request**
`POST /api/projects/[projectId]/publish/web` (no request body)

**Response 200**
```json
{
  "ok": true,
  "deployment": {
    "projectId": "proj_abc",
    "userId": "usr_xyz",
    "status": "queued",
    "repoOwner": "alice",
    "repoName": "my-app"
  }
}
```

**Errors**
- `409 {"error": "not_linked" | "github_not_connected" | "github_workflow_scope_missing" | "expo_not_connected" | "deploy_in_progress"}`
- `401 {"error": "github_auth_expired"}`
- `502 {"error": "github_not_found" | "github_error"}`
- `500 {"error": "publish_failed"}`

---

### `GET /api/projects/[projectId]/publish/web`
Returns the current web deployment record for a project. Refetched by `PublishDialog` and `PreviewPanel` whenever `status-stream` reports a change.

- **Auth**: required (user must own project)

**Response 200**
```json
{
  "deployment": {
    "projectId": "proj_abc",
    "userId": "usr_xyz",
    "status": "ready",
    "url": "https://my-app.expo.app",
    "repoOwner": "alice",
    "repoName": "my-app",
    "workflowRunId": "12345678",
    "workflowRunUrl": "https://github.com/alice/my-app/actions/runs/12345678",
    "error": null,
    "createdAt": "2026-11-20T12:00:00.000Z",
    "updatedAt": "2026-11-20T12:04:30.000Z",
    "dispatchedAt": "2026-11-20T12:00:05.000Z",
    "lastDeployedAt": "2026-11-20T12:04:30.000Z"
  }
}
```

---

### `DELETE /api/projects/[projectId]/publish/web`
Marks the in-flight web deployment (status `queued`, `dispatching`, `building` or `deploying`) and its current run as `failed` with `"Stopped by you."`, so a stuck deployment stops blocking new ones. The last live `url` is kept. It does not cancel the GitHub Actions run; if that run later reports success, the deployment becomes `ready` again.

- **Auth**: required (user must own project)

**Response 200**: `{ "ok": true }`

**Errors**: `409` (`not_running`) when no deployment is in flight.

---

### `POST /api/publish/web-webhook`
Webhook called by the GitHub Actions runner (`.github/scripts/report-web-deploy.js`) for mid-workflow stage pings (`stage: "deploying"`) and terminal deploy outcomes (`status: "ready"` or `"failed"`).

- **Auth**: verified via Stripe-style HMAC-SHA256 signature in `x-publish-signature: t=<timestamp>,v1=<hmac>` header using `PUBLISH_WEBHOOK_SECRET`. No user session.
- **Idempotent**: always returns 200 if the deployment was already marked terminal (`ready` or `failed`).

**Sample request (Terminal)**
```json
{
  "projectId": "proj_abc",
  "status": "ready",
  "url": "https://my-app.expo.app",
  "error": null,
  "workflowRunUrl": "https://github.com/alice/my-app/actions/runs/12345678",
  "easProjectId": "eas-project-uuid",
  "expoOwner": "alice"
}
```

**Sample request (Mid-workflow Ping)**
```json
{
  "projectId": "proj_abc",
  "stage": "deploying"
}
```

**Response 200**
```json
{
  "ok": true
}
```

**Errors**
- `400 {"error": "Missing projectId" | "Invalid JSON body"}`
- `401 {"error": "Invalid webhook signature"}`
- `404 {"error": "Deployment not found"}`

---

## Expo Connect

### `POST /api/expo/connect`
Validates a pasted Personal Access Token against Expo's GraphQL API (`https://api.expo.dev/graphql`), encrypts it via AES-GCM, and upserts an `expo_connections` record.

- **Auth**: required (session user)
- **CSRF guard**: required (`isSameOriginJson`)

**Sample request**
```json
{
  "token": "expo_pat_abcdef123456"
}
```

**Response 200**
```json
{
  "ok": true,
  "username": "expo_developer"
}
```

**Errors**
- `400 {"error": "missing_token" | "invalid_token"}`
- `401 {"error": "Unauthorized"}`

---

### `GET /api/expo/status`
Checks if the current user has an active connected Expo Personal Access Token.

- **Auth**: optional (returns `{ connected: false }` if unauthenticated)

**Response 200**
```json
{
  "connected": true,
  "username": "expo_developer"
}
```

---

### `POST /api/expo/disconnect`
Disconnects the current user's Expo account by deleting their `expo_connections` record.

- **Auth**: required (session user)
- **CSRF guard**: required (`isSameOriginJson`)

**Response 200**
```json
{
  "ok": true
}
```

