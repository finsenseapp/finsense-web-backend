import { prisma } from "../../lib/prisma.js";
import { AppError } from "../../utils/errors.js";
import { toSkipTake, type Pagination } from "../../utils/pagination.js";
import { categoryVisibleTo } from "./visibility.js";
import type {
  CreateCategoryInput,
  UpdateCategoryInput,
} from "./categories.schemas.js";

type CategoryRow = Awaited<ReturnType<typeof prisma.category.findFirstOrThrow>>;
type CategoryType = CategoryRow["type"];

function serialize(c: CategoryRow) {
  return {
    id: c.id,
    name: c.name,
    type: c.type,
    icon: c.icon,
    isSystem: c.userId === null,
    createdAt: c.createdAt,
  };
}

const isCode = (err: unknown, code: string) => (err as { code?: string })?.code === code;

const visibleTo = categoryVisibleTo;

export async function listCategories(
  userId: string,
  q: Pagination & { type?: CategoryType },
) {
  const where = { ...visibleTo(userId), ...(q.type ? { type: q.type } : {}) };
  const [rows, total] = await Promise.all([
    prisma.category.findMany({
      where,
      // system categories first, then the user's own, alphabetically
      orderBy: [{ type: "asc" }, { userId: { sort: "asc", nulls: "first" } }, { name: "asc" }],
      ...toSkipTake(q),
    }),
    prisma.category.count({ where }),
  ]);
  return { data: rows.map(serialize), meta: { page: q.page, pageSize: q.pageSize, total } };
}

/** Name must be unique per type among system categories and the user's own (AI maps by name). */
async function assertNameFree(userId: string, name: string, type: CategoryType, exceptId?: string) {
  const clash = await prisma.category.findFirst({
    where: {
      ...visibleTo(userId),
      type,
      name: { equals: name, mode: "insensitive" },
      ...(exceptId ? { id: { not: exceptId } } : {}),
    },
  });
  if (clash) throw AppError.conflict("A category with this name already exists");
}

export async function createCategory(userId: string, input: CreateCategoryInput) {
  await assertNameFree(userId, input.name, input.type);
  const category = await prisma.category.create({ data: { ...input, userId } });
  return serialize(category);
}

/** 404 if it does not exist or belongs to someone else; 403 if it is a system category. */
async function findEditable(userId: string, id: string) {
  const category = await prisma.category.findFirst({ where: { id, ...visibleTo(userId) } });
  if (!category) throw AppError.notFound("Category not found");
  if (category.userId === null) throw AppError.forbidden("System categories cannot be changed");
  return category;
}

export async function updateCategory(userId: string, id: string, input: UpdateCategoryInput) {
  const existing = await findEditable(userId, id);
  if (input.name !== undefined) {
    await assertNameFree(userId, input.name, existing.type, id);
  }
  const category = await prisma.category.update({
    where: { id },
    data: { name: input.name, icon: input.icon },
  });
  return serialize(category);
}

const inUseError = () =>
  AppError.conflict("This category is used by transactions, budgets or recurring payments and cannot be deleted");

export async function deleteCategory(userId: string, id: string) {
  await findEditable(userId, id);

  const [transactions, budgets, recurring] = await Promise.all([
    prisma.transaction.count({ where: { userId, categoryId: id } }),
    prisma.budget.count({ where: { userId, categoryId: id } }),
    prisma.recurringRule.count({ where: { userId, categoryId: id } }),
  ]);
  if (transactions + budgets + recurring > 0) throw inUseError();

  try {
    await prisma.category.delete({ where: { id } });
  } catch (err) {
    if (isCode(err, "P2003")) throw inUseError();
    throw err;
  }
}
