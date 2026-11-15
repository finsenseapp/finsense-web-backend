import { Router } from "express";
import { requireAuth } from "../../middleware/auth.js";
import { validate } from "../../middleware/validate.js";
import {
  accountIdParamsSchema,
  createAccountSchema,
  listAccountsQuerySchema,
  updateAccountSchema,
} from "./accounts.schemas.js";
import * as controller from "./accounts.controller.js";

export const accountsRouter = Router();

accountsRouter.use(requireAuth);

accountsRouter.get("/", validate({ query: listAccountsQuerySchema }), controller.list);
accountsRouter.post("/", validate({ body: createAccountSchema }), controller.create);
accountsRouter.get("/:id", validate({ params: accountIdParamsSchema }), controller.get);
accountsRouter.patch(
  "/:id",
  validate({ params: accountIdParamsSchema, body: updateAccountSchema }),
  controller.update,
);
accountsRouter.delete("/:id", validate({ params: accountIdParamsSchema }), controller.remove);
