// One-off, zero-AI-cost fixture generator: hand-written screens/components
// (both well under the 300-line policy limit, unlike every existing
// fixture/project, which made eval cost far more than expected by forcing a
// repair round on almost every task just to shrink an already-oversized
// file). Platform files (theme, backend, config) come from the real
// generators so they're identical to what a real build would produce.
import { writeFileSync } from "node:fs"
import path from "node:path"

import type { AppPlan, GeneratedScreen } from "@/lib/agent/types"
import { normalizeDataModel } from "@/lib/app-runtime/data-model"
import { fallbackThemes } from "@/lib/app-runtime/theme"
import { platformFiles } from "@/lib/app-project/templates"
import { screenPath } from "@/lib/app-project/project"

const plan: AppPlan = {
  appName: "Jot",
  summary: "A small, focused notes app: a list of notes and a detail screen to create, edit and delete one.",
  targetUsers: "Anyone who wants to jot a quick note and find it again later.",
  coreFeatures: ["Create a note", "Edit a note's title and body", "Delete a note", "See all notes, most recent first"],
  design: {
    style: "Clean, minimal, plenty of whitespace",
    primaryColor: "#4F46E5",
    accentColor: "#10B981",
    backgroundColor: "#F8FAFC",
    surfaceColor: "#FFFFFF",
    textColor: "#0F172A",
    cornerRadius: "soft",
    typography: "Modern sans-serif",
  },
  navigation: "A single tab (Notes) that lists notes; tapping one, or the add button, opens a detail screen pushed on top.",
  screens: [
    { id: "notes-list", name: "Notes", purpose: "Lists every note, most recent first; a button adds a new one.", keyElements: ["Note list", "Add button", "Empty state"], navigatesTo: ["note-detail"], presentation: "tab" },
    { id: "note-detail", name: "Note", purpose: "Create, edit or delete one note.", keyElements: ["Title field", "Body field", "Save", "Delete"], navigatesTo: [], presentation: "stack" },
  ],
}

const data = normalizeDataModel(
  {
    collections: [
      {
        name: "notes",
        label: "Notes",
        fields: [
          { name: "title", type: "string" },
          { name: "body", type: "text" },
        ],
        seed: [
          { id: "n1", title: "Groceries", body: "Milk, eggs, bread, coffee.", createdAt: "2026-11-15T09:00:00.000Z" },
          { id: "n2", title: "Book idea", body: "A story about a lighthouse keeper who starts receiving letters from the future.", createdAt: "2026-11-16T14:30:00.000Z" },
          { id: "n3", title: "Call the dentist", body: "Reschedule the cleaning for next week.", createdAt: "2026-11-17T08:15:00.000Z" },
        ],
      },
    ],
    settings: {},
    user: { name: "Alex Morgan", email: "alex@example.com" },
  },
  "fixture-notes-v1"
)

const themes = { themes: fallbackThemes(plan), activeId: "original", hash: "fixture-notes-v1" }
const platform = platformFiles(plan, themes, data)

// ---------------------------------------------------------------- components

const NOTE_CARD = `import { Pressable, Text, View } from "react-native"
import { createStyles } from "@/theme"

type NoteCardProps = {
  title: string
  body: string
  onPress: () => void
}

const useStyles = createStyles((t) => ({
  card: {
    backgroundColor: t.colors.surface,
    borderRadius: t.radius.lg,
    borderWidth: 1,
    borderColor: t.colors.border,
    padding: t.spacing.lg,
    gap: t.spacing.xs,
  },
  title: { fontSize: 17, fontWeight: "600", color: t.colors.text },
  body: { fontSize: 14, color: t.colors.textMuted },
}) as const)

export function NoteCard({ title, body, onPress }: NoteCardProps) {
  const s = useStyles()
  return (
    <Pressable accessibilityRole="button" onPress={onPress} style={s.card}>
      <View>
        <Text style={s.title} numberOfLines={1}>{title || "Untitled"}</Text>
        <Text style={s.body} numberOfLines={2}>{body}</Text>
      </View>
    </Pressable>
  )
}
`

