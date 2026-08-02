import Database from "@tauri-apps/plugin-sql";
import {
  getActiveAccountsDatabaseUrl,
  getActiveCompanyId,
  getActiveCompanyProfile,
} from "../../companyContext";
import type {
  ActivityLog,
  Collection,
  CreditNote,
  LedgerRow,
  OutstandingRow,
  Party,
  ReceiptAllocation,
  Sale,
} from "./types";
import { calculateVatAmount } from "../utils/settings";
import {
  createFiscalYearFromCode,
  findFiscalYearByBsDate,
  getOrCreateMigrationFiscalYear,
  type FiscalYear,
} from "../../domain/fiscalYear";
import { createSequentialAllocations, validateAllocations } from "../../domain/allocations";
import type { TransactionLifecycleStatus } from "../../domain/lifecycle";
import {
  postCreditNote,
  postCustomerReceipt,
  postSale,
  type LedgerEntry,
} from "../../domain/ledger";

export type AccountsBackupData = {
  activityLogs: ActivityLog[];
  collections: Collection[];
  creditNotes: CreditNote[];
  parties: Party[];
  receiptAllocations?: ReceiptAllocation[];
  sales: Sale[];
};

let dbPromise: Promise<Database> | null = null;
let dbUrl = "";

async function getDb() {
  const activeDbUrl = getActiveAccountsDatabaseUrl();

  if (!dbPromise || dbUrl !== activeDbUrl) {
    dbUrl = activeDbUrl;
    dbPromise = Database.load(activeDbUrl);
  }

  const db = await dbPromise;
  await initDb(db);
  return db;
}

async function ensureColumn(
  db: Database,
  tableName: string,
  columnName: string,
  columnDefinition: string
) {
  const columns = await db.select<{ name: string }[]>(
    `PRAGMA table_info(${tableName})`
  );

  const exists = columns.some((column) => column.name === columnName);

  if (!exists) {
    await db.execute(
      `ALTER TABLE ${tableName} ADD COLUMN ${columnName} ${columnDefinition}`
    );
  }
}

async function ensureUniqueWholeNumberIndex(
  db: Database,
  tableName: string,
  columnName: string,
  indexName: string
) {
  const duplicates = await db.select<{ duplicateCount: number }[]>(
    `
    SELECT COUNT(*) AS duplicateCount
    FROM (
      SELECT CAST(${columnName} AS INTEGER) AS normalized_value
      FROM ${tableName}
      WHERE ${columnName} IS NOT NULL
        AND trim(${columnName}) <> ''
      GROUP BY CAST(${columnName} AS INTEGER)
      HAVING COUNT(*) > 1
    )
    `
  );

  if (Number(duplicates[0]?.duplicateCount || 0) > 0) {
    return;
  }

  await db.execute(`
    CREATE UNIQUE INDEX IF NOT EXISTS ${indexName}
    ON ${tableName} (CAST(${columnName} AS INTEGER))
    WHERE ${columnName} IS NOT NULL
      AND trim(${columnName}) <> ''
  `);
}

function getActiveFiscalYearCode() {
  return getActiveCompanyProfile()?.fiscalYear || "2082/83";
}

function getActiveFiscalYearId() {
  return createFiscalYearFromCode(
    getActiveCompanyId() || "default",
    getActiveFiscalYearCode()
  ).id;
}

function mapFiscalYear(row: Record<string, unknown>): FiscalYear {
  return {
    id: String(row.id ?? ""),
    companyId: String(row.companyId ?? (getActiveCompanyId() || "default")),
    code: String(row.code ?? getActiveFiscalYearCode()),
    startBs: String(row.startBs ?? ""),
    endBs: String(row.endBs ?? ""),
    startAd: String(row.startAd ?? ""),
    endAd: String(row.endAd ?? ""),
    status: (row.status as FiscalYear["status"]) ?? "OPEN",
    createdAt: String(row.createdAt ?? ""),
    updatedAt: String(row.updatedAt ?? ""),
  };
}

async function getFiscalYears(db: Database) {
  const rows = await db.select<Record<string, unknown>[]>(
    "SELECT * FROM fiscal_years ORDER BY startBs DESC"
  );
  const fiscalYears = rows.map(mapFiscalYear);
  const migrationFiscalYear = getOrCreateMigrationFiscalYear(
    getActiveCompanyId() || "default",
    fiscalYears,
    getActiveFiscalYearCode()
  );

  return fiscalYears.some((fiscalYear) => fiscalYear.id === migrationFiscalYear.id)
    ? fiscalYears
    : [migrationFiscalYear, ...fiscalYears];
}

async function resolveFiscalYearId(db: Database, dateBs: string) {
  const fiscalYears = await getFiscalYears(db);
  return (
    findFiscalYearByBsDate(dateBs, fiscalYears)?.id ??
    getOrCreateMigrationFiscalYear(
      getActiveCompanyId() || "default",
      fiscalYears,
      getActiveFiscalYearCode()
    ).id
  );
}

async function ensureAccountingModel(db: Database) {
  await db.execute(`
    CREATE TABLE IF NOT EXISTS fiscal_years (
      id TEXT PRIMARY KEY,
      companyId TEXT NOT NULL,
      code TEXT NOT NULL,
      startBs TEXT NOT NULL,
      endBs TEXT NOT NULL,
      startAd TEXT NOT NULL DEFAULT '',
      endAd TEXT NOT NULL DEFAULT '',
      status TEXT NOT NULL DEFAULT 'OPEN',
      createdAt TEXT NOT NULL,
      updatedAt TEXT NOT NULL,
      UNIQUE(companyId, code)
    )
  `);

  await db.execute(`
    CREATE TABLE IF NOT EXISTS receipt_allocations (
      id TEXT PRIMARY KEY,
      receipt_id TEXT NOT NULL,
      sale_id TEXT NOT NULL,
      amount_npr REAL NOT NULL DEFAULT 0,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL,
      FOREIGN KEY (receipt_id) REFERENCES collections(id),
      FOREIGN KEY (sale_id) REFERENCES sales(id)
    )
  `);

  await ensureColumn(db, "sales", "fiscal_year_id", "TEXT NOT NULL DEFAULT ''");
  await ensureColumn(db, "sales", "lifecycle_status", "TEXT NOT NULL DEFAULT 'POSTED'");
  await ensureColumn(db, "sales", "applied_vat_rate", "REAL NOT NULL DEFAULT 13");
  await ensureColumn(db, "sales", "calculation_version", "TEXT NOT NULL DEFAULT 'sales-policy-v1'");
  await ensureColumn(db, "sales", "calculated_at", "TEXT NOT NULL DEFAULT ''");
  await ensureLifecycleColumns(db, "sales");
  await ensureColumn(db, "collections", "fiscal_year_id", "TEXT NOT NULL DEFAULT ''");
  await ensureColumn(db, "collections", "lifecycle_status", "TEXT NOT NULL DEFAULT 'POSTED'");
  await ensureLifecycleColumns(db, "collections");
  await ensureColumn(db, "credit_notes", "fiscal_year_id", "TEXT NOT NULL DEFAULT ''");
  await ensureColumn(db, "credit_notes", "lifecycle_status", "TEXT NOT NULL DEFAULT 'POSTED'");
  await ensureLifecycleColumns(db, "credit_notes");
  await ensureColumn(db, "activity_logs", "metadata", "TEXT NOT NULL DEFAULT ''");
  await db.execute(`
    CREATE TABLE IF NOT EXISTS ledger_entries (
      id TEXT PRIMARY KEY,
      batch_id TEXT NOT NULL,
      company_id TEXT NOT NULL,
      fiscal_year_id TEXT NOT NULL,
      transaction_date TEXT NOT NULL,
      account_code TEXT NOT NULL,
      party_id TEXT,
      source_type TEXT NOT NULL,
      source_id TEXT NOT NULL,
      posting_version TEXT NOT NULL DEFAULT 'v1',
      debit REAL NOT NULL DEFAULT 0,
      credit REAL NOT NULL DEFAULT 0,
      narration TEXT NOT NULL DEFAULT '',
      status TEXT NOT NULL DEFAULT 'ACTIVE',
      reversal_of_entry_id TEXT,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    )
  `);
  await db.execute("CREATE INDEX IF NOT EXISTS idx_sales_fiscal_year ON sales(fiscal_year_id)");
  await db.execute("CREATE INDEX IF NOT EXISTS idx_collections_fiscal_year ON collections(fiscal_year_id)");
  await db.execute("CREATE INDEX IF NOT EXISTS idx_credit_notes_fiscal_year ON credit_notes(fiscal_year_id)");
  await db.execute("CREATE INDEX IF NOT EXISTS idx_receipt_allocations_receipt ON receipt_allocations(receipt_id)");
  await db.execute("CREATE INDEX IF NOT EXISTS idx_receipt_allocations_sale ON receipt_allocations(sale_id)");
  await db.execute("CREATE INDEX IF NOT EXISTS idx_accounts_ledger_source ON ledger_entries(source_type, source_id, posting_version)");
  await db.execute("CREATE INDEX IF NOT EXISTS idx_accounts_ledger_party ON ledger_entries(party_id)");

  const fiscalYear = createFiscalYearFromCode(
    getActiveCompanyId() || "default",
    getActiveFiscalYearCode()
  );
  await db.execute(
    `
    INSERT OR IGNORE INTO fiscal_years (
      id, companyId, code, startBs, endBs, startAd, endAd, status, createdAt, updatedAt
    ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)
    `,
    [
      fiscalYear.id,
      fiscalYear.companyId,
      fiscalYear.code,
      fiscalYear.startBs,
      fiscalYear.endBs,
      fiscalYear.startAd ?? "",
      fiscalYear.endAd ?? "",
      fiscalYear.status,
      fiscalYear.createdAt,
      fiscalYear.updatedAt,
    ]
  );
  await db.execute("UPDATE sales SET fiscal_year_id = $1 WHERE fiscal_year_id = ''", [fiscalYear.id]);
  await db.execute("UPDATE collections SET fiscal_year_id = $1 WHERE fiscal_year_id = ''", [fiscalYear.id]);
  await db.execute("UPDATE credit_notes SET fiscal_year_id = $1 WHERE fiscal_year_id = ''", [fiscalYear.id]);
  await db.execute("UPDATE sales SET calculated_at = created_at WHERE calculated_at = ''");
}

