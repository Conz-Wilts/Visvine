/**
 * The bridge as `data.js` calls it: `visvine.context.read(path)` rather than a
 * params object. Each method a handler may call, and how its positional
 * arguments become the params the bridge validates — one table, read by the
 * server's isolate (apps/web lib/tools/bridge.ts#bridgeCapabilities) and the
 * offline runtime alike, so a handler means the same thing in both.
 *
 * `data.call` is absent (a handler calling handlers would nest isolates) and
 * so is `subject.get` — `data.js` gets `subject` as a global. Pure.
 */
import type { BridgeMethod } from './protocol'

type ArgsToParams = (args: unknown[]) => unknown

const opt = (key: string, value: unknown): Record<string, unknown> => (value === undefined ? {} : { [key]: value })
const object = (value: unknown): Record<string, unknown> =>
  value && typeof value === 'object' && !Array.isArray(value) ? (value as Record<string, unknown>) : {}

export const ISOLATE_PARAMS: Partial<Record<BridgeMethod, ArgsToParams>> = {
  'context.list': (args) => ({ ...opt('glob', args[0]), ...opt('cursor', args[1]) }),
  'context.read': (args) => ({ path: args[0] }),
  'context.search': (args) => ({ query: args[0], ...opt('k', args[1]), ...opt('cursor', args[2]) }),
  'context.write': (args) => ({ path: args[0], content: args[1] }),
  'context.append': (args) => ({ path: args[0], text: args[1] }),
  // `connectors.call(name, code)` or `connectors.call(name, { action, args } | { code })`.
  'connectors.call': (args) => ({ name: args[0], ...(typeof args[1] === 'string' ? { code: args[1] } : object(args[1])) }),
  'agents.run': (args) => ({ name: args[0] }),
  'state.get': (args) => ({ key: args[0], ...opt('scope', args[1]) }),
  'state.set': (args) => ({ key: args[0], value: args[1], ...opt('scope', args[2]) }),
  'context.links': (args) => ({ path: args[0] }),
  'records.query': (args) => args[0] ?? {},
  'records.get': (args) => args[0] ?? {},
  'records.update': (args) => args[0] ?? {},
  'resources.list': (args) => args[0] ?? {},
  'resources.get': (args) => ({ id: args[0] }),
  'resources.read': (args) => ({ id: args[0], ...opt('offset', args[1]) }),
  'actions.run': (args) => ({ name: args[0], ...opt('input', args[1]) }),
  'ai.complete': (args) => (typeof args[0] === 'string' ? { prompt: args[0] } : (args[0] ?? {})),
  'ai.decide': (args) => args[0] ?? {},
  'collections.insert': (args) => ({ collection: args[0], data: args[1] }),
  'collections.list': (args) => ({ collection: args[0], ...object(args[1]) }),
  'collections.get': (args) => ({ collection: args[0], id: args[1] }),
  'collections.update': (args) => ({ collection: args[0], id: args[1], data: args[2] }),
  'collections.delete': (args) => ({ collection: args[0], id: args[1] }),
  'collections.count': (args) => ({ collection: args[0], ...object(args[1]) }),
}

/** The methods `data.js` reaches, as `visvine.<family>.<method>`. */
export const ISOLATE_METHODS = Object.keys(ISOLATE_PARAMS) as BridgeMethod[]
