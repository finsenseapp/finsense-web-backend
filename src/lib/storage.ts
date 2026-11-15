import { randomUUID } from "node:crypto";
import { createReadStream } from "node:fs";
import { mkdir, rm, unlink, writeFile } from "node:fs/promises";
import path from "node:path";
import type { Readable } from "node:stream";
import { env } from "../config/env.js";

/**
 * Receipt storage on local disk: <UPLOAD_DIR>/<userId>/<random key>. The key is generated here (a UUID), never taken
 * from the upload, so a file name can never point outside the folder. Files are served only through the authenticated
 * API after an ownership check. Swap this module for S3 or similar when the system is hosted.
 */
const root = () => path.resolve(process.cwd(), env.UPLOAD_DIR);

const SAFE = /^[0-9a-f-]{36}$/i;

function filePath(userId: string, key: string): string {
  if (!SAFE.test(userId) || !SAFE.test(key)) throw new Error("Invalid storage path");
  return path.join(root(), userId, key);
}

export async function saveFile(userId: string, data: Buffer): Promise<string> {
  const key = randomUUID();
  const target = filePath(userId, key);
  await mkdir(path.dirname(target), { recursive: true });
  await writeFile(target, data, { flag: "wx" });
  return key;
}

export function openFile(userId: string, key: string): Readable {
  return createReadStream(filePath(userId, key));
}

/** Removes files; a file that is already gone is not an error. */
export async function deleteFiles(userId: string, keys: string[]): Promise<void> {
  await Promise.all(keys.map((key) => unlink(filePath(userId, key)).catch(() => undefined)));
}

/** Removes everything a user ever uploaded (account deletion). */
export async function deleteUserFiles(userId: string): Promise<void> {
  if (!SAFE.test(userId)) return;
  await rm(path.join(root(), userId), { recursive: true, force: true });
}
