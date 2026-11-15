import { Router } from "express";
import { requireAuth } from "../../middleware/auth.js";
import { validate } from "../../middleware/validate.js";
import { summaryQuerySchema } from "./dashboard.schemas.js";
import { getSummary } from "./dashboard.service.js";

export const dashboardRouter = Router();

dashboardRouter.use(requireAuth);

dashboardRouter.get("/summary", validate({ query: summaryQuerySchema }), async (req, res) => {
  res.json(await getSummary(req.user!.id, res.locals.query));
});
