'use client'

// The note editor: a Tiptap WYSIWYG surface (markdown round-tripped via
// tiptap-markdown) whose Edit/Raw mode is driven by the surface's Editor/Raw toggle.
// Markdown is the source of truth, so the frontmatter prefix is split off on load
// and re-attached on save, the body is what's edited, and `[[` opens a note picker
// that inserts an OKF [title](/path.md) link. Body, references, and the freshness
// line share one centred scroll column so the references read as a continuation of
// the note. Saves are debounced and bubbled up via onSave.

import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { useEditor, EditorContent, type Editor } from '@tiptap/react'
import { getMarkRange } from '@tiptap/core'
import { TextSelection, type EditorState } from '@tiptap/pm/state'
import StarterKit from '@tiptap/starter-kit'
import TaskList from '@tiptap/extension-task-list'
import TaskItem from '@tiptap/extension-task-item'
import { Table, TableRow, TableHeader, TableCell } from '@tiptap/extension-table'
import { Markdown } from 'tiptap-markdown'
import {
  BoldIcon,
  CheckIcon,
  ChevronsUpDownIcon,
  CircleCheckIcon,
  CodeIcon,
  ItalicIcon,
  ListIcon,
  ListOrderedIcon,
  TableIcon,
  TextQuoteIcon,
  XIcon,
} from '@/features/shared/icons';
import { Hashtag } from '../lib/hashtag'
import { EntityChip } from '../lib/entityChip'
import { NotePicker, type PickerEntity } from './NotePicker'
import { LinkedReferences } from './LinkedReferences'
import { NoteModeToggle, type NoteMode } from './NoteModeToggle'
import { RawNoteText } from './RawNoteText'
import { parseEntityHref } from '@/lib/notes/entities'
import { joinFrontmatter, splitFrontmatter, resolveOkfLink, parseFrontmatter } from '@/lib/notes/shared/markdown'
import {
  folderOfIndexPath,
  isIndexPath,
  parseChildrenBlock,
  reattachChildrenBlock,
  splitChildrenBlock,
  stripDuplicateTitleHeading,
  type IndexChild,
} from '@/lib/notes/shared/indexNote'
import { useTabBarSlot } from '@/features/shared/contexts/TabBarSlotContext'
import { TAB_MOTION_MS } from '@/components/ui/tabMotion'
import type { NoteFrontmatter, NoteMeta, References, RestrictedReference, UnlinkedReference } from '@/lib/notes/shared/types'

const AUTOSAVE_MS = 350
// How long the tab bar's attached region takes to collapse (TAB_MOTION). The
// toolbar tray keeps its full contents for exactly this long after a switch to
// raw, so it rides the region's slide-up as one piece.
const TRAY_RETRACT_MS = TAB_MOTION_MS

interface NoteRef {
  path: string
  title: string
}

interface NoteEditorProps {
  path: string
  meta: NoteMeta | null
  notes: NoteRef[]
  initialContent: string
  /** Frontmatter keys the record owns, drawn as such in raw mode and closed
   *  to input there (lib/notes/shared/heldKeys.ts). The store holds them on
   *  every write either way; this is the surface saying so. */
  heldKeys?: readonly string[]
  canEdit: boolean
  // Edit/Raw mode — lifted to the surface; the toolbar's NoteModeToggle drives
  // it through onModeChange.
  mode: 'wysiwyg' | 'raw'
  onModeChange?: (mode: NoteMode) => void
  references: References | null
  /** Show the unlinked-references group under the note. Off on entity Context
   *  tabs, where speculative name matches crowd out the profile's own links. */
  showUnlinked?: boolean
  // Directory entities for `[[ ]]` mentions: the picker list + a path→entity map
  // the chip decoration reads, and a hook that ensures the entity's note exists.
  entities?: PickerEntity[]
  entityByPath?: Map<string, PickerEntity>
  onEnsureEntityNote?: (entity: PickerEntity) => Promise<string>
  onSave: (path: string, content: string, origin?: string) => void
  onOpenNote: (path: string) => void
  onOpenTag?: (tag: string) => void
  // Turn one unlinked reference into a real link (writes the SOURCE note). Only
  // offered when the viewer can edit; the source note's own gate still applies
  // server-side, so a denial surfaces inline on the reference.
  onLinkMention?: (ref: UnlinkedReference) => Promise<void>
  // Ask for access to the hidden source note behind a locked reference stub.
  onRequestReferenceAccess?: (ref: RestrictedReference) => Promise<void>
  // Layout variant:
  //  - 'floating' (default): the /context-era full-bleed layout — the note is
  //    its own scroll surface bleeding up behind the navbar, toolbar pinned at
  //    top-[88px].
  //  - 'boxed': inside a fixed-height box (the directory Context view) — same
  //    internal scroll, but the toolbar pins to the top of the box.
  //  - 'embedded': the profile Context tab — natural page flow (the page owns
  //    scrolling), no entity header / big title (the profile above the tab IS
  //    the identity), toolbar as a sticky in-flow row.
  variant?: 'floating' | 'boxed' | 'embedded'
  // Embedded only: content rendered directly below the sticky toolbar and above
  // the note body (the entity header card), so it scrolls up behind the toolbar.
  headerSlot?: React.ReactNode | ((args: NoteHeaderSlotArgs) => React.ReactNode)
  /** Embedded only: render the note's own title heading above the body. Off by
   *  default there (the profile header IS the identity); on for a sub-note in
   *  an entity folder, whose title is its own. */
  showTitle?: boolean
  // Embedded only: rendered at the far right of the toolbar row, after the
  // Editor/Raw toggle (the entity panel's Share button). Renders in raw mode too.
  toolbarTrailSlot?: React.ReactNode
}

