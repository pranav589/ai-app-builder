import { Button, Card, ProgressBar, Row, Screen, Stack, Stat, Text } from "@app/kit"
import { useEntries, useHabits } from "@/data"
import { useNav } from "@/nav"

export default function HomeScreen() {
  const nav = useNav()
  const habits = useHabits({ sort: "title" })
  const entries = useEntries()

  const doneThisWeek = (habitId: string) => entries.data.filter((e) => e.habit === habitId).length

  return (
    <Screen>
      <Row justify="between">
        <Stat label="Habits" value={habits.data.length} size="lg" />
        <Stat label="Check-ins" value={entries.data.length} size="lg" />
      </Row>
      <Stack gap="sm">
        {habits.data.map((h) => (
          <Card key={h.id} onPress={() => nav.go("habitDetail", { id: h.id })}>
            <Text variant="heading">{h.title}</Text>
            <Text variant="caption">
              {doneThisWeek(h.id)} of {h.target} this week
            </Text>
            <ProgressBar value={doneThisWeek(h.id) / h.target} />
          </Card>
        ))}
      </Stack>
      <Button label="New habit" icon="plus" onPress={() => nav.go("newHabit")} />
    </Screen>
  )
}
