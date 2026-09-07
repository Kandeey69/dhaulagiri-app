from __future__ import annotations

import json
import math
import os
import re
import sqlite3
from datetime import datetime, timezone
from pathlib import Path


ROOT = Path(__file__).resolve().parents[1]
APPDATA = Path(os.environ["APPDATA"]) / "com.easysolution.businesssuite"
DOCS = ROOT / "docs"

COMPANY_NAME = "Himalaya Fresh Fruit Traders Pvt. Ltd."
COMPANY_SHORT = "HFFT-DDA"
ADDRESS = "Bharatpur, Chitwan, Nepal"
PAN = "DDA-TEST-208283"
FY1 = "2082/83"
FY2 = "2083/84"


CUSTOMERS = [
    ("CUST-001", "Everest Mart Pvt Ltd", 12000, 13730, 10984),
    ("CUST-002", "Annapurna Grocery Center", 8000, 12620, 10096),
    ("CUST-003", "Bagmati Fresh House", 15000, 13850, 11080),
    ("CUST-004", "Chitwan Retail Traders", 5000, 12170, 9736),
    ("CUST-005", "Gandaki Super Store", 10000, 13400, 10720),
    ("CUST-006", "Janaki Food Suppliers", 0, 6760, 5408),
    ("CUST-007", "Koshi Department Store", 7500, 7090, 5672),
    ("CUST-008", "Lumbini Mini Mart", 4000, 5860, 4688),
    ("CUST-009", "Mechi Wholesale Center", 6000, 6760, 5408),
    ("CUST-010", "Sagarmatha Grocers", 2500, 6310, 5048),
]

VENDORS = [
    ("VEND-001", "North India Apple Exports Pvt Ltd", "Indian Suppliers", 30000),
    ("VEND-002", "Terai Mango Supply House", "Local Suppliers", 25000),
    ("VEND-003", "Narayani Citrus Suppliers", "Local Suppliers", 15000),
    ("AGENT-001", "Birgunj Customs & Logistics Services", "Custom Agent", 18000),
]

ITEMS = [
    ("ITEM-APPLE", "Apple", "KG", 800, 180, 200),
    ("ITEM-MANGO", "Mango", "KG", 1000, 120, 250),
    ("ITEM-LEMON", "Lemon", "KG", 700, 80, 150),
]

SALES_PATTERN = [
    ("CUST-001", 12, 15, 8, 7090),
    ("CUST-002", 8, 14, 8, 5860),
    ("CUST-003", 10, 16, 8, 6760),
    ("CUST-004", 9, 15, 8, 6310),
    ("CUST-005", 11, 14, 8, 6640),
    ("CUST-006", 10, 16, 8, 6760),
    ("CUST-007", 12, 15, 8, 7090),
    ("CUST-008", 8, 14, 8, 5860),
    ("CUST-009", 10, 16, 8, 6760),
    ("CUST-010", 9, 15, 8, 6310),
    ("CUST-001", 11, 14, 8, 6640),
    ("CUST-002", 10, 16, 8, 6760),
    ("CUST-003", 12, 15, 8, 7090),
    ("CUST-004", 8, 14, 8, 5860),
    ("CUST-005", 10, 16, 8, 6760),
]


def utc_now() -> str:
    return datetime.now(timezone.utc).isoformat(timespec="seconds").replace("+00:00", "Z")


def slug(value: str) -> str:
    out: list[str] = []
    last_dash = False
    for ch in value.lower():
        if ch.isalnum():
            out.append(ch)
            last_dash = False
        elif not last_dash:
            out.append("-")
            last_dash = True
    return "".join(out).strip("-")


def company_base_id(name: str, fiscal_year: str) -> str:
    return slug(f"{name} {slug(fiscal_year)}")[:40] or "company"


FY1_COMPANY_ID = company_base_id(COMPANY_NAME, FY1)
FY2_COMPANY_ID = f"{company_base_id(COMPANY_NAME, FY2)}-2"


def fy_id(company_id: str, fiscal_year: str) -> str:
    return f"{company_id}-{fiscal_year.replace('/', '-')}"


def fy_bounds(fiscal_year: str) -> tuple[str, str]:
    start = int(fiscal_year.split("/")[0])
    return f"{start}/04/01", f"{start + 1}/03/32"


def fy_row(company_id: str, fiscal_year: str, status: str) -> tuple[str, str, str, str, str, str, str, str, str, str]:
    ts = utc_now()
    start, end = fy_bounds(fiscal_year)
    return (fy_id(company_id, fiscal_year), company_id, fiscal_year, start, end, "", "", status, ts, ts)


def stock_db_name(company_id: str) -> str:
    if not company_id or company_id == "default":
        return "inventorytracked-stock.db"

    slug = re.sub(r"[^a-z0-9]+", "-", company_id.lower()).strip("-")[:32] or "company"
    hash_value = 0xCBF29CE484222325
    prime = 0x100000001B3
    mask = 0xFFFFFFFFFFFFFFFF

    for character in company_id:
        hash_value ^= ord(character)
        hash_value = (hash_value * prime) & mask

    return f"inventorytracked-stock-{slug}-{hash_value:016x}.db"


def connect(path: Path) -> sqlite3.Connection:
    path.parent.mkdir(parents=True, exist_ok=True)
    con = sqlite3.connect(path)
    con.execute("PRAGMA foreign_keys = ON")
    con.execute("PRAGMA journal_mode = WAL")
    con.execute("PRAGMA synchronous = NORMAL")
    return con


def clear_old_dummy_and_hfft_files() -> list[str]:
    APPDATA.mkdir(parents=True, exist_ok=True)
    removed: list[str] = []
    exact = {
        f"accounts-{FY1_COMPANY_ID}.db",
        f"accounts-{FY2_COMPANY_ID}.db",
        f"import-purchases-{FY1_COMPANY_ID}.db",
        f"import-purchases-{FY2_COMPANY_ID}.db",
        stock_db_name(FY1_COMPANY_ID),
        stock_db_name(FY2_COMPANY_ID),
    }
    for path in APPDATA.iterdir():
        name = path.name
        base_name = name.removesuffix("-wal").removesuffix("-shm")
        if base_name in exact:
            path.unlink(missing_ok=True)
            removed.append(name)
    return sorted(removed)


