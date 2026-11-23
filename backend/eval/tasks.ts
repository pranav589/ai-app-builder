// Fixed task set for scripts/eval.ts, adapted from poc/verified-code/src/cli/eval.ts
// TASKS and CEILING_TASKS to this app's fixtures. Phrased generically (a
// "main screen", "an item") so the same tasks apply to any fixture, since
// each fixture is a different app (a todo list, a habit tracker, ...).
//
// All tasks here are requests to an already-built app's EXISTING screens,
// never a new one: Phase 2's verified engine can't add, delete or rename a
// screen yet (that needs the manifest from Phase 6), so "screen" tasks are
// expected to end in a <question> for now. That's a real, honest baseline
// number, not a bug in the harness.

export type TaskCategory = "edit" | "screen" | "data" | "logic" | "layout" | "flow" | "motion" | "ceiling"
export type Task = { category: TaskCategory; text: string }

export const TASKS: Task[] = [
  { category: "edit", text: "Add a search field at the top of the main screen that filters the list by title as you type, with an empty state when nothing matches." },
  { category: "edit", text: "Change the primary add/create button into a round floating button in the bottom-right corner of the screen." },
  { category: "edit", text: "Show a friendlier empty state when the list has nothing in it yet, with a button that creates the first item." },
  { category: "edit", text: "Add a short subtitle under the main screen's title summarizing what it shows (for example a count or a date)." },
  { category: "edit", text: "Extract the row used to render one item in the list into its own reusable component, and use it everywhere that list is rendered." },
  { category: "screen", text: "Add a Settings screen reachable from the main navigation with at least two toggles for app preferences." },
  { category: "screen", text: "Add a Stats screen showing a few summary numbers about the data in the app (counts, totals or percentages)." },
  { category: "screen", text: "Add a History screen listing items that are done, completed or archived, newest first." },
  { category: "data", text: "Add a 'notes' text field to the main record type and show it on its detail or edit view; allow entering it in the create form." },
  { category: "data", text: "Add categories: a small set of named categories, let each record optionally belong to one, and show a row of filter badges for them on the main screen." },
  { category: "data", text: "Add a priority or importance field with a few preset values, shown as a small colored badge on each row." },
  { category: "data", text: "Add a numeric field that can be incremented or decremented directly from the list, without opening a detail screen." },
  { category: "logic", text: "Validate the title field when creating or editing an item: 3 to 40 characters, not empty. Show an inline error and keep Save disabled until it's valid." },
  { category: "logic", text: "Add a three-option sort control on the main screen to sort by name, by date created, or by priority." },
  { category: "logic", text: "When deleting an item, show an inline confirmation step (Are you sure? with Cancel and Delete) instead of deleting immediately." },
  { category: "layout", text: "Redesign the main list as a two-column grid of cards instead of a single column." },
  { category: "layout", text: "Add a small summary bar near the top of the main screen (for example a progress or completion indicator), built from plain Views sized proportionally, not an external chart library." },
  { category: "layout", text: "Give each row a colored left accent bar: one color when complete or on target, another color otherwise." },
  { category: "flow", text: "Add a short onboarding screen shown before the main screen on first launch, with a short intro and a 'Get started' button." },
  { category: "flow", text: "Let the user edit an existing item: add an Edit action that opens a form prefilled with its current values and saves changes back." },
  { category: "motion", text: "Let me swipe an item left to delete it, with a smooth animation." },
  { category: "motion", text: "Make the rows on the main screen animate in one after another when it opens." },
  { category: "motion", text: "Add a row of two or three summary numbers at the top of the main screen that count up when the screen opens." },
  { category: "motion", text: "Add an All / Active / Done filter with a selection pill that slides between the options." },
  { category: "motion", text: "While the list is loading, show shimmering placeholder rows shaped like the real ones." },
  { category: "motion", text: "Add a bottom sheet that springs up from the main screen to create a new item, and closes when dragged down." },
]

/** Requests the platform can't fully do yet. Good outcomes: a sensible fallback that passes, or a clear question. */
export const CEILING_TASKS: Task[] = [
  { category: "ceiling", text: "Show nearby places related to this app on a map so I can pick one." },
  { category: "ceiling", text: "Send me a push notification every morning reminding me to check the app." },
  { category: "ceiling", text: "Let me take a photo and attach it to an item." },
  { category: "ceiling", text: "Sync my data to Google Sheets every night." },
  { category: "ceiling", text: "Make it better." },
]
