import type { Request, Response } from "express";
import { streamCsv, streamPdf } from "./export.service.js";
import { createSplit, deleteSplit } from "./split.service.js";
import * as service from "./transactions.service.js";

export async function list(req: Request, res: Response) {
  res.json(await service.listTransactions(req.user!.id, res.locals.query));
}

export async function get(req: Request, res: Response) {
  res.json({ transaction: await service.getTransaction(req.user!.id, req.params.id as string) });
}

export async function create(req: Request, res: Response) {
  res.status(201).json({ transaction: await service.createTransaction(req.user!.id, req.body) });
}

export async function update(req: Request, res: Response) {
  res.json({
    transaction: await service.updateTransaction(req.user!.id, req.params.id as string, req.body),
  });
}

export async function remove(req: Request, res: Response) {
  await service.deleteTransaction(req.user!.id, req.params.id as string);
  res.status(204).end();
}

export async function bulk(req: Request, res: Response) {
  res.status(201).json(await service.bulkCreateTransactions(req.user!.id, req.body));
}

export async function split(req: Request, res: Response) {
  res.status(201).json(await createSplit(req.user!.id, req.body));
}

export async function removeSplit(req: Request, res: Response) {
  await deleteSplit(req.user!.id, req.params.groupId as string);
  res.status(204).end();
}

export async function exportFile(req: Request, res: Response) {
  const query = res.locals.query;
  if (query.format === "pdf") await streamPdf(req.user!.id, query, res);
  else await streamCsv(req.user!.id, query, res);
}
