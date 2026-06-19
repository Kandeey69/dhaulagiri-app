import Database from "@tauri-apps/plugin-sql";
import type {
  ActivityLog,
  Collection,
  CreditNote,
  LedgerRow,
  OutstandingRow,
  Party,
  Sale,
} from "./types";

let dbPromise: Promise<Database> | null = null;

async function getDb() {
  if (!dbPromise) {
    dbPromise = Database.load("sqlite:accounts.db");
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

  const vatAmount = Number((salesAmount * 0.13).toFixed(2));
  const totalAmount = Number((salesAmount + vatAmount).toFixed(2));

  const sale: Sale = {
    ...input,
    id: crypto.randomUUID(),
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
    VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13)
    `,
    [
      sale.id,
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

  const vatAmount = Number((salesAmount * 0.13).toFixed(2));
  const totalAmount = Number((salesAmount + vatAmount).toFixed(2));

  await db.execute(
    `
    UPDATE sales
    SET
      bill_no = $1,
      date_bs = $2,
      date_ad = $3,
      party_id = $4,
      quantity = $5,
      rate = $6,
      amount = $7,
      sales_amount = $8,
      vat_amount = $9,
      total_amount = $10,
      remarks = $11
    WHERE id = $12
    `,
    [
      billNo,
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

  await db.execute(
    `
    DELETE FROM sales
    WHERE id = $1
    `,
    [saleId]
  );

  await logActivity("Sale Deleted", `Deleted sale ${saleId}.`);
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
    dateBs,
    bankName: input.bankName?.trim() ?? "",
    receiptNo,
    amount: Number(input.amount || 0),
    createdAt: new Date().toISOString(),
  };

  await db.execute(
    `
    INSERT INTO collections (
      id,
      date_bs,
      date_ad,
      party_id,
      bank_name,
      amount,
      reference_no,
      remarks,
      created_at
    )
    VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)
    `,
    [
      collection.id,
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

  await logActivity(
    "Collection Created",
    `Created collection receipt no. ${collection.receiptNo}.`
  );
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

  if (!input.partyId) {
    throw new Error("Party is required.");
  }

  if (!String(input.bankName ?? "").trim()) {
    throw new Error("Bank / Cash is required.");
  }

  if (Number(input.amount || 0) <= 0) {
    throw new Error("Amount must be greater than zero.");
  }

  await db.execute(
    `
    UPDATE collections
    SET
      date_bs = $1,
      date_ad = $2,
      party_id = $3,
      bank_name = $4,
      amount = $5,
      reference_no = $6,
      remarks = $7
    WHERE id = $8
    `,
    [
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

  await logActivity(
    "Collection Updated",
    `Updated collection receipt no. ${receiptNo}.`
  );
  return {
    ...input,
    dateBs,
    bankName: input.bankName?.trim() ?? "",
    amount: Number(input.amount || 0),
    receiptNo,
    createdAt: "",
  };
}

export async function deleteCollection(collectionId: string): Promise<void> {
  if (!collectionId) {
    throw new Error("Collection ID is required.");
  }

  const db = await getDb();

  await db.execute(
    `
    DELETE FROM collections
    WHERE id = $1
    `,
    [collectionId]
  );

  await logActivity("Collection Deleted", `Deleted collection ${collectionId}.`);
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
    VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)
    `,
    [
      creditNote.id,
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
      date_bs = $2,
      date_ad = $3,
      party_id = $4,
      amount = $5,
      vat_amount = $6,
      total_amount = $7,
      remarks = $8
    WHERE id = $9
    `,
    [
      creditNoteNo,
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

  await logActivity(
    "Credit Note Updated",
    `Updated credit note no. ${creditNoteNo}.`
  );
  return {
    ...input,
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

  await db.execute(
    `
    DELETE FROM credit_notes
    WHERE id = $1
    `,
    [creditNoteId]
  );

  await logActivity("Credit Note Deleted", `Deleted credit note ${creditNoteId}.`);
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

    ORDER BY createdAt ASC
    `,
    [partyId]
  );

  let runningBalance = openingBalance;

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

  for (const transaction of transactions) {
    runningBalance =
      runningBalance +
      Number(transaction.debit || 0) -
      Number(transaction.credit || 0);

    rows.push({
      dateBs: normalizeDateDisplay(transaction.dateBs || ""),
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
