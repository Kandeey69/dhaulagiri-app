import { memo } from "react";
import type { ReactNode } from "react";

export type StockTableHeader = string | {
  ariaSort?: "ascending" | "descending" | "none";
  className?: string;
  content: ReactNode;
  key: string;
};

type StockTableProps = {
  emptyText?: string;
  headers: StockTableHeader[];
  rows: Array<Array<ReactNode>>;
};

function headerKey(header: StockTableHeader, index: number) {
  return typeof header === "string" ? `${header}-${index}` : header.key;
}

function StockTable({ emptyText = "No records yet.", headers, rows }: StockTableProps) {
  return (
    <div className="stock-table-wrap">
      <table className="stock-table">
        <thead>
          <tr>
            {headers.map((header, index) => (
              <th
                key={headerKey(header, index)}
                aria-sort={typeof header === "string" ? undefined : header.ariaSort}
                className={typeof header === "string" ? undefined : header.className}
              >
                {typeof header === "string" ? header : header.content}
              </th>
            ))}
          </tr>
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