const PRIMARY_BUTTON = `import { Pressable, Text } from "react-native"
import { createStyles, useTheme } from "@/theme"

type PrimaryButtonProps = {
  label: string
  onPress: () => void
  variant?: "primary" | "danger"
  disabled?: boolean
}

const useStyles = createStyles((t) => ({
  button: {
    borderRadius: t.radius.md,
    paddingVertical: t.spacing.md,
    paddingHorizontal: t.spacing.lg,
    alignItems: "center",
  },
  label: { fontSize: 16, fontWeight: "600" },
}) as const)

export function PrimaryButton({ label, onPress, variant = "primary", disabled = false }: PrimaryButtonProps) {
  const t = useTheme()
  const s = useStyles()
  const bg = variant === "danger" ? t.colors.danger : t.colors.primary
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={label}
      disabled={disabled}
      onPress={onPress}
      style={[s.button, { backgroundColor: bg, opacity: disabled ? 0.5 : 1 }]}
    >
      <Text style={[s.label, { color: t.colors.onPrimary }]}>{label}</Text>
    </Pressable>
  )
}
`

const EMPTY_STATE = `import { Text, View } from "react-native"
import { createStyles } from "@/theme"

type EmptyStateProps = {
  title: string
  message?: string
}

const useStyles = createStyles((t) => ({
  wrap: { alignItems: "center", gap: t.spacing.sm, paddingVertical: t.spacing.xxl },
  title: { fontSize: 18, fontWeight: "600", color: t.colors.text },
  message: { fontSize: 14, color: t.colors.textMuted, textAlign: "center" },
}) as const)

export function EmptyState({ title, message }: EmptyStateProps) {
  const s = useStyles()
  return (
    <View style={s.wrap}>
      <Text style={s.title}>{title}</Text>
      {message ? <Text style={s.message}>{message}</Text> : null}
    </View>
  )
}
`

const TEXT_FIELD = `import { Text, TextInput, View } from "react-native"
import { createStyles, useTheme } from "@/theme"

type TextFieldProps = {
  label: string
  value: string
  onChangeText: (text: string) => void
  placeholder?: string
  multiline?: boolean
}

const useStyles = createStyles((t) => ({
  wrap: { gap: t.spacing.xs },
  label: { fontSize: 13, fontWeight: "600", color: t.colors.text },
  input: {
    borderWidth: 1,
    borderRadius: t.radius.md,
    padding: t.spacing.md,
    color: t.colors.text,
    backgroundColor: t.colors.surface,
  },
}) as const)

export function TextField({ label, value, onChangeText, placeholder, multiline = false }: TextFieldProps) {
  const t = useTheme()
  const s = useStyles()
  return (
    <View style={s.wrap}>
      <Text style={s.label}>{label}</Text>
      <TextInput
        accessibilityLabel={label}
        value={value}
        onChangeText={onChangeText}
        placeholder={placeholder}
        placeholderTextColor={t.colors.textMuted}
        multiline={multiline}
        style={[s.input, { borderColor: t.colors.border, minHeight: multiline ? 96 : undefined }]}
      />
    </View>
  )
}
`

// ---------------------------------------------------------------- screens

const NOTES_LIST = `import { FlatList, Text, View } from "react-native"
import { useRouter } from "expo-router"
import { createStyles, useTheme } from "@/theme"
import { useCollection } from "@/lib/backend"
import { NoteCard } from "@/components/NoteCard"
import { PrimaryButton } from "@/components/PrimaryButton"
import { EmptyState } from "@/components/EmptyState"

const useStyles = createStyles((t) => ({
  screen: { flex: 1, backgroundColor: t.colors.background },
  content: { padding: t.spacing.lg, gap: t.spacing.md },
  header: { gap: t.spacing.xxs, marginBottom: t.spacing.sm },
  title: { fontSize: 28, fontWeight: "700", color: t.colors.text },
  subtitle: { fontSize: 14, color: t.colors.textMuted },
}) as const)

export default function NotesListScreen() {
  const t = useTheme()
  const s = useStyles()
  const router = useRouter()
  const { data: notes, loading } = useCollection("notes", { sort: "-createdAt" })

  return (
    <View style={s.screen}>
      <FlatList
        data={notes}
        keyExtractor={(item) => item.id}
        contentContainerStyle={s.content}
        ListHeaderComponent={
          <View style={s.header}>
            <Text style={s.title}>Notes</Text>
            <Text style={s.subtitle}>{loading ? "Loading..." : \`\${notes.length} note\${notes.length === 1 ? "" : "s"}\`}</Text>
          </View>
        }
        ListEmptyComponent={loading ? undefined : <EmptyState title="No notes yet" message="Tap Add Note to write your first one." />}
        renderItem={({ item }) => (
          <NoteCard title={item.title} body={item.body} onPress={() => router.push({ pathname: "/note-detail", params: { id: item.id } })} />
        )}
        ListFooterComponent={
          <View style={{ marginTop: t.spacing.md }}>
            <PrimaryButton label="Add Note" onPress={() => router.push("/note-detail")} />
          </View>
        }
      />
    </View>
  )
}
`

