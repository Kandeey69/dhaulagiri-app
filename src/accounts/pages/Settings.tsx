import { useState } from "react";
import { MASTER_PASSWORD, type UserRole } from "../auth";
import { getCompanySetting, setCompanySetting } from "../../companyContext";
import { readLetterheadSettings, writeLetterheadSettings } from "../utils/letterheadSettings";

type SettingsProps = {
  onCompanySettingsChange: (companyName: string, fiscalYear: string) => void;
  userRole: UserRole;
  onUserRoleChange: (role: UserRole) => void;
};

export default function Settings({
  onCompanySettingsChange,
  userRole,
  onUserRoleChange,
}: SettingsProps) {
  const [password, setPassword] = useState("");
  const [companyName, setCompanyName] = useState(
    () => getCompanySetting("accounts-company-name", "Company")
  );
  const [fiscalYear, setFiscalYear] = useState(
    () => getCompanySetting("accounts-fiscal-year", "")
  );
  const [letterheadSettings, setLetterheadSettings] = useState(readLetterheadSettings);
  const [message, setMessage] = useState("");

  function unlockMaster() {
    setMessage("");

    if (password !== MASTER_PASSWORD) {
      setMessage("Incorrect master password.");
      return;
    }

    onUserRoleChange("master");
    setPassword("");
    setMessage("Master access enabled.");
  }

  function switchToAccount() {
    onUserRoleChange("account");
    setPassword("");
    setMessage("Switched to Account mode.");
  }

  function saveCompanySettings() {
    const nextCompanyName = companyName.trim();
    const nextFiscalYear = fiscalYear.trim();
    setCompanySetting("accounts-company-name", nextCompanyName);
    setCompanySetting("accounts-fiscal-year", nextFiscalYear);
    onCompanySettingsChange(nextCompanyName, nextFiscalYear);
    setMessage("Settings saved.");
  }

  function saveLetterheadSettings() {
    writeLetterheadSettings(letterheadSettings);
    setMessage("Letterhead settings saved.");
  }

  function updateLetterheadField(field: keyof typeof letterheadSettings, value: string) {
    setLetterheadSettings((current) => ({
      ...current,
      [field]: value,
    }));
  }

  return (
    <>
      <h1>Settings</h1>
      {message && <p className="status-message">{message}</p>}

      <div className="settings-grid">
        <div className="card">
          <h3>User Access</h3>
          <p className="muted">
            Account users can enter new records. Master users can also edit and delete
            parties, sales, and collections.
          </p>

          <div className="access-panel">
            <div>
              <span className="mini-label">Current Mode</span>
              <strong>{userRole === "master" ? "Master" : "Account"}</strong>
            </div>

            {userRole === "master" ? (
              <button className="secondary" onClick={switchToAccount}>
                Switch to Account
              </button>
            ) : (
              <div className="unlock-row">
                <input
                  type="password"
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  placeholder="Master password"
                />
                <button className="primary" onClick={unlockMaster}>
                  Unlock Master
                </button>
              </div>
            )}
          </div>
        </div>

        <div className="card">
          <h3>Company Settings</h3>

          <div className="form-grid single-column">
            <label>
              Company Name
              <input
                value={companyName}
                onChange={(e) => setCompanyName(e.target.value)}
              />
            </label>

            <label>
              Fiscal Year
              <input
                value={fiscalYear}
                onChange={(e) => setFiscalYear(e.target.value)}
                placeholder="Example: 2081/82"
              />
            </label>
          </div>

          <br />
          <button className="primary" onClick={saveCompanySettings}>
            Save Settings
          </button>
        </div>

        <div className="card">
          <h3>Letterhead Settings</h3>

          <div className="form-grid single-column">
            <label>
              Company Name in Nepali
              <input
                value={letterheadSettings.nepaliCompanyName}
                onChange={(event) => updateLetterheadField("nepaliCompanyName", event.target.value)}
                placeholder="Enter Nepali company name"
              />
            </label>

            <label>
              Default Contact Line
              <textarea
                value={letterheadSettings.contactLine}
                onChange={(event) => updateLetterheadField("contactLine", event.target.value)}
                placeholder="Leave blank to use phone number from normal settings"
              />
            </label>
          </div>

          <br />
          <button className="primary" onClick={saveLetterheadSettings}>
            Save Letterhead Settings
          </button>
        </div>

        <div className="card">
          <h3>Permissions Summary</h3>
          <div className="permission-list">
            <div>
              <strong>Account</strong>
              <span>Add parties, sales, collections, and view reports.</span>
            </div>
            <div>
              <strong>Master</strong>
              <span>Everything Account can do, plus import, edit, and delete records.</span>
            </div>
          </div>
        </div>
      </div>
    </>
  );
}
