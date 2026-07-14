'use client'

// The note editor: a Tiptap WYSIWYG surface (markdown round-tripped via
// tiptap-markdown) whose Edit/Raw mode is driven by the surface's Editor/Raw toggle.
// Markdown is the source of truth, so the frontmatter prefix is split off on load
// and re-attached on save, the body is what's edited, and `[[` opens a note picker
// that inserts an OKF [title](/path.md) link. Body, references, and the freshness
// line share one centred scroll column so the references read as a continuation of
// the note (matches blackbird-brain). Saves are debounced and bubbled up via onSave.

import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { useEditor, EditorContent, type Editor } from '@tiptap/react'
import StarterKit from '@tiptap/starter-kit'
import TaskList from '@tiptap/extension-task-list'
import TaskItem from '@tiptap/extension-task-item'
import { Table, TableRow, TableHeader, TableCell } from '@tiptap/extension-table'
import { Markdown } from 'tiptap-markdown'
import {
  Bold as BoldIcon,
  Italic as ItalicIcon,
  List as ListIcon,
  ListOrdered as ListOrderedIcon,
  ListChecks as ListChecksIcon,
  Quote as QuoteIcon,
  Code2 as CodeIcon,
  Table as TableIcon,
  Sparkles as SparklesIcon,
  MoreHorizontal as MoreIcon,
  History as HistoryIcon,
  Download as DownloadIcon,
  Trash2 as TrashIcon,
} from 'lucide-react'
import { Hashtag } from '../lib/hashtag'
import { EntityChip } from '../lib/entityChip'
import { NotePicker, type PickerEntity } from './NotePicker'
import { LinkedReferences } from './LinkedReferences'
import { parseEntityHref } from '@/lib/notes/entities'
import { splitFrontmatter, resolveOkfLink, parseFrontmatter } from '@/lib/notes/shared/markdown'
import { formatRelativeTime } from '@/lib/notes/shared/time'
import { notesApi } from '../lib/notesApi'
import type { NoteMeta, References, RelatedNote } from '@/lib/notes/shared/types'

const AUTOSAVE_MS = 350

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
  // Edit/Raw mode, owned by the surface's Editor/Raw toggle (NoteModeToggle).
  mode: 'wysiwyg' | 'raw'
  references: References | null
  related: RelatedNote[] | null
  // Directory entities for `[[ ]]` mentions: the picker list + a path→entity map
  // the chip decoration reads, and a hook that ensures the entity's note exists.
  entities?: PickerEntity[]
  entityByPath?: Map<string, PickerEntity>
  onEnsureEntityNote?: (entity: PickerEntity) => Promise<string>
  onSave: (path: string, content: string, origin?: string) => void
  onOpenNote: (path: string) => void
  onOpenTag?: (tag: string) => void
  // Note-level actions surfaced in the toolbar (omit to hide).
  onShowHistory?: () => void
  exportHref?: string
  onDelete?: () => void
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
  // Embedded only: extra controls pinned to the right of the attached toolbar
  // bar (e.g. an "Add to my notes" button).
  toolbarExtras?: React.ReactNode
}

