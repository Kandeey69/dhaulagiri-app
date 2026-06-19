import { useEffect, useMemo, useState } from "react";
import type { KeyboardEvent } from "react";
import Dashboard from "./pages/Dashboard";
import Parties from "./pages/Parties";
import Sales from "./pages/Sales";
import Collections from "./pages/Collections";
import CreditNotes from "./pages/CreditNotes";
import Imports from "./pages/Imports";
import Reports from "./pages/Reports";
import Settings from "./pages/Settings";
import ActivityLogs from "./pages/ActivityLogs";
import { MASTER_PASSWORD, type UserRole } from "./auth";
import { getOutstanding } from "./data/storage";
import "./App.css";

type Page =
  | "dashboard"
  | "parties"
  | "sales"
  | "collections"
  | "creditNotes"
  | "imports"
  | "reports"
  | "settings"
  | "activityLogs";

const pageLabels: Record<Page, string> = {
  dashboard: "Dashboard",
  parties: "Party Master",
  sales: "Sales Entry",
  collections: "Collection Entry",
  creditNotes: "Credit Note / Adjustment",
  imports: "Data Importation",
  reports: "Reports",
  settings: "Settings",
  activityLogs: "Activity Logs",
};

const masterPages: Page[] = [
  "dashboard",
  "sales",
  "collections",
  "creditNotes",
  "reports",
  "parties",
  "imports",
  "activityLogs",
];

const accountPages: Page[] = [
  "dashboard",
  "sales",
  "collections",
  "creditNotes",
  "reports",
  "parties",
];

const formatMoney = (value: number) =>
  `NPR ${Number(value || 0).toLocaleString("en-IN", {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  })}`;

const moveEnterToNextField = (event: KeyboardEvent<HTMLElement>) => {
  if (event.key !== "Enter") {
    return;
  }

  const target = event.target;

  if (
    !(target instanceof HTMLInputElement) &&
    !(target instanceof HTMLSelectElement) &&
    !(target instanceof HTMLTextAreaElement)
  ) {
    return;
  }

  event.preventDefault();

  const container = target.closest("form") ?? target.closest(".app-shell") ?? document;
  const fields = Array.from(
    container.querySelectorAll<HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement>(
      "input:not([type='hidden']):not([disabled]):not([readonly]), select:not([disabled]), textarea:not([disabled]):not([readonly])"
    )
  ).filter((field) => field.offsetParent !== null);
  const currentIndex = fields.indexOf(target);
  const nextField = currentIndex >= 0 ? fields[currentIndex + 1] : undefined;

  nextField?.focus();
};

type AccountsAppProps = {
  initialUserRole?: UserRole;
  onBackToModules?: () => void;
  onLogout?: () => void;
};

