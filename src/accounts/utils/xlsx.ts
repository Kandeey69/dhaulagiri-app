import { saveBlob } from "./fileSave";

type CellValue = string | number;
type ZipEntry = {
  method: number;
  compressedData: Uint8Array;
};

const CONTENT_TYPES_XML = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">
  <Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>
  <Default Extension="xml" ContentType="application/xml"/>
  <Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/>
  <Override PartName="/xl/worksheets/sheet1.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/>
  <Override PartName="/xl/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.styles+xml"/>
</Types>`;

const ROOT_RELS_XML = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
  <Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="xl/workbook.xml"/>
</Relationships>`;

const WORKBOOK_RELS_XML = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
  <Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet1.xml"/>
  <Relationship Id="rId2" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles" Target="styles.xml"/>
</Relationships>`;

const STYLES_XML = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<styleSheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main">
  <fonts count="2"><font><sz val="11"/><name val="Calibri"/></font><font><b/><sz val="11"/><name val="Calibri"/></font></fonts>
  <fills count="1"><fill><patternFill patternType="none"/></fill></fills>
  <borders count="1"><border><left/><right/><top/><bottom/><diagonal/></border></borders>
  <cellStyleXfs count="1"><xf numFmtId="0" fontId="0" fillId="0" borderId="0"/></cellStyleXfs>
  <cellXfs count="2"><xf numFmtId="0" fontId="0" fillId="0" borderId="0" xfId="0"/><xf numFmtId="0" fontId="1" fillId="0" borderId="0" xfId="0"/></cellXfs>
</styleSheet>`;

const CRC_TABLE = createCrcTable();

export async function downloadXlsx(filename: string, sheetName: string, rows: CellValue[][]) {
  const safeFilename = filename.endsWith(".xlsx") ? filename : `${filename}.xlsx`;
  const files = [
    { name: "[Content_Types].xml", data: textBytes(CONTENT_TYPES_XML) },
    { name: "_rels/.rels", data: textBytes(ROOT_RELS_XML) },
    { name: "xl/workbook.xml", data: textBytes(buildWorkbookXml(sheetName)) },
    { name: "xl/_rels/workbook.xml.rels", data: textBytes(WORKBOOK_RELS_XML) },
    { name: "xl/worksheets/sheet1.xml", data: textBytes(buildSheetXml(rows)) },
    { name: "xl/styles.xml", data: textBytes(STYLES_XML) },
  ];

  const workbook = createZip(files);
  const blob = new Blob([workbook], {
    type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
  });
  await saveBlob(safeFilename, blob, {
    description: "Excel Workbook",
    mimeType: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
    extensions: [".xlsx"],
  });
}

export async function readXlsxRows(file: File): Promise<string[][]> {
  if (!file.name.toLowerCase().endsWith(".xlsx")) {
    throw new Error("Please upload an .xlsx Excel file.");
  }

  const entries = await readZipEntries(new Uint8Array(await file.arrayBuffer()));
  const sheet = entries.get("xl/worksheets/sheet1.xml");

  if (!sheet) {
    throw new Error("Could not find Sheet1 in the Excel file.");
  }

  const sharedStringsEntry = entries.get("xl/sharedStrings.xml");
  const sharedStrings = sharedStringsEntry
    ? parseSharedStrings(await inflateEntry(sharedStringsEntry))
    : [];

  return parseSheetRows(await inflateEntry(sheet), sharedStrings);
}

function buildWorkbookXml(sheetName: string) {
  return `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships">
  <sheets><sheet name="${escapeXml(sheetName)}" sheetId="1" r:id="rId1"/></sheets>
</workbook>`;
}

function buildSheetXml(rows: CellValue[][]) {
  const sheetRows = rows
    .map((row, rowIndex) => {
      const rowNumber = rowIndex + 1;
      const cells = row
        .map((cell, columnIndex) => buildCell(cell, columnName(columnIndex + 1), rowNumber, rowIndex === 0))
        .join("");
      return `<row r="${rowNumber}">${cells}</row>`;
    })
    .join("");

  return `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main">
  <sheetData>${sheetRows}</sheetData>
</worksheet>`;
}

