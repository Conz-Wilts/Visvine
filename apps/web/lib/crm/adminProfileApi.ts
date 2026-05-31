/**
 * Canonical PATCH helper for admin profile edits.
 *
 * Several CRM table call sites issue the identical request to update profile
 * fields on a node (name, alias, image, openToWork, etc.). This wraps that
 * request so callers only supply the changed fields; each caller still handles
 * `res.ok` / the JSON body itself.
 */
export async function patchAdminProfile(
  communityId: string,
  nodeId: string,
  fields: Record<string, unknown>,
): Promise<Response> {
  return fetch(`/api/communities/${communityId}/admin/profiles`, {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ nodeId, fields }),
  });
}
