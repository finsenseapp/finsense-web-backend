import type { Request, Response } from "express";
import * as service from "./accounts.service.js";

export async function list(req: Request, res: Response) {
  res.json(await service.listAccounts(req.user!.id, res.locals.query));
}

export async function get(req: Request, res: Response) {
  res.json({ account: await service.getAccount(req.user!.id, req.params.id as string) });
}

export async function create(req: Request, res: Response) {
  res.status(201).json({ account: await service.createAccount(req.user!.id, req.body) });
}

export async function update(req: Request, res: Response) {
  res.json({
    account: await service.updateAccount(req.user!.id, req.params.id as string, req.body),
  });
}

export async function remove(req: Request, res: Response) {
  await service.deleteAccount(req.user!.id, req.params.id as string);
  res.status(204).end();
}
