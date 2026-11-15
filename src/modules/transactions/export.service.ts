import type { Response } from "express";
import PDFDocument from "pdfkit";
import { env } from "../../config/env.js";
import { prisma } from "../../lib/prisma.js";
import { csvRow } from "../../utils/csv.js";
import { isoDateInZone } from "../../utils/dates.js";
import { AppError } from "../../utils/errors.js";
import { Decimal, formatMoney } from "../../utils/money.js";
import { transactionInclude, buildTransactionWhere } from "./transactions.service.js";
import type { ExportQuery } from "./transactions.schemas.js";

export const MAX_CSV_ROWS = 50_000;
export const MAX_PDF_ROWS = 5_000;
const BATCH = 500;

const orderBy = [{ date: "desc" as const }, { createdAt: "desc" as const }, { id: "desc" as const }];

const filenameDate = () => isoDateInZone(new Date(), env.APP_TIMEZONE);

/** Reads the matching rows in batches so a large export never loads everything into memory at once. */
async function* rowsFor(userId: string, q: ExportQuery, limit: number) {
  const where = buildTransactionWhere(userId, q);
  const total = await prisma.transaction.count({ where });
  if (total > limit) {
    throw new AppError(413, "EXPORT_TOO_LARGE", `That is ${total.toLocaleString("en-US")} transactions; an export holds at most ${limit.toLocaleString("en-US")}. Narrow the dates or filters and try again.`);
  }
  for (let skip = 0; skip < total; skip += BATCH) {
    yield* await prisma.transaction.findMany({ where, include: transactionInclude, orderBy, skip, take: BATCH });
  }
}

type Row = Awaited<ReturnType<typeof prisma.transaction.findFirstOrThrow>> & {
  account: { name: string; currency: string };
  toAccount: { name: string } | null;
  category: { name: string } | null;
};

const typeLabel = { INCOME: "Income", EXPENSE: "Expense", TRANSFER: "Transfer" } as const;

// ----------------------------------------------------------------------- CSV

/** Streams a CSV (UTF-8 with a BOM so Excel reads it correctly). Amounts are in LKR, the currency FinSense stores. */
export async function streamCsv(userId: string, q: ExportQuery, res: Response): Promise<void> {
  const rows = rowsFor(userId, q, MAX_CSV_ROWS);
  const first = await rows.next(); // a "too large" error is raised here, before any byte is sent
  res.status(200);
  res.setHeader("Content-Type", "text/csv; charset=utf-8");
  res.setHeader("Content-Disposition", `attachment; filename="finsense-transactions-${filenameDate()}.csv"`);
  res.setHeader("Cache-Control", "private, no-store");
  res.setHeader("X-Content-Type-Options", "nosniff");
  res.write("﻿" + csvRow(["Date", "Type", "Description", "Merchant", "Category", "Account", "To account", "Amount (LKR)", "Account currency", "Amount in account currency", "Rate (LKR per unit)", "Split", "Receipts"]));

  const write = (t: Row & { _count: { attachments: number } }) =>
    res.write(
      csvRow([
        isoDateInZone(t.date, env.APP_TIMEZONE),
        typeLabel[t.type],
        t.description,
        t.merchantName ?? "",
        t.category?.name ?? "",
        t.account.name,
        t.toAccount?.name ?? "",
        t.amount.toFixed(2),
        t.account.currency,
        (t.accountAmount ?? t.amount).toFixed(2),
        t.rate ? t.rate.toString() : "",
        t.splitGroupId ? "Yes" : "",
        String(t._count.attachments || ""),
      ]),
    );

  if (!first.done) write(first.value as never);
  for await (const t of rows) write(t as never);
  res.end();
}

// ----------------------------------------------------------------------- PDF

const COLS = [
  { key: "date", title: "Date", width: 62 },
  { key: "description", title: "Description", width: 170 },
  { key: "category", title: "Category", width: 90 },
  { key: "account", title: "Account", width: 80 },
  { key: "amount", title: "Amount (LKR)", width: 80, align: "right" as const },
];

function fit(doc: PDFKit.PDFDocument, text: string, width: number): string {
  if (doc.widthOfString(text) <= width) return text;
  let out = text;
  while (out.length > 1 && doc.widthOfString(out + "...") > width) out = out.slice(0, -1);
  return out + "...";
}