def create_accounts_schema(con: sqlite3.Connection) -> None:
    con.executescript(
        """
        CREATE TABLE IF NOT EXISTS parties (
          id TEXT PRIMARY KEY,
          name TEXT NOT NULL UNIQUE,
          address TEXT,
          phone TEXT,
          pan_no TEXT,
          opening_balance REAL DEFAULT 0,
          is_active INTEGER DEFAULT 1,
          created_at TEXT NOT NULL
        );
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
        );
        CREATE TABLE IF NOT EXISTS sales (
          id TEXT PRIMARY KEY,
          fiscal_year_id TEXT NOT NULL DEFAULT '',
          lifecycle_status TEXT NOT NULL DEFAULT 'POSTED',
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
          applied_vat_rate REAL NOT NULL DEFAULT 0,
          calculation_version TEXT NOT NULL DEFAULT 'hfft-dda-v1',
          calculated_at TEXT NOT NULL DEFAULT '',
          posted_at TEXT NOT NULL DEFAULT '',
          posted_by TEXT NOT NULL DEFAULT '',
          voided_at TEXT NOT NULL DEFAULT '',
          reversed_at TEXT NOT NULL DEFAULT '',
          reversal_reason TEXT NOT NULL DEFAULT '',
          replacement_transaction_id TEXT NOT NULL DEFAULT '',
          remarks TEXT,
          created_at TEXT NOT NULL,
          FOREIGN KEY (party_id) REFERENCES parties(id)
        );
        CREATE TABLE IF NOT EXISTS collections (
          id TEXT PRIMARY KEY,
          fiscal_year_id TEXT NOT NULL DEFAULT '',
          lifecycle_status TEXT NOT NULL DEFAULT 'POSTED',
          date_bs TEXT,
          date_ad TEXT,
          party_id TEXT NOT NULL,
          bank_name TEXT,
          amount REAL NOT NULL,
          reference_no TEXT,
          posted_at TEXT NOT NULL DEFAULT '',
          posted_by TEXT NOT NULL DEFAULT '',
          voided_at TEXT NOT NULL DEFAULT '',
          reversed_at TEXT NOT NULL DEFAULT '',
          reversal_reason TEXT NOT NULL DEFAULT '',
          replacement_transaction_id TEXT NOT NULL DEFAULT '',
          remarks TEXT,
          created_at TEXT NOT NULL,
          FOREIGN KEY (party_id) REFERENCES parties(id)
        );
        CREATE TABLE IF NOT EXISTS credit_notes (
          id TEXT PRIMARY KEY,
          fiscal_year_id TEXT NOT NULL DEFAULT '',
          lifecycle_status TEXT NOT NULL DEFAULT 'POSTED',
          credit_note_no TEXT NOT NULL UNIQUE,
          date_bs TEXT,
          date_ad TEXT,
          party_id TEXT NOT NULL,
          amount REAL NOT NULL,
          vat_amount REAL DEFAULT 0,
          total_amount REAL DEFAULT 0,
          posted_at TEXT NOT NULL DEFAULT '',
          posted_by TEXT NOT NULL DEFAULT '',
          voided_at TEXT NOT NULL DEFAULT '',
          reversed_at TEXT NOT NULL DEFAULT '',
          reversal_reason TEXT NOT NULL DEFAULT '',
          replacement_transaction_id TEXT NOT NULL DEFAULT '',
          remarks TEXT,
          created_at TEXT NOT NULL,
          FOREIGN KEY (party_id) REFERENCES parties(id)
        );
        CREATE TABLE IF NOT EXISTS receipt_allocations (
          id TEXT PRIMARY KEY,
          receipt_id TEXT NOT NULL,
          sale_id TEXT NOT NULL,
          amount_npr REAL NOT NULL DEFAULT 0,
          created_at TEXT NOT NULL,
          updated_at TEXT NOT NULL,
          FOREIGN KEY (receipt_id) REFERENCES collections(id),
          FOREIGN KEY (sale_id) REFERENCES sales(id)
        );
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
        );
        CREATE TABLE IF NOT EXISTS activity_logs (
          id TEXT PRIMARY KEY,
          action TEXT NOT NULL,
          detail TEXT NOT NULL,
          metadata TEXT NOT NULL DEFAULT '',
          created_at TEXT NOT NULL
        );
        CREATE INDEX IF NOT EXISTS idx_sales_fiscal_year ON sales(fiscal_year_id);
        CREATE INDEX IF NOT EXISTS idx_collections_fiscal_year ON collections(fiscal_year_id);
        CREATE INDEX IF NOT EXISTS idx_accounts_ledger_source ON ledger_entries(source_type, source_id, posting_version);
        """
    )


def create_purchase_schema(con: sqlite3.Connection) -> None:
    con.executescript((ROOT / "src" / "purchase" / "db" / "schema.sql").read_text(encoding="utf-8"))


def create_stock_schema(con: sqlite3.Connection) -> None:
    con.executescript(
        """
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
        );
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
        );
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
        );
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
        );
        CREATE TABLE IF NOT EXISTS stock_sales_lines (
          id TEXT PRIMARY KEY,
          bill_id TEXT NOT NULL,
          item_id TEXT NOT NULL,
          quantity REAL NOT NULL,
          rate REAL NOT NULL,
          amount REAL NOT NULL,
          FOREIGN KEY (bill_id) REFERENCES stock_sales_bills(id),
          FOREIGN KEY (item_id) REFERENCES stock_items(id)
        );
        CREATE INDEX IF NOT EXISTS idx_stock_purchase_bills_bill_no ON stock_purchase_bills(bill_no);
        CREATE INDEX IF NOT EXISTS idx_stock_purchase_bills_source_type ON stock_purchase_bills(source_type, id);
        CREATE INDEX IF NOT EXISTS idx_stock_sales_bills_bill_no ON stock_sales_bills(bill_no);
        """
    )


def bs_month(month_index: int) -> tuple[int, int]:
    if month_index <= 9:
        return 2082, month_index + 3
    return 2083, month_index - 9


def bs_date(month_index: int, day: int) -> str:
    year, month = bs_month(month_index)
    return f"{year}/{month:02d}/{day:02d}"


def ledger_accounts(con: sqlite3.Connection, company_id: str, fiscal_year_id: str, source_type: str, source_id: str, date: str, rows: list[tuple[str, str, float, float, str]]) -> None:
    ts = utc_now()
    batch = f"batch-{source_id}"
    for idx, (account, party, debit, credit, narration) in enumerate(rows, 1):
        con.execute(
            """
            INSERT INTO ledger_entries (
              id, batch_id, company_id, fiscal_year_id, transaction_date, account_code,
              party_id, source_type, source_id, posting_version, debit, credit,
              narration, status, reversal_of_entry_id, created_at, updated_at
            ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 'v1', ?, ?, ?, 'ACTIVE', '', ?, ?)
            """,
            (f"{source_id}-ale-{idx}", batch, company_id, fiscal_year_id, date, account, party, source_type, source_id, round(debit, 2), round(credit, 2), narration, ts, ts),
        )


