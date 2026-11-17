import "server-only"
import { randomBytes } from "node:crypto"
import { Agent, assistant, run as runAgent, system, user, type AgentInputItem } from "@openai/agents"
import { eq, sql } from "drizzle-orm"

import { appBackends, db, messages, projects } from "@/db"
import { getFastModel, reasoningEffort, reasoningProviderData } from "@/lib/agent/config"
import type { LiveRun } from "@/lib/agent/registry"
import type { BackendInfo } from "@/lib/agent/types"
import { readAppDoc } from "@/lib/app-runtime/app-doc"
import { getBackend, readEnv, sealEnv, syncSchema, type AppEnv } from "./app-backend"
import type { BackendService } from "./config"
import { getAccess, markRevoked, type CloudHikeAccess } from "./connect"
import { CloudHikeRateLimitError, CloudHikeRevokedError, parseEnv, withMcp, type McpSession, type McpTool } from "./mcp"

// The backend agent: sets up CloudHike for a generated app through CloudHike's
// MCP server. The AI gateway doesn't pass tool calls through, so the agent
// works in tagged text (like the planner): it answers with one
// <call tool="...">{args}</call> at a time, this code runs the call and hands
// back the result, until it answers <done>. It only gets tools that can't
// leak secrets or delete anything. The project's keys are then fetched by
// this code (never shown to the AI), stored encrypted, and used to create the
// app's tables.

/** Tools the agent may call. get_environment and SQL tools stay out of the AI's reach. */
const AGENT_TOOLS = ["list_projects", "create_project", "get_project", "deploy_services", "wait_for_services", "get_docs"]
const MAX_STEPS = 16
const RESULT_LIMIT = 6000

export const SERVICE_LABELS: Record<BackendService, string> = {
  postgres: "Database",
  auth: "Authentication",
  storage: "File storage",
  email: "Email",
  jobs: "Background jobs",
}

/** What each service must put in the project's environment before the app can use it. */
const REQUIRED_ENV: Record<BackendService, string[]> = {
  postgres: ["DATABASE_URL"],
  auth: ["AUTH_URL", "AUTH_PUBLISHABLE_KEY"],
  storage: ["S3_ENDPOINT", "S3_BUCKET", "S3_ACCESS_KEY_ID", "S3_SECRET_ACCESS_KEY"],
  email: [],
  jobs: [],
}

const INSTRUCTIONS = `You are the backend engineer at "Anything", a platform that builds mobile apps. You set up the CloudHike (cloudhike.dev) backend for one app by calling CloudHike's MCP tools. You act ONLY by calling tools, one per reply; this system runs each call and sends you its result.

Every reply is one short line for the app's creator (under 12 words, present tense, e.g. "Creating the CloudHike project"), followed by EXACTLY ONE of:
<call tool="TOOL_NAME">{ JSON arguments that match the tool's input schema }</call>
<done>{"projectId": "...", "projectName": "...", "services": {"postgres": "ready", ...}, "envArgs": { JSON arguments for get_environment for this project }}</done>
<fail>One plain sentence for the creator saying what blocked the setup and what they can do.</fail>

How to work:
1. If an existing CloudHike project id is given, check it with get_project and reuse it. Otherwise create a project with create_project, named as given (2-40 characters).
2. Deploy exactly the requested services with deploy_services. A service that is already deployed answers "exists": that is fine.
3. Call wait_for_services until every requested service is ready. Each call waits up to 50 seconds; call it again while services are still deploying (at most 6 times in total).
4. Reply <done>. "envArgs" are the arguments get_environment needs for this project (read its input schema below); you never call get_environment yourself.

Rules:
- Copy ids exactly from tool results; never invent them.
- Use only the tools listed below, with arguments that match their schemas.
- If a result says credits are insufficient, a plan limit is reached, or a service failed, reply <fail> with that reason in plain words (for example: "Your CloudHike workspace needs credits to deploy these services. Add credits at cloudhike.dev, then try again.").
- Never ask the creator questions. Never write code.`

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms))
const msgId = () => `msg-${Date.now()}-${randomBytes(3).toString("hex")}`

let engineer: Agent | null = null
function backendAgent() {
  engineer ??= new Agent({
    name: "Backend engineer",
    instructions: INSTRUCTIONS,
    model: getFastModel(),
    modelSettings: { maxTokens: 2000, reasoning: { effort: reasoningEffort() }, providerData: reasoningProviderData() },
  })
  return engineer
}

