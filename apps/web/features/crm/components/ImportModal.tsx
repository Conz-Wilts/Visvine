"use client";

import { useState, useRef } from "react";
import { X, Upload, CheckCircle, AlertCircle } from "lucide-react";
import { parseCSVClient, validateCSVHeaders } from "../utils/parseCSV";
import { useCrmGrid } from "../hooks/useCrmGrid";

type Step = "upload" | "preview" | "confirm" | "results";

interface ImportSummary {
  total: number;
  created: number;
  matched_shadow: number;
  matched_active: number;
  already_member: number;
  errors: number;
}

interface ImportError {
  row: number;
  email: string;
  error: string;
}

interface ImportModalProps {
  communityId: string;
  onClose: () => void;
}

export function ImportModal({ communityId, onClose }: ImportModalProps) {
  const { refetch } = useCrmGrid();
  const [step, setStep] = useState<Step>("upload");
  const [file, setFile] = useState<File | null>(null);
  const [headers, setHeaders] = useState<string[]>([]);
  const [preview, setPreview] = useState<Record<string, string>[]>([]);
  const [rowCount, setRowCount] = useState(0);
  const [headerError, setHeaderError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [summary, setSummary] = useState<ImportSummary | null>(null);
  const [importErrors, setImportErrors] = useState<ImportError[]>([]);
  const fileRef = useRef<HTMLInputElement>(null);

  async function handleFileChange(f: File) {
    setFile(f);
    setHeaderError(null);
    const text = await f.text();
    const parsed = parseCSVClient(text);
    const validation = validateCSVHeaders(parsed.headers);

    if (!validation.valid) {
      setHeaderError(`Missing required columns: ${validation.missing.join(", ")}`);
      return;
    }

    setHeaders(parsed.headers);
    setPreview(parsed.rows.slice(0, 5));
    setRowCount(parsed.rowCount);
    setStep("preview");
  }

  async function handleImport() {
    if (!file) return;
    setLoading(true);
    setStep("confirm");

    const form = new FormData();
    form.append("file", file);

    const res = await fetch(`/api/crm/${communityId}/import`, {
      method: "POST",
      body: form,
    });

    setLoading(false);
    const data = await res.json();
    setSummary(data.summary);
    setImportErrors(data.errors ?? []);
    setStep("results");
    refetch();
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4">
      <div className="w-full max-w-2xl rounded-2xl bg-white shadow-xl">
        <div className="flex items-center justify-between border-b border-gray-200 px-6 py-4">
          <h2 className="text-lg font-semibold">Import Members</h2>
          <button onClick={onClose} className="rounded p-1 hover:bg-gray-100">
            <X className="h-5 w-5 text-gray-500" />
          </button>
        </div>

        <div className="px-6 py-5">
          {/* Step 1: Upload */}
          {step === "upload" && (
            <div
              className="flex flex-col items-center justify-center rounded-xl border-2 border-dashed border-gray-300 p-12 cursor-pointer hover:border-blue-400 hover:bg-blue-50/30 transition-colors"
              onClick={() => fileRef.current?.click()}
              onDragOver={(e) => e.preventDefault()}
              onDrop={(e) => {
                e.preventDefault();
                const f = e.dataTransfer.files[0];
                if (f) handleFileChange(f);
              }}
            >
              <Upload className="h-8 w-8 text-gray-400 mb-3" />
              <p className="text-sm font-medium text-gray-700">
                Drop a CSV file here, or click to browse
              </p>
              <p className="text-xs text-gray-400 mt-1">
                Required columns: <code>email</code>, <code>name</code> — Max 1,000 rows, 5 MB
              </p>
              {headerError && (
                <p className="mt-3 text-sm text-red-600">{headerError}</p>
              )}
              <input
                ref={fileRef}
                type="file"
                accept=".csv,text/csv"
                className="hidden"
                onChange={(e) => {
                  const f = e.target.files?.[0];
                  if (f) handleFileChange(f);
                }}
              />
            </div>
          )}

          {/* Step 2: Preview */}
          {step === "preview" && (
            <div className="space-y-4">
              <p className="text-sm text-gray-600">
                <span className="font-medium">{rowCount} rows</span> found in{" "}
                <span className="font-medium">{file?.name}</span>. Preview of first 5:
              </p>
              <div className="overflow-x-auto rounded-lg border border-gray-200">
                <table className="min-w-full text-xs">
                  <thead className="bg-gray-50">
                    <tr>
                      {headers.map((h) => (
                        <th key={h} className="px-3 py-2 text-left font-medium text-gray-600">
                          {h}
                        </th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {preview.map((row, i) => (
                      <tr key={i} className="border-t border-gray-100">
                        {headers.map((h) => (
                          <td key={h} className="px-3 py-2 text-gray-700 truncate max-w-[160px]">
                            {row[h]}
                          </td>
                        ))}
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
              <div className="flex justify-end gap-3">
                <button
                  onClick={() => setStep("upload")}
                  className="rounded-lg border border-gray-300 px-4 py-2 text-sm hover:bg-gray-50"
                >
                  Back
                </button>
                <button
                  onClick={() => setStep("confirm")}
                  className="rounded-lg bg-blue-600 px-4 py-2 text-sm font-semibold text-white hover:bg-blue-700"
                >
                  Continue
                </button>
              </div>
            </div>
          )}

          {/* Step 3: Confirm */}
          {step === "confirm" && (
            <div className="space-y-4 text-center">
              {loading ? (
                <>
                  <div className="text-sm text-gray-600 animate-pulse">Importing {rowCount} rows…</div>
                </>
              ) : (
                <>
                  <p className="text-sm text-gray-700">
                    Import <span className="font-semibold">{rowCount} rows</span> from{" "}
                    <span className="font-semibold">{file?.name}</span>?
                  </p>
                  <p className="text-xs text-gray-400">
                    Existing active users&apos; public data will not be overwritten.
                  </p>
                  <div className="flex justify-center gap-3 pt-2">
                    <button
                      onClick={() => setStep("preview")}
                      className="rounded-lg border border-gray-300 px-4 py-2 text-sm hover:bg-gray-50"
                    >
                      Back
                    </button>
                    <button
                      onClick={handleImport}
                      className="rounded-lg bg-blue-600 px-4 py-2 text-sm font-semibold text-white hover:bg-blue-700"
                    >
                      Import
                    </button>
                  </div>
                </>
              )}
            </div>
          )}

          {/* Step 4: Results */}
          {step === "results" && summary && (
            <div className="space-y-4">
              <div className="flex items-center gap-2">
                <CheckCircle className="h-5 w-5 text-green-500" />
                <span className="font-medium text-gray-800">Import complete</span>
              </div>
              <div className="grid grid-cols-2 gap-3 sm:grid-cols-3">
                {[
                  { label: "Created", value: summary.created, color: "text-green-700" },
                  { label: "Matched (shadow)", value: summary.matched_shadow, color: "text-blue-700" },
                  { label: "Matched (active)", value: summary.matched_active, color: "text-purple-700" },
                  { label: "Already member", value: summary.already_member, color: "text-gray-600" },
                  { label: "Errors", value: summary.errors, color: "text-red-600" },
                ].map((s) => (
                  <div key={s.label} className="rounded-lg bg-gray-50 px-4 py-3 text-center">
                    <p className={`text-2xl font-bold ${s.color}`}>{s.value}</p>
                    <p className="text-xs text-gray-500 mt-0.5">{s.label}</p>
                  </div>
                ))}
              </div>

              {importErrors.length > 0 && (
                <div className="rounded-lg border border-red-200 bg-red-50 p-4 space-y-1">
                  <div className="flex items-center gap-1 text-sm font-medium text-red-700 mb-2">
                    <AlertCircle className="h-4 w-4" />
                    Row errors
                  </div>
                  {importErrors.map((e) => (
                    <p key={e.row} className="text-xs text-red-600">
                      Row {e.row} ({e.email}): {e.error}
                    </p>
                  ))}
                </div>
              )}

              <div className="flex justify-end">
                <button
                  onClick={onClose}
                  className="rounded-lg bg-blue-600 px-4 py-2 text-sm font-semibold text-white hover:bg-blue-700"
                >
                  Done
                </button>
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
