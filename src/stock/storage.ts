import Database from "@tauri-apps/plugin-sql";
import { getActiveStockDatabaseUrl, getStockDatabaseUrlForCompanyId } from "../companyContext";
import { prepareStockPurchaseLinesForDocument } from "./services/stockLandedCost";
import { runStockDbTransaction } from "./services/stockTransactions";
import type {
  StockDocumentType,
  StockItem,
  StockLineInput,
  StockPurchaseBill,
  StockPurchaseLine,
  StockSourceSnapshot,
  StockRegisterRow,
  StockRow,
  StockSalesBill,
  StockSalesLine,
  StockSource,
} from "./types";

const dbPromises = new Map<string, Promise<Database>>();
const stockOperationQueues = new Map<string, Promise<void>>();
const wait = (milliseconds: number) => new Promise((resolve) => globalThis.setTimeout(resolve, milliseconds));

function isDatabaseLockedError(error: unknown) {
  const text = String(error instanceof Error ? error.message : error).toLowerCase();
  return text.includes("database is locked") || text.includes("database locked") || text.includes("code: 5");
}

async function retryLocked<T>(work: () => Promise<T>) {
  for (let attempt = 0; attempt < 12; attempt += 1) {
    try {
      return await work();
    } catch (error) {
      if (!isDatabaseLockedError(error) || attempt === 11) {
        throw error;
      }
      await wait(Math.min(2500, 200 * (attempt + 1)));
    }
  }

  throw new Error("Database write failed.");
}

async function executeWithRetry(db: Database, statement: string, params?: unknown[]) {
  return retryLocked(() => db.execute(statement, params));
}

async function selectWithRetry<T>(db: Database, statement: string, params?: unknown[]) {
  return retryLocked(() => db.select<T>(statement, params));
}

async function runSerializedStockOperation<T>(stockDbUrl: string, work: () => Promise<T>) {
  const previousOperation = stockOperationQueues.get(stockDbUrl) ?? Promise.resolve();
  const nextOperation = previousOperation.catch(() => undefined).then(work);
  const queuedOperation = nextOperation.then(() => undefined, () => undefined);
  stockOperationQueues.set(stockDbUrl, queuedOperation);

  try {
    return await nextOperation;
  } finally {
    if (stockOperationQueues.get(stockDbUrl) === queuedOperation) {
      stockOperationQueues.delete(stockDbUrl);
    }
  }
}

async function getDb(stockDbUrl = getActiveStockDatabaseUrl()) {
  let dbPromise = dbPromises.get(stockDbUrl);

  if (!dbPromise) {
    dbPromise = Database.load(stockDbUrl)
      .then(async (db) => {
        await initDb(db);
        return db;
      })
      .catch((error) => {
        dbPromises.delete(stockDbUrl);
        throw error;
      });
    dbPromises.set(stockDbUrl, dbPromise);
  }

  return dbPromise;
}

async function initDb(db: Database) {
  await db.execute("PRAGMA busy_timeout = 10000");
  await db.execute("PRAGMA journal_mode = WAL");
  await db.execute("PRAGMA synchronous = NORMAL");

  await db.execute(`
    CREATE TABLE IF NOT EXISTS stock_items (
      id TEXT PRIMARY KEY,
      code TEXT NOT NULL UNIQUE,
      name TEXT NOT NULL,
      unit TEXT NOT NULL,
      opening_qty REAL DEFAULT 0,
      opening_rate REAL DEFAULT 0,
      reorder_level REAL DEFAULT 0,
      is_active INTEGER DEFAULT 1,
      created_at TEXT NOT NULL
    )
  `);

  await db.execute(`
    CREATE TABLE IF NOT EXISTS stock_purchase_bills (
      id TEXT PRIMARY KEY,
      bill_no TEXT NOT NULL,
      date_bs TEXT NOT NULL,
      supplier_name TEXT NOT NULL,
      source TEXT NOT NULL,
      source_type TEXT NOT NULL DEFAULT 'Local Purchase',
      reference_no TEXT,
      remarks TEXT,
      created_at TEXT NOT NULL,
      source_amount REAL,
      source_amount_npr REAL,
      source_currency TEXT,
      source_exchange_rate REAL,
      source_fiscal_year_id TEXT,
      source_grand_total REAL,
      source_landed_cost_npr REAL,
      source_lifecycle_status TEXT
    )
  `);

  await db.execute(`
    CREATE TABLE IF NOT EXISTS stock_purchase_lines (
      id TEXT PRIMARY KEY,
      bill_id TEXT NOT NULL,
      item_id TEXT NOT NULL,
      quantity REAL NOT NULL,
      rate REAL NOT NULL,
      amount REAL NOT NULL,
      entry_rate REAL,
      entry_amount REAL,
      FOREIGN KEY (bill_id) REFERENCES stock_purchase_bills(id),
      FOREIGN KEY (item_id) REFERENCES stock_items(id)
    )
  `);

  await ensureColumn(db, "stock_purchase_lines", "entry_rate", "REAL");
  await ensureColumn(db, "stock_purchase_lines", "entry_amount", "REAL");
  await ensureColumn(db, "stock_purchase_bills", "source_type", "TEXT NOT NULL DEFAULT 'Local Purchase'");
  await ensureStockSourceSnapshotColumns(db, "stock_purchase_bills");

  await db.execute(`
    CREATE TABLE IF NOT EXISTS stock_sales_bills (
      id TEXT PRIMARY KEY,
      bill_no TEXT NOT NULL,
      date_bs TEXT NOT NULL,
      customer_name TEXT NOT NULL,
      source_type TEXT NOT NULL DEFAULT 'Sale',
      remarks TEXT,
      created_at TEXT NOT NULL,
      source_amount REAL,
      source_amount_npr REAL,
      source_currency TEXT,
      source_exchange_rate REAL,
      source_fiscal_year_id TEXT,
      source_grand_total REAL,
      source_landed_cost_npr REAL,
      source_lifecycle_status TEXT
    )
  `);

  await db.execute(`
    CREATE TABLE IF NOT EXISTS stock_sales_lines (
      id TEXT PRIMARY KEY,
      bill_id TEXT NOT NULL,
      item_id TEXT NOT NULL,
      quantity REAL NOT NULL,
      rate REAL NOT NULL,
      amount REAL NOT NULL,
      FOREIGN KEY (bill_id) REFERENCES stock_sales_bills(id),
      FOREIGN KEY (item_id) REFERENCES stock_items(id)
    )
  `);
  await ensureColumn(db, "stock_sales_bills", "source_type", "TEXT NOT NULL DEFAULT 'Sale'");
  await ensureStockSourceSnapshotColumns(db, "stock_sales_bills");
  await rebuildBillTableIfBillNoIsUnique(db, "purchase");
  await rebuildBillTableIfBillNoIsUnique(db, "sales");
  await ensureStockSourceSnapshotColumns(db, "stock_purchase_bills");
  await ensureStockSourceSnapshotColumns(db, "stock_sales_bills");
  await db.execute("CREATE UNIQUE INDEX IF NOT EXISTS idx_stock_items_code ON stock_items(code)");
  await db.execute("CREATE INDEX IF NOT EXISTS idx_stock_purchase_bills_bill_no ON stock_purchase_bills(bill_no)");
  await db.execute("CREATE INDEX IF NOT EXISTS idx_stock_purchase_bills_source_type ON stock_purchase_bills(source_type, id)");
  await db.execute("CREATE INDEX IF NOT EXISTS idx_stock_sales_bills_bill_no ON stock_sales_bills(bill_no)");
  await db.execute("CREATE INDEX IF NOT EXISTS idx_stock_sales_bills_source_type ON stock_sales_bills(source_type, id)");
}

