import { memo } from "react";
import type { ReactNode } from "react";

type StockTableProps = {
  emptyText?: string;
  headers: string[];
  rows: Array<Array<ReactNode>>;
};

function StockTable({ emptyText = "No records yet.", headers, rows }: StockTableProps) {
  return (
    <div className="stock-table-wrap">
      <table className="stock-table">
        <thead>
          <tr>{headers.map((header) => <th key={header}>{header}</th>)}</tr>
        </thead>
        <tbody>
          {rows.map((row, rowIndex) => (
            <tr key={rowIndex}>
              {row.map((cell, cellIndex) => (
                <td key={`${rowIndex}-${cellIndex}`}>
                  {cell === "" || cell === null || cell === undefined ? "-" : cell}
                </td>
              ))}
            </tr>
          ))}
          {!rows.length && <tr><td className="stock-empty-state" colSpan={headers.length}>{emptyText}</td></tr>}
        </tbody>
      </table>
    </div>
  );
}

export default memo(StockTable);