const NOTE_DETAIL = `import { useState } from "react"
import { ScrollView, Text, View } from "react-native"
import { useLocalSearchParams, useRouter } from "expo-router"
import { createStyles, useTheme } from "@/theme"
import { useCollection, useRecord } from "@/lib/backend"
import { PrimaryButton } from "@/components/PrimaryButton"
import { TextField } from "@/components/TextField"

const useStyles = createStyles((t) => ({
  screen: { flex: 1, backgroundColor: t.colors.background },
  content: { padding: t.spacing.lg, gap: t.spacing.lg },
  title: { fontSize: 24, fontWeight: "700", color: t.colors.text },
  actions: { gap: t.spacing.sm, marginTop: t.spacing.md },
}) as const)

export default function NoteDetailScreen() {
  const t = useTheme()
  const s = useStyles()
  const router = useRouter()
  const { id } = useLocalSearchParams<{ id?: string }>()
  const { data: note, update, remove } = useRecord("notes", id)
  const { insert } = useCollection("notes")

  const [title, setTitle] = useState(note?.title ?? "")
  const [body, setBody] = useState(note?.body ?? "")

  const save = async () => {
    if (id && note) await update({ title, body })
    else await insert({ title, body })
    router.back()
  }

  const remove_ = async () => {
    if (!id) return
    await remove()
    router.back()
  }

  return (
    <ScrollView style={s.screen} contentContainerStyle={s.content}>
      <Text style={s.title}>{id ? "Edit Note" : "New Note"}</Text>
      <TextField label="Title" value={title} onChangeText={setTitle} placeholder="Note title" />
      <TextField label="Body" value={body} onChangeText={setBody} placeholder="Write something..." multiline />
      <View style={s.actions}>
        <PrimaryButton label="Save" onPress={save} />
        {id ? <PrimaryButton label="Delete" variant="danger" onPress={remove_} /> : null}
      </View>
    </ScrollView>
  )
}
`

// ---------------------------------------------------------------- assemble

const ROOT_LAYOUT = `import { Stack } from "expo-router"
import { SafeAreaProvider } from "react-native-safe-area-context"
import { ThemeProvider, useTheme } from "@/theme"

function RootStack() {
  const t = useTheme()
  return <Stack screenOptions={{ headerShown: false, contentStyle: { backgroundColor: t.colors.background } }} />
}

export default function RootLayout() {
  return (
    <ThemeProvider>
      <SafeAreaProvider>
        <RootStack />
      </SafeAreaProvider>
    </ThemeProvider>
  )
}
`

const TABS_LAYOUT = `import { NativeTabs } from "expo-router/native-tabs"
import { useTheme } from "@/theme"

export default function TabsLayout() {
  const t = useTheme()
  return (
    <NativeTabs tintColor={t.colors.primary}>
      <NativeTabs.Trigger name="notes-list">
        <NativeTabs.Trigger.Label>Notes</NativeTabs.Trigger.Label>
        <NativeTabs.Trigger.Icon sf={{ default: "list.bullet", selected: "list.bullet" }} md="list" />
      </NativeTabs.Trigger>
    </NativeTabs>
  )
}
`

const files: Record<string, string> = {
  ...platform,
  "app/_layout.tsx": ROOT_LAYOUT,
  "app/(tabs)/_layout.tsx": TABS_LAYOUT,
  "components/NoteCard.tsx": NOTE_CARD,
  "components/PrimaryButton.tsx": PRIMARY_BUTTON,
  "components/EmptyState.tsx": EMPTY_STATE,
  "components/TextField.tsx": TEXT_FIELD,
}

const screens: GeneratedScreen[] = plan.screens.map((s) => ({ id: s.id, name: s.name, state: "ready" as const, path: screenPath(s) }) as const)
screens[0].code = NOTES_LIST
screens[1].code = NOTE_DETAIL

const doc = {
  v: 2 as const,
  screens,
  files,
  shellHash: "fixture-notes-v1",
  themes,
  data,
  backend: { provider: "local" as const },
}

const out = path.join(process.cwd(), "eval", "fixtures", "notes.json")
writeFileSync(out, JSON.stringify({ plan, doc }, null, 2) + "\n")
console.log(`Wrote ${out}`)
for (const s of screens) console.log(` - ${s.path}: ${s.code!.split("\n").length} lines`)
