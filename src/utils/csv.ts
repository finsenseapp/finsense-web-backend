/**
 * One CSV cell. A spreadsheet runs any cell that starts with = + - @ (or a tab / carriage return) as a formula, and
 * descriptions come from bank statements and other people, so such cells get an apostrophe in front, which makes
 * them plain text. Cells with a comma, quote or line break are quoted, with quotes doubled.
 */
export function csvCell(value: string): string {
  let text = value;
  if (/^[=+\-@\t\r]/.test(text)) text = `'${text}`;
  return /[",\r\n]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text;
}

/** One CSV line, ending in CRLF as the CSV standard asks. */
export const csvRow = (cells: string[]): string => cells.map(csvCell).join(",") + "\r\n";
