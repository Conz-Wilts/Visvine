/**
 * The kit's components, drawn: a Tool whose one screen renders every
 * component entry of the catalog (apps/web lib/tools/catalog.ts) from its own
 * snippet — the list `get_tool_sdk` and COMPONENTS.md read —
 * so `visvine-tool dev` shows the app's look beside the Tool being built.
 */
import { snippetImports, TOOL_CATALOG } from '@/lib/tools/catalog'

const components = TOOL_CATALOG.filter((entry) => entry.kind === 'component')
const names = [...new Set(components.flatMap(snippetImports))].sort()

const sections = components
  .map(
    (entry) => `      <section style={SECTION}>
        <div style={HEAD}>
          <strong style={NAME}>${entry.name}</strong>
          <span style={WHAT}>{${JSON.stringify(entry.what)}}</span>
        </div>
        <div style={BODY}>
          ${entry.snippet.split('\n').join('\n          ')}
        </div>
      </section>`,
  )
  .join('\n')

export const GALLERY_SOURCE = `import { ${names.join(', ')} } from '@visvine/tool-kit'

const SECTION = { borderTop: '1px solid var(--vv-color-line-subtle)', padding: '16px 0' }
const HEAD = { display: 'flex', gap: 8, alignItems: 'baseline', marginBottom: 10 }
const NAME = { fontSize: 13, color: 'var(--vv-color-fg)' }
const WHAT = { fontSize: 12, color: 'var(--vv-color-fg-muted)' }
const BODY = { maxWidth: 640 }

export default function Gallery() {
  return (
    <div>
${sections}
    </div>
  )
}
`
