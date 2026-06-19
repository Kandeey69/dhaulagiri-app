import { useEffect, useState } from "react";
import type { FormEvent } from "react";
import AccountsApp from "./accounts/App";
import { getCreditNotes, getParties, getSales } from "./accounts/data/storage";
import type { CreditNote, Party as AccountParty, Sale } from "./accounts/data/types";
import { saveBlob } from "./accounts/utils/fileSave";
import { defaultSettings, type AppData, type AppSettings } from "./purchase/domain";
import { createDataRepository } from "./purchase/repository";
import PurchaseApp from "./purchase/App";
import "./App.css";

type UserRole = "account" | "master";
type ModuleKey = "accounts" | "purchase" | "settings" | "maskebari";

const MASTER_PASSWORD = "KANCHAN";
const ACCOUNTS_COMPANY_KEY = "accounts-company-name";
const ACCOUNTS_FISCAL_YEAR_KEY = "accounts-fiscal-year";
const SUITE_SETTING_KEYS = {
  companyName: "suite-company-name",
  fiscalYear: "suite-fiscal-year",
  panVatNo: "suite-pan-vat-no",
  address: "suite-address",
  phone: "suite-phone",
  defaultExchangeRate: "suite-default-exchange-rate",
  agentServiceVatRate: "suite-agent-service-vat-rate",
};

function storageNumber(key: string, fallback: number) {
  const value = Number(localStorage.getItem(key) ?? fallback);
  return Number.isFinite(value) ? value : fallback;
}

function readSuiteSettings(settings: AppSettings = defaultSettings): AppSettings {
  return {
    ...settings,
    companyName:
      localStorage.getItem(ACCOUNTS_COMPANY_KEY) ||
      localStorage.getItem(SUITE_SETTING_KEYS.companyName) ||
      settings.companyName,
    fiscalYear:
      localStorage.getItem(ACCOUNTS_FISCAL_YEAR_KEY) ||
      localStorage.getItem(SUITE_SETTING_KEYS.fiscalYear) ||
      settings.fiscalYear,
    panVatNo: localStorage.getItem(SUITE_SETTING_KEYS.panVatNo) || settings.panVatNo,
    address: localStorage.getItem(SUITE_SETTING_KEYS.address) || settings.address,
    phone: localStorage.getItem(SUITE_SETTING_KEYS.phone) || settings.phone,
    defaultExchangeRate: storageNumber(
      SUITE_SETTING_KEYS.defaultExchangeRate,
      settings.defaultExchangeRate,
    ),
    agentServiceVatRate: storageNumber(
      SUITE_SETTING_KEYS.agentServiceVatRate,
      settings.agentServiceVatRate,
    ),
  };
}

function writeSuiteSettings(settings: AppSettings) {
  localStorage.setItem(ACCOUNTS_COMPANY_KEY, settings.companyName);
  localStorage.setItem(ACCOUNTS_FISCAL_YEAR_KEY, settings.fiscalYear);
  localStorage.setItem(SUITE_SETTING_KEYS.companyName, settings.companyName);
  localStorage.setItem(SUITE_SETTING_KEYS.fiscalYear, settings.fiscalYear);
  localStorage.setItem(SUITE_SETTING_KEYS.panVatNo, settings.panVatNo);
  localStorage.setItem(SUITE_SETTING_KEYS.address, settings.address);
  localStorage.setItem(SUITE_SETTING_KEYS.phone, settings.phone);
  localStorage.setItem(
    SUITE_SETTING_KEYS.defaultExchangeRate,
    String(settings.defaultExchangeRate),
  );
  localStorage.setItem(
    SUITE_SETTING_KEYS.agentServiceVatRate,
    String(settings.agentServiceVatRate),
  );
}

