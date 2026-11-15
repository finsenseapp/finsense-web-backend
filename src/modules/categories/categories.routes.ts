import { Router } from "express";
import { requireAuth } from "../../middleware/auth.js";
import { validate } from "../../middleware/validate.js";
import {
  categoryIdParamsSchema,
  createCategorySchema,
  listCategoriesQuerySchema,
  updateCategorySchema,
} from "./categories.schemas.js";
import * as controller from "./categories.controller.js";

export const categoriesRouter = Router();

categoriesRouter.use(requireAuth);

categoriesRouter.get("/", validate({ query: listCategoriesQuerySchema }), controller.list);
categoriesRouter.post("/", validate({ body: createCategorySchema }), controller.create);
categoriesRouter.patch(
  "/:id",
  validate({ params: categoryIdParamsSchema, body: updateCategorySchema }),
  controller.update,
);
categoriesRouter.delete("/:id", validate({ params: categoryIdParamsSchema }), controller.remove);