async function ensureStockSourceSnapshotColumns(db: Database, tableName: string) {
  await ensureColumn(db, tableName, "source_amount", "REAL");
  await ensureColumn(db, tableName, "source_amount_npr", "REAL");
  await ensureColumn(db, tableName, "source_currency", "TEXT");
  await ensureColumn(db, tableName, "source_exchange_rate", "REAL");
  await ensureColumn(db, tableName, "source_fiscal_year_id", "TEXT");
  await ensureColumn(db, tableName, "source_grand_total", "REAL");
  await ensureColumn(db, tableName, "source_landed_cost_npr", "REAL");
  await ensureColumn(db, tableName, "source_lifecycle_status", "TEXT");
}

async function ensureColumn(db: Database, tableName: string, columnName: string, definition: string) {
  const columns = await db.select<Record<string, unknown>[]>(`PRAGMA table_info(${tableName})`);
  const normalizedColumnName = columnName.toLowerCase();
  if (columns.some((column) => String(column.name ?? "").toLowerCase() === normalizedColumnName)) return;

  try {
    await db.execute(`ALTER TABLE ${tableName} ADD COLUMN ${columnName} ${definition}`);
  } catch (error) {
    if (!isDuplicateColumnError(error)) {
      throw error;
    }
  }
}

function isDuplicateColumnError(error: unknown) {
  return String(error instanceof Error ? error.message : error)
    .toLowerCase()
    .includes("duplicate column name");
}

type IndexListRow = {
  name: string;
  unique: number;
};

type IndexInfoRow = {
  name: string;
};

async function hasUniqueBillNoIndex(db: Database, tableName: string) {
  const indexes = await db.select<IndexListRow[]>(`PRAGMA index_list(${tableName})`);

  for (const index of indexes) {
    if (!Number(index.unique)) {
      continue;
    }

    const columns = await db.select<IndexInfoRow[]>(`PRAGMA index_info(${index.name})`);
    if (columns.length === 1 && columns[0]?.name === "bill_no") {
      return true;
    }
  }

  return false;
}

async function rebuildBillTableIfBillNoIsUnique(db: Database, kind: "purchase" | "sales") {
  const tableName = kind === "purchase" ? "stock_purchase_bills" : "stock_sales_bills";

  if (!(await hasUniqueBillNoIndex(db, tableName))) {
    return;
  }

  await db.execute("PRAGMA foreign_keys = OFF");

  if (kind === "purchase") {
    await db.execute(`
      CREATE TABLE IF NOT EXISTS stock_purchase_bills_next (
        id TEXT PRIMARY KEY,
        bill_no TEXT NOT NULL,
        date_bs TEXT NOT NULL,
        supplier_name TEXT NOT NULL,
        source TEXT NOT NULL,
        source_type TEXT NOT NULL DEFAULT 'Local Purchase',
        reference_no TEXT,
        remarks TEXT,
        created_at TEXT NOT NULL
      )
    `);
    await db.execute(`
      INSERT OR REPLACE INTO stock_purchase_bills_next (
        id, bill_no, date_bs, supplier_name, source, source_type, reference_no, remarks, created_at
      )
      SELECT
        id,
        bill_no,
        date_bs,
        supplier_name,
        source,
        CASE source WHEN 'Importation' THEN 'Import Purchase' ELSE 'Local Purchase' END,
        reference_no,
        remarks,
        created_at
      FROM stock_purchase_bills
    `);
    await db.execute("DROP TABLE stock_purchase_bills");
    await db.execute("ALTER TABLE stock_purchase_bills_next RENAME TO stock_purchase_bills");
  } else {
    await db.execute(`
      CREATE TABLE IF NOT EXISTS stock_sales_bills_next (
        id TEXT PRIMARY KEY,
        bill_no TEXT NOT NULL,
        date_bs TEXT NOT NULL,
        customer_name TEXT NOT NULL,
        source_type TEXT NOT NULL DEFAULT 'Sale',
        remarks TEXT,
        created_at TEXT NOT NULL
      )
    `);
    await db.execute(`
      INSERT OR REPLACE INTO stock_sales_bills_next (
        id, bill_no, date_bs, customer_name, source_type, remarks, created_at
      )
      SELECT id, bill_no, date_bs, customer_name, 'Sale', remarks, created_at
      FROM stock_sales_bills
    `);
    await db.execute("DROP TABLE stock_sales_bills");
    await db.execute("ALTER TABLE stock_sales_bills_next RENAME TO stock_sales_bills");
  }

  await db.execute("PRAGMA foreign_keys = ON");
}

type ItemRow = {
  id: string;
  code: string;
  name: string;
  unit: string;
  opening_qty: number;
  opening_rate: number;
  reorder_level: number;
  is_active: number;
  created_at: string;
};

