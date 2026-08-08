'use client'

// The note editor: a Tiptap WYSIWYG surface (markdown round-tripped via
// tiptap-markdown) whose Edit/Raw mode is driven by the surface's Editor/Raw toggle.
// Markdown is the source of truth, so the frontmatter prefix is split off on load
// and re-attached on save, the body is what's edited, and `[[` opens a note picker
// that inserts an OKF [title](/path.md) link. Body, references, and the freshness
// line share one centred scroll column so the references read as a continuation of
// the note (matches blackbird-brain). Saves are debounced and bubbled up via onSave.

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
  ItalicIcon,
  ListBulletIcon,
  NumberedListIcon,
  CheckCircleIcon,
  CodeBracketIcon,
  TableCellsIcon,
  ChevronUpDownIcon as ChevronsUpDownIcon,
  CheckIcon,
} from '@heroicons/react/24/outline'
import { TextQuote as QuoteIcon, Sparkles as SparklesIcon, Star as StarIcon } from 'lucide-react'
import { Hashtag } from '../lib/hashtag'
import { EntityChip } from '../lib/entityChip'
import { NotePicker, type PickerEntity } from './NotePicker'
import { LinkedReferences } from './LinkedReferences'
import { NoteModeToggle, type NoteMode } from './NoteModeToggle'
import { parseEntityHref } from '@/lib/notes/entities'
import { splitFrontmatter, resolveOkfLink, parseFrontmatter } from '@/lib/notes/shared/markdown'
import { notesApi } from '../lib/notesApi'
import { useTabBarSlot } from '@/lib/contexts/TabBarSlotContext'
import { TAB_MOTION_MS } from '@/components/ui/tabMotion'
import type { NoteMeta, References, UnlinkedReference } from '@/lib/notes/shared/types'

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
  canEdit: boolean
  aiConfigured: boolean
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
  headerSlot?: React.ReactNode
  // Embedded only: rendered at the far right of the toolbar row, after the
  // Editor/Raw toggle (the entity panel's Share button). Renders in raw mode too.
  toolbarTrailSlot?: React.ReactNode
}

