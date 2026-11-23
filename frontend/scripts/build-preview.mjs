// Bundles the preview runtime (preview-runtime/) with React, react-native-web
// and the Expo stand-ins into one static script, plus the icon font, under
// public/preview/. Preview frames load these from our origin.
//
//   node scripts/build-preview.mjs          one build
//   node scripts/build-preview.mjs --watch  rebuild on change

import { build, context } from "esbuild"
import { copyFileSync, mkdirSync, existsSync } from "node:fs"
import { dirname, join } from "node:path"
import { fileURLToPath } from "node:url"

const root = join(dirname(fileURLToPath(import.meta.url)), "..")
const out = join(root, "public", "preview")
mkdirSync(out, { recursive: true })

const iconFont = existsSync(join(root, "node_modules/react-native-vector-icons/Fonts/Ionicons.ttf"))
  ? join(root, "node_modules/react-native-vector-icons/Fonts/Ionicons.ttf")
  : join(root, "..", "node_modules/react-native-vector-icons/Fonts/Ionicons.ttf")

const destIcon = join(out, "Ionicons.ttf")
if (!existsSync(destIcon)) {
  try {
    copyFileSync(iconFont, destIcon)
  } catch (e) {
    if (e && e.code !== "EBUSY") throw e
  }
}

const tsconfig = existsSync(join(root, "tsconfig.json"))
  ? join(root, "tsconfig.json")
  : join(root, "..", "tsconfig.json")

const options = {
  entryPoints: [join(root, "preview-runtime/index.tsx")],
  outfile: join(out, "runtime.js"),
  bundle: true,
  format: "iife",
  platform: "browser",
  target: ["es2020"],
  jsx: "automatic",
  minify: true,
  sourcemap: false,
  legalComments: "none",
  tsconfig,
  // `global` is Node's, not a browser's; some bundled packages (react-native-web's
  // Animated among them) still reference it bare. esbuild doesn't shim this for
  // platform: "browser" on its own, so without this define any screen that uses
  // Animated throws "global is not defined" the moment it actually runs -- in the
  // real preview iframe and in the render gate's jsdom alike, since both load this
  // same built file.
  define: { "process.env.NODE_ENV": '"production"', __DEV__: "false", global: "globalThis" },
  // Reanimated and gesture-handler import "react-native" and ship *.web.js
  // variants (gesture-handler's DOM event handling lives only there); without
  // these they'd resolve to native code that can't run in a browser.
  alias: { "react-native": "react-native-web" },
  resolveExtensions: [".web.tsx", ".web.ts", ".web.js", ".tsx", ".ts", ".jsx", ".js", ".json"],
  loader: { ".json": "json" },
  logLevel: "info",
}

if (process.argv.includes("--watch")) {
  const ctx = await context(options)
  await ctx.watch()
} else {
  await build(options)
}