export default function App() {
  const [userRole, setUserRole] = useState<UserRole | null>(null);
  const [selectedModule, setSelectedModule] = useState<ModuleKey | null>(null);
  const [masterPassword, setMasterPassword] = useState("");
  const [loginError, setLoginError] = useState("");

  function loginAsAccount() {
    setLoginError("");
    setMasterPassword("");
    setUserRole("account");
    setSelectedModule(null);
  }

  function loginAsMaster(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setLoginError("");

    if (masterPassword !== MASTER_PASSWORD) {
      setLoginError("Master password is incorrect.");
      return;
    }

    setMasterPassword("");
    setUserRole("master");
    setSelectedModule(null);
  }

  function logout() {
    setUserRole(null);
    setSelectedModule(null);
    setMasterPassword("");
    setLoginError("");
  }

  if (!userRole) {
    return (
      <main className="merged-login-page">
        <section className="merged-login-brand">
          <p className="eyebrow">Dhaulagiri</p>
          <h1>Business Suite</h1>
          <p>
            One login for sales and receivables, import purchases, payments,
            payables, VAT, ledgers, and activity logs.
          </p>
          <p className="login-credit">Vibecoded by Kanchan Dahal</p>
        </section>

        <section className="merged-login-card">
          <p className="eyebrow">Secure access</p>
          <h2>Select user</h2>
          <p className="login-note">
            Continue as Account for daily entries, or unlock Master for imports,
            edits, deletes, settings, and audit logs.
          </p>

          {loginError && <p className="status-message">{loginError}</p>}

          <div className="login-actions">
            <button type="button" onClick={loginAsAccount}>
              Continue as Account
            </button>

            <form className="login-form" onSubmit={loginAsMaster}>
              <label>
                Master Password
                <input
                  type="password"
                  value={masterPassword}
                  onChange={(event) => setMasterPassword(event.target.value)}
                />
              </label>
              <button type="submit">Unlock Master</button>
            </form>
          </div>
        </section>
      </main>
    );
  }

  if (!selectedModule) {
    return (
      <main className="module-picker-page">
        <header className="module-picker-header">
          <div>
            <p className="eyebrow">Dhaulagiri Business Suite</p>
            <h1>Select Module</h1>
            <p>
              Logged in as {userRole === "master" ? "Master" : "Account"}.
            </p>
          </div>
          <div className="module-header-actions">
            {userRole === "master" && (
              <button
                type="button"
                className="ghost"
                onClick={() => setSelectedModule("settings")}
              >
                Settings
              </button>
            )}
            <button type="button" className="ghost" onClick={logout}>
              Logout
            </button>
          </div>
        </header>

        <section className="module-grid">
          <button
            type="button"
            className="module-card"
            onClick={() => setSelectedModule("accounts")}
          >
            <span>Sales & Receivables</span>
            <strong>Sales and Collection Module</strong>
            <small>
              Parties, sales entry, collection entry, credit notes, output VAT,
              ledgers, and outstanding reports.
            </small>
          </button>

          <button
            type="button"
            className="module-card"
            onClick={() => setSelectedModule("purchase")}
          >
            <span>Purchase & Payables</span>
            <strong>Purchase and Payment Module</strong>
            <small>
              Import purchases, supplier payments, custom agent payments, local
              purchase expenses, input VAT, payables, and landed cost.
            </small>
          </button>

          <button
            type="button"
            className="module-card"
            onClick={() => setSelectedModule("maskebari")}
          >
            <span>VAT Summary</span>
            <strong>Generate Maskebari</strong>
            <small>
              Select a month and prepare Maskebari, Output VAT, and Input VAT
              PDF reports from existing sales and purchase data.
            </small>
          </button>
        </section>
      </main>
    );
  }

  if (selectedModule === "accounts") {
    return (
      <AccountsApp
        initialUserRole={userRole}
        onBackToModules={() => setSelectedModule(null)}
        onLogout={logout}
      />
    );
  }

  if (selectedModule === "settings") {
    return <SuiteSettings onBack={() => setSelectedModule(null)} onLogout={logout} />;
  }

  if (selectedModule === "maskebari") {
    return <MaskebariGenerator onBack={() => setSelectedModule(null)} onLogout={logout} />;
  }

  return (
    <PurchaseApp
      initialUserRole={userRole === "master" ? "Master" : "Account"}
      onBackToModules={() => setSelectedModule(null)}
      onLogout={logout}
    />
  );
}

type MaskebariGeneratorProps = {
  onBack: () => void;
  onLogout: () => void;
};

type PdfTableRow = string[];

