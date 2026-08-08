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
import { canCreateType } from '@/lib/create/creatable'
import type { CreateableType } from '@/lib/contexts/CreateModalContext'
import { aliasesForType, findAlias, type CommunityAlias, type CommunityFeatureConfig, type NodeTypeConfig } from '@/lib/types'
import { getTypeColor } from '@/components/dashboard/typeStyles'
import { hexToPalette } from '@/lib/profileTheme'
import {
  noteFileSlug,
  availableNotePath,
  availableFolderPath,
  newNoteContent,
} from '@/lib/notes/shared/newContext'
import { indexPathOf, newIndexContent } from '@/lib/notes/shared/indexNote'
import { noteHref, sourceHref } from '@/lib/notes/entities'
import { useBrainTree, FolderPicker, PathPreview } from '@/components/create/ContextDestination'
import {
  FileForm,
  connectorSlug,
  connectorFormReady,
  type ConnectorFormData,
  type FileEntry,
  type FileFormData,
} from '@/components/create/CreateModalForms'
import { newConnectorNote } from '@/lib/connectors/config'
import type { ChannelSpaceEntry } from '@/lib/messages/types'
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
 *  always produce something, even where the directory types are gated.
 *
 *  Everything creatable in the app is here: there is no second menu. The five
 *  that used to hide behind the sidebar's caret (file, channel, space,
 *  connector, community) are ordinary types on this surface — the title is
 *  their name and the editor body is their starting context, with only the
 *  handful of fields that CANNOT be filled in afterwards shown inline. */
export type DraftType =
  | 'note'
  // A folder, written as its index note — an index note IS a folder
  // (lib/notes/shared/indexNote.ts). The title names the folder everywhere.
  | 'index'
  | 'person'
  // The organisation that used to be 'group' — a node and a note recording that
  // one exists. Provisioning a real Community row of your own isn't a draft
  // type; it's on the community switcher.
  | 'community'
  | 'resource'
  | 'connector'
  | 'channel'
  | 'space'
  | 'file'

interface DraftTypeOption {
  id: DraftType
  label: string
  /** The `nodeTypes` name this maps to, for colour resolution (null → `color`). */
  configName: string | null
  /** Fixed colour for types the community's nodeTypes don't describe. */
  color: string
  hint: string
  /** What `canCreateType` is asked about — the permission gate is shared with
   *  the docked panel, so this menu can't offer a form that 403s on submit. */
  creatable: CreateableType
}

const NOTE_COLOR = '#64748b'

const DRAFT_TYPES: DraftTypeOption[] = [
  { id: 'note', label: 'Note', configName: null, color: NOTE_COLOR, hint: 'A plain context note in a folder', creatable: 'context' },
  { id: 'index', label: 'Index', configName: 'Index', color: '#c026d3', hint: 'The home page for a group of notes', creatable: 'index' },
  { id: 'person', label: 'Person', configName: 'Person', color: NOTE_COLOR, hint: 'Someone in the directory', creatable: 'person' },
  { id: 'community', label: 'Community', configName: 'Community', color: NOTE_COLOR, hint: 'A company, organisation or group', creatable: 'community' },
  { id: 'resource', label: 'Resource', configName: 'Resource', color: NOTE_COLOR, hint: 'A document, link or tool', creatable: 'resource' },
  { id: 'file', label: 'File', configName: null, color: '#0ea5e9', hint: 'Upload documents into the context', creatable: 'file' },
  { id: 'connector', label: 'Connector', configName: 'Connector', color: '#a855f7', hint: 'A gateway to an external API or database', creatable: 'connector' },
  { id: 'channel', label: 'Channel', configName: null, color: '#f59e0b', hint: 'A place to talk, in a space', creatable: 'channel' },
  { id: 'space', label: 'Space', configName: null, color: '#f97316', hint: 'A group of related channels', creatable: 'space' },
]

/** Types that commit to a real directory node (and so get a dedupe check). */
const ENTITY_TYPES = new Set<DraftType>(['person', 'community', 'resource'])
/** Types whose only inline field is the destination folder in the context.
 *  For an index the picker chooses its PARENT — the index is a folder itself. */
