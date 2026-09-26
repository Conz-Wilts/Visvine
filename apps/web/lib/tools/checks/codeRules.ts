/**
 * The security stage's rules over a Tool's code, as a parsed program. Pure:
 * an acorn AST in, findings and the bridge calls it makes out.
 *
 * What these look for is INTENT. A Tool's frame already refuses almost all of
 * it — `connect-src 'none'`, an opaque origin, no popups, no top navigation —
 * so a `fetch` or a `window.top` in a Tool's source cannot work, and its only
 * reason to be there is someone trying. That is why dead code is still a
 * blocking finding: removing it costs an honest author nothing, and leaving it
 * would put a probe in front of every space that installs the Tool. The frame
 * is the control; this is how a reviewer learns someone leaned on it.
 *
 * `ui.tsx` is read after esbuild has stripped its types and lowered its JSX to
 * `jsx("input", { type: "password" })`, so an element and a call are one rule;
 * `data.js` is read as written. Names are checked for being the GLOBAL — a
 * parameter called `parent` or a local `fetch` helper is the author's own.
 */
import type * as acorn from 'acorn'
import { fullAncestor } from 'acorn-walk'
import type { CheckFile, CheckFinding, FindingSeverity } from './findings'
import type { PositionLookup } from './sourceMap'

/** A bridge call the code makes, with its first argument when it is a literal. */
export interface BridgeCallSite {
  method:
    | 'context.list'
    | 'context.read'
    | 'context.search'
    | 'context.write'
    | 'context.append'
    | 'connectors.call'
    | 'agents.run'
    | 'data.call'
    | 'state.get'
    | 'state.set'
    | 'context.links'
    | 'records.query'
    | 'records.get'
    | 'records.update'
    | 'resources.list'
    | 'resources.get'
    | 'resources.read'
    | 'resources.blob'
    | 'resources.upload'
    | 'actions.run'
    | 'ai.complete'
    | 'ai.decide'
    | 'ui.download'
    | 'collections.insert'
    | 'collections.list'
    | 'collections.get'
    | 'collections.update'
    | 'collections.delete'
    | 'collections.count'
  /** The literal first argument (a path, glob, name or handler), or null when computed. */
  arg: string | null
  file: CheckFile
  line?: number
}

export interface CodeUnit {
  file: CheckFile
  program: acorn.Program
  /** Maps a position in the parsed code back to the author's source; absent when they are the same. */
  locate?: PositionLookup
}

export interface CodeScan {
  findings: CheckFinding[]
  calls: BridgeCallSite[]
  /** `handlers.<name> = …` assignments, for `data.js`. */
  handlers: string[]
  /** Every string literal, for the text rules that read copy. */
  strings: Array<{ value: string; line?: number }>
}

/** The globals that name the window or its relatives. */
const WINDOW_NAMES = new Set(['window', 'self', 'globalThis', 'frames'])
/** Windows other than the Tool's own. */
const OTHER_WINDOWS = new Set(['top', 'parent', 'opener', 'frameElement'])
/** Network primitives: dead under `connect-src 'none'`, so present only as intent. */
const NETWORK = new Set(['fetch', 'XMLHttpRequest', 'WebSocket', 'EventSource', 'WebTransport'])
const WEBRTC = new Set(['RTCPeerConnection', 'webkitRTCPeerConnection', 'RTCDataChannel'])
const WORKERS = new Set(['Worker', 'SharedWorker', 'importScripts'])
const STORAGE = new Set(['localStorage', 'sessionStorage', 'indexedDB', 'caches'])
const DYNAMIC_CODE = new Set(['eval', 'Function'])
/** What a server script reaches for when it thinks it is in Node, or in a connector's isolate. */
const SERVER_PROBES = new Set(['require', 'process', 'sql', 'mcp', 'module', 'exports', 'Buffer', '__dirname', 'global'])
/** Elements a Tool must never create: a nested document, code, or a redirect. */
const FORBIDDEN_ELEMENTS: Record<string, string> = {
  iframe: 'a nested frame',
  frame: 'a nested frame',
  object: 'an embedded object',
  embed: 'an embedded object',
  script: 'a script element',
  base: 'a <base> element',
  portal: 'a portal',
}
const PREFETCH_RELS = new Set(['dns-prefetch', 'preconnect', 'prefetch', 'prerender', 'preload', 'modulepreload'])
const CREDENTIAL_AUTOCOMPLETE = new Set([
  'current-password',
  'new-password',
  'one-time-code',
  'cc-number',
  'cc-csc',
  'cc-exp',
  'webauthn',
])
const POWERFUL_NAVIGATOR = new Set(['clipboard', 'geolocation', 'mediaDevices', 'credentials', 'usb', 'bluetooth', 'serial', 'hid'])

