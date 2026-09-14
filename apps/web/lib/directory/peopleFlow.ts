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
 * The house's own nodes first, then every flowing room's, stamped. A node id
 * present in the house's own list is never shadowed by a room's copy — the
 * house's record of a person is the one its members edit.
 */
export function mergePeopleFlow<T extends { id: string }>(
  own: T[],
  rooms: Array<{ room: FlowRoom; nodes: T[] }>,
): Array<T & { via_space?: ViaSpace }> {
  const seen = new Set(own.map((n) => n.id))
  const out: Array<T & { via_space?: ViaSpace }> = [...own]
  for (const { room, nodes } of rooms) {
    for (const node of stampVia(nodes, room)) {
      if (seen.has(node.id)) continue
      seen.add(node.id)
      out.push(node)
    }
  }
  return out
}

/** Whether a directory row is another space's, read here: never edited, exported or linked as the house's own. */
export function isViaNode(node: { via_space?: ViaSpace | null; [key: string]: unknown } | null | undefined): boolean {
  return Boolean(node?.via_space)
}
