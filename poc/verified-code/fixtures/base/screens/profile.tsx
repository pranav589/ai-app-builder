import { Card, Screen, Stat, Text } from "@app/kit"
import { useEntries, useHabits } from "@/data"

export default function ProfileScreen() {
  const habits = useHabits()
  const entries = useEntries()

  return (
    <Screen>
      <Text variant="title">Your progress</Text>
      <Card>
        <Stat label="Active habits" value={habits.data.length} />
        <Stat label="Total check-ins" value={entries.data.length} />
      </Card>
    </Screen>
  )
}
