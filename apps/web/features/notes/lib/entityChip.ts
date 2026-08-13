// Tiptap extension that renders directory-entity links (people/<slug>.md,
// communities/<slug>.md) as an inline mention — `⬛ Name`, where the avatar square
// only appears when the entity has a real photo. Like the Hashtag extension it
// is decoration-only: the stored markdown stays a plain OKF link
// `[Name](/people/<slug>.md)`, and we only layer a ProseMirror decoration
// (an optional avatar widget + a class) over each entity link, recomputed on change.
//
// The avatar (photo entities only) lives in a widget placed before the link; the
// name is the link text (class `entity-link`). Entity data is supplied by the
// caller via `getEntity(path)` (a ref into the space node map), and a
// `setMeta('entityChipRefresh')` transaction forces a recompute once that map loads.

import { Extension } from '@tiptap/core'
import { Plugin, PluginKey } from '@tiptap/pm/state'
import { Decoration, DecorationSet } from '@tiptap/pm/view'
import type { Node as PMNode, Mark } from '@tiptap/pm/model'
import { entityKindOf, parseEntityHref } from '@/lib/notes/entities'

interface ChipEntity {
  id: string
  name: string
  type: string
  image_url?: string | null
  alias?: string | null
}

export interface EntityChipOptions {
  // Resolve a normalized entity note path (e.g. "people/craig-piggott.md") to its
  // directory node, or null when unknown (map still loading / not an entity).
  getEntity: (path: string) => ChipEntity | null
}

const entityChipKey = new PluginKey('entityChip')

function linkHref(marks: readonly Mark[]): string | null {
  const link = marks.find((m) => m.type.name === 'link')
  const href = link?.attrs?.href
  return typeof href === 'string' ? href : null
}

// Build the avatar widget — only for entities with a real photo; entities
// without one render as a plain styled name (no initials fallback).
function buildWidget(entity: ChipEntity, path: string, kindClass: string): HTMLElement {
  const wrap = document.createElement('span')
  wrap.className = `entity-chip-widget ${kindClass}`
  wrap.setAttribute('contenteditable', 'false')
  wrap.setAttribute('data-path', path)
  const img = document.createElement('img')
  img.src = entity.image_url as string
  img.alt = entity.name
  img.className = 'entity-avatar'
  wrap.appendChild(img)
  return wrap
}

function buildDecorations(doc: PMNode, getEntity: EntityChipOptions['getEntity']): DecorationSet {
  const decorations: Decoration[] = []
  doc.descendants((node, pos) => {
    if (!node.isText || !node.text) return
    const href = linkHref(node.marks)
    if (!href) return
    const path = parseEntityHref(href)
    if (!path) return
    const entity = getEntity(path)
    if (!entity) return // unknown node (map loading / stale) → leave as a normal link
    const start = pos
    const end = pos + node.nodeSize
    // entityKindOf, not a prefix test: an organisation's stored type has been
    // 'organization', then 'group', and is now 'space', and only the first
    // of those starts with "org".
    // CSS class name is styling plumbing — it keeps its old spelling.
    const kindClass = entityKindOf(entity.type) === 'space' ? 'entity-space' : 'entity-person'
    if (entity.image_url) {
      decorations.push(
        Decoration.widget(start, () => buildWidget(entity, path, kindClass), {
          side: -1,
          key: `entity:${path}:${start}`,
        }),
      )
    }
    decorations.push(Decoration.inline(start, end, { class: `entity-link ${kindClass}`, 'data-path': path }))
  })
  return DecorationSet.create(doc, decorations)
}

export const EntityChip = Extension.create<EntityChipOptions>({
  name: 'entityChip',

  addOptions() {
    return { getEntity: () => null }
  },

  addProseMirrorPlugins() {
    const getEntity = this.options.getEntity
    return [
      new Plugin({
        key: entityChipKey,
        state: {
          init: (_, { doc }) => buildDecorations(doc, getEntity),
          apply: (tr, old) =>
            tr.docChanged || tr.getMeta('entityChipRefresh')
              ? buildDecorations(tr.doc, getEntity)
              : old,
        },
        props: {
          decorations(state) {
            return this.getState(state)
          },
        },
      }),
    ]
  },
})
