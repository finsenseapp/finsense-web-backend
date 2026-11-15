import { Router } from "express";
import { requireAuth } from "../../middleware/auth.js";
import { getRates } from "../../services/ratesService.js";

export const ratesRouter = Router();

ratesRouter.use(requireAuth);

ratesRouter.get("/", async (_req, res) => {
  res.json(await getRates());
});