type PurchaseBillRow = {
  id: string;
  bill_no: string;
  date_bs: string;
  supplier_name: string;
  source: string;
  source_type?: string | null;
  reference_no: string | null;
  remarks: string | null;
  created_at: string;
  source_amount?: number | null;
  source_amount_npr?: number | null;
  source_currency?: string | null;
  source_exchange_rate?: number | null;
  source_fiscal_year_id?: string | null;
  source_grand_total?: number | null;
  source_landed_cost_npr?: number | null;
  source_lifecycle_status?: string | null;
};

type PurchaseLineRow = {
  id: string;
  bill_id: string;
  item_id: string;
  quantity: number;
  rate: number;
  amount: number;
  entry_rate: number | null;
  entry_amount: number | null;
};

type SalesBillRow = {
  id: string;
  bill_no: string;
  date_bs: string;
  customer_name: string;
  source_type?: string | null;
  remarks: string | null;
  created_at: string;
  source_amount?: number | null;
  source_amount_npr?: number | null;
  source_currency?: string | null;
  source_exchange_rate?: number | null;
  source_fiscal_year_id?: string | null;
  source_grand_total?: number | null;
  source_landed_cost_npr?: number | null;
  source_lifecycle_status?: string | null;
};

type SalesLineRow = {
  id: string;
  bill_id: string;
  item_id: string;
  quantity: number;
  rate: number;
  amount: number;
};

type StockPurchaseDocumentInput = {
  documentId: string;
  billNo: string;
  date: string;
  landedCostNpr?: number;
  partyName: string;
  source: StockSource;
  sourceDocumentType?: Extract<StockDocumentType, "Import Purchase" | "Local Purchase">;
  referenceNo?: string;
  remarks?: string;
  sourceSnapshot?: StockSourceSnapshot;
  items: StockLineInput[];
};

type StockSalesDocumentInput = {
  documentId: string;
  billNo: string;
  date: string;
  partyName: string;
  remarks?: string;
  sourceSnapshot?: StockSourceSnapshot;
  items: StockLineInput[];
};

type PurchaseDocumentSnapshot = {
  bills: PurchaseBillRow[];
  lines: PurchaseLineRow[];
};

type SalesDocumentSnapshot = {
  bills: SalesBillRow[];
  lines: SalesLineRow[];
};

export type StockBackupData = {
  items: StockItem[];
  purchaseBills: StockPurchaseBill[];
  salesBills: StockSalesBill[];
};

export type StockOpeningCarryForwardInput = Omit<StockItem, "id" | "createdAt"> & {
  sourceItemId: string;
  sourceClosingValue: number;
};

export type StockOpeningCarryForwardWriteSummary = {
  created: number;
  updated: number;
};

function mapItem(row: ItemRow): StockItem {
  return {
    id: row.id,
    code: row.code,
    name: row.name,
    unit: row.unit,
    openingQty: Number(row.opening_qty || 0),
    openingRate: Number(row.opening_rate || 0),
    reorderLevel: Number(row.reorder_level || 0),
    isActive: Boolean(row.is_active),
    createdAt: row.created_at,
  };
}

function mapPurchaseBill(row: PurchaseBillRow, items: StockPurchaseLine[]): StockPurchaseBill {
  const source = normalizeStockSource(row.source);
  const sourceType = normalizePurchaseSourceDocumentType(row.source_type ?? undefined, source);
  const documentId = sourceDocumentIdFromStockPurchaseBillId(row.id, sourceType);

  return {
    id: documentId,
    billNo: row.bill_no,
    dateBs: normalizeDateDisplay(row.date_bs),
    supplierName: row.supplier_name,
    source,
    sourceType,
    sourceSnapshot: mapSourceSnapshot(row),
    referenceNo: row.reference_no ?? "",
    remarks: row.remarks ?? "",
    items: items.map((line) => ({ ...line, billId: documentId })),
    createdAt: row.created_at,
  };
}

function mapPurchaseLine(row: PurchaseLineRow): StockPurchaseLine {
  return {
    id: row.id,
    billId: row.bill_id,
    itemId: row.item_id,
    quantity: Number(row.quantity || 0),
    rate: Number(row.rate || 0),
    amount: Number(row.amount || 0),
    entryRate: row.entry_rate === null || row.entry_rate === undefined ? Number(row.rate || 0) : Number(row.entry_rate || 0),
    entryAmount: row.entry_amount === null || row.entry_amount === undefined ? Number(row.amount || 0) : Number(row.entry_amount || 0),
  };
}

function mapSalesBill(row: SalesBillRow, items: StockSalesLine[]): StockSalesBill {
  return {
    id: row.id,
    billNo: row.bill_no,
    dateBs: normalizeDateDisplay(row.date_bs),
    customerName: row.customer_name,
    sourceSnapshot: mapSourceSnapshot(row),
    remarks: row.remarks ?? "",
    items,
    createdAt: row.created_at,
  };
}

function mapSourceSnapshot(row: PurchaseBillRow | SalesBillRow): StockSourceSnapshot | undefined {
  const snapshot: StockSourceSnapshot = {
    sourceAmount: optionalNumber(row.source_amount),
    sourceAmountNpr: optionalNumber(row.source_amount_npr),
    sourceCurrency: optionalString(row.source_currency),
    sourceExchangeRate: optionalNumber(row.source_exchange_rate),
    sourceFiscalYearId: optionalString(row.source_fiscal_year_id),
    sourceGrandTotal: optionalNumber(row.source_grand_total),
    sourceLandedCostNpr: optionalNumber(row.source_landed_cost_npr),
    sourceLifecycleStatus: optionalString(row.source_lifecycle_status) as StockSourceSnapshot["sourceLifecycleStatus"],
  };

  return Object.values(snapshot).some((value) => value !== undefined) ? snapshot : undefined;
}

function optionalNumber(value: number | null | undefined) {
  if (value === null || value === undefined) {
    return undefined;
  }
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : undefined;
}

function optionalString(value: string | null | undefined) {
  const text = String(value ?? "").trim();
  return text ? text : undefined;
}

function mapSalesLine(row: SalesLineRow): StockSalesLine {
  return {
    id: row.id,
    billId: row.bill_id,
    itemId: row.item_id,
    quantity: Number(row.quantity || 0),
    rate: Number(row.rate || 0),
    amount: Number(row.amount || 0),
  };
}