const BRIDGE_FAMILIES: Record<string, Record<string, BridgeCallSite['method']>> = {
  context: {
    list: 'context.list',
    listPage: 'context.list',
    read: 'context.read',
    search: 'context.search',
    searchPage: 'context.search',
    write: 'context.write',
    append: 'context.append',
    links: 'context.links',
  },
  connectors: { call: 'connectors.call' },
  agents: { run: 'agents.run' },
  data: { call: 'data.call' },
  state: { get: 'state.get', set: 'state.set' },
  records: { query: 'records.query', get: 'records.get', update: 'records.update' },
  resources: { list: 'resources.list', get: 'resources.get', read: 'resources.read', blob: 'resources.blob', upload: 'resources.upload' },
  actions: { run: 'actions.run' },
  ai: { complete: 'ai.complete', decide: 'ai.decide' },
  ui: { download: 'ui.download' },
  collections: {
    insert: 'collections.insert',
    list: 'collections.list',
    get: 'collections.get',
    update: 'collections.update',
    delete: 'collections.delete',
    count: 'collections.count',
  },
}

/** The kit's hooks that call the bridge for the Tool, by what they call. */
const BRIDGE_HOOKS: Record<string, BridgeCallSite['method']> = {
  usePagedList: 'context.list',
  useCollection: 'collections.list',
  useCollectionCount: 'collections.count',
}

/** The kit's components that call the bridge for the Tool — `jsx(ResourceImage, …)` once JSX is lowered. */
const BRIDGE_COMPONENTS: Record<string, BridgeCallSite['method']> = {
  ResourceImage: 'resources.blob',
  ImageUpload: 'resources.upload',
}

type AnyNode = acorn.AnyNode

/** A property's name when it is a plain name or a string literal. */
function propertyName(node: acorn.MemberExpression): string | null {
  if (!node.computed && node.property.type === 'Identifier') return node.property.name
  if (node.property.type === 'Literal' && typeof node.property.value === 'string') return node.property.value
  return null
}

function stringValue(node: AnyNode | null | undefined): string | null {
  if (!node) return null
  if (node.type === 'Literal' && typeof node.value === 'string') return node.value
  if (node.type === 'TemplateLiteral' && node.expressions.length === 0) return node.quasis[0]?.value.cooked ?? null
  return null
}

/** `const NAME = 'text'` bindings, so a URL assembled from a constant still reads as that URL. */
function constantStrings(program: acorn.Program): Map<string, string> {
  const out = new Map<string, string>()
  fullAncestor(program, (node) => {
    const n = node as AnyNode
    if (n.type !== 'VariableDeclaration' || n.kind !== 'const') return
    for (const d of n.declarations) {
      if (d.id.type !== 'Identifier' || !d.init) continue
      const value = stringValue(d.init as AnyNode)
      if (value !== null) out.set(d.id.name, value)
    }
  })
  return out
}

