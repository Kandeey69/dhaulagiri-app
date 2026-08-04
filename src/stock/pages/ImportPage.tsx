import type { FormEvent } from "react";

type ImportPageProps = {
  fileInputKey: number;
  isReadOnly?: boolean;
  onDownloadOpeningTemplate: () => void;
  onImportOpening: (event: FormEvent<HTMLFormElement>) => void;
  onOpeningFileChange: (file: File | null) => void;
};

export default function ImportPage({
  fileInputKey,
  isReadOnly = false,
  onDownloadOpeningTemplate,
  onImportOpening,
  onOpeningFileChange,
}: ImportPageProps) {
  return (
    <section className="stock-panel">
      <h3>Data Importation</h3>
      <p className="stock-muted">Download the CSV template, fill stock item and opening figure rows, then import it here.</p>
      {isReadOnly && <p className="stock-muted">Closed fiscal year: opening stock import is disabled.</p>}
      <form className="stock-stack" onSubmit={onImportOpening}>
        <div className="stock-form-grid">
          <label>Opening Stock CSV File<input key={fileInputKey} accept=".csv,text/csv" disabled={isReadOnly} type="file" onChange={(event) => onOpeningFileChange(event.target.files?.[0] ?? null)} /></label>
          <div className="stock-import-example"><strong>Format</strong><span>code,name,unit,openingQty,openingRate,reorderLevel</span><span>IRON-01,Iron Rod,MT,10,85000,2</span><span>CEMENT-01,Cement,KG,500,18,100</span></div>
        </div>
        <div className="stock-actions">
          <button type="button" className="ghost" onClick={onDownloadOpeningTemplate}>Download CSV Template</button>
          <button type="submit" disabled={isReadOnly}>Import CSV</button>
        </div>
      </form>
    </section>
  );
}