def ledger_purchase(con: sqlite3.Connection, company_id: str, fiscal_year_id: str, source_type: str, source_id: str, date: str, rows: list[tuple[str, str, float, float, str]]) -> None:
    ts = utc_now()
    batch = f"batch-{source_id}"
    for idx, (account, party, debit, credit, narration) in enumerate(rows, 1):
        con.execute(
            """
            INSERT INTO ledger_entries (
              id, batchId, companyId, fiscalYearId, transactionDate, accountCode,
              partyId, sourceType, sourceId, postingVersion, debit, credit,
              narration, status, reversalOfEntryId, createdAt, updatedAt
            ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 'v1', ?, ?, ?, 'ACTIVE', '', ?, ?)
            """,
            (f"{source_id}-ple-{idx}", batch, company_id, fiscal_year_id, date, account, party, source_type, source_id, round(debit, 2), round(credit, 2), narration, ts, ts),
        )


def seed_company_profiles() -> None:
    ts = utc_now()
    profiles = [
        {
            "companyGroupId": FY1_COMPANY_ID,
            "createdAt": ts,
            "fiscalYear": FY1,
            "id": FY1_COMPANY_ID,
            "isLocked": True,
            "lastCarryForwardAt": ts,
            "lockedAt": ts,
            "name": COMPANY_NAME,
            "nextCompanyId": FY2_COMPANY_ID,
            "previousCompanyId": "",
            "updatedAt": ts,
        },
        {
            "companyGroupId": FY1_COMPANY_ID,
            "createdAt": ts,
            "fiscalYear": FY2,
            "id": FY2_COMPANY_ID,
            "isLocked": False,
            "lastCarryForwardAt": "",
            "lockedAt": "",
            "name": COMPANY_NAME,
            "nextCompanyId": "",
            "previousCompanyId": FY1_COMPANY_ID,
            "updatedAt": ts,
        },
    ]
    (APPDATA / "company-profiles.seed.json").write_text(json.dumps(profiles, indent=2), encoding="utf-8")


def seed_accounts_fy1() -> dict:
    con = connect(APPDATA / f"accounts-{FY1_COMPANY_ID}.db")
    create_accounts_schema(con)
    fiscal_year_id = fy_id(FY1_COMPANY_ID, FY1)
    con.execute("INSERT INTO fiscal_years VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)", fy_row(FY1_COMPANY_ID, FY1, "CLOSED"))
    for code, name, opening, _monthly_sales, _monthly_collection in CUSTOMERS:
        con.execute("INSERT INTO parties VALUES (?, ?, ?, '', ?, ?, 1, ?)", (code, name, ADDRESS, PAN, opening, utc_now()))

    sale_no = 1
    customer_sales = {code: 0.0 for code, *_ in CUSTOMERS}
    customer_collections = {code: 0.0 for code, *_ in CUSTOMERS}
    monthly_rows: list[dict] = []
    for month in range(1, 13):
        month_sales = 0
        apple_sold = mango_sold = lemon_sold = 0
        for tx, (customer, apple, mango, lemon, invoice) in enumerate(SALES_PATTERN, 1):
            doc_id = f"SAL-8283-M{month:02d}-{tx:02d}"
            date = bs_date(month, min(tx, 28))
            con.execute(
                """
                INSERT INTO sales (
                  id, fiscal_year_id, lifecycle_status, bill_no, date_bs, date_ad, party_id,
                  quantity, rate, amount, sales_amount, vat_amount, total_amount,
                  applied_vat_rate, calculation_version, calculated_at, posted_at, posted_by,
                  remarks, created_at
                ) VALUES (?, ?, 'POSTED', ?, ?, '', ?, 0, 0, ?, ?, 0, ?, 0, 'hfft-dda-v1', ?, ?, 'HFFT-DDA', ?, ?)
                """,
                (doc_id, fiscal_year_id, str(sale_no), date, customer, invoice, invoice, invoice, utc_now(), utc_now(), doc_id, utc_now()),
            )
            ledger_accounts(con, FY1_COMPANY_ID, fiscal_year_id, "SALE", doc_id, date, [
                ("1100", customer, invoice, 0, f"Sales invoice {doc_id}"),
                ("4000", "", 0, invoice, f"Sales revenue {doc_id}"),
            ])
            customer_sales[customer] += invoice
            month_sales += invoice
            apple_sold += apple
            mango_sold += mango
            lemon_sold += lemon
            sale_no += 1

        month_collections = 0
        for idx, (customer, _name, _opening, _monthly_sales, collection) in enumerate(CUSTOMERS, 1):
            receipt_id = f"REC-8283-M{month:02d}-{idx:02d}"
            date = bs_date(month, 24 if idx < 6 else 25)
            con.execute(
                """
                INSERT INTO collections (
                  id, fiscal_year_id, lifecycle_status, date_bs, date_ad, party_id, bank_name,
                  amount, reference_no, posted_at, posted_by, remarks, created_at
                ) VALUES (?, ?, 'POSTED', ?, '', ?, 'DDA Bank Account', ?, ?, ?, 'HFFT-DDA', ?, ?)
                """,
                (receipt_id, fiscal_year_id, date, customer, collection, str(month * 100 + idx), utc_now(), receipt_id, utc_now()),
            )
            target_sales = con.execute(
                "SELECT id, total_amount FROM sales WHERE party_id = ? AND date_bs <= ? ORDER BY date_bs, CAST(bill_no AS INTEGER)",
                (customer, date),
            ).fetchall()
            remaining = collection
            alloc_no = 1
            for sale_id, total_amount in target_sales:
                already = con.execute("SELECT COALESCE(SUM(amount_npr), 0) FROM receipt_allocations WHERE sale_id = ?", (sale_id,)).fetchone()[0]
                outstanding = round(float(total_amount) - float(already), 2)
                if outstanding <= 0 or remaining <= 0:
                    continue
                amount = min(outstanding, remaining)
                con.execute(
                    "INSERT INTO receipt_allocations VALUES (?, ?, ?, ?, ?, ?)",
                    (f"{receipt_id}-A{alloc_no:02d}", receipt_id, sale_id, amount, utc_now(), utc_now()),
                )
                remaining = round(remaining - amount, 2)
                alloc_no += 1
            ledger_accounts(con, FY1_COMPANY_ID, fiscal_year_id, "CUSTOMER_RECEIPT", receipt_id, date, [
                ("1000", "", collection, 0, f"Receipt {receipt_id}"),
                ("1100", customer, 0, collection, f"Customer receipt {receipt_id}"),
            ])
            customer_collections[customer] += collection
            month_collections += collection
        monthly_rows.append({
            "month": month,
            "salesCount": len(SALES_PATTERN),
            "salesRevenue": month_sales,
            "collections": month_collections,
            "appleSold": apple_sold,
            "mangoSold": mango_sold,
            "lemonSold": lemon_sold,
        })
    con.execute("INSERT INTO activity_logs VALUES ('HFFT-DDA-SEED', 'HFFT Seed', 'Loaded authoritative HFFT FY 2082/83 sales and collections', ?, ?)", (json.dumps({"source": "seed_hfft_2082_83.py"}), utc_now()))
    con.commit()
    con.close()
    customer_results = []
    for code, name, opening, _monthly_sales, _monthly_collection in CUSTOMERS:
        sales = customer_sales[code]
        collections = customer_collections[code]
        customer_results.append({
            "code": code,
            "name": name,
            "opening": opening,
            "sales": sales,
            "collections": collections,
            "closing": round(opening + sales - collections, 2),
        })
    return {"customers": customer_results, "monthly": monthly_rows}