const FOLDERED_TYPES = new Set<DraftType>(['note', 'index', 'file'])

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
  extras: Extras
}

/**
 * The inline settings the non-note types need at creation time — the ones that
 * can't sensibly be changed afterwards, or that the create endpoint requires.
 * Everything else about a channel/space/community/connector is edited on the
 * thing itself once it exists. Files are deliberately absent: `File` objects
 * don't survive a JSON round-trip, so a picked upload isn't stashed.
 */
interface Extras {
  /** connector */
  hosts: string
  secretName: string
  /** channel */
  viewMode: 'CHAT' | 'FEED'
  spaceId: string
}

const EMPTY_EXTRAS: Extras = {
  hosts: '',
  secretName: '',
  viewMode: 'CHAT',
  spaceId: '',
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
  const { currentCommunity, isAdmin } = useCommunity()
  const communityId = currentCommunity?.id ?? null
  const { entities, entityByPath, allTags } = useDirectoryEntities()

  const stash = useRef<Partial<Stash>>(readStash()).current

  const [title, setTitle] = useState(stash.title ?? '')
  const [type, setType] = useState<DraftType | null>(stash.type ?? initialType)
  const [alias, setAlias] = useState<string | null>(stash.alias ?? null)
  const [folder, setFolder] = useState(stash.folder ?? initialFolder)
  const [fields, setFields] = useState<Record<string, string>>(stash.fields ?? {})
  const [tags, setTags] = useState<string[]>(stash.tags ?? [])
  const [extras, setExtras] = useState<Extras>({ ...EMPTY_EXTRAS, ...(stash.extras ?? {}) })
  const [files, setFiles] = useState<FileEntry[]>([])
  const [spaces, setSpaces] = useState<ChannelSpaceEntry[]>([])
  const [addingTag, setAddingTag] = useState(false)
  const [tagColorOverride, setTagColorOverride] = useState<Record<string, string>>({})
  const [typeMenuOpen, setTypeMenuOpen] = useState(false)
  const [committing, setCommitting] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [conflict, setConflict] = useState<{ message: string; nodeId: string | null; path: string } | null>(null)
  const [selectedIdentityId, setSelectedIdentityId] = useState<string | null>(null)
  // The organisation picked out of the match list, remembered WITH the name it
  // was picked under: edit the title afterwards and you meant a different org,
  // so the binding has to fall away rather than quietly attach your card to
  // whatever you first clicked.
  const [pickedCommunity, setPickedCommunity] = useState<{ ref: string; name: string } | null>(null)
  const [dismissedMatches, setDismissedMatches] = useState(false)

  // The editor body lives in a ref, not state: it changes on every keystroke and
  // nothing above it renders from it, so state here would re-render the whole
  // surface (the editor included) on every character.
  const bodyRef = useRef(stash.body ?? '')
  // Guards against a double commit — blur and Enter can both fire for one action.
  const committedRef = useRef(false)
  const titleRef = useRef<HTMLInputElement>(null)

  const brainTree = useBrainTree(communityId, type !== null && FOLDERED_TYPES.has(type))

  // The spaces a new channel can be filed into. Loaded only while the Channel
  // type is selected — every other draft has no use for the list.
  useEffect(() => {
    if (type !== 'channel' || !communityId) return
    let cancelled = false
    fetch(`/api/messages/spaces?communityId=${encodeURIComponent(communityId)}`, { cache: 'no-store' })
      .then((r) => (r.ok ? r.json() : { spaces: [] }))
      .then((payload) => { if (!cancelled) setSpaces(payload.spaces ?? []) })
      .catch(() => { if (!cancelled) setSpaces([]) })
    return () => { cancelled = true }
  }, [type, communityId])

  // Cross-community duplicate check — the highest-value carry-over from the old
  // modal. Dropping it re-opens duplicate people and orgs across communities.
  const searchType = type && ENTITY_TYPES.has(type) ? type : ''
  const { results: matches, loading: matchesLoading } = useNodeSearch(
    searchType ? title : '',
    searchType,
    fields.email ?? '',
  )

  useEffect(() => {
    titleRef.current?.focus()
  }, [])

  // Stash on every change so a back-navigation is recoverable. Cleared on a
  // successful commit (the real note/entity is the record from then on).
  useEffect(() => {
    if (typeof sessionStorage === 'undefined') return
    const payload: Stash = { title, type, alias, body: bodyRef.current, folder, fields, tags, extras }
    sessionStorage.setItem(STASH_KEY, JSON.stringify(payload))
  }, [title, type, alias, folder, fields, tags, extras])

  const slug = noteFileSlug(title)
  // A punctuation-only title is a non-empty string that slugs to nothing — it
  // would produce the id `person:`. The SLUG is the readiness test, not the text.
  const titleUsable = slug !== 'untitled' || title.trim().toLowerCase() === 'untitled'

  // A connector's note IS its config, so the perimeter settings (hosts, the
  // name of a secret) have to be here — the note is written with them inline.
  const connectorDraft: ConnectorFormData = {
    name: title,
    description: '',
    hosts: extras.hosts,
    secretName: extras.secretName,
  }
  const queuedFiles = files.filter((f) => f.status === 'queued')

  // An upload has no title — the files carry their own names — so readiness is
  // per-type rather than one rule.
  const ready =
    type === null
      ? false
      : type === 'file'
        ? queuedFiles.length > 0
        : type === 'connector'
          ? connectorFormReady(connectorDraft)
          : titleUsable

  const typeOption = type ? DRAFT_TYPES.find((t) => t.id === type) ?? null : null
  const aliasColor = alias ? findAlias(currentCommunity?.communityAliases, alias, typeOption?.configName ?? '')?.color : null
  const baseColor = !typeOption
    ? NOTE_COLOR
    : typeOption.configName
      ? getTypeColor(typeOption.configName, currentCommunity?.nodeTypes as NodeTypeConfig[] | undefined)
      : typeOption.color
  const theme = hexToPalette(aliasColor ?? baseColor)

  // Only the types the community actually offers this person — same gate the
  // docked panel's grid asks (lib/create/creatable.ts).
  const featureConfig = (currentCommunity?.featureConfig as CommunityFeatureConfig | undefined) ?? null
  const availableTypes = useMemo(
    () => DRAFT_TYPES.filter((o) => canCreateType(o.creatable, { featureConfig, isAdmin })),
    [featureConfig, isAdmin],
  )

  // Existing folder paths, for the index destination's collision suffixing.
  const folderPaths = useMemo(
    () => new Set(brainTree.folders.map((f) => f.path).filter(Boolean)),
    [brainTree.folders],
  )

  // The destination shown before anything is written. An index's destination is
  // the index note inside the folder it creates.
  const notePath = useMemo(() => {
    if (!titleUsable) return ''
    if (type === 'note') return availableNotePath(folder, title, brainTree.notePaths)
    if (type === 'index') return indexPathOf(availableFolderPath(folder, title, folderPaths))
    return ''
  }, [type, titleUsable, folder, title, brainTree.notePaths, folderPaths])

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
    const ref = typeof meta.communityRef === 'string' ? meta.communityRef : null
    setPickedCommunity(ref ? { ref, name: result.name } : null)
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

  // An index IS a folder: this creates the folder and writes the note that names
  // it, in one call. The picked `folder` is the parent.
  const commitIndex = useCallback(async () => {
    if (!communityId) return
    const folderPath = availableFolderPath(folder, title, folderPaths)
    const content = newIndexContent({ title: title.trim(), tags, body: bodyRef.current })
    const { indexPath } = await notesApi.createFolder(communityId, folderPath, content)
    invalidateContextCache(contextKeys.tree(communityId), contextKeys.list(communityId))
    primeContextCache(contextKeys.read(communityId, indexPath), { status: 'ok', content })
    sessionStorage.removeItem(STASH_KEY)
    router.replace(noteHref(indexPath))
  }, [communityId, folder, title, tags, folderPaths, router])

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
        // Only while the title still says what they picked — see pickedCommunity.
        communityRef:
          pickedCommunity && pickedCommunity.name.trim() === title.trim()
            ? pickedCommunity.ref
            : null,
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
  }, [communityId, type, title, alias, selectedIdentityId, pickedCommunity, fields, tags, router])

  // ── The non-note commits ──────────────────────────────────────────────────
  // Each one is the same shape: the title is the name, the editor body is the
  // starting context, and the inline extras carry the rest. None of them can
  // reuse commitEntity — they aren't directory nodes, they're their own
  // endpoints (and a connector is a note whose frontmatter IS its config).

  const commitConnector = useCallback(async () => {
    if (!communityId) return
    const name = connectorSlug(title)
    const path = `connectors/${name}.md`
    const body = bodyRef.current.trim()
    const note = newConnectorNote({
      name,
      hosts: extras.hosts.split('\n').map((l) => l.trim()).filter(Boolean),
      secretName: extras.secretName,
    })
    // The generated note already carries a documentation body; anything typed
    // in the editor is appended to it rather than replacing the scaffold.
    await notesApi.create(communityId, path, body ? `${note}\n\n${body}` : note)
    invalidateContextCache(
      contextKeys.tree(communityId),
      contextKeys.list(communityId),
      contextKeys.read(communityId, path),
    )
    clearContextCache(communityId)
    sessionStorage.removeItem(STASH_KEY)
    // Its own page, not the bare note: the write synced a `connector:<name>`
    // node, and that page is where the secret gets set.
    router.replace(`/directory/${encodeURIComponent(`connector:${name}`)}`)
  }, [communityId, title, extras, router])

  const commitChannel = useCallback(async () => {
    if (!communityId) return
    const res = await fetch('/api/messages/conversations/channel', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        communityId,
        name: title.trim(),
        viewMode: extras.viewMode,
        spaceId: extras.spaceId || undefined,
        context: bodyRef.current.trim() || undefined,
      }),
    })
    const data = await res.json().catch(() => ({}))
    if (!res.ok) throw new Error(data.error || 'Failed to create channel')
    invalidateContextCache(contextKeys.tree(communityId), contextKeys.list(communityId))
    sessionStorage.removeItem(STASH_KEY)
    router.replace(`/channels/${encodeURIComponent(data.conversation.id as string)}`)
  }, [communityId, title, extras, router])

  const commitSpace = useCallback(async () => {
    if (!communityId) return
    const res = await fetch('/api/messages/spaces', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        communityId,
        name: title.trim(),
        context: bodyRef.current.trim() || undefined,
      }),
    })
    const data = await res.json().catch(() => ({}))
    if (!res.ok) throw new Error(data.error || 'Failed to create space')
    invalidateContextCache(contextKeys.tree(communityId), contextKeys.list(communityId))
    sessionStorage.removeItem(STASH_KEY)
    router.replace('/channels')
  }, [communityId, title, router])

  // Uploaded one at a time: each request runs the whole extract → chunk → embed
  // pipeline synchronously, so a parallel burst would just contend. A file that
  // fails leaves the others alone and keeps its row.
  const commitFiles = useCallback(async () => {
    if (!communityId) return
    const patch = (index: number, next: Partial<FileEntry>) =>
      setFiles((prev) => prev.map((f, i) => (i === index ? { ...f, ...next } : f)))

    let uploaded = 0
    let lastPath: string | null = null
    for (const [index, entry] of files.entries()) {
      if (entry.status !== 'queued') continue
      patch(index, { status: 'uploading', error: undefined })
      try {
        const { source } = await notesApi.uploadSource(communityId, entry.file, folder)
        patch(index, { status: 'done', path: source.path })
        uploaded++
        lastPath = source.path
      } catch (err) {
        patch(index, { status: 'failed', error: err instanceof Error ? err.message : 'Upload failed' })
      }
    }
    if (!uploaded) throw new Error('No files could be uploaded — see the list above')

    invalidateContextCache(contextKeys.tree(communityId), contextKeys.list(communityId))
    clearContextCache(communityId)
    sessionStorage.removeItem(STASH_KEY)
    router.replace(uploaded === 1 && lastPath ? sourceHref(lastPath) : '/directory')
  }, [communityId, files, folder, router])

  const commit = useCallback(async () => {
    if (!ready || committing || committedRef.current || !communityId) return
    committedRef.current = true
    setCommitting(true)
    setError(null)
    try {
      if (type === 'note') await commitNote()
      else if (type === 'index') await commitIndex()
      else if (type === 'connector') await commitConnector()
      else if (type === 'channel') await commitChannel()
      else if (type === 'space') await commitSpace()
      else if (type === 'file') await commitFiles()
      else await commitEntity()
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to create')
      // Failed commits must be retryable — nothing was created, and the draft is
      // still entirely in local state.
      committedRef.current = false
    } finally {
      setCommitting(false)
    }
  }, [
    ready, committing, communityId, type,
    commitNote, commitIndex, commitEntity, commitConnector, commitChannel, commitSpace, commitFiles,
  ])

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
      options={availableTypes}
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
      title={
        ready
          ? 'Create'
          : type === null
            ? 'Pick a type first'
            : type === 'file'
              ? 'Add a file first'
              : !titleUsable
                ? 'Give it a name first'
                : type === 'connector'
                  ? 'Check the connector fields first'
                  : 'Pick a type first'
      }
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
      {/* An upload has no name of its own to type — each file keeps its own —
          so File is the one type that drops the title line entirely. */}
      <input
        ref={titleRef}
        hidden={type === 'file'}
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

      {(type === 'note' || type === 'index') && (
        <div className="mt-3 space-y-1.5">
          <span className="text-[10px] font-semibold uppercase tracking-wide text-text-muted">
            {/* An index IS a folder, so the picker chooses where it goes, not what it goes in. */}
            {type === 'index' ? 'Inside' : 'Folder'}
          </span>
          <FolderPicker
            folders={brainTree.folders}
            value={folder}
            onChange={setFolder}
            contextName={currentCommunity?.name ?? 'Context'}
          />
          {titleUsable && <PathPreview path={notePath} />}
        </div>
      )}

      {/* Per-type extras: ONLY what can't be set afterwards on the thing itself,
          or what its create endpoint refuses to go without. Everything else
          (a channel's icon, a community's location…) is one click away on the
          page you land on. */}
      {type === 'file' && (
        <div className="mt-4">
          <FileForm
            data={{ files, folder }}
            onChange={(d: FileFormData) => { setFiles(d.files); setFolder(d.folder) }}
            folders={brainTree.folders}
            contextName={currentCommunity?.name ?? 'Context'}
            loading={brainTree.loading}
          />
        </div>
      )}

      {type === 'connector' && (
        <ConnectorExtras
          extras={extras}
          onChange={setExtras}
          slug={connectorSlug(title)}
          accent={theme.dark}
        />
      )}

      {type === 'channel' && (
        <ChannelExtras extras={extras} onChange={setExtras} spaces={spaces} accent={theme.base} />
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
  options: typeOptions,
  type,
  alias,
  theme,
  onPick,
  communityAliases,
  communityNodeTypes,
}: {
  open: boolean
  onOpenChange: (open: boolean) => void
  options: DraftTypeOption[]
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
        <div className="absolute left-0 top-full z-50 mt-1.5 max-h-[70vh] w-64 overflow-y-auto rounded-lg border border-border-default bg-surface-1 py-1 shadow-lg">
          {typeOptions.map((option) => {
            const color = option.configName
              ? getTypeColor(option.configName, communityNodeTypes)
              : option.color
            const options = option.configName ? aliasesForType(communityAliases, option.configName) : []
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

// ─── Per-type extras ─────────────────────────────────────────────────────────
// Deliberately small. The draft surface's whole argument is that creating is
// choosing what a thing is and naming it — anything editable on the thing's own
// page afterwards does NOT belong here. What's left is the irreducible part:
// a connector's transport and endpoint (its note is its config, and one without
// them is invalid), and a channel's view style and space.

function ExtraField({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="space-y-1.5">
      <span className="block text-[10px] font-semibold uppercase tracking-wide text-text-muted">{label}</span>
      {children}
    </div>
  )
}

const extraInput =
  'w-full rounded-lg border border-border-default bg-surface-1 px-3 py-2 text-sm text-text-primary placeholder:text-text-muted/60 focus:border-[color:var(--accent)] focus:outline-none'

function SegmentedChoice<T extends string>({
  value,
  options,
  onPick,
  accent,
}: {
  value: T
  options: readonly { value: T; label: string; hint?: string }[]
  onPick: (value: T) => void
  accent: string
}) {
  return (
    <div className="flex gap-2">
      {options.map((opt) => {
        const active = value === opt.value
        return (
          <button
            key={opt.value}
            type="button"
            onClick={() => onPick(opt.value)}
            className={`flex flex-1 flex-col items-start gap-0.5 rounded-lg border px-3 py-2 text-left text-sm font-medium transition ${
              active
                ? 'border-[color:var(--accent)] text-text-primary'
                : 'border-border-default text-text-secondary hover:border-[color:var(--accent)]/60'
            }`}
            style={{
              ['--accent' as string]: accent,
              background: active ? `color-mix(in srgb, ${accent} 12%, transparent)` : undefined,
            }}
          >
            {opt.label}
            {opt.hint && <span className="text-[11px] font-normal text-text-muted">{opt.hint}</span>}
          </button>
        )
      })}
    </div>
  )
}

function ConnectorExtras({
  extras,
  onChange,
  slug,
  accent,
}: {
  extras: Extras
  onChange: (next: Extras) => void
  slug: string
  accent: string
}) {
  return (
    <div className="mt-4 space-y-3" style={{ ['--accent' as string]: accent }}>
      <ExtraField label="Hosts">
        <textarea
          className={`${extraInput} resize-none font-mono`}
          rows={2}
          placeholder={'api.stripe.com'}
          value={extras.hosts}
          onChange={(e) => onChange({ ...extras, hosts: e.target.value })}
        />
      </ExtraField>
      <ExtraField label="Secret">
        <input
          className={`${extraInput} font-mono`}
          placeholder="STRIPE_KEY"
          value={extras.secretName}
          onChange={(e) => onChange({ ...extras, secretName: e.target.value })}
        />
      </ExtraField>
      <p className="text-xs text-text-muted">
        Agents run commands in a sandbox that can only reach these hosts (one per line). The
        secret&apos;s value is set on the connector&apos;s page afterwards and reaches commands as{' '}
        <span className="font-mono">${extras.secretName.trim().toUpperCase() || 'NAME'}</span>.
      </p>

      {slug && <PathPreview path={`connectors/${slug}.md`} />}
    </div>
  )
}

function ChannelExtras({
  extras,
  onChange,
  spaces,
  accent,
}: {
  extras: Extras
  onChange: (next: Extras) => void
  spaces: ChannelSpaceEntry[]
  accent: string
}) {
  return (
    <div className="mt-4 space-y-3">
      <ExtraField label="View style">
        <SegmentedChoice
          value={extras.viewMode}
          onPick={(viewMode) => onChange({ ...extras, viewMode })}
          accent={accent}
          options={[
            { value: 'CHAT', label: 'Chat', hint: 'A classic thread' },
            { value: 'FEED', label: 'Feed', hint: 'Post cards with comments' },
          ] as const}
        />
      </ExtraField>
      {spaces.length > 0 && (
        <ExtraField label="Space">
          <select
            className={extraInput}
            style={{ ['--accent' as string]: accent }}
            value={extras.spaceId}
            onChange={(e) => onChange({ ...extras, spaceId: e.target.value })}
          >
            <option value="">No space</option>
            {spaces.map((space) => (
              <option key={space.id} value={space.id}>
                {space.emoji ? `${space.emoji} ` : ''}{space.name}
              </option>
            ))}
          </select>
        </ExtraField>
      )}
    </div>
  )
}

