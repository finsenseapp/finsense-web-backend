import type { Request, Response } from "express";
import * as service from "./attachments.service.js";

export async function list(req: Request, res: Response) {
  res.json(await service.listAttachments(req.user!.id, req.params.id as string));
}

export async function upload(req: Request, res: Response) {
  res.status(201).json({ attachment: await service.addAttachment(req.user!.id, req.params.id as string, req.file!) });
}

/**
 * Streams a receipt after the ownership check. The headers keep an uploaded file from ever running as a web page:
 * it is served with its real type, forbidden to be sniffed as something else, in a sandbox with no scripts allowed.
 */
export async function download(req: Request, res: Response) {
  const { row, stream } = await service.openAttachment(req.user!.id, req.params.id as string, req.params.attachmentId as string);
  res.setHeader("Content-Type", row.mimeType);
  res.setHeader("Content-Length", String(row.size));
  res.setHeader("X-Content-Type-Options", "nosniff");
  res.setHeader("Content-Security-Policy", "default-src 'none'; style-src 'unsafe-inline'; sandbox");
  res.setHeader("Cache-Control", "private, no-store");
  res.setHeader("Content-Disposition", `${req.query.download === "1" ? "attachment" : "inline"}; filename*=UTF-8''${encodeURIComponent(row.filename)}`);
  stream.on("error", () => {
    if (!res.headersSent) res.status(404).end();
    else res.destroy();
  });
  stream.pipe(res);
}

export async function remove(req: Request, res: Response) {
  await service.removeAttachment(req.user!.id, req.params.id as string, req.params.attachmentId as string);
  res.status(204).end();
}
