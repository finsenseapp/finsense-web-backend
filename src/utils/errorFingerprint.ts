import { createHash } from "node:crypto";

/**
 * Error text can carry personal data (an email in a message, an account number, an id in an address). Before an error
 * is stored it is cleaned: emails, long digit runs and ids are replaced by placeholders. The same cleaned text is what
 * errors are grouped by, so the same bug with different ids is one row with a count.
 */
export function scrubText(text: string): string {
  return text
    .replace(/[\w.+-]+@[\w-]+(\.[\w-]+)+/g, "[email]")
    .replace(/\b[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\b/gi, "[id]")
    .replace(/\d{6,}/g, "[number]");
}

/** Only the path of an address: no query string (it can hold search words) and no hash. */
export function pathOnly(url: string | null | undefined): string | null {
  if (!url) return null;
  const withoutOrigin = url.replace(/^https?:\/\/[^/]+/i, "");
  return scrubText(withoutOrigin.split(/[?#]/)[0] ?? "").slice(0, 200) || null;
}

/** First meaningful line of a stack that is inside the app's own code, if there is one (stable across deployments). */
function topFrame(stack: string | null | undefined): string {
  const line = (stack ?? "").split("\n").find((l) => /\bat\b/.test(l) && !l.includes("node_modules") && !l.includes("node:internal"));
  return (line ?? "").replace(/\(?[a-zA-Z]:?[^\s()]*[\\/]/g, "").replace(/:\d+:\d+\)?$/, "").trim().slice(0, 120);
}

/** A short stable id for "the same error": source + cleaned message + top frame + path. */
export function fingerprintOf(input: { source: string; message: string; stack?: string | null; url?: string | null }): string {
  const parts = [input.source, scrubText(input.message).split("\n")[0]?.slice(0, 200) ?? "", topFrame(input.stack), pathOnly(input.url) ?? ""];
  return createHash("sha256").update(parts.join("|")).digest("hex").slice(0, 32);
}
