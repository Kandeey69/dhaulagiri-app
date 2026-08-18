import type { LetterheadSettings } from "./letterheadSettings";
import { saveBlob } from "./fileSave";

export type ThirdPartyConfirmationSummary = {
  adjustmentTotal: number;
  closingBalance: number;
  collectionReceived: number;
  openingBalance: number;
  taxableSale: number;
  totalSale: number;
  vatAmount: number;
};

export type ThirdPartyConfirmationData = {
  companyAddress: string;
  companyName: string;
  companyPanVatNo: string;
  companyPhoneNumbers: string;
  fiscalYear: string;
  letterhead: LetterheadSettings;
  partyAddress: string;
  partyName: string;
  partyPanVatNo: string;
  summary: ThirdPartyConfirmationSummary;
};

type PdfImage = {
  bytes: Uint8Array;
  height: number;
  width: number;
};

const PAGE_WIDTH = 595;
const PAGE_HEIGHT = 842;
const LEFT = 50;
const RIGHT = 50;
const FONT = {
  regular: "F1",
  bold: "F2",
};

export async function saveThirdPartyConfirmationPdf(data: ThirdPartyConfirmationData) {
  const blob = await buildThirdPartyConfirmationPdf(data);
  await saveBlob(`${safeFilename(data.partyName)}_third-party-confirmation.pdf`, blob, {
    description: "PDF Document",
    mimeType: "application/pdf",
    extensions: [".pdf"],
  });
}

async function buildThirdPartyConfirmationPdf(data: ThirdPartyConfirmationData) {
  const image = buildLetterheadImage(data);
  const ops: string[] = ["0.25 w"];
  const maxImageWidth = PAGE_WIDTH - LEFT - RIGHT;
  const imageHeight = Math.min(150, maxImageWidth * (image.height / image.width));
  const imageWidth = imageHeight * (image.width / image.height);
  const imageX = (PAGE_WIDTH - imageWidth) / 2;
  const imageY = PAGE_HEIGHT - 26 - imageHeight;
  let y = imageY - 24;

  ops.push(`q ${imageWidth.toFixed(2)} 0 0 ${imageHeight.toFixed(2)} ${imageX.toFixed(2)} ${imageY.toFixed(2)} cm /Im1 Do Q`);

  y = drawTextBlock(ops, [
    "To,",
    data.partyName,
    data.partyAddress,
    data.partyPanVatNo ? `VAT/PAN: ${data.partyPanVatNo}` : "",
  ], LEFT, y, 10, 14);

  y -= 8;
  ops.push(centeredText(`Subject: Confirmation of transaction and balance of F.Y. ${data.fiscalYear || "-"}`, y, 10, FONT.bold));
  y -= 28;

  ops.push(pdfText("Dear Sir,", LEFT, y, 10));
  y -= 18;

  y = drawWrappedText(
    ops,
    `We are including following transaction value and balances in our Annual ${data.fiscalYear || "-"}. Please send us your acknowledgement to inform us for variations if any or else we regard your acceptance for the same.`,
    LEFT + 28,
    y,
    PAGE_WIDTH - LEFT - RIGHT - 28,
    10,
    15,
  );

  y -= 12;
  y = drawSummaryTable(ops, data.summary, y);

  y -= 18;
  y = drawWrappedText(ops, confirmationContactLine(data), LEFT, y, PAGE_WIDTH - LEFT - RIGHT, 9, 13);

  y -= 48;
  ops.push(pdfText("Thanks you", LEFT, y, 10));
  y -= 16;
  ops.push(pdfText("For,", LEFT, y, 10));
  y -= 70;
  ops.push(pdfText(data.companyName || "Company", LEFT, y, 9, FONT.bold));
  y -= 14;
  if (data.companyAddress) {
    y = drawWrappedText(ops, data.companyAddress, LEFT, y, 220, 8, 12);
  }
  if (data.companyPanVatNo) {
    ops.push(pdfText(`VAT/PAN: ${data.companyPanVatNo}`, LEFT, y, 8));
  }
  ops.push(pdfText("Acknowledged By", PAGE_WIDTH - RIGHT - 145, y + 26, 10));

  ops.push(pdfText("Page 1 of 1", PAGE_WIDTH - 95, 26, 8));

  const content = ops.join("\n");
  const contentLength = encodeAscii(content).length;
  const resources = "/Font << /F1 3 0 R /F2 4 0 R >> /XObject << /Im1 5 0 R >>";
  const pageObjectNumber = 6;
  const contentObjectNumber = 7;

  const objects: (string | Uint8Array)[] = [
    "<< /Type /Catalog /Pages 2 0 R >>",
    `<< /Type /Pages /Kids [${pageObjectNumber} 0 R] /Count 1 >>`,
    "<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>",
    "<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica-Bold >>",
  ];

  objects.push(pdfImageObject(image));

  objects.push(`<< /Type /Page /Parent 2 0 R /MediaBox [0 0 ${PAGE_WIDTH} ${PAGE_HEIGHT}] /Resources << ${resources} >> /Contents ${contentObjectNumber} 0 R >>`);
  objects.push(`<< /Length ${contentLength} >>\nstream\n${content}\nendstream`);

  return new Blob([writePdfBytes(objects)], { type: "application/pdf" });
}

