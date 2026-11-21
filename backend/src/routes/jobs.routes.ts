import { Router } from "express"
import express from "express"
import * as agentController from "../controllers/agent.controller"

export const jobsRouter = Router()

jobsRouter.post("/agent", express.raw({ type: "*/*" }), agentController.postJobWorker)
