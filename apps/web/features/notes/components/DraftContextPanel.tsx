'use client'

// The create surface: an empty context note you fill in. Everything a person
// can make in a space that does not already own a surface of its own lands
// here — a note, a folder (its index note), an agent (its brief), a person, a
// space record, a resource, a channel, a section, a Tool, an upload. The
// Create panel beside the rail chooses the kind and nothing else
// (lib/create/rows.ts): a rail-width column is the wrong shape for writing
// anything, and for most of these the note IS the thing.
//
// The shape of this page is the same for every kind. The title names it, the
// type chip says what it is, the tags label it, the editor below is the prose
// its note opens with — and under the title sits whatever that particular
// kind needs beyond prose (features/create/components/draft): a person's
// email and photo, a channel's icon, the files being uploaded. A kind surface
// registers the write; this page owns the button, the errors and the landing.
// The three kinds with nothing to write in front of them (a section, a Tool
// scaffold, an upload) hide the editor rather than pretend otherwise.
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
import { CheckIcon, ChevronRightIcon, XIcon } from '@/features/shared/icons';
import { CHIP_ACCENT_HOVER, Chip, chipClass, Modal } from '@/components/ui'
import { useSpace } from '@/features/shared/contexts/SpaceContext'
import { canCreateType } from '@/lib/create/creatable'
import {
  draftHasProse,
  draftTypeOptions,
  draftUsesTags,
  isDraftKind,
  spaceNoteTypes,
  type DraftKind,
  type DraftTypeOption,
} from '@/lib/create/rows'
import {
  defaultNodeTypeColor,
  findNodeTypeConfig,
  isReservedTypeName,
  mergeNodeType,
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
import { noteHref } from '@/lib/notes/entities'
import { useContextFolderTree, FolderDropBoard, PathPreview } from '@/features/create/components/ContextDestination'
import type { DraftShared } from '@/features/create/components/draft/shared'
import EntitySetup from '@/features/create/components/draft/EntitySetup'
import ChannelSetup from '@/features/create/components/draft/ChannelSetup'
import SectionSetup from '@/features/create/components/draft/SectionSetup'
import ToolSetup from '@/features/create/components/draft/ToolSetup'
import FileSetup from '@/features/create/components/draft/FileSetup'
import { agentSlug } from '@/lib/create/noteSlug'
import { agentBriefPath, newAgentNote } from '@/lib/agents/config'
import type { BriefSettings } from '@/lib/agents/briefEdit'
import { agentTemplateById, type AgentTemplate } from '@/lib/agents/templates'
import AgentDraftSetup from '@/features/agents/components/AgentDraftSetup'
import { TAG_SWATCHES, tagKey, tagPalette } from '@/lib/tagColors'
import { scoreText } from '@/lib/fuzzy'
import { clearContextCache } from '@/features/notes/hooks/useSpaceContextData'
import { notesApi } from '../lib/notesApi'
import { contextKeys, invalidateContextCache, primeContextCache } from '../lib/contextPrefetch'
import { useDirectoryEntities } from '../lib/useDirectoryEntities'
import { NoteEditor } from './NoteEditor'
import { PropertyRows } from './PropertyRows'
import { TagCombobox } from './TagCombobox'
import { type NoteMode } from './NoteModeToggle'
import '../notes.css'

/** The shapes this surface commits, named as the flow table names them. */
export type DraftType = DraftKind

/**
 * The three this page writes itself — a note, the index note that IS a folder,
 * an agent's brief. Every other kind hands it a write to run instead.
 */
const WRITTEN_HERE: ReadonlySet<DraftKind> = new Set<DraftKind>(['note', 'folder', 'agent'])

/** An upload is bytes, and its name is the file's — there is no title to give. */
const WITHOUT_TITLE: ReadonlySet<DraftKind> = new Set<DraftKind>(['file'])

/** What the title row asks for, for a kind that does not call it a title. */
const TITLE_PLACEHOLDER: Partial<Record<DraftKind, string>> = {
  person: 'Full name',
  space: 'Name',
  resource: 'Name',
  channel: 'Channel name',
  section: 'Section name',
  tool: 'Tool name',
  folder: 'Folder name',
  agent: 'Agent name',
}

const NOTE_COLOR = '#64748b'

interface DraftContextPanelProps {
  mode?: NoteMode
  /** Folder to pre-select when "+" was pressed from inside the context tree. */
  initialFolder?: string
  /** Shape to pre-select — what the Create panel chose. */
  initialType?: DraftType | null
  /** One of the space's own note types to pre-select, by its registered name. */
  initialCustomType?: string | null
  /** That type does not exist yet: register it on the space on the way in. */
  initialTypeIsNew?: boolean
  /** An alias picked off the kind's tree in the Create panel. */
  initialAlias?: string | null
  /** A starter brief (lib/agents/templates.ts) to seed an agent draft with. */
  initialAgentTemplate?: string | null
}

// The buffer survives an accidental back-navigation. Nothing is persisted by
// design, so without this a stray swipe loses everything typed — and the user
// has no reason to expect a "draft" to be that fragile.
const STASH_KEY = 'visvine:draft-context'

interface Stash {
  title: string
  type: DraftType | null
  customType: string | null
  body: string
  folder: string
  tags: string[]
  extras: Extras
}

/**
 * What an agent brief is scaffolded with beyond its body: the tools a starter
 * brief declared and its one-line description. Not a control on this surface
 * — every one of them is edited under Settings on the agent's own page.
 */
interface Extras {
  agent: BriefSettings
  /** The starter brief the body came from, until it is edited. */
  agentTemplate: string | null
}

const EMPTY_EXTRAS: Extras = {
  // No model: a new agent runs on the space's (lib/agents/spaceModels.ts).
  agent: { model: '', description: '', connectors: [], tools: [], dryRun: false, maxTurns: null, tags: [], share: 'none', shareAs: 'use' },
  agentTemplate: null,
}

/**
 * The draft stashed by an earlier visit — unless this visit asked for a type
 * explicitly. "New agent" must open an agent, not whatever was abandoned last
 * week; a stash of the SAME type is still recovered, so a reload mid-brief
 * costs nothing. A visit that names a type nobody has used yet is as explicit
 * an ask as it gets, so it keeps nothing.
 */
function readStash(initialType: DraftType | null, typeIsNew: boolean): Partial<Stash> {
  if (typeof sessionStorage === 'undefined') return {}
  try {
    const stash = JSON.parse(sessionStorage.getItem(STASH_KEY) ?? '{}') as Partial<Stash>
    // A stash from before the surface changed shape may name one it no longer has.
    if (stash.type && !isDraftKind(stash.type)) {
      sessionStorage.removeItem(STASH_KEY)
      return {}
    }
    if (typeIsNew && stash.type) {
      sessionStorage.removeItem(STASH_KEY)
      return {}
    }
    if (initialType && stash.type && stash.type !== initialType) {
      sessionStorage.removeItem(STASH_KEY)
      return {}
    }
    return stash
  } catch {
    return {}
  }
}

export function DraftContextPanel({
  mode = 'wysiwyg',
  initialFolder = '',
  initialType: initialBuiltIn = null,
  initialCustomType = null,
  initialTypeIsNew = false,
  initialAlias = null,
  initialAgentTemplate = null,
}: DraftContextPanelProps) {
  // A custom type is a narrowing of 'note' (see customType below), so asking
  // for one is asking for a note.
  const initialType: DraftType | null = initialBuiltIn ?? (initialCustomType ? 'note' : null)
  const router = useRouter()
  const { currentSpace, isAdmin } = useSpace()
  const spaceId = currentSpace?.id ?? null
  const { entities, entityByPath, allTags } = useDirectoryEntities()

  const stash = useRef<Partial<Stash>>(readStash(initialType, initialTypeIsNew)).current

  const [title, setTitle] = useState(stash.title ?? '')
  const [type, setType] = useState<DraftType | null>(stash.type ?? initialType)
  // A type this space invented rather than one of the built-ins. It is a
  // NARROWING of 'note' (or 'folder'), never a shape of its own: what it
  // creates is a context note wearing that name in its frontmatter, so every
  // rule about notes — the folder picker, the path preview, the commit path —
  // still applies. `pickType` is the only place that sets either.
  const [customType, setCustomType] = useState<string | null>(stash.customType ?? initialCustomType)
  const [folder, setFolder] = useState(stash.folder ?? initialFolder)
  // The destination popup, opened by Create on a note or a folder.
  const [destOpen, setDestOpen] = useState(false)
  const [tags, setTags] = useState<string[]>(stash.tags ?? [])
  const [extras, setExtras] = useState<Extras>({ ...EMPTY_EXTRAS, ...(stash.extras ?? {}), agent: { ...EMPTY_EXTRAS.agent, ...(stash.extras?.agent ?? {}) } })
  // Bumped when something outside the editor replaces the body (a starter
  // brief): the editor owns its buffer and only reads initialContent on mount.
  const [editorKey, setEditorKey] = useState(0)
  const [addingTag, setAddingTag] = useState(false)
  const [tagColorOverride, setTagColorOverride] = useState<Record<string, string>>({})
  const [typeMenuOpen, setTypeMenuOpen] = useState(false)
  // A type created in this session, held locally until refreshSpace lands —
  // the same bargain createTag makes, so the menu doesn't blink the type away
  // the moment you pick it.
  //
  // The Create panel's "New type" row arrives as `?type=<name>&new=1`, and its
  // type is seeded here on the FIRST render rather than registered from an
  // effect: `customType` is already set to that name, and the guard below that
  // drops a custom type the space does not know would otherwise clear it
  // before any effect could put it back.
  const [addedTypes, setAddedTypes] = useState<NodeTypeConfig[]>(() => {
    if (!initialTypeIsNew || !initialCustomType) return []
    const merged = mergeNodeType(null, { name: initialCustomType })
    return merged.ok && merged.created ? [merged.type] : []
  })
  const [committing, setCommitting] = useState(false)
  const [error, setError] = useState<string | null>(null)

  // Whether the kind's own fields are filled in, and the write they hand back.
  // The write lives in a ref rather than in state: it is re-registered on every
  // keystroke of the kind's surface, and nothing here renders from it.
  const [kindReady, setKindReady] = useState(false)
  const kindCommit = useRef<(() => Promise<string>) | null>(null)
  const registerCommit = useCallback((fn: () => Promise<string>) => { kindCommit.current = fn }, [])
  const onKindReady = useCallback((ready: boolean) => setKindReady(ready), [])

  // The editor body lives in a ref, not state: it changes on every keystroke and
  // nothing above it renders from it, so state here would re-render the whole
  // surface (the editor included) on every character.
  const bodyRef = useRef(stash.body ?? '')
  // Guards against a double commit — blur and Enter can both fire for one action.
  const committedRef = useRef(false)
  const titleRef = useRef<HTMLInputElement>(null)

  // Only a note and a folder are filed by hand here. An agent's folder is its
  // namespace, an upload picks its own, and the rest do not land in the tree.
  const contextFolderTree = useContextFolderTree(spaceId, type === 'note' || type === 'folder')

  useEffect(() => {
    titleRef.current?.focus()
  }, [])

  // Stash on every change so a back-navigation is recoverable. Cleared on a
  // successful commit (the real note is the record from then on).
  useEffect(() => {
    if (typeof sessionStorage === 'undefined') return
    const payload: Stash = { title, type, customType, body: bodyRef.current, folder, tags, extras }
    sessionStorage.setItem(STASH_KEY, JSON.stringify(payload))
  }, [title, type, customType, folder, tags, extras])

  const slug = noteFileSlug(title)
  // A punctuation-only title is a non-empty string that slugs to nothing. The
  // SLUG is the readiness test, not the text.
  const titleUsable = slug !== 'untitled' || title.trim().toLowerCase() === 'untitled'

  // An agent is named by a slug rather than a file name, so its has to survive
  // slugging too.
  const nameReady =
    type === null
      ? false
      : WITHOUT_TITLE.has(type)
        ? true
        : type === 'agent'
          ? titleUsable && !!agentSlug(title)
          : // A kind whose fields are its own asks only that it be named; the
            // slug rules above are about landing a note at a path.
            WRITTEN_HERE.has(type)
            ? titleUsable
            : title.trim().length > 0
  const ready = type !== null && nameReady && (WRITTEN_HERE.has(type) ? true : kindReady)

  // The types this space invented — anything in its nodeTypes that isn't a
  // built-in (or a synonym of one), plus whatever was created in this session.
  // These are the note vocabulary: they label a context note and nothing more,
  // so they're offered as narrowings of Note rather than as shapes of their own.
  const customTypes = useMemo(() => {
    const stored = spaceNoteTypes(currentSpace?.nodeTypes as NodeTypeConfig[] | undefined)
    const byLower = new Map<string, NodeTypeConfig>()
    for (const t of [...stored, ...addedTypes]) {
      const name = t.name?.trim()
      // A reserved name can be STORED (the seed's node types include Note), but
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

  // Only the shapes this person may make here — the same table and the same
  // permission filter the Create panel's list runs (lib/create/rows.ts), so
  // the panel can never offer a kind this menu withholds, or the reverse.
  const featureConfig = (currentSpace?.featureConfig as SpaceFeatureConfig | undefined) ?? null
  const availableTypes = useMemo(
    () => draftTypeOptions({ featureConfig, isAdmin, spaceNodeTypes: currentSpace?.nodeTypes as NodeTypeConfig[] | undefined }),
    [featureConfig, isAdmin, currentSpace?.nodeTypes],
  )

  const typeOption = type ? availableTypes.find((t) => t.id === type) ?? null : null
  const baseColor = customType
    ? customConfig?.color ?? defaultNodeTypeColor(customType)
    : typeOption?.color ?? NOTE_COLOR
  const theme = hexToPalette(baseColor)

  // Existing folder paths, for the folder destination's collision suffixing.
  const folderPaths = useMemo(
    () => new Set(contextFolderTree.folders.map((f) => f.path).filter(Boolean)),
    [contextFolderTree.folders],
  )

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
    void fetch(`/api/spaces/${encodeURIComponent(spaceId)}/tag-colors`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ tag, color }),
    }).catch(() => {})
    addTag(tag)
  }, [spaceId, addTag])

  const removeTag = useCallback((tag: string) => {
    setTags((prev) => prev.filter((t) => t !== tag))
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

  // A folder IS its index note: this creates the folder and writes the note
  // that names it, in one call. `dest` is the PARENT it was dropped into.
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

  // An agent is a folder under `agents/` whose index is the brief: the title
  // names it, the body is the brief. The frontmatter it needs to run — the
  // model, the connectors it may call — is scaffolded at its defaults and
  // edited on the note afterwards; nothing about it is unchangeable, so
  // nothing about it belongs in a form in front of the brief.
  const commitAgent = useCallback(async () => {
    if (!spaceId) return
    const name = agentSlug(title)
    const path = agentBriefPath(name)
    const a = extras.agent
    await notesApi.create(
      spaceId,
      path,
      newAgentNote({
        name,
        title: title.trim(),
        description: a.description,
        model: a.model,
        connectors: a.connectors,
        tools: a.tools,
        body: bodyRef.current.trim(),
      }),
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
  }, [spaceId, title, extras.agent, router])

  // Everything this page does not write itself: the kind's own surface handed
  // back the write when its fields filled in, and it reports where to land.
  const commitKind = useCallback(async () => {
    const run = kindCommit.current
    if (!run) throw new Error('Nothing to create yet')
    const href = await run()
    sessionStorage.removeItem(STASH_KEY)
    router.replace(href)
  }, [router])

  // `dest` is the folder the draft was dropped on, for the two shapes that ask.
  // Defaults to the standing `folder` (the one "+" was pressed in).
  const commit = useCallback(async (dest?: string) => {
    if (!ready || committing || committedRef.current || !spaceId) return
    const where = dest ?? folder
    committedRef.current = true
    setCommitting(true)
    setError(null)
    try {
      if (type === 'note') await commitNote(where)
      else if (type === 'folder') await commitFolder(where)
      else if (type === 'agent') await commitAgent()
      else await commitKind()
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to create')
      // Failed commits must be retryable — nothing was created, and the draft is
      // still entirely in local state.
      committedRef.current = false
    } finally {
      setCommitting(false)
    }
  }, [ready, committing, spaceId, type, folder, commitNote, commitFolder, commitAgent, commitKind])

  // A starter brief fills the draft in one go — title (if none yet), the body,
  // the tools and the roster line — and the editor is remounted to show it.
  // Blank clears only the body; the settings stay as they were.
  const applyAgentTemplate = useCallback((template: AgentTemplate | null) => {
    bodyRef.current = template ? template.body : ''
    setEditorKey((k) => k + 1)
    if (template && !title.trim()) setTitle(template.title)
    setExtras((prev) => ({
      ...prev,
      agentTemplate: template?.id ?? null,
      agent: template ? { ...prev.agent, tools: template.tools, description: template.description } : prev.agent,
    }))
  }, [title])

  // The Create panel's starter pick arrives as `?template=`; it seeds the
  // brief once, on a fresh draft only — a recovered stash keeps what was typed.
  const seededTemplate = useRef(false)
  useEffect(() => {
    if (seededTemplate.current || !initialAgentTemplate || type !== 'agent' || stash.type) return
    seededTemplate.current = true
    const template = agentTemplateById(initialAgentTemplate)
    if (template) applyAgentTemplate(template)
  }, [initialAgentTemplate, type, stash.type, applyAgentTemplate])

  // Pressing Create on a note or a folder asks WHERE first, in a popup over the
  // draft: a filing decision belongs at the moment of creating, not in front of
  // a note nobody has written yet. Everything else commits straight away —
  // an agent's folder is its namespace, an upload picked its own, and the rest
  // do not land in the tree at all.
  const asksWhere = type === 'note' || type === 'folder'
  const requestCommit = useCallback(() => {
    if (!ready || committing) return
    if (asksWhere) setDestOpen(true)
    else void commit()
  }, [ready, committing, asksWhere, commit])

  // The one place type and customType are set — together, so the "a custom
  // type only ever rides a note or a folder" invariant can't drift apart.
  // Shape (note vs person vs channel…) and subject (the type) are separate
  // facts about what is being created, exactly as they are on the stored note.
  const pickType = useCallback((next: DraftType, nextCustom: string | null = null) => {
    // A different kind means a different set of fields, and the write the last
    // one registered is no longer the one to run.
    if (next !== type) {
      kindCommit.current = null
      setKindReady(false)
    }
    setType(next)
    setCustomType(next === 'note' || next === 'folder' ? nextCustom : null)
    setTypeMenuOpen(false)
  }, [type])

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
    // Space). That isn't note vocabulary; it is a shape of its own, and the
    // menu above already lists it.
    if (findNodeTypeConfig(merged.type.name)) {
      setError(`${merged.type.name} is a type of its own — pick it above`)
      return
    }
    if (merged.created) setAddedTypes((prev) => [...prev, merged.type])
    // A custom type is what the thing is ABOUT, so it doesn't decide the shape:
    // a folder being drafted stays a folder and carries the type on its index.
    pickType(type === 'folder' ? 'folder' : 'note', merged.type.name)
    if (!spaceId || !merged.created) return
    void fetch(`/api/spaces/${encodeURIComponent(spaceId)}/node-types`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name: merged.type.name, color: merged.type.color }),
    }).catch(() => {})
  }, [spaceId, currentSpace?.nodeTypes, addedTypes, pickType, type])

  // …and registered on the space once, the way `createType` registers one
  // named in the menu. The name was legal and unused when the row offered it,
  // so this is the same act one step earlier; a failed write costs a grey chip
  // rather than the note.
  const registeredNewType = useRef(false)
  useEffect(() => {
    const seeded = addedTypes[0]
    if (registeredNewType.current || !initialTypeIsNew || !seeded || !spaceId) return
    registeredNewType.current = true
    void fetch(`/api/spaces/${encodeURIComponent(spaceId)}/node-types`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name: seeded.name, color: seeded.color }),
    }).catch(() => {})
  }, [initialTypeIsNew, spaceId, addedTypes])

  const typeRow = (
    <TypeMenu
      open={typeMenuOpen}
      onOpenChange={setTypeMenuOpen}
      options={availableTypes}
      customTypes={customTypes}
      type={type}
      customType={customType}
      theme={theme}
      onPick={pickType}
      onCreate={canCreateType('context', { featureConfig, isAdmin }) ? createType : null}
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
      title={ready ? 'Create' : type === null ? 'Pick a type first' : nameReady ? 'Fill in the rest first' : 'Give it a name first'}
      className="flex shrink-0 items-center gap-1.5 rounded-lg px-2.5 py-1.5 text-xs font-semibold text-white transition disabled:cursor-not-allowed disabled:opacity-40"
      style={{ background: theme.base }}
    >
      {committing ? 'Creating…' : <>Create <CheckIcon className="h-3.5 w-3.5" /></>}
    </button>
  )

  // Tags on the draft are plain local state — they ride the create request in
  // the note's frontmatter rather than being saved one at a time the way a
  // committed note's row does it.
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

  // What this page hands the kind being drafted: the parts every kind shares,
  // and nothing of its own state. A kind surface reads the title rather than
  // owning a name field, so there is one name on the page.
  const shared: DraftShared = useMemo(
    () => ({
      spaceId: spaceId ?? '',
      contextName: currentSpace?.name ?? 'Context',
      title,
      setTitle,
      tags,
      setTags,
      body: () => bodyRef.current,
      folder,
      accent: theme.base,
    }),
    [spaceId, currentSpace?.name, title, tags, folder, theme.base],
  )

  const kindProps = { shared, onReadyChange: onKindReady, registerCommit }
  // Keyed on the kind so switching type starts its fields empty rather than
  // carrying the last kind's half-filled state into them.
  const kindSetup = !spaceId || !type || WRITTEN_HERE.has(type) ? null
    : type === 'person' || type === 'space' || type === 'resource'
      ? <EntitySetup key={type} type={type} initialAlias={initialAlias} {...kindProps} />
      : type === 'channel' ? <ChannelSetup key={type} {...kindProps} />
      : type === 'section' ? <SectionSetup key={type} {...kindProps} />
      : type === 'tool' ? <ToolSetup key={type} {...kindProps} />
      : type === 'file' ? <FileSetup key={type} {...kindProps} />
      : null

  const hidesTitle = type !== null && WITHOUT_TITLE.has(type)
  const hidesProse = type !== null && !draftHasProse(type)

  const headerSlot = (
    <div className="mx-auto mb-1 w-full max-w-[760px] px-7 pt-10">
      {!hidesTitle && (
        <input
          ref={titleRef}
          value={title}
          onChange={(e) => setTitle(e.target.value)}
          onKeyDown={(e) => {
            // Enter and the Create button are the ONLY commit boundaries. Blur is
            // deliberately not one.
            if (e.key === 'Enter') {
              e.preventDefault()
              requestCommit()
            }
          }}
          placeholder={(type && TITLE_PLACEHOLDER[type]) ?? 'Untitled'}
          aria-label="Title"
          className="w-full bg-transparent font-open-sauce text-[2.5rem] font-semibold leading-[1.25] tracking-[-0.02em] text-text-primary placeholder:text-text-muted/50 focus:outline-none"
        />
      )}

      {/* Type and Tags ONLY. `type={null}` withholds the per-type field rows:
          the rows a kind needs are its own surface's, below. */}
      <PropertyRows
        type={null}
        values={{}}
        editable
        accent={theme.dark}
        typeRow={typeRow}
        tagsRow={draftUsesTags(type) ? tagsRow : null}
      />

      {type === 'agent' && (
        <>
          <AgentDraftSetup
            spaceId={spaceId}
            templateId={extras.agentTemplate}
            onApplyTemplate={applyAgentTemplate}
            accent={theme.base}
          />
          {agentSlug(title) && (
            <div className="mt-4">
              <PathPreview path={agentBriefPath(agentSlug(title))} />
            </div>
          )}
        </>
      )}

      {kindSetup}

      {error && (
        <div className="mt-4 flex items-center justify-between border-l-2 border-red-500 pl-3 py-1 text-sm text-red-700">
          <span>{error}</span>
          <button onClick={() => setError(null)} aria-label="Dismiss"
                  className="ml-2 text-red-400 hover:text-red-600">
            <XIcon className="h-3.5 w-3.5" />
          </button>
        </div>
      )}

    </div>
  )

  return (
    <div className="pb-10">
      {hidesProse ? (
        // Nothing to write in front of this one. The editor would be an empty
        // invitation to write a note that is never created, so the page is its
        // header and its own fields, with Create under them.
        <>
          {headerSlot}
          <div className="mx-auto w-full max-w-[760px] px-7 pt-6">{createButton}</div>
        </>
      ) : (
        <NoteEditor
          key={editorKey}
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
      )}

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
  | { kind: 'type'; key: string; option: DraftTypeOption; color: string }
  | { kind: 'custom'; key: string; config: NodeTypeConfig }
  | { kind: 'create'; key: string; name: string }

/** The text a row is matched on. */
function rowLabel(row: TypeRow): string {
  if (row.kind === 'type') return row.option.label
  if (row.kind === 'custom') return row.config.name
  return row.name
}

function TypeMenu({
  open,
  onOpenChange,
  options: typeOptions,
  customTypes,
  type,
  customType,
  theme,
  onPick,
  onCreate,
}: {
  open: boolean
  onOpenChange: (open: boolean) => void
  options: DraftTypeOption[]
  /** The space's own note vocabulary — types nobody wrote code for. */
  customTypes: NodeTypeConfig[]
  type: DraftType | null
  customType: string | null
  theme: { base: string; dark: string }
  onPick: (type: DraftType, customType?: string | null) => void
  /** Null when this person may not write notes here, which is the same gate. */
  onCreate: ((name: string, color: string) => void) | null
}) {
  const wrapperRef = useRef<HTMLDivElement>(null)
  const inputRef = useRef<HTMLInputElement>(null)
  const [draft, setDraft] = useState('')
  const [highlight, setHighlight] = useState(0)
  // Ignore the blur that immediately follows a mousedown-driven selection.
  const selecting = useRef(false)

  useEffect(() => {
    if (open) inputRef.current?.focus()
    else { setDraft(''); setHighlight(0) }
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
    // The colour is the one the flow table resolved against this space's own
    // registry, so a kind looks the same here as it does in the Create panel.
    const colorOf = (o: DraftTypeOption) => o.color

    // Unfiltered: the shapes, then the space's own note vocabulary.
    if (!query) {
      const out: TypeRow[] = typeOptions.map((option) => ({ kind: 'type', key: option.id, option, color: colorOf(option) }))
      for (const config of customTypes) out.push({ kind: 'custom', key: `custom:${config.name}`, config })
      return out
    }

    // Filtered: one flat, scored list.
    const scored: Array<{ row: TypeRow; score: number }> = []
    for (const option of typeOptions) {
      const score = scoreText(option.label, query)
      if (score > 0) scored.push({ row: { kind: 'type', key: option.id, option, color: colorOf(option) }, score })
    }
    for (const config of customTypes) {
      const score = scoreText(config.name, query)
      if (score > 0) scored.push({ row: { kind: 'custom', key: `custom:${config.name}`, config }, score })
    }
    scored.sort((a, b) => b.score - a.score)
    const out = scored.map((s) => s.row)

    // Nothing already means this, and it's a name a space may have: offer
    // to make it. Only notes can wear a type nobody wrote code for, so this is
    // gated on the note permission and narrows a note rather than being a
    // shape of its own.
    const exact = out.some((row) => rowLabel(row).toLowerCase() === query)
    if (onCreate && !exact && !isReservedTypeName(trimmed)) {
      out.push({ kind: 'create', key: `create:${trimmed}`, name: trimmed })
    }
    return out
  }, [query, trimmed, typeOptions, customTypes, onCreate])

  const active = Math.min(highlight, rows.length - 1)
  const createRow = rows.find((r) => r.kind === 'create')

  const commit = (row: TypeRow | undefined) => {
    if (!row) return
    if (row.kind === 'type') onPick(row.option.id, null)
    else if (row.kind === 'custom') onPick(type === 'folder' ? 'folder' : 'note', row.config.name)
    else onCreate?.(row.name, defaultNodeTypeColor(row.name))
  }

  const label = customType ?? (type ? typeOptions.find((t) => t.id === type)?.label ?? type : null)

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
                    className={`flex w-full items-center gap-2 py-2 pl-3 pr-3 text-left transition hover:bg-surface-2 ${hover}`}
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

              const picked =
                row.kind === 'custom'
                  ? customType?.toLowerCase() === row.config.name.toLowerCase()
                  : type === row.option.id && !customType
              const color = row.kind === 'custom' ? row.config.color : row.color
              return (
                <button
                  key={row.key}
                  type="button"
                  role="option"
                  aria-selected={isActive}
                  onMouseDown={() => { selecting.current = true }}
                  onMouseEnter={() => setHighlight(i)}
                  onClick={() => commit(row)}
                  className={`flex w-full items-center gap-2.5 py-1.5 pl-3 pr-3 text-left transition hover:bg-surface-2 ${hover}`}
                >
                  <span className="min-w-0 flex-1 truncate text-[13px] font-medium text-text-primary">
                    {rowLabel(row)}
                  </span>
                  {picked && <CheckIcon className="h-3.5 w-3.5 shrink-0 text-text-muted" />}
                  {/* The same rounded square the console's Types tab paints —
                      a type looks the same wherever you meet it. */}
                  <span className="h-3.5 w-3.5 shrink-0 rounded" style={{ background: color }} />
                </button>
              )
            })}
          </div>

          {/* A colour for the type being invented. Enter takes the deterministic
              default, so the strip is an option rather than a step. */}
          {createRow && createRow.kind === 'create' && (
            <div className="border-t border-border-subtle px-3 py-2">
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
