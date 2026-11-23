import { Router } from "express"
import * as publicController from "../controllers/public.controller"

export const publicRouter = Router()

publicRouter.get("/projects", publicController.list)
publicRouter.get("/projects/:slug", publicController.getBySlug)