/**
 * The embedded header lives outside the editor's DOM, but its Type and Tags
 * still belong to the same markdown document. A render callback lets that
 * header change frontmatter through the editor, so an in-flight body autosave
 * can never overwrite a just-clicked tag (or the other way around).
 */
export interface NoteHeaderSlotArgs {
  frontmatter: NoteFrontmatter
  replaceFrontmatter: (frontmatter: NoteFrontmatter) => void
  editable: boolean
}

type MarkdownStorage = { markdown: { getMarkdown: () => string } }
function getMarkdown(ed: Editor): string {
  return (ed.storage as unknown as MarkdownStorage).markdown.getMarkdown()
}

// The note as it goes back to the store: the two machine-owned parts the editor
// never shows (frontmatter, an index's child block) wrapped back around the body
// somebody actually edited.
function composeContent(prefix: string, body: string, childrenBlock: string | null): string {
  return prefix + reattachChildrenBlock(body, childrenBlock)
}

// The document range of the link covering `pos`, or null when `pos` isn't inside
// one. Links are plain marks in the doc; this is what lets the editor treat them
// as a single unit for clicking and deleting.
function linkRangeAt(state: EditorState, pos: number): { from: number; to: number } | null {
  const type = state.schema.marks.link
  if (!type) return null
  return getMarkRange(state.doc.resolve(pos), type) ?? null
}

function buildPrefix(frontmatter: string | null): string {
  return frontmatter !== null ? `---\n${frontmatter}\n---\n\n` : ''
}

// The note title renders as a heading above the body (from frontmatter), so a body
// that still opens with a `# Title` line duplicating it — older notes, or notes from
// a space whose seed predates this — gets that leading heading stripped on load
// (stripDuplicateTitleHeading, the same rule the store holds index notes to).
// Display-side only: the stored markdown migrates the next time the note is saved.

// The title shown above the body: frontmatter title, else the filename slug.
function titleFromContent(content: string, path: string): string {
  const fm = String(parseFrontmatter(content).title ?? '').trim()
  return fm || path.replace(/\.md$/i, '').split('/').pop() || path
}

const NO_HELD_KEYS: readonly string[] = []

