// A space stores its own copy of the type vocabulary (`Space.nodeTypes`), so a
// built-in type keeps the colour it was created with even after the defaults
// move. When the design tokens gave the built-in types one palette, the colour
// a space still carries is either a PREVIOUS DEFAULT — nobody chose it — or an
// admin's own pick. This moves the first to the token and leaves the second.
// Pure; `scripts/recolor-node-types.ts` applies it.

import { color } from '@visvine/tokens';
import type { NodeTypeConfig } from './context';

type BuiltIn = keyof typeof color.type;

/** Every colour a built-in type has shipped with before the token palette. */
const PREVIOUS_DEFAULTS: Record<string, { key: BuiltIn; was: string[] }> = {
  person: { key: 'person', was: ['#60a5fa', '#2563eb'] },
  space: { key: 'space', was: ['#4ade80', '#78d870'] },
  event: { key: 'event', was: ['#f87171', '#ef4444'] },
  resource: { key: 'resource', was: ['#fb923c', '#f97316'] },
  section: { key: 'section', was: ['#38bdf8', '#0ea5e9'] },
  channel: { key: 'channel', was: ['#f472b6', '#ec4899'] },
  connector: { key: 'connector', was: ['#818cf8', '#4f46e5'] },
  agent: { key: 'agent', was: ['#2dd4bf', '#0d9488'] },
  tool: { key: 'tool', was: ['#c084fc'] },
  model: { key: 'model', was: ['#a78bfa'] },
  index: { key: 'index', was: ['#facc15'] },
  subspace: { key: 'subspace', was: ['#a3e635'] },
};

/** The list with every built-in type still on a previous default moved to its token; `changed` names them. */
export function recolorBuiltInTypes(types: NodeTypeConfig[]): { types: NodeTypeConfig[]; changed: string[] } {
  const changed: string[] = [];
  const next = types.map((t) => {
    const entry = PREVIOUS_DEFAULTS[t.name.trim().toLowerCase()];
    if (!entry || !entry.was.includes(String(t.color).toLowerCase())) return t;
    const target = color.type[entry.key].default;
    if (t.color === target) return t;
    changed.push(t.name);
    return { ...t, color: target };
  });
  return { types: next, changed };
}
