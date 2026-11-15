import type { RequestHandler } from "express";
import multer, { MulterError } from "multer";
import { AppError } from "../utils/errors.js";

export const MAX_UPLOAD_BYTES = 10 * 1024 * 1024; // 10 MB
export const ALLOWED_MIME_TYPES = ["image/jpeg", "image/png", "image/webp", "application/pdf"] as const;

const upload = multer({
  storage: multer.memoryStorage(), // the file is never written to disk
  limits: { fileSize: MAX_UPLOAD_BYTES, files: 1, fields: 5 },
  fileFilter: (_req, file, cb) => {
    if ((ALLOWED_MIME_TYPES as readonly string[]).includes(file.mimetype)) {
      cb(null, true);
    } else {
      cb(
        new AppError(
          400,
          "INVALID_FILE_TYPE",
          "Unsupported file type. Please upload a JPG, PNG, WebP or PDF file.",
        ),
      );
    }
  },
});

/** The declared Content-Type can be faked, so also check the file's first bytes. */
export function matchesSignature(mimetype: string, buf: Buffer): boolean {
  switch (mimetype) {
    case "application/pdf":
      return buf.subarray(0, 1024).includes("%PDF-");
    case "image/png":
      return buf.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]));
    case "image/jpeg":
      return buf[0] === 0xff && buf[1] === 0xd8 && buf[2] === 0xff;
    case "image/webp":
      return buf.subarray(0, 4).toString("latin1") === "RIFF" && buf.subarray(8, 12).toString("latin1") === "WEBP";
    default:
      return false;
  }
}

/** Single-file upload in the form field "file", with friendly 400/413 errors. */
export const uploadStatementFile: RequestHandler = (req, res, next) => {
  upload.single("file")(req, res, (err: unknown) => {
    if (err instanceof MulterError) {
      if (err.code === "LIMIT_FILE_SIZE") {
        return next(new AppError(413, "FILE_TOO_LARGE", "The file is too large. The maximum size is 10 MB."));
      }
      if (err.code === "LIMIT_UNEXPECTED_FILE") {
        return next(AppError.badRequest('Upload the file in a form field named "file".'));
      }
      return next(AppError.badRequest("The upload could not be read."));
    }
    if (err) return next(err);

    const file = req.file;
    if (!file) {
      return next(AppError.badRequest('No file received. Send multipart/form-data with a "file" field.'));
    }
    if (file.size === 0 || !matchesSignature(file.mimetype, file.buffer)) {
      return next(
        new AppError(400, "INVALID_FILE_TYPE", "The file is empty or does not look like a valid JPG, PNG, WebP or PDF."),
      );
    }
    next();
  });
};

// ------------------------------------------------------------------- receipts

export const MAX_RECEIPT_BYTES = 5 * 1024 * 1024; // 5 MB

const receiptUpload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: MAX_RECEIPT_BYTES, files: 1, fields: 3 },
  fileFilter: (_req, file, cb) => {
    if ((ALLOWED_MIME_TYPES as readonly string[]).includes(file.mimetype)) cb(null, true);
    else cb(new AppError(400, "INVALID_FILE_TYPE", "Unsupported file type. Attach a JPG, PNG, WebP or PDF file."));
  },
});

/** Single receipt in the form field "file": 5 MB at most, real JPG / PNG / WebP / PDF content only. */
export const uploadReceiptFile: RequestHandler = (req, res, next) => {
  receiptUpload.single("file")(req, res, (err: unknown) => {
    if (err instanceof MulterError) {
      if (err.code === "LIMIT_FILE_SIZE") return next(new AppError(413, "FILE_TOO_LARGE", "The file is too large. The maximum size is 5 MB."));
      return next(AppError.badRequest('Upload the file in a form field named "file".'));
    }
    if (err) return next(err);
    const file = req.file;
    if (!file) return next(AppError.badRequest('No file received. Send multipart/form-data with a "file" field.'));
    if (file.size === 0 || !matchesSignature(file.mimetype, file.buffer)) {
      return next(new AppError(400, "INVALID_FILE_TYPE", "That file is empty or is not a real JPG, PNG, WebP or PDF."));
    }
    next();
  });
};