function normalizeStockSource(value: string): StockSource {
  return value === "Importation" ? "Importation" : "Local Purchase";
}

function sourceDocumentTypeForPurchase(source: StockSource): Extract<StockDocumentType, "Import Purchase" | "Local Purchase"> {
  return source === "Importation" ? "Import Purchase" : "Local Purchase";
}

function normalizePurchaseSourceDocumentType(
  value: string | undefined,
  source: StockSource,
): Extract<StockDocumentType, "Import Purchase" | "Local Purchase"> {
  return value === "Import Purchase" || value === "Local Purchase"
    ? value
    : sourceDocumentTypeForPurchase(source);
}

function stockPurchaseBillId(
  documentId: string,
  sourceType: Extract<StockDocumentType, "Import Purchase" | "Local Purchase">,
) {
  return `${sourceType}:${documentId}`;
}

function sourceDocumentIdFromStockPurchaseBillId(
  billId: string,
  sourceType: Extract<StockDocumentType, "Import Purchase" | "Local Purchase">,
) {
  const prefix = `${sourceType}:`;
  return billId.startsWith(prefix) ? billId.slice(prefix.length) : billId;
}

function normalizeStockItemCode(value: string) {
  return String(value ?? "").trim().toUpperCase();
}

function sourceSnapshotValues(snapshot: StockSourceSnapshot | undefined): unknown[] {
  return [
    snapshot?.sourceAmount ?? null,
    snapshot?.sourceAmountNpr ?? null,
    snapshot?.sourceCurrency ?? null,
    snapshot?.sourceExchangeRate ?? null,
    snapshot?.sourceFiscalYearId ?? null,
    snapshot?.sourceGrandTotal ?? null,
    snapshot?.sourceLandedCostNpr ?? null,
    snapshot?.sourceLifecycleStatus ?? null,
  ];
}

function normalizeOptionalDate(value: string) {
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

function normalizeBillNo(value: string, fieldName: string) {
  const billNo = String(value ?? "").trim();

  if (!billNo) {
    throw new Error(`${fieldName} is required.`);
  }

  return billNo;
}

function normalizeDateDisplay(value: string) {
  return normalizeOptionalDate(value);
}

function prepareLines<T extends { itemId: string; quantity: number; rate: number }>(
  lines: T[],
  billId: string,
) {
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

    return {
      id: crypto.randomUUID(),
      billId,
      itemId: line.itemId,
      quantity,
      rate,
      amount: Number((quantity * rate).toFixed(2)),
    };
  });
}

function prepareOptionalLines<T extends { itemId: string; quantity: number; rate: number }>(
  lines: T[],
  billId: string,
) {
  if (lines.length === 0) {
    return [];
  }

  return prepareLines(lines, billId);
}

function preparePurchaseLines(
  lines: StockLineInput[],
  billId: string,
  source: StockSource,
  landedCostNpr = 0,
) {
  return prepareStockPurchaseLinesForDocument(lines, billId, source, landedCostNpr);
}

export async function getStockItems(): Promise<StockItem[]> {
  const stockDbUrl = getActiveStockDatabaseUrl();
  const db = await getDb(stockDbUrl);

  return runSerializedStockOperation(stockDbUrl, () => getStockItemsFromDb(db));
}

export async function saveStockItem(input: Omit<StockItem, "id" | "createdAt">) {
  const stockDbUrl = getActiveStockDatabaseUrl();
  const db = await getDb(stockDbUrl);
  const code = normalizeStockItemCode(input.code);
  const name = input.name.trim();
  const unit = input.unit.trim() || "MT";

  if (!code) {
    throw new Error("Item code is required.");
  }

  if (!name) {
    throw new Error("Item name is required.");
  }

  const item: StockItem = {
    ...input,
    id: crypto.randomUUID(),
    code,
    name,
    unit,
    openingQty: Number(input.openingQty || 0),
    openingRate: Number(input.openingRate || 0),
    reorderLevel: Number(input.reorderLevel || 0),
    createdAt: new Date().toISOString(),
  };

  await runSerializedStockOperation(stockDbUrl, () => db.execute(
    `
    INSERT INTO stock_items (
      id,
      code,
      name,
      unit,
      opening_qty,
      opening_rate,
      reorder_level,
      is_active,
      created_at
    )
    VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)
    `,
    [
      item.id,
      item.code,
      item.name,
      item.unit,
      item.openingQty,
      item.openingRate,
      item.reorderLevel,
      item.isActive ? 1 : 0,
      item.createdAt,
    ],
  ));

  return item;
}

export async function upsertOpeningStockItem(input: Omit<StockItem, "id" | "createdAt">) {
  const code = normalizeStockItemCode(input.code);
  const items = await getStockItems();
  const existing = items.find(
    (item) => normalizeStockItemCode(item.code) === code,
  );

  if (existing) {
    return updateStockItem({
      ...existing,
      ...input,
      code,
      id: existing.id,
      isActive: input.isActive,
    });
  }

  return saveStockItem({ ...input, code });
}

export async function updateStockItem(input: Omit<StockItem, "createdAt">) {
  const stockDbUrl = getActiveStockDatabaseUrl();
  const db = await getDb(stockDbUrl);
  const code = normalizeStockItemCode(input.code);
  const name = input.name.trim();
  const unit = input.unit.trim() || "MT";

  if (!input.id) {
    throw new Error("Item ID is required.");
  }

  if (!code) {
    throw new Error("Item code is required.");
  }

  if (!name) {
    throw new Error("Item name is required.");
  }

  await runSerializedStockOperation(stockDbUrl, () => db.execute(
    `
    UPDATE stock_items
    SET
      code = $1,
      name = $2,
      unit = $3,
      opening_qty = $4,
      opening_rate = $5,
      reorder_level = $6,
      is_active = $7
    WHERE id = $8
    `,
    [
      code,
      name,
      unit,
      Number(input.openingQty || 0),
      Number(input.openingRate || 0),
      Number(input.reorderLevel || 0),
      input.isActive ? 1 : 0,
      input.id,
    ],
  ));

  return { ...input, code, name, unit, createdAt: "" };
}

