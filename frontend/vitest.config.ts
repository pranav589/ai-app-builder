import { fileURLToPath } from "node:url"
import { defineConfig } from "vitest/config"

// Without this file, `vitest run` here falls back to the root config, whose "@" alias
// points at the repo root (not frontend/), so every "@/..." import in frontend's own
// tests fails to resolve. See backend/vitest.config.ts for the same pattern there.
export default defineConfig({
  resolve: {
    alias: {
      "@": fileURLToPath(new URL(".", import.meta.url)),
      "@app/shared": fileURLToPath(new URL("../shared", import.meta.url)),
    },
  },
  test: {
    // query-provider.test.tsx opts into jsdom itself via a per-file
    // @vitest-environment pragma; the others expect the default (node).
    exclude: ["node_modules/**", ".next/**", "public/**"],
    testTimeout: 15000,
  },
})