async function ensureLifecycleColumns(db: Database, tableName: string) {
  await ensureColumn(db, tableName, "posted_at", "TEXT NOT NULL DEFAULT ''");
  await ensureColumn(db, tableName, "posted_by", "TEXT NOT NULL DEFAULT ''");
  await ensureColumn(db, tableName, "voided_at", "TEXT NOT NULL DEFAULT ''");
  await ensureColumn(db, tableName, "reversed_at", "TEXT NOT NULL DEFAULT ''");
  await ensureColumn(db, tableName, "reversal_reason", "TEXT NOT NULL DEFAULT ''");
  await ensureColumn(db, tableName, "replacement_transaction_id", "TEXT NOT NULL DEFAULT ''");
}

async function initDb(db: Database) {
  await db.execute(`
    CREATE TABLE IF NOT EXISTS parties (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL UNIQUE,
      address TEXT,
      phone TEXT,
      pan_no TEXT,
      opening_balance REAL DEFAULT 0,
      is_active INTEGER DEFAULT 1,
      created_at TEXT NOT NULL
    )
  `);

  await db.execute(`
    CREATE TABLE IF NOT EXISTS sales (
      id TEXT PRIMARY KEY,
      bill_no TEXT NOT NULL UNIQUE,
      date_bs TEXT,
      date_ad TEXT,
      party_id TEXT NOT NULL,

      quantity REAL DEFAULT 0,
      rate REAL DEFAULT 0,
      amount REAL NOT NULL,

      sales_amount REAL DEFAULT 0,
      vat_amount REAL DEFAULT 0,
      total_amount REAL DEFAULT 0,

      remarks TEXT,
      created_at TEXT NOT NULL,
      FOREIGN KEY (party_id) REFERENCES parties(id)
    )
  `);

  await ensureColumn(db, "sales", "sales_amount", "REAL DEFAULT 0");
  await ensureColumn(db, "sales", "vat_amount", "REAL DEFAULT 0");
  await ensureColumn(db, "sales", "total_amount", "REAL DEFAULT 0");
  await ensureUniqueWholeNumberIndex(
    db,
    "sales",
    "bill_no",
    "idx_sales_bill_no_unique_number"
  );

  await db.execute(`
    CREATE TABLE IF NOT EXISTS collections (
      id TEXT PRIMARY KEY,
      date_bs TEXT,
      date_ad TEXT,
      party_id TEXT NOT NULL,
      bank_name TEXT,
      amount REAL NOT NULL,
      reference_no TEXT,
      remarks TEXT,
      created_at TEXT NOT NULL,
      FOREIGN KEY (party_id) REFERENCES parties(id)
    )
  `);

  await db.execute(`
    CREATE TABLE IF NOT EXISTS credit_notes (
      id TEXT PRIMARY KEY,
      credit_note_no TEXT NOT NULL UNIQUE,
      date_bs TEXT,
      date_ad TEXT,
      party_id TEXT NOT NULL,
      amount REAL NOT NULL,
      vat_amount REAL DEFAULT 0,
      total_amount REAL DEFAULT 0,
      remarks TEXT,
      created_at TEXT NOT NULL,
      FOREIGN KEY (party_id) REFERENCES parties(id)
    )
  `);

  await db.execute(`
    CREATE TABLE IF NOT EXISTS activity_logs (
      id TEXT PRIMARY KEY,
      action TEXT NOT NULL,
      detail TEXT NOT NULL,
      created_at TEXT NOT NULL
    )
  `);

  await ensureUniqueWholeNumberIndex(
    db,
    "collections",
    "reference_no",
    "idx_collections_reference_no_unique_number"
  );

  await ensureUniqueWholeNumberIndex(
    db,
    "credit_notes",
    "credit_note_no",
    "idx_credit_notes_no_unique_number"
  );

  await ensureAccountingModel(db);
}

function normalizeWholeNumber(value: string, fieldName: string) {
  const raw = String(value ?? "").trim();
  const numericValue = Number(raw.replace(/,/g, ""));

  if (!Number.isInteger(numericValue)) {
    throw new Error(`${fieldName} must be a whole number only.`);
  }

  const normalized = String(numericValue);

  if (numericValue <= 0) {
    throw new Error(`${fieldName} must be greater than zero.`);
  }

  return normalized;
}

function normalizeDateParts(value: string) {
  const raw = String(value ?? "").trim();
  const match = raw.match(/^(\d{4})[/-](\d{1,2})[/-](\d{1,2})$/);

  if (!match) {
    return "";
  }

  const [, year, monthText, dayText] = match;
  const month = Number(monthText);
  const day = Number(dayText);

  if (month < 1 || month > 12 || day < 1 || day > 32) {
    return "";
  }

  return `${year}/${String(month).padStart(2, "0")}/${String(day).padStart(2, "0")}`;
}

function normalizeDateInput(value: string, fieldName = "Date BS") {
  const normalized = normalizeDateParts(value);

  if (!normalized) {
    throw new Error(`${fieldName} must be in YYYY/MM/DD or YYYY-MM-DD format.`);
  }

  return normalized;
}

type PartyRow = {
  id: string;
  name: string;
  address: string | null;
  phone: string | null;
  pan_no: string | null;
  opening_balance: number;
  is_active: number;
  created_at: string;
};

