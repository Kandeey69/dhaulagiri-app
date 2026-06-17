import type { LedgerRow, Party } from "../data/types";
import { saveBlob } from "./fileSave";

type LedgerPdfRow = {
  balance: string;
  credit: string;
  date: string;
  debit: string;
  particulars: string;
};

type PdfColumn = {
  align?: "left" | "right";
  label: string;
  max: number;
  width: number;
  x: number;
};

const PAGE_WIDTH = 595;
const PAGE_HEIGHT = 842;
const LEFT = 36;
const TOP = 790;
const ROW_HEIGHT = 18;

const columns: PdfColumn[] = [
  { label: "Date", x: LEFT, width: 62, max: 12 },
  { label: "Particulars", x: LEFT + 62, width: 191, max: 34 },
  { label: "Debit (NPR)", x: LEFT + 253, width: 84, max: 18, align: "right" },
  { label: "Credit (NPR)", x: LEFT + 337, width: 84, max: 18, align: "right" },
  { label: "Net Balance (NPR)", x: LEFT + 421, width: 102, max: 20, align: "right" },
];

export async function saveLedgerPdf(party: Party, ledgerRows: LedgerRow[]) {
  const reportDate = todayForFileName();
  const filename = `${safeFilename(party.name)}_${reportDate}.pdf`;
  const companyName =
    localStorage.getItem("accounts-company-name") || "Dhaulagiri Accounts";
  const fiscalYear = localStorage.getItem("accounts-fiscal-year") || "-";
  const blob = new Blob(
    [
      buildLedgerPdf({
        companyName,
        fiscalYear,
        generatedDate: reportDate,
        party,
        rows: ledgerRows.map((row) => ({
          balance: formatNumber(row.balance),
          credit: row.credit ? formatNumber(row.credit) : "-",
          date: row.dateBs || "-",
          debit: row.debit ? formatNumber(row.debit) : "-",
          particulars: [row.type, row.reference].filter(Boolean).join(" - "),
        })),
      }),
    ],
    { type: "application/pdf" }
  );

  await saveBlob(filename, blob, {
    description: "PDF Document",
    mimeType: "application/pdf",
    extensions: [".pdf"],
  });
}

