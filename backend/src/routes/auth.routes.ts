import { Router } from "express"
import { requireTrustedOriginJson } from "../middleware/origin"
import { getSession, signIn, signOut, signUp, social } from "../controllers/auth.controller"

export const authRouter = Router()

authRouter.get("/session", getSession)
authRouter.post("/sign-in", requireTrustedOriginJson, signIn)
authRouter.post("/sign-up", requireTrustedOriginJson, signUp)
authRouter.post("/sign-out", requireTrustedOriginJson, signOut)
authRouter.post("/social", requireTrustedOriginJson, social)
