// Reproduces the live bug a real user hit: asking to add a screen to an
// existing project, where conversation history contains a past plan
// message. Confirms historyToInput.ts's fix (dropping the literal <plan>
// tag from both the system instructions and reconstructed history) actually
// stops the model from imitating the old tag format instead of calling
// propose_plan.
//
// Usage: node --env-file=.env --import tsx scripts/probe-history-bias.ts

import { getAgents, streamTextWithTools } from "@/lib/agent/agents"
import { historyToInput } from "@/lib/agent/history-to-input"
import type { AppPlan, GeneratedScreen } from "@app/shared/agent/types"
import type { Project } from "@/db"

const project = { name: "Notes", assets: [] } as unknown as Project

const plan: AppPlan = {
  appName: "Notes",
  summary: "A quick, distraction-free notes app.",
  targetUsers: "Anyone who wants a fast place to capture thoughts.",
  coreFeatures: ["Scrollable list of notes", "Add a new note"],
  design: {
    style: "Calm and minimal",
    primaryColor: "#2F6F5E",
    accentColor: "#E9B949",
    backgroundColor: "#FAF8F3",
    surfaceColor: "#FFFFFF",
    textColor: "#1F2328",
    cornerRadius: "soft",
    typography: "Clean humanist sans",
  },
  navigation: "The notes list is the root screen.",
  screens: [
    { id: "notes-list", name: "Notes List", purpose: "See all notes.", keyElements: ["Note cards"], navigatesTo: ["new-note"], presentation: "stack" },
    { id: "new-note", name: "New Note", purpose: "Write a new note.", keyElements: ["Title", "Body"], navigatesTo: ["notes-list"], presentation: "modal" },
  ],
}

const builtScreens: GeneratedScreen[] = plan.screens.map((s) => ({ id: s.id, name: s.name, state: "ready" }))

async function main() {
  const history = [
    { id: "u1", sender: "user", text: "Make me a simple notes app.", type: "standard", plan: null, pipelineData: null },
    { id: "a1", sender: "assistant", text: "Here's a simple notes app plan.", type: "plan", plan, pipelineData: null },
  ] as Parameters<typeof historyToInput>[1]

  const input = historyToInput(project, history, builtScreens, [], plan)
  const { planner } = getAgents()

  let text = ""
  const out = await streamTextWithTools(planner, [...input, { type: "message", role: "user", content: "Add a settings screen. in Notes listing screen add a gear icon in top right" }], (d) => {
    text += d
  })

  console.log("--- streamed prose (should NOT contain a raw <plan> tag) ---")
  console.log(text)
  console.log("\n--- tool calls (should contain propose_plan) ---")
  console.log(JSON.stringify(out.toolCalls.map((c) => c.name)))
  console.log("\n--- verdict ---")
  console.log(text.includes("<plan>") ? "FAIL: model still wrote a <plan> tag in prose" : "prose is clean of <plan> tags")
  console.log(out.toolCalls.some((c) => c.name === "propose_plan") ? "PASS: model called propose_plan" : "model did not call propose_plan")
}

main().catch((e) => {
  console.error(e)
  process.exitCode = 1
})
