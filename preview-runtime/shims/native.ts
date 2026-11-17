// Expo native modules and React Native APIs, as the preview runs them.
// Anything that needs system UI (alerts, share sheet, Face ID, permission
// prompts, notifications) is drawn by the host around the device, so it
// looks like the real OS and works the same on every screen.

import * as RNW from "react-native-web"
import { config, rpc } from "../bridge"

type AlertButton = { text?: string; style?: "default" | "cancel" | "destructive"; onPress?: () => void }

export const Alert = {
  alert(title: string, message?: string, buttons?: AlertButton[]) {
    const list: AlertButton[] = buttons?.length ? buttons : [{ text: "OK" }]
    void rpc<number>("ui.alert", { title, message, buttons: list.map((b) => ({ text: b.text ?? "OK", style: b.style ?? "default" })) }).then((i) =>
      list[i]?.onPress?.()
    )
  },
  prompt(title: string, message?: string) {
    Alert.alert(title, message)
  },
}

export const ActionSheetIOS = {
  showActionSheetWithOptions(
    opts: { options: string[]; cancelButtonIndex?: number; destructiveButtonIndex?: number | number[]; title?: string; message?: string },
    cb: (index: number) => void
  ) {
    void rpc<number>("ui.actionSheet", opts as unknown as Record<string, unknown>).then(cb)
  },
}

export const Share = {
  share: async (content: { message?: string; title?: string; url?: string }) => {
    const ok = await rpc<boolean>("native", { kind: "share", text: content.message ?? content.title ?? content.url ?? config.appName })
    return { action: ok ? "sharedAction" : "dismissedAction" }
  },
  sharedAction: "sharedAction",
  dismissedAction: "dismissedAction",
}

function openUrl(url: string) {
  const kind = url.startsWith("tel:") ? "call" : url.startsWith("mailto:") ? "email" : "link"
  return rpc<boolean>("native", { kind, arg: url.replace(/^(tel:|mailto:)/, "") }).then(() => true)
}

export const Linking = {
  ...RNW.Linking,
  openURL: openUrl,
  canOpenURL: async () => true,
  openSettings: async () => void rpc("ui.toast", { text: "Opens Settings on a device" }),
  createURL: (path: string) => `${config.appName.toLowerCase().replace(/\W+/g, "")}://${path.replace(/^\//, "")}`,
  addEventListener: () => ({ remove() {} }),
  getInitialURL: async () => null,
}

export const Vibration = {
  vibrate: () => void rpc("native", { kind: "haptic" }),
  cancel: () => {},
}

export const Platform = {
  ...RNW.Platform,
  OS: config.platform,
  isPad: false,
  isTV: false,
  Version: config.platform === "ios" ? "18.0" : 34,
  select: <T,>(o: Record<string, T>) => (config.platform in o ? o[config.platform] : "native" in o ? o.native : o.default),
}

// ---------------------------------------------------------------- expo-haptics

export const Haptics = {
  impactAsync: async (style?: string) => void rpc("native", { kind: "haptic", arg: style === "heavy" ? "heavy" : "light" }),
  notificationAsync: async () => void rpc("native", { kind: "haptic" }),
  selectionAsync: async () => void rpc("native", { kind: "haptic" }),
  ImpactFeedbackStyle: { Light: "light", Medium: "medium", Heavy: "heavy", Soft: "soft", Rigid: "rigid" },
  NotificationFeedbackType: { Success: "success", Warning: "warning", Error: "error" },
}

// ---------------------------------------------------------------- expo-image-picker

