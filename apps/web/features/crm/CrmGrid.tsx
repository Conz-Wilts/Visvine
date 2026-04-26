"use client";

import { useState } from "react";
import { FieldDefinition } from "@/lib/schemas/crm";
import { CrmGridContext, useCrmGridProvider } from "./hooks/useCrmGrid";
import { GridToolbar } from "./components/GridToolbar";
import { GridTable } from "./components/GridTable";
import { GridPagination } from "./components/GridPagination";
import { BulkActionsBar } from "./components/BulkActionsBar";
import { AuditLogViewer } from "./components/AuditLogViewer";
import { buildColumns } from "./utils/buildColumns";
import { History } from "lucide-react";

interface CrmGridProps {
  communityId: string;
  privateFields: FieldDefinition[];
  currentUserRole: string;
}

export function CrmGrid({
  communityId,
  privateFields,
  currentUserRole,
}: CrmGridProps) {
  const gridCtx = useCrmGridProvider(communityId);
  const columns = buildColumns(privateFields, currentUserRole);
  const canManage = currentUserRole === "admin";
  const [showAuditLog, setShowAuditLog] = useState(false);

  return (
    <CrmGridContext.Provider value={gridCtx}>
      <div className="flex flex-col gap-4">
        <div className="flex flex-col rounded-xl border border-gray-200 bg-white shadow-sm overflow-hidden">
          <GridToolbar
            communityId={communityId}
            currentUserRole={currentUserRole}
            privateFields={privateFields}
          />
          <BulkActionsBar
            communityId={communityId}
            privateFields={privateFields}
          />
          <GridTable
            columns={columns}
            communityId={communityId}
            canManage={canManage}
          />
          <GridPagination />
        </div>

        {/* Audit log toggle — admin only */}
        {canManage && (
          <div>
            <button
              onClick={() => setShowAuditLog((v) => !v)}
              className="inline-flex items-center gap-1.5 text-sm text-gray-500 hover:text-gray-700"
            >
              <History className="h-4 w-4" />
              {showAuditLog ? "Hide audit log" : "Show audit log"}
            </button>
            {showAuditLog && (
              <div className="mt-3">
                <AuditLogViewer communityId={communityId} />
              </div>
            )}
          </div>
        )}
      </div>
    </CrmGridContext.Provider>
  );
}
