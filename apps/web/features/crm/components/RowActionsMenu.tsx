"use client";

import { useState, useRef, useEffect } from "react";
import { useRouter } from "next/navigation";
import { MoreHorizontal } from "lucide-react";
import { useCrmGrid } from "../hooks/useCrmGrid";

interface RowActionsMenuProps {
  communityId: string;
  userId: string;
  userEmail: string;
  canManage: boolean;
}

export function RowActionsMenu({
  communityId,
  userId,
  userEmail,
  canManage,
}: RowActionsMenuProps) {
  const router = useRouter();
  const { dispatch } = useCrmGrid();
  const [open, setOpen] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    function onClickOutside(e: MouseEvent) {
      if (ref.current && !ref.current.contains(e.target as Node)) {
        setOpen(false);
        setConfirmDelete(false);
      }
    }
    document.addEventListener("mousedown", onClickOutside);
    return () => document.removeEventListener("mousedown", onClickOutside);
  }, []);

  async function handleRemove() {
    const res = await fetch(
      `/api/crm/${communityId}/members/${userId}`,
      { method: "DELETE" }
    );
    if (res.ok) {
      dispatch({ type: "REMOVE_MEMBER", payload: userId });
    } else {
      const data = await res.json().catch(() => ({}));
      alert(data.message ?? "Failed to remove member.");
    }
    setOpen(false);
    setConfirmDelete(false);
  }

  if (!canManage) return null;

  return (
    <div ref={ref} className="relative">
      <button
        onClick={() => setOpen((o) => !o)}
        className="rounded p-1 hover:bg-gray-100 opacity-0 group-hover:opacity-100 focus:opacity-100 transition-opacity"
      >
        <MoreHorizontal className="h-4 w-4 text-gray-500" />
      </button>

      {open && (
        <div className="absolute right-0 top-full z-50 mt-1 w-48 rounded-lg border border-gray-200 bg-white py-1 shadow-lg">
          <button
            className="w-full px-4 py-2 text-left text-sm hover:bg-gray-50"
            onClick={() => {
              router.push(`/directory/${userId}`);
              setOpen(false);
            }}
          >
            View Profile
          </button>

          {!confirmDelete ? (
            <button
              className="w-full px-4 py-2 text-left text-sm text-red-600 hover:bg-red-50"
              onClick={() => setConfirmDelete(true)}
            >
              Remove from Community
            </button>
          ) : (
            <div className="px-4 py-2">
              <p className="text-xs text-gray-600 mb-2">
                Remove <strong>{userEmail}</strong>?
              </p>
              <div className="flex gap-2">
                <button
                  className="flex-1 rounded bg-red-600 px-2 py-1 text-xs font-medium text-white hover:bg-red-700"
                  onClick={handleRemove}
                >
                  Remove
                </button>
                <button
                  className="flex-1 rounded border border-gray-300 px-2 py-1 text-xs hover:bg-gray-50"
                  onClick={() => setConfirmDelete(false)}
                >
                  Cancel
                </button>
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