export async function deleteStockItem(itemId: string) {
  const stockDbUrl = getActiveStockDatabaseUrl();
  const db = await getDb(stockDbUrl);

  await runSerializedStockOperation(stockDbUrl, async () => {
    const references = await db.select<{ purchaseCount: number; salesCount: number }[]>(
    `
    SELECT
      (SELECT COUNT(*) FROM stock_purchase_lines WHERE item_id = $1) AS purchaseCount,
      (SELECT COUNT(*) FROM stock_sales_lines WHERE item_id = $1) AS salesCount
    `,
    [itemId],
    );

    if (Number(references[0]?.purchaseCount || 0) || Number(references[0]?.salesCount || 0)) {
      throw new Error("Cannot delete this item because it is already used in stock bills.");
    }

    await db.execute(`DELETE FROM stock_items WHERE id = $1`, [itemId]);
  });
}

async function readPurchaseDocumentSnapshot(
  db: Database,
  billId: string,
  documentId: string,
  sourceDocumentType: Extract<StockDocumentType, "Import Purchase" | "Local Purchase">,
): Promise<PurchaseDocumentSnapshot> {
  const bills = await selectWithRetry<PurchaseBillRow[]>(
    db,
    `
    SELECT *
    FROM stock_purchase_bills
    WHERE (id = $1 OR id = $2) AND source_type = $3
    `,
    [billId, documentId, sourceDocumentType],
  );
  const billIds = bills.map((bill) => bill.id);

  if (!billIds.length) {
    return { bills: [], lines: [] };
  }

  const lines = await selectWithRetry<PurchaseLineRow[]>(
    db,
    `
    SELECT *
    FROM stock_purchase_lines
    WHERE bill_id IN (${billIds.map((_, index) => `$${index + 1}`).join(", ")})
    `,
    billIds,
  );

  return { bills, lines };
}

async function restorePurchaseDocumentSnapshot(db: Database, snapshot: PurchaseDocumentSnapshot) {
  if (!snapshot.bills.length) {
    return;
  }

  for (const bill of snapshot.bills) {
    await executeWithRetry(
      db,
      `
      INSERT OR REPLACE INTO stock_purchase_bills (
        id,
        bill_no,
        date_bs,
        supplier_name,
        source,
        source_type,
        reference_no,
        remarks,
        created_at,
        source_amount,
        source_amount_npr,
        source_currency,
        source_exchange_rate,
        source_fiscal_year_id,
        source_grand_total,
        source_landed_cost_npr,
        source_lifecycle_status
      )
      VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16, $17)
      `,
      [
        bill.id,
        bill.bill_no,
        bill.date_bs,
        bill.supplier_name,
        bill.source,
        bill.source_type ?? (bill.source === "Importation" ? "Import Purchase" : "Local Purchase"),
        bill.reference_no ?? "",
        bill.remarks ?? "",
        bill.created_at,
        ...sourceSnapshotValues(mapSourceSnapshot(bill)),
      ],
    );
  }

  for (const line of snapshot.lines) {
    await executeWithRetry(
      db,
      `
      INSERT OR REPLACE INTO stock_purchase_lines (
        id,
        bill_id,
        item_id,
        quantity,
        rate,
        amount,
        entry_rate,
        entry_amount
      )
      VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
      `,
      [
        line.id,
        line.bill_id,
        line.item_id,
        line.quantity,
        line.rate,
        line.amount,
        line.entry_rate,
        line.entry_amount,
      ],
    );
  }
}

async function readSalesDocumentSnapshot(db: Database, documentId: string): Promise<SalesDocumentSnapshot> {
  const bills = await selectWithRetry<SalesBillRow[]>(
    db,
    `
    SELECT *
    FROM stock_sales_bills
    WHERE id = $1 AND source_type = 'Sale'
    `,
    [documentId],
  );

  if (!bills.length) {
    return { bills: [], lines: [] };
  }

  const lines = await selectWithRetry<SalesLineRow[]>(
    db,
    `
    SELECT *
    FROM stock_sales_lines
    WHERE bill_id = $1
    `,
    [documentId],
  );

  return { bills, lines };
}

async function restoreSalesDocumentSnapshot(db: Database, snapshot: SalesDocumentSnapshot) {
  if (!snapshot.bills.length) {
    return;
  }

  for (const bill of snapshot.bills) {
    await executeWithRetry(
      db,
      `
      INSERT OR REPLACE INTO stock_sales_bills (
        id,
        bill_no,
        date_bs,
        customer_name,
        source_type,
        remarks,
        created_at,
        source_amount,
        source_amount_npr,
        source_currency,
        source_exchange_rate,
        source_fiscal_year_id,
        source_grand_total,
        source_landed_cost_npr,
        source_lifecycle_status
      )
      VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15)
      `,
      [
        bill.id,
        bill.bill_no,
        bill.date_bs,
        bill.customer_name,
        bill.source_type ?? "Sale",
        bill.remarks ?? "",
        bill.created_at,
        ...sourceSnapshotValues(mapSourceSnapshot(bill)),
      ],
    );
  }

  for (const line of snapshot.lines) {
    await executeWithRetry(
      db,
      `
      INSERT OR REPLACE INTO stock_sales_lines (
        id,
        bill_id,
        item_id,
        quantity,
        rate,
        amount
      )
      VALUES ($1, $2, $3, $4, $5, $6)
      `,
      [
        line.id,
        line.bill_id,
        line.item_id,
        line.quantity,
        line.rate,
        line.amount,
      ],
    );
  }
}