type MarkdownStorage = { markdown: { getMarkdown: () => string } }
function getMarkdown(ed: Editor): string {
  return (ed.storage as unknown as MarkdownStorage).markdown.getMarkdown()
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
// a community whose seed predates this — gets that leading heading stripped on load.
// Display-side only: the stored markdown migrates the next time the note is saved.
function stripLeadingTitleHeading(body: string, title: string): string {
  if (!title.trim()) return body
  const m = body.match(/^\s*#{1,6}[ \t]+(.+?)[ \t]*(?:\r?\n|$)/)
  if (m && m[1].trim().toLowerCase() === title.trim().toLowerCase()) {
    return body.slice(m[0].length).replace(/^\s*\r?\n/, '')
  }
  return body
}

// The title shown above the body: frontmatter title, else the filename slug.
function titleFromContent(content: string, path: string): string {
  const fm = String(parseFrontmatter(content).title ?? '').trim()
  return fm || path.replace(/\.md$/i, '').split('/').pop() || path
}

export function NoteEditor({
  path,
  meta,
  notes,
  initialContent,
  canEdit,
  aiConfigured,
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
  variant = 'floating',
  headerSlot,
  toolbarTrailSlot,
}: NoteEditorProps) {
  const embedded = variant === 'embedded'
  const floating = variant === 'floating'
  const [rawContent, setRawContent] = useState(initialContent)
  const [linkPickerOpen, setLinkPickerOpen] = useState(false)
  // Viewport rect of the caret when `[[` opened the picker, so it can dock just
  // below where the user is typing rather than as a centered modal.
  const [linkAnchor, setLinkAnchor] = useState<{ left: number; top: number; bottom: number } | null>(null)
  const [refactoring, setRefactoring] = useState(false)
  const [error, setError] = useState<string | null>(null)
  // Starred flag lives in the note's frontmatter (`starred: true`), so toggling
  // it rewrites the prefix and saves through the normal path.
  const [starred, setStarred] = useState(false)
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
  // the chips update as the community node map loads without recreating the editor.
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
      attributes: { class: 'blog-prose notes-editor focus:outline-none' },
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
        // Open if the note is in this brain's index, OR it's a directory entity
        // note — those resolve to the canonical shared note even when the current
        // brain doesn't have them (the workspace handles the cross-brain open).
        if (resolved && (notesSetRef.current.has(resolved) || parseEntityHref(resolved))) {
          onOpenNote(resolved)
          return true
        }
        return false
      },
    },
    onUpdate: ({ editor: ed }) => {
      if (!canEdit || loadingRef.current) return
      queueSave(prefixRef.current + getMarkdown(ed))
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
    const loadedBody = stripLeadingTitleHeading(body, titleFromContent(initialContent, path))
    editor.commands.setContent(loadedBody, { emitUpdate: false })
    setRawContent(initialContent)
    setStarred(Boolean(parseFrontmatter(initialContent).starred))
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
  }, [path, initialContent, editor, flush])

  // Round-trip the body when the workspace flips Edit ⇄ Raw. Going to Raw snapshots
  // the live editor markdown; coming back parses the (possibly hand-edited) raw text
  // back into the editor. Guarded so a no-op re-render (e.g. typing in raw) is ignored.
  const prevModeRef = useRef(mode)
  useEffect(() => {
    if (!editor || mode === prevModeRef.current) return
    if (mode === 'raw') {
      setRawContent(prefixRef.current + getMarkdown(editor))
    } else {
      loadingRef.current = true
      const { frontmatter, body } = splitFrontmatter(rawContent)
      prefixRef.current = buildPrefix(frontmatter)
      setStarred(Boolean(parseFrontmatter(rawContent).starred))
      editor.commands.setContent(body, { emitUpdate: false })
      if (canEdit) queueSave(rawContent)
      setTimeout(() => {
        loadingRef.current = false
      }, 0)
    }
    prevModeRef.current = mode
  }, [mode, editor, rawContent, canEdit, queueSave])

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

  // Repaint entity chips when the community node map arrives/changes (the editor
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
        if (mode === 'wysiwyg') pendingRef.current = prefixRef.current + getMarkdown(editor)
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

  // Toggle `starred:` in the frontmatter prefix and save immediately. Only
  // reachable from the wysiwyg toolbar, so the prefix ref is authoritative.
  const toggleStar = useCallback(() => {
    if (!editor || !canEdit) return
    const next = !starred
    const { frontmatter } = splitFrontmatter(prefixRef.current)
    const lines = (frontmatter ?? '')
      .split('\n')
      .filter((l) => l.trim() && !/^starred\s*:/i.test(l.trim()))
    if (next) lines.push('starred: true')
    prefixRef.current = lines.length ? buildPrefix(lines.join('\n')) : ''
    setStarred(next)
    pendingRef.current = prefixRef.current + getMarkdown(editor)
    flush()
  }, [editor, canEdit, starred, flush])

  const onRawChange = (value: string) => {
    setRawContent(value)
    if (canEdit) queueSave(value)
  }

  const refactor = useCallback(async () => {
    if (!editor || refactoring) return
    setError(null)
    setRefactoring(true)
    try {
      const result = await notesApi.refactor('note', getMarkdown(editor))
      editor.commands.setContent(result)
      pendingRef.current = prefixRef.current + result
      originRef.current = 'ai-refactor'
      flush()
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err))
    } finally {
      setRefactoring(false)
    }
  }, [editor, refactoring, flush])

  // The title shown above the body: index meta, else the note's own frontmatter
  // (parsed from content — so notes outside this brain's index still title).
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
          <ListBulletIcon className="h-4 w-4" />
        </ToolbarButton>
        <ToolbarButton label="Numbered list" onClick={() => editor?.chain().focus().toggleOrderedList().run()} active={!!editor?.isActive('orderedList')}>
          <NumberedListIcon className="h-4 w-4" />
        </ToolbarButton>
        <ToolbarButton label="Checklist" onClick={() => editor?.chain().focus().toggleTaskList().run()} active={!!editor?.isActive('taskList')}>
          <CheckCircleIcon className="h-4 w-4" />
        </ToolbarButton>
        <Divider />
        <ToolbarButton label="Quote" onClick={() => editor?.chain().focus().toggleBlockquote().run()} active={!!editor?.isActive('blockquote')}>
          <QuoteIcon size={16} />
        </ToolbarButton>
        <ToolbarButton label="Code" onClick={() => editor?.chain().focus().toggleCodeBlock().run()} active={!!editor?.isActive('codeBlock')}>
          <CodeBracketIcon className="h-4 w-4" />
        </ToolbarButton>
        <ToolbarButton
          label="Table"
          onClick={() => editor?.chain().focus().insertTable({ rows: 3, cols: 3, withHeaderRow: true }).run()}
        >
          <TableCellsIcon className="h-4 w-4" />
        </ToolbarButton>
      </>
    ) : null
  // Star sits at the far left of the toolbar; Refactor is a filled button pushed
  // to the far right (both matching the reference layout). Same rule as
  // formatControls: no `editor` in the presence test. toggleStar already no-ops
  // without one.
  const starButton =
    canEdit && trayMode === 'wysiwyg' ? (
      <ToolbarButton label={starred ? 'Unstar note' : 'Star note'} onClick={toggleStar}>
        <StarIcon className={`h-4 w-4 ${starred ? 'fill-amber-400 text-amber-400' : ''}`} />
      </ToolbarButton>
    ) : null
  const refactorButton =
    canEdit && trayMode === 'wysiwyg' && aiConfigured ? (
      <button
        type="button"
        onClick={refactor}
        disabled={refactoring || !editor}
        className="flex shrink-0 items-center gap-1.5 rounded-lg bg-brand-dark-green px-2.5 py-1.5 text-xs font-semibold text-white transition hover:opacity-90 disabled:opacity-50"
      >
        <SparklesIcon className="h-3.5 w-3.5" />
        {refactoring ? 'Refactoring…' : 'Refactor'}
      </button>
    ) : null
  // Floating (workspace) layout wraps the controls in a rounded pill; the
  // embedded profile bar renders them flat, attached under the tabs.
  const formatPill = formatControls ? (
    <div className="pointer-events-auto flex items-center gap-1 rounded-xl border border-border-subtle bg-surface-1 px-1.5 py-1 shadow-sm">
      {starButton}
      {starButton && <Divider />}
      {formatControls}
      {refactorButton && (
        <>
          <Divider />
          {refactorButton}
        </>
      )}
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
        {mode === 'wysiwyg' && !embedded && <h1 className="notes-title">{noteTitle}</h1>}
        {mode === 'wysiwyg' ? (
          <EditorContent editor={editor} />
        ) : (
          <textarea
            ref={rawRef}
            value={rawContent}
            onChange={(e) => onRawChange(e.target.value)}
            readOnly={!canEdit}
            spellCheck={false}
            className={`w-full resize-none overflow-hidden bg-transparent font-mono text-sm leading-relaxed text-text-primary focus:outline-none ${
              embedded ? '' : 'h-full min-h-[55vh]'
            }`}
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
      {embedded && toolbarHost && (starButton || formatControls || refactorButton || onModeChange || toolbarTrailSlot) && createPortal(
        /* One content-width card, centred by the host and floating clear of the
           nav line: a rounded rectangle on all four sides with its own border
           and shadow, separated from the tab row by the mt-4 gap the host's
           reserved height accounts for. Everything lives in it together instead
           of spread across a full-width row. max-w-full + the inner
           overflow-x-auto keep narrow panes scrolling inside the card rather
           than growing it. */
        <div className="relative mt-4 flex h-11 max-w-full items-center gap-1 rounded-xl border border-border-subtle bg-surface-1 px-3 shadow-md">
          {starButton}
          {starButton && formatControls && <Divider />}
          <div className="flex min-w-0 items-center gap-1 overflow-x-auto">{formatControls}</div>
          {/* Trailing group: Refactor + the Editor/Raw toggle + Share. The
              toggle renders regardless of canEdit/mode (unlike formatControls,
              null in raw) so raw mode can always switch back and read-only
              viewers can peek raw. */}
          {(refactorButton || onModeChange || toolbarTrailSlot) && formatControls && <Divider />}
          {(refactorButton || onModeChange || toolbarTrailSlot) && (
            <div className="flex shrink-0 items-center gap-2">
              {refactorButton}
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
            <div className="mb-3 flex items-center justify-between rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700">
              <span>{error}</span>
              <button onClick={() => setError(null)} className="ml-2 text-red-400 hover:text-red-600">✕</button>
            </div>
          )}
          {/* Keyed by mode so each Edit ⇄ Raw swap drops the incoming surface
              down in step with the tab bar's attached region opening/closing
              above it. Never animates on the note's first mount (modeSwitched). */}
          <div key={mode} className={modeSwitched ? 'notes-mode-enter' : undefined}>
            {/* Raw mode shows the note's own frontmatter — title, type and tags are
                right there in the text, so the header card would just repeat them. */}
            {mode === 'wysiwyg' && headerSlot}
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
          <div className="pointer-events-auto flex w-full max-w-[760px] items-center justify-between rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700">
            <span>{error}</span>
            <button onClick={() => setError(null)} className="ml-2 text-red-400 hover:text-red-600">
              ✕
            </button>
          </div>
        </div>
      )}

      {linkPickerOpen && (
        <NotePicker
          notes={notes}
          entities={entities}
          anchor={linkAnchor}
          placeholder="Link to a note, person, or company…"
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
        active ? 'bg-brand-light-bg text-brand-dark-green' : 'text-text-secondary hover:bg-surface-2'
      }`}
    >
      {children}
    </button>
  )
}

// Text-style dropdown (matches blackbird-brain's Apple Notes-style options):
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
          open ? 'bg-surface-2 text-text-primary' : 'text-text-secondary hover:bg-surface-2'
        }`}
      >
        <span className="truncate">{currentLabel}</span>
        <ChevronsUpDownIcon className="h-3.5 w-3.5 shrink-0 text-text-muted" />
      </button>
      {open && menuPos && createPortal(
        <div
          ref={menuRef}
          style={{ top: menuPos.top, left: menuPos.left }}
          className="dropdown-pop fixed z-50 w-44 rounded-xl border border-border-subtle bg-surface-1 p-1.5 shadow-lg"
        >
          {BLOCK_TYPES.map((t) => (
            <button
              key={t.value}
              type="button"
              onMouseDown={(e) => e.preventDefault()}
              onClick={() => apply(t.value)}
              className={`flex h-8 w-full items-center justify-between gap-3 rounded-lg px-2.5 text-left transition ${
                t.value === current
                  ? 'bg-surface-2 text-text-primary'
                  : 'text-text-primary hover:bg-surface-2'
              }`}
            >
              <span className={`truncate ${t.preview}`}>{t.label}</span>
              {t.value === current && <CheckIcon className="h-4 w-4 shrink-0 text-brand-dark-green" />}
            </button>
          ))}
        </div>,
        document.body,
      )}
    </div>
  )
}

function Divider() {
  return <span className="mx-1 h-5 w-px bg-border-subtle" />
}