type SaleRow = {
  id: string;
  fiscal_year_id?: string | null;
  lifecycle_status?: string | null;
  bill_no: string;
  date_bs: string | null;
  date_ad: string | null;
  party_id: string;

  quantity: number | null;
  rate: number | null;
  amount: number | null;

  sales_amount: number | null;
  vat_amount: number | null;
  total_amount: number | null;

  remarks: string | null;
  created_at: string;
};

type CollectionRow = {
  id: string;
  fiscal_year_id?: string | null;
  lifecycle_status?: string | null;
  date_bs: string | null;
  date_ad: string | null;
  party_id: string;
  bank_name: string | null;
  amount: number;
  reference_no: string | null;
  remarks: string | null;
  created_at: string;
};

type CreditNoteRow = {
  id: string;
  fiscal_year_id?: string | null;
  lifecycle_status?: string | null;
  credit_note_no: string;
  date_bs: string | null;
  date_ad: string | null;
  party_id: string;
  amount: number;
  vat_amount: number | null;
  total_amount: number | null;
  remarks: string | null;
  created_at: string;
};

type ActivityLogRow = {
  id: string;
  action: string;
  detail: string;
  created_at: string;
};

function lifecycleStatus(value: unknown): TransactionLifecycleStatus {
  const status = String(value ?? "POSTED");
  return status === "DRAFT" || status === "VOID" || status === "REVERSED"
    ? status
    : "POSTED";
}

function mapParty(row: PartyRow): Party {
  return {
    id: row.id,
    name: row.name,
    address: row.address ?? "",
    phone: row.phone ?? "",
    panNo: row.pan_no ?? "",
    openingBalance: Number(row.opening_balance || 0),
    isActive: Boolean(row.is_active),
    createdAt: row.created_at,
  };
}

function mapSale(row: SaleRow): Sale {
  const fallbackTotal = Number(row.amount || 0);
  const savedSalesAmount = Number(row.sales_amount || 0);
  const savedVatAmount = Number(row.vat_amount || 0);
  const savedTotalAmount = Number(row.total_amount || 0);

  const totalAmount = savedTotalAmount > 0 ? savedTotalAmount : fallbackTotal;
  const salesAmount = savedSalesAmount > 0 ? savedSalesAmount : fallbackTotal;

  return {
    id: row.id,
    fiscalYearId: row.fiscal_year_id ?? getActiveFiscalYearId(),
    lifecycleStatus: lifecycleStatus(row.lifecycle_status),
    billNo: row.bill_no,
    dateBs: normalizeDateDisplay(row.date_bs ?? ""),
    dateAd: row.date_ad ?? "",
    partyId: row.party_id,

    salesAmount,
    vatAmount: savedVatAmount,
    totalAmount,

    remarks: row.remarks ?? "",
    createdAt: row.created_at,
  };
}

function mapCollection(row: CollectionRow): Collection {
  return {
    id: row.id,
    fiscalYearId: row.fiscal_year_id ?? getActiveFiscalYearId(),
    lifecycleStatus: lifecycleStatus(row.lifecycle_status),
    dateBs: normalizeDateDisplay(row.date_bs ?? ""),
    dateAd: row.date_ad ?? "",
    partyId: row.party_id,
    bankName: row.bank_name ?? "",
    amount: Number(row.amount || 0),
    receiptNo: row.reference_no ?? "",
    remarks: row.remarks ?? "",
    createdAt: row.created_at,
  };
}

function mapCreditNote(row: CreditNoteRow): CreditNote {
  const amount = Number(row.amount || 0);
  const vatAmount = Number(row.vat_amount || 0);
  const totalAmount = Number(row.total_amount || 0) || amount + vatAmount;

  return {
    id: row.id,
    fiscalYearId: row.fiscal_year_id ?? getActiveFiscalYearId(),
    lifecycleStatus: lifecycleStatus(row.lifecycle_status),
    creditNoteNo: row.credit_note_no,
    dateBs: normalizeDateDisplay(row.date_bs ?? ""),
    dateAd: row.date_ad ?? "",
    partyId: row.party_id,
    amount,
    vatAmount,
    totalAmount,
    remarks: row.remarks ?? "",
    createdAt: row.created_at,
  };
}

async function runDbTransaction<T>(db: Database, work: () => Promise<T>) {
  await db.execute("BEGIN IMMEDIATE TRANSACTION");
  try {
    const result = await work();
    await db.execute("COMMIT");
    return result;
  } catch (error) {
    await db.execute("ROLLBACK");
    throw error;
  }
}

async function createReceiptAllocations(
  db: Database,
  collection: Collection,
  excludeReceiptId = ""
) {
  const saleRows = await db.select<{ id: string; total_amount: number | null; amount: number | null; date_bs: string | null; created_at: string }[]>(
    `
    SELECT id, total_amount, amount, date_bs, created_at
    FROM sales
    WHERE party_id = $1
      AND fiscal_year_id = $2
    ORDER BY date_bs ASC, created_at ASC
    `,
    [collection.partyId, collection.fiscalYearId ?? ""]
  );
  const existingRows = await db.select<{ id: string; receipt_id: string; sale_id: string; amount_npr: number; created_at: string; updated_at: string }[]>(
    `
    SELECT *
    FROM receipt_allocations
    WHERE receipt_id <> $1
    `,
    [excludeReceiptId]
  );
  const existingAllocations = existingRows.map((allocation) => ({
    id: allocation.id,
    sourceId: allocation.receipt_id,
    targetId: allocation.sale_id,
    targetType: "SALE" as const,
    amountNPR: Number(allocation.amount_npr || 0),
    createdAt: allocation.created_at,
    updatedAt: allocation.updated_at,
  }));
  const now = new Date().toISOString();
  const allocations = createSequentialAllocations({
    idFactory: () => crypto.randomUUID(),
    sourceId: collection.id,
    sourceAmountNPR: collection.amount,
    targetType: "SALE",
    targets: saleRows.map((sale) => ({
      id: sale.id,
      totalNPR: Number(sale.total_amount || sale.amount || 0),
    })),
    existingAllocations,
    timestamp: now,
  });
  const validation = validateAllocations({
    sourceAmountNPR: collection.amount,
    allocations,
    targets: saleRows.map((sale) => ({
      id: sale.id,
      totalNPR: Number(sale.total_amount || sale.amount || 0),
    })),
    existingAllocations,
  });

  if (!validation.valid) {
    throw new Error(validation.errors.map((error) => error.message).join("\n"));
  }

  return allocations.map((allocation) => ({
    id: allocation.id,
    receiptId: allocation.sourceId,
    saleId: allocation.targetId,
    amountNPR: allocation.amountNPR,
    createdAt: allocation.createdAt,
    updatedAt: allocation.updatedAt,
  }));
}

function accountPostingContext(fiscalYearId: string) {
  const companyId = getActiveCompanyId() || "default";
  const fiscalYear = createFiscalYearFromCode(companyId, getActiveFiscalYearCode());
  return {
    companyId,
    fiscalYearId,
    fiscalYear: {
      ...fiscalYear,
      id: fiscalYearId,
    },
    idFactory: () => crypto.randomUUID(),
    timestamp: new Date().toISOString(),
    userName: "System",
  };
}

async function insertLedgerEntries(db: Database, entries: LedgerEntry[]) {
  for (const entry of entries) {
    await db.execute(
      `
      INSERT INTO ledger_entries (
        id, batch_id, company_id, fiscal_year_id, transaction_date, account_code,
        party_id, source_type, source_id, posting_version, debit, credit,
        narration, status, reversal_of_entry_id, created_at, updated_at
      ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16, $17)
      `,
      [
        entry.id,
        entry.batchId,
        entry.companyId,
        entry.fiscalYearId,
        entry.transactionDate,
        entry.accountCode,
        entry.partyId ?? "",
        entry.sourceType,
        entry.sourceId,
        entry.postingVersion,
        entry.debit,
        entry.credit,
        entry.narration,
        entry.status,
        entry.reversalOfEntryId ?? "",
        entry.createdAt,
        entry.updatedAt,
      ]
    );
  }
}

