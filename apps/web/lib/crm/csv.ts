/**
 * Shared CSV tokenizer + row parser for the CRM import flow. Used by both the
 * server importer (`lib/crm/importService.parseCSV`) and the client preview
 * (`features/crm/utils/parseCSV.parseCSVClient`), so the two never drift.
 *
 * Handles quoted fields, commas inside quotes, and escaped double-quotes ("").
 */

/** Split a single CSV line into trimmed fields, honouring quotes. */
function splitCsvLine(line: string): string[] {
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

/**
 * Parse CSV text into lowercased headers + keyed rows. Returns empty arrays when
 * there are fewer than 2 lines (a header plus at least one data row).
 */
export function parseCsvRows(text: string): { headers: string[]; rows: Record<string, string>[] } {
  const lines = text.trim().split(/\r?\n/);
  if (lines.length < 2) return { headers: [], rows: [] };

  const headers = splitCsvLine(lines[0]).map((h) => h.toLowerCase().trim());
  const rows = lines.slice(1).map((line) => {
    const values = splitCsvLine(line);
    const row: Record<string, string> = {};
    headers.forEach((h, i) => {
      row[h] = values[i] ?? "";
    });
    return row;
  });

  return { headers, rows };
}
