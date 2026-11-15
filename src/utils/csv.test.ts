import { describe, expect, it } from "vitest";
import { csvCell, csvRow } from "./csv.js";

describe("csvCell", () => {
  it("leaves ordinary text alone", () => {
    expect(csvCell("Keells Super")).toBe("Keells Super");
    expect(csvCell("1250.00")).toBe("1250.00");
    expect(csvCell("")).toBe("");
  });

  it("quotes cells with commas, quotes and line breaks, doubling the quotes", () => {
    expect(csvCell("Rice, dhal")).toBe('"Rice, dhal"');
    expect(csvCell('The "big" shop')).toBe('"The ""big"" shop"');
    expect(csvCell("line1\nline2")).toBe('"line1\nline2"');
  });

  it("defuses spreadsheet formulas (CSV injection)", () => {
    expect(csvCell("=HYPERLINK(\"http://evil\",\"x\")")).toBe('"\'=HYPERLINK(""http://evil"",""x"")"');
    expect(csvCell("+94771234567")).toBe("'+94771234567");
    expect(csvCell("-2+3")).toBe("'-2+3");
    expect(csvCell("@SUM(A1)")).toBe("'@SUM(A1)");
    expect(csvCell("\t=1+1")).toBe("'\t=1+1");
  });

  it("only touches the first character: a dash in the middle is fine", () => {
    expect(csvCell("POS - KEELLS")).toBe("POS - KEELLS");
  });
});

describe("csvRow", () => {
  it("joins with commas and ends with CRLF", () => {
    expect(csvRow(["a", "b,c", "=d"])).toBe('a,"b,c",\'=d\r\n');
  });
});
