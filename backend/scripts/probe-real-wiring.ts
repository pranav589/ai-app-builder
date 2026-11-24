// One-off smoke test for Phase 3's real wiring, against the live gateway
// (not the fakes the Vitest suite uses). Exercises the actual production
// code paths: coderAdapter, runWithTools (router shape), and
// streamTextWithTools (planner shape), each with a real Agent + tools.
//
// Usage: node --env-file=.env --import tsx scripts/probe-real-wiring.ts

import { coderAdapter } from "@/lib/verify/coder"
import { toolCallsToChangeSet, toolCallsToRouterReply } from "@/lib/verify/tools"
import { routerPrompt } from "@/lib/verify/router"
import { getAgents, runWithTools, streamTextWithTools } from "@/lib/agent/agents"
import type { AppManifest } from "@app/shared/manifest/schema"

function log(label: string, v: unknown) {
  console.log(`\n--- ${label} ---`)
  console.log(JSON.stringify(v, null, 2))
}

async function probeCoder() {
  const turns = [{ role: "user" as const, content: 'Change request:\nAdd a loading spinner to the home screen.\n\nCurrent files to change:\n<current path="app/home.tsx">\nimport { Text } from "react-native"\nexport default function Home() {\n  return <Text>Hi</Text>\n}\n</current>\n\nReturn the change now.' }]
  const out = await coderAdapter(turns)
  log("coderAdapter raw reply", out)
  if (out.toolCalls) log("coderAdapter -> ChangeSet", toolCallsToChangeSet(out.toolCalls, out.text))
}

async function probeRouter() {
  const manifest: AppManifest = {
    schemaVersion: 1,
    name: "Test",
    slug: "test",
    screens: { home: { title: "Home", presentation: "tab", icon: "home" } },
    navigation: { tabs: ["home"], initial: "home" },
    collections: {},
    allowedPackages: [],
  } as unknown as AppManifest
  const { router } = getAgents()
  const out = await runWithTools(router, routerPrompt(manifest, "make the home title bigger"))
  log("router raw reply", out)
  log("router -> RouterReply", toolCallsToRouterReply(out.toolCalls))
}

async function probePlanner() {
  const { planner } = getAgents()
  let text = ""
  const out = await streamTextWithTools(
    planner,
    "I want to build a simple habit tracker app with a home screen listing habits and a detail screen for each one.",
    (delta) => {
      text += delta
    }
  )
  log("planner streamed prose", text)
  log("planner tool calls", out.toolCalls)
}

async function main() {
  await probeCoder()
  await probeRouter()
  await probePlanner()
  console.log("\nDone.")
}

main().catch((e) => {
  console.error(e)
  process.exitCode = 1
})
