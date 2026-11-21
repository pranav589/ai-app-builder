import { Router } from "express"
import * as deviceController from "../controllers/device.controller"

export const deviceRouter = Router()

deviceRouter.get("/:projectId/manifest", deviceController.getManifest)
