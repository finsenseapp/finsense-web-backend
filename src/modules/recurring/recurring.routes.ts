import { Router } from "express";
import { requireAuth } from "../../middleware/auth.js";
import { validate } from "../../middleware/validate.js";
import { createRecurringSchema, recurringIdParamsSchema, updateRecurringSchema } from "./recurring.schemas.js";
import * as service from "./recurring.service.js";

export const recurringRouter = Router();

recurringRouter.use(requireAuth);

recurringRouter.get("/", async (req, res) => {
  res.json(await service.listRules(req.user!.id));
});
recurringRouter.post("/", validate({ body: createRecurringSchema }), async (req, res) => {
  res.status(201).json({ rule: await service.createRule(req.user!.id, req.body) });
});
recurringRouter.patch(
  "/:id",
  validate({ params: recurringIdParamsSchema, body: updateRecurringSchema }),
  async (req, res) => {
    res.json({ rule: await service.updateRule(req.user!.id, req.params.id as string, req.body) });
  },
);
recurringRouter.delete("/:id", validate({ params: recurringIdParamsSchema }), async (req, res) => {
  await service.deleteRule(req.user!.id, req.params.id as string);
  res.status(204).end();
});