async function replaceLedgerPosting(db: Database, sourceType: string, sourceId: string, entries: LedgerEntry[]) {
  await db.execute(
    "DELETE FROM ledger_entries WHERE source_type = $1 AND source_id = $2 AND status = 'ACTIVE'",
    [sourceType, sourceId]
  );
  await insertLedgerEntries(db, entries);
}

export async function getAccountsBackupData(): Promise<AccountsBackupData> {
  const [parties, sales, collections, creditNotes, activityLogs, receiptAllocations] = await Promise.all([
    getParties(),
    getSales(),
    getCollections(),
    getCreditNotes(),
    getActivityLogs(100000),
    getReceiptAllocations(),
  ]);

  return {
    activityLogs,
    collections,
    creditNotes,
    parties,
    receiptAllocations,
    sales,
  };
}

export async function getReceiptAllocations(): Promise<ReceiptAllocation[]> {
  const db = await getDb();
  const rows = await db.select<{ id: string; receipt_id: string; sale_id: string; amount_npr: number; created_at: string; updated_at: string }[]>(
    "SELECT * FROM receipt_allocations ORDER BY created_at ASC"
  );

  return rows.map((row) => ({
    id: row.id,
    receiptId: row.receipt_id,
    saleId: row.sale_id,
    amountNPR: Number(row.amount_npr || 0),
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  }));
}

export async function restoreAccountsBackupData(data: Partial<AccountsBackupData>): Promise<void> {
  const db = await getDb();
  const parties = data.parties ?? [];
  const sales = data.sales ?? [];
  const collections = data.collections ?? [];
  const creditNotes = data.creditNotes ?? [];
  const activityLogs = data.activityLogs ?? [];
  const receiptAllocations = data.receiptAllocations ?? [];

  await db.execute("DELETE FROM receipt_allocations");
  await db.execute("DELETE FROM activity_logs");
  await db.execute("DELETE FROM credit_notes");
  await db.execute("DELETE FROM collections");
  await db.execute("DELETE FROM sales");
  await db.execute("DELETE FROM parties");

  for (const party of parties) {
    await db.execute(
      `
      INSERT INTO parties (
        id,
        name,
        address,
        phone,
        pan_no,
        opening_balance,
        is_active,
        created_at
      )
      VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
      `,
      [
        party.id,
        party.name,
        party.address ?? "",
        party.phone ?? "",
        party.panNo ?? "",
        Number(party.openingBalance || 0),
        party.isActive ? 1 : 0,
        party.createdAt || new Date().toISOString(),
      ]
    );
  }

  for (const sale of sales) {
    const fiscalYearId = sale.fiscalYearId || await resolveFiscalYearId(db, sale.dateBs);
    await db.execute(
      `
      INSERT INTO sales (
        id,
        fiscal_year_id,
        bill_no,
        date_bs,
        date_ad,
        party_id,
        quantity,
        rate,
        amount,
        sales_amount,
        vat_amount,
        total_amount,
        remarks,
        created_at
      )
      VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14)
      `,
      [
        sale.id,
        fiscalYearId,
        sale.billNo,
        sale.dateBs,
        sale.dateAd ?? "",
        sale.partyId,
        0,
        0,
        sale.totalAmount,
        sale.salesAmount,
        sale.vatAmount,
        sale.totalAmount,
        sale.remarks ?? "",
        sale.createdAt || new Date().toISOString(),
      ]
    );
  }

  for (const collection of collections) {
    const fiscalYearId = collection.fiscalYearId || await resolveFiscalYearId(db, collection.dateBs);
    await db.execute(
      `
      INSERT INTO collections (
        id,
        fiscal_year_id,
        date_bs,
        date_ad,
        party_id,
        bank_name,
        amount,
        reference_no,
        remarks,
        created_at
      )
      VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)
      `,
      [
        collection.id,
        fiscalYearId,
        collection.dateBs,
        collection.dateAd ?? "",
        collection.partyId,
        collection.bankName ?? "",
        collection.amount,
        collection.receiptNo ?? "",
        collection.remarks ?? "",
        collection.createdAt || new Date().toISOString(),
      ]
    );
  }

  for (const creditNote of creditNotes) {
    const fiscalYearId = creditNote.fiscalYearId || await resolveFiscalYearId(db, creditNote.dateBs);
    await db.execute(
      `
      INSERT INTO credit_notes (
        id,
        fiscal_year_id,
        credit_note_no,
        date_bs,
        date_ad,
        party_id,
        amount,
        vat_amount,
        total_amount,
        remarks,
        created_at
      )
      VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11)
      `,
      [
        creditNote.id,
        fiscalYearId,
        creditNote.creditNoteNo,
        creditNote.dateBs,
        creditNote.dateAd ?? "",
        creditNote.partyId,
        creditNote.amount,
        creditNote.vatAmount,
        creditNote.totalAmount,
        creditNote.remarks ?? "",
        creditNote.createdAt || new Date().toISOString(),
      ]
    );
  }

  for (const allocation of receiptAllocations) {
    await db.execute(
      `
      INSERT INTO receipt_allocations (
        id, receipt_id, sale_id, amount_npr, created_at, updated_at
      ) VALUES ($1, $2, $3, $4, $5, $6)
      `,
      [
        allocation.id || crypto.randomUUID(),
        allocation.receiptId,
        allocation.saleId,
        Number(allocation.amountNPR || 0),
        allocation.createdAt || new Date().toISOString(),
        allocation.updatedAt || new Date().toISOString(),
      ]
    );
  }

  for (const log of activityLogs) {
    await db.execute(
      `
      INSERT INTO activity_logs (id, action, detail, created_at)
      VALUES ($1, $2, $3, $4)
      `,
      [
        log.id || crypto.randomUUID(),
        log.action,
        log.detail,
        log.createdAt || new Date().toISOString(),
      ]
    );
  }

  await logActivity("Backup Imported", `Imported backup with ${parties.length} parties.`);
}

export async function getParties(): Promise<Party[]> {
  const db = await getDb();

  const rows = await db.select<PartyRow[]>(`
    SELECT *
    FROM parties
    ORDER BY name ASC
  `);

  return rows.map(mapParty);
}

export async function saveParty(
  input: Omit<Party, "id" | "createdAt">
): Promise<Party> {
  const db = await getDb();

  const name = input.name.trim();

  if (!name) {
    throw new Error("Party name is required.");
  }

  const existing = await db.select<{ id: string }[]>(
    `
    SELECT id
    FROM parties
    WHERE lower(name) = lower($1)
    LIMIT 1
    `,
    [name]
  );

  if (existing.length > 0) {
    throw new Error("Party name already exists.");
  }

  const party: Party = {
    ...input,
    id: crypto.randomUUID(),
    name,
    createdAt: new Date().toISOString(),
  };

  await db.execute(
    `
    INSERT INTO parties (
      id,
      name,
      address,
      phone,
      pan_no,
      opening_balance,
      is_active,
      created_at
    )
    VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
    `,
    [
      party.id,
      party.name,
      party.address ?? "",
      party.phone ?? "",
      party.panNo ?? "",
      party.openingBalance,
      party.isActive ? 1 : 0,
      party.createdAt,
    ]
  );

  await logActivity("Party Created", `Created party ${party.name}.`);
  return party;
}

function mapActivityLog(row: ActivityLogRow): ActivityLog {
  return {
    id: row.id,
    action: row.action,
    detail: row.detail,
    createdAt: row.created_at,
  };
}

