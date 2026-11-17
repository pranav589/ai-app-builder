import { useState } from "react"
import { Button, Screen, Text, TextField } from "@app/kit"
import { useHabits } from "@/data"
import { useNav } from "@/nav"

export default function NewHabitScreen() {
  const nav = useNav()
  const habits = useHabits()
  const [title, setTitle] = useState("")
  const [target, setTarget] = useState("7")

  const targetNumber = Number.parseInt(target, 10)
  const valid = title.trim().length > 0 && targetNumber > 0 && targetNumber <= 7

  return (
    <Screen>
      <TextField label="Habit" value={title} onChangeText={setTitle} placeholder="e.g. Read 20 pages" />
      <TextField label="Days per week" value={target} onChangeText={setTarget} keyboard="number" />
      {!valid ? <Text variant="caption">Enter a name and a target from 1 to 7.</Text> : null}
      <Button
        label="Save habit"
        fullWidth
        disabled={!valid}
        onPress={() => {
          habits.add({ title: title.trim(), target: targetNumber })
          nav.back()
        }}
      />
    </Screen>
  )
}