function drawSummaryTable(ops: string[], summary: ThirdPartyConfirmationSummary, startY: number) {
  const tableWidth = 330;
  const tableLeft = (PAGE_WIDTH - tableWidth) / 2;
  const particularsWidth = 205;
  const amountWidth = tableWidth - particularsWidth;
  const rowHeight = 20;
  const rows = [
    ["Previous FY closing/opening balance", summary.openingBalance],
    ["Total sale of the year", summary.totalSale],
    ["Taxable sale", summary.taxableSale],
    ["VAT amount", summary.vatAmount],
    ["Less: collection received", -Math.abs(summary.collectionReceived)],
  ];

  if (Math.abs(summary.adjustmentTotal) > 0) {
    rows.push(["Less: credit notes/adjustments", -Math.abs(summary.adjustmentTotal)]);
  }

  rows.push(["Closing balance", summary.closingBalance]);

  let y = startY;
  ops.push(pdfRect(tableLeft, y - rowHeight, tableWidth, rowHeight));
  ops.push(pdfLine(tableLeft + particularsWidth, y, tableLeft + particularsWidth, y - rowHeight));
  ops.push(centeredTextAt("Particulars", tableLeft + particularsWidth / 2, y - 13, 9, FONT.bold));
  ops.push(centeredTextAt("Amount (NPR)", tableLeft + particularsWidth + amountWidth / 2, y - 13, 9, FONT.bold));
  y -= rowHeight;

  rows.forEach(([label, amount], index) => {
    const isClosing = index === rows.length - 1;
    ops.push(pdfRect(tableLeft, y - rowHeight, tableWidth, rowHeight));
    ops.push(pdfLine(tableLeft + particularsWidth, y, tableLeft + particularsWidth, y - rowHeight));
    ops.push(centeredTextAt(String(label), tableLeft + particularsWidth / 2, y - 13, 8, isClosing ? FONT.bold : FONT.regular));
    ops.push(rightText(formatMoney(Number(amount)), tableLeft + tableWidth - 8, y - 13, 8, isClosing ? FONT.bold : FONT.regular));
    y -= rowHeight;
  });

  return y;
}

function drawTextBlock(ops: string[], lines: string[], x: number, y: number, size: number, lineHeight: number) {
  let cursor = y;
  lines.filter((line) => line.trim()).forEach((line) => {
    ops.push(pdfText(line, x, cursor, size));
    cursor -= lineHeight;
  });
  return cursor;
}

