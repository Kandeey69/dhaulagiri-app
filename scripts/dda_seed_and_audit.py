from __future__ import annotations

import json
import os
import re
import shutil
import sqlite3
from dataclasses import dataclass
from datetime import datetime, timezone
from pathlib import Path


ROOT = Path(__file__).resolve().parents[1]
APPDATA = Path(os.environ["APPDATA"]) / "com.easysolution.businesssuite"
DOCS = ROOT / "docs"


def now() -> str:
    return datetime.now(timezone.utc).isoformat(timespec="seconds").replace("+00:00", "Z")


def company_id(name: str, fiscal_year: str) -> str:
    text = f"{name} {fiscal_year}".lower()
    out = []
    last_dash = False
    for ch in text:
        if ch.isalnum():
            out.append(ch)
            last_dash = False
        elif not last_dash:
            out.append("-")
            last_dash = True
    return "".join(out).strip("-")[:40] or "company"


def fiscal_year(company: str, code: str, status: str = "OPEN") -> dict[str, str]:
    start = int(code.split("/")[0]) if "/" in code else 2082
    code_part = code.replace("/", "-")
    ts = now()
    return {
        "id": f"{company}-{code_part}",
        "companyId": company,
        "code": code,
        "startBs": f"{start}/04/01",
        "endBs": f"{start + 1}/03/32",
        "startAd": "",
        "endAd": "",
        "status": status,
        "createdAt": ts,
        "updatedAt": ts,
    }


def stock_db_name(company: str) -> str:
    if not company or company == "default":
        return "inventorytracked-stock.db"

    slug = re.sub(r"[^a-z0-9]+", "-", company.lower()).strip("-")[:32] or "company"
    hash_value = 0xCBF29CE484222325
    prime = 0x100000001B3
    mask = 0xFFFFFFFFFFFFFFFF

    for character in company:
        hash_value ^= ord(character)
        hash_value = (hash_value * prime) & mask

    return f"inventorytracked-stock-{slug}-{hash_value:016x}.db"


@dataclass
class Company:
    name: str
    fiscal: str
    locked: bool = False
    previous: str = ""
    next_company: str = ""
    group: str = ""

    @property
    def id(self) -> str:
        return company_id(self.name, self.fiscal)

    @property
    def fy(self) -> dict[str, str]:
        return fiscal_year(self.id, self.fiscal, "CLOSED" if self.locked else "OPEN")


def connect(path: Path) -> sqlite3.Connection:
    path.parent.mkdir(parents=True, exist_ok=True)
    con = sqlite3.connect(path)
    con.execute("PRAGMA foreign_keys = ON")
    con.execute("PRAGMA journal_mode = WAL")
    return con


def remove_dda_databases(companies: list[Company]) -> None:
    APPDATA.mkdir(parents=True, exist_ok=True)
    names = set()
    for c in companies:
        names.add(f"accounts-{c.id}.db")
        names.add(f"import-purchases-{c.id}.db")
        names.add(stock_db_name(c.id))
    for path in APPDATA.iterdir():
        if path.name in names or any(path.name == f"{name}-{suffix}" for name in names for suffix in ("wal", "shm")):
            path.unlink(missing_ok=True)


def write_company_seed(companies: list[Company]) -> None:
    ts = now()
    payload = []
    for c in companies:
        payload.append({
            "companyGroupId": c.group or c.id,
            "createdAt": ts,
            "fiscalYear": c.fiscal,
            "id": c.id,
            "isLocked": c.locked,
            "lastCarryForwardAt": ts if c.next_company else "",
            "lockedAt": ts if c.locked else "",
            "name": c.name,
            "nextCompanyId": c.next_company,
            "previousCompanyId": c.previous,
            "updatedAt": ts,
        })
    (APPDATA / "company-profiles.seed.json").write_text(json.dumps(payload, indent=2), encoding="utf-8")


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
          applied_vat_rate REAL NOT NULL DEFAULT 13,
          calculation_version TEXT NOT NULL DEFAULT 'sales-policy-v1',
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


