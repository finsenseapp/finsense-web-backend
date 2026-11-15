import { Router } from "express";
import { requireAuth } from "../../middleware/auth.js";
import { validate } from "../../middleware/validate.js";
import {
  contributionParamsSchema,
  contributionSchema,
  createGoalSchema,
  goalIdParamsSchema,
  updateGoalSchema,
} from "./goals.schemas.js";
import * as service from "./goals.service.js";

export const goalsRouter = Router();

goalsRouter.use(requireAuth);

goalsRouter.get("/", async (req, res) => {
  res.json(await service.listGoals(req.user!.id));
});
goalsRouter.post("/", validate({ body: createGoalSchema }), async (req, res) => {
  res.status(201).json({ goal: await service.createGoal(req.user!.id, req.body) });
});
goalsRouter.patch("/:id", validate({ params: goalIdParamsSchema, body: updateGoalSchema }), async (req, res) => {
  res.json({ goal: await service.updateGoal(req.user!.id, req.params.id as string, req.body) });
});
goalsRouter.delete("/:id", validate({ params: goalIdParamsSchema }), async (req, res) => {
  await service.deleteGoal(req.user!.id, req.params.id as string);
  res.status(204).end();
});

goalsRouter.get("/:id/contributions", validate({ params: goalIdParamsSchema }), async (req, res) => {
  res.json(await service.listContributions(req.user!.id, req.params.id as string));
});
goalsRouter.post(
  "/:id/contributions",
  validate({ params: goalIdParamsSchema, body: contributionSchema }),
  async (req, res) => {
    res.status(201).json({ goal: await service.addContribution(req.user!.id, req.params.id as string, req.body) });
  },
);
goalsRouter.delete("/:id/contributions/:contributionId", validate({ params: contributionParamsSchema }), async (req, res) => {
  const p = req.params as { id: string; contributionId: string };
  res.json({ goal: await service.deleteContribution(req.user!.id, p.id, p.contributionId) });
});
