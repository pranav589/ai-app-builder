// Tab and toolbar icons for native tabs (expo-router/native-tabs) and
// expo-symbols. Generated apps use SF Symbols on iOS and Material Symbols on
// Android, chosen from this list; the browser preview draws the matching
// Ionicons glyph. Keep names valid in all three sets.

export type IconEntry = { sf: string; sfSelected: string; md: string; ion: string; ionSelected: string }

const e = (sf: string, sfSelected: string, md: string, ion: string): IconEntry => ({ sf, sfSelected, md, ion: `${ion}-outline`, ionSelected: ion })

export const ICONS: IconEntry[] = [
  e("house", "house.fill", "home", "home"),
  e("magnifyingglass", "magnifyingglass", "search", "search"),
  e("person", "person.fill", "person", "person"),
  e("person.2", "person.2.fill", "group", "people"),
  e("gearshape", "gearshape.fill", "settings", "settings"),
  e("bell", "bell.fill", "notifications", "notifications"),
  e("heart", "heart.fill", "favorite", "heart"),
  e("star", "star.fill", "star", "star"),
  e("calendar", "calendar", "calendar_today", "calendar"),
  e("clock", "clock.fill", "schedule", "time"),
  e("chart.bar", "chart.bar.fill", "bar_chart", "bar-chart"),
  e("chart.pie", "chart.pie.fill", "pie_chart", "pie-chart"),
  e("list.bullet", "list.bullet", "list", "list"),
  e("checkmark.circle", "checkmark.circle.fill", "check_circle", "checkmark-circle"),
  e("plus.circle", "plus.circle.fill", "add_circle", "add-circle"),
  e("square.grid.2x2", "square.grid.2x2.fill", "grid_view", "grid"),
  e("safari", "safari.fill", "explore", "compass"),
  e("map", "map.fill", "map", "map"),
  e("location", "location.fill", "location_on", "location"),
  e("message", "message.fill", "chat", "chatbubble"),
  e("envelope", "envelope.fill", "mail", "mail"),
  e("phone", "phone.fill", "call", "call"),
  e("book", "book.fill", "menu_book", "book"),
  e("bookmark", "bookmark.fill", "bookmark", "bookmark"),
  e("folder", "folder.fill", "folder", "folder"),
  e("doc.text", "doc.text.fill", "description", "document-text"),
  e("tray", "tray.fill", "inbox", "file-tray"),
  e("camera", "camera.fill", "photo_camera", "camera"),
  e("photo", "photo.fill", "image", "image"),
  e("play.circle", "play.circle.fill", "play_circle", "play-circle"),
  e("music.note", "music.note", "music_note", "musical-notes"),
  e("cart", "cart.fill", "shopping_cart", "cart"),
  e("bag", "bag.fill", "shopping_bag", "bag"),
  e("creditcard", "creditcard.fill", "credit_card", "card"),
  e("wallet.pass", "wallet.pass.fill", "account_balance_wallet", "wallet"),
  e("flame", "flame.fill", "local_fire_department", "flame"),
  e("leaf", "leaf.fill", "eco", "leaf"),
  e("dumbbell", "dumbbell.fill", "fitness_center", "barbell"),
  e("figure.walk", "figure.walk", "directions_walk", "walk"),
  e("fork.knife", "fork.knife", "restaurant", "restaurant"),
  e("cup.and.saucer", "cup.and.saucer.fill", "local_cafe", "cafe"),
  e("airplane", "airplane", "flight", "airplane"),
  e("car", "car.fill", "directions_car", "car"),
  e("trophy", "trophy.fill", "emoji_events", "trophy"),
  e("sparkles", "sparkles", "auto_awesome", "sparkles"),
  e("lightbulb", "lightbulb.fill", "lightbulb", "bulb"),
  e("moon", "moon.fill", "dark_mode", "moon"),
  e("sun.max", "sun.max.fill", "light_mode", "sunny"),
  e("cloud", "cloud.fill", "cloud", "cloud"),
  e("globe", "globe", "public", "globe"),
  e("lock", "lock.fill", "lock", "lock-closed"),
  e("tag", "tag.fill", "sell", "pricetag"),
  e("gift", "gift.fill", "redeem", "gift"),
  e("graduationcap", "graduationcap.fill", "school", "school"),
  e("briefcase", "briefcase.fill", "work", "briefcase"),
  e("pawprint", "pawprint.fill", "pets", "paw"),
  e("stethoscope", "stethoscope", "medical_services", "medkit"),
  e("bubble.left.and.bubble.right", "bubble.left.and.bubble.right.fill", "forum", "chatbubbles"),
  e("ellipsis.circle", "ellipsis.circle.fill", "more_horiz", "ellipsis-horizontal-circle"),
]

const bySf = new Map<string, IconEntry>()
const byMd = new Map<string, IconEntry>()
for (const i of ICONS) {
  bySf.set(i.sf, i)
  bySf.set(i.sfSelected, i)
  byMd.set(i.md, i)
}

/** The Ionicons glyph the preview draws for an SF Symbol or Material Symbol name. */
export function previewIcon(name: { sf?: string; md?: string }, selected: boolean): string | null {
  const hit = (name.sf && bySf.get(name.sf)) || (name.md && byMd.get(name.md))
  if (!hit) return null
  return selected ? hit.ionSelected : hit.ion
}

/** For the AI: the icon names it may use, as "sf / md" pairs. */
export const ICON_VOCABULARY = ICONS.map((i) => `${i.sf} (${i.sfSelected}) / ${i.md}`).join(", ")

/** For the verified engine's manifest: the icon vocabulary by its single Ionicons name (lib/manifest/schema.ts validates a tab screen's icon against this). */
export const MANIFEST_ICON_NAMES = ICONS.map((i) => i.ion).join(", ")