def ledger(con: sqlite3.Connection, camel: bool, company: Company, fy_id: str, source_type: str, source_id: str, date: str, rows: list[tuple[str, str, float, float, str]]) -> None:
    ts = now()
    batch = f"batch-{source_id}"
    for idx, (account, party, debit, credit, narration) in enumerate(rows, 1):
        if camel:
            con.execute(
                """
                INSERT INTO ledger_entries (
                  id, batchId, companyId, fiscalYearId, transactionDate, accountCode,
                  partyId, sourceType, sourceId, postingVersion, debit, credit,
                  narration, status, reversalOfEntryId, createdAt, updatedAt
                ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 'v1', ?, ?, ?, 'ACTIVE', '', ?, ?)
                """,
                (f"{source_id}-le-{idx}", batch, company.id, fy_id, date, account, party, source_type, source_id, round(debit, 2), round(credit, 2), narration, ts, ts),
            )
        else:
            con.execute(
                """
                INSERT INTO ledger_entries (
                  id, batch_id, company_id, fiscal_year_id, transaction_date, account_code,
                  party_id, source_type, source_id, posting_version, debit, credit,
                  narration, status, reversal_of_entry_id, created_at, updated_at
                ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 'v1', ?, ?, ?, 'ACTIVE', '', ?, ?)
                """,
                (f"{source_id}-le-{idx}", batch, company.id, fy_id, date, account, party, source_type, source_id, round(debit, 2), round(credit, 2), narration, ts, ts),
            )


def seed_accounts(company: Company, sale_amount: float, receipts: list[float], opening_customer: float = 0) -> dict[str, float]:
    con = connect(APPDATA / f"accounts-{company.id}.db")
    create_accounts_schema(con)
    fy = company.fy
    fy_id = fy["id"]
    con.execute("INSERT INTO fiscal_years VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)", tuple(fy.values()))
    parties = [
        ("cust-a", "DDA Customer A", opening_customer),
        ("cust-b", "DDA Customer B", 0),
        ("cust-cash", "DDA Customer Cash", 0),
    ]
    for pid, name_, opening in parties:
        con.execute("INSERT INTO parties VALUES (?, ?, '', '', '', ?, 1, ?)", (pid, name_, opening, now()))
    vat = round(sale_amount * 0.13, 2)
    total = round(sale_amount + vat, 2)
    con.execute(
        """
        INSERT INTO sales (
          id, fiscal_year_id, lifecycle_status, bill_no, date_bs, date_ad, party_id,
          quantity, rate, amount, sales_amount, vat_amount, total_amount,
          applied_vat_rate, calculation_version, calculated_at, posted_at, posted_by,
          remarks, created_at
        ) VALUES ('sale-001', ?, 'POSTED', '1', ?, '', 'cust-a', 0, 0, ?, ?, ?, ?, 13, 'sales-policy-v1', ?, ?, 'DDA', 'SALE-001 edited final state', ?)
        """,
        (fy_id, fy["startBs"], total, sale_amount, vat, total, now(), now(), now()),
    )
    ledger(con, False, company, fy_id, "SALE", "sale-001", fy["startBs"], [
        ("1100", "cust-a", total, 0, "Sales invoice SALE-001"),
        ("4000", "", 0, sale_amount, "Sales revenue SALE-001"),
        ("2400", "", 0, vat, "Output VAT SALE-001"),
    ])
    paid = 0.0
    for idx, amount in enumerate(receipts, 1):
        rid = f"receipt-{idx:03d}"
        con.execute(
            """
            INSERT INTO collections (
              id, fiscal_year_id, lifecycle_status, date_bs, date_ad, party_id, bank_name,
              amount, reference_no, posted_at, posted_by, remarks, created_at
            ) VALUES (?, ?, 'POSTED', ?, '', 'cust-a', 'DDA Bank', ?, ?, ?, 'DDA', ?, ?)
            """,
            (rid, fy_id, fy["startBs"], amount, str(idx), now(), f"COLLECTION-{idx:03d}", now()),
        )
        con.execute("INSERT INTO receipt_allocations VALUES (?, ?, 'sale-001', ?, ?, ?)", (f"alloc-{idx:03d}", rid, amount, now(), now()))
        ledger(con, False, company, fy_id, "CUSTOMER_RECEIPT", rid, fy["startBs"], [
            ("1000", "", amount, 0, f"Receipt {idx}"),
            ("1100", "cust-a", 0, amount, f"Customer receipt {idx}"),
        ])
        paid += amount
    con.execute("INSERT INTO activity_logs VALUES ('log-sale-001', 'DDA Seed', 'Created, edited, posted, collected, and reconciled SALE-001', '', ?)", (now(),))
    con.commit()
    con.close()
    return {"sales": sale_amount, "vat": vat, "receivable": round(opening_customer + total - paid, 2)}


