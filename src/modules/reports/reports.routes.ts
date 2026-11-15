import { Router } from "express";
import { requireAuth } from "../../middleware/auth.js";
import { validate } from "../../middleware/validate.js";
import { getOverview, overviewQuerySchema } from "./reports.service.js";

export const reportsRouter = Router();

reportsRouter.use(requireAuth);

reportsRouter.get("/overview", validate({ query: overviewQuerySchema }), async (req, res) => {
  res.json(await getOverview(req.user!.id, res.locals.query));
});
