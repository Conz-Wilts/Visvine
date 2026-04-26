"use client";

import { MemberRow } from "@/lib/crm/memberService";
import { ColumnDef } from "../utils/buildColumns";
import { GridCell } from "./GridCell";
import { RowActionsMenu } from "./RowActionsMenu";
import { useCrmGrid } from "../hooks/useCrmGrid";

interface GridRowProps {
  member: MemberRow;
  columns: ColumnDef[];
  communityId: string;
  canManage: boolean;
  rowIndex: number;
}

export function GridRow({
  member,
  columns,
  communityId,
  canManage,
  rowIndex,
}: GridRowProps) {
  const { state, dispatch } = useCrmGrid();

  // Merge server data with any pending optimistic overlay
  const overlayPatch = state.overlay.get(member.user_id) ?? {};
  const merged = { ...member, ...overlayPatch };
  const isSelected = state.selected.has(member.user_id);

  return (
    <tr
      className={`group border-b border-gray-100 hover:bg-gray-50/50 outline-none focus:bg-blue-50/40 ${
        isSelected ? "bg-blue-50/30" : ""
      }`}
      role="row"
      aria-rowindex={rowIndex}
      aria-selected={isSelected}
      tabIndex={0}
    >
      {canManage && (
        <td className="px-3 py-2" role="gridcell">
          <input
            type="checkbox"
            checked={isSelected}
            onChange={() =>
              dispatch({ type: "TOGGLE_SELECT", payload: member.user_id })
            }
            onClick={(e) => e.stopPropagation()}
            className="h-4 w-4 rounded border-gray-300 text-blue-600 focus:ring-blue-500"
            aria-label={`Select ${member.name}`}
          />
        </td>
      )}
      {columns.map((col) => {
        const rawValue =
          col.key in merged
            ? (merged as Record<string, unknown>)[col.key]
            : col.layer === "private"
              ? merged.private_meta[col.key]
              : undefined;

        const locked = col.activeUserLocked && merged.is_active;
        const editable = col.editable && !locked;

        return (
          <td
            key={col.key}
            className="relative whitespace-nowrap"
            role="gridcell"
            title={locked ? "This user manages their own profile." : undefined}
          >
            <GridCell
              communityId={communityId}
              userId={member.user_id}
              fieldKey={col.key}
              fieldLayer={col.key === "role" ? "role" : col.layer}
              col={col}
              value={rawValue}
              editable={editable}
            />
          </td>
        );
      })}
      <td className="pr-2 text-right" role="gridcell">
        <RowActionsMenu
          communityId={communityId}
          userId={member.user_id}
          userEmail={member.email}
          canManage={canManage}
        />
      </td>
    </tr>
  );
}