const nepaliMonths = [
  { value: "1", label: "1. Baisakh" },
  { value: "2", label: "2. Jestha" },
  { value: "3", label: "3. Ashadh" },
  { value: "4", label: "4. Shrawan" },
  { value: "5", label: "5. Bhadra" },
  { value: "6", label: "6. Ashwin" },
  { value: "7", label: "7. Kartik" },
  { value: "8", label: "8. Mangsir" },
  { value: "9", label: "9. Poush" },
  { value: "10", label: "10. Magh" },
  { value: "11", label: "11. Falgun" },
  { value: "12", label: "12. Chaitra" },
];

function MaskebariGenerator({ onBack, onLogout }: MaskebariGeneratorProps) {
  const [month, setMonth] = useState("1");
  const [visibleReport, setVisibleReport] = useState<"input" | "output" | "">("");
  const [sales, setSales] = useState<Sale[]>([]);
  const [creditNotes, setCreditNotes] = useState<CreditNote[]>([]);
  const [accountParties, setAccountParties] = useState<AccountParty[]>([]);
  const [purchaseData, setPurchaseData] = useState<AppData | null>(null);
  const [message, setMessage] = useState("");

  useEffect(() => {
    let active = true;

    async function loadData() {
      setMessage("");

      try {
        const [loadedSales, loadedCreditNotes, loadedAccountParties, repository] =
          await Promise.all([getSales(), getCreditNotes(), getParties(), createDataRepository()]);
        const loadedPurchaseData = await repository.loadData();

        if (!active) {
          return;
        }

        setSales(loadedSales);
        setCreditNotes(loadedCreditNotes);
        setAccountParties(loadedAccountParties);
        setPurchaseData(loadedPurchaseData);
      } catch (error) {
        console.error("Maskebari load error:", error);
        if (active) {
          setMessage("Could not load all VAT data. Please reopen the app and try again.");
        }
      }
    }

    loadData();

    return () => {
      active = false;
    };
  }, []);

  const selectedMonth = Number(month);
  const selectedMonthLabel = nepaliMonths[selectedMonth - 1]?.label.replace(/^\d+\.\s*/, "") ?? "-";
  const summary = buildMaskebariSummary({
    accountParties,
    creditNotes,
    month: selectedMonth,
    purchaseData,
    sales,
  });

  return (
    <main className="maskebari-page">
      <header className="module-picker-header suite-settings-header">
        <div>
          <p className="eyebrow">Dhaulagiri Business Suite</p>
          <h1>Generate Maskebari</h1>
          <p>Prepare Maskebari, Output VAT, and Input VAT reports from saved data.</p>
        </div>
        <div className="module-header-actions">
          <button type="button" className="ghost" onClick={onBack}>
            Back to Modules
          </button>
          <button type="button" className="ghost" onClick={onLogout}>
            Logout
          </button>
        </div>
      </header>

      <section className="maskebari-panel">
        <div className="maskebari-form">
          <label>
            Month
            <select value={month} onChange={(event) => setMonth(event.target.value)}>
              {nepaliMonths.map((item) => (
                <option key={item.value} value={item.value}>
                  {item.label}
                </option>
              ))}
            </select>
          </label>

          <div className="maskebari-actions">
            <button
              type="button"
              onClick={() =>
                downloadCombinedVatPdf(`maskebari-vat-${selectedMonthLabel}.pdf`, selectedMonthLabel, summary)
              }
            >
              Download VAT PDF
            </button>
          </div>
        </div>

        <div className="maskebari-summary">
          <div className="card-header">
            <h3>Maskebari Summary - {selectedMonthLabel}</h3>
          </div>
          {message && <p className="status-message">{message}</p>}

          <div className="table-wrap">
            <table className="maskebari-table">
              <thead>
                <tr>
                  <th>Particulars</th>
                  <th>Turnover / Purchase Value</th>
                  <th>Input VAT Credit</th>
                  <th>Output VAT Debit</th>
                </tr>
              </thead>
              <tbody>
                <tr className="section-row"><td colSpan={4}>1. Sales</td></tr>
                <tr><td>1.1 Taxable sales</td><td>{money(summary.taxableSales)}</td><td>-</td><td>{money(summary.salesVatDebit)}</td></tr>
                <tr><td>1.2 Export</td><td>{money(0)}</td><td>-</td><td>-</td></tr>
                <tr><td>1.3 Exempt sales</td><td>{money(0)}</td><td>-</td><td>-</td></tr>
                <tr className="section-row"><td colSpan={4}>2. Purchase / Import</td></tr>
                <tr><td>2.1 Taxable purchase</td><td>{money(summary.taxablePurchase)}</td><td>{money(summary.purchaseVatCredit)}</td><td>-</td></tr>
                <tr><td>2.2 Taxable import purchase</td><td>{money(summary.taxableImport)}</td><td>{money(summary.importVatCredit)}</td><td>-</td></tr>
                <tr><td>2.3 Exempt purchase</td><td>{money(0)}</td><td>-</td><td>-</td></tr>
                <tr><td>2.4 Exempt import</td><td>{money(0)}</td><td>-</td><td>-</td></tr>
                <tr className="section-row"><td colSpan={4}>3. Other</td></tr>
                <tr><td>3.1 Other adjustments</td><td>-</td><td>{money(summary.otherCredit)}</td><td>{money(0)}</td></tr>
                <tr className="total-row"><td>Total</td><td>-</td><td>{money(summary.totalCredit)}</td><td>{money(summary.totalDebit)}</td></tr>
              </tbody>
            </table>
          </div>

          <div className="maskebari-totals">
            <div><span>Net payable / receivable</span><strong>{money(summary.netPayableReceivable)}</strong></div>
          </div>

          <div className="maskebari-report-actions">
            <button
              type="button"
              className={visibleReport === "input" ? "" : "ghost"}
              onClick={() => setVisibleReport((current) => (current === "input" ? "" : "input"))}
            >
              View Input VAT Report
            </button>
            <button
              type="button"
              className={visibleReport === "output" ? "" : "ghost"}
              onClick={() => setVisibleReport((current) => (current === "output" ? "" : "output"))}
            >
              View Output VAT Report
            </button>
          </div>

          {visibleReport === "input" && (
            <ReportPreview
              title="Input VAT Report"
              headers={["Date", "Source", "Party", "Reference", "Taxable Value", "VAT Credit"]}
              rows={summary.inputVatRows}
            />
          )}

          {visibleReport === "output" && (
            <ReportPreview
              title="Output VAT Report"
              headers={["Date", "Party", "Bill / CN", "Taxable Sales", "VAT Debit", "Remarks"]}
              rows={summary.outputVatRows}
            />
          )}
        </div>
      </section>
    </main>
  );
}