function drawWrappedText(
  ops: string[],
  text: string,
  x: number,
  y: number,
  width: number,
  size: number,
  lineHeight: number,
  align: "left" | "center" = "left",
) {
  const words = text.replace(/\s+/g, " ").trim().split(" ").filter(Boolean);
  const maxChars = Math.max(16, Math.floor(width / (size * 0.52)));
  const lines: string[] = [];
  let current = "";

  words.forEach((word) => {
    const next = current ? `${current} ${word}` : word;
    if (next.length > maxChars && current) {
      lines.push(current);
      current = word;
    } else {
      current = next;
    }
  });

  if (current) {
    lines.push(current);
  }

  let cursor = y;
  lines.forEach((line) => {
    if (align === "center") {
      ops.push(centeredTextAt(line, x + width / 2, cursor, size));
    } else {
      ops.push(pdfText(line, x, cursor, size));
    }
    cursor -= lineHeight;
  });

  return cursor;
}

function pdfImageObject(image: PdfImage) {
  const header = encodeAscii(
    `<< /Type /XObject /Subtype /Image /Width ${image.width} /Height ${image.height} /ColorSpace /DeviceRGB /BitsPerComponent 8 /Filter /DCTDecode /Length ${image.bytes.length} >>\nstream\n`,
  );
  const footer = encodeAscii("\nendstream");
  return concatBytes([header, image.bytes, footer]);
}

function buildLetterheadImage(data: ThirdPartyConfirmationData): PdfImage {
  const canvas = document.createElement("canvas");
  canvas.width = 1100;
  canvas.height = 235;
  const context = canvas.getContext("2d");

  if (!context) {
    throw new Error("Could not prepare the letterhead image for PDF export.");
  }

  context.fillStyle = "#ffffff";
  context.fillRect(0, 0, canvas.width, canvas.height);
  context.fillStyle = "#0f172a";
  context.textBaseline = "top";

  context.font = "700 18px Arial, sans-serif";
  if (data.companyPanVatNo) {
    context.fillText(`VAT/PAN: ${data.companyPanVatNo}`, 56, 28);
  }

  if (data.companyPhoneNumbers) {
    drawCanvasRightText(context, `Mob. No. ${data.companyPhoneNumbers}`, 1044, 28);
  }

  let y = 60;
  const nepaliCompanyName = data.letterhead.nepaliCompanyName.trim();
  if (nepaliCompanyName) {
    context.fillStyle = "#0f3d8f";
    context.font = "700 39px Mangal, Noto Sans Devanagari, Arial, sans-serif";
    drawCanvasCenteredText(context, nepaliCompanyName, 550, y);
    y += 45;
  }

  context.fillStyle = "#0f3d8f";
  context.font = "700 37px Arial, sans-serif";
  drawCanvasCenteredText(context, data.companyName || "Company", 550, y);
  y += 43;

  if (data.companyAddress) {
    context.fillStyle = "#0f172a";
    context.font = "600 20px Arial, sans-serif";
    data.companyAddress
      .split(/\r?\n/)
      .map((line) => line.trim())
      .filter(Boolean)
      .slice(0, 2)
      .forEach((line) => {
        drawCanvasCenteredText(context, line, 550, y);
        y += 24;
      });
  }

  context.font = "700 18px Arial, sans-serif";
  context.fillText("Ref No.:", 56, 186);
  context.fillText("Date: ........................", 800, 186);
  context.strokeStyle = "#111827";
  context.lineWidth = 2;
  context.beginPath();
  context.moveTo(56, 220);
  context.lineTo(1044, 220);
  context.stroke();

  const jpegDataUrl = canvas.toDataURL("image/jpeg", 0.92);
  const base64 = jpegDataUrl.split(",")[1] || "";
  return {
    bytes: base64ToBytes(base64),
    height: canvas.height,
    width: canvas.width,
  };
}

function drawCanvasCenteredText(context: CanvasRenderingContext2D, text: string, centerX: number, y: number) {
  const metrics = context.measureText(text);
  context.fillText(text, centerX - metrics.width / 2, y);
}

function drawCanvasRightText(context: CanvasRenderingContext2D, text: string, rightX: number, y: number) {
  const metrics = context.measureText(text);
  context.fillText(text, rightX - metrics.width, y);
}