function pickImage(capture: boolean) {
  return new Promise<{ canceled: boolean; assets: { uri: string; width: number; height: number; fileName: string; mimeType: string; type: "image" }[] | null }>(
    (resolve) => {
      const input = document.createElement("input")
      input.type = "file"
      input.accept = "image/*"
      if (capture) input.setAttribute("capture", "environment")
      input.style.display = "none"
      let settled = false
      const done = (v: Parameters<typeof resolve>[0]) => {
        if (settled) return
        settled = true
        input.remove()
        resolve(v)
      }
      input.addEventListener("change", () => {
        const f = input.files?.[0]
        if (!f) return done({ canceled: true, assets: null })
        if (f.size > 6 * 1024 * 1024) {
          void rpc("ui.toast", { text: "Pick an image under 6 MB", tone: "error" })
          return done({ canceled: true, assets: null })
        }
        const reader = new FileReader()
        reader.onload = () => {
          const uri = String(reader.result)
          const img = new Image()
          img.onload = () => done({ canceled: false, assets: [{ uri, width: img.naturalWidth, height: img.naturalHeight, fileName: f.name, mimeType: f.type, type: "image" }] })
          img.onerror = () => done({ canceled: false, assets: [{ uri, width: 0, height: 0, fileName: f.name, mimeType: f.type, type: "image" }] })
          img.src = uri
        }
        reader.readAsDataURL(f)
      })
      input.addEventListener("cancel", () => done({ canceled: true, assets: null }))
      document.body.appendChild(input)
      input.click()
    }
  )
}

const granted = { status: "granted", granted: true, canAskAgain: true, expires: "never" }

export const ImagePicker = {
  launchImageLibraryAsync: () => pickImage(false),
  launchCameraAsync: () => pickImage(true),
  requestMediaLibraryPermissionsAsync: async () => granted,
  requestCameraPermissionsAsync: async () => granted,
  getMediaLibraryPermissionsAsync: async () => granted,
  getCameraPermissionsAsync: async () => granted,
  useMediaLibraryPermissions: () => [granted, async () => granted],
  useCameraPermissions: () => [granted, async () => granted],
  MediaTypeOptions: { Images: "Images", Videos: "Videos", All: "All" },
  MediaType: { Images: "images", Videos: "videos" },
  PermissionStatus: { GRANTED: "granted", DENIED: "denied", UNDETERMINED: "undetermined" },
}

// ---------------------------------------------------------------- expo-location

let lastLocation: { latitude: number; longitude: number; label: string } | null = null

export const Location = {
  requestForegroundPermissionsAsync: async () => {
    const ok = await rpc<boolean>("native", { kind: "permission", arg: "location" })
    return ok ? granted : { status: "denied", granted: false, canAskAgain: false, expires: "never" }
  },
  getForegroundPermissionsAsync: async () => granted,
  getCurrentPositionAsync: async () => {
    const res = await rpc<{ latitude: number; longitude: number; label: string } | null>("native", { kind: "location" })
    lastLocation = res ?? { latitude: 37.7749, longitude: -122.4194, label: "San Francisco" }
    return { coords: { latitude: lastLocation.latitude, longitude: lastLocation.longitude, accuracy: 12, altitude: null, heading: null, speed: null }, timestamp: Date.now() }
  },
  getLastKnownPositionAsync: async () => (lastLocation ? { coords: { latitude: lastLocation.latitude, longitude: lastLocation.longitude, accuracy: 12 }, timestamp: Date.now() } : null),
  reverseGeocodeAsync: async () => [{ name: lastLocation?.label ?? "Current location", city: lastLocation?.label ?? "Current location", region: "", country: "", street: null, postalCode: null, isoCountryCode: null }],
  watchPositionAsync: async () => ({ remove() {} }),
  Accuracy: { Lowest: 1, Low: 2, Balanced: 3, High: 4, Highest: 5, BestForNavigation: 6 },
}

// ---------------------------------------------------------------- expo-local-authentication

export const LocalAuthentication = {
  hasHardwareAsync: async () => true,
  isEnrolledAsync: async () => true,
  supportedAuthenticationTypesAsync: async () => [2],
  getEnrolledLevelAsync: async () => 3,
  authenticateAsync: async () => {
    const ok = await rpc<boolean>("native", { kind: "biometric" })
    return ok ? { success: true } : { success: false, error: "user_cancel" }
  },
  cancelAuthenticate: async () => {},
  AuthenticationType: { FINGERPRINT: 1, FACIAL_RECOGNITION: 2, IRIS: 3 },
  SecurityLevel: { NONE: 0, SECRET: 1, BIOMETRIC_WEAK: 2, BIOMETRIC_STRONG: 3 },
}