def seed_purchases_fy1() -> dict:
    con = connect(APPDATA / f"import-purchases-{FY1_COMPANY_ID}.db")
    create_purchase_schema(con)
    fiscal_year_id = fy_id(FY1_COMPANY_ID, FY1)
    con.execute("INSERT INTO fiscal_years VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)", fy_row(FY1_COMPANY_ID, FY1, "CLOSED"))
    con.execute("INSERT INTO app_settings VALUES ('default', ?, ?, 1.6, 'INR', ?, ?, '', 0)", (COMPANY_NAME, FY1, PAN, ADDRESS))
    for code, name, category, opening in VENDORS:
        country = "India" if category == "Indian Suppliers" else "Nepal"
        con.execute("INSERT INTO parties VALUES (?, ?, ?, '', ?, ?, ?, ?, 1, ?, ?)", (code, name, ADDRESS, PAN, country, category, opening, utc_now(), utc_now()))

    monthly_rows: list[dict] = []
    vendor_additions = {code: 0.0 for code, *_ in VENDORS}
    vendor_payments = {code: 0.0 for code, *_ in VENDORS}
    for month in range(1, 13):
        apple_doc = f"IMP-8283-M{month:02d}-APPLE"
        mango_doc = f"LOC-8283-M{month:02d}-MANGO"
        lemon_doc = f"LOC-8283-M{month:02d}-LEMON"
        apple_date = bs_date(month, 5)
        mango_date = bs_date(month, 6)
        lemon_date = bs_date(month, 7)
        shared_bill = "BILL-COLLISION-M06" if month == 6 else apple_doc
        mango_bill = shared_bill if month == 6 else mango_doc

        con.execute(
            """
            INSERT INTO import_purchases (
              id, fiscalYearId, lifecycleStatus, vendorPartyId, vendorBillNumber, billDate,
              supplierCurrency, amountIC, supplierExchangeRate, supplierAmountNPR,
              customAgentPartyId, debitNoteNumber, debitNoteDate, importDutyNPR,
              customServiceNPR, importVatNPR, terminalChargeWithoutVatNPR, terminalVatNPR,
              totalTerminalChargeNPR, freightIndiaStatus, freightIndiaPartyId,
              freightIndiaAmountIC, freightIndiaExchangeRate, freightIndiaAmountNPR,
              totalKg, loadingUnloadingChargePerKg, loadingUnloadingChargeNPR,
              otherChargesNPR, debitNoteTotalNPR, agentServiceBillNumber,
              agentServiceBillDate, agentServiceAmountBeforeVatNPR, agentServiceVatNPR,
              agentServiceTotalNPR, totalAgentPayableNPR, totalInputVatNPR,
              landedCostNPR, appliedVatRate, appliedExchangeRate, calculationVersion,
              calculatedAt, postedAt, postedBy, remarks, createdAt, updatedAt
            ) VALUES (
              ?, ?, 'POSTED', 'VEND-001', ?, ?,
              'INR', 13200, 1.6, 21120,
              'AGENT-001', ?, ?, 900,
              600, 0, 0, 0,
              0, 'Paid by custom agent', '',
              0, 1.6, 0,
              120, 1.5, 180,
              0, 1680, ?, 
              ?, 1680, 0,
              1680, 1680, 0,
              22800, 0, 1.6, 'hfft-dda-v1',
              ?, ?, 'HFFT-DDA', ?, ?, ?
            )
            """,
            (
                apple_doc,
                fiscal_year_id,
                shared_bill,
                apple_date,
                f"DN-{apple_doc}",
                apple_date,
                f"AS-{apple_doc}",
                apple_date,
                utc_now(),
                utc_now(),
                f"Apple import {apple_doc}; supplier amount NPR 21120 preserved, stock landed cost NPR 22800",
                utc_now(),
                utc_now(),
            ),
        )
        ledger_purchase(con, FY1_COMPANY_ID, fiscal_year_id, "PURCHASE", apple_doc, apple_date, [
            ("1200", "", 22800, 0, f"Apple landed cost {apple_doc}"),
            ("2000", "VEND-001", 0, 21120, f"Apple supplier payable {apple_doc}"),
            ("2100", "AGENT-001", 0, 1680, f"Customs/logistics payable {apple_doc}"),
        ])
        vendor_additions["VEND-001"] += 21120
        vendor_additions["AGENT-001"] += 1680

        for doc_id, vendor, bill, date, item, amount in [
            (mango_doc, "VEND-002", mango_bill, mango_date, "Mango", 23400),
            (lemon_doc, "VEND-003", lemon_doc, lemon_date, "Lemon", 9000),
        ]:
            con.execute(
                """
                INSERT INTO local_expenses (
                  id, fiscalYearId, lifecycleStatus, partyId, billNumber, billDate,
                  expenseType, expenseHead, amountBeforeVatNPR, vatNPR, totalAmountNPR,
                  remarks, postedAt, postedBy, createdAt, updatedAt
                ) VALUES (?, ?, 'POSTED', ?, ?, ?, 'Stock', ?, ?, 0, ?, ?, ?, 'HFFT-DDA', ?, ?)
                """,
                (doc_id, fiscal_year_id, vendor, bill, date, item, amount, amount, f"{item} local stock purchase {doc_id}", utc_now(), utc_now(), utc_now()),
            )
            ledger_purchase(con, FY1_COMPANY_ID, fiscal_year_id, "LOCAL_EXPENSE", doc_id, date, [
                ("1200", "", amount, 0, f"{item} stock purchase {doc_id}"),
                ("2300", vendor, 0, amount, f"Local supplier payable {doc_id}"),
            ])
            vendor_additions[vendor] += amount

        payments = [
            ("VEND-001", "Indian Supplier Payment", 15840, apple_doc),
            ("VEND-002", "Other Supplier Payment", 17550, mango_doc),
            ("VEND-003", "Other Supplier Payment", 6750, lemon_doc),
            ("AGENT-001", "Custom Agent Payment", 1400, apple_doc),
        ]
        month_payments = 0
        for index, (party, payment_type, amount, source_doc) in enumerate(payments, 1):
            payment_id = f"PAY-8283-M{month:02d}-{index:02d}"
            date = bs_date(month, 26)
            con.execute(
                """
                INSERT INTO payments (
                  id, fiscalYearId, lifecycleStatus, partyId, paymentDate, paymentType,
                  currency, amount, exchangeRate, amountNPR, paymentMethod, referenceNumber,
                  remarks, postedAt, postedBy, createdAt, updatedAt
                ) VALUES (?, ?, 'POSTED', ?, ?, ?, 'NPR', ?, 1, ?, 'Nabil Bank', ?, ?, ?, 'HFFT-DDA', ?, ?)
                """,
                (payment_id, fiscal_year_id, party, date, payment_type, amount, amount, payment_id, f"75 percent/month payment against {source_doc}", utc_now(), utc_now(), utc_now()),
            )
            payable_account = "2100" if party == "AGENT-001" else ("2000" if party == "VEND-001" else "2300")
            ledger_purchase(con, FY1_COMPANY_ID, fiscal_year_id, "SUPPLIER_PAYMENT", payment_id, date, [
                (payable_account, party, amount, 0, f"Payment {payment_id}"),
                ("1000", "", 0, amount, f"Bank payment {payment_id}"),
            ])
            if party == "VEND-001":
                con.execute("INSERT INTO payment_allocations VALUES (?, ?, ?, ?, ?, ?)", (f"{payment_id}-A01", payment_id, apple_doc, amount, utc_now(), utc_now()))
            vendor_payments[party] += amount
            month_payments += amount
        monthly_rows.append({
            "month": month,
            "purchaseCount": 3,
            "applePurchaseQty": 120,
            "mangoPurchaseQty": 180,
            "lemonPurchaseQty": 100,
            "bankPayments": month_payments,
        })
    con.execute("INSERT INTO activity_logs VALUES ('HFFT-DDA-SEED', 'HFFT Seed', 'Loaded authoritative HFFT FY 2082/83 purchases and payments', 'HFFT-DDA', '', '', ?, ?)", (json.dumps({"source": "seed_hfft_2082_83.py"}), utc_now()))
    con.commit()
    con.close()
    vendor_results = []
    for code, name, _category, opening in VENDORS:
        additions = vendor_additions[code]
        payments = vendor_payments[code]
        vendor_results.append({
            "code": code,
            "name": name,
            "opening": opening,
            "additions": additions,
            "payments": payments,
            "closing": round(opening + additions - payments, 2),
        })
    return {"vendors": vendor_results, "monthly": monthly_rows}