export async function setStockPurchaseLinesForDocument(input: StockPurchaseDocumentInput) {
  const stockDbUrl = getActiveStockDatabaseUrl();
  const db = await getDb(stockDbUrl);
  const documentId = input.documentId.trim();

  if (!documentId) {
    throw new Error("Purchase document ID is required for stock lines.");
  }

  const source = normalizeStockSource(input.source);
  const sourceDocumentType = normalizePurchaseSourceDocumentType(input.sourceDocumentType, source);
  const billId = stockPurchaseBillId(documentId, sourceDocumentType);
  const lines = input.items.length > 0
    ? preparePurchaseLines(input.items, billId, source, Number(input.landedCostNpr || 0))
    : [];

  await runSerializedStockOperation(stockDbUrl, async () => {
    const previous = await readPurchaseDocumentSnapshot(db, billId, documentId, sourceDocumentType);

    try {
      await runStockDbTransaction(db, async () => {
        await db.execute(
          `
          DELETE FROM stock_purchase_lines
          WHERE bill_id IN (
            SELECT id
            FROM stock_purchase_bills
            WHERE (id = $1 OR id = $2) AND source_type = $3
          )
          `,
          [billId, documentId, sourceDocumentType],
        );

        if (lines.length === 0) {
          await db.execute(
            `DELETE FROM stock_purchase_bills WHERE (id = $1 OR id = $2) AND source_type = $3`,
            [billId, documentId, sourceDocumentType],
          );
          return;
        }

        await db.execute(
          `
          INSERT INTO stock_purchase_bills (
            id,
            bill_no,
            date_bs,
            supplier_name,
            source,
            source_type,
            reference_no,
            remarks,
            created_at,
            source_amount,
            source_amount_npr,
            source_currency,
            source_exchange_rate,
            source_fiscal_year_id,
            source_grand_total,
            source_landed_cost_npr,
            source_lifecycle_status
          )
          VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16, $17)
          ON CONFLICT(id) DO UPDATE SET
            bill_no = excluded.bill_no,
            date_bs = excluded.date_bs,
            supplier_name = excluded.supplier_name,
            source = excluded.source,
            source_type = excluded.source_type,
            reference_no = excluded.reference_no,
            remarks = excluded.remarks,
            source_amount = excluded.source_amount,
            source_amount_npr = excluded.source_amount_npr,
            source_currency = excluded.source_currency,
            source_exchange_rate = excluded.source_exchange_rate,
            source_fiscal_year_id = excluded.source_fiscal_year_id,
            source_grand_total = excluded.source_grand_total,
            source_landed_cost_npr = excluded.source_landed_cost_npr,
            source_lifecycle_status = excluded.source_lifecycle_status
          `,
          [
            billId,
            normalizeBillNo(input.billNo, "Purchase bill number"),
            normalizeOptionalDate(input.date),
            input.partyName.trim() || "-",
            source,
            sourceDocumentType,
            input.referenceNo?.trim() ?? "",
            input.remarks?.trim() ?? "",
            new Date().toISOString(),
            ...sourceSnapshotValues(input.sourceSnapshot),
          ],
        );

        for (const line of lines) {
          await db.execute(
            `
            INSERT INTO stock_purchase_lines (
              id,
              bill_id,
              item_id,
              quantity,
              rate,
              amount,
              entry_rate,
              entry_amount
            )
            VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
            `,
            [line.id, billId, line.itemId, line.quantity, line.rate, line.amount, line.entryRate, line.entryAmount],
          );
        }
      }, { queueKey: stockDbUrl });
    } catch (error) {
      await executeWithRetry(
        db,
        `
        DELETE FROM stock_purchase_lines
        WHERE bill_id IN (
          SELECT id
          FROM stock_purchase_bills
          WHERE (id = $1 OR id = $2) AND source_type = $3
        )
        `,
        [billId, documentId, sourceDocumentType],
      ).catch(() => undefined);
      await restorePurchaseDocumentSnapshot(db, previous).catch(() => undefined);
      throw error;
    }
  });
}

export async function setStockSalesLinesForDocument(input: StockSalesDocumentInput) {
  const stockDbUrl = getActiveStockDatabaseUrl();
  const db = await getDb(stockDbUrl);
  const documentId = input.documentId.trim();

  if (!documentId) {
    throw new Error("Sales document ID is required for stock lines.");
  }

  const lines = prepareOptionalLines(input.items, documentId);

  await runSerializedStockOperation(stockDbUrl, async () => {
    const previous = await readSalesDocumentSnapshot(db, documentId);

    try {
      await runStockDbTransaction(db, async () => {
        await db.execute(
          `
          DELETE FROM stock_sales_lines
          WHERE bill_id IN (
            SELECT id
            FROM stock_sales_bills
            WHERE id = $1 AND source_type = 'Sale'
          )
          `,
          [documentId],
        );

        if (lines.length === 0) {
          await db.execute(`DELETE FROM stock_sales_bills WHERE id = $1 AND source_type = 'Sale'`, [documentId]);
          return;
        }

        await db.execute(
          `
          INSERT INTO stock_sales_bills (
            id,
            bill_no,
            date_bs,
            customer_name,
            source_type,
            remarks,
            created_at,
            source_amount,
            source_amount_npr,
            source_currency,
            source_exchange_rate,
            source_fiscal_year_id,
            source_grand_total,
            source_landed_cost_npr,
            source_lifecycle_status
          )
          VALUES ($1, $2, $3, $4, 'Sale', $5, $6, $7, $8, $9, $10, $11, $12, $13, $14)
          ON CONFLICT(id) DO UPDATE SET
            bill_no = excluded.bill_no,
            date_bs = excluded.date_bs,
            customer_name = excluded.customer_name,
            source_type = excluded.source_type,
            remarks = excluded.remarks,
            source_amount = excluded.source_amount,
            source_amount_npr = excluded.source_amount_npr,
            source_currency = excluded.source_currency,
            source_exchange_rate = excluded.source_exchange_rate,
            source_fiscal_year_id = excluded.source_fiscal_year_id,
            source_grand_total = excluded.source_grand_total,
            source_landed_cost_npr = excluded.source_landed_cost_npr,
            source_lifecycle_status = excluded.source_lifecycle_status
          `,
          [
            documentId,
            normalizeBillNo(input.billNo, "Sales bill number"),
            normalizeOptionalDate(input.date),
            input.partyName.trim() || "-",
            input.remarks?.trim() ?? "",
            new Date().toISOString(),
            ...sourceSnapshotValues(input.sourceSnapshot),
          ],
        );

        for (const line of lines) {
          await db.execute(
            `
            INSERT INTO stock_sales_lines (
              id,
              bill_id,
              item_id,
              quantity,
              rate,
              amount
            )
            VALUES ($1, $2, $3, $4, $5, $6)
            `,
            [line.id, documentId, line.itemId, line.quantity, line.rate, line.amount],
          );
        }
      }, { queueKey: stockDbUrl });
    } catch (error) {
      await executeWithRetry(
        db,
        `
        DELETE FROM stock_sales_lines
        WHERE bill_id IN (
          SELECT id
          FROM stock_sales_bills
          WHERE id = $1 AND source_type = 'Sale'
        )
        `,
        [documentId],
      ).catch(() => undefined);
      await restoreSalesDocumentSnapshot(db, previous).catch(() => undefined);
      throw error;
    }
  });
}

