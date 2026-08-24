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
import { ArrowRightIcon, CheckIcon, ChevronRightIcon } from '@/features/shared/icons';
import { CHIP_ACCENT_HOVER, Chip, chipClass, Modal } from '@/components/ui'
import { useSpace } from '@/features/shared/contexts/SpaceContext'
import { canCreateType } from '@/lib/create/creatable'
import { isNodeTypeEnabled } from '@/lib/featureAccess'
import type { CreateableType } from '@/features/shared/contexts/CreateModalContext'
import {
  DEFAULT_NODE_TYPES,
  aliasesForType,
  defaultNodeTypeColor,
  findAlias,
  findNodeTypeConfig,
  isReservedTypeName,
  mergeNodeType,
  type SpaceAlias,
  type SpaceFeatureConfig,
  type NodeTypeConfig,
} from '@/lib/types'
import { hexToPalette } from '@/lib/profileTheme'
import {
  noteFileSlug,
  availableNotePath,
  availableFolderPath,
  newNoteContent,
} from '@/lib/notes/shared/newContext'
import { indexPathOf, newIndexContent } from '@/lib/notes/shared/indexNote'
import { noteHref, sourceHref } from '@/lib/notes/entities'
import { useContextFolderTree, FolderDropBoard, PathPreview } from '@/features/create/components/ContextDestination'
import { FileForm, type FileEntry, type FileFormData } from '@/features/create/components/CreateModalForms'
import { agentSlug, connectorSlug } from '@/lib/create/noteSlug'
import { newConnectorNote } from '@/lib/connectors/config'
import { agentBriefPath, newAgentNote } from '@/lib/agents/config'
import type { ChannelSectionEntry } from '@/lib/messages/types'
import { useNodeSearch, type NodeSearchResult } from '@/features/shared/hooks/useNodeSearch'
import MatchPanel from '@/features/create/components/MatchPanel'
import { TAG_SWATCHES, tagKey, tagPalette } from '@/lib/tagColors'
import { scoreText } from '@/lib/fuzzy'
import { primeNodeProfile } from '@/features/shared/hooks/useNodeProfile'
import { clearContextCache } from '@/features/notes/hooks/useSpaceContextData'
import type { NBNode } from '@/lib/types'
import { fetchJsonBody } from '@/lib/fetchJson'
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
 *  that used to hide behind the sidebar's caret (file, channel, section,
 *  connector, space) are ordinary types on this surface — the title is
 *  their name and the editor body is their starting context, with only the
 *  handful of fields that CANNOT be filled in afterwards shown inline. */
export type DraftType =
  | 'note'
  // A folder, written as its index note — an index note IS a folder
  // (lib/notes/shared/indexNote.ts). The title names the folder everywhere.
  | 'folder'
  | 'person'
  // The org type — a node and a
  // note recording that a group/organisation exists. Provisioning a real space
  // of your own isn't a draft type; it's on the switcher.
  | 'space'
  // Drafts like any other entity: title, date, location, body. The RSVP form,
  // theme and guest list are edited on the event page afterwards.
  | 'event'
  | 'resource'
  | 'connector'
  // A scheduled agent, written as its brief under agents/ (lib/agents/config).
  // The title names it, the editor body IS the brief; an admin activates it
  // afterwards from /agents.
  | 'agent'
  | 'channel'
  // The channels-tool container.
  | 'section'
  | 'file'

interface DraftTypeOption {
  id: DraftType
  label: string
  /** The `nodeTypes` name this maps to, for colour resolution. Resolved against
   *  the space's OWN registry, falling back to `color` when it has no entry
   *  under that name. */
  configName: string | null
  /** Fallback colour, for a space whose nodeTypes don't describe this. */
  color: string
  /** What `canCreateType` is asked about — the permission gate is shared with
   *  the docked panel, so this menu can't offer a form that 403s on submit. */
  creatable: CreateableType
}

const NOTE_COLOR = '#64748b'

/** Note and File aren't node types — they're content in the context, so the
 *  console's Types tab doesn't list them. They bookend the menu; everything
 *  between comes from DEFAULT_NODE_TYPES in the console's own order, so the
 *  menu and the Types tab always say the same thing (colours included).
 *
 *  Note still carries a configName: plenty of spaces DO keep a "Note"
 *  entry in their registry (the seed writes one), and when they do, that colour
 *  is the one every other surface paints notes in — so the menu must obey it
 *  rather than show its own slate. The slate is the fallback for the
 *  spaces that don't. */
const DRAFT_TYPES: DraftTypeOption[] = [
  { id: 'note', label: 'Note', configName: 'Note', color: NOTE_COLOR, creatable: 'context' },
  { id: 'person', label: 'Person', configName: 'Person', color: NOTE_COLOR, creatable: 'person' },
  { id: 'space', label: 'Space', configName: 'Space', color: NOTE_COLOR, creatable: 'space' },
  { id: 'event', label: 'Event', configName: 'Event', color: NOTE_COLOR, creatable: 'event' },
  { id: 'resource', label: 'Resource', configName: 'Resource', color: NOTE_COLOR, creatable: 'resource' },
  { id: 'section', label: 'Section', configName: 'Section', color: NOTE_COLOR, creatable: 'section' },
  { id: 'channel', label: 'Channel', configName: 'Channel', color: NOTE_COLOR, creatable: 'channel' },
  { id: 'connector', label: 'Connector', configName: 'Connector', color: NOTE_COLOR, creatable: 'connector' },
  { id: 'agent', label: 'Agent', configName: 'Agent', color: NOTE_COLOR, creatable: 'agent' },
  { id: 'folder', label: 'Folder', configName: null, color: NOTE_COLOR, creatable: 'folder' },
  { id: 'file', label: 'File', configName: null, color: '#0ea5e9', creatable: 'file' },
]

/**
 * Where a freshly created entity lands. An event opens on its event page and a
 * person on their profile — the record is what you fill in next, and both pages
 * carry the context note alongside it. A space or resource has nothing to fill
 * in beyond what the draft took, so it opens straight on the note.
 */
function createdEntityHref(type: DraftType, nodeId: string): string {
  const id = encodeURIComponent(nodeId)
  if (type === 'event') return `/events/${id}`
  if (type === 'person') return `/directory/${id}`
  return `/directory/${id}?tab=context`
}

/** Types that commit to a real directory node (and so get a dedupe check).
 *  Keep in sync with CREATABLE_TYPES (lib/directory/createEntity.ts) — that is
 *  the server's list, and a type here that isn't there 400s on commit. */
const ENTITY_TYPES = new Set<DraftType>(['person', 'space', 'resource', 'event'])
/** Types whose only inline field is the destination folder in the context.
 *  For a folder the picker chooses its PARENT — the folder is one itself. */