export async function logActivity(action: string, detail: string): Promise<void> {
  const db = await getDb();

  await db.execute(
    `
    INSERT INTO activity_logs (id, action, detail, created_at)
    VALUES ($1, $2, $3, $4)
    `,
    [crypto.randomUUID(), action, detail, new Date().toISOString()]
  );
}

export async function getActivityLogs(limit = 50): Promise<ActivityLog[]> {
  const db = await getDb();
  const rows = await db.select<ActivityLogRow[]>(
    `
    SELECT *
    FROM activity_logs
    ORDER BY created_at DESC
    LIMIT $1
    `,
    [limit]
  );

  return rows.map(mapActivityLog);
}

export async function updateParty(input: Omit<Party, "createdAt">): Promise<Party> {
  const db = await getDb();

  if (!input.id) {
    throw new Error("Party ID is required.");
  }

  const name = input.name.trim();

  if (!name) {
    throw new Error("Party name is required.");
  }

  const existing = await db.select<{ id: string }[]>(
    `
    SELECT id
    FROM parties
    WHERE lower(name) = lower($1)
      AND id <> $2
    LIMIT 1
    `,
    [name, input.id]
  );

  if (existing.length > 0) {
    throw new Error("Party name already exists.");
  }

  await db.execute(
    `
    UPDATE parties
    SET
      name = $1,
      address = $2,
      phone = $3,
      pan_no = $4,
      opening_balance = $5,
      is_active = $6
    WHERE id = $7
    `,
    [
      name,
      input.address ?? "",
      input.phone ?? "",
      input.panNo ?? "",
      Number(input.openingBalance || 0),
      input.isActive ? 1 : 0,
      input.id,
    ]
  );

  await logActivity("Party Updated", `Updated party ${name}.`);
  return {
    ...input,
    name,
    openingBalance: Number(input.openingBalance || 0),
    createdAt: "",
  };
}

export async function upsertPartiesForCarryForward(parties: Party[]): Promise<void> {
  const db = await getDb();
  const now = new Date().toISOString();

  for (const party of parties) {
    const name = party.name.trim();

    if (!party.id || !name) {
      continue;
    }

    await db.execute(
      `
      INSERT INTO parties (
        id,
        name,
        address,
        phone,
        pan_no,
        opening_balance,
        is_active,
        created_at
      )
      VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
      ON CONFLICT(id) DO UPDATE SET
        name = excluded.name,
        address = excluded.address,
        phone = excluded.phone,
        pan_no = excluded.pan_no,
        opening_balance = excluded.opening_balance,
        is_active = excluded.is_active
      `,
      [
        party.id,
        name,
        party.address ?? "",
        party.phone ?? "",
        party.panNo ?? "",
        Number(party.openingBalance || 0),
        party.isActive ? 1 : 0,
        party.createdAt || now,
      ]
    );
  }

  await logActivity(
    "Opening Balances Refreshed",
    `Carried forward opening balances for ${parties.length} parties.`
  );
}

function normalizeDateDisplay(value: string) {
  const raw = String(value ?? "").trim();
  const serial = Number(raw);
  const normalized = normalizeDateParts(raw);

  if (normalized) {
    return normalized;
  }

  if (/^\d+(\.\d+)?$/.test(raw) && serial >= 20000 && serial <= 100000) {
    const excelEpoch = Date.UTC(1899, 11, 30);
    const date = new Date(excelEpoch + Math.round(serial) * 86400000);
    const year = date.getUTCFullYear();
    const month = String(date.getUTCMonth() + 1).padStart(2, "0");
    const day = String(date.getUTCDate()).padStart(2, "0");
    return `${year}/${month}/${day}`;
  }

  return raw;
}

export async function deleteParty(partyId: string): Promise<void> {
  if (!partyId) {
    throw new Error("Party ID is required.");
  }

  const db = await getDb();
  const references = await db.select<
    { salesCount: number; collectionsCount: number; creditNotesCount: number }[]
  >(
    `
    SELECT
      (SELECT COUNT(*) FROM sales WHERE party_id = $1) AS salesCount,
      (SELECT COUNT(*) FROM collections WHERE party_id = $1) AS collectionsCount,
      (SELECT COUNT(*) FROM credit_notes WHERE party_id = $1) AS creditNotesCount
    `,
    [partyId]
  );
  const salesCount = Number(references[0]?.salesCount || 0);
  const collectionsCount = Number(references[0]?.collectionsCount || 0);
  const creditNotesCount = Number(references[0]?.creditNotesCount || 0);

  if (salesCount > 0 || collectionsCount > 0 || creditNotesCount > 0) {
    throw new Error(
      "Cannot delete this party because it has sales, collections, or credit notes. Delete those entries first."
    );
  }

  await db.execute(
    `
    DELETE FROM parties
    WHERE id = $1
    `,
    [partyId]
  );

  await logActivity("Party Deleted", `Deleted party ${partyId}.`);
}

export async function getSales(): Promise<Sale[]> {
  const db = await getDb();

  const rows = await db.select<SaleRow[]>(`
    SELECT *
    FROM sales
    ORDER BY CAST(bill_no AS INTEGER) ASC
  `);

  return rows.map(mapSale);
}

export async function saveSale(
  input: Omit<Sale, "id" | "createdAt">
): Promise<Sale> {
  const db = await getDb();

  const billNo = normalizeWholeNumber(input.billNo, "Bill number");

  const dateBs = normalizeDateInput(input.dateBs);
  const fiscalYearId = await resolveFiscalYearId(db, dateBs);

  if (!input.partyId) {
    throw new Error("Party is required.");
  }

  const existing = await db.select<{ id: string }[]>(
    `
    SELECT id
    FROM sales
    WHERE CAST(bill_no AS INTEGER) = CAST($1 AS INTEGER)
    LIMIT 1
    `,
    [billNo]
  );

  if (existing.length > 0) {
    throw new Error(
      `Bill number ${billNo} is already used. Please enter a unique bill number.`
    );
  }

  const salesAmount = Number(input.salesAmount || 0);

  if (salesAmount <= 0) {
    throw new Error("Sales amount must be greater than zero.");
  }

  const vatAmount = calculateVatAmount(salesAmount);
  const totalAmount = Number((salesAmount + vatAmount).toFixed(2));

  const sale: Sale = {
    ...input,
    id: crypto.randomUUID(),
    fiscalYearId,
    billNo,
    dateBs,
    salesAmount,
    vatAmount,
    totalAmount,
    createdAt: new Date().toISOString(),
  };

  await db.execute(
    `
    INSERT INTO sales (
      id,
      fiscal_year_id,
      bill_no,
      date_bs,
      date_ad,
      party_id,

      quantity,
      rate,
      amount,

      sales_amount,
      vat_amount,
      total_amount,

      remarks,
      created_at
    )
    VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14)
    `,
    [
      sale.id,
      sale.fiscalYearId ?? "",
      sale.billNo,
      sale.dateBs,
      sale.dateAd ?? "",
      sale.partyId,

      0,
      0,
      sale.totalAmount,

      sale.salesAmount,
      sale.vatAmount,
      sale.totalAmount,

      sale.remarks ?? "",
      sale.createdAt,
    ]
  );

  await replaceLedgerPosting(
    db,
    "SALE",
    sale.id,
    postSale(
      {
        id: sale.id,
        lifecycleStatus: "DRAFT",
        fiscalYearId: sale.fiscalYearId ?? "",
        date: sale.dateBs,
        partyId: sale.partyId,
        salesAmount: sale.salesAmount,
        vatAmount: sale.vatAmount,
        totalAmount: sale.totalAmount,
        reference: sale.billNo,
      },
      accountPostingContext(sale.fiscalYearId ?? "")
    )
  );

  await logActivity("Sale Created", `Created sale bill no. ${sale.billNo}.`);
  return sale;
}

