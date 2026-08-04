import type {
  StockItem,
  StockPurchaseBill,
  StockRegisterRow,
  StockRow,
  StockSalesBill,
} from "../types";

export function normalizeStockDate(value: string) {
  const raw = String(value ?? "").trim();

  if (!raw) {
    return "";
  }

  const match = raw.match(/^(\d{4})[/-](\d{1,2})[/-](\d{1,2})$/);

  if (!match) {
    return raw;
  }

  const [, year, monthText, dayText] = match;
  const month = Number(monthText);
  const day = Number(dayText);

  if (month < 1 || month > 12 || day < 1 || day > 32) {
    return raw;
  }

  return `${year}/${String(month).padStart(2, "0")}/${String(day).padStart(2, "0")}`;
}

export function buildStockRows(
  items: StockItem[],
  purchaseBills: StockPurchaseBill[],
  salesBills: StockSalesBill[],
  asOnDate = "",
): StockRow[] {
  const normalizedAsOnDate = normalizeStockDate(asOnDate);
  const includeDate = (value: string) =>
    !normalizedAsOnDate || !value || normalizeStockDate(value) <= normalizedAsOnDate;

  const rows = items.map((item) => ({
      itemId: item.id,
      code: item.code,
      name: item.name,
      unit: item.unit,
      openingQty: item.openingQty,
      openingValue: item.openingQty * item.openingRate,
      localPurchaseQty: 0,
      localPurchaseValue: 0,
      importationQty: 0,
      importationValue: 0,
      salesQty: 0,
      salesValue: 0,
      closingQty: 0,
      averageRate: 0,
      closingValue: 0,
      reorderLevel: item.reorderLevel,
  }));
  const rowByItemId = new Map(rows.map((row) => [row.itemId, row] as const));

  purchaseBills.forEach((bill) => {
    if (!includeDate(bill.dateBs)) return;
    bill.items.forEach((line) => {
      const row = rowByItemId.get(line.itemId);
      if (!row) return;
      if (bill.source === "Importation") {
        row.importationQty += line.quantity;
        row.importationValue += line.amount;
      } else {
        row.localPurchaseQty += line.quantity;
        row.localPurchaseValue += line.amount;
      }
    });
  });

  salesBills.forEach((bill) => {
    if (!includeDate(bill.dateBs)) return;
    bill.items.forEach((line) => {
      const row = rowByItemId.get(line.itemId);
      if (!row) return;
      row.salesQty += line.quantity;
      row.salesValue += line.amount;
    });
  });

  rows.forEach((row) => {
    const inwardQty = row.openingQty + row.localPurchaseQty + row.importationQty;
    const inwardValue = row.openingValue + row.localPurchaseValue + row.importationValue;
    row.closingQty = inwardQty - row.salesQty;
    row.averageRate = inwardQty > 0 ? inwardValue / inwardQty : 0;
    row.closingValue = row.closingQty * row.averageRate;
  });

  return rows;
}

type RegisterTransaction = {
  id: string;
  date: string;
  itemId: string;
  particulars: string;
  receivedQty: number;
  receivedAmount: number;
  issuedQty: number;
  sortGroup: number;
  sortDate: string;
};

function rateFromAmount(amount: number, quantity: number) {
  return quantity ? amount / quantity : 0;
}

function registerSortDate(value: string) {
  return value === "Opening" ? "" : normalizeStockDate(value);
}

function registerRowSortGroup(row: StockRegisterRow) {
  if (row.id.startsWith("opening-")) return 0;
  if (row.receivedQty) return 1;
  return 2;
}

export function buildStockRegisterRows(
  items: StockItem[],
  purchaseBills: StockPurchaseBill[],
  salesBills: StockSalesBill[],
): StockRegisterRow[] {
  const itemById = new Map(items.map((item) => [item.id, item] as const));
  const transactions: RegisterTransaction[] = [];

  items.forEach((item) => {
    const openingAmount = Number(item.openingQty || 0) * Number(item.openingRate || 0);
    if (!item.openingQty && !openingAmount) return;
    transactions.push({
      id: `opening-${item.id}`,
      date: "Opening",
      itemId: item.id,
      particulars: "Opening Stock",
      receivedQty: Number(item.openingQty || 0),
      receivedAmount: openingAmount,
      issuedQty: 0,
      sortDate: "",
      sortGroup: 0,
    });
  });

  purchaseBills.forEach((bill) => {
    const billDate = normalizeStockDate(bill.dateBs);
    bill.items.forEach((line) => {
      transactions.push({
        id: line.id,
        date: bill.dateBs,
        itemId: line.itemId,
        particulars: [
          bill.source === "Importation" ? "Received - Import Purchase" : "Received - Local Purchase",
          bill.billNo,
          bill.referenceNo,
          bill.supplierName,
        ].filter(Boolean).join(" - "),
        receivedQty: Number(line.quantity || 0),
        receivedAmount: Number(line.amount || 0),
        issuedQty: 0,
        sortDate: billDate,
        sortGroup: 1,
      });
    });
  });

  salesBills.forEach((bill) => {
    const billDate = normalizeStockDate(bill.dateBs);
    bill.items.forEach((line) => {
      transactions.push({
        id: line.id,
        date: bill.dateBs,
        itemId: line.itemId,
        particulars: ["Issued - Sales Bill", bill.billNo, bill.customerName].filter(Boolean).join(" - "),
        receivedQty: 0,
        receivedAmount: 0,
        issuedQty: Number(line.quantity || 0),
        sortDate: billDate,
        sortGroup: 2,
      });
    });
  });

  const transactionsByItemId = new Map<string, RegisterTransaction[]>();
  transactions.forEach((transaction) => {
    transactionsByItemId.set(transaction.itemId, [
      ...(transactionsByItemId.get(transaction.itemId) ?? []),
      transaction,
    ]);
  });

  const rows: StockRegisterRow[] = [];
  transactionsByItemId.forEach((itemTransactions, itemId) => {
    const item = itemById.get(itemId);
    if (!item) return;

    let balanceQty = 0;
    let balanceAmount = 0;

    itemTransactions
      .sort((first, second) => (
        first.sortDate.localeCompare(second.sortDate)
        || first.sortGroup - second.sortGroup
        || first.particulars.localeCompare(second.particulars)
      ))
      .forEach((transaction) => {
        const balanceRateBeforeIssue = rateFromAmount(balanceAmount, balanceQty);
        const issuedAmount = Number((transaction.issuedQty * balanceRateBeforeIssue).toFixed(2));
        const receivedRate = rateFromAmount(transaction.receivedAmount, transaction.receivedQty);

        balanceQty += transaction.receivedQty - transaction.issuedQty;
        balanceAmount += transaction.receivedAmount - issuedAmount;

        rows.push({
          id: transaction.id,
          date: transaction.date,
          itemId,
          code: item.code,
          itemName: item.name,
          particulars: transaction.particulars,
          unit: item.unit,
          receivedQty: transaction.receivedQty,
          receivedRate,
          receivedAmount: transaction.receivedAmount,
          issuedQty: transaction.issuedQty,
          issuedRate: transaction.issuedQty ? balanceRateBeforeIssue : 0,
          issuedAmount,
          balanceQty,
          balanceRate: rateFromAmount(balanceAmount, balanceQty),
          balanceAmount,
        });
      });
  });

  return rows.sort((first, second) => (
    registerSortDate(first.date).localeCompare(registerSortDate(second.date))
    || registerRowSortGroup(first) - registerRowSortGroup(second)
    || first.code.localeCompare(second.code)
    || first.particulars.localeCompare(second.particulars)
  ));
}