export async function deleteStockPurchaseLinesForDocument(
  documentId: string,
  sourceDocumentType: Extract<StockDocumentType, "Import Purchase" | "Local Purchase">,
) {
  await setStockPurchaseLinesForDocument({
    billNo: "0",
    date: "",
    documentId,
    items: [],
    partyName: "",
    source: sourceDocumentType === "Import Purchase" ? "Importation" : "Local Purchase",
    sourceDocumentType,
  });
}

export async function deleteStockSalesLinesForDocument(documentId: string) {
  await setStockSalesLinesForDocument({
    billNo: "0",
    date: "",
    documentId,
    items: [],
    partyName: "",
  });
}

export async function getStockPurchaseBills(): Promise<StockPurchaseBill[]> {
  const stockDbUrl = getActiveStockDatabaseUrl();
  const db = await getDb(stockDbUrl);

  return runSerializedStockOperation(stockDbUrl, () => getStockPurchaseBillsFromDb(db));
}

export async function getStockSalesBills(): Promise<StockSalesBill[]> {
  const stockDbUrl = getActiveStockDatabaseUrl();
  const db = await getDb(stockDbUrl);

  return runSerializedStockOperation(stockDbUrl, () => getStockSalesBillsFromDb(db));
}

async function getStockItemsFromDb(db: Database): Promise<StockItem[]> {
  const rows = await db.select<ItemRow[]>(`
    SELECT *
    FROM stock_items
    ORDER BY name ASC
  `);

  return rows.map(mapItem);
}

async function getStockPurchaseBillsFromDb(db: Database): Promise<StockPurchaseBill[]> {
  const billRows = await db.select<PurchaseBillRow[]>(`
    SELECT *
    FROM stock_purchase_bills
    ORDER BY date_bs DESC, bill_no DESC
  `);
  const lineRows = await db.select<PurchaseLineRow[]>(`
    SELECT *
    FROM stock_purchase_lines
  `);
  const linesByBill = new Map<string, StockPurchaseLine[]>();

  lineRows.map(mapPurchaseLine).forEach((line) => {
    linesByBill.set(line.billId, [...(linesByBill.get(line.billId) ?? []), line]);
  });

  return billRows.map((row) => mapPurchaseBill(row, linesByBill.get(row.id) ?? []));
}

async function getStockSalesBillsFromDb(db: Database): Promise<StockSalesBill[]> {
  const billRows = await db.select<SalesBillRow[]>(`
    SELECT *
    FROM stock_sales_bills
    ORDER BY date_bs DESC, bill_no DESC
  `);
  const lineRows = await db.select<SalesLineRow[]>(`
    SELECT *
    FROM stock_sales_lines
  `);
  const linesByBill = new Map<string, StockSalesLine[]>();

  lineRows.map(mapSalesLine).forEach((line) => {
    linesByBill.set(line.billId, [...(linesByBill.get(line.billId) ?? []), line]);
  });

  return billRows.map((row) => mapSalesBill(row, linesByBill.get(row.id) ?? []));
}

export async function getStockBackupDataForCompany(companyId: string): Promise<StockBackupData> {
  const stockDbUrl = getStockDatabaseUrlForCompanyId(companyId);
  const db = await getDb(stockDbUrl);

  return runSerializedStockOperation(stockDbUrl, async () => {
    const items = await getStockItemsFromDb(db);
    const purchaseBills = await getStockPurchaseBillsFromDb(db);
    const salesBills = await getStockSalesBillsFromDb(db);

    return { items, purchaseBills, salesBills };
  });
}

function validateStockBackupData(data: StockBackupData) {
  const itemCodes = new Set<string>();
  const itemIds = new Set<string>();

  for (const item of data.items) {
    const code = normalizeStockItemCode(item.code);
    if (!item.id || !code || !String(item.name ?? "").trim()) {
      throw new Error("Stock backup contains an invalid item record.");
    }
    if (itemCodes.has(code)) {
      throw new Error(`Stock backup contains duplicate item code ${code}.`);
    }
    itemCodes.add(code);
    itemIds.add(item.id);
  }

  const purchaseKeys = new Set<string>();
  for (const bill of data.purchaseBills) {
    const sourceType = normalizePurchaseSourceDocumentType(bill.sourceType, bill.source);
    const key = `${sourceType}:${bill.id}`;
    if (!bill.id || !bill.billNo || purchaseKeys.has(key)) {
      throw new Error(`Stock backup contains duplicate or invalid purchase source identity ${key}.`);
    }
    purchaseKeys.add(key);
    bill.items.forEach((line) => {
      if (!line.id || !itemIds.has(line.itemId) || Number(line.quantity) < 0 || Number(line.rate) < 0) {
        throw new Error(`Stock backup contains an invalid purchase line for ${key}.`);
      }
    });
  }

  const salesKeys = new Set<string>();
  for (const bill of data.salesBills) {
    const key = `Sale:${bill.id}`;
    if (!bill.id || !bill.billNo || salesKeys.has(key)) {
      throw new Error(`Stock backup contains duplicate or invalid sales source identity ${key}.`);
    }
    salesKeys.add(key);
    bill.items.forEach((line) => {
      if (!line.id || !itemIds.has(line.itemId) || Number(line.quantity) < 0 || Number(line.rate) < 0) {
        throw new Error(`Stock backup contains an invalid sales line for ${key}.`);
      }
    });
  }
}

