'use client'

// The note-first create surface: an empty context note you fill in. Type a
// title, pick a Type, and the draft commits — a plain Note becomes a note, a
// Person/Group/Resource becomes a real directory node AND its canonical context
// note, and the page replaces itself with that entity's Context tab (where a
// Profile tab has appeared in the bar).
//
// Nothing is written until BOTH a type and a usable title exist. That's the
// whole design: no orphaned "Untitled" rows, and the type stays freely
// changeable right up to commit because there is nothing yet to migrate.
//
// This panel is deliberately much thinner than EntityContextPanel /
// NoteContextPanel — no per-path access check, no references, no publications,
// no save. There is no path yet, so there is nothing to gate or link, and
// `onSave` MUST stay a local buffer setter: a network write here would create
// the very orphan the flow exists to avoid.

import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { useRouter } from 'next/navigation'
import { ArrowRight, Check, ChevronDown, X } from 'lucide-react'
import { useCommunity } from '@/lib/contexts/CommunityContext'
import { aliasesForType, findAlias, type CommunityAlias, type NodeTypeConfig } from '@/lib/types'
import { getTypeColor } from '@/components/dashboard/typeStyles'
import { hexToPalette } from '@/lib/profileTheme'
import { noteFileSlug, availableNotePath, newNoteContent } from '@/lib/notes/shared/newContext'
import { noteHref } from '@/lib/notes/entities'
import { useBrainTree, FolderPicker, PathPreview } from '@/components/create/ContextDestination'
import { useNodeSearch, type NodeSearchResult } from '@/hooks/useNodeSearch'
import MatchPanel from '@/components/create/MatchPanel'
import { tagKey, tagPalette } from '@/lib/tagColors'
import { primeNodeProfile } from '@/hooks/useNodeProfile'
import { clearContextCache } from '@/hooks/useCommunityContextData'
import type { NBNode } from '@/lib/types'
import { notesApi } from '../lib/notesApi'
import { contextKeys, invalidateContextCache, primeContextCache } from '../lib/contextPrefetch'
import { useDirectoryEntities } from '../lib/useDirectoryEntities'
import { NoteEditor } from './NoteEditor'
import { PropertyRows } from './PropertyRows'
import { TagCombobox } from './TagCombobox'
import { type NoteMode } from './NoteModeToggle'
import '../notes.css'

/** The draft's type choices. `note` is always available — pressing "+" must
 *  always produce something, even where the directory types are gated. */
export type DraftType = 'note' | 'person' | 'group' | 'resource'

interface DraftTypeOption {
  id: DraftType
  label: string
  /** The `nodeTypes` name this maps to, for colour resolution. */
  configName: string
  hint: string
}

const DRAFT_TYPES: DraftTypeOption[] = [
  { id: 'note', label: 'Note', configName: 'Note', hint: 'A plain context note in a folder' },
  { id: 'person', label: 'Person', configName: 'Person', hint: 'Someone in the directory' },
  { id: 'group', label: 'Group', configName: 'Group', hint: 'A company or organisation' },
  { id: 'resource', label: 'Resource', configName: 'Resource', hint: 'A document, link or tool' },
]

/** Types that commit to a real directory node (and so get a dedupe check). */
const ENTITY_TYPES = new Set<DraftType>(['person', 'group', 'resource'])

const NOTE_COLOR = '#64748b'

interface DraftContextPanelProps {
  mode?: NoteMode
  /** Folder to pre-select when "+" was pressed from inside the context tree. */
  initialFolder?: string
  /** Type to pre-select — the route suggestion for the page you came from. */
  initialType?: DraftType | null
}

// The buffer survives an accidental back-navigation. Nothing is persisted by
// design, so without this a stray swipe loses everything typed — and the user
// has no reason to expect a "draft" to be that fragile.
const STASH_KEY = 'visvine:draft-context'

interface Stash {
  title: string
  type: DraftType | null
  alias: string | null
  body: string
  folder: string
  fields: Record<string, string>
  tags: string[]
}

function readStash(): Partial<Stash> {
  if (typeof sessionStorage === 'undefined') return {}
  try {
    return JSON.parse(sessionStorage.getItem(STASH_KEY) ?? '{}') as Partial<Stash>
  } catch {
    return {}
  }
}

