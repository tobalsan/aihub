import fs from "node:fs/promises";
import mammoth from "mammoth";
import { PDFParse } from "pdf-parse";
import * as XLSX from "xlsx";

const RAW_TEXT_MIME_TYPES = new Set([
  "text/csv",
  "text/markdown",
  "text/plain",
]);

const SPREADSHEET_MIME_TYPES = new Set([
  "application/vnd.ms-excel",
  "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
]);

export async function extractText(
  filePath: string,
  mimeType: string
): Promise<string | null> {
  if (RAW_TEXT_MIME_TYPES.has(mimeType)) {
    return fs.readFile(filePath, "utf8");
  }

  if (mimeType === "application/pdf") {
    return extractPdfText(filePath);
  }

  if (
    mimeType ===
    "application/vnd.openxmlformats-officedocument.wordprocessingml.document"
  ) {
    const result = await mammoth.extractRawText({ path: filePath });
    return result.value;
  }

  if (SPREADSHEET_MIME_TYPES.has(mimeType)) {
    return extractSpreadsheetText(filePath);
  }

  return null;
}

async function extractPdfText(filePath: string): Promise<string> {
  const buffer = await fs.readFile(filePath);
  const parser = new PDFParse({ data: new Uint8Array(buffer) });

  try {
    const result = await parser.getText();
    return result.text;
  } finally {
    await parser.destroy();
  }
}

function extractSpreadsheetText(filePath: string): string {
  const workbook = XLSX.readFile(filePath);

  return workbook.SheetNames.map((sheetName) => {
    const sheet = workbook.Sheets[sheetName];
    const csv = XLSX.utils.sheet_to_csv(sheet);
    return `# ${sheetName}\n${csv}`;
  }).join("\n\n");
}