type MarkdownStorage = { markdown: { getMarkdown: () => string } }
function getMarkdown(ed: Editor): string {
  return (ed.storage as unknown as MarkdownStorage).markdown.getMarkdown()
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
  references,
  related,
  entities,
  entityByPath,
  onEnsureEntityNote,
  onSave,
  onOpenNote,
  onOpenTag,
  onShowHistory,
  exportHref,
  onDelete,
  variant = 'floating',
  headerSlot,
  toolbarExtras,
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

  const prefixRef = useRef('')
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
      editor.commands.setContent(body, { emitUpdate: false })
      if (canEdit) queueSave(rawContent)
      setTimeout(() => {
        loadingRef.current = false
      }, 0)
    }
    prevModeRef.current = mode
  }, [mode, editor, rawContent, canEdit, queueSave])

  // Flush any pending edit on unmount.
  useEffect(() => flush, [flush])

  useEffect(() => {
    editor?.setEditable(canEdit)
  }, [editor, canEdit])

  // Flag links to missing notes (broken) and tag internal note links so they
  // render wrapped in [[ ]] via CSS. Re-runs on every edit.
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
  }, [editor, meta])

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

  // The formatting pill and the ⋯ actions menu are shared between two layouts:
  // floating overlays in the full workspace, a sticky in-flow row when embedded
  // (the profile Context tab scrolls with the page, so overlays can't anchor).
  const formatControls =
    canEdit && mode === 'wysiwyg' && editor ? (
      <>
        <BlockTypeSelect editor={editor} />
        <Divider />
        <ToolbarButton label="Bold" onClick={() => editor.chain().focus().toggleBold().run()} active={editor.isActive('bold')}>
          <BoldIcon className="h-4 w-4" />
        </ToolbarButton>
        <ToolbarButton label="Italic" onClick={() => editor.chain().focus().toggleItalic().run()} active={editor.isActive('italic')}>
          <ItalicIcon className="h-4 w-4" />
        </ToolbarButton>
        <Divider />
        <ToolbarButton label="Bullet list" onClick={() => editor.chain().focus().toggleBulletList().run()} active={editor.isActive('bulletList')}>
          <ListIcon className="h-4 w-4" />
        </ToolbarButton>
        <ToolbarButton label="Numbered list" onClick={() => editor.chain().focus().toggleOrderedList().run()} active={editor.isActive('orderedList')}>
          <ListOrderedIcon className="h-4 w-4" />
        </ToolbarButton>
        <ToolbarButton label="Checklist" onClick={() => editor.chain().focus().toggleTaskList().run()} active={editor.isActive('taskList')}>
          <ListChecksIcon className="h-4 w-4" />
        </ToolbarButton>
        <Divider />
        <ToolbarButton label="Quote" onClick={() => editor.chain().focus().toggleBlockquote().run()} active={editor.isActive('blockquote')}>
          <QuoteIcon className="h-4 w-4" />
        </ToolbarButton>
        <ToolbarButton label="Code" onClick={() => editor.chain().focus().toggleCodeBlock().run()} active={editor.isActive('codeBlock')}>
          <CodeIcon className="h-4 w-4" />
        </ToolbarButton>
        <ToolbarButton
          label="Table"
          onClick={() => editor.chain().focus().insertTable({ rows: 3, cols: 3, withHeaderRow: true }).run()}
        >
          <TableIcon className="h-4 w-4" />
        </ToolbarButton>
        {aiConfigured && (
          <>
            <Divider />
            <button
              type="button"
              onClick={refactor}
              disabled={refactoring}
              className="flex items-center gap-1 rounded-lg px-2 py-1 text-xs font-semibold text-brand-dark-green transition hover:bg-brand-light-bg disabled:opacity-50"
            >
              <SparklesIcon className="h-3.5 w-3.5" />
              {refactoring ? 'Refactoring…' : 'Refactor'}
            </button>
          </>
        )}
      </>
    ) : null
  // Floating (workspace) layout wraps the controls in a rounded pill; the
  // embedded profile bar renders them flat, attached under the tabs.
  const formatPill = formatControls ? (
    <div className="pointer-events-auto flex items-center gap-1 rounded-xl border border-border-subtle bg-surface-1 px-1.5 py-1 shadow-sm">
      {formatControls}
    </div>
  ) : null

  const actionsMenu =
    onShowHistory || exportHref || onDelete ? (
      <NoteActionsMenu onShowHistory={onShowHistory} exportHref={exportHref} onDelete={onDelete} />
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
            value={rawContent}
            onChange={(e) => onRawChange(e.target.value)}
            readOnly={!canEdit}
            spellCheck={false}
            className="h-full min-h-[55vh] w-full resize-none bg-transparent font-mono text-sm leading-relaxed text-text-primary focus:outline-none"
          />
        )}
      </div>

      {mode === 'wysiwyg' && (
        <>
          <LinkedReferences references={references} related={related} title={noteTitle} onOpenNote={onOpenNote} />
          {meta && (
            <div className="notes-meta" title={new Date(meta.mtime).toLocaleString()}>
              {meta.frontmatter.author ? `By ${String(meta.frontmatter.author)} · ` : ''}
              Edited {formatRelativeTime(meta.mtime, Date.now())}
            </div>
          )}
        </>
      )}
    </div>
  )

  return (
    <div className={embedded ? 'relative' : 'relative h-full'}>
      {/* Embedded: a flat full-width toolbar bar attached under the profile tab
          bar (sticky -top-4, h-12). It carries the format controls (left) plus
          any extras + the ⋯ actions (right); the note scrolls up behind it. In
          the workspace these are absolute overlays instead (below). top-8, not
          top-12: sticky offsets resolve below the <main> scroll container's
          pt-4, so 32px + that 16px padding lands flush under the 48px tab bar. */}
      {embedded && (formatControls || actionsMenu || toolbarExtras) && (
        <div className="sticky top-8 z-30 border-b border-border-subtle bg-surface-1">
          <div className="mx-auto flex max-w-3xl items-center gap-1 px-1 py-1.5">
            <div className="flex flex-1 items-center gap-1 overflow-x-auto">{formatControls}</div>
            {(toolbarExtras || actionsMenu) && (
              <div className="flex flex-none items-center gap-2 pl-2">
                {toolbarExtras}
                {actionsMenu}
              </div>
            )}
          </div>
        </div>
      )}
      {/* Scrolling content lives in its own z-0 layer so it is guaranteed to
          slide UNDER the sticky toolbar (z-30) and tab bar (z-20) — it can never
          paint over them, so nothing "pops up" above the toolbar on scroll. */}
      {embedded ? (
        <div className="relative z-0 pt-4">
          {headerSlot}
          {error && (
            <div className="mb-3 flex items-center justify-between rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700">
              <span>{error}</span>
              <button onClick={() => setError(null)} className="ml-2 text-red-400 hover:text-red-600">✕</button>
            </div>
          )}
          {bodyContent}
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

      {/* Floating note actions (workspace only) — a ⋯ "more" menu (History /
          Download / Delete) pinned top-right, above the note. */}
      {!embedded && actionsMenu && (
        <div className={`absolute right-4 z-40 ${floating ? 'top-[88px]' : 'top-2'}`}>{actionsMenu}</div>
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

// Block-type dropdown: switches the current block between paragraph and the
// three heading levels. Reflects the cursor's active block via editor state
// (useEditor re-renders on each transaction, so isActive is current).
const BLOCK_TYPES = [
  { value: 'paragraph', label: 'Paragraph' },
  { value: 'h1', label: 'Heading 1' },
  { value: 'h2', label: 'Heading 2' },
  { value: 'h3', label: 'Heading 3' },
] as const

function BlockTypeSelect({ editor }: { editor: Editor }) {
  const current = editor.isActive('heading', { level: 1 })
    ? 'h1'
    : editor.isActive('heading', { level: 2 })
      ? 'h2'
      : editor.isActive('heading', { level: 3 })
        ? 'h3'
        : 'paragraph'

  const apply = (value: string) => {
    const chain = editor.chain().focus()
    if (value === 'paragraph') chain.setParagraph().run()
    else chain.setHeading({ level: Number(value.slice(1)) as 1 | 2 | 3 }).run()
  }

  return (
    <select
      aria-label="Text style"
      value={current}
      onChange={(e) => apply(e.target.value)}
      onMouseDown={(e) => e.stopPropagation()}
      className="h-7 cursor-pointer rounded-lg bg-transparent px-2 text-sm text-text-secondary transition hover:bg-surface-2 focus:outline-none"
    >
      {BLOCK_TYPES.map((t) => (
        <option key={t.value} value={t.value}>
          {t.label}
        </option>
      ))}
    </select>
  )
}

function Divider() {
  return <span className="mx-1 h-5 w-px bg-border-subtle" />
}

// The note-level actions (History / Download / Delete), collapsed behind a ⋯
// button so the floating toolbar stays a single small target. Closes on outside
// click or Escape.
function NoteActionsMenu({
  onShowHistory,
  exportHref,
  onDelete,
}: {
  onShowHistory?: () => void
  exportHref?: string
  onDelete?: () => void
}) {
  const [open, setOpen] = useState(false)
  const ref = useRef<HTMLDivElement>(null)

  useEffect(() => {
    if (!open) return
    const onDoc = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false)
    }
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setOpen(false)
    }
    document.addEventListener('mousedown', onDoc)
    document.addEventListener('keydown', onKey)
    return () => {
      document.removeEventListener('mousedown', onDoc)
      document.removeEventListener('keydown', onKey)
    }
  }, [open])

  return (
    <div ref={ref} className="relative">
      <button
        type="button"
        aria-label="More actions"
        aria-haspopup="menu"
        aria-expanded={open}
        title="More"
        onClick={() => setOpen((o) => !o)}
        className={`flex h-9 w-9 items-center justify-center rounded-xl border border-border-subtle bg-surface-1 shadow-sm transition hover:bg-surface-2 ${
          open ? 'text-text-primary' : 'text-text-secondary hover:text-text-primary'
        }`}
      >
        <MoreIcon className="h-4 w-4" />
      </button>
      {open && (
        <div className="absolute right-0 top-full z-50 mt-1.5 w-44 overflow-hidden rounded-xl border border-border-subtle bg-surface-1 py-1 shadow-float">
          {onShowHistory && (
            <button
              type="button"
              onClick={() => {
                setOpen(false)
                onShowHistory()
              }}
              className="flex w-full items-center gap-2.5 px-3 py-2 text-sm text-text-secondary transition hover:bg-surface-2 hover:text-text-primary"
            >
              <HistoryIcon className="h-4 w-4" /> History
            </button>
          )}
          {exportHref && (
            <a
              href={exportHref}
              onClick={() => setOpen(false)}
              className="flex items-center gap-2.5 px-3 py-2 text-sm text-text-secondary transition hover:bg-surface-2 hover:text-text-primary"
            >
              <DownloadIcon className="h-4 w-4" /> Download
            </a>
          )}
          {onDelete && (
            <button
              type="button"
              onClick={() => {
                setOpen(false)
                onDelete()
              }}
              className="flex w-full items-center gap-2.5 px-3 py-2 text-sm text-red-500 transition hover:bg-red-50"
            >
              <TrashIcon className="h-4 w-4" /> Delete
            </button>
          )}
        </div>
      )}
    </div>
  )
}
