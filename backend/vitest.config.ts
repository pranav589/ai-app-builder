import { fileURLToPath } from "node:url"
import { defineConfig } from "vitest/config"

export default defineConfig({
  resolve: {
    alias: {
      "@/db": fileURLToPath(new URL("./db", import.meta.url)),
      "@/lib": fileURLToPath(new URL("./src/services", import.meta.url)),
      "@app/shared": fileURLToPath(new URL("../shared", import.meta.url)),
    },
  },
  test: {
    exclude: ["node_modules/**", "vendor/**"],
    testTimeout: 15000,
    // The render gate settles screens on fixed timers, so it flakes when other test files compete for CPU.
    fileParallelism: false,
  },
})

