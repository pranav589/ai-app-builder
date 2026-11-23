import { Router } from "express"
import express from "express"
import * as publishController from "../controllers/publish.controller"

export const publishRouter = Router()

publishRouter.post("/webhook", express.raw({ type: "*/*" }), publishController.webhook)
publishRouter.post("/web-webhook", express.raw({ type: "*/*" }), publishController.webWebhook)