/** The text a template or `+` chain starts with — through constants — when it can be read. */
function prefixReader(constants: ReadonlyMap<string, string>): (node: AnyNode) => string | null {
  const read = (node: AnyNode): string | null => {
    if (node.type === 'Literal' && typeof node.value === 'string') return node.value
    if (node.type === 'Identifier') return constants.get(node.name) ?? null
    if (node.type === 'TemplateLiteral') {
      const head = node.quasis[0]?.value.cooked ?? ''
      if (head || node.expressions.length === 0) return head
      const first = read(node.expressions[0] as AnyNode)
      return first === null ? null : first + (node.quasis[1]?.value.cooked ?? '')
    }
    if (node.type === 'BinaryExpression' && node.operator === '+' && node.left.type !== 'PrivateIdentifier') {
      return read(node.left)
    }
    return null
  }
  return read
}

/** Does this expression mix a literal with something computed — the shape of a beacon URL? */
function isBuiltString(node: AnyNode): boolean {
  if (node.type === 'TemplateLiteral') return node.expressions.length > 0
  return node.type === 'BinaryExpression' && node.operator === '+'
}

/** Names bound anywhere in the program: a local of that name is not the global. */
function declaredNames(program: acorn.Program): Set<string> {
  const names = new Set<string>()
  const addPattern = (pattern: AnyNode | null | undefined): void => {
    if (!pattern) return
    switch (pattern.type) {
      case 'Identifier':
        names.add(pattern.name)
        break
      case 'ObjectPattern':
        for (const prop of pattern.properties) {
          addPattern(prop.type === 'RestElement' ? prop.argument : prop.value)
        }
        break
      case 'ArrayPattern':
        for (const el of pattern.elements) addPattern(el)
        break
      case 'RestElement':
        addPattern(pattern.argument)
        break
      case 'AssignmentPattern':
        addPattern(pattern.left)
        break
    }
  }
  fullAncestor(program, (node) => {
    const n = node as AnyNode
    switch (n.type) {
      case 'VariableDeclarator':
        addPattern(n.id)
        break
      case 'FunctionDeclaration':
      case 'FunctionExpression':
      case 'ArrowFunctionExpression':
        if ('id' in n && n.id) names.add(n.id.name)
        for (const param of n.params) addPattern(param)
        break
      case 'ClassDeclaration':
        if (n.id) names.add(n.id.name)
        break
      case 'ImportSpecifier':
      case 'ImportDefaultSpecifier':
      case 'ImportNamespaceSpecifier':
        names.add(n.local.name)
        break
      case 'CatchClause':
        addPattern(n.param)
        break
    }
  })
  return names
}

/** Local names the JSX runtime (or React) was imported under. */
function elementFactories(program: acorn.Program): Set<string> {
  const names = new Set<string>()
  for (const statement of program.body) {
    if (statement.type !== 'ImportDeclaration') continue
    const from = statement.source.value
    for (const spec of statement.specifiers) {
      if (spec.type !== 'ImportSpecifier') continue
      const imported = spec.imported.type === 'Identifier' ? spec.imported.name : String(spec.imported.value)
      if (from === 'react/jsx-runtime' && ['jsx', 'jsxs', 'jsxDEV'].includes(imported)) names.add(spec.local.name)
      if (from === 'react' && imported === 'createElement') names.add(spec.local.name)
    }
  }
  return names
}

/** `React.createElement` wherever React was imported as a namespace or default. */
function reactNamespaces(program: acorn.Program): Set<string> {
  const names = new Set<string>()
  for (const statement of program.body) {
    if (statement.type !== 'ImportDeclaration' || statement.source.value !== 'react') continue
    for (const spec of statement.specifiers) {
      if (spec.type === 'ImportDefaultSpecifier' || spec.type === 'ImportNamespaceSpecifier') names.add(spec.local.name)
    }
  }
  return names
}

