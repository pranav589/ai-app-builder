import { fileURLToPath } from "node:url"
import { defineConfig } from "vitest/config"

export default defineConfig({
  resolve: {
    alias: {
      "@": fileURLToPath(new URL(".", import.meta.url)),
      "@app/shared": fileURLToPath(new URL("./shared", import.meta.url)),
    },
  },
  test: {
    exclude: ["node_modules/**", "poc/**", ".next/**", "vendor/**", ".device/**"],
    // A cold TS LanguageService start (the first typecheckGate call in a file) or a real
    // render-gate sandbox mount can run well past the 5000ms default under full-suite
    // parallel CPU contention, even though each is ~2s in isolation. A global bump covers
    // every such test instead of chasing whichever one times out under load this run.
    testTimeout: 15000,
  },
})
