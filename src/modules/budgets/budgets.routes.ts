import { Router } from "express";
import { requireAuth } from "../../middleware/auth.js";
import { validate } from "../../middleware/validate.js";
import {
  budgetIdParamsSchema,
  createBudgetSchema,
  listBudgetsQuerySchema,
  updateBudgetSchema,
} from "./budgets.schemas.js";
import * as service from "./budgets.service.js";

export const budgetsRouter = Router();

budgetsRouter.use(requireAuth);

budgetsRouter.get("/", validate({ query: listBudgetsQuerySchema }), async (req, res) => {
  res.json(await service.listBudgets(req.user!.id, res.locals.query));
});

budgetsRouter.post("/", validate({ body: createBudgetSchema }), async (req, res) => {
  res.status(201).json({ budget: await service.createBudget(req.user!.id, req.body) });
});

budgetsRouter.patch(
  "/:id",
  validate({ params: budgetIdParamsSchema, body: updateBudgetSchema }),
  async (req, res) => {
    res.json({ budget: await service.updateBudget(req.user!.id, req.params.id as string, req.body) });
  },
);

budgetsRouter.delete("/:id", validate({ params: budgetIdParamsSchema }), async (req, res) => {
  await service.deleteBudget(req.user!.id, req.params.id as string);
  res.status(204).end();
});