function ReportPreview({
  headers,
  rows,
  title,
}: {
  headers: string[];
  rows: PdfTableRow[];
  title: string;
}) {
  return (
    <div className="maskebari-report-preview">
      <h3>{title}</h3>
      <div className="table-wrap">
        <table className="maskebari-table">
          <thead>
            <tr>
              {headers.map((header) => (
                <th key={header}>{header}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {rows.map((row, rowIndex) => (
              <tr key={rowIndex}>
                {headers.map((_, cellIndex) => (
                  <td key={`${rowIndex}-${cellIndex}`}>{row[cellIndex] || "-"}</td>
                ))}
              </tr>
            ))}
            {!rows.length && (
              <tr>
                <td colSpan={headers.length}>No records found.</td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}

function money(value: number) {
  return Number(value || 0).toLocaleString("en-IN", {
    maximumFractionDigits: 2,
  });
}

function buildMaskebariSummary({
  accountParties,
  creditNotes,
  month,
  purchaseData,
  sales,
}: {
  accountParties: AccountParty[];
  creditNotes: CreditNote[];
  month: number;
  purchaseData: AppData | null;
  sales: Sale[];
}) {
  const purchaseParties = new Map(
    (purchaseData?.parties ?? []).map((party) => [party.id, party.name]),
  );
  const accountPartyMap = new Map(accountParties.map((party) => [party.id, party.name]));
  const monthSales = sales.filter((sale) => dateMonth(sale.dateBs) === month);
  const monthCreditNotes = creditNotes.filter((creditNote) => dateMonth(creditNote.dateBs) === month);
  const taxableSales = monthSales.reduce((sum, sale) => sum + sale.salesAmount, 0);
  const salesVatDebit = monthSales.reduce((sum, sale) => sum + sale.vatAmount, 0);
  let taxablePurchase = 0;
  let purchaseVatCredit = 0;
  let taxableImport = 0;
  let importVatCredit = 0;
  const inputVatRows: PdfTableRow[] = [];
  const outputVatRows: PdfTableRow[] = monthSales.map((sale) => [
    sale.dateBs || "-",
    accountPartyMap.get(sale.partyId) ?? "Unknown party",
    sale.billNo,
    money(sale.salesAmount),
    money(sale.vatAmount),
    sale.remarks || "-",
  ]);

  monthCreditNotes.forEach((creditNote) => {
    outputVatRows.push([
      creditNote.dateBs || "-",
      accountPartyMap.get(creditNote.partyId) ?? "Unknown party",
      creditNote.creditNoteNo,
      money(-creditNote.amount),
      money(-creditNote.vatAmount),
      creditNote.remarks || "Credit note adjustment",
    ]);
  });

  (purchaseData?.purchases ?? []).forEach((purchase) => {
    const pragapanpatraDate = purchase.debitNoteDate || purchase.billDate;
    const terminalVat = purchase.terminalVatNPR || purchase.terminalChargeWithoutVatNPR * 0.13;

    if (dateMonth(pragapanpatraDate) === month) {
      if (terminalVat > 0 || purchase.terminalChargeWithoutVatNPR > 0) {
        taxablePurchase += purchase.terminalChargeWithoutVatNPR;
        purchaseVatCredit += terminalVat;
        inputVatRows.push([
          pragapanpatraDate || "-",
          "Terminal VAT",
          purchaseParties.get(purchase.customAgentPartyId) ?? "-",
          purchase.debitNoteNumber || purchase.vendorBillNumber,
          money(purchase.terminalChargeWithoutVatNPR),
          money(terminalVat),
        ]);
      }

      if (purchase.importVatNPR > 0) {
        const importTaxableValue = purchase.importVatNPR / 0.13;
        taxableImport += importTaxableValue;
        importVatCredit += purchase.importVatNPR;
        inputVatRows.push([
          pragapanpatraDate || "-",
          "Import VAT",
          purchaseParties.get(purchase.vendorPartyId) ?? "-",
          purchase.debitNoteNumber || purchase.vendorBillNumber,
          money(importTaxableValue),
          money(purchase.importVatNPR),
        ]);
      }
    }

    if (dateMonth(purchase.agentServiceBillDate) === month) {
      taxablePurchase += purchase.agentServiceAmountBeforeVatNPR;
      purchaseVatCredit += purchase.agentServiceVatNPR;
      inputVatRows.push([
        purchase.agentServiceBillDate || "-",
        "Custom agent service VAT",
        purchaseParties.get(purchase.customAgentPartyId) ?? "-",
        purchase.agentServiceBillNumber || purchase.debitNoteNumber || "-",
        money(purchase.agentServiceAmountBeforeVatNPR),
        money(purchase.agentServiceVatNPR),
      ]);
    }
  });

  (purchaseData?.localExpenses ?? []).forEach((localExpense) => {
    if (dateMonth(localExpense.billDate) !== month) {
      return;
    }

    taxablePurchase += localExpense.amountBeforeVatNPR;
    purchaseVatCredit += localExpense.vatNPR;
    inputVatRows.push([
      localExpense.billDate || "-",
      "Local supplier VAT",
      purchaseParties.get(localExpense.partyId) ?? "-",
      localExpense.billNumber,
      money(localExpense.amountBeforeVatNPR),
      money(localExpense.vatNPR),
    ]);
  });

  const otherCredit = monthCreditNotes.reduce((sum, creditNote) => sum + creditNote.vatAmount, 0);

  monthCreditNotes.forEach((creditNote) => {
    inputVatRows.push([
      creditNote.dateBs || "-",
      "Credit note VAT adjustment",
      accountPartyMap.get(creditNote.partyId) ?? "Unknown party",
      creditNote.creditNoteNo,
      "-",
      money(creditNote.vatAmount),
    ]);
  });

  const totalCredit = purchaseVatCredit + importVatCredit + otherCredit;
  const totalDebit = salesVatDebit;
  const netPayableReceivable = totalDebit - totalCredit;
  const maskebariRows: PdfTableRow[] = [
    ["1. Sales", "", "", ""],
    ["1.1 Taxable sales", money(taxableSales), "-", money(salesVatDebit)],
    ["1.2 Export", money(0), "-", "-"],
    ["1.3 Exempt sales", money(0), "-", "-"],
    ["2. Purchase / Import", "", "", ""],
    ["2.1 Taxable purchase", money(taxablePurchase), money(purchaseVatCredit), "-"],
    ["2.2 Taxable import purchase", money(taxableImport), money(importVatCredit), "-"],
    ["2.3 Exempt purchase", money(0), "-", "-"],
    ["2.4 Exempt import", money(0), "-", "-"],
    ["3. Other", "", "", ""],
    ["3.1 Other adjustments", "-", money(otherCredit), money(0)],
    ["Total", "-", money(totalCredit), money(totalDebit)],
    ["Net payable / receivable", "-", "-", money(netPayableReceivable)],
  ];

  outputVatRows.push(["Total", "-", "-", money(taxableSales), money(salesVatDebit), "-"]);
  inputVatRows.push(["Total", "-", "-", "-", money(taxablePurchase + taxableImport), money(totalCredit)]);

  return {
    importVatCredit,
    inputVatRows,
    maskebariRows,
    netPayableReceivable,
    otherCredit,
    outputVatRows,
    purchaseVatCredit,
    salesVatDebit,
    taxableImport,
    taxablePurchase,
    taxableSales,
    totalCredit,
    totalDebit,
  };
}

function dateMonth(value: string) {
  const match = String(value ?? "").trim().match(/^\d{4}[/-](\d{1,2})/);
  return match ? Number(match[1]) : 0;
}

async function downloadCombinedVatPdf(
  filename: string,
  monthLabel: string,
  summary: ReturnType<typeof buildMaskebariSummary>,
) {
  const blob = new Blob(
    [
      buildMultiTablePdf([
        {
          title: `Maskebari Summary - ${monthLabel}`,
          headers: ["Particulars", "Turnover / Purchase", "Input VAT Credit", "Output VAT Debit"],
          rows: summary.maskebariRows,
        },
        {
          title: `Output VAT Report - ${monthLabel}`,
          headers: ["Date", "Party", "Bill / CN", "Taxable Sales", "VAT Debit", "Remarks"],
          rows: summary.outputVatRows,
        },
        {
          title: `Input VAT Report - ${monthLabel}`,
          headers: ["Date", "Source", "Party", "Reference", "Taxable Value", "VAT Credit"],
          rows: summary.inputVatRows,
        },
      ]),
    ],
    { type: "application/pdf" },
  );
  await saveBlob(safePdfFilename(filename), blob, {
    description: "PDF Document",
    mimeType: "application/pdf",
    extensions: [".pdf"],
  });
}

function buildMultiTablePdf(
  sections: { title: string; headers: string[]; rows: PdfTableRow[] }[],
) {
  const pageWidth = 842;
  const pageHeight = 595;
  const margin = 32;
  const rowHeight = 20;
  const rowsPerPage = 22;
  const tableWidth = pageWidth - margin * 2;
  const pages = sections.flatMap((section) => {
    const rowChunks = chunkRows(section.rows.length ? section.rows : [["No records found"]], rowsPerPage);
    const columnWidth = tableWidth / section.headers.length;

    return rowChunks.map((pageRows, sectionPageIndex) => {
      let y = pageHeight - margin;
      const ops: string[] = [
        "0.2 w",
        centeredPdfText(
          sectionPageIndex === 0
            ? section.title
            : `${section.title} (continued)`,
          pageWidth / 2,
          y,
          16,
          "F2",
        ),
      ];
      y -= 34;

      section.headers.forEach((header, index) => {
        const x = margin + index * columnWidth;
        ops.push(pdfRect(x, y - rowHeight + 5, columnWidth, rowHeight));
        ops.push(pdfText(fitPdfText(header, 22), x + 4, y - 9, 8, "F2"));
      });
      y -= rowHeight;

      pageRows.forEach((row) => {
        section.headers.forEach((_, index) => {
          const x = margin + index * columnWidth;
          const value = row[index] ?? "";
          ops.push(pdfRect(x, y - rowHeight + 5, columnWidth, rowHeight));
          ops.push(pdfText(fitPdfText(value, 24), x + 4, y - 9, 8));
        });
        y -= rowHeight;
      });

      return ops.join("\n");
    });
  });

  const objects: string[] = [];
  const pageObjectNumbers: number[] = [];
  objects[0] = "<< /Type /Catalog /Pages 2 0 R >>";
  objects[1] = "";
  objects[2] = "<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>";
  objects[3] = "<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica-Bold >>";

  pages.forEach((content, pageIndex) => {
    const pageObjectNumber = 5 + pageIndex * 2;
    const contentObjectNumber = pageObjectNumber + 1;
    pageObjectNumbers.push(pageObjectNumber);
    objects[pageObjectNumber - 1] =
      `<< /Type /Page /Parent 2 0 R /MediaBox [0 0 ${pageWidth} ${pageHeight}] /Resources << /Font << /F1 3 0 R /F2 4 0 R >> >> /Contents ${contentObjectNumber} 0 R >>`;
    objects[contentObjectNumber - 1] =
      `<< /Length ${content.length} >>\nstream\n${content}\n${pdfText(`Page ${pageIndex + 1} of ${pages.length}`, pageWidth - 105, 24, 8)}\nendstream`;
  });

  objects[1] =
    `<< /Type /Pages /Kids [${pageObjectNumbers.map((number) => `${number} 0 R`).join(" ")}] /Count ${pageObjectNumbers.length} >>`;

  return writePdf(objects);
}

function chunkRows<T>(rows: T[], size: number) {
  const chunks: T[][] = [];

  for (let index = 0; index < rows.length; index += size) {
    chunks.push(rows.slice(index, index + size));
  }

  return chunks;
}

function pdfText(text: string, x: number, y: number, size = 9, font = "F1") {
  return `BT /${font} ${size} Tf ${x} ${y} Td (${pdfSafe(text)}) Tj ET`;
}

function centeredPdfText(text: string, x: number, y: number, size = 16, font = "F2") {
  const width = text.length * size * 0.28;
  return pdfText(text, x - width / 2, y, size, font);
}

function pdfRect(x: number, y: number, width: number, height: number) {
  return `${x} ${y} ${width} ${height} re S`;
}

function pdfSafe(value: string) {
  return String(value ?? "")
    .replace(/[^\x20-\x7E]/g, "?")
    .replace(/\\/g, "\\\\")
    .replace(/\(/g, "\\(")
    .replace(/\)/g, "\\)");
}

function fitPdfText(value: string, maxLength: number) {
  const text = String(value || "-");
  return text.length > maxLength ? `${text.slice(0, Math.max(0, maxLength - 3))}...` : text;
}

function writePdf(objects: string[]) {
  const offsets = [0];
  let pdf = "%PDF-1.4\n";

  objects.forEach((object, index) => {
    offsets[index + 1] = pdf.length;
    pdf += `${index + 1} 0 obj\n${object}\nendobj\n`;
  });

  const xrefOffset = pdf.length;
  pdf += `xref\n0 ${objects.length + 1}\n`;
  pdf += "0000000000 65535 f \n";
  offsets.slice(1).forEach((offset) => {
    pdf += `${String(offset).padStart(10, "0")} 00000 n \n`;
  });
  pdf += `trailer\n<< /Size ${objects.length + 1} /Root 1 0 R >>\nstartxref\n${xrefOffset}\n%%EOF`;
  return pdf;
}

function safePdfFilename(value: string) {
  return value.trim().replace(/[<>:"/\\|?*]+/g, "-").replace(/\s+/g, "-") || "report.pdf";
}

type SuiteSettingsProps = {
  onBack: () => void;
  onLogout: () => void;
};

function SuiteSettings({ onBack, onLogout }: SuiteSettingsProps) {
  const [settingsForm, setSettingsForm] = useState<AppSettings>(() => readSuiteSettings());
  const [purchaseData, setPurchaseData] = useState<AppData | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [isSaving, setIsSaving] = useState(false);
  const [message, setMessage] = useState("");

  useEffect(() => {
    let active = true;

    async function loadSettings() {
      setIsLoading(true);
      setMessage("");

      try {
        const repository = await createDataRepository();
        const data = await repository.loadData();

        if (!active) {
          return;
        }

        setPurchaseData(data);
        setSettingsForm(readSuiteSettings(data.settings));
      } catch (error) {
        console.error("Settings load error:", error);
        if (active) {
          setMessage("Using local settings. Purchase settings will sync when storage is available.");
        }
      } finally {
        if (active) {
          setIsLoading(false);
        }
      }
    }

    loadSettings();

    return () => {
      active = false;
    };
  }, []);

  function updateTextField(
    field: "companyName" | "fiscalYear" | "panVatNo" | "address" | "phone",
    value: string,
  ) {
    setSettingsForm((current) => ({ ...current, [field]: value }));
  }

  function updateNumberField(field: "defaultExchangeRate" | "agentServiceVatRate", value: string) {
    setSettingsForm((current) => ({
      ...current,
      [field]: Number(value) || 0,
    }));
  }

  async function saveSettings(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setIsSaving(true);
    setMessage("");

    const nextSettings: AppSettings = {
      ...settingsForm,
      companyName: settingsForm.companyName.trim() || defaultSettings.companyName,
      fiscalYear: settingsForm.fiscalYear.trim(),
      panVatNo: settingsForm.panVatNo.trim(),
      address: settingsForm.address.trim(),
      phone: settingsForm.phone.trim(),
      defaultExchangeRate:
        settingsForm.defaultExchangeRate > 0
          ? settingsForm.defaultExchangeRate
          : defaultSettings.defaultExchangeRate,
      agentServiceVatRate:
        settingsForm.agentServiceVatRate >= 0
          ? settingsForm.agentServiceVatRate
          : defaultSettings.agentServiceVatRate,
    };

    writeSuiteSettings(nextSettings);

    try {
      const repository = await createDataRepository();
      const currentData = purchaseData ?? (await repository.loadData());
      const updatedData = { ...currentData, settings: nextSettings };

      await repository.saveData(updatedData);
      setPurchaseData(updatedData);
      setSettingsForm(nextSettings);
      setMessage("Settings saved for Sales/Collection and Purchase/Payment modules.");
    } catch (error) {
      console.error("Settings save error:", error);
      setSettingsForm(nextSettings);
      setMessage("Settings saved locally. Purchase database settings could not be updated.");
    } finally {
      setIsSaving(false);
    }
  }

  return (
    <main className="suite-settings-page">
      <header className="module-picker-header suite-settings-header">
        <div>
          <p className="eyebrow">Dhaulagiri Business Suite</p>
          <h1>Settings</h1>
          <p>Shared company and transaction defaults for both modules.</p>
        </div>
        <div className="module-header-actions">
          <button type="button" className="ghost" onClick={onBack}>
            Back to Modules
          </button>
          <button type="button" className="ghost" onClick={onLogout}>
            Logout
          </button>
        </div>
      </header>

      <form className="suite-settings-panel" onSubmit={saveSettings}>
        {message && <p className="status-message">{message}</p>}
        {isLoading && <p className="muted">Loading current settings...</p>}

        <section className="suite-settings-grid">
          <label>
            Company Name
            <input
              value={settingsForm.companyName}
              onChange={(event) => updateTextField("companyName", event.target.value)}
            />
          </label>

          <label>
            Fiscal Year
            <input
              value={settingsForm.fiscalYear}
              onChange={(event) => updateTextField("fiscalYear", event.target.value)}
              placeholder="2082/83"
            />
          </label>

          <label>
            PAN/VAT No.
            <input
              value={settingsForm.panVatNo}
              onChange={(event) => updateTextField("panVatNo", event.target.value)}
            />
          </label>

          <label>
            Phone
            <input
              value={settingsForm.phone}
              onChange={(event) => updateTextField("phone", event.target.value)}
            />
          </label>

          <label className="suite-settings-wide">
            Address
            <input
              value={settingsForm.address}
              onChange={(event) => updateTextField("address", event.target.value)}
            />
          </label>

          <label>
            Default INR Exchange Rate
            <input
              min="0"
              step="0.0001"
              type="number"
              value={settingsForm.defaultExchangeRate}
              onChange={(event) => updateNumberField("defaultExchangeRate", event.target.value)}
            />
          </label>

          <label>
            Agent Service VAT Rate %
            <input
              min="0"
              step="0.01"
              type="number"
              value={settingsForm.agentServiceVatRate}
              onChange={(event) => updateNumberField("agentServiceVatRate", event.target.value)}
            />
          </label>
        </section>

        <div className="suite-settings-actions">
          <button type="button" className="ghost" onClick={onBack}>
            Cancel
          </button>
          <button type="submit" disabled={isSaving}>
            {isSaving ? "Saving..." : "Save Settings"}
          </button>
        </div>
      </form>
    </main>
  );
}
