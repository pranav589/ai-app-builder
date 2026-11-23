import { Router } from "express"
import * as appFilesController from "../controllers/app-files.controller"

export const appFilesRouter = Router()

appFilesRouter.get("/:projectId/{*key}", appFilesController.getAppFile)
