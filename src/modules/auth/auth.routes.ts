import { Router } from "express";
import { validate } from "../../middleware/validate.js";
import { requireAuth } from "../../middleware/auth.js";
import { authIpRateLimit, loginRateLimit, passwordCheckRateLimit, registerRateLimit } from "../../middleware/rateLimit.js";
import {
  changeEmailSchema,
  changePasswordSchema,
  deleteAccountSchema,
  loginSchema,
  registerSchema,
  updateProfileSchema,
} from "./auth.schemas.js";
import * as controller from "./auth.controller.js";

export const authRouter = Router();

authRouter.use(authIpRateLimit);

authRouter.post("/register", registerRateLimit, validate({ body: registerSchema }), controller.register);
authRouter.post("/login", loginRateLimit, validate({ body: loginSchema }), controller.login);
authRouter.post("/logout", controller.logout);
authRouter.get("/me", requireAuth, controller.me);
authRouter.patch("/me", requireAuth, validate({ body: updateProfileSchema }), controller.updateMe);
authRouter.patch("/me/email", requireAuth, passwordCheckRateLimit, validate({ body: changeEmailSchema }), controller.changeEmail);
authRouter.post("/me/password", requireAuth, passwordCheckRateLimit, validate({ body: changePasswordSchema }), controller.changePassword);
authRouter.delete("/me", requireAuth, passwordCheckRateLimit, validate({ body: deleteAccountSchema }), controller.deleteAccount);
