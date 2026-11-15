import { z } from "zod";
import { paginationSchema } from "../../utils/pagination.js";

const categoryType = z.enum(["INCOME", "EXPENSE"]);
const name = z.string().trim().min(1, "Name is required").max(60);
// lucide icon names are kebab-case, e.g. "shopping-bag"
const icon = z
  .string()
  .trim()
  .regex(/^[a-z0-9]+(-[a-z0-9]+)*$/, "Icon must be a lucide icon name like \"shopping-bag\"")
  .max(50);

export const createCategorySchema = z.object({
  name,
  type: categoryType,
  icon: icon.default("circle-ellipsis"),
});

// The type cannot be changed: existing transactions and budgets depend on it.
export const updateCategorySchema = z
  .object({
    name: name.optional(),
    icon: icon.optional(),
  })
  .strict()
  .refine((v) => Object.keys(v).length > 0, { message: "Provide at least one field to update" });

export const categoryIdParamsSchema = z.object({ id: z.uuid() });

export const listCategoriesQuerySchema = paginationSchema(100, 200).extend({
  type: categoryType.optional(),
});

export type CreateCategoryInput = z.infer<typeof createCategorySchema>;
export type UpdateCategoryInput = z.infer<typeof updateCategorySchema>;