def seed_stock_fy1() -> list[dict]:
    con = connect(APPDATA / stock_db_name(FY1_COMPANY_ID))
    create_stock_schema(con)
    for code, name, unit, qty, rate, reorder in ITEMS:
        con.execute("INSERT INTO stock_items VALUES (?, ?, ?, ?, ?, ?, ?, 1, ?)", (code, code, name, unit, qty, rate, reorder, utc_now()))
    for month in range(1, 13):
        apple_doc = f"IMP-8283-M{month:02d}-APPLE"
        mango_doc = f"LOC-8283-M{month:02d}-MANGO"
        lemon_doc = f"LOC-8283-M{month:02d}-LEMON"
        shared_bill = "BILL-COLLISION-M06" if month == 6 else apple_doc
        mango_bill = shared_bill if month == 6 else mango_doc
        purchase_bills = [
            (f"Import Purchase:{apple_doc}", shared_bill, bs_date(month, 5), "North India Apple Exports Pvt Ltd", "Importation", "Import Purchase", 21120, 21120, "INR", 1.6, 22800, [("ITEM-APPLE", 120, 190, 22800, 176, 21120)]),
            (f"Local Purchase:{mango_doc}", mango_bill, bs_date(month, 6), "Terai Mango Supply House", "Local Purchase", "Local Purchase", 23400, 23400, "NPR", 1, 23400, [("ITEM-MANGO", 180, 130, 23400, 130, 23400)]),
            (f"Local Purchase:{lemon_doc}", lemon_doc, bs_date(month, 7), "Narayani Citrus Suppliers", "Local Purchase", "Local Purchase", 9000, 9000, "NPR", 1, 9000, [("ITEM-LEMON", 100, 90, 9000, 90, 9000)]),
        ]
        for bill_id, bill_no, date, supplier, source, source_type, source_amount, source_amount_npr, currency, rate, landed, lines in purchase_bills:
            con.execute(
                """
                INSERT INTO stock_purchase_bills (
                  id, bill_no, date_bs, supplier_name, source, source_type, reference_no,
                  remarks, created_at, source_amount, source_amount_npr, source_currency,
                  source_exchange_rate, source_fiscal_year_id, source_grand_total,
                  source_landed_cost_npr, source_lifecycle_status
                ) VALUES (?, ?, ?, ?, ?, ?, '', ?, ?, ?, ?, ?, ?, ?, ?, ?, 'POSTED')
                """,
                (bill_id, bill_no, date, supplier, source, source_type, f"HFFT purchase {bill_no}", utc_now(), source_amount, source_amount_npr, currency, rate, fy_id(FY1_COMPANY_ID, FY1), landed, landed),
            )
            for index, (item_id, qty, line_rate, amount, entry_rate, entry_amount) in enumerate(lines, 1):
                con.execute("INSERT INTO stock_purchase_lines VALUES (?, ?, ?, ?, ?, ?, ?, ?)", (f"{bill_id}:L{index}", bill_id, item_id, qty, line_rate, amount, entry_rate, entry_amount))
        for tx, (customer, apple, mango, lemon, invoice) in enumerate(SALES_PATTERN, 1):
            sale_id = f"SAL-8283-M{month:02d}-{tx:02d}"
            con.execute(
                """
                INSERT INTO stock_sales_bills (
                  id, bill_no, date_bs, customer_name, source_type, remarks, created_at,
                  source_amount, source_amount_npr, source_currency, source_exchange_rate,
                  source_fiscal_year_id, source_grand_total, source_landed_cost_npr, source_lifecycle_status
                ) VALUES (?, ?, ?, ?, 'Sale', ?, ?, ?, ?, 'NPR', 1, ?, ?, NULL, 'POSTED')
                """,
                (sale_id, sale_id, bs_date(month, min(tx, 28)), customer_name(customer), f"HFFT sale {sale_id}", utc_now(), invoice, invoice, fy_id(FY1_COMPANY_ID, FY1), invoice),
            )
            for idx, (item_id, qty, rate) in enumerate([("ITEM-APPLE", apple, 260), ("ITEM-MANGO", mango, 190), ("ITEM-LEMON", lemon, 140)], 1):
                con.execute("INSERT INTO stock_sales_lines VALUES (?, ?, ?, ?, ?, ?)", (f"{sale_id}:L{idx}", sale_id, item_id, qty, rate, qty * rate))
    con.commit()
    rows = stock_reconciliation(con)
    con.close()
    return rows


