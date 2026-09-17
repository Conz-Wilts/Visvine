// The people flow (docs/sub-space-model.md, dial 3): a room with `flowPeople`
// on has its directory — people and organisations — appear in the house's
// directory, badged with the room and read-only. Pure: the route decides
// which rooms flow (lib/spaces/subspaceAccess.ts#peopleFlowingSubspacesOf)
// and reads their nodes; this file decides what crosses and how it is marked.

export interface FlowRoom {
  id: string
  name: string
}

/** The stamp a node carries when it is read through the house. Its presence is the read-only signal. */
export type ViaSpace = FlowRoom

/**
 * Whether a room's node crosses into the house's directory. Events have their
 * own flow (lib/events/rollup.ts) and structural kinds are never directory
 * rows, so only the roll of people and organisations comes through.
 */
export function crossesPeopleFlow(node: { type: string }, isStructural: (type: string) => boolean): boolean {
  const type = node.type.toLowerCase()
  if (type === 'event') return false
  return !isStructural(node.type)
}

/** Stamp a room's nodes with the room they are read through. */
export function stampVia<T extends object>(nodes: T[], room: FlowRoom): Array<T & { via_space: ViaSpace }> {
  return nodes.map((node) => ({ ...node, via_space: { id: room.id, name: room.name } }))
}

/**
 * The house's own nodes first, then every flowing room's, stamped — one row
 * per person. A room's node is folded away when the house already lists it:
 * the same node id, or the same `identity_id`, which is how one real person
 * held as a separate node in each space is recognised as one. The row that
 * stays (the house's own record, else the first room's) carries `also_in`,
 * every other room that holds that person, so the card still says where they
 * are without drawing them once per room.
 */
export function mergePeopleFlow<T extends { id: string; identity_id?: string | null }>(
  own: T[],
  rooms: Array<{ room: FlowRoom; nodes: T[] }>,
): Array<T & { via_space?: ViaSpace; also_in?: ViaSpace[] }> {
  type Row = T & { via_space?: ViaSpace; also_in?: ViaSpace[] }
  const out: Row[] = [...own]
  const byId = new Map<string, Row>()
  const byIdentity = new Map<string, Row>()
  const index = (row: Row) => {
    byId.set(row.id, row)
    if (row.identity_id && !byIdentity.has(row.identity_id)) byIdentity.set(row.identity_id, row)
  }
  out.forEach(index)
  for (const { room, nodes } of rooms) {
    for (const node of stampVia(nodes, room)) {
      const kept = byId.get(node.id) ?? (node.identity_id ? byIdentity.get(node.identity_id) : undefined)
      if (!kept) {
        out.push(node)
        index(node)
        continue
      }
      if (kept.via_space?.id === room.id || kept.also_in?.some((r) => r.id === room.id)) continue
      kept.also_in = [...(kept.also_in ?? []), { id: room.id, name: room.name }]
    }
  }
  return out
}

/** Every room a directory row is held in: the one it is read through, then the rest it was folded from. */
export function roomsOf(node: { via_space?: ViaSpace | null; also_in?: ViaSpace[] | null }): ViaSpace[] {
  return [...(node.via_space ? [node.via_space] : []), ...(node.also_in ?? [])]
}

/** Whether a directory row is another space's, read here: never edited, exported or linked as the house's own. */
export function isViaNode(node: { via_space?: ViaSpace | null; [key: string]: unknown } | null | undefined): boolean {
  return Boolean(node?.via_space)
}
