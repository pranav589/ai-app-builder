import { Router } from "express"
import { optionalUser, requireUser } from "../middleware/requireUser"
import { requireProjectOwner } from "../middleware/requireProjectOwner"
import * as githubController from "../controllers/github.controller"

export const githubRouter = Router()

githubRouter.get("/connect", requireUser, requireProjectOwner, githubController.connect)
githubRouter.get("/callback", optionalUser, githubController.callback)
githubRouter.get("/status", optionalUser, githubController.status)
githubRouter.get("/repos", requireUser, githubController.repos)
