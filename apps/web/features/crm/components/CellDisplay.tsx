"use client";

import Image from "next/image";
import { StatusBadge } from "./StatusBadge";
import { ColumnDef } from "../utils/buildColumns";

interface CellDisplayProps {
  value: unknown;
  col: ColumnDef;
}

export function CellDisplay({ value, col }: CellDisplayProps) {
  if (col.type === "avatar") {
    const src = value as string | undefined;
    return src ? (
      <Image
        src={src}
        alt=""
        width={32}
        height={32}
        className="rounded-lg object-cover"
      />
    ) : (
      <div className="h-8 w-8 rounded-lg bg-gray-200 flex items-center justify-center text-xs text-gray-500">
        ?
      </div>
    );
  }

  if (col.type === "badge") {
    return <StatusBadge isActive={Boolean(value)} />;
  }

  if (col.type === "boolean") {
    return (
      <span className={value ? "text-green-600" : "text-gray-400"}>
        {value ? "Yes" : "No"}
      </span>
    );
  }

  if (col.type === "select" && col.options) {
    return (
      <span className="inline-flex rounded-full bg-blue-50 px-2 py-0.5 text-xs font-medium text-blue-700">
        {String(value ?? "")}
      </span>
    );
  }

  return (
    <span className="truncate text-sm text-gray-700">
      {value !== null && value !== undefined ? String(value) : "—"}
    </span>
  );
}
