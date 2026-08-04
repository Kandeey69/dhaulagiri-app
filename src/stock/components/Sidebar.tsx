import type { StockUserRole, StockView } from "../types";

type SidebarProps = {
  onBackToModules?: () => void;
  onLogout?: () => void;
  onViewChange: (view: StockView) => void;
  userRole: StockUserRole;
  view: StockView;
  views: StockView[];
};

export default function Sidebar({
  onBackToModules,
  onLogout,
  onViewChange,
  userRole,
  view,
  views,
}: SidebarProps) {
  return (
    <aside className="stock-sidebar">
      <div>
        <p className="eyebrow">Inventorytracked</p>
        <h1>Stock Module</h1>
        <p className="stock-sidebar-note">Enter line items against saved sales and purchase bills.</p>
        <p className="stock-sidebar-note">User: {userRole}</p>
      </div>
      <nav>
        {views.map((item) => (
          <button key={item} type="button" className={view === item ? "active" : ""} onClick={() => onViewChange(item)}>{item}</button>
        ))}
        {onBackToModules && <button type="button" onClick={onBackToModules}>Switch Module</button>}
        <button type="button" className="logout-button" onClick={onLogout}>Logout</button>
      </nav>
    </aside>
  );
}