/** Is this identifier READ as a value here, rather than a property name, key or declaration? */
function isReference(node: acorn.Identifier, parent: AnyNode | undefined): boolean {
  if (!parent) return true
  switch (parent.type) {
    case 'MemberExpression':
      return parent.object === node || parent.computed
    case 'Property':
      return parent.value === node || parent.computed || parent.shorthand
    case 'MethodDefinition':
    case 'PropertyDefinition':
      return parent.key !== node || parent.computed
    case 'VariableDeclarator':
      return parent.init === node
    case 'FunctionDeclaration':
    case 'FunctionExpression':
    case 'ArrowFunctionExpression':
    case 'ClassDeclaration':
    case 'ClassExpression':
    case 'LabeledStatement':
    case 'BreakStatement':
    case 'ContinueStatement':
    case 'ImportSpecifier':
    case 'ImportDefaultSpecifier':
    case 'ImportNamespaceSpecifier':
    case 'ExportSpecifier':
      return false
    default:
      return true
  }
}

/** Walk down `a.b.c` to its root identifier's name and the property names above it. */
function memberChain(node: AnyNode): { root: string | null; path: string[] } {
  const path: string[] = []
  let at: AnyNode = node
  while (at.type === 'MemberExpression') {
    const name = propertyName(at)
    path.unshift(name ?? '[computed]')
    at = at.object as AnyNode
  }
  return { root: at.type === 'Identifier' ? at.name : at.type === 'ThisExpression' ? 'this' : null, path }
}

/** Read a JSX element's props object (the second argument of `jsx(tag, props)`). */
function propsOf(node: AnyNode | undefined): Map<string, AnyNode> {
  const props = new Map<string, AnyNode>()
  if (!node || node.type !== 'ObjectExpression') return props
  for (const prop of node.properties) {
    if (prop.type !== 'Property') continue
    const key =
      prop.key.type === 'Identifier' ? prop.key.name : prop.key.type === 'Literal' ? String(prop.key.value) : null
    if (key) props.set(key, prop.value as AnyNode)
  }
  return props
}

