import { ColumnLayer } from "./buildColumns";

export async function patchField(
  communityId: string,
  userId: string,
  layer: ColumnLayer | "role",
  field: string,
  value: unknown
): Promise<void> {
  const endpoint =
    layer === "role"
      ? `/api/crm/${communityId}/members/${userId}/role`
      : `/api/crm/${communityId}/members/${userId}/${layer}`;

  const body =
    layer === "role"
      ? { role: value }
      : { field, value };

  const res = await fetch(endpoint, {
    method: "PATCH",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });

  if (!res.ok) {
    const data = await res.json().catch(() => ({}));
    throw new Error(data.error ?? `PATCH ${endpoint} failed: ${res.status}`);
  }
}
