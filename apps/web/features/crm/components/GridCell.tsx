"use client";

import { useState } from "react";
import { ColumnDef, ColumnLayer } from "../utils/buildColumns";
import { CellDisplay } from "./CellDisplay";
import { CellEditor } from "./CellEditor";
import { patchField } from "../utils/patchField";
import { useCrmGrid } from "../hooks/useCrmGrid";

type CellState = "idle" | "editing" | "saving" | "error";

interface GridCellProps {
  communityId: string;
  userId: string;
  fieldKey: string;
  fieldLayer: ColumnLayer | "role";
  col: ColumnDef;
  value: unknown;
  editable: boolean;
}

export function GridCell({
  communityId,
  userId,
  fieldKey,
  fieldLayer,
  col,
  value,
  editable,
}: GridCellProps) {
  const { applyOverlay, revertOverlay } = useCrmGrid();
  const [cellState, setCellState] = useState<CellState>("idle");
  const [localValue, setLocalValue] = useState(value);

  // Sync local value when the prop changes (e.g., after a full refetch)
  if (cellState === "idle" && localValue !== value) {
    setLocalValue(value);
  }

  async function handleCommit() {
    if (localValue === value) {
      setCellState("idle");
      return;
    }
    setCellState("saving");
    applyOverlay(userId, fieldKey, localValue);

    try {
      await patchField(communityId, userId, fieldLayer, fieldKey, localValue);
      setCellState("idle");
    } catch {
      setCellState("error");
      setLocalValue(value);
      revertOverlay(userId, fieldKey);
      setTimeout(() => setCellState("idle"), 3000);
    }
  }

  function handleCancel() {
    setLocalValue(value);
    setCellState("idle");
  }

  function handleKeyDown(e: React.KeyboardEvent) {
    if (editable && e.key === "Enter" && cellState === "idle") {
      e.preventDefault();
      setCellState("editing");
    }
  }

  if (!editable || cellState === "idle") {
    return (
      <div
        onClick={() => editable && setCellState("editing")}
        onKeyDown={handleKeyDown}
        role={editable ? "button" : undefined}
        tabIndex={editable ? 0 : undefined}
        aria-label={
          editable
            ? `Edit ${col.label}: ${localValue ?? "empty"}`
            : undefined
        }
        className={`flex min-w-0 items-center px-3 py-2 ${
          editable
            ? "cursor-pointer hover:bg-gray-50 group-hover:bg-gray-50"
            : "cursor-default"
        } ${cellState === "error" ? "bg-red-50" : ""}`}
      >
        <CellDisplay value={localValue} col={col} />
      </div>
    );
  }

  return (
    <div className="px-2 py-1">
      <CellEditor
        value={localValue}
        col={col}
        state={cellState}
        onChange={setLocalValue}
        onCommit={handleCommit}
        onCancel={handleCancel}
      />
    </div>
  );
}
