
// Re-export agent lifecycle modules split by responsibility:
// - history: message and phase persistence in the database
// - history-to-input: formatting conversation history for OpenAI Agents
// - router: fast message routing for built applications
// - planning: planner agent execution and app plan updates
// - repair: runtime crash fixing through the verified engine
// - canvas-edit: AST codemod edits from the interactive canvas
// - verified-edit: targeted screen edits with gate verification
// - generation: multi-screen generation pipeline and shell setup

export {
  latestPlan,
  loadProject,
  saveDoc,
  saveMessage,
  saveScreens,
  saveUserMessage,
  setPhase,
  toStoredMessage,
} from "./history"

export { historyToInput } from "./history-to-input"

export { NEW_SCREEN_NUDGE, routeMessage } from "./router"

export { onlyAddsScreens, runPlanning } from "./planning"

export { repairFile, type RepairResult } from "./repair"

export { applyCanvasEdit, type CanvasEditResult } from "./canvas-edit"

export { runVerifiedEdit } from "./verified-edit"

export { runGeneration } from "./generation"
