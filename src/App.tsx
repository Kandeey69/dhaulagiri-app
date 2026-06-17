import { useState } from "react";
import type { FormEvent } from "react";
import AccountsApp from "./accounts/App";
import PurchaseApp from "./purchase/App";
import "./App.css";

type UserRole = "account" | "master";
type ModuleKey = "accounts" | "purchase";

const MASTER_PASSWORD = "KANCHAN";

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
          <button type="button" className="ghost" onClick={logout}>
            Logout
          </button>
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

  return (
    <PurchaseApp
      initialUserRole={userRole === "master" ? "Master" : "Account"}
      onBackToModules={() => setSelectedModule(null)}
      onLogout={logout}
    />
  );
}
