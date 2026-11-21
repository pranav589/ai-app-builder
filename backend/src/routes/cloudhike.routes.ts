import { Router } from "express"
import { optionalUser, requireUser } from "../middleware/requireUser"
import { requireProjectOwner } from "../middleware/requireProjectOwner"
import * as cloudhikeController from "../controllers/cloudhike.controller"

export const cloudhikeRouter = Router()

cloudhikeRouter.get("/connect", requireUser, requireProjectOwner, cloudhikeController.connect)
cloudhikeRouter.get("/callback", optionalUser, cloudhikeController.callback)
