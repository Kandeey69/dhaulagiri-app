import type { StockUserRole, StockView } from "../types";

type SidebarProps = {
  collapsed: boolean;
  companyName: string;
  onBackToModules?: () => void;
  onToggleCollapsed: () => void;
  onLogout?: () => void;
  onViewChange: (view: StockView) => void;
  userRole: StockUserRole;
  view: StockView;
  views: StockView[];
};

export default function Sidebar({
  collapsed,
  companyName,
  onBackToModules,
  onToggleCollapsed,
  onLogout,
  onViewChange,
  userRole,
  view,
  views,
}: SidebarProps) {
  return (
    <aside className="stock-sidebar">
      <div>
        <p className="stock-company-name">{companyName || "Company"}</p>
        <p className="eyebrow">Inventory Tracked</p>
        <h1>Stock Module</h1>
        <p className="stock-sidebar-note">User: {userRole}</p>
      </div>
      <nav>
        <button
          type="button"
          className="stock-sidebar-toggle"
          onClick={onToggleCollapsed}
          title={collapsed ? "Expand sidebar" : "Collapse sidebar"}
          aria-label={collapsed ? "Expand sidebar" : "Collapse sidebar"}
        >
          <span aria-hidden="true">{collapsed ? ">>" : "<<"}</span>
          <span className="stock-nav-label">{collapsed ? "Expand" : "Collapse"}</span>
        </button>
        {views.map((item) => (
          <button key={item} type="button" className={view === item ? "active" : ""} onClick={() => onViewChange(item)} title={item}>
            <span className="stock-nav-icon" aria-hidden="true">{shortViewLabel(item)}</span>
            <span className="stock-nav-label">{item}</span>
          </button>
        ))}
        {onBackToModules && (
          <button type="button" onClick={onBackToModules} title="Switch Module">
            <span className="stock-nav-icon" aria-hidden="true">SM</span>
            <span className="stock-nav-label">Switch Module</span>
          </button>
        )}
        <button type="button" className="logout-button" onClick={onLogout} title="Logout">
          <span className="stock-nav-icon" aria-hidden="true">LO</span>
          <span className="stock-nav-label">Logout</span>
        </button>
      </nav>
    </aside>
  );
}

function shortViewLabel(view: StockView) {
  if (view === "Line Item Entry (For Sales)") return "LS";
  if (view === "Line Item Entry (For Purchase)") return "LP";
  if (view === "Stock Register") return "SR";
  if (view === "Item Master") return "IM";
  if (view === "Data Importation") return "DI";
  return "DB";
}