export async function updateSale(input: Omit<Sale, "createdAt">): Promise<Sale> {
  const db = await getDb();

  if (!input.id) {
    throw new Error("Sale ID is required.");
  }

  const billNo = normalizeWholeNumber(input.billNo, "Bill number");

  const dateBs = normalizeDateInput(input.dateBs);
  const fiscalYearId = await resolveFiscalYearId(db, dateBs);

  if (!input.partyId) {
    throw new Error("Party is required.");
  }

  const existing = await db.select<{ id: string }[]>(
    `
    SELECT id
    FROM sales
    WHERE CAST(bill_no AS INTEGER) = CAST($1 AS INTEGER)
      AND id <> $2
    LIMIT 1
    `,
    [billNo, input.id]
  );

  if (existing.length > 0) {
    throw new Error(
      `Bill number ${billNo} is already used. Please enter a unique bill number.`
    );
  }

  const salesAmount = Number(input.salesAmount || 0);

  if (salesAmount <= 0) {
    throw new Error("Sales amount must be greater than zero.");
  }

  const vatAmount = calculateVatAmount(salesAmount);
  const totalAmount = Number((salesAmount + vatAmount).toFixed(2));

  await db.execute(
    `
    UPDATE sales
    SET
      bill_no = $1,
      fiscal_year_id = $2,
      date_bs = $3,
      date_ad = $4,
      party_id = $5,
      quantity = $6,
      rate = $7,
      amount = $8,
      sales_amount = $9,
      vat_amount = $10,
      total_amount = $11,
      remarks = $12
    WHERE id = $13
    `,
    [
      billNo,
      fiscalYearId,
      dateBs,
      input.dateAd ?? "",
      input.partyId,

      0,
      0,
      totalAmount,

      salesAmount,
      vatAmount,
      totalAmount,

      input.remarks ?? "",
      input.id,
    ]
  );

  await replaceLedgerPosting(
    db,
    "SALE",
    input.id,
    postSale(
      {
        id: input.id,
        lifecycleStatus: "DRAFT",
        fiscalYearId,
        date: dateBs,
        partyId: input.partyId,
        salesAmount,
        vatAmount,
        totalAmount,
        reference: billNo,
      },
      accountPostingContext(fiscalYearId)
    )
  );

  await logActivity("Sale Updated", `Updated sale bill no. ${billNo}.`);
  return {
    ...input,
    billNo,
    dateBs,
    salesAmount,
    vatAmount,
    totalAmount,
    createdAt: "",
  };
}

export async function deleteSale(saleId: string): Promise<void> {
  if (!saleId) {
    throw new Error("Sale ID is required.");
  }

  const db = await getDb();

  await runDbTransaction(db, async () => {
    await db.execute("DELETE FROM receipt_allocations WHERE sale_id = $1", [saleId]);
    await db.execute("DELETE FROM ledger_entries WHERE source_type = 'SALE' AND source_id = $1", [saleId]);
    await db.execute(
      `
      DELETE FROM sales
      WHERE id = $1
      `,
      [saleId]
    );
    await db.execute(
      `
      INSERT INTO activity_logs (id, action, detail, created_at)
      VALUES ($1, $2, $3, $4)
      `,
      [
        crypto.randomUUID(),
        "Sale Deleted",
        `Deleted sale ${saleId}.`,
        new Date().toISOString(),
      ]
    );
  });
}

export async function getCollections(): Promise<Collection[]> {
  const db = await getDb();

  const rows = await db.select<CollectionRow[]>(`
    SELECT *
    FROM collections
    ORDER BY CAST(reference_no AS INTEGER) ASC
  `);

  return rows.map(mapCollection);
}

export async function saveCollection(
  input: Omit<Collection, "id" | "createdAt">
): Promise<Collection> {
  const db = await getDb();

  const receiptNo = normalizeWholeNumber(
    String(input.receiptNo ?? ""),
    "Receipt number"
  );

  const existing = await db.select<{ id: string }[]>(
    `
    SELECT id
    FROM collections
    WHERE CAST(reference_no AS INTEGER) = CAST($1 AS INTEGER)
    LIMIT 1
    `,
    [receiptNo]
  );

  if (existing.length > 0) {
    throw new Error(
      `Receipt number ${receiptNo} is already used. Please enter a unique receipt number.`
    );
  }

  const dateBs = normalizeDateInput(input.dateBs);
  const fiscalYearId = await resolveFiscalYearId(db, dateBs);

  if (!input.partyId) {
    throw new Error("Party is required.");
  }

  if (!String(input.bankName ?? "").trim()) {
    throw new Error("Bank / Cash is required.");
  }

  if (Number(input.amount || 0) <= 0) {
    throw new Error("Amount must be greater than zero.");
  }

  const collection: Collection = {
    ...input,
    id: crypto.randomUUID(),
    fiscalYearId,
    dateBs,
    bankName: input.bankName?.trim() ?? "",
    receiptNo,
    amount: Number(input.amount || 0),
    createdAt: new Date().toISOString(),
  };

  await runDbTransaction(db, async () => {
    await db.execute(
      `
      INSERT INTO collections (
        id,
        fiscal_year_id,
        date_bs,
        date_ad,
        party_id,
        bank_name,
        amount,
        reference_no,
        remarks,
        created_at
      )
      VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)
      `,
      [
        collection.id,
        collection.fiscalYearId ?? "",
        collection.dateBs,
        collection.dateAd ?? "",
        collection.partyId,
        collection.bankName ?? "",
        collection.amount,
        collection.receiptNo ?? "",
        collection.remarks ?? "",
        collection.createdAt,
      ]
    );

    const allocations = await createReceiptAllocations(db, collection);
    for (const allocation of allocations) {
      await db.execute(
        `
        INSERT INTO receipt_allocations (
          id, receipt_id, sale_id, amount_npr, created_at, updated_at
        ) VALUES ($1, $2, $3, $4, $5, $6)
        `,
        [
          allocation.id,
          allocation.receiptId,
          allocation.saleId,
          allocation.amountNPR,
          allocation.createdAt,
          allocation.updatedAt,
        ]
      );
    }

    await replaceLedgerPosting(
      db,
      "CUSTOMER_RECEIPT",
      collection.id,
      postCustomerReceipt(
        {
          id: collection.id,
          lifecycleStatus: "DRAFT",
          fiscalYearId: collection.fiscalYearId ?? "",
          date: collection.dateBs,
          partyId: collection.partyId,
          amountNPR: collection.amount,
          reference: collection.receiptNo ?? collection.id,
        },
        accountPostingContext(collection.fiscalYearId ?? "")
      )
    );

    await db.execute(
      `
      INSERT INTO activity_logs (id, action, detail, created_at)
      VALUES ($1, $2, $3, $4)
      `,
      [
        crypto.randomUUID(),
        "Collection Created",
        `Created collection receipt no. ${collection.receiptNo}.`,
        new Date().toISOString(),
      ]
    );
  });
  return collection;
}

