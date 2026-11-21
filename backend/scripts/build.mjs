// Bundles the Express API into one runnable file. A plain `tsc` can't do this:
// backend/tsconfig.json has noEmit:true (it exists only for type-checking -- see
// the "typecheck" script), and even with noEmit off, `tsc` would leave the
// "@/db" / "@app/shared/*" path aliases and the ../shared imports unresolved at
// runtime, since Node doesn't understand tsconfig "paths". esbuild bundles
// everything into one file and resolves those aliases itself, using this
// directory's tsconfig.json (it picks up the nearest one automatically).
import { build } from "esbuild"

await build({
  entryPoints: ["src/server.ts"],
  outfile: "dist/index.js",
  bundle: true,
  platform: "node",
  format: "esm",
  // Keep node_modules out of the bundle (native/wasm deps like libsodium-wrappers
  // don't bundle cleanly, and there's no reason to inline them on a real server).
  packages: "external",
  sourcemap: true,
  // backend/package.json has "type":"module", so the output below must be real ESM --
  // but src/services/app-project/self-host.ts (copied so the exported app's own
  // server can read these same files) still uses the CJS globals __dirname/
  // __filename/require. This banner defines working equivalents the same way
  // Node's CJS loader would, so that file keeps working unbundled too.
  banner: {
    js: [
      "import { createRequire as __createRequire } from 'node:module';",
      "import { fileURLToPath as __fileURLToPath } from 'node:url';",
      "import { dirname as __dirnameFn } from 'node:path';",
      "const require = __createRequire(import.meta.url);",
      "const __filename = __fileURLToPath(import.meta.url);",
      "const __dirname = __dirnameFn(__filename);",
    ].join("\n"),
  },
})