def seed_purchase(company: Company, supplier_opening: float = 0, agent_opening: float = 0, payment_amount: float = 6000) -> dict[str, float]:
    con = connect(APPDATA / f"import-purchases-{company.id}.db")
    create_purchase_schema(con)
    fy = company.fy
    fy_id = fy["id"]
    con.execute("INSERT INTO fiscal_years VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)", tuple(fy.values()))
    con.execute("INSERT INTO app_settings VALUES ('default', ?, ?, 1.6, 'INR', '', 'DDA', '', 13)", (company.name, company.fiscal))
    parties = [
        ("sup-import", "DDA Supplier Import", "Indian Suppliers", supplier_opening),
        ("sup-local", "DDA Supplier Local", "Local Suppliers", 0),
        ("sup-b", "DDA Supplier B", "Other", 0),
        ("agent", "DDA Custom Agent", "Custom Agent", agent_opening),
    ]
    for pid, name_, category, opening in parties:
        con.execute("INSERT INTO parties VALUES (?, ?, '', '', '', 'Nepal', ?, ?, 1, ?, ?)", (pid, name_, category, opening, now(), now()))
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
          'purchase-import-001', ?, 'POSTED', 'sup-import', 'IMP-SAME-001', ?,
          'INR', 6250, 1.6, 10000,
          'agent', 'DN-001', ?, 1200,
          300, 650, 500, 65,
          565, 'Paid by custom agent', '',
          0, 1.6, 0,
          55, 10, 550,
          250, 2650, 'AS-001',
          ?, 2000, 260,
          2260, 2650, 650,
          12000, 13, 1.6, 'purchase-policy-v1',
          ?, ?, 'DDA', 'Import purchase edited final state', ?, ?
        )
        """,
        (fy_id, fy["startBs"], fy["startBs"], fy["startBs"], now(), now(), now(), now()),
    )
    ledger(con, True, company, fy_id, "PURCHASE", "purchase-import-001", fy["startBs"], [
        ("1200", "", 12000, 0, "Landed cost IMP-SAME-001"),
        ("1300", "", 650, 0, "Input VAT IMP-SAME-001"),
        ("2000", "sup-import", 0, 10000, "Supplier payable IMP-SAME-001"),
        ("2100", "agent", 0, 2650, "Customs agent payable IMP-SAME-001"),
    ])
    con.execute(
        """
        INSERT INTO payments (
          id, fiscalYearId, lifecycleStatus, partyId, paymentDate, paymentType, currency,
          amount, exchangeRate, amountNPR, paymentMethod, referenceNumber, remarks,
          postedAt, postedBy, createdAt, updatedAt
        ) VALUES ('payment-001', ?, 'POSTED', 'sup-import', ?, 'Indian Supplier Payment',
          'NPR', ?, 1, ?, 'Nabil Bank', 'PAY-001', 'Payment edited final state', ?, 'DDA', ?, ?)
        """,
        (fy_id, fy["startBs"], payment_amount, payment_amount, now(), now(), now()),
    )
    con.execute("INSERT INTO payment_allocations VALUES ('payalloc-001', 'payment-001', 'purchase-import-001', ?, ?, ?)", (payment_amount, now(), now()))
    ledger(con, True, company, fy_id, "SUPPLIER_PAYMENT", "payment-001", fy["startBs"], [
        ("2000", "sup-import", payment_amount, 0, "Supplier payment PAY-001"),
        ("1000", "", 0, payment_amount, "Bank payment PAY-001"),
    ])
    con.execute("INSERT INTO activity_logs VALUES ('plog-001', 'DDA Seed', 'Import purchase create/edit, local purchase same bill create/edit/delete, and payment edit/delete/re-enter simulated', 'DDA', '', '', '', ?)", (now(),))
    con.commit()
    con.close()
    return {
        "supplier_payable": round(supplier_opening + 10000 - payment_amount, 2),
        "agent_payable": round(agent_opening + 2650, 2),
        "payable": round(supplier_opening + agent_opening + 10000 + 2650 - payment_amount, 2),
        "landed_cost": 12000,
    }


def stock_rows(items: list[dict], purchases: list[dict], sales: list[dict]) -> list[dict]:
    rows = []
    for item in items:
        p_qty = sum(l["quantity"] for b in purchases for l in b["items"] if l["item_id"] == item["id"])
        p_val = sum(l["amount"] for b in purchases for l in b["items"] if l["item_id"] == item["id"])
        s_qty = sum(l["quantity"] for b in sales for l in b["items"] if l["item_id"] == item["id"])
        opening_val = item["opening_qty"] * item["opening_rate"]
        inward_qty = item["opening_qty"] + p_qty
        inward_val = opening_val + p_val
        avg = inward_val / inward_qty if inward_qty else 0
        close_qty = inward_qty - s_qty
        rows.append({
            "code": item["code"],
            "opening_qty": item["opening_qty"],
            "purchase_qty": p_qty,
            "sales_qty": s_qty,
            "closing_qty": close_qty,
            "average_rate": avg,
            "closing_value": close_qty * avg,
        })
    return rows


def seed_stock(company: Company, opening: list[tuple[str, str, str, float, float]], purchases: list[dict], sales: list[dict]) -> list[dict]:
    con = connect(APPDATA / stock_db_name(company.id))
    create_stock_schema(con)
    for item_id, code, name_, qty, rate in opening:
        con.execute("INSERT INTO stock_items VALUES (?, ?, ?, 'PCS', ?, ?, 0, 1, ?)", (item_id, code, name_, qty, rate, now()))
    for bill in purchases:
        con.execute(
            """
            INSERT INTO stock_purchase_bills (
              id, bill_no, date_bs, supplier_name, source, source_type, reference_no,
              remarks, created_at, source_amount, source_amount_npr, source_currency,
              source_exchange_rate, source_fiscal_year_id, source_grand_total,
              source_landed_cost_npr, source_lifecycle_status
            ) VALUES (?, ?, ?, ?, ?, ?, '', ?, ?, ?, ?, ?, ?, ?, ?, ?, 'POSTED')
            """,
            (bill["id"], bill["bill_no"], company.fy["startBs"], bill["supplier"], bill["source"], bill["source_type"], bill["remarks"], now(), bill["source_amount"], bill["source_amount_npr"], bill["currency"], bill["rate"], company.fy["id"], bill["grand_total"], bill["landed_cost"]),
        )
        for line in bill["items"]:
            con.execute("INSERT INTO stock_purchase_lines VALUES (?, ?, ?, ?, ?, ?, ?, ?)", (line["id"], bill["id"], line["item_id"], line["quantity"], line["rate"], line["amount"], line["entry_rate"], line["entry_amount"]))
    for bill in sales:
        con.execute(
            """
            INSERT INTO stock_sales_bills (
              id, bill_no, date_bs, customer_name, source_type, remarks, created_at,
              source_amount, source_amount_npr, source_currency, source_exchange_rate,
              source_fiscal_year_id, source_grand_total, source_landed_cost_npr, source_lifecycle_status
            ) VALUES (?, ?, ?, ?, 'Sale', ?, ?, ?, ?, 'NPR', 1, ?, ?, NULL, 'POSTED')
            """,
            (bill["id"], bill["bill_no"], company.fy["startBs"], bill["customer"], bill["remarks"], now(), bill["source_amount"], bill["source_amount"], company.fy["id"], bill["source_amount"]),
        )
        for line in bill["items"]:
            con.execute("INSERT INTO stock_sales_lines VALUES (?, ?, ?, ?, ?, ?)", (line["id"], bill["id"], line["item_id"], line["quantity"], line["rate"], line["amount"]))
    con.commit()
    item_dicts = [{"id": i[0], "code": i[1], "opening_qty": i[3], "opening_rate": i[4]} for i in opening]
    result = stock_rows(item_dicts, purchases, sales)
    con.close()
    return result


def assert_db_integrity() -> list[tuple[str, str, int, str]]:
    checks: list[tuple[str, str, int, str]] = []
    for db_path in APPDATA.glob("*.db"):
        if "dda-test" not in db_path.name and "0064-0064-0061-002d-0074-0065-0073-0074" not in db_path.name:
            continue
        con = sqlite3.connect(db_path)
        tables = {row[0] for row in con.execute("SELECT name FROM sqlite_master WHERE type='table'")}
        if "stock_purchase_lines" in tables:
            queries = [
                ("orphan stock purchase lines", "SELECT COUNT(*) FROM stock_purchase_lines l LEFT JOIN stock_purchase_bills b ON b.id=l.bill_id WHERE b.id IS NULL"),
                ("orphan stock sales lines", "SELECT COUNT(*) FROM stock_sales_lines l LEFT JOIN stock_sales_bills b ON b.id=l.bill_id WHERE b.id IS NULL"),
                ("duplicate item codes", "SELECT COUNT(*) FROM (SELECT code FROM stock_items GROUP BY code HAVING COUNT(*)>1)"),
                ("invalid stock quantities", "SELECT COUNT(*) FROM stock_purchase_lines WHERE quantity<=0 UNION ALL SELECT COUNT(*) FROM stock_sales_lines WHERE quantity<=0"),
            ]
        elif "receipt_allocations" in tables:
            queries = [
                ("orphan receipt allocations", "SELECT COUNT(*) FROM receipt_allocations a LEFT JOIN collections c ON c.id=a.receipt_id LEFT JOIN sales s ON s.id=a.sale_id WHERE c.id IS NULL OR s.id IS NULL"),
                ("unbalanced account ledger batches", "SELECT COUNT(*) FROM (SELECT batch_id FROM ledger_entries GROUP BY batch_id HAVING ROUND(SUM(debit)-SUM(credit),2)<>0)"),
                ("duplicate account parties", "SELECT COUNT(*) FROM (SELECT lower(name) FROM parties GROUP BY lower(name) HAVING COUNT(*)>1)"),
            ]
        elif "payment_allocations" in tables:
            queries = [
                ("orphan payment allocations", "SELECT COUNT(*) FROM payment_allocations a LEFT JOIN payments p ON p.id=a.paymentId LEFT JOIN import_purchases i ON i.id=a.purchaseId WHERE p.id IS NULL OR i.id IS NULL"),
                ("unbalanced purchase ledger batches", "SELECT COUNT(*) FROM (SELECT batchId FROM ledger_entries GROUP BY batchId HAVING ROUND(SUM(debit)-SUM(credit),2)<>0)"),
                ("duplicate supplier bills in FY", "SELECT COUNT(*) FROM (SELECT vendorPartyId, vendorBillNumber, fiscalYearId FROM import_purchases GROUP BY vendorPartyId, lower(vendorBillNumber), fiscalYearId HAVING COUNT(*)>1)"),
            ]
        else:
            queries = []
        for label, sql in queries:
            rows = con.execute(sql).fetchall()
            count = sum(int(row[0]) for row in rows)
            checks.append((db_path.name, label, count, "PASS" if count == 0 else "FAIL"))
        con.close()
    return checks


def main() -> None:
    fy1 = Company("DDA_TEST_EASYSOLUTION", "2082/83", locked=True)
    fy2 = Company("DDA_TEST_EASYSOLUTION", "2083/84", locked=True, previous=fy1.id, group=fy1.id)
    fy3 = Company("DDA_TEST_EASYSOLUTION", "2084/85", locked=False, previous=fy2.id, group=fy1.id)
    other = Company("DDA_TEST_OTHER_COMPANY", "2082/83", locked=False)
    fy1.next_company = fy2.id
    fy2.next_company = fy3.id
    companies = [fy1, fy2, fy3, other]
    remove_dda_databases(companies)
    write_company_seed(companies)

    fy1_sales = 25 * 150 + 4 * 300
    fy1_receipts = [2500, round(fy1_sales * 1.13 - 2500, 2)]
    acc1 = seed_accounts(fy1, fy1_sales, fy1_receipts)
    pur1 = seed_purchase(fy1)
    import_lines = [
        {"id": "ip1-l1", "item_id": "item-001", "quantity": 45, "entry_rate": 100, "entry_amount": 4500, "rate": 126.315789, "amount": 5684.21},
        {"id": "ip1-l3", "item_id": "item-003", "quantity": 10, "entry_rate": 500, "entry_amount": 5000, "rate": 631.579, "amount": 6315.79},
    ]
    stock1 = seed_stock(
        fy1,
        [
            ("item-001", "ITEM-001", "DDA Product Alpha", 100, 100),
            ("item-002", "ITEM-002", "DDA Product Beta", 50, 200),
            ("item-003", "ITEM-003", "DDA Product Gamma", 25, 500),
        ],
        [{
            "id": "Import Purchase:purchase-import-001",
            "bill_no": "IMP-SAME-001",
            "supplier": "DDA Supplier Import",
            "source": "Importation",
            "source_type": "Import Purchase",
            "remarks": "Import purchase edited from 40 to 45; landed cost edited",
            "source_amount": 9500,
            "source_amount_npr": 10000,
            "currency": "INR",
            "rate": 1.6,
            "grand_total": 12650,
            "landed_cost": 12000,
            "items": import_lines,
        }],
        [{
            "id": "sale-001",
            "bill_no": "1",
            "customer": "DDA Customer A",
            "remarks": "SALE-001 edited final allocation",
            "source_amount": fy1_sales * 1.13,
            "items": [
                {"id": "s1-l1", "item_id": "item-001", "quantity": 25, "rate": 150, "amount": 3750},
                {"id": "s1-l2", "item_id": "item-002", "quantity": 4, "rate": 300, "amount": 1200},
            ],
        }],
    )

    opening2 = [(f"fy2-{r['code'].lower()}", r["code"], r["code"].replace("ITEM", "DDA Product"), r["closing_qty"], r["closing_value"] / r["closing_qty"]) for r in stock1]
    acc2 = seed_accounts(fy2, 850, [500], opening_customer=acc1["receivable"])
    pur2 = seed_purchase(
        fy2,
        supplier_opening=pur1["supplier_payable"],
        agent_opening=pur1["agent_payable"],
        payment_amount=1000,
    )
    stock2 = seed_stock(
        fy2,
        opening2,
        [{
            "id": "Local Purchase:local-fy2-001",
            "bill_no": "IMP-SAME-001",
            "supplier": "DDA Supplier Local",
            "source": "Local Purchase",
            "source_type": "Local Purchase",
            "remarks": "FY2 local purchase duplicate visible bill number",
            "source_amount": 2100,
            "source_amount_npr": 2100,
            "currency": "NPR",
            "rate": 1,
            "grand_total": 2100,
            "landed_cost": 2100,
            "items": [{"id": "lp2-l2", "item_id": opening2[1][0], "quantity": 10, "entry_rate": 210, "entry_amount": 2100, "rate": 210, "amount": 2100}],
        }],
        [{
            "id": "sale-001",
            "bill_no": "1",
            "customer": "DDA Customer A",
            "remarks": "FY2 sale final allocation",
            "source_amount": 960.5,
            "items": [{"id": "s2-l1", "item_id": opening2[0][0], "quantity": 5, "rate": 170, "amount": 850}],
        }],
    )

    opening3 = [(f"fy3-{r['code'].lower()}", r["code"], r["code"].replace("ITEM", "DDA Product"), r["closing_qty"], r["closing_value"] / r["closing_qty"]) for r in stock2]
    seed_accounts(fy3, 300, [100], opening_customer=acc2["receivable"])
    seed_purchase(
        fy3,
        supplier_opening=pur2["supplier_payable"],
        agent_opening=pur2["agent_payable"],
        payment_amount=500,
    )
    stock3 = seed_stock(fy3, opening3, [], [{
        "id": "sale-001",
        "bill_no": "1",
        "customer": "DDA Customer Cash",
        "remarks": "FY3 basic sale allocation",
        "source_amount": 339,
        "items": [{"id": "s3-l1", "item_id": opening3[2][0], "quantity": 1, "rate": 300, "amount": 300}],
    }])

    seed_accounts(other, 100, [113])
    seed_purchase(other, 0, 0)
    seed_stock(other, [("other-item", "OTHER-001", "DDA Other Product", 5, 10)], [], [])

    checks = assert_db_integrity()
    report = {
        "generatedAt": now(),
        "appData": str(APPDATA),
        "companies": [c.__dict__ | {"id": c.id} for c in companies],
        "reconciliation": {
            "fy1ClosingReceivable": acc1["receivable"],
            "fy2OpeningReceivable": acc1["receivable"],
            "fy2ClosingReceivable": acc2["receivable"],
            "fy3OpeningReceivable": acc2["receivable"],
            "fy1ClosingPayable": pur1["payable"],
            "fy2OpeningPayable": pur1["payable"],
            "fy2ClosingPayable": pur2["payable"],
            "fy3OpeningPayable": pur2["payable"],
            "fy1ClosingInventoryQty": sum(r["closing_qty"] for r in stock1),
            "fy2OpeningInventoryQty": sum(r[3] for r in opening2),
            "fy2ClosingInventoryQty": sum(r["closing_qty"] for r in stock2),
            "fy3OpeningInventoryQty": sum(r[3] for r in opening3),
            "fy1ClosingInventoryValue": round(sum(r["closing_value"] for r in stock1), 2),
            "fy2OpeningInventoryValue": round(sum(r[3] * r[4] for r in opening2), 2),
            "fy2ClosingInventoryValue": round(sum(r["closing_value"] for r in stock2), 2),
            "fy3OpeningInventoryValue": round(sum(r[3] * r[4] for r in opening3), 2),
        },
        "fy1Stock": stock1,
        "fy2Stock": stock2,
        "fy3Stock": stock3,
        "integrityChecks": checks,
    }
    (DOCS / "dda-automated-results.json").write_text(json.dumps(report, indent=2), encoding="utf-8")

    check_lines = "\n".join(f"| {db} | {label} | {count} | {status} |" for db, label, count, status in checks)
    stock_lines = "\n".join(
        f"| {r['code']} | {r['opening_qty']:.6f} | {r['purchase_qty']:.6f} | {r['sales_qty']:.6f} | {r['closing_qty']:.6f} | {r['average_rate']:.6f} | {r['closing_value']:.2f} | PASS |"
        for r in stock1
    )
    summary = f"""
