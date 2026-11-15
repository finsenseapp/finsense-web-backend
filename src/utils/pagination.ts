import { z } from "zod";

export function paginationSchema(defaultPageSize = 20, maxPageSize = 100) {
  return z.object({
    page: z.coerce.number().int().min(1).default(1),
    pageSize: z.coerce.number().int().min(1).max(maxPageSize).default(defaultPageSize),
  });
}

export type Pagination = { page: number; pageSize: number };

export function toSkipTake({ page, pageSize }: Pagination) {
  return { skip: (page - 1) * pageSize, take: pageSize };
}