export function DraftContextPanel({ mode = 'wysiwyg', initialFolder = '', initialType = null }: DraftContextPanelProps) {
  const router = useRouter()
  const { currentCommunity } = useCommunity()
  const communityId = currentCommunity?.id ?? null
  const { entities, entityByPath, allTags } = useDirectoryEntities()

  const stash = useRef<Partial<Stash>>(readStash()).current

  const [title, setTitle] = useState(stash.title ?? '')
  const [type, setType] = useState<DraftType | null>(stash.type ?? initialType)
  const [alias, setAlias] = useState<string | null>(stash.alias ?? null)
  const [folder, setFolder] = useState(stash.folder ?? initialFolder)
  const [fields, setFields] = useState<Record<string, string>>(stash.fields ?? {})
  const [tags, setTags] = useState<string[]>(stash.tags ?? [])
  const [addingTag, setAddingTag] = useState(false)
  const [tagColorOverride, setTagColorOverride] = useState<Record<string, string>>({})
  const [typeMenuOpen, setTypeMenuOpen] = useState(false)
  const [committing, setCommitting] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [conflict, setConflict] = useState<{ message: string; nodeId: string | null; path: string } | null>(null)
  const [selectedIdentityId, setSelectedIdentityId] = useState<string | null>(null)
  const [dismissedMatches, setDismissedMatches] = useState(false)

  // The editor body lives in a ref, not state: it changes on every keystroke and
  // nothing above it renders from it, so state here would re-render the whole
  // surface (the editor included) on every character.
  const bodyRef = useRef(stash.body ?? '')
  // Guards against a double commit — blur and Enter can both fire for one action.
  const committedRef = useRef(false)
  const titleRef = useRef<HTMLInputElement>(null)

  const brainTree = useBrainTree(communityId, type === 'note')

  // Cross-community duplicate check — the highest-value carry-over from the old
  // modal. Dropping it re-opens duplicate people and orgs across communities.
  const searchType = type && ENTITY_TYPES.has(type) ? type : ''
  const { results: matches, loading: matchesLoading } = useNodeSearch(
    searchType ? title : '',
    searchType === 'group' ? 'organization' : searchType,
    fields.email ?? '',
  )

  useEffect(() => {
    titleRef.current?.focus()
  }, [])

  // Stash on every change so a back-navigation is recoverable. Cleared on a
  // successful commit (the real note/entity is the record from then on).
  useEffect(() => {
    if (typeof sessionStorage === 'undefined') return
    const payload: Stash = { title, type, alias, body: bodyRef.current, folder, fields, tags }
    sessionStorage.setItem(STASH_KEY, JSON.stringify(payload))
  }, [title, type, alias, folder, fields, tags])

  const slug = noteFileSlug(title)
  // A punctuation-only title is a non-empty string that slugs to nothing — it
  // would produce the id `person:`. The SLUG is the readiness test, not the text.
  const titleUsable = slug !== 'untitled' || title.trim().toLowerCase() === 'untitled'
  const ready = titleUsable && type !== null

  const typeOption = type ? DRAFT_TYPES.find((t) => t.id === type) ?? null : null
  const aliasColor = alias ? findAlias(currentCommunity?.communityAliases, alias, typeOption?.configName ?? '')?.color : null
  const baseColor =
    type === 'note' || !typeOption
      ? NOTE_COLOR
      : getTypeColor(typeOption.configName, currentCommunity?.nodeTypes as NodeTypeConfig[] | undefined)
  const theme = hexToPalette(aliasColor ?? baseColor)

  const notePath = useMemo(
    () => (type === 'note' && titleUsable ? availableNotePath(folder, title, brainTree.notePaths) : ''),
    [type, titleUsable, folder, title, brainTree.notePaths],
  )

  const addTag = useCallback((raw: string) => {
    const tag = raw.trim()
    if (!tag) return
    setTags((prev) => (prev.some((t) => t.toLowerCase() === tag.toLowerCase()) ? prev : [...prev, tag]))
    setAddingTag(false)
  }, [])

  // A brand-new tag with a chosen colour. The colour registers on the community
  // immediately (it is community-level config, not draft state) — best effort,
  // the tag still lands on the draft if that write fails.
  const createTag = useCallback((raw: string, color: string) => {
    const tag = raw.trim()
    if (!tag || !communityId) return
    setTagColorOverride((m) => ({ ...m, [tagKey(tag)]: color }))
    void fetch(`/api/communities/${encodeURIComponent(communityId)}/tag-colors`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ tag, color }),
    }).catch(() => {})
    addTag(tag)
  }, [communityId, addTag])

  const removeTag = useCallback((tag: string) => {
    setTags((prev) => prev.filter((t) => t !== tag))
  }, [])

  const handlePickMatch = useCallback((result: NodeSearchResult) => {
    setTitle(result.name)
    const meta = result.metadata ?? {}
    setFields((prev) => ({
      ...prev,
      subtitle: result.subtitle ?? prev.subtitle ?? '',
      location: result.location ?? prev.location ?? '',
      email: typeof meta.email === 'string' ? meta.email : (prev.email ?? ''),
      companyName: typeof meta.companyName === 'string' ? meta.companyName : (prev.companyName ?? ''),
      linkedinUrl: typeof meta.linkedinUrl === 'string' ? meta.linkedinUrl : (prev.linkedinUrl ?? ''),
      image_url: result.image_url ?? prev.image_url ?? '',
    }))
    setSelectedIdentityId(result.identity_id)
    setDismissedMatches(true)
  }, [])

  // ── Commit ────────────────────────────────────────────────────────────────

  const commitNote = useCallback(async () => {
    if (!communityId) return
    const path = availableNotePath(folder, title, brainTree.notePaths)
    const content = newNoteContent({ title: title.trim(), tags, body: bodyRef.current })
    await notesApi.create(communityId, path, content)
    invalidateContextCache(contextKeys.tree(communityId), contextKeys.list(communityId))
    // The note we just wrote IS the freshest read — priming it means the note
    // page paints its content on first render instead of flashing a skeleton.
    primeContextCache(contextKeys.read(communityId, path), { status: 'ok', content })
    sessionStorage.removeItem(STASH_KEY)
    router.replace(noteHref(path))
  }, [communityId, folder, title, tags, brainTree.notePaths, router])

  const commitEntity = useCallback(async () => {
    if (!communityId || !type) return
    const res = await fetch('/api/directory/entities', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        communityId,
        type,
        name: title.trim(),
        alias,
        identityId: selectedIdentityId,
        fields,
        tags,
        body: bodyRef.current,
      }),
    })
    const data = await res.json().catch(() => ({}))

    if (res.status === 409) {
      setConflict({ message: data.error ?? 'That already exists', nodeId: data.existingNodeId ?? null, path: data.existingPath ?? '' })
      return
    }
    if (!res.ok) throw new Error(data.error || 'Failed to create')

    const node = data.node as NBNode
    const notePath = data.notePath as string

    // Prime both caches the destination reads, so the jump lands painted: the
    // profile fetch and the note read both already have their answers.
    primeNodeProfile(node.id, node)
    if (!data.noteError) {
      primeContextCache(contextKeys.read(communityId, notePath), {
        status: 'ok',
        content: await notesApi.read(communityId, notePath).then((r) => r.content).catch(() => ''),
      })
    }
    invalidateContextCache(contextKeys.tree(communityId), contextKeys.list(communityId))
    // The directory grid, the graph and the `[[ ]]` picker all read a 5-minute
    // cache — without this the entity you just made is invisible in all three.
    clearContextCache(communityId)

    sessionStorage.removeItem(STASH_KEY)
    router.replace(`/directory/${encodeURIComponent(node.id)}?tab=context`)
  }, [communityId, type, title, alias, selectedIdentityId, fields, tags, router])

  const commit = useCallback(async () => {
    if (!ready || committing || committedRef.current || !communityId) return
    committedRef.current = true
    setCommitting(true)
    setError(null)
    try {
      if (type === 'note') await commitNote()
      else await commitEntity()
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to create')
      // Failed commits must be retryable — nothing was created, and the draft is
      // still entirely in local state.
      committedRef.current = false
    } finally {
      setCommitting(false)
    }
  }, [ready, committing, communityId, type, commitNote, commitEntity])

  const pickType = useCallback((next: DraftType, nextAlias: string | null = null) => {
    setType(next)
    setAlias(nextAlias)
    setTypeMenuOpen(false)
    setConflict(null)
  }, [])

  const typeRow = (
    <TypeMenu
      open={typeMenuOpen}
      onOpenChange={setTypeMenuOpen}
      type={type}
      alias={alias}
      theme={theme}
      onPick={pickType}
      communityAliases={currentCommunity?.communityAliases}
      communityNodeTypes={currentCommunity?.nodeTypes as NodeTypeConfig[] | undefined}
    />
  )

  // The draft's one explicit affordance, sitting in the editor toolbar's trail
  // slot — the spot a saved note gives Share. Commit also fires on Enter in the
  // title; this is what makes the surface legible the first time.
  const createButton = (
    <button
      type="button"
      disabled={!ready || committing}
      onClick={() => void commit()}
      title={ready ? 'Create' : !titleUsable ? 'Give it a name first' : 'Pick a type first'}
      className="flex shrink-0 items-center gap-1.5 rounded-lg px-2.5 py-1.5 text-xs font-semibold text-white transition disabled:cursor-not-allowed disabled:opacity-40"
      style={{ background: theme.base }}
    >
      {committing ? 'Creating…' : <>Create <Check className="h-3.5 w-3.5" /></>}
    </button>
  )

  // Tags on the draft are plain local state — they ride the create request (in
  // the note's frontmatter, or the entity payload) rather than being saved one
  // at a time the way the committed entity's row does it.
  const tagsLower = new Set(tags.map((t) => t.toLowerCase()))
  const tagColors = { ...(currentCommunity?.designConfig?.tagColors ?? {}), ...tagColorOverride }
  const tagsRow = (
    <div className="flex flex-wrap items-center gap-1.5">
      {tags.map((tag) => {
        const pal = tagPalette(tag, tagColors)
        return (
          <span
            key={tag}
            className="inline-flex h-7 items-center gap-1 rounded-full pl-3 pr-1.5 text-[13px] font-medium text-white"
            style={{ background: pal.base }}
          >
            <span className="truncate">{tag}</span>
            <button
              type="button"
              onClick={() => removeTag(tag)}
              aria-label={`Remove ${tag}`}
              className="rounded-full p-0.5 opacity-60 transition hover:opacity-100"
            >
              <X className="h-3 w-3" />
            </button>
          </span>
        )
      })}
      {addingTag ? (
        <TagCombobox
          suggestions={allTags.filter((t) => !tagsLower.has(t.toLowerCase()))}
          existing={tagsLower}
          registry={tagColors}
          accentBase={theme.base}
          onAdd={addTag}
          onCreate={createTag}
          onClose={() => setAddingTag(false)}
        />
      ) : (
        <button
          type="button"
          onClick={() => setAddingTag(true)}
          className="inline-flex h-7 items-center gap-1 rounded-full border border-dashed border-border-default px-3 text-[13px] font-medium text-text-muted transition hover:border-[color:var(--accent)] hover:text-[color:var(--accent)]"
          style={{ ['--accent' as string]: theme.dark }}
        >
          + Add tag
        </button>
      )}
    </div>
  )

  const headerSlot = (
    <div className="mx-auto mb-1 w-full max-w-[760px] px-7 pt-10">
      <input
        ref={titleRef}
        value={title}
        onChange={(e) => setTitle(e.target.value)}
        onKeyDown={(e) => {
          // Enter and the Create button are the ONLY commit boundaries. Blur is
          // deliberately not one: property rows typed before commit are sent with
          // the create, so committing the moment the title loses focus would fire
          // before the user has filled anything in.
          if (e.key === 'Enter') {
            e.preventDefault()
            void commit()
          }
        }}
        placeholder="Untitled"
        aria-label="Title"
        className="w-full bg-transparent font-open-sauce text-[2.5rem] font-semibold leading-[1.1] tracking-[-0.02em] text-text-primary placeholder:text-text-muted/50 focus:outline-none"
      />

      {/* Type and Tags ONLY. `type={null}` withholds the per-type field rows
          (email, location, photo…): those describe a thing that exists, and
          they are right there on the entity's own page the moment it does.
          Creating is choosing what this is and filing it — not filling a form. */}
      <PropertyRows
        type={null}
        values={{}}
        editable
        accent={theme.dark}
        typeRow={typeRow}
        tagsRow={tagsRow}
      />

      {type === 'note' && (
        <div className="mt-3 space-y-1.5">
          <span className="text-[10px] font-semibold uppercase tracking-wide text-text-muted">Folder</span>
          <FolderPicker
            folders={brainTree.folders}
            value={folder}
            onChange={setFolder}
            contextName={currentCommunity?.name ?? 'Context'}
          />
          {titleUsable && <PathPreview path={notePath} />}
        </div>
      )}

      {conflict && (
        <div className="mt-4 flex flex-wrap items-center gap-3 rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-sm text-amber-800">
          <span>{conflict.message}</span>
          <button
            type="button"
            onClick={() =>
              router.replace(
                conflict.nodeId
                  ? `/directory/${encodeURIComponent(conflict.nodeId)}?tab=context`
                  : noteHref(conflict.path),
              )
            }
            className="inline-flex items-center gap-1 rounded-md border border-amber-300 px-2 py-1 text-xs font-semibold transition hover:bg-amber-100"
          >
            Open it <ArrowRight className="h-3 w-3" />
          </button>
        </div>
      )}

      {error && (
        <div className="mt-4 flex items-center justify-between rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700">
          <span>{error}</span>
          <button onClick={() => setError(null)} className="ml-2 text-red-400 hover:text-red-600">✕</button>
        </div>
      )}

      {searchType && !dismissedMatches && title.trim().length >= 2 && (matches.length > 0 || matchesLoading) && (
        <div className="mt-5 rounded-lg border border-border-subtle bg-surface-1 p-3">
          <MatchPanel
            results={matches}
            loading={matchesLoading}
            onSelect={handlePickMatch}
            title="Already in Visvine?"
            emptyHint="No existing matches — this will be a new entry."
          />
          <button
            type="button"
            onClick={() => setDismissedMatches(true)}
            className="mt-2 text-xs font-medium text-text-muted transition hover:text-text-secondary"
          >
            None of these — keep going
          </button>
        </div>
      )}
    </div>
  )

  return (
    <div className="pb-10">
      <NoteEditor
        variant="embedded"
        headerSlot={headerSlot}
        toolbarTrailSlot={createButton}
        path=""
        meta={null}
        notes={[]}
        initialContent={bodyRef.current}
        canEdit
        aiConfigured={false}
        mode={mode}
        references={null}
        entities={entities}
        entityByPath={entityByPath}
        // Local buffer ONLY. A network write here would create the orphan the
        // whole no-persist-until-ready design exists to prevent.
        onSave={(_, content) => { bodyRef.current = content }}
        onOpenNote={(p) => router.push(noteHref(p))}
      />
    </div>
  )
}