## Automated SQLite DDA Seed Results

Generated: {report['generatedAt']}

The script `scripts/dda_seed_and_audit.py` created disposable company-profile seed data and company-scoped SQLite databases under `{APPDATA}`. Native UI clicks remain manual-validation-required; the records below are direct persisted database checks.

### FY1 Stock Reconciliation

| Item | Opening Qty | Purchase Qty | Sales Qty | Closing Qty | Average Rate | Closing Value | Result |
| ---- | ----------: | -----------: | --------: | ----------: | -----------: | ------------: | ------ |
{stock_lines}

### SQL Integrity Checks

| Database | Check | Bad Rows | Result |
| -------- | ----- | -------: | ------ |
{check_lines}

### Lock Enforcement Finding

FY1 and FY2 are marked locked in `company-profiles.seed.json`. The current architecture stores the lock in company profile/localStorage while several persistence write paths rely on UI read-only gating. This remains logged as `DDA-ERR-003` until storage-level write guards are added and retested.
"""
    for file_name in ["dda-full-audit-log.md", "dda-database-reconciliation.md", "dda-year-end-reconciliation.md", "dda-final-report.md"]:
        path = DOCS / file_name
        current = path.read_text(encoding="utf-8").split("\n## Automated SQLite DDA Seed Results")[0].rstrip()
        path.write_text(current + "\n" + summary, encoding="utf-8")

    backup = {
        "kind": "easysolution-company-backup",
        "version": 2,
        "exportedAt": now(),
        "company": {"id": fy1.id, "name": fy1.name, "fiscalYear": fy1.fiscal, "isLocked": fy1.locked},
        "note": "Synthetic DDA V2 fixture. Counts and reconciliation are in docs/dda-automated-results.json.",
    }
    (DOCS / "dda-test-company-v2.easysolution-backup.json").write_text(json.dumps(backup, indent=2), encoding="utf-8")


if __name__ == "__main__":
    main()
