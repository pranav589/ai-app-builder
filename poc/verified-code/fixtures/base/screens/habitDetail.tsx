import { Button, EmptyState, ListItem, Screen, Section, Stat, Text } from "@app/kit"
import { useEntries, useHabit } from "@/data"
import { useNav, useParams } from "@/nav"

export default function HabitDetailScreen() {
  const { id } = useParams("habitDetail")
  const nav = useNav()
  const habit = useHabit(id)
  const entries = useEntries({ where: { habit: id }, sort: "-date" })

  if (!habit.data) {
    return (
      <Screen>
        <EmptyState title="Habit not found" message="It may have been deleted." action={{ label: "Go back", onPress: nav.back }} />
      </Screen>
    )
  }

  return (
    <Screen>
      <Text variant="title">{habit.data.title}</Text>
      {habit.data.note ? <Text tone="muted">{habit.data.note}</Text> : null}
      <Stat label="Weekly target" value={habit.data.target} />
      <Section title="Check-ins">
        {entries.data.length === 0 ? (
          <Text variant="caption">No check-ins yet.</Text>
        ) : (
          entries.data.map((e) => <ListItem key={e.id} title={e.date} />)
        )}
      </Section>
      <Button
        label="Delete habit"
        variant="danger"
        icon="trash"
        onPress={() => {
          habit.remove()
          nav.back()
        }}
      />
    </Screen>
  )
}