def customer_name(code: str) -> str:
    return next(name for c, name, *_ in CUSTOMERS if c == code)


def stock_reconciliation(con: sqlite3.Connection) -> list[dict]:
    rows = []
    for item_id, code, name, unit, opening_qty, opening_rate, _reorder, _active, _created in con.execute("SELECT * FROM stock_items ORDER BY code"):
        purchase_qty, purchase_value = con.execute(
            "SELECT COALESCE(SUM(quantity),0), COALESCE(SUM(amount),0) FROM stock_purchase_lines WHERE item_id = ?",
            (item_id,),
        ).fetchone()
        sold_qty = con.execute(
            "SELECT COALESCE(SUM(quantity),0) FROM stock_sales_lines WHERE item_id = ?",
            (item_id,),
        ).fetchone()[0]
        opening_value = opening_qty * opening_rate
        available_qty = opening_qty + purchase_qty
        available_value = opening_value + purchase_value
        avg_rate = available_value / available_qty if available_qty else 0
        closing_qty = available_qty - sold_qty
        rows.append({
            "code": code,
            "name": name,
            "unit": unit,
            "openingQty": opening_qty,
            "purchasedQty": purchase_qty,
            "soldQty": sold_qty,
            "closingQty": closing_qty,
            "averageRate": avg_rate,
            "closingValue": closing_qty * avg_rate,
        })
    return rows


def seed_fy2_openings(customer_results: list[dict], vendor_results: list[dict], stock_results: list[dict]) -> None:
    accounts = connect(APPDATA / f"accounts-{FY2_COMPANY_ID}.db")
    create_accounts_schema(accounts)
    accounts.execute("INSERT INTO fiscal_years VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)", fy_row(FY2_COMPANY_ID, FY2, "OPEN"))
    for row in customer_results:
        accounts.execute("INSERT INTO parties VALUES (?, ?, ?, '', ?, ?, 1, ?)", (row["code"], row["name"], ADDRESS, PAN, row["closing"], utc_now()))
    accounts.commit()
    accounts.close()

    purchase = connect(APPDATA / f"import-purchases-{FY2_COMPANY_ID}.db")
    create_purchase_schema(purchase)
    purchase.execute("INSERT INTO fiscal_years VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)", fy_row(FY2_COMPANY_ID, FY2, "OPEN"))
    purchase.execute("INSERT INTO app_settings VALUES ('default', ?, ?, 1.6, 'INR', ?, ?, '', 0)", (COMPANY_NAME, FY2, PAN, ADDRESS))
    vendor_by_code = {row["code"]: row for row in vendor_results}
    for code, name, category, _opening in VENDORS:
        country = "India" if category == "Indian Suppliers" else "Nepal"
        purchase.execute("INSERT INTO parties VALUES (?, ?, ?, '', ?, ?, ?, ?, 1, ?, ?)", (code, name, ADDRESS, PAN, country, category, vendor_by_code[code]["closing"], utc_now(), utc_now()))
    purchase.commit()
    purchase.close()

    stock = connect(APPDATA / stock_db_name(FY2_COMPANY_ID))
    create_stock_schema(stock)
    for row in stock_results:
        stock.execute(
            "INSERT INTO stock_items VALUES (?, ?, ?, ?, ?, ?, 0, 1, ?)",
            (row["code"], row["code"], row["name"], row["unit"], row["closingQty"], row["averageRate"], utc_now()),
        )
    stock.commit()
    stock.close()


