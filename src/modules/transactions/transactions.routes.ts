import { Router } from "express";
import { requireAuth } from "../../middleware/auth.js";
import { uploadReceiptFile } from "../../middleware/upload.js";
import { exportRateLimit } from "../../middleware/rateLimit.js";
import { validate } from "../../middleware/validate.js";
import * as attachments from "./attachments.controller.js";
import {
  bulkTransactionsSchema,
  createTransactionSchema,
  attachmentParamsSchema,
  exportQuerySchema,
  listTransactionsQuerySchema,
  splitGroupParamsSchema,
  splitTransactionSchema,
  transactionIdParamsSchema,
  updateTransactionSchema,
} from "./transactions.schemas.js";
import * as controller from "./transactions.controller.js";

export const transactionsRouter = Router();

transactionsRouter.use(requireAuth);

transactionsRouter.get("/", validate({ query: listTransactionsQuerySchema }), controller.list);
transactionsRouter.post("/", validate({ body: createTransactionSchema }), controller.create);
// Registered before "/:id" so "bulk" is never read as an id.
transactionsRouter.post("/bulk", validate({ body: bulkTransactionsSchema }), controller.bulk);
// Download what the filters show, as CSV or PDF (before "/:id").
transactionsRouter.get("/export", exportRateLimit, validate({ query: exportQuerySchema }), controller.exportFile);

// Split across categories (also before "/:id").
transactionsRouter.post("/split", validate({ body: splitTransactionSchema }), controller.split);
transactionsRouter.delete("/split/:groupId", validate({ params: splitGroupParamsSchema }), controller.removeSplit);
transactionsRouter.get("/:id", validate({ params: transactionIdParamsSchema }), controller.get);
transactionsRouter.patch(
  "/:id",
  validate({ params: transactionIdParamsSchema, body: updateTransactionSchema }),
  controller.update,
);
transactionsRouter.delete("/:id", validate({ params: transactionIdParamsSchema }), controller.remove);

// Receipts (photos or PDFs attached to a transaction)
transactionsRouter.get("/:id/attachments", validate({ params: transactionIdParamsSchema }), attachments.list);
transactionsRouter.post("/:id/attachments", validate({ params: transactionIdParamsSchema }), uploadReceiptFile, attachments.upload);
transactionsRouter.get("/:id/attachments/:attachmentId", validate({ params: attachmentParamsSchema }), attachments.download);
transactionsRouter.delete("/:id/attachments/:attachmentId", validate({ params: attachmentParamsSchema }), attachments.remove);
