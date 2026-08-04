import type { StockLineInput, StockPurchaseLine, StockSource } from "../types";

type PurchaseLineIdFactory = () => string;

function prepareEntryLines(
  lines: StockLineInput[],
  billId: string,
  idFactory: PurchaseLineIdFactory,
): StockPurchaseLine[] {
  if (lines.length === 0) {
    throw new Error("At least one stock item is required.");
  }

  return lines.map((line) => {
    if (!line.itemId) {
      throw new Error("Stock item is required in every line.");
    }

    const quantity = Number(line.quantity || 0);
    const rate = Number(line.rate || 0);

    if (quantity <= 0) {
      throw new Error("Quantity must be greater than zero.");
    }

    if (rate < 0) {
      throw new Error("Rate must not be negative.");
    }

    const amount = Number((line.amount ?? quantity * rate).toFixed(2));
    const entryRate = Number(line.entryRate ?? rate);
    const entryAmount = Number((line.entryAmount ?? quantity * entryRate).toFixed(2));

    return {
      id: idFactory(),
      billId,
      itemId: line.itemId,
      quantity,
      rate,
      amount,
      entryRate,
      entryAmount,
    };
  });
}

export function prepareStockPurchaseLinesForDocument(
  lines: StockLineInput[],
  billId: string,
  source: StockSource,
  landedCostNpr = 0,
  idFactory: PurchaseLineIdFactory = () => crypto.randomUUID(),
) {
  const entryLines = prepareEntryLines(lines, billId, idFactory);

  if (source !== "Importation" || landedCostNpr <= 0) {
    return entryLines;
  }

  const entryTotal = entryLines.reduce((sum, line) => sum + (line.entryAmount ?? 0), 0);

  if (entryTotal <= 0) {
    return entryLines;
  }

  let allocatedTotal = 0;
  return entryLines.map((line, index) => {
    const entryAmount = line.entryAmount ?? line.amount;
    const allocatedAmount = index === entryLines.length - 1
      ? Number((landedCostNpr - allocatedTotal).toFixed(2))
      : Number(((entryAmount / entryTotal) * landedCostNpr).toFixed(2));
    allocatedTotal += allocatedAmount;

    return {
      ...line,
      amount: allocatedAmount,
      rate: Number((allocatedAmount / line.quantity).toFixed(6)),
    };
  });
}