function buildCell(value: CellValue, column: string, row: number, isHeader: boolean) {
  const style = isHeader ? ' s="1"' : "";

  if (typeof value === "number") {
    return `<c r="${column}${row}"${style}><v>${value}</v></c>`;
  }

  return `<c r="${column}${row}" t="inlineStr"${style}><is><t>${escapeXml(value)}</t></is></c>`;
}

function columnName(index: number) {
  let name = "";
  let current = index;

  while (current > 0) {
    current -= 1;
    name = String.fromCharCode(65 + (current % 26)) + name;
    current = Math.floor(current / 26);
  }

  return name;
}

function textBytes(value: string) {
  return new TextEncoder().encode(value);
}

function escapeXml(value: string) {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&apos;");
}

function parseSharedStrings(xmlText: string) {
  const xml = new DOMParser().parseFromString(xmlText, "application/xml");
  return Array.from(xml.getElementsByTagName("si")).map((item) =>
    Array.from(item.getElementsByTagName("t"))
      .map((text) => text.textContent ?? "")
      .join("")
  );
}

function parseSheetRows(xmlText: string, sharedStrings: string[]) {
  const xml = new DOMParser().parseFromString(xmlText, "application/xml");
  const rows: string[][] = [];

  for (const row of Array.from(xml.getElementsByTagName("row"))) {
    const values: string[] = [];

    for (const cell of Array.from(row.getElementsByTagName("c"))) {
      const reference = cell.getAttribute("r") ?? "";
      const columnIndex = reference ? columnIndexFromReference(reference) : values.length;
      values[columnIndex] = parseCellValue(cell, sharedStrings);
    }

    rows.push(values.map((value) => value ?? ""));
  }

  return rows;
}

function parseCellValue(cell: Element, sharedStrings: string[]) {
  const type = cell.getAttribute("t");

  if (type === "inlineStr") {
    return Array.from(cell.getElementsByTagName("t"))
      .map((text) => text.textContent ?? "")
      .join("");
  }

  const rawValue = cell.getElementsByTagName("v")[0]?.textContent ?? "";

  if (type === "s") {
    return sharedStrings[Number(rawValue)] ?? "";
  }

  return rawValue;
}

function columnIndexFromReference(reference: string) {
  const letters = reference.match(/[A-Z]+/i)?.[0].toUpperCase() ?? "";
  let index = 0;

  for (const letter of letters) {
    index = index * 26 + letter.charCodeAt(0) - 64;
  }

  return Math.max(index - 1, 0);
}

async function readZipEntries(bytes: Uint8Array) {
  const entries = new Map<string, ZipEntry>();
  const endOfCentralDirectory = findEndOfCentralDirectory(bytes);
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const entryCount = view.getUint16(endOfCentralDirectory + 10, true);
  let offset = view.getUint32(endOfCentralDirectory + 16, true);

  for (let i = 0; i < entryCount; i += 1) {
    if (view.getUint32(offset, true) !== 0x02014b50) {
      throw new Error("Invalid Excel file.");
    }

    const method = view.getUint16(offset + 10, true);
    const compressedSize = view.getUint32(offset + 20, true);
    const nameLength = view.getUint16(offset + 28, true);
    const extraLength = view.getUint16(offset + 30, true);
    const commentLength = view.getUint16(offset + 32, true);
    const localHeaderOffset = view.getUint32(offset + 42, true);
    const name = decodeText(bytes.slice(offset + 46, offset + 46 + nameLength));

    const localNameLength = view.getUint16(localHeaderOffset + 26, true);
    const localExtraLength = view.getUint16(localHeaderOffset + 28, true);
    const dataStart = localHeaderOffset + 30 + localNameLength + localExtraLength;

    entries.set(name, {
      method,
      compressedData: bytes.slice(dataStart, dataStart + compressedSize),
    });

    offset += 46 + nameLength + extraLength + commentLength;
  }

  return entries;
}

function findEndOfCentralDirectory(bytes: Uint8Array) {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);

  for (let offset = bytes.length - 22; offset >= 0; offset -= 1) {
    if (view.getUint32(offset, true) === 0x06054b50) {
      return offset;
    }
  }

  throw new Error("Invalid Excel file.");
}