function confirmationContactLine(data: ThirdPartyConfirmationData) {
  const saved = data.letterhead.contactLine.trim();

  if (saved) {
    return saved;
  }

  return data.companyPhoneNumbers
    ? `Should you have any queries please feel free to contact us at ${data.companyPhoneNumbers}.`
    : "Should you have any queries please feel free to contact us.";
}

function base64ToBytes(base64: string) {
  const binary = atob(base64);
  const bytes = new Uint8Array(binary.length);

  for (let index = 0; index < binary.length; index += 1) {
    bytes[index] = binary.charCodeAt(index);
  }

  return bytes;
}

function pdfSafe(value: string) {
  return value
    .replace(/[^\x20-\x7E]/g, "?")
    .replace(/\\/g, "\\\\")
    .replace(/\(/g, "\\(")
    .replace(/\)/g, "\\)");
}

function pdfText(text: string, x: number, y: number, size = 9, font = FONT.regular) {
  return `BT /${font} ${size} Tf ${x.toFixed(2)} ${y.toFixed(2)} Td (${pdfSafe(text)}) Tj ET`;
}

function rightText(text: string, rightX: number, y: number, size = 9, font = FONT.regular) {
  const width = text.length * size * 0.5;
  return pdfText(text, rightX - width, y, size, font);
}

function centeredText(text: string, y: number, size = 14, font = FONT.bold) {
  return centeredTextAt(text, PAGE_WIDTH / 2, y, size, font);
}

function centeredTextAt(text: string, centerX: number, y: number, size = 9, font = FONT.regular) {
  const width = text.length * size * 0.28;
  return pdfText(text, centerX - width, y, size, font);
}

function pdfLine(x1: number, y1: number, x2: number, y2: number) {
  return `${x1.toFixed(2)} ${y1.toFixed(2)} m ${x2.toFixed(2)} ${y2.toFixed(2)} l S`;
}

function pdfRect(x: number, y: number, width: number, height: number) {
  return `${x.toFixed(2)} ${y.toFixed(2)} ${width.toFixed(2)} ${height.toFixed(2)} re S`;
}

function writePdfBytes(objects: (string | Uint8Array)[]) {
  const parts: Uint8Array[] = [];
  const offsets = [0];
  let length = 0;
  const push = (part: string | Uint8Array) => {
    const bytes = typeof part === "string" ? encodeAscii(part) : part;
    parts.push(bytes);
    length += bytes.length;
  };

  push("%PDF-1.4\n");

  objects.forEach((object, index) => {
    offsets[index + 1] = length;
    push(`${index + 1} 0 obj\n`);
    push(object);
    push("\nendobj\n");
  });

  const xrefOffset = length;
  push(`xref\n0 ${objects.length + 1}\n`);
  push("0000000000 65535 f \n");

  offsets.slice(1).forEach((offset) => {
    push(`${String(offset).padStart(10, "0")} 00000 n \n`);
  });

  push(`trailer\n<< /Size ${objects.length + 1} /Root 1 0 R >>\nstartxref\n${xrefOffset}\n%%EOF`);

  return concatBytes(parts);
}

function encodeAscii(value: string) {
  const bytes = new Uint8Array(value.length);

  for (let index = 0; index < value.length; index += 1) {
    bytes[index] = value.charCodeAt(index) & 0xff;
  }

  return bytes;
}

function concatBytes(parts: Uint8Array[]) {
  const total = parts.reduce((sum, part) => sum + part.length, 0);
  const output = new Uint8Array(total);
  let offset = 0;

  parts.forEach((part) => {
    output.set(part, offset);
    offset += part.length;
  });

  return output;
}

function formatMoney(value: number) {
  return Number(value || 0).toLocaleString("en-IN", {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  });
}

function safeFilename(value: string) {
  return value.trim().replace(/[<>:"/\\|?*]+/g, "-").replace(/\s+/g, "-") || "party";
}
