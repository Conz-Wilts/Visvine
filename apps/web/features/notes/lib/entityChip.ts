// Tiptap extension that renders directory-entity links (people/<slug>.md,
// companies/<slug>.md) as an inline avatar chip — `[[ ⬛ Name ]]`. Like the
// Hashtag extension it is decoration-only: the stored markdown stays a plain OKF
// link `[Name](/people/<slug>.md)`, and we only layer a ProseMirror decoration
// (an avatar widget + a class) over each entity link, recomputed on change.
//
// The opening `[[ ` and the avatar square live in a widget placed before the
// link; the name is the link text (class `entity-link`); the closing ` ]]` is a
// CSS ::after on `.entity-link`. Entity data is supplied by the caller via
// `getEntity(path)` (a ref into the community node map), and a
// `setMeta('entityChipRefresh')` transaction forces a recompute once that map loads.

import { Extension } from '@tiptap/core'
import { Plugin, PluginKey } from '@tiptap/pm/state'
import { Decoration, DecorationSet } from '@tiptap/pm/view'
import type { Node as PMNode, Mark } from '@tiptap/pm/model'
import { getInitials, getAvatarColor } from '@/lib/avatarUtils'
import { parseEntityHref } from '@/lib/notes/entities'

export interface ChipEntity {
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

export const entityChipKey = new PluginKey('entityChip')

function linkHref(marks: readonly Mark[]): string | null {
  const link = marks.find((m) => m.type.name === 'link')
  const href = link?.attrs?.href
  return typeof href === 'string' ? href : null
}

// Build the avatar square element: an <img> when the entity has a photo, else a
// colored initials square — mirrors components/ui/Avatar.tsx (size "chip").
function buildAvatar(entity: ChipEntity): HTMLElement {
  if (entity.image_url) {
    const img = document.createElement('img')
    img.src = entity.image_url
    img.alt = entity.name
    img.className = 'entity-avatar'
    return img
  }
  const div = document.createElement('span')
  div.className = `entity-avatar entity-avatar--initials ${getAvatarColor(entity.name)}`
  div.textContent = getInitials(entity.name)
  return div
}

function buildWidget(entity: ChipEntity, path: string, kindClass: string): HTMLElement {
  const wrap = document.createElement('span')
  wrap.className = `entity-chip-widget ${kindClass}`
  wrap.setAttribute('contenteditable', 'false')
  wrap.setAttribute('data-path', path)
  const open = document.createElement('span')
  open.className = 'entity-bracket'
  open.textContent = '[['
  wrap.appendChild(open)
  wrap.appendChild(buildAvatar(entity))
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
    const kindClass = entity.type.toLowerCase().startsWith('org') ? 'entity-company' : 'entity-person'
    decorations.push(
      Decoration.widget(start, () => buildWidget(entity, path, kindClass), {
        side: -1,
        key: `entity:${path}:${start}`,
      }),
    )
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
