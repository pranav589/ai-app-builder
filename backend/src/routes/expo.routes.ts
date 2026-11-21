import { Router } from "express"
import { optionalUser, requireUser } from "../middleware/requireUser"
import { requireTrustedOriginJson } from "../middleware/origin"
import * as publishController from "../controllers/publish.controller"

export const expoRouter = Router()

expoRouter.get("/status", optionalUser, publishController.expoStatus)
expoRouter.post("/connect", requireUser, requireTrustedOriginJson, publishController.expoConnect)
expoRouter.post("/disconnect", requireUser, requireTrustedOriginJson, publishController.expoDisconnect)
