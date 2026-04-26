"use client";

import { ColumnDef } from "../utils/buildColumns";

interface CellEditorProps {
  value: unknown;
  col: ColumnDef;
  state: "editing" | "saving" | "error";
  onChange: (v: unknown) => void;
  onCommit: () => void;
  onCancel: () => void;
}

export function CellEditor({
  value,
  col,
  state,
  onChange,
  onCommit,
  onCancel,
}: CellEditorProps) {
  const disabled = state === "saving";
  const baseClass =
    "w-full rounded border px-2 py-1 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500 disabled:opacity-50";
  const errorClass = state === "error" ? "border-red-400" : "border-gray-300";
  const label = `Edit ${col.label}`;

  if (col.type === "select" && col.options) {
    return (
      <select
        autoFocus
        value={String(value ?? "")}
        disabled={disabled}
        className={`${baseClass} ${errorClass}`}
        onChange={(e) => onChange(e.target.value)}
        onBlur={onCommit}
        onKeyDown={(e) => {
          if (e.key === "Escape") onCancel();
        }}
        aria-label={label}
      >
        <option value="">—</option>
        {col.options.map((opt) => (
          <option key={opt} value={opt}>
            {opt}
          </option>
        ))}
      </select>
    );
  }

  if (col.type === "boolean") {
    return (
      <input
        type="checkbox"
        checked={Boolean(value)}
        disabled={disabled}
        className="h-4 w-4 rounded border-gray-300 text-blue-600 focus:ring-blue-500"
        onChange={(e) => {
          onChange(e.target.checked);
          // Commit immediately on toggle
          setTimeout(onCommit, 0);
        }}
        aria-label={label}
      />
    );
  }

  if (col.type === "date") {
    return (
      <input
        type="date"
        autoFocus
        value={String(value ?? "")}
        disabled={disabled}
        className={`${baseClass} ${errorClass}`}
        onChange={(e) => onChange(e.target.value)}
        onBlur={onCommit}
        onKeyDown={(e) => {
          if (e.key === "Enter") onCommit();
          if (e.key === "Escape") onCancel();
        }}
        aria-label={label}
      />
    );
  }

  if (col.type === "number") {
    return (
      <input
        type="number"
        autoFocus
        value={String(value ?? "")}
        disabled={disabled}
        className={`${baseClass} ${errorClass}`}
        onChange={(e) => onChange(e.target.value ? Number(e.target.value) : "")}
        onBlur={onCommit}
        onKeyDown={(e) => {
          if (e.key === "Enter") onCommit();
          if (e.key === "Escape") onCancel();
        }}
        aria-label={label}
      />
    );
  }

  // Default: text
  return (
    <input
      type="text"
      autoFocus
      value={String(value ?? "")}
      disabled={disabled}
      className={`${baseClass} ${errorClass}`}
      onChange={(e) => onChange(e.target.value)}
      onBlur={onCommit}
      onKeyDown={(e) => {
        if (e.key === "Enter") onCommit();
        if (e.key === "Escape") onCancel();
      }}
      aria-label={label}
    />
  );
}