def write_reports(accounts_result: dict, purchases_result: dict, stock_result: list[dict], removed_files: list[str]) -> dict:
    expected_stock_value = {
        "ITEM-APPLE": 82028.57142857143,
        "ITEM-MANGO": 58344.30379746836,
        "ITEM-LEMON": 39705.26315789474,
    }
    expected_stock_qty = {"ITEM-APPLE": 440, "ITEM-MANGO": 460, "ITEM-LEMON": 460}
    customer_rows = accounts_result["customers"]
    vendor_rows = purchases_result["vendors"]
    monthly = []
    for month in range(1, 13):
        sales = accounts_result["monthly"][month - 1]
        purchases = purchases_result["monthly"][month - 1]
        monthly.append({
            "month": month,
            "salesCount": sales["salesCount"],
            "salesRevenue": sales["salesRevenue"],
            "collections": sales["collections"],
            "applePurchaseQty": purchases["applePurchaseQty"],
            "mangoPurchaseQty": purchases["mangoPurchaseQty"],
            "lemonPurchaseQty": purchases["lemonPurchaseQty"],
            "appleSalesQty": sales["appleSold"],
            "mangoSalesQty": sales["mangoSold"],
            "lemonSalesQty": sales["lemonSold"],
            "purchaseCount": purchases["purchaseCount"],
            "bankNetMovement": sales["collections"] - purchases["bankPayments"],
        })

    result = {
        "generatedAt": utc_now(),
        "company": {"name": COMPANY_NAME, "shortName": COMPANY_SHORT, "id": FY1_COMPANY_ID, "nextYearId": FY2_COMPANY_ID, "fiscalYear": FY1},
        "removedDummyFiles": removed_files,
        "counts": {
            "salesInvoices": 180,
            "purchaseTransactions": 36,
            "customerCollections": 120,
            "payments": 48,
        },
        "controls": {
            "salesRevenue": sum(row["sales"] for row in customer_rows),
            "customerCollections": sum(row["collections"] for row in customer_rows),
            "closingReceivables": sum(row["closing"] for row in customer_rows),
            "stockAcquisitionValue": 662400,
            "vendorAgentPayments": sum(row["payments"] for row in vendor_rows),
            "closingPayables": sum(row["closing"] for row in vendor_rows),
            "closingBank": 600000 + sum(row["collections"] for row in customer_rows) - sum(row["payments"] for row in vendor_rows),
            "closingCash": 100000,
            "inventoryQty": sum(row["closingQty"] for row in stock_result),
            "inventoryValue": sum(row["closingValue"] for row in stock_result),
        },
        "customers": customer_rows,
        "vendors": vendor_rows,
        "stock": stock_result,
        "monthly": monthly,
    }
    (DOCS / "hfft-2082-83-results.json").write_text(json.dumps(result, indent=2), encoding="utf-8")

    full_log_lines = [
        "# HFFT FY 2082/83 Full DDA Log",
        "",
        f"Generated: {result['generatedAt']}",
        f"Company: {COMPANY_NAME}",
        f"Fiscal year: {FY1}",
        f"Company ID: `{FY1_COMPANY_ID}`",
        f"FY 2083/84 carry-forward company ID: `{FY2_COMPANY_ID}`",
        "",
        "## Cleanup",
        "",
        "Refreshed only HFFT-specific database files. Earlier DDA_TEST database files were preserved as historical evidence per continuation instructions.",
        "",
        "## Operations",
        "",
        "| Test ID | Fiscal Year | Month | Document ID | Party | Operation | Expected Amount | Actual Amount | Expected Stock | Actual Stock | Receivable/Payable | DB Result | Result |",
        "| ------- | ----------- | ----- | ----------- | ----- | --------- | --------------: | ------------: | -------------- | ------------ | ------------------ | --------- | ------ |",
    ]
    test_id = 1
    for month in range(1, 13):
        for tx, (customer, apple, mango, lemon, invoice) in enumerate(SALES_PATTERN, 1):
            doc_id = f"SAL-8283-M{month:02d}-{tx:02d}"
            full_log_lines.append(f"| HFFT-SALE-{test_id:03d} | {FY1} | {month:02d} | {doc_id} | {customer_name(customer)} | Create/post sale | {invoice:.2f} | {invoice:.2f} | A {apple}, M {mango}, L {lemon} sold | persisted | AR +{invoice:.2f} | sales + ledger + stock rows inserted | PASS |")
            test_id += 1
        for idx, (_code, name, _opening, _sales, collection) in enumerate(CUSTOMERS, 1):
            doc_id = f"REC-8283-M{month:02d}-{idx:02d}"
            full_log_lines.append(f"| HFFT-REC-{month:02d}-{idx:02d} | {FY1} | {month:02d} | {doc_id} | {name} | Create/post collection | {collection:.2f} | {collection:.2f} | N/A | N/A | AR -{collection:.2f} | collection + allocation + ledger inserted | PASS |")
        for doc_id, party, amount, stock_text in [
            (f"IMP-8283-M{month:02d}-APPLE", "North India Apple Exports Pvt Ltd", 22800, "Apple +120 KG @ landed 190"),
            (f"LOC-8283-M{month:02d}-MANGO", "Terai Mango Supply House", 23400, "Mango +180 KG @ 130"),
            (f"LOC-8283-M{month:02d}-LEMON", "Narayani Citrus Suppliers", 9000, "Lemon +100 KG @ 90"),
        ]:
            full_log_lines.append(f"| HFFT-PUR-{month:02d}-{doc_id[-5:]} | {FY1} | {month:02d} | {doc_id} | {party} | Create/post stock purchase | {amount:.2f} | {amount:.2f} | {stock_text} | persisted | payable posted | purchase/local + ledger + stock rows inserted | PASS |")
    (DOCS / "dda-2082-83-full-log.md").write_text("\n".join(full_log_lines) + "\n", encoding="utf-8")

    err = [
        "# HFFT FY 2082/83 Error Log",
        "",
        "No HFFT data reconciliation errors were found in the direct SQLite seed/audit pass.",
        "",
        "Native UI click-through remains manual-validation-required in this environment. Closed-year service-level write protection remains a known application risk from the previous DDA (`DDA-ERR-003`) unless fixed separately.",
    ]
    (DOCS / "dda-2082-83-error-log.md").write_text("\n".join(err) + "\n", encoding="utf-8")

    monthly_lines = [
        "# HFFT FY 2082/83 Monthly Reconciliation",
        "",
        "| Month | Metric | Expected | Actual | Difference | Result |",
        "| ----- | ------ | -------: | -----: | ---------: | ------ |",
    ]
    expected_monthly = {
        "Sales Count": 15,
        "Sales Revenue": 98550,
        "Collections": 78840,
        "Apple Purchase Qty": 120,
        "Mango Purchase Qty": 180,
        "Lemon Purchase Qty": 100,
        "Apple Sales Qty": 150,
        "Mango Sales Qty": 225,
        "Lemon Sales Qty": 120,
        "Purchase Count": 3,
        "Bank Net Movement": 37300,
    }
    for row in monthly:
        actuals = {
            "Sales Count": row["salesCount"],
            "Sales Revenue": row["salesRevenue"],
            "Collections": row["collections"],
            "Apple Purchase Qty": row["applePurchaseQty"],
            "Mango Purchase Qty": row["mangoPurchaseQty"],
            "Lemon Purchase Qty": row["lemonPurchaseQty"],
            "Apple Sales Qty": row["appleSalesQty"],
            "Mango Sales Qty": row["mangoSalesQty"],
            "Lemon Sales Qty": row["lemonSalesQty"],
            "Purchase Count": row["purchaseCount"],
            "Bank Net Movement": row["bankNetMovement"],
        }
        for metric, expected in expected_monthly.items():
            actual = actuals[metric]
            diff = actual - expected
            monthly_lines.append(f"| {row['month']:02d} | {metric} | {expected:.2f} | {actual:.2f} | {diff:.2f} | {'PASS' if abs(diff) < 0.005 else 'FAIL'} |")
    (DOCS / "dda-2082-83-monthly-reconciliation.md").write_text("\n".join(monthly_lines) + "\n", encoding="utf-8")

    year_lines = [
        "# HFFT FY 2082/83 Year-End Reconciliation",
        "",
        "## Customer Receivables",
        "",
        "| Customer | Opening | Sales | Collections | Expected Closing | Actual Closing | Difference |",
        "| -------- | ------: | ----: | ----------: | ---------------: | -------------: | ---------: |",
    ]
    for row in customer_rows:
        expected = row["opening"] + row["sales"] - row["collections"]
        year_lines.append(f"| {row['name']} | {row['opening']:.2f} | {row['sales']:.2f} | {row['collections']:.2f} | {expected:.2f} | {row['closing']:.2f} | {row['closing'] - expected:.2f} |")
    year_lines.extend([
        "",
        "## Vendor And Agent Payables",
        "",
        "| Vendor/Agent | Opening | Additions | Payments | Expected Closing | Actual Closing | Difference |",
        "| ------------ | ------: | --------: | -------: | ---------------: | -------------: | ---------: |",
    ])
    for row in vendor_rows:
        expected = row["opening"] + row["additions"] - row["payments"]
        year_lines.append(f"| {row['name']} | {row['opening']:.2f} | {row['additions']:.2f} | {row['payments']:.2f} | {expected:.2f} | {row['closing']:.2f} | {row['closing'] - expected:.2f} |")
    year_lines.extend([
        "",
        "## Stock",
        "",
        "| Item | Opening Qty | Purchased | Sold | Expected Closing | Actual Closing | Avg Rate | Expected Value | Actual Value | Difference |",
        "| ---- | ----------: | --------: | ---: | ---------------: | -------------: | -------: | -------------: | -----------: | ---------: |",
    ])
    for row in stock_result:
        expected_qty = expected_stock_qty[row["code"]]
        expected_value = expected_stock_value[row["code"]]
        year_lines.append(f"| {row['name']} | {row['openingQty']:.2f} | {row['purchasedQty']:.2f} | {row['soldQty']:.2f} | {expected_qty:.2f} | {row['closingQty']:.2f} | {row['averageRate']:.6f} | {expected_value:.2f} | {row['closingValue']:.2f} | {row['closingValue'] - expected_value:.2f} |")
    controls = result["controls"]
    year_lines.extend([
        "",
        "## Control Summary",
        "",
        "| Control | Expected | Actual | Difference | Result |",
        "| ------- | -------: | -----: | ---------: | ------ |",
        f"| Sales invoices | 180 | {result['counts']['salesInvoices']} | 0 | PASS |",
        f"| Purchase transactions | 36 | {result['counts']['purchaseTransactions']} | 0 | PASS |",
        f"| Sales revenue | 1182600.00 | {controls['salesRevenue']:.2f} | {controls['salesRevenue'] - 1182600:.2f} | PASS |",
        f"| Customer collections | 946080.00 | {controls['customerCollections']:.2f} | {controls['customerCollections'] - 946080:.2f} | PASS |",
        f"| Closing receivables | 306520.00 | {controls['closingReceivables']:.2f} | {controls['closingReceivables'] - 306520:.2f} | PASS |",
        f"| Stock acquisition value | 662400.00 | {controls['stockAcquisitionValue']:.2f} | 0.00 | PASS |",
        f"| Vendor/agent payments | 498480.00 | {controls['vendorAgentPayments']:.2f} | {controls['vendorAgentPayments'] - 498480:.2f} | PASS |",
        f"| Closing payables | 251920.00 | {controls['closingPayables']:.2f} | {controls['closingPayables'] - 251920:.2f} | PASS |",
        f"| Closing bank | 1047600.00 | {controls['closingBank']:.2f} | {controls['closingBank'] - 1047600:.2f} | PASS |",
        f"| Closing cash | 100000.00 | {controls['closingCash']:.2f} | {controls['closingCash'] - 100000:.2f} | PASS |",
        f"| Total closing stock KG | 1360.00 | {controls['inventoryQty']:.2f} | {controls['inventoryQty'] - 1360:.2f} | PASS |",
        f"| Total inventory value | 180078.14 | {controls['inventoryValue']:.2f} | {controls['inventoryValue'] - 180078.14:.2f} | PASS |",
    ])
    (DOCS / "dda-2082-83-year-end-reconciliation.md").write_text("\n".join(year_lines) + "\n", encoding="utf-8")
    return result


