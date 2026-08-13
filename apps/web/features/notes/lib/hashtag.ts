// Tiptap extension that styles inline Roam-style #hashtags. The tag text stays
// plain text in the document (and the serialised markdown) — we only layer a
// ProseMirror decoration over each match so it renders as a clickable pill,
// recomputed on every change. The click is handled in NoteEditor via the
// `.hashtag` span's `data-tag` attribute.

import { Extension } from '@tiptap/core'
import { Plugin } from '@tiptap/pm/state'
import { Decoration, DecorationSet } from '@tiptap/pm/view'
import type { Node as PMNode } from '@tiptap/pm/model'

// Same shape as shared/markdown.ts's HASHTAG_RE, applied per text node. A
// leading-letter requirement and the preceding-boundary check keep "#123" and
// "page#frag" out.
const HASHTAG_RE = /(?<=^|\s)#([A-Za-z][\w-]*)/g

function hashtagDecorations(doc: PMNode): DecorationSet {
  const decorations: Decoration[] = []
  doc.descendants((node, pos) => {
    if (!node.isText || !node.text) return
    for (const match of node.text.matchAll(HASHTAG_RE)) {
      const start = pos + (match.index ?? 0)
      const end = start + match[0].length
      decorations.push(Decoration.inline(start, end, { class: 'hashtag', 'data-tag': match[1] }))
    }
  })
  return DecorationSet.create(doc, decorations)
}

export const Hashtag = Extension.create({
  name: 'hashtag',
  addProseMirrorPlugins() {
    return [
      new Plugin({
        state: {
          init: (_, { doc }) => hashtagDecorations(doc),
          apply: (tr, old) => (tr.docChanged ? hashtagDecorations(tr.doc) : old),
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
