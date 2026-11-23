import { Router } from "express"
import { optionalUser, requireUser } from "../middleware/requireUser"
import { requireProjectOwner } from "../middleware/requireProjectOwner"
import * as backendController from "../controllers/backend.controller"

// Linking a creator's backend-provider account (/api/backend-providers/:provider/...).
export const backendProvidersRouter = Router()

backendProvidersRouter.get("/:provider/connect", requireUser, requireProjectOwner, backendController.connect)
backendProvidersRouter.get("/:provider/callback", optionalUser, backendController.callback)