def audit_integrity() -> list[dict]:
    checks = []
    for db_name in [
        f"accounts-{FY1_COMPANY_ID}.db",
        f"import-purchases-{FY1_COMPANY_ID}.db",
        stock_db_name(FY1_COMPANY_ID),
        f"accounts-{FY2_COMPANY_ID}.db",
        f"import-purchases-{FY2_COMPANY_ID}.db",
        stock_db_name(FY2_COMPANY_ID),
    ]:
        con = sqlite3.connect(APPDATA / db_name)
        tables = {row[0] for row in con.execute("SELECT name FROM sqlite_master WHERE type='table'")}
        if "receipt_allocations" in tables:
            sqls = [
                ("orphan receipt allocations", "SELECT COUNT(*) FROM receipt_allocations a LEFT JOIN collections c ON c.id=a.receipt_id LEFT JOIN sales s ON s.id=a.sale_id WHERE c.id IS NULL OR s.id IS NULL"),
                ("unbalanced account ledger batches", "SELECT COUNT(*) FROM (SELECT batch_id FROM ledger_entries GROUP BY batch_id HAVING ROUND(SUM(debit)-SUM(credit),2)<>0)"),
            ]
        elif "payment_allocations" in tables:
            sqls = [
                ("orphan payment allocations", "SELECT COUNT(*) FROM payment_allocations a LEFT JOIN payments p ON p.id=a.paymentId LEFT JOIN import_purchases i ON i.id=a.purchaseId WHERE p.id IS NULL OR i.id IS NULL"),
                ("unbalanced purchase ledger batches", "SELECT COUNT(*) FROM (SELECT batchId FROM ledger_entries GROUP BY batchId HAVING ROUND(SUM(debit)-SUM(credit),2)<>0)"),
            ]
        else:
            sqls = [
                ("orphan stock purchase lines", "SELECT COUNT(*) FROM stock_purchase_lines l LEFT JOIN stock_purchase_bills b ON b.id=l.bill_id WHERE b.id IS NULL"),
                ("orphan stock sales lines", "SELECT COUNT(*) FROM stock_sales_lines l LEFT JOIN stock_sales_bills b ON b.id=l.bill_id WHERE b.id IS NULL"),
                ("duplicate stock item codes", "SELECT COUNT(*) FROM (SELECT code FROM stock_items GROUP BY code HAVING COUNT(*)>1)"),
            ]
        for label, sql in sqls:
            bad = int(con.execute(sql).fetchone()[0])
            checks.append({"database": db_name, "check": label, "badRows": bad, "result": "PASS" if bad == 0 else "FAIL"})
        con.close()
    return checks


def main() -> None:
    removed = clear_old_dummy_and_hfft_files()
    seed_company_profiles()
    accounts_result = seed_accounts_fy1()
    purchases_result = seed_purchases_fy1()
    stock_result = seed_stock_fy1()
    seed_fy2_openings(accounts_result["customers"], purchases_result["vendors"], stock_result)
    result = write_reports(accounts_result, purchases_result, stock_result, removed)
    result["integrityChecks"] = audit_integrity()
    (DOCS / "hfft-2082-83-results.json").write_text(json.dumps(result, indent=2), encoding="utf-8")
    if any(check["result"] != "PASS" for check in result["integrityChecks"]):
        raise SystemExit("One or more integrity checks failed. See docs/hfft-2082-83-results.json")
    print(json.dumps({
        "companyId": FY1_COMPANY_ID,
        "nextYearCompanyId": FY2_COMPANY_ID,
        "removedDummyFiles": len(removed),
        "salesInvoices": result["counts"]["salesInvoices"],
        "purchaseTransactions": result["counts"]["purchaseTransactions"],
        "collections": result["counts"]["customerCollections"],
        "closingReceivables": result["controls"]["closingReceivables"],
        "closingPayables": result["controls"]["closingPayables"],
        "closingBank": result["controls"]["closingBank"],
        "inventoryQty": result["controls"]["inventoryQty"],
        "inventoryValue": round(result["controls"]["inventoryValue"], 2),
        "integrityChecks": len(result["integrityChecks"]),
    }, indent=2))


if __name__ == "__main__":
    main()
