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
  const lines = text.trim().split(/\r?\n/);
  if (lines.length < 2) return { headers: [], rows: [], rowCount: 0 };

  function splitLine(line: string): string[] {
    const result: string[] = [];
    let current = "";
    let inQuotes = false;
    for (let i = 0; i < line.length; i++) {
      const ch = line[i];
      if (ch === '"') {
        if (inQuotes && line[i + 1] === '"') {
          current += '"';
          i++;
        } else {
          inQuotes = !inQuotes;
        }
      } else if (ch === "," && !inQuotes) {
        result.push(current.trim());
        current = "";
      } else {
        current += ch;
      }
    }
    result.push(current.trim());
    return result;
  }

  const headers = splitLine(lines[0]).map((h) => h.toLowerCase().trim());
  const rows = lines.slice(1).map((line) => {
    const values = splitLine(line);
    const row: Record<string, string> = {};
    headers.forEach((h, i) => {
      row[h] = values[i] ?? "";
    });
    return row;
  });

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