export function scanCode(unit: CodeUnit): CodeScan {
  const findings: CheckFinding[] = []
  const calls: BridgeCallSite[] = []
  const handlers: string[] = []
  const strings: CodeScan['strings'] = []
  const declared = declaredNames(unit.program)
  const staticPrefix = prefixReader(constantStrings(unit.program))
  const factories = elementFactories(unit.program)
  const reactNs = reactNamespaces(unit.program)
  /** A name that is the browser's global here, not something the author bound. */
  const isGlobal = (name: string | null): name is string => name !== null && !declared.has(name)
  const isWindow = (name: string | null) => isGlobal(name) && WINDOW_NAMES.has(name)

  const where = (node: acorn.Node): { line?: number; column?: number } => {
    const loc = node.loc?.start
    if (!loc) return {}
    const original = unit.locate ? unit.locate(loc.line, loc.column) : { line: loc.line, column: loc.column }
    return original ? { line: original.line, column: original.column } : {}
  }
  const add = (node: acorn.Node, rule: string, severity: FindingSeverity, message: string) => {
    findings.push({ rule, severity, message, file: unit.file, ...where(node) })
  }

  /** The global a member chain is really about: `window.top.location` → ['top', 'location']. */
  const globalPath = (node: AnyNode): string[] | null => {
    const { root, path } = memberChain(node)
    if (root === null || !isGlobal(root)) return null
    return WINDOW_NAMES.has(root) ? path : [root, ...path]
  }

  const checkElement = (node: acorn.CallExpression, tag: string, props: Map<string, AnyNode>) => {
    const lower = tag.toLowerCase()
    if (FORBIDDEN_ELEMENTS[lower]) {
      add(node, 'escape.forbidden-element', 'high', `Creates ${FORBIDDEN_ELEMENTS[lower]} (<${lower}>)`)
    }
    if (lower === 'meta' && (props.has('httpEquiv') || props.has('http-equiv'))) {
      add(node, 'escape.meta-http-equiv', 'high', '<meta http-equiv> can redirect or re-police the frame')
    }
    if (lower === 'link') {
      const rel = (stringValue(props.get('rel')) ?? '').toLowerCase().split(/\s+/)
      if (rel.some((r) => PREFETCH_RELS.has(r))) {
        add(node, 'exfil.prefetch', 'high', `<link rel="${rel.join(' ')}"> reaches the network outside connect-src`)
      }
    }
    if (props.has('srcDoc') || props.has('srcdoc')) add(node, 'escape.srcdoc', 'high', 'Writes a srcdoc document')
    if (props.has('dangerouslySetInnerHTML')) {
      add(node, 'escape.raw-html', 'medium', 'Renders raw HTML with dangerouslySetInnerHTML')
    }
    if (lower === 'input') {
      const type = (stringValue(props.get('type')) ?? '').toLowerCase()
      if (type === 'password') add(node, 'phishing.password-input', 'high', 'Asks for a password')
      const autocomplete = (stringValue(props.get('autoComplete')) ?? stringValue(props.get('autocomplete')) ?? '').toLowerCase()
      if (autocomplete.split(/\s+/).some((token) => CREDENTIAL_AUTOCOMPLETE.has(token))) {
        add(node, 'phishing.credential-autocomplete', 'high', `Asks the browser for a saved credential (${autocomplete})`)
      }
    }
    for (const attr of ['src', 'href', 'action', 'data', 'poster', 'formAction']) {
      const value = props.get(attr)
      if (value && isBuiltString(value) && /^(https?:)?\/\//i.test(staticPrefix(value) ?? '')) {
        add(node, 'exfil.beacon', 'high', `Points ${attr} at a URL built from data — a request the page makes for it`)
      }
    }
    if (lower === 'form' && props.has('action')) add(node, 'escape.form-action', 'medium', 'A form with an action posts off the page')
    if (lower === 'a') {
      const target = (stringValue(props.get('target')) ?? '').toLowerCase()
      if (target === '_top' || target === '_parent') add(node, 'escape.link-target', 'high', `A link aimed at ${target}`)
      const href = props.get('href')
      const text = href ? (staticPrefix(href) ?? '') : ''
      if (/^\s*javascript:/i.test(text)) add(node, 'escape.javascript-url', 'high', 'A javascript: link')
      else if (/^(https?:)?\/\//i.test(text)) {
        add(node, 'escape.external-link', 'medium', 'An off-site link navigates the frame, which stops the Tool')
      }
    }
  }

  fullAncestor(unit.program, (raw, _state, ancestors) => {
    const node = raw as AnyNode
    const parent = ancestors[ancestors.length - 2] as AnyNode | undefined
    switch (node.type) {
      case 'Literal':
        if (typeof node.value === 'string') strings.push({ value: node.value, ...where(node) })
        break

      case 'TemplateElement':
        if (node.value.cooked) strings.push({ value: node.value.cooked, ...where(node) })
        break

      case 'TemplateLiteral':
      case 'BinaryExpression': {
        // Judged once, at the outermost piece of the chain.
        if (parent?.type === 'BinaryExpression' && parent.operator === '+') break
        if (node.type === 'BinaryExpression' && node.operator !== '+') break
        if (!isBuiltString(node)) break
        const prefix = staticPrefix(node) ?? ''
        const host = /^(?:https?:)?\/\/([^/?#\s]+)/i.exec(prefix)?.[1]
        if (host) add(node, 'exfil.built-url', 'medium', `Builds a URL to ${host} from data`)
        break
      }

      case 'Identifier': {
        if (!isReference(node, parent) || !isGlobal(node.name)) break
        if (unit.file === 'data.js' && SERVER_PROBES.has(node.name)) {
          add(node, 'escape.runtime-probe', 'high', `data.js has no ${node.name} — it runs in an isolate with the bridge only`)
          break
        }
        // Callees and member roots are judged where they are used, with more to say.
        if (parent?.type === 'CallExpression' && parent.callee === node) break
        if (parent?.type === 'NewExpression' && parent.callee === node) break
        if (parent?.type === 'MemberExpression' && parent.object === node) break
        if (WEBRTC.has(node.name)) add(node, 'exfil.webrtc', 'high', `${node.name} can carry data past the frame's policy`)
        else if (NETWORK.has(node.name)) add(node, 'exfil.network', 'high', `${node.name} is not reachable from a Tool — use the bridge`)
        else if (DYNAMIC_CODE.has(node.name)) add(node, 'escape.dynamic-code', 'high', `Holds ${node.name}, which runs text as code`)
        else if (OTHER_WINDOWS.has(node.name)) add(node, 'escape.other-window', 'high', `Holds ${node.name}, a window outside the Tool's frame`)
        else if (WINDOW_NAMES.has(node.name)) add(node, 'obfuscation.window-alias', 'medium', `Passes ${node.name} around by another name`)
        break
      }

      case 'MemberExpression': {
        // The outermost expression of a chain is judged once, as a whole.
        if (parent?.type === 'MemberExpression' && parent.object === node) break
        const path = globalPath(node)
        const { root, path: rawPath } = memberChain(node)
        // `x.constructor.constructor` is Function, reached without naming it.
        const ctorAt = rawPath.indexOf('constructor')
        if (ctorAt >= 0 && rawPath[ctorAt + 1] === 'constructor') {
          add(node, 'escape.function-constructor', 'high', 'Reaches Function through .constructor.constructor')
        }
        if (rawPath.includes('postMessage')) {
          add(node, 'escape.post-message', 'high', 'Calls postMessage directly — the kit is the only messenger')
        }
        if (rawPath.includes('__proto__')) add(node, 'escape.prototype', 'medium', 'Touches __proto__')
        // `window[x]`: a computed name on the window is how every rule here is dodged.
        if (isWindow(root) && rawPath[0] === '[computed]') {
          add(node, 'obfuscation.computed-global', 'high', `Reaches a global by a computed name (${root}[…])`)
          break
        }
        if (!path || path.length === 0) break
        const [head, next] = path
        if (OTHER_WINDOWS.has(head)) {
          add(node, 'escape.other-window', 'high', `Reaches ${head}, a window outside the Tool's frame`)
        } else if (head === 'document' && next === 'cookie') {
          add(node, 'escape.cookie', 'high', 'Reads or writes document.cookie')
        } else if (head === 'document' && next === 'domain') {
          add(node, 'escape.document-domain', 'high', 'Touches document.domain')
        } else if (head === 'document' && (next === 'write' || next === 'writeln' || next === 'open')) {
          add(node, 'escape.document-write', 'high', `Rewrites the document (document.${next})`)
        } else if (head === 'navigator' && next === 'sendBeacon') {
          add(node, 'exfil.network', 'high', 'navigator.sendBeacon is not reachable from a Tool — use the bridge')
        } else if (head === 'navigator' && next === 'serviceWorker') {
          add(node, 'escape.service-worker', 'high', 'Registers a service worker')
        } else if (head === 'navigator' && next && POWERFUL_NAVIGATOR.has(next)) {
          add(node, 'sandbox.powerful-feature', 'medium', `navigator.${next} is denied in a Tool's frame`)
        } else if (NETWORK.has(head)) {
          add(node, 'exfil.network', 'high', `${head} is not reachable from a Tool — use the bridge`)
        } else if (WEBRTC.has(head)) {
          add(node, 'exfil.webrtc', 'high', `${head} can carry data past the frame's policy`)
        } else if (DYNAMIC_CODE.has(head)) {
          add(node, 'escape.dynamic-code', 'high', `Reaches ${head}, which runs text as code`)
        } else if (head === 'open' && path.length === 1) {
          add(node, 'escape.popup', 'high', 'Opens a window')
        } else if (STORAGE.has(head)) {
          add(node, 'sandbox.storage', 'medium', `${head} is unavailable in a Tool — use visvine.state`)
        } else if (WORKERS.has(head)) {
          add(node, 'escape.worker', 'high', `Starts a ${head}`)
        }
        break
      }

      case 'CallExpression': {
        const callee = node.callee as AnyNode
        // Element factories: jsx("input", {…}) and React.createElement("input", {…}).
        const isFactory =
          (callee.type === 'Identifier' && factories.has(callee.name)) ||
          (callee.type === 'MemberExpression' &&
            callee.object.type === 'Identifier' &&
            reactNs.has(callee.object.name) &&
            propertyName(callee) === 'createElement')
        if (isFactory) {
          const tag = stringValue(node.arguments[0] as AnyNode)
          if (tag) checkElement(node, tag, propsOf(node.arguments[1] as AnyNode))
          // A few of the kit's components call the bridge on the Tool's behalf.
          const first = node.arguments[0] as AnyNode | undefined
          if (first?.type === 'Identifier' && Object.hasOwn(BRIDGE_COMPONENTS, first.name)) {
            const method = BRIDGE_COMPONENTS[first.name]
            calls.push({ method, arg: null, file: unit.file, ...lineOf(where(node)) })
            // An upload also shows what it added: the picker draws its own ResourceImage.
            if (method === 'resources.upload') calls.push({ method: 'resources.blob', arg: null, file: unit.file, ...lineOf(where(node)) })
          }
          break
        }
        if (callee.type === 'Identifier' && isGlobal(callee.name)) {
          const name = callee.name
          if (DYNAMIC_CODE.has(name)) add(node, 'escape.dynamic-code', 'high', `Calls ${name}, which runs text as code`)
          else if (NETWORK.has(name)) add(node, 'exfil.network', 'high', `${name} is not reachable from a Tool — use the bridge`)
          else if (name === 'open') add(node, 'escape.popup', 'high', 'Opens a window')
          else if (name === 'postMessage') add(node, 'escape.post-message', 'high', 'Calls postMessage directly — the kit is the only messenger')
          else if (WORKERS.has(name)) add(node, 'escape.worker', 'high', `Starts a ${name}`)
          else if ((name === 'setTimeout' || name === 'setInterval') && node.arguments[0]) {
            const first = node.arguments[0] as AnyNode
            if (first.type === 'Literal' || first.type === 'TemplateLiteral' || first.type === 'BinaryExpression') {
              add(node, 'escape.dynamic-code', 'high', `${name} with a string runs text as code`)
            }
          }
        }
        // The kit's hooks call the bridge on the Tool's behalf.
        if (callee.type === 'Identifier' && Object.hasOwn(BRIDGE_HOOKS, callee.name)) {
          calls.push({ method: BRIDGE_HOOKS[callee.name], arg: stringValue(node.arguments[0] as AnyNode), file: unit.file, ...lineOf(where(node)) })
        }
        if (callee.type === 'MemberExpression') {
          const method = propertyName(callee)
          const { root, path } = memberChain(callee)
          // document.createElement('script' | 'iframe' | 'meta' | 'link' …)
          if (method === 'createElement' && (root === 'document' || path[0] === 'document') && isGlobal(root)) {
            const tag = stringValue(node.arguments[0] as AnyNode)
            if (tag) checkElement(node, tag, new Map())
          }
          // Reflect.get(window, …) and friends reach a global by a name no rule can read.
          if (
            (root === 'Reflect' || root === 'Object') &&
            isGlobal(root) &&
            ['get', 'set', 'apply', 'getOwnPropertyDescriptor', 'getOwnPropertyDescriptors', 'getPrototypeOf'].includes(method ?? '')
          ) {
            const first = node.arguments[0] as AnyNode | undefined
            if (
              first?.type === 'Identifier' &&
              isGlobal(first.name) &&
              (WINDOW_NAMES.has(first.name) || OTHER_WINDOWS.has(first.name) || first.name === 'document')
            ) {
              add(node, 'obfuscation.computed-global', 'high', `Reaches into ${first.name} through ${root}.${method}`)
            }
          }
          if (method === 'fromCharCode' && node.arguments.length >= 8) {
            add(node, 'obfuscation.char-codes', 'medium', `Builds text from ${node.arguments.length} character codes`)
          }
          if ((method === 'assign' || method === 'replace') && path.includes('location') && isGlobal(root)) {
            add(node, 'escape.navigation', 'high', `Navigates the frame (location.${method})`)
          }
          // The bridge: <anything>.context.read(…), .connectors.call(…), …
          const family = path.length >= 2 ? path[path.length - 2] : null
          const bridge = family && method ? BRIDGE_FAMILIES[family]?.[method] : undefined
          if (bridge) {
            calls.push({ method: bridge, arg: stringValue(node.arguments[0] as AnyNode), file: unit.file, ...lineOf(where(node)) })
          }
          // setTimeout called off the window with a string.
          if ((method === 'setTimeout' || method === 'setInterval') && isWindow(root) && node.arguments[0]) {
            const first = node.arguments[0] as AnyNode
            if (first.type === 'Literal' || first.type === 'TemplateLiteral' || first.type === 'BinaryExpression') {
              add(node, 'escape.dynamic-code', 'high', `${method} with a string runs text as code`)
            }
          }
        }
        break
      }

      case 'NewExpression': {
        const callee = node.callee as AnyNode
        const name = callee.type === 'Identifier' && isGlobal(callee.name) ? callee.name : null
        const member = callee.type === 'MemberExpression' ? globalPath(callee) : null
        const target = name ?? (member && member.length === 1 ? member[0] : null)
        if (!target) break
        if (target === 'Function') add(node, 'escape.dynamic-code', 'high', 'new Function runs text as code')
        else if (target === 'Image') add(node, 'exfil.image-probe', 'medium', 'Loads an image by script — the shape of a beacon')
        else if (NETWORK.has(target)) add(node, 'exfil.network', 'high', `${target} is not reachable from a Tool — use the bridge`)
        else if (WEBRTC.has(target)) add(node, 'exfil.webrtc', 'high', `${target} can carry data past the frame's policy`)
        else if (WORKERS.has(target)) add(node, 'escape.worker', 'high', `Starts a ${target}`)
        break
      }

      case 'AssignmentExpression': {
        const left = node.left as AnyNode
        if (left.type === 'Identifier' && left.name === 'location' && isGlobal('location')) {
          add(node, 'escape.navigation', 'high', 'Navigates the frame (location =)')
          break
        }
        if (left.type !== 'MemberExpression') break
        const prop = propertyName(left)
        const path = globalPath(left)
        if (path && (path[path.length - 1] === 'location' || (path.includes('location') && prop === 'href'))) {
          add(node, 'escape.navigation', 'high', `Navigates the frame (${path.join('.')} =)`)
        }
        if (prop === 'srcdoc') add(node, 'escape.srcdoc', 'high', 'Writes a srcdoc document')
        if (prop === 'target') {
          const aim = (stringValue(node.right as AnyNode) ?? '').toLowerCase()
          if (aim === '_top' || aim === '_parent') add(node, 'escape.link-target', 'high', `A link aimed at ${aim}`)
        }
        if (prop === 'innerHTML' || prop === 'outerHTML') add(node, 'escape.raw-html', 'medium', `Writes raw HTML (${prop})`)
        if ((prop === 'src' || prop === 'href' || prop === 'action' || prop === 'data') && isBuiltString(node.right as AnyNode)) {
          const prefix = staticPrefix(node.right as AnyNode) ?? ''
          if (/^(https?:)?\/\//i.test(prefix)) {
            add(node, 'exfil.beacon', 'high', `Points ${prop} at a URL built from data — a request the page makes for it`)
          }
        }
        // data.js: handlers.<name> = …
        if (unit.file === 'data.js' && left.object.type === 'Identifier' && left.object.name === 'handlers' && prop) {
          handlers.push(prop)
        }
        break
      }
    }
  })

  return { findings, calls, handlers, strings }
}

function lineOf(at: { line?: number }): { line?: number } {
  return at.line === undefined ? {} : { line: at.line }
}