// ─── Type menu ───────────────────────────────────────────────────────────────

function TypeMenu({
  open,
  onOpenChange,
  type,
  alias,
  theme,
  onPick,
  communityAliases,
  communityNodeTypes,
}: {
  open: boolean
  onOpenChange: (open: boolean) => void
  type: DraftType | null
  alias: string | null
  theme: { base: string; dark: string }
  onPick: (type: DraftType, alias?: string | null) => void
  communityAliases: CommunityAlias[] | undefined
  communityNodeTypes: NodeTypeConfig[] | undefined
}) {
  const wrapperRef = useRef<HTMLDivElement>(null)
  // Which type's aliases are unfolded. Only one at a time — the menu is a
  // choice, and two open branches read as two competing lists.
  const [expanded, setExpanded] = useState<DraftType | null>(null)

  useEffect(() => {
    if (!open) setExpanded(null)
  }, [open])

  useEffect(() => {
    if (!open) return
    const handler = (e: MouseEvent) => {
      if (wrapperRef.current && !wrapperRef.current.contains(e.target as Node)) onOpenChange(false)
    }
    document.addEventListener('mousedown', handler)
    return () => document.removeEventListener('mousedown', handler)
  }, [open, onOpenChange])

  const label = alias ?? (type ? DRAFT_TYPES.find((t) => t.id === type)?.label ?? type : null)

  return (
    <div ref={wrapperRef} className="relative inline-block">
      <button
        type="button"
        onClick={() => onOpenChange(!open)}
        className={
          label
            ? 'inline-flex h-7 items-center gap-1.5 rounded-md px-2.5 text-[13px] font-semibold text-white transition hover:opacity-90'
            : 'inline-flex h-7 items-center gap-1.5 rounded-md border border-dashed border-border-default px-2.5 text-[13px] font-medium text-text-muted transition hover:border-[color:var(--accent)] hover:text-[color:var(--accent)]'
        }
        style={label ? { background: theme.base } : { ['--accent' as string]: theme.dark }}
      >
        {label ?? 'Pick a type'}
        <ChevronDown className="h-3 w-3 opacity-70" />
      </button>

      {open && (
        /* One list of types. A type that has community aliases (Founder,
           Investor…) carries a disclosure caret: press the row to take the
           plain type, press the caret to unfold its aliases and take one of
           those instead. The old flat "More specific" section could only ever
           show the ALREADY-picked type's aliases — you had to choose twice to
           find out what was on offer. */
        <div className="absolute left-0 top-full z-50 mt-1.5 w-64 overflow-hidden rounded-lg border border-border-default bg-surface-1 py-1 shadow-lg">
          {DRAFT_TYPES.map((option) => {
            const color =
              option.id === 'note' ? NOTE_COLOR : getTypeColor(option.configName, communityNodeTypes)
            const options = option.id === 'note' ? [] : aliasesForType(communityAliases, option.configName)
            const isOpen = expanded === option.id
            return (
              <div key={option.id}>
                <div className="flex items-stretch transition hover:bg-surface-2">
                  {/* Disclosure leads the row; the colour dot closes it. The
                      w-7 spacer keeps the labels of alias-less types (Note) on
                      the same left edge as the ones with a caret. */}
                  {options.length > 0 ? (
                    <button
                      type="button"
                      onClick={() => setExpanded(isOpen ? null : option.id)}
                      aria-expanded={isOpen}
                      aria-label={`More specific than ${option.label}`}
                      className="flex w-7 shrink-0 items-center justify-center text-text-muted transition hover:text-text-primary"
                    >
                      <ChevronDown className={`h-3.5 w-3.5 transition-transform ${isOpen ? 'rotate-180' : ''}`} />
                    </button>
                  ) : (
                    <span className="w-7 shrink-0" aria-hidden />
                  )}
                  <button
                    type="button"
                    onClick={() => onPick(option.id, null)}
                    className="flex min-w-0 flex-1 items-center gap-2.5 py-2 pl-1 pr-3 text-left"
                  >
                    <span className="min-w-0 flex-1">
                      <span className="block text-[13px] font-medium text-text-primary">{option.label}</span>
                      <span className="block truncate text-[11px] text-text-muted">{option.hint}</span>
                    </span>
                    {type === option.id && !alias && <Check className="h-3.5 w-3.5 shrink-0 text-text-muted" />}
                    <span className="h-2.5 w-2.5 shrink-0 rounded-full" style={{ background: color }} />
                  </button>
                </div>

                {isOpen && (
                  <div className="pb-1">
                    {options.map((a) => (
                      <button
                        key={a.name}
                        type="button"
                        onClick={() => onPick(option.id, a.name)}
                        className="flex w-full items-center gap-2.5 py-1.5 pl-8 pr-3 text-left transition hover:bg-surface-2"
                      >
                        <span className="min-w-0 flex-1 truncate text-[13px] text-text-primary">{a.name}</span>
                        {type === option.id && alias === a.name && (
                          <Check className="h-3.5 w-3.5 shrink-0 text-text-muted" />
                        )}
                        <span className="h-2 w-2 shrink-0 rounded-full" style={{ background: a.color }} />
                      </button>
                    ))}
                  </div>
                )}
              </div>
            )
          })}
        </div>
      )}
    </div>
  )
}
