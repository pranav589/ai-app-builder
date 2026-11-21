// .env is loaded by server.ts, the real entry point, before this file (and everything
// it imports, including the DB pool) is ever evaluated -- see server.ts for why that
// has to happen in a separate file rather than here.

import express from "express"
import cors from "cors"
import cookieParser from "cookie-parser"
import { authRouter } from "./routes/auth.routes"
import { projectsRouter } from "./routes/projects.routes"
import { cloudhikeRouter } from "./routes/cloudhike.routes"
import { githubRouter } from "./routes/github.routes"
import { expoRouter } from "./routes/expo.routes"
import { publishRouter } from "./routes/publish.routes"
import { jobsRouter } from "./routes/jobs.routes"
import { appRuntimeRouter } from "./routes/app-runtime.routes"
import { appFilesRouter } from "./routes/app-files.routes"
import { deviceRouter } from "./routes/device.routes"
import { imagekitRouter } from "./routes/imagekit.routes"
import { publicRouter } from "./routes/public.routes"
import { errorHandler } from "./middleware/errorHandler"
import { isAllowedOrigin } from "./middleware/origin"

export const app = express()

// Trust reverse proxy (for secure cookies, correct IP headers, etc.)
app.set("trust proxy", 1)

// Mounted ahead of the cors()/cookie-parser/body-parser chain below: this route is
// deliberately called cross-origin by built apps (APK, Expo preview, web/ZIP/GitHub
// exports) with no cookies involved, so it answers its own wildcard CORS (see its
// routes file) rather than going through the cookie-based origin allowlist every other
// route uses. Mounting it first means its OPTIONS preflight is never intercepted by the
// global cors() middleware below.
app.use("/api/app-runtime", appRuntimeRouter)

app.use(
  cors({
    origin: (origin, callback) => {
      if (!origin) return callback(null, true)
      return callback(null, isAllowedOrigin(origin))
    },
    credentials: true,
  })
)

app.use(cookieParser())

// Mount raw-body webhook routes before global json parsers
app.use("/api/publish", publishRouter)
app.use("/api/jobs", jobsRouter)

// Global body parsers
app.use(
  express.json({
    limit: "15mb",
    verify: (req, _res, buf) => {
      ;(req as unknown as Record<string, unknown>).rawBody = buf
    },
  })
)
app.use(express.urlencoded({ extended: true, limit: "15mb" }))

// Health check
app.get("/health", (_req, res) => {
  res.json({ ok: true })
})

// Application routes
app.use("/api/auth", authRouter)
app.use("/api/projects", projectsRouter)
app.use("/api/cloudhike", cloudhikeRouter)
app.use("/api/github", githubRouter)
app.use("/api/expo", expoRouter)
app.use("/api/app-files", appFilesRouter)
app.use("/api/device", deviceRouter)
app.use("/api/imagekit", imagekitRouter)
app.use("/api/public", publicRouter)

// Error handling
app.use(errorHandler)

const PORT = Number(process.env.PORT || 4000)

if (process.env.NODE_ENV !== "test") {
  app.listen(PORT, "0.0.0.0", () => {
    console.log(`Backend server listening on port ${PORT}`)
  })
}
