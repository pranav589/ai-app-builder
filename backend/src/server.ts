import { existsSync } from "node:fs"
import path from "node:path"

// This file exists ONLY to load .env before anything else runs. ES module static
// imports are hoisted: the whole module graph of "./index" (which eagerly builds the
// Postgres pool from process.env.DATABASE_URL in db/index.ts) would evaluate before any
// non-import code in that file ran, no matter where loadEnvFile was called from inside
// it. Loading .env here first, then dynamically importing "./index" (dynamic imports are
// NOT hoisted -- they run in place), is what actually guarantees the right order.
try {
  if (typeof process.loadEnvFile === "function") {
    const localEnv = path.resolve(process.cwd(), ".env")
    if (existsSync(localEnv)) {
      process.loadEnvFile(localEnv)
    } else {
      const parentEnv = path.resolve(process.cwd(), "../.env")
      if (existsSync(parentEnv)) process.loadEnvFile(parentEnv)
    }
  }
} catch {}

// Next.js logged stray rejections and kept serving; Node's default is to exit. Background work
// (CloudHike setup, agent runs) can reject after its request ended, e.g. when the connection
// to CloudHike resets, and that must not take every other request down with it.
process.on("unhandledRejection", (reason) => console.error("Unhandled rejection:", reason))
process.on("uncaughtException", (err) => console.error("Uncaught exception:", err))

await import("./index")
