'use client';
import { useState, useEffect } from 'react';
import { fetchJson } from '@/lib/fetchJson';
import type { ResourceChange } from '@/lib/types';

interface SpreadsheetViewerProps {
  resourceId: string;
  /** The change list a parent already holds; the viewer reads it instead of
   *  asking for the same rows again. Absent, it fetches its own. */
  changes?: ResourceChange[];
  fileUrl: string;
  onCellSelect: (cellRef: string, value: string) => void;
  selectedCell: string | null;
}

type CellData = (string | number | null)[][];

export default function SpreadsheetViewer({ resourceId, changes: givenChanges, fileUrl, onCellSelect, selectedCell }: SpreadsheetViewerProps) {
  const [sheets, setSheets] = useState<Record<string, CellData>>({});
  const [sheetNames, setSheetNames] = useState<string[]>([]);
  const [activeSheet, setActiveSheet] = useState<string>('');
  const [ownChanges, setOwnChanges] = useState<ResourceChange[]>([]);
  const changes = givenChanges ?? ownChanges;
  const [loading, setLoading] = useState(true);
  const [truncated, setTruncated] = useState(false);

  useEffect(() => {
    async function load() {
      setLoading(true);
      try {
        const XLSX = await import('xlsx');
        const res = await fetch(fileUrl);
        const buf = await res.arrayBuffer();
        const wb = XLSX.read(buf, { type: 'array' });
        const parsed: Record<string, CellData> = {};
        for (const name of wb.SheetNames) {
          const raw = XLSX.utils.sheet_to_json<(string | number | null)[]>(wb.Sheets[name], { header: 1, defval: '' });
          parsed[name] = raw.slice(0, 500);
          if (raw.length > 500) setTruncated(true);
        }
        setSheets(parsed);
        setSheetNames(wb.SheetNames);
        setActiveSheet(wb.SheetNames[0] ?? '');
      } catch {}
      setLoading(false);
    }
    load();
  }, [fileUrl]);

  useEffect(() => {
    if (givenChanges) return;
    fetchJson<ResourceChange[]>(`/api/resources/${resourceId}/changes`)
      .then(setOwnChanges)
      .catch(() => {});
  }, [resourceId, givenChanges]);

  if (loading) return <div className="p-4 text-sm text-fg-muted">Parsing spreadsheet...</div>;
  if (!sheetNames.length) return <div className="p-4 text-sm text-fg-muted">Could not parse file.</div>;

  const data = sheets[activeSheet] ?? [];
  const pendingMap = new Map(changes.filter(c => c.status === 'pending').map(c => [c.cellRef, c.proposedValue]));
  const approvedMap = new Map(changes.filter(c => c.status === 'approved').map(c => [c.cellRef, c.proposedValue]));

  function colName(c: number) {
    let s = '';
    let n = c;
    while (n >= 0) { s = String.fromCharCode(65 + (n % 26)) + s; n = Math.floor(n / 26) - 1; }
    return s;
  }

  return (
    <div className="flex flex-col h-full overflow-hidden">
      {sheetNames.length > 1 && (
        <div className="flex border-b border-line-subtle bg-surface-subtle">
          {sheetNames.map(n => (
            <button
              key={n}
              onClick={() => setActiveSheet(n)}
              className={`px-4 py-2 text-sm border-b-2 ${activeSheet === n ? 'border-info-bright text-info font-medium' : 'border-transparent text-fg-muted hover:text-fg-secondary'}`}
            >
              {n}
            </button>
          ))}
        </div>
      )}
      {truncated && <div className="px-3 py-1 text-xs bg-warning-wash text-warning border-b border-warning-line">Showing first 500 rows only.</div>}
      <div className="flex-1 overflow-auto">
        <table className="text-xs border-collapse min-w-full">
          <tbody>
            {data.map((row, ri) => (
              <tr key={ri}>
                <td className="border border-line-subtle bg-surface-subtle text-fg-muted px-1 text-center w-8 select-none">{ri + 1}</td>
                {(row as (string | number | null)[]).map((cell, ci) => {
                  const ref = `${activeSheet !== sheetNames[0] ? activeSheet + '!' : ''}${colName(ci)}${ri + 1}`;
                  const isPending = pendingMap.has(ref);
                  const isApproved = approvedMap.has(ref);
                  const isSelected = selectedCell === ref;
                  const displayValue = approvedMap.get(ref) ?? pendingMap.get(ref) ?? String(cell ?? '');
                  return (
                    <td
                      key={ci}
                      onClick={() => onCellSelect(ref, String(cell ?? ''))}
                      className={`border border-line-subtle px-2 py-0.5 cursor-pointer whitespace-nowrap max-w-[200px] overflow-hidden text-ellipsis ${
                        isSelected ? 'outline outline-2 outline-info-bright outline-offset-[-2px]' :
                        isApproved ? 'bg-success-wash' :
                        isPending ? 'bg-warning-wash' : 'hover:bg-info-wash'
                      }`}
                    >
                      {displayValue}
                    </td>
                  );
                })}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