function buildLedgerPdf({
  companyName,
  fiscalYear,
  generatedDate,
  party,
  rows,
}: {
  companyName: string;
  fiscalYear: string;
  generatedDate: string;
  party: Party;
  rows: LedgerPdfRow[];
}) {
  const tableWidth = columns.reduce((sum, column) => sum + column.width, 0);
  const firstPageRows = 27;
  const nextPageRows = 34;
  const chunks: LedgerPdfRow[][] = [];
  let remaining = rows.length ? [...rows] : [emptyLedgerRow()];

  chunks.push(remaining.slice(0, firstPageRows));
  remaining = remaining.slice(firstPageRows);

  while (remaining.length) {
    chunks.push(remaining.slice(0, nextPageRows));
    remaining = remaining.slice(nextPageRows);
  }

  const pages = chunks.map((pageRows, pageIndex) => {
    const isFirstPage = pageIndex === 0;
    const ops: string[] = [
      "0.2 w",
      centeredText(companyName || "Company", TOP, 18, "F2"),
      centeredText("Party Ledger", TOP - 22, 12, "F2"),
    ];
    let y = TOP - 54;

    if (isFirstPage) {
      ops.push(
        pdfText(`Fiscal Year: ${fiscalYear || "-"}`, LEFT, y, 9),
        pdfText(`Party: ${party.name}`, LEFT, y - 16, 9),
        pdfText(`PAN/VAT: ${party.panNo || "-"}`, LEFT + 270, y - 16, 9),
        pdfText(`Generated: ${generatedDate}`, LEFT + 270, y, 9)
      );
      y -= 48;
    }

    const tableTopY = y + 8;
    ops.push(pdfLine(LEFT, tableTopY, LEFT + tableWidth, tableTopY));

    columns.forEach((column) => {
      ops.push(pdfText(column.label, column.x + 4, y - 4, 8, "F2"));
    });

    ops.push(pdfLine(LEFT, y - 12, LEFT + tableWidth, y - 12));
    y -= 28;

    pageRows.forEach((row) => {
      const values = [
        fitText(row.date || "-", columns[0].max),
        fitText(row.particulars || "-", columns[1].max),
        fitText(row.debit || "-", columns[2].max),
        fitText(row.credit || "-", columns[3].max),
        fitText(row.balance || "-", columns[4].max),
      ];

      values.forEach((value, index) => {
        const column = columns[index];
        const textWidth = value.length * 3.8;
        const x =
          column.align === "right"
            ? column.x + column.width - 4 - textWidth
            : column.x + 4;
        ops.push(pdfText(value, Math.max(column.x + 4, x), y, 8));
      });

      ops.push(pdfLine(LEFT, y - 7, LEFT + tableWidth, y - 7));
      y -= ROW_HEIGHT;
    });

    const verticalTop = isFirstPage ? TOP - 94 : TOP - 66;
    columns.reduce((x, column) => {
      ops.push(pdfLine(x, verticalTop, x, y + ROW_HEIGHT - 7));
      return x + column.width;
    }, LEFT);
    ops.push(
      pdfLine(LEFT + tableWidth, verticalTop, LEFT + tableWidth, y + ROW_HEIGHT - 7)
    );
    ops.push(pdfText(`Page ${pageIndex + 1} of ${chunks.length}`, PAGE_WIDTH - 90, 28, 8));

    return ops.join("\n");
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
      `<< /Type /Page /Parent 2 0 R /MediaBox [0 0 ${PAGE_WIDTH} ${PAGE_HEIGHT}] /Resources << /Font << /F1 3 0 R /F2 4 0 R >> >> /Contents ${contentObjectNumber} 0 R >>`;
    objects[contentObjectNumber - 1] =
      `<< /Length ${content.length} >>\nstream\n${content}\nendstream`;
  });

  objects[1] =
    `<< /Type /Pages /Kids [${pageObjectNumbers.map((number) => `${number} 0 R`).join(" ")}] /Count ${pageObjectNumbers.length} >>`;

  return writePdf(objects);
}

function emptyLedgerRow(): LedgerPdfRow {
  return {
    balance: "-",
    credit: "-",
    date: "-",
    debit: "-",
    particulars: "No ledger entries found",
  };
}

function pdfSafe(value: string) {
  return value
    .replace(/[^\x20-\x7E]/g, "?")
    .replace(/\\/g, "\\\\")
    .replace(/\(/g, "\\(")
    .replace(/\)/g, "\\)");
}

function fitText(value: string, maxLength: number) {
  const text = value || "-";
  return text.length > maxLength ? `${text.slice(0, Math.max(0, maxLength - 3))}...` : text;
}

function pdfText(text: string, x: number, y: number, size = 9, font = "F1") {
  return `BT /${font} ${size} Tf ${x} ${y} Td (${pdfSafe(text)}) Tj ET`;
}

function pdfLine(x1: number, y1: number, x2: number, y2: number) {
  return `${x1} ${y1} m ${x2} ${y2} l S`;
}

function centeredText(text: string, y: number, size = 16, font = "F2") {
  const width = text.length * size * 0.28;
  return pdfText(text, Math.max(40, 297 - width), y, size, font);
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

  pdf +=
    `trailer\n<< /Size ${objects.length + 1} /Root 1 0 R >>\nstartxref\n${xrefOffset}\n%%EOF`;

  return pdf;
}

function formatNumber(value: number) {
  return Number(value || 0).toLocaleString("en-IN", {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  });
}

function todayForFileName() {
  return new Date().toISOString().slice(0, 10);
}

function safeFilename(value: string) {
  return value.trim().replace(/[<>:"/\\|?*]+/g, "-").replace(/\s+/g, " ") || "party";
}