export default function App({
  initialUserRole,
  onBackToModules,
  onLogout,
}: AccountsAppProps = {}) {
  const [page, setPage] = useState<Page>("dashboard");
  const [userRole, setUserRole] = useState<UserRole | null>(() => initialUserRole ?? null);
  const [loginPassword, setLoginPassword] = useState("");
  const [loginMessage, setLoginMessage] = useState("");
  const [netReceivable, setNetReceivable] = useState(0);
  const [companyName, setCompanyName] = useState(
    () => localStorage.getItem("accounts-company-name") || "Dhaulagiri Accounts"
  );
  const [fiscalYear, setFiscalYear] = useState(
    () => localStorage.getItem("accounts-fiscal-year") || ""
  );

  const allowedPages = useMemo(
    () => (userRole === "master" ? masterPages : accountPages),
    [userRole]
  );
  const currentPage = allowedPages.includes(page) ? page : "dashboard";

  useEffect(() => {
    if (initialUserRole) {
      setUserRole(initialUserRole);
    }
  }, [initialUserRole]);

  useEffect(() => {
    if (!userRole) {
      return;
    }

    getOutstanding()
      .then((rows) => {
        setNetReceivable(rows.reduce((sum, row) => sum + row.outstanding, 0));
      })
      .catch(() => {
        setNetReceivable(0);
      });
  }, [page, userRole]);

  function updateUserRole(role: UserRole) {
    setUserRole(role);
  }

  function loginAsAccount() {
    setLoginMessage("");
    setLoginPassword("");
    setUserRole("account");
    setPage("dashboard");
  }

  function loginAsMaster() {
    setLoginMessage("");

    if (loginPassword !== MASTER_PASSWORD) {
      setLoginMessage("Incorrect master password.");
      return;
    }

    setLoginPassword("");
    setUserRole("master");
    setPage("dashboard");
  }

  function logout() {
    if (onLogout) {
      onLogout();
      return;
    }

    setUserRole(null);
    setLoginPassword("");
    setLoginMessage("");
    setPage("dashboard");
  }

  const renderPage = (activeRole: UserRole) => {
    const canManage = activeRole === "master";

    if (currentPage === "dashboard") {
      return <Dashboard onNavigate={(target) => setPage(target)} />;
    }
    if (currentPage === "parties") return <Parties canManage={canManage} />;
    if (currentPage === "sales") return <Sales canManage={canManage} canEdit />;
    if (currentPage === "collections") return <Collections canManage={canManage} canEdit />;
    if (currentPage === "creditNotes") return <CreditNotes canManage={canManage} />;
    if (currentPage === "imports") return <Imports canManage={canManage} />;
    if (currentPage === "reports") return <Reports />;
    if (currentPage === "activityLogs") return <ActivityLogs />;
    return (
      <Settings
        userRole={activeRole}
        onCompanySettingsChange={(nextCompanyName, nextFiscalYear) => {
          setCompanyName(nextCompanyName || "Dhaulagiri Accounts");
          setFiscalYear(nextFiscalYear);
        }}
        onUserRoleChange={updateUserRole}
      />
    );
  };

  if (!userRole) {
    return (
      <main className="login-page" onKeyDown={moveEnterToNextField}>
        <section className="login-brand">
          <p className="eyebrow">Dhaulagiri</p>
          <h1>Accounts</h1>
          <p>Sales bills, receivables, collections, adjustments, output VAT, and customer ledgers in one workspace.</p>
          <p className="login-credit">Vibecoded by Kanchan Dahal</p>
        </section>

        <section className="login-card">
          <p className="eyebrow">Secure access</p>
          <h2>Select user</h2>
          <p className="login-note">Choose Account mode for daily entries, or unlock Master for edit, delete, settings, and import access.</p>

          {loginMessage && <p className="status-message">{loginMessage}</p>}

          <div className="login-actions">
            <button type="button" onClick={loginAsAccount}>
              Continue as Account
            </button>

            <form
              className="login-form"
              onSubmit={(event) => {
                event.preventDefault();
                loginAsMaster();
              }}
            >
              <label>
                Master Password
                <input
                  type="password"
                  value={loginPassword}
                  onChange={(event) => setLoginPassword(event.target.value)}
                />
              </label>
              <button type="submit">
                Unlock Master
              </button>
            </form>
          </div>
        </section>
      </main>
    );
  }

  return (
    <div className="app-shell" onKeyDown={moveEnterToNextField}>
      <aside className="sidebar">
        <div>
          <p className="eyebrow">Dhaulagiri</p>
          <h1>Accounts</h1>
          <p className="sidebar-note">Sales, receivables, collections, credit notes, VAT, and customer ledgers.</p>
          <p className="sidebar-note">User: {userRole === "master" ? "Master" : "Account"}</p>
        </div>

        <nav>
          {allowedPages.map((item) => (
            <button
              key={item}
              type="button"
              className={currentPage === item ? "active" : ""}
              onClick={() => setPage(item)}
            >
              {pageLabels[item]}
            </button>
          ))}
          {onBackToModules && (
            <button type="button" onClick={onBackToModules}>
              Switch Module
            </button>
          )}
          <button type="button" className="logout-button" onClick={logout}>
            Logout
          </button>
        </nav>
      </aside>

      <main className="main-content">
        <header className="page-header">
          <div>
            <p className="eyebrow">
              {companyName} {fiscalYear ? `- FY ${fiscalYear}` : ""}
            </p>
            <h2>{pageLabels[currentPage]}</h2>
          </div>
          <div className="quick-total">
            <span>Net receivable</span>
            <strong>{formatMoney(netReceivable)}</strong>
          </div>
          <button type="button" className="ghost" onClick={logout}>
            Logout
          </button>
          {onBackToModules && (
            <button type="button" className="ghost" onClick={onBackToModules}>
              Switch Module
            </button>
          )}
        </header>
        {renderPage(userRole)}
      </main>
    </div>
  );
}