export async function updateCollection(
  input: Omit<Collection, "createdAt">
): Promise<Collection> {
  const db = await getDb();

  if (!input.id) {
    throw new Error("Collection ID is required.");
  }

  const receiptNo = normalizeWholeNumber(
    String(input.receiptNo ?? ""),
    "Receipt number"
  );

  const existing = await db.select<{ id: string }[]>(
    `
    SELECT id
    FROM collections
    WHERE CAST(reference_no AS INTEGER) = CAST($1 AS INTEGER)
      AND id <> $2
    LIMIT 1
    `,
    [receiptNo, input.id]
  );

  if (existing.length > 0) {
    throw new Error(
      `Receipt number ${receiptNo} is already used. Please enter a unique receipt number.`
    );
  }

  const dateBs = normalizeDateInput(input.dateBs);
  const fiscalYearId = await resolveFiscalYearId(db, dateBs);

  if (!input.partyId) {
    throw new Error("Party is required.");
  }

  if (!String(input.bankName ?? "").trim()) {
    throw new Error("Bank / Cash is required.");
  }

  if (Number(input.amount || 0) <= 0) {
    throw new Error("Amount must be greater than zero.");
  }

  const collection = {
    ...input,
    fiscalYearId,
    dateBs,
    bankName: input.bankName?.trim() ?? "",
    amount: Number(input.amount || 0),
    receiptNo,
    createdAt: "",
  };

  await runDbTransaction(db, async () => {
    await db.execute(
      `
      UPDATE collections
      SET
        fiscal_year_id = $1,
        date_bs = $2,
        date_ad = $3,
        party_id = $4,
        bank_name = $5,
        amount = $6,
        reference_no = $7,
        remarks = $8
      WHERE id = $9
      `,
      [
        fiscalYearId,
        dateBs,
        input.dateAd ?? "",
        input.partyId,
        input.bankName?.trim() ?? "",
        Number(input.amount || 0),
        receiptNo,
        input.remarks ?? "",
        input.id,
      ]
    );

    await db.execute("DELETE FROM receipt_allocations WHERE receipt_id = $1", [input.id]);
    const allocations = await createReceiptAllocations(db, collection, input.id);
    for (const allocation of allocations) {
      await db.execute(
        `
        INSERT INTO receipt_allocations (
          id, receipt_id, sale_id, amount_npr, created_at, updated_at
        ) VALUES ($1, $2, $3, $4, $5, $6)
        `,
        [
          allocation.id,
          allocation.receiptId,
          allocation.saleId,
          allocation.amountNPR,
          allocation.createdAt,
          allocation.updatedAt,
        ]
      );
    }

    await replaceLedgerPosting(
      db,
      "CUSTOMER_RECEIPT",
      collection.id,
      postCustomerReceipt(
        {
          id: collection.id,
          lifecycleStatus: "DRAFT",
          fiscalYearId: collection.fiscalYearId ?? "",
          date: collection.dateBs,
          partyId: collection.partyId,
          amountNPR: collection.amount,
          reference: collection.receiptNo ?? collection.id,
        },
        accountPostingContext(collection.fiscalYearId ?? "")
      )
    );

    await db.execute(
      `
      INSERT INTO activity_logs (id, action, detail, created_at)
      VALUES ($1, $2, $3, $4)
      `,
      [
        crypto.randomUUID(),
        "Collection Updated",
        `Updated collection receipt no. ${receiptNo}.`,
        new Date().toISOString(),
      ]
    );
  });

  return collection;
}

export async function deleteCollection(collectionId: string): Promise<void> {
  if (!collectionId) {
    throw new Error("Collection ID is required.");
  }

  const db = await getDb();

  await runDbTransaction(db, async () => {
    await db.execute("DELETE FROM receipt_allocations WHERE receipt_id = $1", [collectionId]);
    await db.execute("DELETE FROM ledger_entries WHERE source_type = 'CUSTOMER_RECEIPT' AND source_id = $1", [collectionId]);
    await db.execute(
      `
      DELETE FROM collections
      WHERE id = $1
      `,
      [collectionId]
    );
    await db.execute(
      `
      INSERT INTO activity_logs (id, action, detail, created_at)
      VALUES ($1, $2, $3, $4)
      `,
      [
        crypto.randomUUID(),
        "Collection Deleted",
        `Deleted collection ${collectionId}.`,
        new Date().toISOString(),
      ]
    );
  });
}

export async function getCreditNotes(): Promise<CreditNote[]> {
  const db = await getDb();

  const rows = await db.select<CreditNoteRow[]>(`
    SELECT *
    FROM credit_notes
    ORDER BY CAST(credit_note_no AS INTEGER) ASC
  `);

  return rows.map(mapCreditNote);
}

export async function saveCreditNote(
  input: Omit<CreditNote, "id" | "createdAt">
): Promise<CreditNote> {
  const db = await getDb();

  const creditNoteNo = normalizeWholeNumber(
    input.creditNoteNo,
    "Credit note number"
  );
  const dateBs = normalizeDateInput(input.dateBs);
  const fiscalYearId = await resolveFiscalYearId(db, dateBs);

  if (!input.partyId) {
    throw new Error("Party is required.");
  }

  const existing = await db.select<{ id: string }[]>(
    `
    SELECT id
    FROM credit_notes
    WHERE CAST(credit_note_no AS INTEGER) = CAST($1 AS INTEGER)
    LIMIT 1
    `,
    [creditNoteNo]
  );

  if (existing.length > 0) {
    throw new Error(
      `Credit note number ${creditNoteNo} is already used. Please enter a unique credit note number.`
    );
  }

  const amount = Number(input.amount || 0);
  const vatAmount = Number(input.vatAmount || 0);

  if (amount <= 0) {
    throw new Error("Amount must be greater than zero.");
  }

  if (vatAmount < 0) {
    throw new Error("VAT must not be negative.");
  }

  const creditNote: CreditNote = {
    ...input,
    id: crypto.randomUUID(),
    fiscalYearId,
    creditNoteNo,
    dateBs,
    amount,
    vatAmount,
    totalAmount: Number((amount + vatAmount).toFixed(2)),
    createdAt: new Date().toISOString(),
  };

  await db.execute(
    `
    INSERT INTO credit_notes (
      id,
      fiscal_year_id,
      credit_note_no,
      date_bs,
      date_ad,
      party_id,
      amount,
      vat_amount,
      total_amount,
      remarks,
      created_at
    )
    VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11)
    `,
    [
      creditNote.id,
      creditNote.fiscalYearId ?? "",
      creditNote.creditNoteNo,
      creditNote.dateBs,
      creditNote.dateAd ?? "",
      creditNote.partyId,
      creditNote.amount,
      creditNote.vatAmount,
      creditNote.totalAmount,
      creditNote.remarks ?? "",
      creditNote.createdAt,
    ]
  );

  await replaceLedgerPosting(
    db,
    "CREDIT_NOTE",
    creditNote.id,
    postCreditNote(
      {
        id: creditNote.id,
        lifecycleStatus: "DRAFT",
        fiscalYearId: creditNote.fiscalYearId ?? "",
        date: creditNote.dateBs,
        partyId: creditNote.partyId,
        amount: creditNote.amount,
        vatAmount: creditNote.vatAmount,
        totalAmount: creditNote.totalAmount,
        reference: creditNote.creditNoteNo,
      },
      accountPostingContext(creditNote.fiscalYearId ?? "")
    )
  );

  await logActivity(
    "Credit Note Created",
    `Created credit note no. ${creditNote.creditNoteNo}.`
  );
  return creditNote;
}

