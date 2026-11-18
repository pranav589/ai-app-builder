// Plain names for what a tap landed on, shown on the canvas and in the editor
// ("Container", not "View").

const NAMES: Record<string, string> = {
  View: "Container",
  SafeAreaView: "Screen",
  Text: "Text",
  RNText: "Text",
  Image: "Image",
  ImageBackground: "Image",
  Pressable: "Button",
  TouchableOpacity: "Button",
  TouchableHighlight: "Button",
  TouchableWithoutFeedback: "Button",
  ScrollView: "Scroll view",
  FlatList: "List",
  SectionList: "List",
  TextInput: "Input",
  Switch: "Switch",
  LinearGradient: "Gradient",
  Ionicons: "Icon",
  Icon: "Icon",
  Card: "Card",
  Button: "Button",
}

export type ElementKind = "container" | "text" | "image" | "button" | "icon" | "input" | "other"

export const elementName = (tag: string) => NAMES[tag] ?? tag.replace(/([a-z])([A-Z])/g, "$1 $2")

export function elementKind(tag: string): ElementKind {
  const n = NAMES[tag]
  if (n === "Container" || n === "Screen" || n === "Card" || n === "Scroll view" || n === "List" || n === "Gradient") return "container"
  if (n === "Text") return "text"
  if (n === "Image") return "image"
  if (n === "Button") return "button"
  if (n === "Icon") return "icon"
  if (n === "Input") return "input"
  return "other"
}
