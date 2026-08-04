import type { StockItem } from "../types";
import { n } from "./stockCalculations";

export const AMOUNT_MATCH_TOLERANCE = 1;

export function amountMatches(left: number, right: number) {
  return Math.abs(Number(left || 0) - Number(right || 0)) <= AMOUNT_MATCH_TOLERANCE;
}

export function parseOpeningRows(value: string): Array<Omit<StockItem, "id" | "createdAt">> {
  const rows = parseCsv(value);
  const hasHeader = rows[0]?.some((cell) => cell.trim().toLowerCase() === "code");
  return (hasHeader ? rows.slice(1) : rows)
    .map((row) => {
      const [code = "", name = "", unit = "MT", openingQty = "0", openingRate = "0", reorderLevel = "0"] =
        row.map((cell) => cell.trim());
      return { code, name, unit: unit || "MT", openingQty: n(openingQty), openingRate: n(openingRate), reorderLevel: n(reorderLevel), isActive: true };
    })
    .filter((row) => row.code && row.name);
}

export function parseCsv(value: string) {
  const rows: string[][] = [];
  let row: string[] = [];
  let cell = "";
  let quoted = false;
  for (let index = 0; index < value.length; index += 1) {
    const char = value[index];
    const next = value[index + 1];
    if (char === '"' && quoted && next === '"') {
      cell += '"';
      index += 1;
    } else if (char === '"') {
      quoted = !quoted;
    } else if (char === "," && !quoted) {
      row.push(cell);
      cell = "";
    } else if ((char === "\n" || char === "\r") && !quoted) {
      if (char === "\r" && next === "\n") index += 1;
      row.push(cell);
      if (row.some((item) => item.trim())) rows.push(row);
      row = [];
      cell = "";
    } else {
      cell += char;
    }
  }
  row.push(cell);
  if (row.some((item) => item.trim())) rows.push(row);
  return rows;
}

export function errorMessage(error: unknown, fallback: string) {
  return error instanceof Error ? error.message : String(error || fallback);
}
