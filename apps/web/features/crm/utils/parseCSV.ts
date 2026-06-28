import { parseCsvRows } from "@/lib/crm/csv";

export interface ParsedCSV {
  headers: string[];
  rows: Record<string, string>[];
  rowCount: number;
}

/**
 * Client-side CSV parser for the import modal preview step.
 * Handles quoted fields, commas inside quotes, and escaped double-quotes.
 */
export function parseCSVClient(text: string): ParsedCSV {
  const { headers, rows } = parseCsvRows(text);
  return { headers, rows, rowCount: rows.length };
}

export function validateCSVHeaders(headers: string[]): {
  valid: boolean;
  missing: string[];
} {
  const required = ["email", "name"];
  const missing = required.filter((r) => !headers.includes(r));
  return { valid: missing.length === 0, missing };
}
