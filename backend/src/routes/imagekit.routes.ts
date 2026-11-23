import { Router } from "express"
import multer from "multer"
import { requireUser } from "../middleware/requireUser"
import { requireTrustedOriginJson } from "../middleware/origin"
import * as imagekitController from "../controllers/imagekit.controller"

const upload = multer({ limits: { fileSize: 12 * 1024 * 1024 } })

export const imagekitRouter = Router()

imagekitRouter.post("/generate", requireUser, requireTrustedOriginJson, imagekitController.generate)
imagekitRouter.post("/transform", requireUser, requireTrustedOriginJson, imagekitController.transform)
// upload is multipart/form-data, not JSON -- the old route never required same-origin+JSON for it either.
imagekitRouter.post("/upload", requireUser, upload.single("file"), imagekitController.upload)