export function NoteEditor({
  path,
  meta,
  notes,
  initialContent,
  heldKeys = NO_HELD_KEYS,
  canEdit,
  mode,
  onModeChange,
  references,
  showUnlinked = true,
  entities,
  entityByPath,
  onEnsureEntityNote,
  onSave,
  onOpenNote,
  onOpenTag,
  onLinkMention,
  onRequestReferenceAccess,
  variant = 'floating',
  headerSlot,
  showTitle = false,
  toolbarTrailSlot,
}: NoteEditorProps) {
  const embedded = variant === 'embedded'
  const floating = variant === 'floating'
  const [rawContent, setRawContent] = useState(initialContent)
  const [headerFrontmatter, setHeaderFrontmatter] = useState<NoteFrontmatter>(() => parseFrontmatter(initialContent))
  const [linkPickerOpen, setLinkPickerOpen] = useState(false)
  // Viewport rect of the caret when `[[` opened the picker, so it can dock just
  // below where the user is typing rather than as a centered modal.
  const [linkAnchor, setLinkAnchor] = useState<{ left: number; top: number; bottom: number } | null>(null)
  const [error, setError] = useState<string | null>(null)
  // Embedded only: the tab bar's attached region is our toolbar's home, and it
  // opened when the tab did (see TabBarSlotContext).
  const { host: toolbarHost } = useTabBarSlot()

  // The mode the toolbar tray is dressed for. Hosts collapse the tab bar's
  // attached region on Raw — that collapse is the tray's slide-up. This lags
  // `mode` on a switch to raw so the tray stays populated for the length of the
  // collapse and retracts as one piece, rather than dropping its format
  // controls on the first frame. Switching back is immediate: the region must
  // drop down already dressed.
  const [trayMode, setTrayMode] = useState(mode)
  useEffect(() => {
    if (mode === trayMode) return
    if (mode === 'wysiwyg' || !(embedded && toolbarHost)) {
      setTrayMode(mode)
      return
    }
    const t = setTimeout(() => setTrayMode('raw'), TRAY_RETRACT_MS)
    return () => clearTimeout(t)
  }, [mode, trayMode, embedded, toolbarHost])

  // Latched on the first Edit ⇄ Raw switch (render-phase, so the very first
  // switch animates too): the body's drop-in plays on every mode swap after,
  // but never on the note's initial mount — the page owns that entrance.
  const [prevMode, setPrevMode] = useState(mode)
  const [modeSwitched, setModeSwitched] = useState(false)
  if (mode !== prevMode) {
    setPrevMode(mode)
    setModeSwitched(true)
  }

  const prefixRef = useRef('')
  // An index note's machine-maintained child block, held out of the editor the
  // same way the frontmatter prefix is (see splitChildrenBlock) and put back on
  // every save. Null for the notes that aren't folders — almost all of them.
  const childrenBlockRef = useRef<string | null>(null)
  const [children, setChildren] = useState<IndexChild[]>([])
  // The folder this note IS, when it is one — what the block's relative hrefs
  // are relative to. Empty for every note that isn't a folder's index.
  const childFolder = useMemo(() => (isIndexPath(path) ? folderOfIndexPath(path) : ''), [path])
  // The listing as OKF writes it: the block's sections, in block order, each
  // holding its rows. One section (the common case) renders headless — the
  // "In this folder" heading is already saying it.
  const childSections = useMemo(() => {
    const groups: { section: string; children: IndexChild[] }[] = []
    for (const child of children) {
      const section = child.section ?? 'Notes'
      const last = groups[groups.length - 1]
      if (last && last.section === section) last.children.push(child)
      else groups.push({ section, children: [child] })
    }
    return groups
  }, [children])
  const rawRef = useRef<HTMLTextAreaElement>(null)
  const pathRef = useRef(path)
  const originRef = useRef<string>('edit')
  const pendingRef = useRef<string | null>(null)
  const saveTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  // True while we're programmatically loading content into the editor, so the
  // onUpdate that setContent fires (asynchronously) doesn't schedule a spurious
  // autosave of the round-tripped markdown on every note open.
  const loadingRef = useRef(false)
  const linkRangeRef = useRef<{ from: number; to: number } | null>(null)
  const onSaveRef = useRef(onSave)
  onSaveRef.current = onSave
  const notesSet = useMemo(() => new Set(notes.map((n) => n.path)), [notes])
  const notesSetRef = useRef(notesSet)
  notesSetRef.current = notesSet
  // The entity map is read by the EntityChip decoration through a stable getter so
  // the chips update as the space node map loads without recreating the editor.
  const entityByPathRef = useRef(entityByPath)
  entityByPathRef.current = entityByPath
  const getEntityRef = useRef((p: string) => entityByPathRef.current?.get(p) ?? null)

  const flush = useCallback(() => {
    if (saveTimerRef.current) {
      clearTimeout(saveTimerRef.current)
      saveTimerRef.current = null
    }
    if (pendingRef.current !== null) {
      onSaveRef.current(pathRef.current, pendingRef.current, originRef.current)
      pendingRef.current = null
      originRef.current = 'edit'
    }
  }, [])

  const queueSave = useCallback(
    (content: string) => {
      pendingRef.current = content
      if (saveTimerRef.current) clearTimeout(saveTimerRef.current)
      saveTimerRef.current = setTimeout(flush, AUTOSAVE_MS)
    },
    [flush],
  )

  const editor = useEditor({
    editable: canEdit,
    immediatelyRender: false,
    extensions: [
      StarterKit.configure({ link: { openOnClick: false } }),
      TaskList,
      TaskItem.configure({ nested: true }),
      Table.configure({ resizable: true }),
      TableRow,
      TableHeader,
      TableCell,
      Markdown.configure({ html: false, tightLists: true }),
      Hashtag,
      EntityChip.configure({ getEntity: getEntityRef.current }),
    ],
    editorProps: {
      attributes: { class: 'note-prose notes-editor focus:outline-none' },
      // Typing the second '[' of '[[' opens the note-link picker.
      handleTextInput: (innerView, from, _to, text) => {
        if (text !== '[' || !canEdit) return false
        const before = from > 0 ? innerView.state.doc.textBetween(from - 1, from) : ''
        if (before !== '[') return false
        linkRangeRef.current = { from: from - 1, to: from }
        const c = innerView.coordsAtPos(from)
        setLinkAnchor({ left: c.left, top: c.top, bottom: c.bottom })
        setLinkPickerOpen(true)
        return true
      },
      // A link reads as one unit, so the caret never lands inside its text:
      // pressing down on a link parks the caret just after it instead. Handled on
      // mousedown (not click) so the browser never paints a mid-word caret first.
      handleDOMEvents: {
        mousedown: (view, event) => {
          if (event.button !== 0) return false
          if (!(event.target as HTMLElement).closest('a')) return false
          const found = view.posAtCoords({ left: event.clientX, top: event.clientY })
          const range = found ? linkRangeAt(view.state, found.pos) : null
          if (!range) return false
          event.preventDefault()
          view.dispatch(view.state.tr.setSelection(TextSelection.create(view.state.doc, range.to)))
          if (view.editable) view.focus()
          return true
        },
      },
      // Backspace at a link's trailing edge removes the whole link, matching the
      // caret rule above — a link is deleted as a unit, not a character at a time.
      handleKeyDown: (view, event) => {
        if (event.key !== 'Backspace' || !view.editable) return false
        const { selection } = view.state
        if (!selection.empty) return false
        const pos = selection.from
        const range = pos > 0 ? linkRangeAt(view.state, pos - 1) : null
        if (!range || range.to !== pos) return false
        view.dispatch(view.state.tr.delete(range.from, range.to))
        return true
      },
      handleClickOn: (_v, _pos, _node, _np, event) => {
        const tagEl = (event.target as HTMLElement).closest('.hashtag')
        if (tagEl) {
          const tag = tagEl.getAttribute('data-tag')
          if (tag && onOpenTag) {
            onOpenTag(tag)
            return true
          }
        }
        // The avatar square of an entity chip lives in a widget outside the <a>;
        // route its click to the entity's note like the name itself.
        const chip = (event.target as HTMLElement).closest('.entity-chip-widget')
        const chipPath = chip?.getAttribute('data-path')
        if (chipPath) {
          onOpenNote(chipPath)
          return true
        }
        const anchor = (event.target as HTMLElement).closest('a')
        const href = anchor?.getAttribute('href')
        if (!href) return false
        if (/^(https?:|mailto:)/.test(href)) {
          window.open(href, '_blank', 'noreferrer')
          return true
        }
        const resolved = resolveOkfLink(href, pathRef.current)
        // Open if the note is in this context's index, OR it's a directory entity
        // note — those resolve to the canonical shared note even when the current
        // context doesn't have them (the workspace handles the cross-context open).
        if (resolved && (notesSetRef.current.has(resolved) || parseEntityHref(resolved))) {
          onOpenNote(resolved)
          return true
        }
        return false
      },
    },
    onUpdate: ({ editor: ed }) => {
      if (!canEdit || loadingRef.current) return
      queueSave(composeContent(prefixRef.current, getMarkdown(ed), childrenBlockRef.current))
    },
  })

  // Load note content on path change without counting as an edit. Flush a pending
  // save from the previous note first so switching never drops an edit.
  useEffect(() => {
    if (!editor) return
    flush()
    loadingRef.current = true
    pathRef.current = path
    const { frontmatter, body } = splitFrontmatter(initialContent)
    prefixRef.current = buildPrefix(frontmatter)
    setHeaderFrontmatter(parseFrontmatter(initialContent))
    const split = splitChildrenBlock(stripDuplicateTitleHeading(body, titleFromContent(initialContent, path)))
    childrenBlockRef.current = split.block
    setChildren(parseChildrenBlock(split.block, childFolder))
    editor.commands.setContent(split.body, { emitUpdate: false })
    setRawContent(initialContent)
    pendingRef.current = null
    if (saveTimerRef.current) {
      clearTimeout(saveTimerRef.current)
      saveTimerRef.current = null
    }
    // Re-arm autosave after the setContent's async onUpdate has fired + been swallowed.
    const t = setTimeout(() => {
      loadingRef.current = false
    }, 0)
    return () => clearTimeout(t)
  }, [path, childFolder, initialContent, editor, flush])

  // Round-trip the body when the workspace flips Edit ⇄ Raw. Going to Raw snapshots
  // the live editor markdown; coming back parses the (possibly hand-edited) raw text
  // back into the editor. Guarded so a no-op re-render (e.g. typing in raw) is ignored.
  const prevModeRef = useRef(mode)
  useEffect(() => {
    if (!editor || mode === prevModeRef.current) return
    if (mode === 'raw') {
      // Raw IS the source, child block and all — it's the one surface that shows
      // the markers. RawNoteText draws the block, and the record's keys, as
      // held: the store regenerates them on write whatever was typed.
      setRawContent(composeContent(prefixRef.current, getMarkdown(editor), childrenBlockRef.current))
    } else {
      loadingRef.current = true
      const { frontmatter, body } = splitFrontmatter(rawContent)
      prefixRef.current = buildPrefix(frontmatter)
      setHeaderFrontmatter(parseFrontmatter(rawContent))
      const split = splitChildrenBlock(body)
      childrenBlockRef.current = split.block
      setChildren(parseChildrenBlock(split.block, childFolder))
      editor.commands.setContent(split.body, { emitUpdate: false })
      if (canEdit) queueSave(rawContent)
      setTimeout(() => {
        loadingRef.current = false
      }, 0)
    }
    prevModeRef.current = mode
  }, [mode, editor, rawContent, canEdit, queueSave, childFolder])

  // Embedded raw: grow the textarea to its content so the page owns the scroll.
  // A fixed-height textarea would scroll inside the 760px writing column, putting
  // its scrollbar mid-screen instead of at the window edge.
  useEffect(() => {
    const el = rawRef.current
    if (!el || !embedded || mode !== 'raw') return
    el.style.height = 'auto'
    el.style.height = `${el.scrollHeight}px`
  }, [rawContent, mode, embedded])

  // Flush any pending edit on unmount.
  useEffect(() => flush, [flush])

  useEffect(() => {
    editor?.setEditable(canEdit)
  }, [editor, canEdit])

  // Flag links to missing notes (broken) and tag internal note links so they
  // render wrapped in [[ ]] via CSS. Re-runs on every edit, and on note/mode
  // switches too — those load content via setContent with emitUpdate:false, so
  // the 'update' listener alone would leave the freshly loaded anchors untagged.
  useEffect(() => {
    if (!editor) return
    const unresolved = new Set(meta?.unresolved ?? [])
    const mark = () => {
      editor.view.dom.querySelectorAll('a').forEach((a) => {
        const href = a.getAttribute('href') ?? ''
        // Entity links are styled by the EntityChip decoration, not these classes.
        if (parseEntityHref(href)) {
          a.classList.remove('broken-link', 'note-link')
          return
        }
        a.classList.toggle('broken-link', unresolved.has(href))
        a.classList.toggle('note-link', !!href && !/^(https?:|mailto:|#)/.test(href))
      })
    }
    mark()
    editor.on('update', mark)
    return () => {
      editor.off('update', mark)
    }
  }, [editor, meta, path, initialContent, mode])

  // Repaint entity chips when the space node map arrives/changes (the editor
  // isn't recreated, so nudge the decoration plugin to recompute).
  useEffect(() => {
    if (!editor) return
    editor.view.dispatch(editor.state.tr.setMeta('entityChipRefresh', true))
  }, [editor, entityByPath])

  // Ctrl/Cmd-S forces an immediate save.
  useEffect(() => {
    if (!editor) return
    const onKey = (e: KeyboardEvent) => {
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 's') {
        e.preventDefault()
        if (mode === 'wysiwyg') {
          pendingRef.current = composeContent(prefixRef.current, getMarkdown(editor), childrenBlockRef.current)
        }
        flush()
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [editor, flush, mode])

  const insertLink = useCallback(
    (target: string, label?: string) => {
      if (!editor) return
      const range = linkRangeRef.current
      const title = label ?? notes.find((n) => n.path === target)?.title ?? target
      let chain = editor.chain().focus()
      if (range) chain = chain.deleteRange(range)
      chain
        .insertContent({
          type: 'text',
          text: title,
          marks: [{ type: 'link', attrs: { href: `/${target}` } }],
        })
        .unsetMark('link')
        .insertContent(' ')
        .run()
      linkRangeRef.current = null
      setLinkPickerOpen(false)
    },
    [editor, notes],
  )

  const onRawChange = (value: string) => {
    setRawContent(value)
    if (canEdit) queueSave(value)
  }

  // Keep frontmatter edits on the editor's one save pipeline. In particular,
  // do not let a header write race the debounced body write: both compose from
  // this same prefix and current editor document.
  const replaceFrontmatter = useCallback((frontmatter: NoteFrontmatter) => {
    if (!editor || !canEdit) return
    const serialized = joinFrontmatter(frontmatter, '')
    prefixRef.current = buildPrefix(splitFrontmatter(serialized).frontmatter)
    setHeaderFrontmatter(frontmatter)
    queueSave(composeContent(prefixRef.current, getMarkdown(editor), childrenBlockRef.current))
    // Header controls have no visible "Saving…" state. Commit them now rather
    // than making a person wait for the body debounce before a removed type/tag
    // reaches the server. The content is still composed from the live editor,
    // so this cannot discard a body edit made just before the click.
    flush()
  }, [editor, canEdit, queueSave, flush])

  // The title shown above the body: index meta, else the note's own frontmatter
  // (parsed from content — so notes outside this context's index still title).
  // Entity context notes normally never open here (the workspace routes them to
  // their profile's Context tab); the rare fallback (unresolvable node) renders
  // the plain title like any other note.
  const noteTitle = (meta?.title?.trim() || titleFromContent(initialContent, path)) ?? path

  // The formatting pill is shared between two layouts: a floating overlay in
  // the full workspace, a sticky in-flow row when embedded (the profile Context
  // tab scrolls with the page, so overlays can't anchor).
  // Presence is decided by canEdit + mode ALONE — deliberately not by `editor`.
  // useEditor({ immediatelyRender: false }) returns null on a new instance's first
  // render, so gating the controls on it emptied the whole toolbar row every time
  // the editor remounted (every note switch, since NoteContextPanel keys the editor
  // by path) and refilled it once Tiptap initialised. That blink is the toolbar
  // flash: the row is part of every context note, so it must never leave the bar.
  // The controls simply render inert for the frame or two before the instance
  // exists — visually identical, and every binding below no-ops on null.
  const formatControls =
    canEdit && trayMode === 'wysiwyg' ? (
      <>
        <BlockTypeSelect editor={editor} />
        <Divider />
        <ToolbarButton label="Bold" onClick={() => editor?.chain().focus().toggleBold().run()} active={!!editor?.isActive('bold')}>
          <BoldIcon className="h-4 w-4" />
        </ToolbarButton>
        <ToolbarButton label="Italic" onClick={() => editor?.chain().focus().toggleItalic().run()} active={!!editor?.isActive('italic')}>
          <ItalicIcon className="h-4 w-4" />
        </ToolbarButton>
        <Divider />
        <ToolbarButton label="Bullet list" onClick={() => editor?.chain().focus().toggleBulletList().run()} active={!!editor?.isActive('bulletList')}>
          <ListIcon className="h-4 w-4" />
        </ToolbarButton>
        <ToolbarButton label="Numbered list" onClick={() => editor?.chain().focus().toggleOrderedList().run()} active={!!editor?.isActive('orderedList')}>
          <ListOrderedIcon className="h-4 w-4" />
        </ToolbarButton>
        <ToolbarButton label="Checklist" onClick={() => editor?.chain().focus().toggleTaskList().run()} active={!!editor?.isActive('taskList')}>
          <CircleCheckIcon className="h-4 w-4" />
        </ToolbarButton>
        <Divider />
        <ToolbarButton label="Quote" onClick={() => editor?.chain().focus().toggleBlockquote().run()} active={!!editor?.isActive('blockquote')}>
          <TextQuoteIcon size={16} />
        </ToolbarButton>
        <ToolbarButton label="Code" onClick={() => editor?.chain().focus().toggleCodeBlock().run()} active={!!editor?.isActive('codeBlock')}>
          <CodeIcon className="h-4 w-4" />
        </ToolbarButton>
        <ToolbarButton
          label="Table"
          onClick={() => editor?.chain().focus().insertTable({ rows: 3, cols: 3, withHeaderRow: true }).run()}
        >
          <TableIcon className="h-4 w-4" />
        </ToolbarButton>
      </>
    ) : null
  // Floating (workspace) layout wraps the controls in a hairline tray; the
  // embedded profile bar renders them flat, attached under the tabs.
  const formatPill = formatControls ? (
    <div className="pointer-events-auto flex items-center gap-1 rounded-lg border border-line-subtle bg-surface px-1.5 py-1">
      {formatControls}
    </div>
  ) : null

  // The note body + references, shared by both layouts as a stable JSX element
  // (a const, NOT a nested component, so the editor is never remounted).
  const bodyContent = (
    <div className={embedded ? '' : 'h-full overflow-y-auto'}>
      <div
        className={
          floating
            ? 'notes-column notes-column--floating'
            : embedded
              ? 'notes-column'
              : 'notes-column notes-column--boxed'
        }
      >
        {/* The note title — rendered as the page heading from frontmatter, so
            every note opens with a styled title and the body carries none.
            (Embedded/profile tab: the profile above IS the identity.) */}
        {mode === 'wysiwyg' && (!embedded || showTitle) && <h1 className="notes-title">{noteTitle}</h1>}
        {mode === 'wysiwyg' ? (
          <>
            <EditorContent editor={editor} />
            {/* An index note IS a folder, and its child list is maintained by the
                store — so it renders below the body as a read-only list rather
                than as editable text carrying its own marker comments. Empty
                folders (a just-created space) show nothing at all. */}
            {childSections.length > 0 && (
              <section className="notes-ref-group mt-8">
                <h3 className="notes-ref-head">In this folder</h3>
                {childSections.map((group) => (
                  <div key={group.section} className="notes-child-section">
                    {childSections.length > 1 && <h4 className="notes-child-head">{group.section}</h4>}
                    <ul className="notes-children">
                      {group.children.map((child) => (
                        <li key={child.path}>
                          <button type="button" className="notes-child" onClick={() => onOpenNote(child.path)}>
                            <span className="notes-child-title">{child.title}</span>
                            {child.description && <span className="notes-child-desc">{child.description}</span>}
                          </button>
                        </li>
                      ))}
                    </ul>
                  </div>
                ))}
              </section>
            )}
          </>
        ) : (
          <RawNoteText
            textareaRef={rawRef}
            value={rawContent}
            onChange={onRawChange}
            heldKeys={heldKeys}
            readOnly={!canEdit}
            className={embedded ? '' : 'h-full min-h-[55vh]'}
          />
        )}
      </div>

      {mode === 'wysiwyg' && (
        <LinkedReferences
          references={references}
          title={noteTitle}
          showUnlinked={showUnlinked}
          onOpenNote={onOpenNote}
          onLinkMention={canEdit ? onLinkMention : undefined}
          onRequestReferenceAccess={onRequestReferenceAccess}
        />
      )}
    </div>
  )

  return (
    <div className={embedded ? 'relative' : 'relative h-full'}>
      {/* Embedded: the format controls ride the profile tab bar's attached
          region, portalled into the host it exposes (TabBarSlotContext) — a
          centred tray hanging off the tab bar's border inside that sticky box,
          so it pins with the bar as one unit. In the workspace this is an
          absolute overlay instead (below).

          No motion of our own: the region opened off the tab change long before
          we mounted, and it already reserves our exact height, so the controls
          just appear — on the same commit as the note text, which is the point.
          A fade here would only re-invent the lag it was meant to hide.

          No host means no toolbar: `embedded` is only used by EntityContextPanel
          under the profile pages, which provide one. */}
      {embedded && toolbarHost && (formatControls || onModeChange || toolbarTrailSlot) && createPortal(
        /* One content-width card, centred by the host and floating clear of the
           nav line: a rounded rectangle on all four sides with its own border
           and shadow, separated from the tab row by the mt-4 gap the host's
           reserved height accounts for. Everything lives in it together instead
           of spread across a full-width row. max-w-full + the inner
           overflow-x-auto keep narrow panes scrolling inside the card rather
           than growing it. */
        <div className="relative mt-4 flex h-11 max-w-full items-center gap-1 rounded-xl border border-line-subtle bg-surface px-3 shadow-strip">
          <div className="flex min-w-0 items-center gap-1 overflow-x-auto">{formatControls}</div>
          {/* Trailing group: the Editor/Raw toggle + Share. The
              toggle renders regardless of canEdit/mode (unlike formatControls,
              null in raw) so raw mode can always switch back and read-only
              viewers can peek raw. */}
          {(onModeChange || toolbarTrailSlot) && formatControls && <Divider />}
          {(onModeChange || toolbarTrailSlot) && (
            <div className="flex shrink-0 items-center gap-2">
              {onModeChange && <NoteModeToggle value={mode} onChange={onModeChange} size="sm" />}
              {toolbarTrailSlot}
            </div>
          )}
        </div>,
        toolbarHost,
      )}
      {/* Scrolling content lives in its own z-0 layer so it is guaranteed to
          slide UNDER the tab bar + its attached toolbar (z-20) — it can never
          paint over them, so nothing "pops up" above the toolbar on scroll. */}
      {embedded ? (
        <div className="relative z-0 pt-4">
          {error && (
            <div className="mb-3 flex items-center justify-between border-l-2 border-danger-bright pl-3 py-1 text-sm text-danger-strong">
              <span>{error}</span>
              <button onClick={() => setError(null)} aria-label="Dismiss"
                      className="ml-2 text-danger-bright hover:text-danger">
                <XIcon className="h-3.5 w-3.5" />
              </button>
            </div>
          )}
          {/* Keyed by mode so each Edit ⇄ Raw swap drops the incoming surface
              down in step with the tab bar's attached region opening/closing
              above it. Never animates on the note's first mount (modeSwitched). */}
          <div key={mode} className={modeSwitched ? 'notes-mode-enter' : undefined}>
            {/* Raw mode shows the note's own frontmatter — title, type and tags are
                right there in the text, so the header card would just repeat them. */}
            {mode === 'wysiwyg' && (typeof headerSlot === 'function'
              ? headerSlot({ frontmatter: headerFrontmatter, replaceFrontmatter, editable: canEdit && !!editor })
              : headerSlot)}
            {bodyContent}
          </div>
        </div>
      ) : (
        bodyContent
      )}

      {/* Floating formatting toolbar (workspace only) — pinned just below the
          navbar, centred over the note. The wrapper ignores pointer events so the
          empty area lets clicks fall through to the text; only the pill itself is
          interactive. Embedded mode renders the same pill in the sticky row above. */}
      {!embedded && formatPill && (
        <div
          className={`pointer-events-none absolute inset-x-0 z-30 flex justify-center px-4 ${
            floating ? 'top-[88px]' : 'top-2'
          }`}
        >
          {formatPill}
        </div>
      )}

      {!embedded && error && (
        <div
          className={`pointer-events-none absolute inset-x-0 z-30 flex justify-center px-4 ${
            floating ? 'top-[140px]' : 'top-16'
          }`}
        >
          <div className="pointer-events-auto flex w-full max-w-[760px] items-center justify-between border-l-2 border-danger-bright pl-3 py-1 text-sm text-danger-strong">
            <span>{error}</span>
            <button onClick={() => setError(null)} aria-label="Dismiss"
                    className="ml-2 text-danger-bright hover:text-danger">
              <XIcon className="h-3.5 w-3.5" />
            </button>
          </div>
        </div>
      )}

      {linkPickerOpen && (
        <NotePicker
          notes={notes}
          entities={entities}
          anchor={linkAnchor}
          placeholder="Link to context…"
          onPick={insertLink}
          onPickEntity={async (entity) => {
            if (!onEnsureEntityNote) {
              setLinkPickerOpen(false)
              return
            }
            try {
              const entityPath = await onEnsureEntityNote(entity)
              insertLink(entityPath, entity.name)
            } catch {
              linkRangeRef.current = null
              setLinkPickerOpen(false)
            }
          }}
          onClose={() => {
            linkRangeRef.current = null
            setLinkAnchor(null)
            setLinkPickerOpen(false)
            editor?.commands.focus()
          }}
        />
      )}
    </div>
  )
}

function ToolbarButton({
  children,
  onClick,
  active,
  label,
}: {
  children: React.ReactNode
  onClick: () => void
  active?: boolean
  label: string
}) {
  return (
    <button
      type="button"
      title={label}
      aria-label={label}
      onMouseDown={(e) => e.preventDefault()}
      onClick={onClick}
      className={`flex h-7 w-7 items-center justify-center rounded-lg text-sm transition ${
        active ? 'bg-accent-soft text-accent-strong' : 'text-fg-secondary hover:bg-surface-subtle'
      }`}
    >
      {children}
    </button>
  )
}

// Text-style dropdown (Apple Notes-style options):
// Title/Heading/Subheading map to the three heading levels, Body to paragraph,
// Monospaced to a code block. Custom popover instead of a native <select> so it
// matches the app's theme. Reflects the cursor's active block via editor state
// (useEditor re-renders on each transaction, so isActive is current). The menu
// portals to <body> with fixed positioning — the embedded toolbar strip is an
// overflow-x-auto row, which would otherwise clip the popover into a scrollbar.
// Each option previews its own typography (Apple Notes-style), so the menu
// reads as what the text will become rather than a list of names.
const BLOCK_TYPES = [
  { value: 'title', label: 'Title', preview: 'text-[15px] font-bold' },
  { value: 'heading', label: 'Heading', preview: 'text-sm font-semibold' },
  { value: 'subheading', label: 'Subheading', preview: 'text-[13px] font-semibold' },
  { value: 'body', label: 'Body', preview: 'text-sm' },
  { value: 'mono', label: 'Monospaced', preview: 'font-mono text-[12.5px]' },
] as const

type BlockType = (typeof BLOCK_TYPES)[number]['value']

// Accepts a null editor so the control can render before Tiptap exists — see the
// note on formatControls. With no editor it shows the default label and no-ops.
function BlockTypeSelect({ editor }: { editor: Editor | null }) {
  const [open, setOpen] = useState(false)
  const [menuPos, setMenuPos] = useState<{ top: number; left: number } | null>(null)
  const ref = useRef<HTMLDivElement>(null)
  const menuRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    if (!open) return
    const onDown = (e: MouseEvent) => {
      const t = e.target as Node
      if (ref.current?.contains(t) || menuRef.current?.contains(t)) return
      setOpen(false)
    }
    // The menu is fixed-positioned off a snapshot of the trigger's rect, so any
    // scroll or resize would strand it — just close instead of tracking.
    const close = () => setOpen(false)
    document.addEventListener('mousedown', onDown)
    window.addEventListener('scroll', close, true)
    window.addEventListener('resize', close)
    return () => {
      document.removeEventListener('mousedown', onDown)
      window.removeEventListener('scroll', close, true)
      window.removeEventListener('resize', close)
    }
  }, [open])

  const current: BlockType = !editor
    ? 'body'
    : editor.isActive('heading', { level: 1 })
      ? 'title'
      : editor.isActive('heading', { level: 2 })
        ? 'heading'
        : editor.isActive('heading', { level: 3 })
          ? 'subheading'
          : editor.isActive('codeBlock')
            ? 'mono'
            : 'body'

  const apply = (value: BlockType) => {
    if (!editor) return
    const chain = editor.chain().focus()
    if (value === 'title') chain.setHeading({ level: 1 }).run()
    else if (value === 'heading') chain.setHeading({ level: 2 }).run()
    else if (value === 'subheading') chain.setHeading({ level: 3 }).run()
    else if (value === 'mono') chain.setCodeBlock().run()
    else chain.setParagraph().run()
    setOpen(false)
  }

  const currentLabel = BLOCK_TYPES.find((t) => t.value === current)?.label ?? 'Body'

  return (
    <div ref={ref} className="relative">
      {/* Fixed width so the toolbar doesn't shift as the label changes between
          block types ("Body" ⇄ "Monospaced") — it sits in a centred row now,
          where any width change would nudge every control sideways. */}
      <button
        type="button"
        aria-label="Text style"
        aria-expanded={open}
        onMouseDown={(e) => e.preventDefault()}
        onClick={(e) => {
          const r = e.currentTarget.getBoundingClientRect()
          setMenuPos({ top: r.bottom + 6, left: r.left })
          setOpen((v) => !v)
        }}
        className={`flex h-7 w-28 items-center justify-between rounded-lg px-2 text-sm transition ${
          open ? 'bg-surface-subtle text-fg' : 'text-fg-secondary hover:bg-surface-subtle'
        }`}
      >
        <span className="truncate">{currentLabel}</span>
        <ChevronsUpDownIcon className="h-3.5 w-3.5 shrink-0 text-fg-muted" />
      </button>
      {open && menuPos && createPortal(
        <div
          ref={menuRef}
          style={{ top: menuPos.top, left: menuPos.left }}
          className="dropdown-pop fixed z-50 w-44 rounded-xl border border-line-subtle bg-surface p-1.5 shadow-float"
        >
          {BLOCK_TYPES.map((t) => (
            <button
              key={t.value}
              type="button"
              onMouseDown={(e) => e.preventDefault()}
              onClick={() => apply(t.value)}
              className={`flex h-8 w-full items-center justify-between gap-3 rounded-lg px-2.5 text-left transition ${
                t.value === current
                  ? 'bg-surface-subtle text-fg'
                  : 'text-fg hover:bg-surface-subtle'
              }`}
            >
              <span className={`truncate ${t.preview}`}>{t.label}</span>
              {t.value === current && <CheckIcon className="h-4 w-4 shrink-0 text-accent-strong" />}
            </button>
          ))}
        </div>,
        document.body,
      )}
    </div>
  )
}

function Divider() {
  return <span className="mx-1 h-5 w-px bg-line-subtle" />
}