async function inflateEntry(entry: ZipEntry) {
  if (entry.method === 0) {
    return decodeText(entry.compressedData);
  }

  if (entry.method === 8 && "DecompressionStream" in window) {
    const stream = new Blob([arrayBufferFromBytes(entry.compressedData)]).stream();
    const inflated = stream.pipeThrough(new DecompressionStream("deflate-raw"));
    return decodeText(new Uint8Array(await new Response(inflated).arrayBuffer()));
  }

  throw new Error("This Excel file uses unsupported compression.");
}

function decodeText(bytes: Uint8Array) {
  return new TextDecoder().decode(bytes);
}

function arrayBufferFromBytes(bytes: Uint8Array) {
  return bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) as ArrayBuffer;
}

function createZip(files: { name: string; data: Uint8Array }[]) {
  const localFiles: Uint8Array[] = [];
  const centralDirectory: Uint8Array[] = [];
  let offset = 0;

  for (const file of files) {
    const name = textBytes(file.name);
    const crc = crc32(file.data);
    const localHeader = header(30);
    localHeader.setUint32(0, 0x04034b50, true);
    localHeader.setUint16(4, 20, true);
    localHeader.setUint16(6, 0, true);
    localHeader.setUint16(8, 0, true);
    localHeader.setUint16(10, 0, true);
    localHeader.setUint16(12, 0, true);
    localHeader.setUint32(14, crc, true);
    localHeader.setUint32(18, file.data.length, true);
    localHeader.setUint32(22, file.data.length, true);
    localHeader.setUint16(26, name.length, true);
    localHeader.setUint16(28, 0, true);

    localFiles.push(toBytes(localHeader), name, file.data);

    const centralHeader = header(46);
    centralHeader.setUint32(0, 0x02014b50, true);
    centralHeader.setUint16(4, 20, true);
    centralHeader.setUint16(6, 20, true);
    centralHeader.setUint16(8, 0, true);
    centralHeader.setUint16(10, 0, true);
    centralHeader.setUint16(12, 0, true);
    centralHeader.setUint16(14, 0, true);
    centralHeader.setUint32(16, crc, true);
    centralHeader.setUint32(20, file.data.length, true);
    centralHeader.setUint32(24, file.data.length, true);
    centralHeader.setUint16(28, name.length, true);
    centralHeader.setUint16(30, 0, true);
    centralHeader.setUint16(32, 0, true);
    centralHeader.setUint16(34, 0, true);
    centralHeader.setUint16(36, 0, true);
    centralHeader.setUint32(38, 0, true);
    centralHeader.setUint32(42, offset, true);
    centralDirectory.push(toBytes(centralHeader), name);

    offset += localHeader.byteLength + name.length + file.data.length;
  }

  const centralDirectorySize = byteLength(centralDirectory);
  const endOfDirectory = header(22);
  endOfDirectory.setUint32(0, 0x06054b50, true);
  endOfDirectory.setUint16(8, files.length, true);
  endOfDirectory.setUint16(10, files.length, true);
  endOfDirectory.setUint32(12, centralDirectorySize, true);
  endOfDirectory.setUint32(16, offset, true);
  endOfDirectory.setUint16(20, 0, true);

  return concatBytes([...localFiles, ...centralDirectory, toBytes(endOfDirectory)]);
}

function header(length: number) {
  return new DataView(new ArrayBuffer(length));
}

function toBytes(view: DataView) {
  return new Uint8Array(view.buffer);
}

function byteLength(parts: Uint8Array[]) {
  return parts.reduce((total, part) => total + part.length, 0);
}

function concatBytes(parts: Uint8Array[]) {
  const output = new Uint8Array(byteLength(parts));
  let position = 0;

  for (const part of parts) {
    output.set(part, position);
    position += part.length;
  }

  return output;
}

function createCrcTable() {
  const table = new Uint32Array(256);

  for (let i = 0; i < 256; i += 1) {
    let value = i;

    for (let j = 0; j < 8; j += 1) {
      value = value & 1 ? 0xedb88320 ^ (value >>> 1) : value >>> 1;
    }

    table[i] = value >>> 0;
  }

  return table;
}

function crc32(bytes: Uint8Array) {
  let crc = 0xffffffff;

  for (const byte of bytes) {
    crc = CRC_TABLE[(crc ^ byte) & 0xff] ^ (crc >>> 8);
  }

  return (crc ^ 0xffffffff) >>> 0;
}