// ---------------------------------------------------------------- expo-notifications

let notificationsGranted = false
const notifPermission = async () => {
  if (!notificationsGranted) notificationsGranted = await rpc<boolean>("native", { kind: "permission", arg: "notifications" })
  return notificationsGranted ? granted : { status: "denied", granted: false, canAskAgain: false, expires: "never" }
}

export const Notifications = {
  requestPermissionsAsync: notifPermission,
  getPermissionsAsync: async () => (notificationsGranted ? granted : { status: "undetermined", granted: false, canAskAgain: true, expires: "never" }),
  setNotificationHandler: () => {},
  setNotificationChannelAsync: async () => null,
  scheduleNotificationAsync: async (req: { content?: { title?: string; body?: string } }) => {
    await rpc("native", { kind: "notify", arg: req?.content?.body ?? "", text: req?.content?.title ?? config.appName })
    return `n-${Date.now()}`
  },
  cancelScheduledNotificationAsync: async () => {},
  cancelAllScheduledNotificationsAsync: async () => {},
  getAllScheduledNotificationsAsync: async () => [],
  addNotificationReceivedListener: () => ({ remove() {} }),
  addNotificationResponseReceivedListener: () => ({ remove() {} }),
  removeNotificationSubscription: () => {},
  getExpoPushTokenAsync: async () => ({ data: "ExponentPushToken[preview]" }),
  AndroidImportance: { DEFAULT: 3, HIGH: 4, MAX: 5 },
  SchedulableTriggerInputTypes: { DATE: "date", TIME_INTERVAL: "timeInterval", DAILY: "daily", WEEKLY: "weekly", CALENDAR: "calendar" },
}

// ---------------------------------------------------------------- small ones

export const Clipboard = {
  setStringAsync: async (text: string) => {
    await rpc("native", { kind: "copy", arg: text })
    return true
  },
  getStringAsync: async () => "",
  hasStringAsync: async () => false,
}

export const Sharing = {
  isAvailableAsync: async () => true,
  shareAsync: async (url: string) => void (await rpc("native", { kind: "share", text: url })),
}

export const Constants = {
  expoConfig: { name: config.appName, slug: config.appName.toLowerCase().replace(/\W+/g, "-"), version: "1.0.0" },
  appOwnership: "expo",
  platform: { ios: config.platform === "ios" ? {} : undefined, android: config.platform === "android" ? {} : undefined },
  statusBarHeight: 54,
}

export const Font = {
  useFonts: () => [true, null],
  loadAsync: async () => {},
  isLoaded: () => true,
}

export const SplashScreen = {
  preventAutoHideAsync: async () => true,
  hideAsync: async () => true,
  hide: () => {},
  setOptions: () => {},
}

const storageKey = (k: string) => `asyncStorage:${k}`
export function makeAsyncStorage(getSettings: () => Record<string, unknown>) {
  const api = {
    getItem: async (k: string) => {
      const v = getSettings()[storageKey(k)]
      return typeof v === "string" ? v : null
    },
    setItem: (k: string, v: string) => rpc<void>("kv.set", { key: storageKey(k), value: v }),
    removeItem: (k: string) => rpc<void>("kv.set", { key: storageKey(k), value: null }),
    mergeItem: async (k: string, v: string) => {
      const cur = await api.getItem(k)
      return api.setItem(k, JSON.stringify({ ...(cur ? JSON.parse(cur) : {}), ...JSON.parse(v) }))
    },
    getAllKeys: async () => Object.keys(getSettings()).filter((k) => k.startsWith("asyncStorage:")).map((k) => k.slice(13)),
    multiGet: async (keys: string[]) => Promise.all(keys.map(async (k) => [k, await api.getItem(k)] as const)),
    multiSet: async (pairs: [string, string][]) => void (await Promise.all(pairs.map(([k, v]) => api.setItem(k, v)))),
    multiRemove: async (keys: string[]) => void (await Promise.all(keys.map((k) => api.removeItem(k)))),
    clear: async () => void (await Promise.all((await api.getAllKeys()).map((k) => api.removeItem(k)))),
  }
  return api
}