const FOLDERED_TYPES = new Set<DraftType>(['note', 'folder', 'file'])

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
  customType: string | null
  body: string
  folder: string
  fields: Record<string, string>
  tags: string[]
  extras: Extras
}

/**
 * The inline settings a type's create endpoint cannot go without — which is now
 * only a channel's, since a channel is a conversation row rather than a note.
 * Everything a note carries in its frontmatter (a connector's hosts and secret,
 * an agent's model and connectors) is scaffolded at its defaults and edited on
 * the note afterwards: the draft surface is for saying what a thing is and
 * naming it, not for filling in a form in front of it. Files are deliberately
 * absent too — `File` objects don't survive a JSON round-trip, so a picked
 * upload isn't stashed.
 */
interface Extras {
  /** channel */
  viewMode: 'CHAT' | 'FEED'
  sectionId: string
}

const EMPTY_EXTRAS: Extras = {
  viewMode: 'CHAT',
  sectionId: '',
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
  const { currentSpace, isAdmin } = useSpace()
  const spaceId = currentSpace?.id ?? null
  const { entities, entityByPath, allTags } = useDirectoryEntities()

  const stash = useRef<Partial<Stash>>(readStash()).current

  const [title, setTitle] = useState(stash.title ?? '')
  const [type, setType] = useState<DraftType | null>(stash.type ?? initialType)
  const [alias, setAlias] = useState<string | null>(stash.alias ?? null)
  // A type this space invented rather than one of the built-ins. It is a
  // NARROWING of 'note', never a type of its own: what it creates is a context
  // note wearing that name in its frontmatter, so every rule about notes —
  // the folder picker, the path preview, the commit path — still applies.
  // Invariant: customType !== null ⇒ type === 'note'. `pickType` is the only
  // place that sets either, which is what keeps that true.
  const [customType, setCustomType] = useState<string | null>(stash.customType ?? null)
  const [folder, setFolder] = useState(stash.folder ?? initialFolder)
  // The destination popup, opened by Create on a note or an index.
  const [destOpen, setDestOpen] = useState(false)
  const [fields, setFields] = useState<Record<string, string>>(stash.fields ?? {})
  const [tags, setTags] = useState<string[]>(stash.tags ?? [])
  const [extras, setExtras] = useState<Extras>({ ...EMPTY_EXTRAS, ...(stash.extras ?? {}) })
  // An agent's `?folder=` names a folder of AGENTS — the roster row it was
  // pressed on — not a folder in the context tree, so it is kept apart from the
  // destination picker and only ever used to build the brief's path.
  const agentFolder = useRef(initialType === 'agent' ? initialFolder : '').current
  const [files, setFiles] = useState<FileEntry[]>([])
  const [sections, setSections] = useState<ChannelSectionEntry[]>([])
  const [addingTag, setAddingTag] = useState(false)
  const [tagColorOverride, setTagColorOverride] = useState<Record<string, string>>({})
  const [typeMenuOpen, setTypeMenuOpen] = useState(false)
  // A type created in this session, held locally until refreshSpace lands —
  // the same bargain createTag makes, so the menu doesn't blink the type away
  // the moment you pick it.
  const [addedTypes, setAddedTypes] = useState<NodeTypeConfig[]>([])
  const [committing, setCommitting] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [conflict, setConflict] = useState<{ message: string; nodeId: string | null; path: string } | null>(null)
  const [selectedIdentityId, setSelectedIdentityId] = useState<string | null>(null)
  // The organisation picked out of the match list, remembered WITH the name it
  // was picked under: edit the title afterwards and you meant a different org,
  // so the binding has to fall away rather than quietly attach your card to
  // whatever you first clicked.
  const [pickedSpace, setPickedSpace] = useState<{ ref: string; name: string } | null>(null)
  const [dismissedMatches, setDismissedMatches] = useState(false)

  // The editor body lives in a ref, not state: it changes on every keystroke and
  // nothing above it renders from it, so state here would re-render the whole
  // surface (the editor included) on every character.
  const bodyRef = useRef(stash.body ?? '')
  // Guards against a double commit — blur and Enter can both fire for one action.
  const committedRef = useRef(false)
  const titleRef = useRef<HTMLInputElement>(null)

  const contextFolderTree = useContextFolderTree(spaceId, type !== null && FOLDERED_TYPES.has(type))

  // The sections a new channel can be filed into. Loaded only while the Channel
  // type is selected — every other draft has no use for the list.
  useEffect(() => {
    if (type !== 'channel' || !spaceId) return
    let cancelled = false
    fetch(`/api/messages/sections?spaceId=${encodeURIComponent(spaceId)}`, { cache: 'no-store' })
      .then((r) => (r.ok ? r.json() : { sections: [] }))
      .then((payload) => { if (!cancelled) setSections(payload.sections ?? []) })
      .catch(() => { if (!cancelled) setSections([]) })
    return () => { cancelled = true }
  }, [type, spaceId])

  // Cross-space duplicate check — the highest-value carry-over from the old
  // modal. Dropping it re-opens duplicate people and orgs across spaces.
  const searchType = type && ENTITY_TYPES.has(type) ? type : ''
  const { results: matches, loading: matchesLoading } = useNodeSearch(
    searchType ? title : '',
    searchType,
    fields.email ?? '',
  )
  const showMatches =
    !!searchType && !dismissedMatches && title.trim().length >= 2 && (matches.length > 0 || matchesLoading)

  useEffect(() => {
    titleRef.current?.focus()
  }, [])

  // Stash on every change so a back-navigation is recoverable. Cleared on a
  // successful commit (the real note/entity is the record from then on).
  useEffect(() => {
    if (typeof sessionStorage === 'undefined') return
    const payload: Stash = { title, type, alias, customType, body: bodyRef.current, folder, fields, tags, extras }
    sessionStorage.setItem(STASH_KEY, JSON.stringify(payload))
  }, [title, type, alias, customType, folder, fields, tags, extras])

  const slug = noteFileSlug(title)
  // A punctuation-only title is a non-empty string that slugs to nothing — it
  // would produce the id `person:`. The SLUG is the readiness test, not the text.
  const titleUsable = slug !== 'untitled' || title.trim().toLowerCase() === 'untitled'

  const queuedFiles = files.filter((f) => f.status === 'queued')

  // An upload has no title — the files carry their own names — so readiness is
  // per-type rather than one rule. A connector and an agent are named by a
  // slug rather than a file name, so theirs has to survive slugging too.
  const ready =
    type === null
      ? false
      : type === 'file'
        ? queuedFiles.length > 0
        : type === 'connector'
          ? titleUsable && !!connectorSlug(title)
          : type === 'agent'
            ? titleUsable && !!agentSlug(title)
            : titleUsable

  // The types this space invented — anything in its nodeTypes that isn't a
  // built-in (or a synonym of one), plus whatever was created in this session.
  // These are the note vocabulary: they label a context note and nothing more,
  // so they're offered as narrowings of Note rather than as types of their own.
  const customTypes = useMemo(() => {
    const stored = (currentSpace?.nodeTypes as NodeTypeConfig[] | undefined) ?? []
    const byLower = new Map<string, NodeTypeConfig>()
    for (const t of [...stored, ...addedTypes]) {
      const name = t.name?.trim()
      // A reserved name can be STORED (prisma/seed.ts seeds Note and Index), but
      // it must never reach a picker that writes it into frontmatter: `Index`
      // would relocate the note into a folder of its own.
      if (!name || isReservedTypeName(name)) continue
      if (findNodeTypeConfig(name)) continue
      byLower.set(name.toLowerCase(), t)
    }
    return Array.from(byLower.values()).sort((a, b) => a.name.localeCompare(b.name))
  }, [currentSpace?.nodeTypes, addedTypes])

  const customConfig = customType
    ? customTypes.find((t) => t.name.toLowerCase() === customType.toLowerCase()) ?? null
    : null

  // A stashed custom type that no longer exists — its create request failed, or
  // an admin removed it — must not come back as a live selection.
  useEffect(() => {
    if (!customType || !currentSpace || customConfig) return
    setCustomType(null)
  }, [customType, customConfig, currentSpace])

  const typeOption = type ? DRAFT_TYPES.find((t) => t.id === type) ?? null : null
  const aliasColor = alias ? findAlias(currentSpace?.aliases, alias, typeOption?.configName ?? '')?.color : null
  const baseColor = customType
    ? customConfig?.color ?? defaultNodeTypeColor(customType)
    : !typeOption
      ? NOTE_COLOR
      : (typeOption.configName
          ? findNodeTypeConfig(typeOption.configName, currentSpace?.nodeTypes as NodeTypeConfig[] | undefined)?.color
          : null) ?? typeOption.color
  const theme = hexToPalette(aliasColor ?? baseColor)

  // Only the types the space actually offers this person. The node types
  // are EXACTLY the console's Types tab — same source (DEFAULT_NODE_TYPES),
  // same feature filter (isNodeTypeEnabled), same order — then narrowed to
  // what this person may create (lib/create/creatable.ts). Note and File
  // bookend the list: they're context content, not node types, so the console
  // doesn't list them but this surface can't do without them.
  const featureConfig = (currentSpace?.featureConfig as SpaceFeatureConfig | undefined) ?? null
  const availableTypes = useMemo(() => {
    const byConfigName = new Map(DRAFT_TYPES.filter((o) => o.configName).map((o) => [o.configName, o]))
    const nodeTypeOptions = DEFAULT_NODE_TYPES
      .filter((t) => isNodeTypeEnabled(featureConfig, t.name))
      .map((t) => byConfigName.get(t.name))
      .filter((o): o is DraftTypeOption => o !== undefined)
    const note = DRAFT_TYPES.find((o) => o.id === 'note') as DraftTypeOption
    const file = DRAFT_TYPES.find((o) => o.id === 'file') as DraftTypeOption
    return [note, ...nodeTypeOptions, file].filter((o) =>
      canCreateType(o.creatable, { featureConfig, isAdmin }),
    )
  }, [featureConfig, isAdmin])

  // Existing folder paths, for the index destination's collision suffixing.
  const folderPaths = useMemo(
    () => new Set(contextFolderTree.folders.map((f) => f.path).filter(Boolean)),
    [contextFolderTree.folders],
  )

  // The destination shown before anything is written. An index's destination is
  // the index note inside the folder it creates.
  // Where the draft would land in a GIVEN folder — the destination board
  // previews this under whichever row the draft is hovering over, so the path
  // is visible before the drop commits it.
  const pathIn = useCallback(
    (dest: string) => {
      if (!titleUsable) return ''
      if (type === 'note') return availableNotePath(dest, title, contextFolderTree.notePaths)
      if (type === 'folder') return indexPathOf(availableFolderPath(dest, title, folderPaths))
      return ''
    },
    [type, titleUsable, title, contextFolderTree.notePaths, folderPaths],
  )

  const addTag = useCallback((raw: string) => {
    const tag = raw.trim()
    if (!tag) return
    setTags((prev) => (prev.some((t) => t.toLowerCase() === tag.toLowerCase()) ? prev : [...prev, tag]))
    setAddingTag(false)
  }, [])

  // A brand-new tag with a chosen colour. The colour registers on the space
  // immediately (it is space-level config, not draft state) — best effort,
  // the tag still lands on the draft if that write fails.
  const createTag = useCallback((raw: string, color: string) => {
    const tag = raw.trim()
    if (!tag || !spaceId) return
    setTagColorOverride((m) => ({ ...m, [tagKey(tag)]: color }))
    void fetch(`/api/communities/${encodeURIComponent(spaceId)}/tag-colors`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ tag, color }),
    }).catch(() => {})
    addTag(tag)
  }, [spaceId, addTag])

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
    const ref = typeof meta.spaceRef === 'string' ? meta.spaceRef : null
    setPickedSpace(ref ? { ref, name: result.name } : null)
    setDismissedMatches(true)
  }, [])

  // ── Commit ────────────────────────────────────────────────────────────────

  // `dest` is passed in rather than read off state: the destination is chosen
  // by dropping the draft on a folder, and the drop must create in the SAME
  // tick — a setFolder followed by commit() would commit the previous folder.
  const commitNote = useCallback(async (dest: string) => {
    if (!spaceId) return
    const path = availableNotePath(dest, title, contextFolderTree.notePaths)
    const content = newNoteContent({
      title: title.trim(),
      tags,
      body: bodyRef.current,
      // The REGISTERED spelling, not what was typed — retrieval filters this
      // field with an exact, case-sensitive compare.
      type: customConfig?.name ?? customType ?? undefined,
    })
    await notesApi.create(spaceId, path, content)
    invalidateContextCache(contextKeys.tree(spaceId), contextKeys.list(spaceId))
    // The note we just wrote IS the freshest read — priming it means the note
    // page paints its content on first render instead of flashing a skeleton.
    primeContextCache(contextKeys.read(spaceId, path), { status: 'ok', content })
    sessionStorage.removeItem(STASH_KEY)
    router.replace(noteHref(path))
  }, [spaceId, title, tags, contextFolderTree.notePaths, router, customType, customConfig])

  // An index IS a folder: this creates the folder and writes the note that names
  // it, in one call. `dest` is the PARENT it was dropped into.
  const commitFolder = useCallback(async (dest: string) => {
    if (!spaceId) return
    const folderPath = availableFolderPath(dest, title, folderPaths)
    const content = newIndexContent({
      title: title.trim(),
      tags,
      body: bodyRef.current,
      // A folder's type is its SUBJECT, same field and same rule as a note's:
      // the REGISTERED spelling, because retrieval compares it exactly.
      type: customConfig?.name ?? customType ?? undefined,
    })
    const { indexPath } = await notesApi.createFolder(spaceId, folderPath, content)
    invalidateContextCache(contextKeys.tree(spaceId), contextKeys.list(spaceId))
    primeContextCache(contextKeys.read(spaceId, indexPath), { status: 'ok', content })
    sessionStorage.removeItem(STASH_KEY)
    router.replace(noteHref(indexPath))
  }, [spaceId, title, tags, folderPaths, router, customType, customConfig])

  const commitEntity = useCallback(async () => {
    if (!spaceId || !type) return
    const res = await fetch('/api/directory/entities', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        spaceId,
        type,
        name: title.trim(),
        alias,
        identityId: selectedIdentityId,
        // Only while the title still says what they picked — see pickedSpace.
        spaceRef:
          pickedSpace && pickedSpace.name.trim() === title.trim()
            ? pickedSpace.ref
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
      primeContextCache(contextKeys.read(spaceId, notePath), {
        status: 'ok',
        content: await notesApi.read(spaceId, notePath).then((r) => r.content).catch(() => ''),
      })
    }
    invalidateContextCache(contextKeys.tree(spaceId), contextKeys.list(spaceId))
    // The directory grid, the graph and the `[[ ]]` picker all read a 5-minute
    // cache — without this the entity you just made is invisible in all three.
    clearContextCache(spaceId)

    sessionStorage.removeItem(STASH_KEY)
    router.replace(createdEntityHref(type, node.id))
  }, [spaceId, type, title, alias, selectedIdentityId, pickedSpace, fields, tags, router])

  // ── The non-note commits ──────────────────────────────────────────────────
  // Each one is the same shape: the title is the name, the editor body is the
  // starting context, and the inline extras carry the rest. None of them can
  // reuse commitEntity — they aren't directory nodes, they're their own
  // endpoints (and a connector is a note whose frontmatter IS its config).

  // Written with no hosts and no secret — `hosts: []` is a supported state (the
  // isolate simply has no network yet), and the scaffolded body says how to add
  // them. Both are edited on the note afterwards, so neither is worth a form in
  // front of a connector nobody has described yet.
  const commitConnector = useCallback(async () => {
    if (!spaceId) return
    const name = connectorSlug(title)
    const path = `connectors/${name}.md`
    const body = bodyRef.current.trim()
    const note = newConnectorNote({ name })
    // The generated note already carries a documentation body; anything typed
    // in the editor is appended to it rather than replacing the scaffold.
    await notesApi.create(spaceId, path, body ? `${note}\n\n${body}` : note)
    invalidateContextCache(
      contextKeys.tree(spaceId),
      contextKeys.list(spaceId),
      contextKeys.read(spaceId, path),
    )
    clearContextCache(spaceId)
    sessionStorage.removeItem(STASH_KEY)
    // Its own page, not the bare note: the write synced a `connector:<name>`
    // node, and that page is where the secret gets set.
    router.replace(`/directory/${encodeURIComponent(`connector:${name}`)}`)
  }, [spaceId, title, router])

  // An agent is a note under `agents/`: the title names it, the body is the
  // brief. The frontmatter it needs to run — the model, the connectors it may
  // call — is scaffolded at its defaults and edited on the note afterwards (the
  // Raw tab, or its own page); nothing about it is unchangeable, so nothing
  // about it belongs in a form in front of the brief. It does nothing at all
  // until an admin activates it from /agents.
  const commitAgent = useCallback(async () => {
    if (!spaceId) return
    const name = agentSlug(title)
    const path = agentBriefPath(name, agentFolder)
    await notesApi.create(
      spaceId,
      path,
      newAgentNote({ name, title: title.trim(), body: bodyRef.current.trim() }),
    )
    invalidateContextCache(
      contextKeys.tree(spaceId),
      contextKeys.list(spaceId),
      contextKeys.read(spaceId, path),
    )
    clearContextCache(spaceId)
    sessionStorage.removeItem(STASH_KEY)
    // Its own page rather than the bare note: the write synced an `agent:<name>`
    // node, and that page is where the schedule and activation live.
    router.replace(`/directory/${encodeURIComponent(`agent:${name}`)}`)
  }, [spaceId, title, agentFolder, router])

  const commitChannel = useCallback(async () => {
    if (!spaceId) return
    const data = await fetchJsonBody<{ conversation: { id: string } }>('/api/messages/conversations/channel', 'POST', {
      spaceId,
      name: title.trim(),
      viewMode: extras.viewMode,
      sectionId: extras.sectionId || undefined,
      context: bodyRef.current.trim() || undefined,
    })
    invalidateContextCache(contextKeys.tree(spaceId), contextKeys.list(spaceId))
    sessionStorage.removeItem(STASH_KEY)
    router.replace(`/channels/${encodeURIComponent(data.conversation.id)}`)
  }, [spaceId, title, extras, router])

  const commitSpace = useCallback(async () => {
    if (!spaceId) return
    await fetchJsonBody('/api/messages/sections', 'POST', {
      spaceId,
      name: title.trim(),
      context: bodyRef.current.trim() || undefined,
    })
    invalidateContextCache(contextKeys.tree(spaceId), contextKeys.list(spaceId))
    sessionStorage.removeItem(STASH_KEY)
    router.replace('/channels')
  }, [spaceId, title, router])

  // Uploaded one at a time: each request runs the whole extract → chunk → embed
  // pipeline synchronously, so a parallel burst would just contend. A file that
  // fails leaves the others alone and keeps its row.
  const commitFiles = useCallback(async () => {
    if (!spaceId) return
    const patch = (index: number, next: Partial<FileEntry>) =>
      setFiles((prev) => prev.map((f, i) => (i === index ? { ...f, ...next } : f)))

    let uploaded = 0
    let lastPath: string | null = null
    for (const [index, entry] of files.entries()) {
      if (entry.status !== 'queued') continue
      patch(index, { status: 'uploading', error: undefined })
      try {
        const { source } = await notesApi.uploadSource(spaceId, entry.file, folder)
        patch(index, { status: 'done', path: source.path })
        uploaded++
        lastPath = source.path
      } catch (err) {
        patch(index, { status: 'failed', error: err instanceof Error ? err.message : 'Upload failed' })
      }
    }
    if (!uploaded) throw new Error('No files could be uploaded — see the list above')

    invalidateContextCache(contextKeys.tree(spaceId), contextKeys.list(spaceId))
    clearContextCache(spaceId)
    sessionStorage.removeItem(STASH_KEY)
    router.replace(uploaded === 1 && lastPath ? sourceHref(lastPath) : '/directory')
  }, [spaceId, files, folder, router])

  // `dest` is the folder the draft was dropped on, for the two types that ask.
  // Defaults to the standing `folder` (the one "+" was pressed in) so Enter and
  // the non-foldered types behave exactly as before.
  const commit = useCallback(async (dest?: string) => {
    if (!ready || committing || committedRef.current || !spaceId) return
    const where = dest ?? folder
    committedRef.current = true
    setCommitting(true)
    setError(null)
    try {
      if (type === 'note') await commitNote(where)
      else if (type === 'folder') await commitFolder(where)
      else if (type === 'connector') await commitConnector()
      else if (type === 'agent') await commitAgent()
      else if (type === 'channel') await commitChannel()
      // 'section' is the channels-tool container; 'space' (the org type) falls
      // through to commitEntity with the other directory entities.
      else if (type === 'section') await commitSpace()
      else if (type === 'file') await commitFiles()
      // Explicit rather than a fallthrough: an unrecognised type reaching
      // /api/directory/entities is a 400 at best and a mistyped node at worst.
      else if (type && ENTITY_TYPES.has(type)) await commitEntity()
      else throw new Error(`Cannot create a ${type}`)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to create')
      // Failed commits must be retryable — nothing was created, and the draft is
      // still entirely in local state.
      committedRef.current = false
    } finally {
      setCommitting(false)
    }
  }, [
    ready, committing, spaceId, type, folder,
    commitNote, commitFolder, commitEntity, commitConnector, commitAgent, commitChannel, commitSpace, commitFiles,
  ])

  // Pressing Create on a note or a folder asks WHERE first, in a popup over the
  // draft. The destination used to be a row in the header, which put a filing
  // decision in front of a note nobody had written yet — and every entity type
  // gets its folder from its namespace, so the row was blank space on most of
  // them. Everything else commits straight away (a file carries its own
  // destination inside the upload form).
  const asksWhere = type === 'note' || type === 'folder'
  const requestCommit = useCallback(() => {
    if (!ready || committing) return
    if (asksWhere) setDestOpen(true)
    else void commit()
  }, [ready, committing, asksWhere, commit])

  // The one place type, alias and customType are set — together, so the
  // "a custom type only ever rides a note or a folder" invariant can't drift
  // apart. Shape (note vs folder vs entity) and subject (the type) are separate
  // facts about what is being created, exactly as they are on the stored note.
  const pickType = useCallback((next: DraftType, nextAlias: string | null = null, nextCustom: string | null = null) => {
    // Every type is a state here now, events included: picking one used to jump
    // straight to the Events composer, which threw away the draft you were
    // writing and asked for a schedule before you had a name. An event is a
    // context note first; the composer is where its details are edited after.
    setType(next)
    setAlias(nextAlias)
    setCustomType(nextCustom)
    setTypeMenuOpen(false)
    setConflict(null)
  }, [])

  // A type nobody has named here before. It registers on the space straight
  // away — it is space-level vocabulary, not draft state — but the draft
  // takes it either way: a failed write costs a grey chip, not a note. Exactly
  // the bargain `createTag` above makes.
  const createType = useCallback((raw: string, color: string) => {
    const merged = mergeNodeType([...((currentSpace?.nodeTypes as NodeTypeConfig[] | undefined) ?? []), ...addedTypes], { name: raw, color })
    if (!merged.ok) {
      setError(merged.error)
      return
    }
    // The name turned out to be a built-in, or a synonym of one ("Company" is
    // Space). That's a pick, not a create — and it isn't note vocabulary.
    const builtIn = DRAFT_TYPES.find((o) => o.configName === merged.type.name)
    if (builtIn) {
      pickType(builtIn.id)
      return
    }
    if (merged.created) setAddedTypes((prev) => [...prev, merged.type])
    // A custom type is what the thing is ABOUT, so it doesn't decide the shape:
    // a folder being drafted stays a folder and carries the type on its index.
    pickType(type === 'folder' ? 'folder' : 'note', null, merged.type.name)
    if (!spaceId || !merged.created) return
    void fetch(`/api/communities/${encodeURIComponent(spaceId)}/node-types`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name: merged.type.name, color: merged.type.color }),
    }).catch(() => {})
  }, [spaceId, currentSpace?.nodeTypes, addedTypes, pickType, type])

  const typeRow = (
    <TypeMenu
      open={typeMenuOpen}
      onOpenChange={setTypeMenuOpen}
      options={availableTypes}
      customTypes={customTypes}
      type={type}
      alias={alias}
      customType={customType}
      theme={theme}
      onPick={pickType}
      onCreate={canCreateType('context', { featureConfig, isAdmin }) ? createType : null}
      aliases={currentSpace?.aliases}
      spaceNodeTypes={currentSpace?.nodeTypes as NodeTypeConfig[] | undefined}
    />
  )

  // The draft's one explicit affordance, sitting in the editor toolbar's trail
  // slot — the spot a saved note gives Share. Commit also fires on Enter in the
  // title; this is what makes the surface legible the first time.
  const createButton = (
    <button
      type="button"
      disabled={!ready || committing}
      onClick={requestCommit}
      title={
        ready
          ? 'Create'
          : type === null
            ? 'Pick a type first'
            : type === 'file'
              ? 'Add a file first'
              : 'Give it a name first'
      }
      className="flex shrink-0 items-center gap-1.5 rounded-lg px-2.5 py-1.5 text-xs font-semibold text-white transition disabled:cursor-not-allowed disabled:opacity-40"
      style={{ background: theme.base }}
    >
      {committing ? 'Creating…' : <>Create <CheckIcon className="h-3.5 w-3.5" /></>}
    </button>
  )

  // Tags on the draft are plain local state — they ride the create request (in
  // the note's frontmatter, or the entity payload) rather than being saved one
  // at a time the way the committed entity's row does it.
  const tagsLower = new Set(tags.map((t) => t.toLowerCase()))
  const tagColors = { ...(currentSpace?.designConfig?.tagColors ?? {}), ...tagColorOverride }
  const tagsRow = (
    <div className="flex flex-wrap items-center gap-1.5">
      {tags.map((tag) => (
        <Chip
          key={tag}
          size="lg"
          color={tagPalette(tag, tagColors).base}
          onRemove={() => removeTag(tag)}
          removeLabel={`Remove ${tag}`}
        >
          {tag}
        </Chip>
      ))}
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
          className={chipClass({ tone: 'dashed', size: 'lg', className: CHIP_ACCENT_HOVER })}
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
      <div className="relative">
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
              requestCommit()
            }
            // Escape answers the suggestion popover without touching the title.
            if (e.key === 'Escape' && showMatches) {
              e.preventDefault()
              setDismissedMatches(true)
            }
          }}
          placeholder="Untitled"
          aria-label="Title"
          className="w-full bg-transparent font-open-sauce text-[2.5rem] font-semibold leading-[1.25] tracking-[-0.02em] text-text-primary placeholder:text-text-muted/50 focus:outline-none"
        />

        {/* Matches hang off the title as a suggestion popover, the way any
            autocomplete does — the question "is this already here?" is about the
            name you are typing, so the rows answer it on their own. No heading,
            no empty line: it only exists when there is something to show. */}
        {showMatches && (
          <div className="absolute left-0 right-0 top-full z-30 mt-2 overflow-hidden rounded-xl border border-border-subtle bg-surface-1 p-1.5 shadow-float">
            <MatchPanel results={matches} loading={matchesLoading} onSelect={handlePickMatch} />
          </div>
        )}
      </div>

      {/* A space record IS a space (docs/sub-spaces.md): linked to one picked
          above, or made inside this one on save. Said once, here, so the
          save is no surprise. */}
      {type === 'space' && currentSpace && (
        <p className="mb-3 text-xs text-text-muted">
          {pickedSpace && pickedSpace.name.trim() === title.trim()
            ? `Links to the space “${pickedSpace.name}”.`
            : `Creates a space inside ${currentSpace.name}, visible to its members.`}
        </p>
      )}

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

      {/* Per-type extras: ONLY what can't be set afterwards on the thing itself,
          or what its create endpoint refuses to go without. Everything else
          (a channel's icon, a space's location…) is one click away on the
          page you land on. */}
      {type === 'file' && (
        <div className="mt-4">
          <FileForm
            data={{ files, folder }}
            onChange={(d: FileFormData) => { setFiles(d.files); setFolder(d.folder) }}
            folders={contextFolderTree.folders}
            contextName={currentSpace?.name ?? 'Context'}
            loading={contextFolderTree.loading}
          />
        </div>
      )}

      {/* A connector and an agent have no extras: each is a note, and every
          setting in it is editable on the note the moment it exists. All the
          draft owes them is where the note will land. */}
      {type === 'connector' && connectorSlug(title) && (
        <div className="mt-4">
          <PathPreview path={`connectors/${connectorSlug(title)}.md`} />
        </div>
      )}

      {type === 'agent' && agentSlug(title) && (
        <div className="mt-4">
          <PathPreview path={agentBriefPath(agentSlug(title), agentFolder)} />
        </div>
      )}

      {type === 'channel' && (
        <ChannelExtras extras={extras} onChange={setExtras} sections={sections} accent={theme.base} />
      )}

      {conflict && (
        <div className="mt-4 flex flex-wrap items-center gap-3 border-l-2 border-amber-500 pl-3 py-1 text-sm text-amber-800">
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
            Open it <ArrowRightIcon className="h-3 w-3" />
          </button>
        </div>
      )}

      {error && (
        <div className="mt-4 flex items-center justify-between border-l-2 border-red-500 pl-3 py-1 text-sm text-red-700">
          <span>{error}</span>
          <button onClick={() => setError(null)} className="ml-2 text-red-400 hover:text-red-600">✕</button>
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

      {/* Where it goes — asked at the moment of creating, not while the note
          is still being written. The gesture IS the filing: drag the draft onto
          a folder and the drop creates it there. Clicking a row does the same,
          so this works from the keyboard and on touch. */}
      <Modal
        open={destOpen}
        onClose={() => setDestOpen(false)}
        size="sm"
        title={type === 'folder' ? 'Drop it in a folder' : 'Drop the note in a folder'}
        footer={
          <div className="flex justify-end">
            <button
              type="button"
              onClick={() => setDestOpen(false)}
              className="rounded-lg px-3 py-1.5 text-sm font-medium text-text-secondary transition hover:bg-surface-2"
            >
              Cancel
            </button>
          </div>
        }
      >
        <FolderDropBoard
          folders={contextFolderTree.folders}
          contextName={currentSpace?.name ?? 'Context'}
          cardLabel={title.trim() || 'Untitled'}
          accent={theme.base}
          busy={committing}
          loading={contextFolderTree.loading}
          pathFor={pathIn}
          onPick={(dest) => {
            // Remember it (the stash survives a reload) and create in the same
            // tick — commit takes the destination rather than reading state.
            setFolder(dest)
            setDestOpen(false)
            void commit(dest)
          }}
        />
      </Modal>
    </div>
  )
}

