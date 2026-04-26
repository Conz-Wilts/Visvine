"use client";

import { useState } from "react";
import { X } from "lucide-react";
import { FieldDefinition } from "@/lib/schemas/crm";
import { useCrmGrid } from "../hooks/useCrmGrid";

interface AddMemberModalProps {
  communityId: string;
  privateFields: FieldDefinition[];
  onClose: () => void;
}

export function AddMemberModal({
  communityId,
  privateFields,
  onClose,
}: AddMemberModalProps) {
  const { dispatch } = useCrmGrid();
  const [email, setEmail] = useState("");
  const [name, setName] = useState("");
  const [headline, setHeadline] = useState("");
  const [privateValues, setPrivateValues] = useState<Record<string, string>>({});
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    setLoading(true);

    const res = await fetch(`/api/crm/${communityId}/members`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        email,
        name,
        headline: headline || undefined,
        private_meta: Object.fromEntries(
          Object.entries(privateValues).filter(([, v]) => v !== "")
        ),
      }),
    });

    setLoading(false);

    if (!res.ok) {
      const data = await res.json().catch(() => ({}));
      if (data.error === "already_member") {
        setError("This person is already in the community.");
      } else {
        setError(data.error ?? "Failed to add member.");
      }
      return;
    }

    const newMember = await res.json();
    dispatch({ type: "PREPEND_MEMBER", payload: newMember });
    onClose();
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4">
      <div className="w-full max-w-md rounded-2xl bg-white shadow-xl">
        <div className="flex items-center justify-between border-b border-gray-200 px-6 py-4">
          <h2 className="text-lg font-semibold">Add Member</h2>
          <button onClick={onClose} className="rounded p-1 hover:bg-gray-100">
            <X className="h-5 w-5 text-gray-500" />
          </button>
        </div>

        <form onSubmit={handleSubmit} className="px-6 py-4 space-y-4">
          {error && (
            <div className="rounded-lg bg-red-50 border border-red-200 px-4 py-3 text-sm text-red-700">
              {error}
            </div>
          )}

          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">
              Email <span className="text-red-500">*</span>
            </label>
            <input
              type="email"
              required
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
              placeholder="name@example.com"
            />
          </div>

          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">
              Name <span className="text-red-500">*</span>
            </label>
            <input
              type="text"
              required
              value={name}
              onChange={(e) => setName(e.target.value)}
              className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
              placeholder="Full name"
            />
          </div>

          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">
              Headline
            </label>
            <input
              type="text"
              value={headline}
              onChange={(e) => setHeadline(e.target.value)}
              className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
              placeholder="Founder @ Acme"
            />
          </div>

          {privateFields.map((field) => (
            <div key={field.key}>
              <label className="block text-sm font-medium text-gray-700 mb-1">
                {field.label}
              </label>
              {field.type === "select" && field.options ? (
                <select
                  value={privateValues[field.key] ?? ""}
                  onChange={(e) =>
                    setPrivateValues((v) => ({ ...v, [field.key]: e.target.value }))
                  }
                  className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
                >
                  <option value="">—</option>
                  {field.options.map((o) => (
                    <option key={o} value={o}>
                      {o}
                    </option>
                  ))}
                </select>
              ) : (
                <input
                  type={field.type === "number" ? "number" : "text"}
                  value={privateValues[field.key] ?? ""}
                  onChange={(e) =>
                    setPrivateValues((v) => ({ ...v, [field.key]: e.target.value }))
                  }
                  className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
                />
              )}
            </div>
          ))}

          <div className="flex justify-end gap-3 pt-2">
            <button
              type="button"
              onClick={onClose}
              className="rounded-lg border border-gray-300 px-4 py-2 text-sm hover:bg-gray-50"
            >
              Cancel
            </button>
            <button
              type="submit"
              disabled={loading}
              className="rounded-lg bg-blue-600 px-4 py-2 text-sm font-semibold text-white hover:bg-blue-700 disabled:opacity-60"
            >
              {loading ? "Adding…" : "Add Member"}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