async function complete(input: AgentInputItem[]) {
  for (let attempt = 1; ; attempt++) {
    try {
      const result = await runAgent(backendAgent(), input, { maxTurns: 1 })
      return typeof result.finalOutput === "string" ? result.finalOutput : ""
    } catch (e) {
      if (attempt >= 3) throw e
      await sleep(1500 * attempt)
    }
  }
}

type Step =
  | { kind: "call"; tool: string; args: Record<string, unknown>; note: string }
  | { kind: "done"; result: DoneResult; note: string }
  | { kind: "fail"; reason: string; note: string }
  | { kind: "invalid"; note: string }

type DoneResult = { projectId: string; projectName?: string; services?: Record<string, string>; envArgs?: Record<string, unknown> }

function parseJson(raw: string): Record<string, unknown> | null {
  const text = raw.trim().replace(/^```(?:json)?\s*|\s*```$/g, "")
  try {
    const v = JSON.parse(text || "{}")
    return v && typeof v === "object" && !Array.isArray(v) ? v : null
  } catch {
    return null
  }
}

export function parseStep(raw: string): Step {
  const note = raw.replace(/<(call|done|fail)\b[\s\S]*$/i, "").trim().split("\n")[0]?.slice(0, 120) ?? ""
  const call = /<call\s+tool=["']([\w.-]+)["']\s*>([\s\S]*?)<\/call>/i.exec(raw)
  if (call) {
    const args = parseJson(call[2])
    return args ? { kind: "call", tool: call[1], args, note } : { kind: "invalid", note }
  }
  const done = /<done>([\s\S]*?)<\/done>/i.exec(raw)
  if (done) {
    const result = parseJson(done[1])
    return result && typeof result.projectId === "string" && result.projectId
      ? { kind: "done", result: result as unknown as DoneResult, note }
      : { kind: "invalid", note }
  }
  const fail = /<fail>([\s\S]*?)<\/fail>/i.exec(raw)
  if (fail) return { kind: "fail", reason: fail[1].trim().slice(0, 400), note }
  return { kind: "invalid", note }
}

const describeTools = (tools: McpTool[]) =>
  tools
    .map((t) => `### ${t.name}\n${t.description ?? ""}\nInput schema: ${JSON.stringify(t.inputSchema ?? {})}`)
    .join("\n\n")

class SetupFailed extends Error {}

/** CloudHike project names are 2-40 characters. */
function projectName(appName: string) {
  const name = appName.replace(/[^\p{L}\p{N} ._-]+/gu, " ").replace(/\s+/g, " ").trim().slice(0, 40).trim()
  return name.length >= 2 ? name : "My app"
}

/** The AI's tool loop. Returns the project it set up. */
async function agentLoop(
  session: McpSession,
  goal: { appName: string; existingId: string | null; services: BackendService[] },
  say: (line: string) => void
): Promise<DoneResult> {
  const tools = session.tools.filter((t) => AGENT_TOOLS.includes(t.name))
  const missing = ["create_project", "deploy_services"].filter((n) => !tools.some((t) => t.name === n))
  if (missing.length) throw new Error(`CloudHike MCP is missing tools: ${missing.join(", ")}`)
  const envTool = session.tools.find((t) => t.name === "get_environment")

  const input: AgentInputItem[] = [
    system(`Tools you can call:\n\n${describeTools(tools)}${envTool ? `\n\n### get_environment (you never call it; give its arguments as envArgs)\nInput schema: ${JSON.stringify(envTool.inputSchema ?? {})}` : ""}`),
    user(
      `Set up the backend for the app "${goal.appName}".
Project name to use: "${projectName(goal.appName)}".
Existing CloudHike project id: ${goal.existingId ?? "none, create a new project"}.
Services to deploy: ${goal.services.join(", ")}.`
    ),
  ]

  let invalid = 0
  for (let step = 0; step < MAX_STEPS; step++) {
    const raw = await complete(input)
    input.push(assistant(raw))
    const s = parseStep(raw)
    if (s.note) say(s.note)

    if (s.kind === "done") return s.result
    if (s.kind === "fail") throw new SetupFailed(s.reason)
    if (s.kind === "invalid") {
      if (++invalid >= 3) throw new Error("The backend agent didn't follow the protocol.")
      input.push(user('That reply had no valid tag. Reply with one short line and exactly one <call tool="...">{json}</call>, <done>{json}</done> or <fail>...</fail>.'))
      continue
    }
    if (!AGENT_TOOLS.includes(s.tool) || !tools.some((t) => t.name === s.tool)) {
      input.push(user(`The tool "${s.tool}" isn't available. Use one of: ${tools.map((t) => t.name).join(", ")}.`))
      continue
    }
    const res = await session.call(s.tool, s.args)
    const text = res.text.length > RESULT_LIMIT ? `${res.text.slice(0, RESULT_LIMIT)}\n…(truncated)` : res.text
    input.push(user(`Result of ${s.tool}${res.isError ? " (error)" : ""}:\n<result>\n${text || "(empty)"}\n</result>`))
  }
  throw new Error("The backend agent ran out of steps.")
}

/** Reads the project's environment: get_environment over MCP, then the REST API. */
async function fetchEnv(access: CloudHikeAccess, session: McpSession, done: DoneResult): Promise<AppEnv> {
  if (session.tools.some((t) => t.name === "get_environment")) {
    const res = await session.call("get_environment", done.envArgs ?? { projectId: done.projectId })
    if (!res.isError) {
      const env = parseEnv(res.text)
      if (Object.keys(env).length) return env
    }
  }
  const res = await fetch(`${access.apiUrl}/projects/${encodeURIComponent(done.projectId)}/env`, {
    headers: { authorization: `Bearer ${access.token}` },
    cache: "no-store",
    signal: AbortSignal.timeout(20_000),
  })
  if (res.status === 401) throw new CloudHikeRevokedError()
  if (!res.ok) return {}
  return parseEnv(await res.text())
}

function missingEnv(env: AppEnv, services: BackendService[]) {
  return services.flatMap((s) => REQUIRED_ENV[s].filter((k) => !env[k]).map((k) => `${SERVICE_LABELS[s]} (${k})`))
}

export function backendInfo(row: Awaited<ReturnType<typeof getBackend>>): BackendInfo | null {
  if (!row) return null
  return {
    provider: "cloudhike",
    status: row.status,
    projectId: row.externalProjectId,
    projectName: row.externalProjectName,
    services: row.services,
    error: row.error,
    connectedAt: row.connectedAt?.toISOString() ?? null,
  }
}

async function saveRow(projectId: string, patch: Partial<typeof appBackends.$inferInsert>) {
  const values = { ...patch, updatedAt: new Date() }
  await db
    .insert(appBackends)
    .values({ projectId, ...values })
    .onConflictDoUpdate({ target: appBackends.projectId, set: values })
  return getBackend(projectId)
}

/**
 * Sets up (or repairs) the CloudHike backend of an app: project, services,
 * credentials, tables, seed data. Streams its progress into the chat as one
 * assistant message. Safe to run again: everything it does is idempotent.
 */
export async function runBackendSetup(run: LiveRun, projectId: string, userId: string, services: BackendService[]) {
  const [project] = await db.select().from(projects).where(eq(projects.id, projectId)).limit(1)
  if (!project) throw new Error("project not found")
  const previous = await getBackend(projectId)

  const emitInfo = async (row: Awaited<ReturnType<typeof getBackend>>) => {
    const info = backendInfo(row)
    if (info) run.emit({ type: "backend", backend: info })
  }

  const messageId = msgId()
  let text = ""
  let lastLine = ""
  const say = (line: string) => {
    const clean = line.replace(/[<>]/g, "").trim()
    if (!clean || clean === lastLine) return
    lastLine = clean
    const delta = `${text ? "\n" : ""}- ${clean}`
    text += delta
    run.emit({ type: "text", id: messageId, delta })
    run.emit({ type: "status", text: clean })
  }
  const finish = async (final: string) => {
    const body = `${final}${text ? `\n\n${text}` : ""}`
    const [row] = await db
      .insert(messages)
      .values({ id: messageId, projectId, sender: "assistant", text: body, type: "standard", pipelineData: { backend: true } })
      .returning()
    run.emit({
      type: "message_done",
      message: { id: row.id, sender: "assistant", kind: "standard", text: row.text, createdAt: row.createdAt.toISOString() },
    })
  }

  await emitInfo(await saveRow(projectId, { status: "provisioning", services, error: null }))
  run.emit({ type: "message_start", id: messageId })
  run.emit({ type: "status", text: "Connecting to CloudHike" })

  const access = await getAccess(userId)
  if (!access) {
    await emitInfo(await saveRow(projectId, { status: "error", error: "reconnect" }))
    await finish("I couldn't reach your CloudHike account. Connect it again from **Connect Backend**, then I'll finish the setup.")
    return
  }

  try {
    const result = await withMcp(access, async (session) => {
      const done = await agentLoop(session, { appName: project.name, existingId: previous?.externalProjectId ?? null, services }, say)
      await saveRow(projectId, { externalProjectId: done.projectId, externalProjectName: done.projectName ?? project.name })

      // Variables appear once each service is ready; give slow ones a little longer.
      say("Collecting the project's connection settings")
      let env: AppEnv = {}
      for (let i = 0; i < 4; i++) {
        env = await fetchEnv(access, session, done)
        if (!missingEnv(env, services).length) break
        await sleep(8000)
      }
      const missing = missingEnv(env, services)
      if (missing.length) throw new SetupFailed(`These services aren't ready on CloudHike yet: ${missing.join(", ")}. Try again in a minute.`)
      return { done, env }
    })

    // Tables for the app's data model, seeded once.
    const doc = readAppDoc(project.previewScreens)
    say("Creating the app's tables and sample data")
    if (doc.data) await syncSchema(result.env, doc.data)

    const row = await saveRow(projectId, {
      status: "ready",
      externalProjectId: result.done.projectId,
      externalProjectName: result.done.projectName ?? project.name,
      envEnc: sealEnv(result.env),
      schemaHash: doc.data?.hash ?? null,
      error: null,
      connectedAt: previous?.connectedAt ?? new Date(),
    })
    // The app now runs on CloudHike in the preview (and in exports).
    await db
      .update(projects)
      .set({
        previewScreens: sql`jsonb_set(coalesce(${projects.previewScreens}, '{"v":2,"screens":[]}'::jsonb), '{backend}', ${JSON.stringify({
          provider: "cloudhike",
          projectRef: result.done.projectId,
        })}::jsonb)`,
        updatedAt: new Date(),
      })
      .where(eq(projects.id, projectId))
    await emitInfo(row)
    await finish(
      `Your app is connected to **CloudHike**. ${services.map((s) => SERVICE_LABELS[s]).join(", ")} ${services.length === 1 ? "is" : "are"} live in the project **${result.done.projectName ?? project.name}**, and the preview now stores, loads and syncs real data there.`
    )
  } catch (e) {
    let reason: string
    if (e instanceof CloudHikeRevokedError) {
      await markRevoked(userId)
      reason = "reconnect"
      await finish("CloudHike no longer accepts this connection (it may have been disconnected in your CloudHike settings). Connect your account again to finish the setup.")
    } else if (e instanceof SetupFailed || e instanceof CloudHikeRateLimitError) {
      reason = e.message
      await finish(`I couldn't finish the CloudHike setup. ${e.message}`)
    } else {
      console.error("backend setup failed", projectId, e)
      reason = "Something went wrong while setting up CloudHike. Please try again."
      await finish(`I couldn't finish the CloudHike setup. ${reason}`)
    }
    await emitInfo(await saveRow(projectId, { status: previous?.status === "ready" ? "ready" : "error", error: reason }))
  }
}

/** After a build changed the data model: add the new tables to a connected app's database. Never fails the build. */
export async function syncBackendSchema(projectId: string) {
  try {
    const row = await getBackend(projectId)
    if (!row || row.status !== "ready" || !row.envEnc) return
    const [project] = await db.select({ previewScreens: projects.previewScreens }).from(projects).where(eq(projects.id, projectId)).limit(1)
    const data = readAppDoc(project?.previewScreens).data
    if (!data || data.hash === row.schemaHash) return
    await syncSchema(readEnv(row), data)
    await db.update(appBackends).set({ schemaHash: data.hash, updatedAt: new Date() }).where(eq(appBackends.projectId, projectId))
  } catch (e) {
    console.error("syncing the app's CloudHike tables failed", projectId, e)
  }
}