/** A tidy A4 report: a header, the totals for the chosen filters, then the transactions in a table. */
export async function streamPdf(userId: string, q: ExportQuery, res: Response): Promise<void> {
  const rows = rowsFor(userId, q, MAX_PDF_ROWS);
  const first = await rows.next();
  const user = await prisma.user.findUnique({ where: { id: userId }, select: { name: true } });

  res.status(200);
  res.setHeader("Content-Type", "application/pdf");
  res.setHeader("Content-Disposition", `attachment; filename="finsense-transactions-${filenameDate()}.pdf"`);
  res.setHeader("Cache-Control", "private, no-store");
  res.setHeader("X-Content-Type-Options", "nosniff");

  const doc = new PDFDocument({ size: "A4", margin: 40, bufferPages: true, info: { Title: "FinSense transactions", Author: "FinSense" } });
  doc.pipe(res);

  const left = doc.page.margins.left;
  const tableWidth = COLS.reduce((s, c) => s + c.width, 0);
  const bottom = () => doc.page.height - doc.page.margins.bottom - 20;

  const header = () => {
    doc.font("Helvetica-Bold").fontSize(8).fillColor("#555555");
    let x = left;
    const y = doc.y;
    for (const c of COLS) {
      doc.text(c.title, x, y, { width: c.width - 6, align: c.align ?? "left", lineBreak: false });
      x += c.width;
    }
    doc.moveTo(left, y + 12).lineTo(left + tableWidth, y + 12).strokeColor("#cccccc").lineWidth(0.5).stroke();
    doc.y = y + 16;
  };

  // --- title
  doc.font("Helvetica-Bold").fontSize(20).fillColor("#f08300").text("FinSense", left, 40);
  doc.font("Helvetica").fontSize(10).fillColor("#333333").text(`Transactions for ${user?.name ?? "your account"}`);
  const range =
    q.from || q.to
      ? `${q.from ? isoDateInZone(q.from, env.APP_TIMEZONE) : "the beginning"} to ${q.to ? isoDateInZone(new Date(q.to.getTime() - 1), env.APP_TIMEZONE) : "today"}`
      : "All dates";
  doc.fontSize(9).fillColor("#777777").text(`${range} · created ${filenameDate()} · amounts in LKR`);
  doc.moveDown(1);

  // --- totals need every row, so collect the lines first (at most MAX_PDF_ROWS)
  const lines: { date: string; description: string; category: string; account: string; amount: string; negative: boolean }[] = [];
  let income = new Decimal(0);
  let expenses = new Decimal(0);
  const take = (t: Row) => {
    if (t.type === "INCOME") income = income.plus(t.amount);
    if (t.type === "EXPENSE") expenses = expenses.plus(t.amount);
    lines.push({
      date: isoDateInZone(t.date, env.APP_TIMEZONE),
      description: t.merchantName || t.description,
      category: t.type === "TRANSFER" ? "Transfer" : (t.category?.name ?? ""),
      account: t.type === "TRANSFER" ? `${t.account.name} > ${t.toAccount?.name ?? "?"}` : t.account.name,
      amount: (t.type === "INCOME" ? "+" : t.type === "EXPENSE" ? "-" : "") + formatMoney(t.amount).replace(/^/, ""),
      negative: t.type === "EXPENSE",
    });
  };
  if (!first.done) take(first.value as Row);
  for await (const t of rows) take(t as Row);

  const net = income.minus(expenses);
  doc.font("Helvetica-Bold").fontSize(10).fillColor("#111111");
  const summaryY = doc.y;
  const box = (x: number, label: string, value: string, color: string) => {
    doc.font("Helvetica").fontSize(8).fillColor("#777777").text(label, x, summaryY, { width: 120, lineBreak: false });
    doc.font("Helvetica-Bold").fontSize(11).fillColor(color).text(value, x, summaryY + 11, { width: 130, lineBreak: false });
  };
  box(left, "Income", formatMoney(income), "#12805c");
  box(left + 135, "Expenses", formatMoney(expenses), "#b3261e");
  box(left + 270, "Net", formatMoney(net), net.isNegative() ? "#b3261e" : "#12805c");
  box(left + 405, "Transactions", String(lines.length), "#111111");
  doc.y = summaryY + 34;

  header();

  doc.font("Helvetica").fontSize(8);
  for (const line of lines) {
    if (doc.y > bottom()) {
      doc.addPage();
      doc.y = doc.page.margins.top;
      header();
      doc.font("Helvetica").fontSize(8);
    }
    const y = doc.y;
    let x = left;
    const cells = [line.date, line.description, line.category, line.account, line.amount];
    COLS.forEach((c, i) => {
      doc.fillColor(i === 4 && line.negative ? "#b3261e" : "#222222");
      doc.text(fit(doc, cells[i]!, c.width - 8), x, y, { width: c.width - 6, align: c.align ?? "left", lineBreak: false });
      x += c.width;
    });
    doc.y = y + 13;
  }
  if (lines.length === 0) doc.fillColor("#777777").text("No transactions match these filters.", left, doc.y);

  // --- page numbers
  const range2 = doc.bufferedPageRange();
  for (let i = 0; i < range2.count; i++) {
    doc.switchToPage(range2.start + i);
    doc.font("Helvetica").fontSize(8).fillColor("#999999").text(`Page ${i + 1} of ${range2.count}`, left, doc.page.height - 30, { width: tableWidth, align: "center", lineBreak: false });
  }
  doc.end();
}