export async function replaceStockBackupDataForCompany(companyId: string, data: StockBackupData) {
  validateStockBackupData(data);
  const stockDbUrl = getStockDatabaseUrlForCompanyId(companyId);
  const db = await getDb(stockDbUrl);

  await runSerializedStockOperation(stockDbUrl, () => runStockDbTransaction(db, async () => {
    await db.execute("DELETE FROM stock_purchase_lines");
    await db.execute("DELETE FROM stock_sales_lines");
    await db.execute("DELETE FROM stock_purchase_bills");
    await db.execute("DELETE FROM stock_sales_bills");
    await db.execute("DELETE FROM stock_items");

    for (const item of data.items) {
      await db.execute(
        `
        INSERT INTO stock_items (
          id,
          code,
          name,
          unit,
          opening_qty,
          opening_rate,
          reorder_level,
          is_active,
          created_at
        )
        VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)
        `,
        [
          item.id,
          normalizeStockItemCode(item.code),
          item.name.trim(),
          item.unit.trim() || "MT",
          Number(item.openingQty || 0),
          Number(item.openingRate || 0),
          Number(item.reorderLevel || 0),
          item.isActive ? 1 : 0,
          item.createdAt || new Date().toISOString(),
        ],
      );
    }

    for (const bill of data.purchaseBills) {
      const source = normalizeStockSource(bill.source);
      const sourceType = normalizePurchaseSourceDocumentType(bill.sourceType, source);
      const billId = stockPurchaseBillId(bill.id, sourceType);
      await db.execute(
        `
        INSERT INTO stock_purchase_bills (
          id,
          bill_no,
          date_bs,
          supplier_name,
          source,
          source_type,
          reference_no,
          remarks,
          created_at,
          source_amount,
          source_amount_npr,
          source_currency,
          source_exchange_rate,
          source_fiscal_year_id,
          source_grand_total,
          source_landed_cost_npr,
          source_lifecycle_status
        )
        VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16, $17)
        `,
        [
          billId,
          normalizeBillNo(bill.billNo, "Purchase bill number"),
          normalizeOptionalDate(bill.dateBs),
          bill.supplierName.trim() || "-",
          source,
          sourceType,
          bill.referenceNo ?? "",
          bill.remarks ?? "",
          bill.createdAt || new Date().toISOString(),
          ...sourceSnapshotValues(bill.sourceSnapshot),
        ],
      );

      for (const line of bill.items) {
        await db.execute(
          `
          INSERT INTO stock_purchase_lines (
            id,
            bill_id,
            item_id,
            quantity,
            rate,
            amount,
            entry_rate,
            entry_amount
          )
          VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
          `,
          [
            line.id,
            billId,
            line.itemId,
            Number(line.quantity || 0),
            Number(line.rate || 0),
            Number(line.amount || 0),
            Number(line.entryRate ?? line.rate ?? 0),
            Number(line.entryAmount ?? line.amount ?? 0),
          ],
        );
      }
    }

    for (const bill of data.salesBills) {
      await db.execute(
        `
        INSERT INTO stock_sales_bills (
          id,
          bill_no,
          date_bs,
          customer_name,
          source_type,
          remarks,
          created_at,
          source_amount,
          source_amount_npr,
          source_currency,
          source_exchange_rate,
          source_fiscal_year_id,
          source_grand_total,
          source_landed_cost_npr,
          source_lifecycle_status
        )
        VALUES ($1, $2, $3, $4, 'Sale', $5, $6, $7, $8, $9, $10, $11, $12, $13, $14)
        `,
        [
          bill.id,
          normalizeBillNo(bill.billNo, "Sales bill number"),
          normalizeOptionalDate(bill.dateBs),
          bill.customerName.trim() || "-",
          bill.remarks ?? "",
          bill.createdAt || new Date().toISOString(),
          ...sourceSnapshotValues(bill.sourceSnapshot),
        ],
      );

      for (const line of bill.items) {
        await db.execute(
          `
          INSERT INTO stock_sales_lines (
            id,
            bill_id,
            item_id,
            quantity,
            rate,
            amount
          )
          VALUES ($1, $2, $3, $4, $5, $6)
          `,
          [
            line.id,
            bill.id,
            line.itemId,
            Number(line.quantity || 0),
            Number(line.rate || 0),
            Number(line.amount || 0),
          ],
        );
      }
    }
  }, { queueKey: stockDbUrl }));
}

export async function upsertStockOpeningItemsForCompany(
  companyId: string,
  items: StockOpeningCarryForwardInput[],
): Promise<StockOpeningCarryForwardWriteSummary> {
  const stockDbUrl = getStockDatabaseUrlForCompanyId(companyId);
  const summary: StockOpeningCarryForwardWriteSummary = { created: 0, updated: 0 };
  const db = await getDb(stockDbUrl);

  await runSerializedStockOperation(stockDbUrl, async () => {
    const existingItems = await getStockItemsFromDb(db);
    const existingByCode = new Map(existingItems.map((item) => [normalizeStockItemCode(item.code), item] as const));

    await runStockDbTransaction(db, async () => {
    for (const item of items) {
      const code = normalizeStockItemCode(item.code);
      const existing = existingByCode.get(code);
      const name = item.name.trim();
      const unit = item.unit.trim() || "MT";

      if (!code || !name) {
        throw new Error("Carry-forward item code and name are required.");
      }

      if (existing) {
        await db.execute(
          `
          UPDATE stock_items
          SET
            name = $1,
            unit = $2,
            opening_qty = $3,
            opening_rate = $4,
            reorder_level = $5,
            is_active = $6
          WHERE id = $7
          `,
          [
            name,
            unit,
            Number(item.openingQty || 0),
            Number(item.openingRate || 0),
            Number(item.reorderLevel || 0),
            item.isActive ? 1 : 0,
            existing.id,
          ],
        );
        summary.updated += 1;
      } else {
        await db.execute(
          `
          INSERT INTO stock_items (
            id,
            code,
            name,
            unit,
            opening_qty,
            opening_rate,
            reorder_level,
            is_active,
            created_at
          )
          VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)
          `,
          [
            crypto.randomUUID(),
            code,
            name,
            unit,
            Number(item.openingQty || 0),
            Number(item.openingRate || 0),
            Number(item.reorderLevel || 0),
            item.isActive ? 1 : 0,
            new Date().toISOString(),
          ],
        );
        summary.created += 1;
      }
      }
    }, { queueKey: stockDbUrl });
  });

  return summary;
}

export function buildStockRows(
  items: StockItem[],
  purchaseBills: StockPurchaseBill[],
  salesBills: StockSalesBill[],
  asOnDate = "",
): StockRow[] {
  const normalizedAsOnDate = normalizeOptionalDate(asOnDate);
  const includeDate = (value: string) =>
    !normalizedAsOnDate || !value || normalizeOptionalDate(value) <= normalizedAsOnDate;

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
  return value === "Opening" ? "" : normalizeOptionalDate(value);
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
    const billDate = normalizeOptionalDate(bill.dateBs);
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
    const billDate = normalizeOptionalDate(bill.dateBs);
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
