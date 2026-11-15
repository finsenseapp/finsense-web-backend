import type { Request, Response } from "express";
import * as service from "./categories.service.js";

export async function list(req: Request, res: Response) {
  res.json(await service.listCategories(req.user!.id, res.locals.query));
}

export async function create(req: Request, res: Response) {
  res.status(201).json({ category: await service.createCategory(req.user!.id, req.body) });
}

export async function update(req: Request, res: Response) {
  res.json({
    category: await service.updateCategory(req.user!.id, req.params.id as string, req.body),
  });
}

export async function remove(req: Request, res: Response) {
  await service.deleteCategory(req.user!.id, req.params.id as string);
  res.status(204).end();
}