export async function updateCreditNote(
  input: Omit<CreditNote, "createdAt">
): Promise<CreditNote> {
  const db = await getDb();

  if (!input.id) {
    throw new Error("Credit note ID is required.");
  }

  const creditNoteNo = normalizeWholeNumber(
    input.creditNoteNo,
    "Credit note number"
  );
  const dateBs = normalizeDateInput(input.dateBs);
  const fiscalYearId = await resolveFiscalYearId(db, dateBs);

  if (!input.partyId) {
    throw new Error("Party is required.");
  }

  const existing = await db.select<{ id: string }[]>(
    `
    SELECT id
    FROM credit_notes
    WHERE CAST(credit_note_no AS INTEGER) = CAST($1 AS INTEGER)
      AND id <> $2
    LIMIT 1
    `,
    [creditNoteNo, input.id]
  );

  if (existing.length > 0) {
    throw new Error(
      `Credit note number ${creditNoteNo} is already used. Please enter a unique credit note number.`
    );
  }

  const amount = Number(input.amount || 0);
  const vatAmount = Number(input.vatAmount || 0);

  if (amount <= 0) {
    throw new Error("Amount must be greater than zero.");
  }

  if (vatAmount < 0) {
    throw new Error("VAT must not be negative.");
  }

  const totalAmount = Number((amount + vatAmount).toFixed(2));

  await db.execute(
    `
    UPDATE credit_notes
    SET
      credit_note_no = $1,
      fiscal_year_id = $2,
      date_bs = $3,
      date_ad = $4,
      party_id = $5,
      amount = $6,
      vat_amount = $7,
      total_amount = $8,
      remarks = $9
    WHERE id = $10
    `,
    [
      creditNoteNo,
      fiscalYearId,
      dateBs,
      input.dateAd ?? "",
      input.partyId,
      amount,
      vatAmount,
      totalAmount,
      input.remarks ?? "",
      input.id,
    ]
  );

  await replaceLedgerPosting(
    db,
    "CREDIT_NOTE",
    input.id,
    postCreditNote(
      {
        id: input.id,
        lifecycleStatus: "DRAFT",
        fiscalYearId,
        date: dateBs,
        partyId: input.partyId,
        amount,
        vatAmount,
        totalAmount,
        reference: creditNoteNo,
      },
      accountPostingContext(fiscalYearId)
    )
  );

  await logActivity(
    "Credit Note Updated",
    `Updated credit note no. ${creditNoteNo}.`
  );
  return {
    ...input,
    fiscalYearId,
    creditNoteNo,
    dateBs,
    amount,
    vatAmount,
    totalAmount,
    createdAt: "",
  };
}

export async function deleteCreditNote(creditNoteId: string): Promise<void> {
  if (!creditNoteId) {
    throw new Error("Credit note ID is required.");
  }

  const db = await getDb();

  await runDbTransaction(db, async () => {
    await db.execute("DELETE FROM ledger_entries WHERE source_type = 'CREDIT_NOTE' AND source_id = $1", [creditNoteId]);
    await db.execute(
      `
      DELETE FROM credit_notes
      WHERE id = $1
      `,
      [creditNoteId]
    );
    await db.execute(
      `
      INSERT INTO activity_logs (id, action, detail, created_at)
      VALUES ($1, $2, $3, $4)
      `,
      [
        crypto.randomUUID(),
        "Credit Note Deleted",
        `Deleted credit note ${creditNoteId}.`,
        new Date().toISOString(),
      ]
    );
  });
}

export async function getOutstanding(): Promise<OutstandingRow[]> {
  const db = await getDb();

  const rows = await db.select<
    {
      partyId: string;
      partyName: string;
      openingBalance: number;
      totalSales: number;
      totalCollections: number;
      totalAdjustments: number;
      outstanding: number;
    }[]
  >(`
    SELECT
      p.id AS partyId,
      p.name AS partyName,
      p.opening_balance AS openingBalance,

      COALESCE((
        SELECT SUM(COALESCE(NULLIF(s.total_amount, 0), s.amount, 0))
        FROM sales s
        WHERE s.party_id = p.id
      ), 0) AS totalSales,

      COALESCE((
        SELECT SUM(c.amount)
        FROM collections c
        WHERE c.party_id = p.id
      ), 0) AS totalCollections,

      COALESCE((
        SELECT SUM(COALESCE(NULLIF(cn.total_amount, 0), cn.amount + cn.vat_amount, 0))
        FROM credit_notes cn
        WHERE cn.party_id = p.id
      ), 0) AS totalAdjustments,

      p.opening_balance
        + COALESCE((
          SELECT SUM(COALESCE(NULLIF(s2.total_amount, 0), s2.amount, 0))
          FROM sales s2
          WHERE s2.party_id = p.id
        ), 0)
        - COALESCE((
          SELECT SUM(c2.amount)
          FROM collections c2
          WHERE c2.party_id = p.id
        ), 0)
        - COALESCE((
          SELECT SUM(COALESCE(NULLIF(cn2.total_amount, 0), cn2.amount + cn2.vat_amount, 0))
          FROM credit_notes cn2
          WHERE cn2.party_id = p.id
        ), 0) AS outstanding

    FROM parties p
    ORDER BY p.name ASC
  `);

  return rows.map((row) => ({
    partyId: row.partyId,
    partyName: row.partyName,
    openingBalance: Number(row.openingBalance || 0),
    totalSales: Number(row.totalSales || 0),
    totalCollections: Number(row.totalCollections || 0),
    totalAdjustments: Number(row.totalAdjustments || 0),
    outstanding: Number(row.outstanding || 0),
  }));
}

export async function getPartyLedger(partyId: string): Promise<LedgerRow[]> {
  const db = await getDb();

  const parties = await db.select<{ opening_balance: number }[]>(
    `
    SELECT opening_balance
    FROM parties
    WHERE id = $1
    LIMIT 1
    `,
    [partyId]
  );

  if (parties.length === 0) {
    return [];
  }

  const openingBalance = Number(parties[0].opening_balance || 0);

  const transactions = await db.select<
    {
      dateBs: string;
      type: "Sale" | "Collection" | "Adjustment";
      reference: string;
      debit: number;
      credit: number;
      remarks: string;
      createdAt: string;
    }[]
  >(
    `
    SELECT
      date_bs AS dateBs,
      'Sale' AS type,
      bill_no AS reference,
      COALESCE(NULLIF(total_amount, 0), amount, 0) AS debit,
      0 AS credit,
      COALESCE(remarks, '') AS remarks,
      created_at AS createdAt
    FROM sales
    WHERE party_id = $1

    UNION ALL

    SELECT
      date_bs AS dateBs,
      'Collection' AS type,
      COALESCE(reference_no, '') AS reference,
      0 AS debit,
      amount AS credit,
      COALESCE(remarks, '') AS remarks,
      created_at AS createdAt
    FROM collections
    WHERE party_id = $1

    UNION ALL

    SELECT
      date_bs AS dateBs,
      'Adjustment' AS type,
      credit_note_no AS reference,
      0 AS debit,
      COALESCE(NULLIF(total_amount, 0), amount + vat_amount, 0) AS credit,
      COALESCE(remarks, '') AS remarks,
      created_at AS createdAt
    FROM credit_notes
    WHERE party_id = $1

    `,
    [partyId]
  );

  let runningBalance = openingBalance;
  const transactionOrder = {
    Sale: 1,
    Collection: 2,
    Adjustment: 3,
  } as const;
  const sortedTransactions = transactions
    .map((transaction) => ({
      ...transaction,
      dateBs: normalizeDateDisplay(transaction.dateBs || ""),
    }))
    .sort((left, right) => {
      const dateCompare = (left.dateBs || "9999/99/99").localeCompare(
        right.dateBs || "9999/99/99"
      );

      if (dateCompare !== 0) {
        return dateCompare;
      }

      const typeCompare = transactionOrder[left.type] - transactionOrder[right.type];

      if (typeCompare !== 0) {
        return typeCompare;
      }

      return (left.createdAt || "").localeCompare(right.createdAt || "");
    });

  const rows: LedgerRow[] = [
    {
      dateBs: "",
      type: "Opening",
      reference: "Opening Balance",
      debit: openingBalance > 0 ? openingBalance : 0,
      credit: openingBalance < 0 ? Math.abs(openingBalance) : 0,
      balance: openingBalance,
      remarks: "",
    },
  ];

  for (const transaction of sortedTransactions) {
    runningBalance =
      runningBalance +
      Number(transaction.debit || 0) -
      Number(transaction.credit || 0);

    rows.push({
      dateBs: transaction.dateBs,
      type: transaction.type,
      reference: transaction.reference || "",
      debit: Number(transaction.debit || 0),
      credit: Number(transaction.credit || 0),
      balance: runningBalance,
      remarks: transaction.remarks || "",
    });
  }

  return rows;
}