// ─── Type menu ───────────────────────────────────────────────────────────────

/** One keyboard-selectable line in the menu. */
type TypeRow =
  | { kind: 'type'; key: string; option: DraftTypeOption; color: string; aliases: SpaceAlias[] }
  | { kind: 'alias'; key: string; option: DraftTypeOption; alias: SpaceAlias }
  | { kind: 'custom'; key: string; config: NodeTypeConfig }
  | { kind: 'create'; key: string; name: string }

/** The text a row is matched on. */
function rowLabel(row: TypeRow): string {
  if (row.kind === 'type') return row.option.label
  if (row.kind === 'alias') return row.alias.name
  if (row.kind === 'custom') return row.config.name
  return row.name
}

function TypeMenu({
  open,
  onOpenChange,
  options: typeOptions,
  customTypes,
  type,
  alias,
  customType,
  theme,
  onPick,
  onCreate,
  aliases,
  spaceNodeTypes,
}: {
  open: boolean
  onOpenChange: (open: boolean) => void
  options: DraftTypeOption[]
  /** The space's own note vocabulary — types nobody wrote code for. */
  customTypes: NodeTypeConfig[]
  type: DraftType | null
  alias: string | null
  customType: string | null
  theme: { base: string; dark: string }
  onPick: (type: DraftType, alias?: string | null, customType?: string | null) => void
  /** Null when this person may not write notes here, which is the same gate. */
  onCreate: ((name: string, color: string) => void) | null
  aliases: SpaceAlias[] | undefined
  spaceNodeTypes: NodeTypeConfig[] | undefined
}) {
  const wrapperRef = useRef<HTMLDivElement>(null)
  const inputRef = useRef<HTMLInputElement>(null)
  // Which type's aliases are unfolded. Only one at a time — the menu is a
  // choice, and two open branches read as two competing lists.
  const [expanded, setExpanded] = useState<DraftType | null>(null)
  const [draft, setDraft] = useState('')
  const [highlight, setHighlight] = useState(0)
  // Ignore the blur that immediately follows a mousedown-driven selection.
  const selecting = useRef(false)

  useEffect(() => {
    if (open) inputRef.current?.focus()
    else { setExpanded(null); setDraft(''); setHighlight(0) }
  }, [open])

  useEffect(() => {
    if (!open) return
    const handler = (e: MouseEvent) => {
      if (wrapperRef.current && !wrapperRef.current.contains(e.target as Node)) onOpenChange(false)
    }
    document.addEventListener('mousedown', handler)
    return () => document.removeEventListener('mousedown', handler)
  }, [open, onOpenChange])

  const trimmed = draft.trim()
  const query = trimmed.toLowerCase()

  const rows = useMemo<TypeRow[]>(() => {
    const aliasesOf = (o: DraftTypeOption) =>
      o.configName ? aliasesForType(aliases, o.configName) : []
    // findNodeTypeConfig, not getTypeColor: a name the registry doesn't know
    // (Note in a space that never wrote one) must fall back to the option's
    // own colour, where getTypeColor would answer with its unknown-type grey.
    const colorOf = (o: DraftTypeOption) =>
      (o.configName ? findNodeTypeConfig(o.configName, spaceNodeTypes)?.color : null) ?? o.color

    // Unfiltered: the built-ins in the console's order, their aliases folded
    // away behind a caret, then the space's own note vocabulary.
    if (!query) {
      const out: TypeRow[] = []
      for (const option of typeOptions) {
        const aliases = aliasesOf(option)
        out.push({ kind: 'type', key: option.id, option, color: colorOf(option), aliases })
        if (expanded === option.id) {
          for (const a of aliases) out.push({ kind: 'alias', key: `${option.id}:${a.name}`, option, alias: a })
        }
      }
      for (const config of customTypes) out.push({ kind: 'custom', key: `custom:${config.name}`, config })
      return out
    }

    // Filtered: one flat, scored list. Aliases come out from behind their caret
    // — the whole point of typing "investor" is not to have to know it lives
    // under Person first.
    const scored: Array<{ row: TypeRow; score: number }> = []
    for (const option of typeOptions) {
      const score = scoreText(option.label, query)
      if (score > 0) scored.push({ row: { kind: 'type', key: option.id, option, color: colorOf(option), aliases: [] }, score })
      for (const a of aliasesOf(option)) {
        const aliasScore = scoreText(a.name, query)
        if (aliasScore > 0) scored.push({ row: { kind: 'alias', key: `${option.id}:${a.name}`, option, alias: a }, score: aliasScore })
      }
    }
    for (const config of customTypes) {
      const score = scoreText(config.name, query)
      if (score > 0) scored.push({ row: { kind: 'custom', key: `custom:${config.name}`, config }, score })
    }
    scored.sort((a, b) => b.score - a.score)
    const out = scored.map((s) => s.row)

    // Nothing already means this, and it's a name a space may have: offer
    // to make it. Only notes can wear a type nobody wrote code for, so this is
    // gated on the note permission and commits down the note path.
    const exact = out.some((row) => rowLabel(row).toLowerCase() === query)
    if (onCreate && !exact && !isReservedTypeName(trimmed)) {
      out.push({ kind: 'create', key: `create:${trimmed}`, name: trimmed })
    }
    return out
  }, [query, trimmed, typeOptions, customTypes, expanded, aliases, spaceNodeTypes, onCreate])

  const active = Math.min(highlight, rows.length - 1)
  const createRow = rows.find((r) => r.kind === 'create')

  const commit = (row: TypeRow | undefined) => {
    if (!row) return
    if (row.kind === 'type') onPick(row.option.id, null, null)
    else if (row.kind === 'alias') onPick(row.option.id, row.alias.name, null)
    else if (row.kind === 'custom') onPick('note', null, row.config.name)
    else onCreate?.(row.name, defaultNodeTypeColor(row.name))
  }

  const label = alias ?? customType ?? (type ? typeOptions.find((t) => t.id === type)?.label ?? type : null)

  return (
    <div ref={wrapperRef} className="relative inline-block">
      <button
        type="button"
        onClick={() => onOpenChange(!open)}
        className={
          label
            ? chipClass({ tone: 'solid', size: 'lg', color: theme.base, interactive: true })
            : chipClass({ tone: 'dashed', size: 'lg', className: CHIP_ACCENT_HOVER })
        }
        style={label ? { background: theme.base } : { ['--accent' as string]: theme.dark }}
      >
        {label ?? 'Pick a type'}
        <ChevronRightIcon className={`h-3 w-3 opacity-70 transition-transform duration-200 ${open ? 'rotate-90' : ''}`} />
      </button>

      {open && (
        /* One list of types. Unfiltered, a type that has space aliases
           (Founder, Investor…) carries a disclosure caret: press the row to
           take the plain type, press the caret to unfold its aliases and take
           one of those instead. Type anything and the whole vocabulary —
           aliases included — flattens into one ranked list, because the old
           flat "More specific" section could only ever show the ALREADY-picked
           type's aliases: you had to choose twice to find out what was on
           offer. */
        <div className="absolute left-0 top-full z-50 mt-1.5 w-64 overflow-hidden rounded-lg border border-border-default bg-surface-1 shadow-float">
          <div className="border-b border-border-subtle p-1.5">
            <input
              ref={inputRef}
              value={draft}
              onChange={(e) => { setDraft(e.target.value); setHighlight(0) }}
              onMouseDown={() => { selecting.current = false }}
              onBlur={() => { if (!selecting.current) onOpenChange(false) }}
              onKeyDown={(e) => {
                if (e.key === 'ArrowDown') { e.preventDefault(); setHighlight((h) => Math.min(h + 1, rows.length - 1)) }
                else if (e.key === 'ArrowUp') { e.preventDefault(); setHighlight((h) => Math.max(h - 1, 0)) }
                else if (e.key === 'Enter') { e.preventDefault(); commit(rows[active]) }
                else if (e.key === 'Escape') { e.preventDefault(); onOpenChange(false) }
              }}
              placeholder={onCreate ? 'Search or create a type…' : 'Search types…'}
              maxLength={32}
              className="h-[30px] w-full rounded-md border border-border-default bg-surface-1 px-2.5 text-[13px] text-text-primary outline-none focus:border-[color:var(--accent)]"
              style={{ ['--accent' as string]: theme.dark }}
            />
          </div>

          {/* Six-odd rows tall, then it scrolls. The vocabulary grows with the
              space, so a list sized to fit it ran most of the viewport and
              buried the surface it was opened over — a short window you scroll
              is the readable shape at any length. */}
          <div className="max-h-56 overflow-y-auto py-1" role="listbox">
            {rows.length === 0 && (
              <p className="px-3 py-2 text-[12px] text-text-muted">No type by that name.</p>
            )}

            {rows.map((row, i) => {
              const isActive = i === active
              const hover = isActive ? 'bg-surface-2' : ''

              if (row.kind === 'create') {
                return (
                  <button
                    key={row.key}
                    type="button"
                    role="option"
                    aria-selected={isActive}
                    onMouseDown={() => { selecting.current = true }}
                    onMouseEnter={() => setHighlight(i)}
                    onClick={() => commit(row)}
                    className={`flex w-full items-center gap-2 py-2 pl-8 pr-3 text-left transition hover:bg-surface-2 ${hover}`}
                  >
                    <span className="text-text-muted">+</span>
                    <span className="min-w-0 flex-1 truncate text-[13px] text-text-secondary">
                      Create type <span className="font-medium text-text-primary">“{row.name}”</span>
                    </span>
                    <span
                      className="h-3.5 w-3.5 shrink-0 rounded"
                      style={{ background: defaultNodeTypeColor(row.name) }}
                    />
                  </button>
                )
              }

              if (row.kind === 'custom') {
                const picked = customType?.toLowerCase() === row.config.name.toLowerCase()
                return (
                  <button
                    key={row.key}
                    type="button"
                    role="option"
                    aria-selected={isActive}
                    onMouseDown={() => { selecting.current = true }}
                    onMouseEnter={() => setHighlight(i)}
                    onClick={() => commit(row)}
                    className={`flex w-full items-center gap-2.5 py-1.5 pl-8 pr-3 text-left transition hover:bg-surface-2 ${hover}`}
                  >
                    <span className="min-w-0 flex-1 truncate text-[13px] font-medium text-text-primary">
                      {row.config.name}
                    </span>
                    {picked && <CheckIcon className="h-3.5 w-3.5 shrink-0 text-text-muted" />}
                    <span className="h-3.5 w-3.5 shrink-0 rounded" style={{ background: row.config.color }} />
                  </button>
                )
              }

              if (row.kind === 'alias') {
                const picked = type === row.option.id && alias === row.alias.name
                return (
                  <button
                    key={row.key}
                    type="button"
                    role="option"
                    aria-selected={isActive}
                    onMouseDown={() => { selecting.current = true }}
                    onMouseEnter={() => setHighlight(i)}
                    onClick={() => commit(row)}
                    className={`flex w-full items-center gap-2.5 py-1.5 pl-8 pr-3 text-left transition hover:bg-surface-2 ${hover}`}
                  >
                    <span className="min-w-0 flex-1 truncate text-[13px] text-text-primary">
                      {row.alias.name}
                      {/* Which type it narrows only matters once the list is
                          flat — unfolded under its own caret it's obvious. */}
                      {query && <span className="text-text-muted"> · {row.option.label}</span>}
                    </span>
                    {picked && <CheckIcon className="h-3.5 w-3.5 shrink-0 text-text-muted" />}
                    <span className="h-3 w-3 shrink-0 rounded" style={{ background: row.alias.color }} />
                  </button>
                )
              }

              const picked = type === row.option.id && !alias && !customType
              const isOpen = expanded === row.option.id
              return (
                <div key={row.key} className={`flex items-stretch transition hover:bg-surface-2 ${hover}`}>
                  {/* Disclosure leads the row; the colour dot closes it. The
                      w-7 spacer keeps the labels of alias-less types (Note) on
                      the same left edge as the ones with a caret. */}
                  {row.aliases.length > 0 ? (
                    <button
                      type="button"
                      onMouseDown={() => { selecting.current = true }}
                      onClick={() => { setExpanded(isOpen ? null : row.option.id); inputRef.current?.focus() }}
                      aria-expanded={isOpen}
                      aria-label={`More specific than ${row.option.label}`}
                      className="flex w-7 shrink-0 items-center justify-center text-text-muted transition hover:text-text-primary"
                    >
                      <ChevronRightIcon className={`h-3.5 w-3.5 transition-transform duration-200 ${isOpen ? 'rotate-90' : ''}`} />
                    </button>
                  ) : (
                    <span className="w-7 shrink-0" aria-hidden />
                  )}
                  <button
                    type="button"
                    role="option"
                    aria-selected={isActive}
                    onMouseDown={() => { selecting.current = true }}
                    onMouseEnter={() => setHighlight(i)}
                    onClick={() => commit(row)}
                    className="flex min-w-0 flex-1 items-center gap-2.5 py-1.5 pl-1 pr-3 text-left"
                  >
                    {/* Name and colour only. The one-line descriptions under
                        each type doubled the row height — and a list of them is
                        a paragraph to read where the names alone are a menu to
                        scan. */}
                    <span className="min-w-0 flex-1 truncate text-[13px] font-medium text-text-primary">
                      {row.option.label}
                    </span>
                    {picked && <CheckIcon className="h-3.5 w-3.5 shrink-0 text-text-muted" />}
                    {/* The same rounded square the console's Types tab paints —
                        a type looks the same wherever you meet it. */}
                    <span className="h-3.5 w-3.5 shrink-0 rounded" style={{ background: row.color }} />
                  </button>
                </div>
              )
            })}
          </div>

          {/* A colour for the type being invented. Enter takes the deterministic
              default, so the strip is an option rather than a step. */}
          {createRow && createRow.kind === 'create' && (
            <div className="border-t border-border-subtle px-3 py-2">
              <div className="mb-1.5 text-[11px] font-medium text-text-muted">Pick a colour</div>
              <div className="flex flex-wrap gap-1.5">
                {TAG_SWATCHES.map((color) => (
                  <button
                    key={color}
                    type="button"
                    aria-label={`Create “${createRow.name}” in this colour`}
                    onMouseDown={() => { selecting.current = true }}
                    onClick={() => onCreate?.(createRow.name, color)}
                    className="h-5 w-5 rounded-full border border-black/10 transition hover:scale-110"
                    style={{ background: color }}
                  />
                ))}
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  )
}

// ─── Per-type extras ─────────────────────────────────────────────────────────
// Deliberately small. The draft surface's whole argument is that creating is
// choosing what a thing is and naming it — anything editable on the thing's own
// page afterwards does NOT belong here. What's left is a channel's view style
// and section: a channel is a conversation row, not a note, so there is nowhere
// else to say them.

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

function ChannelExtras({
  extras,
  onChange,
  sections,
  accent,
}: {
  extras: Extras
  onChange: (next: Extras) => void
  sections: ChannelSectionEntry[]
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
            { value: 'CHAT', label: 'Chat' },
            { value: 'FEED', label: 'Feed' },
          ] as const}
        />
      </ExtraField>
      {sections.length > 0 && (
        <ExtraField label="Section">
          <select
            className={extraInput}
            style={{ ['--accent' as string]: accent }}
            value={extras.sectionId}
            onChange={(e) => onChange({ ...extras, sectionId: e.target.value })}
          >
            <option value="">No section</option>
            {sections.map((section) => (
              <option key={section.id} value={section.id}>
                {section.name}
              </option>
            ))}
          </select>
        </ExtraField>
      )}
    </div>
  )
}

