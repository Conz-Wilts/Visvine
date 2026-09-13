/**
 * Your own profile, opened from the account row at the foot of the rail. An
 * alias ("Champion", "Team", …) is your role inside one space, so it belongs on
 * the profile when someone reaches you through that space's directory, not on
 * the page you open as yourself. The query param is how the page tells the two
 * entry points apart.
 */
const SELF_VIEW_PARAM = 'view';
const SELF_VIEW_VALUE = 'me';

export const selfProfileHref = (nodeId: string) =>
  `/directory/${encodeURIComponent(nodeId)}?${SELF_VIEW_PARAM}=${SELF_VIEW_VALUE}`;

export const isSelfView = (params: { get(name: string): string | null }) =>
  params.get(SELF_VIEW_PARAM) === SELF_VIEW_VALUE;
