# API Reference

Every route under `app/api/**`, with sample request/response payloads taken from
the actual handler code. Keep this doc in sync with the code — see the "Keeping
docs in sync" section in [`CLAUDE.md`](../CLAUDE.md).

An interactive version of this doc was also published as a Claude Artifact.

## Cross-cutting conventions

- **Auth**: almost every route calls `getCurrentUser()` (or `requireOwnedProject`,
  which also checks the project's `userId`) → `401` if signed out, `404` if the
  project doesn't exist or isn't owned by the caller, `503` if the auth/DB backend
  is unreachable (`ServiceUnavailableError`).
- **CSRF guard**: most mutating routes call `isSameOriginJson` / `isSameOrigin`
  first → `400 {"error":"Bad request"}` or `403 {"error":"Forbidden."}` if not.
- **Error shape**: JSON error responses are `{"error": string}`, occasionally with
  extra fields (`fieldErrors`, `extraFiles`, `reconnect`).
- **Project-scoped routes** (`/api/projects/[projectId]/**`) all repeat the same
  ownership check boilerplate against the `projects` table before doing anything else.

---

## Projects

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
      "assetCount": 1
    }
  ]
}
```

**Error 503**
```json
{ "error": "We're having trouble reaching our servers. Please try again in a moment." }
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
- **Request body**: `{ action, text?, screenId?, element?, services? }`

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
{ "action": "backend", "services": ["database", "auth", "storage"] }
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
connected yet (`{"error": "...", "reconnect": true}`), `503` unavailable.

**Notes**: `maxDuration = 800`. One run per project is enforced by a DB mutex
(`lib/agent/run-store.ts`); dispatches to the Cloudhike Jobs queue in production,
runs inline in dev.

---

### `POST /api/projects/[projectId]/canvas-edit`
Apply a tap-to-edit change from the Canvas/Preview — **no AI model call**, an AST
codemod applied directly and run through the verify gates.

- **Auth**: required + ownership
- **Request body**: `{ eid, text?, style?, from?, fromAlt? }` — must include `text` or `style`

**Sample request — text edit**
```json
{ "eid": "screens/home.tsx:42:Text", "text": "Welcome back!" }
```

**Sample request — style edit**
```json
{ "eid": "screens/home.tsx:50:View", "style": { "backgroundColor": "#f5f5f5", "padding": "16" } }
```

**Response 200**: the updated screen/file data (shape from `applyCanvasEdit`).

**Error 422**
```json
{ "error": "Couldn't apply that style change.", "extraFiles": ["screens/home.tsx"] }
```
Other cases: `400` bad request, `409` agent busy, `500` generic failure.

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

## Backend (CloudHike connect)

### `GET /api/projects/[projectId]/backend`
Backend connection status.

**Response 200**
```json
{
  "configured": true,
  "accountConnected": true,
  "backend": {
    "provider": "cloudhike",
    "status": "ready",
    "projectId": "ch_proj_1",
    "projectName": "recipe-tracker-backend",
    "services": ["database", "auth"],
    "error": null,
    "connectedAt": "2026-11-10T12:05:00.000Z"
  }
}
```
Never returns credentials.

### `DELETE /api/projects/[projectId]/backend`
Disconnect the backend (keeps the actual CloudHike project/data intact).

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
Generic data-access endpoint the *generated app* calls at runtime (op-based RPC).
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
Other cases: `400` unknown op, `409` app not connected to CloudHike.

**Notes**: `snapshot` op batches multiple reads (`collections[]`, `settings`,
`auth.current`, `version`) into one response.

---

### `GET /api/cloudhike/connect`
Start the "Connect CloudHike account" OAuth-like flow. **Always a redirect**, not JSON.

- **Request**: query params `projectId` (required), `services` (comma list), `reconnect` ("1")
- **Response**: `303` redirect to CloudHike's authorize URL, or back to the
  workspace with `?backend=connected` / `?backend=error&reason=...`

### `GET /api/cloudhike/callback`
OAuth callback. **Always a redirect.**

- **Request**: query params `code`, `state`, or `error`
- **Response**: `303` redirect to `/` (not signed in) or
  `/workspace/{projectId}?backend=connected&services=...` /
  `?backend=error&reason=denied|failed|expired|not_configured`

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
Exchange a CloudHike-issued token for a local session cookie.

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
The webhook a Cloudhike Jobs worker calls back into to actually execute an agent
run in production. Not called by the frontend.

- **Auth**: HMAC-style webhook signature in `x-cloudhike-signature` header
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
