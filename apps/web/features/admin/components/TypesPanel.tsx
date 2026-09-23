'use client';

// Console → Types: every kind of thing this space records, and the aliases each
// kind can wear.
//
// Person's aliases are here like everybody else's — named, coloured, made and
// unmade — but only that half of them. What holding one MEANS (who has it,
// whether it owns the space, which context folders it opens) is the permission
// model, and that lives on Members beside the people wearing it. This page says
// where it went rather than keeping a second copy of it.

import { useState, useEffect, type ReactNode } from 'react';
import { useSpace } from '@/features/shared/contexts/SpaceContext';
import {
  DEFAULT_NODE_TYPES,
  isSystemNodeType,
  isAliaslessNodeType,
  aliasesForType,
  mergeNodeTypeList,
  normalizeTypePlural,
  pluralizeTypeWord,
} from '@/lib/types';
import type { SpaceAlias, Space, NodeTypeConfig } from '@/lib/types';
import { isNodeTypeEnabled, nodeTypeToolKey } from '@/lib/featureAccess';
import { fetchJsonBody } from '@/lib/fetchJson';
import { FEATURES } from '@/features/shared/lib/features';
import { Alert, Button, ConfirmDialog, Input, SearchInput } from '@/components/ui';
import ColorPicker from './ColorPicker';
import { ChevronDownIcon, Trash2Icon } from '@/features/shared/icons';
import Select from '@/components/ui/Select';
import { patchInstall } from '@/features/tools/lib/client';
import { pageClaimantsFor } from '@/lib/tools/typePages';
import type { InstalledToolDto } from '@/lib/tools/installs';
import { useConsoleSave } from '@/features/admin/components/console/ConsoleSaveContext';
import { usePeopleSection } from '@/features/admin/components/people/PeopleDataContext';
import { TreeSpine } from '@/components/ui/TreeChrome';
import AliasList, {
  AliasBackRow,
  AliasLabel,
  AliasRow,
  NewAliasRow,
} from '@/features/admin/components/people/AliasList';

// The type whose aliases are the permission model. Everything else's aliases are
// plain directory labels, stored on the space and edited in place.
const PERMISSION_TYPE = 'person';

// ─── Add Alias Row ────────────────────────────────────────────────────────────

function AddAliasRow({ nodeType, defaultColor, existing, onAdd, onCancel, disabled }: {
  nodeType: string;
  defaultColor: string;
  existing: SpaceAlias[];
  onAdd: (a: SpaceAlias) => void;
  onCancel: () => void;
  disabled: boolean;
}) {
  const [name, setName] = useState('');
  const [color, setColor] = useState(defaultColor);
  const [showPicker, setShowPicker] = useState(false);

  const handleAdd = () => {
    const trimmed = name.trim();
    if (!trimmed) return;
    if (existing.some(a => a.name.toLowerCase() === trimmed.toLowerCase() && a.nodeType === nodeType)) return;
    onAdd({ name: trimmed, color, nodeType });
    setName('');
    setColor(defaultColor);
  };

  return (
    <div className="flex items-center gap-2">
      <div className="relative">
        <button
          type="button"
          data-color-trigger
          onClick={() => setShowPicker(p => !p)}
          className="w-7 h-7 rounded-lg border-2 border-line shrink-0 transition-transform hover:scale-110"
          style={{ background: color }}
          title="Pick colour"
        />
        {showPicker && (
          <ColorPicker color={color} onChange={setColor} onClose={() => setShowPicker(false)} />
        )}
      </div>
      <input
        autoFocus
        className="flex-1 px-3 py-1.5 rounded-lg border border-line bg-surface text-sm text-fg placeholder:text-fg-muted focus:outline-none focus:ring-2 focus:ring-accent/40 focus:border-accent transition-all"
        placeholder="Alias name"
        value={name}
        onChange={e => setName(e.target.value)}
        onKeyDown={e => { if (e.key === 'Enter') handleAdd(); if (e.key === 'Escape') { setShowPicker(false); onCancel(); } }}
        maxLength={40}
      />
      <button
        onClick={handleAdd}
        disabled={!name.trim() || disabled}
        className="px-3 py-1.5 rounded-lg bg-accent text-white text-sm font-medium disabled:opacity-40 hover:opacity-90 transition-opacity shrink-0"
      >
        Add
      </button>
      <button
        onClick={onCancel}
        className="px-2 py-1.5 rounded-lg text-fg-muted hover:text-fg hover:bg-surface-muted text-sm transition-colors shrink-0"
      >
        Cancel
      </button>
    </div>
  );
}

// ─── A plain type's aliases ───────────────────────────────────────────────────

/**
 * The aliases of every type that ISN'T Person, opened the same way Person's are:
 * a row of chips inside the type's settings, and clicking one puts what that
 * alias is in place of them.
 *
 * What opens is shorter, because there is less of it to be. A Person alias is
 * the permission model — holders, the admin flag, context grants — and those
 * only mean something for a person, since access is resolved through the aliases
 * a USER holds. An alias on Space or Channel narrows a directory record instead:
 * it is a name and a colour on a card, held by nodes rather than people, so its
 * panel is a name, a colour and the way to remove it, and it says as much rather
 * than showing an empty permissions block that could never fill.
 */
function LabelAliases({ typeName, typeColor, aliases, allAliases, newOpen, onNewStart, onNewDone, onAdd, onRename, onUpdateColor, onRemove, saving }: {
  typeName: string;
  typeColor: string;
  aliases: SpaceAlias[];
  allAliases: SpaceAlias[];
  /** The create form, opened from the line at the head of the list. */
  newOpen: boolean;
  onNewStart: () => void;
  onNewDone: () => void;
  onAdd: (a: SpaceAlias) => void;
  onRename: (name: string, nodeType: string, newName: string) => void;
  onUpdateColor: (name: string, nodeType: string, color: string) => void;
  onRemove: (name: string, nodeType: string) => void;
  saving: boolean;
}) {
  const [open, setOpen] = useState<{ kind: 'alias'; name: string } | null>(null);
  const [draftName, setDraftName] = useState('');
  const [picking, setPicking] = useState(false);

  const close = () => { setOpen(null); setPicking(false); onNewDone(); };
  const showing = open ? aliases.find(a => a.name === open.name) : undefined;

  const openAlias = (alias: SpaceAlias) => {
    setDraftName(alias.name);
    setPicking(false);
    setOpen({ kind: 'alias', name: alias.name });
  };

  if (newOpen) {
    return (
      <div>
        <AliasBackRow label="Aliases" onBack={close} />
        <AddAliasRow
          nodeType={typeName}
          defaultColor={typeColor}
          existing={allAliases}
          onAdd={a => { onAdd(a); close(); }}
          onCancel={close}
          disabled={saving}
        />
      </div>
    );
  }

  if (showing) {
    const commitName = () => {
      const next = draftName.trim();
      if (!next || next === showing.name) return;
      onRename(showing.name, showing.nodeType, next);
      close();
    };
    return (
      <div>
        <AliasBackRow label="Aliases" onBack={close}>
          <AliasLabel name={showing.name} color={showing.color} />
        </AliasBackRow>
        <div className="space-y-4">
          <div className="flex items-center gap-3">
            <div className="relative shrink-0">
              <button
                type="button"
                data-color-trigger
                onClick={() => setPicking(p => !p)}
                className="block h-7 w-7 rounded-lg border-2 border-line transition-transform hover:scale-110"
                style={{ background: showing.color }}
                title={`Change the colour of ${showing.name}`}
                aria-label={`Colour of ${showing.name}`}
              />
              {picking && (
                <div className="absolute left-0 top-9 z-50">
                  <ColorPicker
                    color={showing.color}
                    onChange={c => onUpdateColor(showing.name, showing.nodeType, c)}
                    onClose={() => setPicking(false)}
                  />
                </div>
              )}
            </div>
            <Input
              value={draftName}
              disabled={saving}
              maxLength={40}
              aria-label={`Name of ${showing.name}`}
              className="!py-1 !text-sm"
              onChange={e => setDraftName(e.target.value)}
              onBlur={commitName}
              onKeyDown={e => {
                if (e.key === 'Enter') { e.preventDefault(); commitName(); }
                if (e.key === 'Escape') setDraftName(showing.name);
              }}
            />
            <button
              type="button"
              onClick={() => { onRemove(showing.name, showing.nodeType); close(); }}
              disabled={saving}
              title={`Remove ${showing.name}`}
              className="shrink-0 rounded-full p-1 text-fg-muted transition hover:text-danger-bright disabled:opacity-40"
            >
              <Trash2Icon className="h-3.5 w-3.5" />
            </button>
          </div>
          <p className="text-xs text-fg-muted">
            A label on a {typeName.toLowerCase()} card. Only Person&apos;s aliases carry holders and
            permissions.
          </p>
        </div>
      </div>
    );
  }

  return (
    <TreeSpine animate>
      <NewAliasRow nested={aliases.length === 0 ? 'last' : 'mid'} onClick={onNewStart} />
      {aliases.map((alias, i) => (
        <AliasRow
          key={`${alias.nodeType}:${alias.name}`}
          nested={i === aliases.length - 1 ? 'last' : 'mid'}
          label={<AliasLabel name={alias.name} color={alias.color} />}
          meta=""
          action={null}
          onOpen={() => openAlias(alias)}
        />
      ))}
    </TreeSpine>
  );
}

// ─── Person aliases ───────────────────────────────────────────────────────────

/**
 * What a Person can be called here, and nothing about what it opens: the same
 * list Members draws, in its naming half.
 */
function PersonAliases({ typeColor, newOpen, onNewStart, onNewDone }: {
  typeColor: string;
  newOpen: boolean;
  onNewStart: () => void;
  onNewDone: () => void;
}) {
  return (
    <AliasList
      mode="naming"
      typeColor={typeColor}
      newOpen={newOpen}
      onNewStart={onNewStart}
      onNewDone={onNewDone}
    />
  );
}

// ─── Who draws a type's page ──────────────────────────────────────────────────

/**
 * The Tool that owns this type's page, inside the type's own settings.
 *
 * The profiles/spaces/events analogy, from the admin's side: a member-invented
 * type gets a real page the moment an installed Tool claims it, and this is the
 * one place that says which Tool that is. Built-in types never appear here —
 * Visvine owns those pages (lib/tools/typePages.ts).
 *
 * More than one claimant is impossible by construction (the install path refuses
 * a second page claim) and so is exactly the case worth being able to settle
 * from a screen: the picker hands the page to one Tool and releases it from the
 * rest, rather than leaving the answer to whichever install renders first.
 */
function TypePageOwner({ typeName, claimants, onChoose, saving }: {
  typeName: string;
  claimants: InstalledToolDto[];
  onChoose: (installId: string) => void;
  saving: boolean;
}) {
  const noun = `${typeName.toLowerCase()} notes`;

  return (
    <Field label="Page drawn by">
      {claimants.length > 1 ? (
        <Select
          className="w-56"
          value={claimants[0].id}
          disabled={saving}
          title={`${claimants.length} tools claim this page — pick the one that draws it`}
          aria-label={`Which tool draws the page for ${noun}`}
          onChange={e => onChoose(e.target.value)}
        >
          {claimants.map(install => (
            <option key={install.id} value={install.id}>{install.title}</option>
          ))}
        </Select>
      ) : (
        <span className="text-sm text-fg-secondary">
          {claimants[0]
            ? claimants[0].title
            : 'No installed tool draws a page for these — they read as context notes.'}
        </span>
      )}
    </Field>
  );
}

// ─── Plural ───────────────────────────────────────────────────────────────────

/**
 * What a SET of this type is called.
 *
 * A type is named in the singular, because a chip on a card labels one thing —
 * but a tab over a table of them, and a row of the Directory's Type filter,
 * name the set: `People`, not `Person`. That word is derived from the name by
 * the English rule in lib/types/plural.ts, so this field is empty for nearly
 * every type and exists only for the name the rule gets wrong. The placeholder
 * is what the rule says, so an admin can see the derived word without an
 * override standing in the way of it — and typing that same word back stores
 * nothing, which keeps the derivation alive if the type is ever renamed.
 */
function TypePlural({ typeName, plural, saving, onSave }: {
  typeName: string;
  plural?: string;
  saving: boolean;
  onSave: (plural: string | undefined) => void;
}) {
  const derived = pluralizeTypeWord(typeName);
  const [draft, setDraft] = useState(plural ?? '');
  // The panel follows the record: every save refreshes the space, and a type
  // opened with one override must not keep showing the word it opened with.
  useEffect(() => { setDraft(plural ?? ''); }, [plural, typeName]);

  const commit = () => {
    const next = normalizeTypePlural(draft, typeName);
    setDraft(next ?? '');
    if ((next ?? '') !== (plural ?? '')) onSave(next);
  };

  return (
    <Field label="Plural">
      <Input
        value={draft}
        placeholder={derived}
        disabled={saving}
        maxLength={40}
        className="max-w-[260px] px-3 py-2 text-sm"
        aria-label={`What a set of ${typeName} is called`}
        onChange={e => setDraft(e.target.value)}
        onBlur={commit}
        onKeyDown={e => {
          if (e.key === 'Enter') { e.preventDefault(); e.currentTarget.blur(); }
          if (e.key === 'Escape') { setDraft(plural ?? ''); e.currentTarget.blur(); }
        }}
      />
    </Field>
  );
}

// ─── Type row + its settings ──────────────────────────────────────────────────

/** A labelled line inside the settings panel. */
function Field({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div>
      <h5 className="mb-1.5 text-xs font-medium text-fg-muted">{label}</h5>
      {children}
    </div>
  );
}

/**
 * One type, as a line you read: its colour, its name, and the chevron that drops everything you can change about it open in place.
 *
 * The row says nothing about which tool the type came in with, because the
 * section it sits under is that tool — provenance is a heading, not a column
 * repeated down every line.
 */
function TypeRow({ typeName, typeColor, expanded, onOpen, onUpdateColor }: {
  typeName: string;
  typeColor: string;
  /** Open right here, under the row — there is no second window over this one. */
  expanded: boolean;
  onOpen: () => void;
  onUpdateColor: (color: string) => void;
}) {
  const [showColorPicker, setShowColorPicker] = useState(false);

  return (
    <div
      role="button"
      tabIndex={0}
      onClick={onOpen}
      onKeyDown={e => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); onOpen(); } }}
      className="flex cursor-pointer items-center gap-3.5 py-4 transition-colors hover:bg-surface-subtle"
      aria-expanded={expanded}
      aria-label={`Settings for ${typeName}`}
    >
      {/* The chevron leads the row: it points into the type while shut and down
          the moment what's inside is on screen, so a column of them reads as
          which one is open. */}
      <span className="ml-1 grid h-5 w-5 shrink-0 place-items-center text-fg-muted">
        <ChevronDownIcon className={`h-4 w-4 transition-transform ${expanded ? '' : '-rotate-90'}`} />
      </span>

      {/* The swatch IS the colour control — the one thing on this row you change
          without opening anything, so the click never reaches the row. */}
      <span className="relative shrink-0" onClick={e => e.stopPropagation()}>
        <button
          type="button"
          data-color-trigger
          onClick={() => setShowColorPicker(p => !p)}
          className="block h-5 w-5 rounded transition-transform hover:scale-110"
          style={{ background: typeColor }}
          title={`Change the colour of ${typeName}`}
          aria-label={`Colour of ${typeName}`}
        />
        {showColorPicker && (
          <span className="absolute left-0 top-7 z-50 block">
            <ColorPicker
              color={typeColor}
              onChange={onUpdateColor}
              onClose={() => setShowColorPicker(false)}
            />
          </span>
        )}
      </span>
      <span className="min-w-0 flex-1 truncate text-base font-semibold text-fg">
        {typeName}
      </span>
    </div>
  );
}

/**
 * Everything a type is, dropped open under its row: the aliases it can wear,
 * who draws its page, and — for a type a member named rather than a tool
 * brought in — the way to take it back out of the vocabulary. Its colour is
 * not here: the swatch on the row is the whole control.
 */
function TypeSettings({ typeName, typeColor, plural, pageOwner, aliases, allAliases, isPerson, aliasless, noteScoped, newOpen, onNewStart, onNewDone, onAddAlias, onRemoveAlias, onRenameAlias, onUpdateAliasColor, onDelete, saving }: {
  typeName: string;
  typeColor: string;
  /** The word for a set of these, when the derived one is wrong. */
  plural?: ReactNode;
  /** Which installed Tool draws this type's page. Member-made types only. */
  pageOwner?: ReactNode;
  aliases: SpaceAlias[];
  allAliases: SpaceAlias[];
  /** Person's aliases are the permission model, so it renders its own list. */
  isPerson?: boolean;
  /** A built-in that can hold no aliases (Index, Connector, Model, Subspace, Tool). */
  aliasless?: boolean;
  /** A type a member invented: it labels context notes, so it has no aliases. */
  noteScoped?: boolean;
  /** The create form, opened by "New alias" at the head of this panel. */
  newOpen: boolean;
  onNewStart: () => void;
  onNewDone: () => void;
  onAddAlias: (a: SpaceAlias) => void;
  onRemoveAlias: (name: string, nodeType: string) => void;
  onRenameAlias: (name: string, nodeType: string, newName: string) => void;
  onUpdateAliasColor: (name: string, nodeType: string, color: string) => void;
  /** Take this type out of the space's vocabulary. Member-made types only —
      a built-in is what the tools create entities under. */
  onDelete?: () => void;
  saving: boolean;
}) {
  return (
    <div className="space-y-5">
      {aliasless ? null : isPerson ? (
        <PersonAliases
          typeColor={typeColor}
          newOpen={newOpen}
          onNewStart={onNewStart}
          onNewDone={onNewDone}
        />
      ) : noteScoped ? (
        /* A type somebody named on the draft surface. Things made under it are
           context notes — Context and Raw, a coloured chip, no profile page — so
           there is nothing here to alias: an alias narrows a directory record,
           and a note isn't one. */
        <p className="text-sm text-fg-muted">
          Added from a note. Things of this type are context notes, so it carries no aliases —
          only the colour on its row.
        </p>
      ) : (
        <LabelAliases
          typeName={typeName}
          typeColor={typeColor}
          aliases={aliases}
          allAliases={allAliases}
          newOpen={newOpen}
          onNewStart={onNewStart}
          onNewDone={onNewDone}
          onAdd={onAddAlias}
          onRename={onRenameAlias}
          onUpdateColor={onUpdateAliasColor}
          onRemove={onRemoveAlias}
          saving={saving}
        />
      )}

      {plural}

      {pageOwner}

      {onDelete && (
        <div className="flex justify-end border-t border-line-subtle pt-4">
          <Button variant="danger" size="sm" disabled={saving} onClick={onDelete}>
            Delete type
          </Button>
        </div>
      )}
    </div>
  );
}

// ─── Main ─────────────────────────────────────────────────────────────────────
// (The former "Link types" editor card was removed: links are derived from
// context-note mentions now, so relationship vocabulary isn't admin-curated —
// rendering falls back to DEFAULT_LINK_TYPES / getLinkTypeConfig.)

export default function TypesPanel() {
  const { currentSpace, refreshSpace } = useSpace();
  const { data, error: accessError, setError: setAccessError } = usePeopleSection();

  const [types, setTypes] = useState<NodeTypeConfig[]>(
    currentSpace?.nodeTypes ?? DEFAULT_NODE_TYPES
  );
  const [aliases, setAliases] = useState<SpaceAlias[]>(
    (currentSpace?.aliases as SpaceAlias[]) ?? []
  );
  const [query, setQuery] = useState('');
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [deleting, setDeleting] = useState<NodeTypeConfig | null>(null);
  // The type dropped open. Held by NAME, not by the object: every save
  // refreshes the space record, and the panel has to follow the new colour
  // rather than keep showing the one it opened with.
  const [openName, setOpenName] = useState<string | null>(null);
  // The type whose "New alias" was pressed. Held beside the open type rather
  // than inside the list, because the button that starts one is on the row.
  const [creatingFor, setCreatingFor] = useState<string | null>(null);
  const { report } = useConsoleSave();

  useEffect(() => {
    if (currentSpace?.nodeTypes) setTypes(currentSpace.nodeTypes);
    if (currentSpace?.aliases) setAliases(currentSpace.aliases as SpaceAlias[]);
  }, [currentSpace]);

  /** Shared save shell: status reporting, error surface, refresh. */
  const save = async (run: () => Promise<unknown>) => {
    if (!currentSpace) return;
    setSaving(true);
    setError(null);
    report('saving');
    try {
      await run();
      await refreshSpace();
      report('saved');
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Error saving');
      report('error');
    } finally {
      setSaving(false);
    }
  };

  // Types ride on the space record, which merges additively — this page's
  // snapshot can be minutes old and must not delete a type a member added since.
  const saveTypes = (nextTypes: NodeTypeConfig[]) => {
    if (!currentSpace) return;
    const space: Space = { ...currentSpace, nodeTypes: nextTypes };
    return save(() => fetchJsonBody('/api/data/spaces', 'PUT', { space }));
  };

  // Aliases do NOT ride on that save. Creating one needs an id, removing one has
  // to clear the chips off every card wearing it, and for Person it has to carry
  // holders and grants — none of which a whole-record PUT can express. All of it
  // lives behind /api/aliases (lib/notes/typeAliases.ts), one alias at a time.
  const aliasAction = (body: Record<string, unknown>) =>
    save(() => fetchJsonBody('/api/aliases', 'POST', { spaceId: currentSpace?.id, ...body }));

  const handleAddAlias = (alias: SpaceAlias) =>
    aliasAction({ action: 'create', nodeType: alias.nodeType, name: alias.name, color: alias.color });
  const handleRemoveAlias = (name: string, nodeType: string) =>
    aliasAction({ action: 'delete', nodeType, name });
  const handleRenameAlias = (name: string, nodeType: string, newName: string) =>
    aliasAction({ action: 'update', nodeType, name, newName });
  const handleUpdateAliasColor = (name: string, nodeType: string, color: string) =>
    aliasAction({ action: 'update', nodeType, name, color });
  // A built-in the space never stored has nothing to map over, so recolour
  // by merging the edited entry in — mapping alone would silently no-op.
  const handleUpdateTypeColor = (type: NodeTypeConfig, color: string) =>
    saveTypes(mergeNodeTypeList(types, [{ ...type, color }]));
  // Clearing the field is `plural: undefined` — mergeNodeTypeList drops the key
  // rather than storing a blank, so the type goes back to deriving its plural.
  const handleUpdateTypePlural = (type: NodeTypeConfig, plural: string | undefined) =>
    saveTypes(mergeNodeTypeList(types, [{ ...type, plural }]));

  // Deleting is the one edit the whole-record PUT can't express — it merges
  // additively, on purpose — so it has its own call. Notes already declaring
  // the type keep their `type:`; they just stop being coloured by it.
  const handleDeleteType = (type: NodeTypeConfig) =>
    save(async () => {
      await fetchJsonBody(
        `/api/spaces/${currentSpace?.id}/node-types`,
        'DELETE',
        { name: type.name },
      );
      setDeleting(null);
    });

  // Hand a type's page to one install and take it off the others. Release
  // before claim, in that order: setTypeClaims refuses a `page` on a type
  // another install still holds, so a claim sent first would 409 and leave the
  // disagreement exactly as it was.
  const handleChoosePageOwner = (
    typeName: string,
    claimants: InstalledToolDto[],
    installId: string,
  ) => {
    if (!currentSpace) return;
    const spaceId = currentSpace.id;
    const type = typeName.trim().toLowerCase();
    return save(async () => {
      for (const other of claimants) {
        if (other.id === installId) continue;
        await patchInstall(spaceId, other.id, { typeClaims: { [type]: 'tab' } });
      }
      await patchInstall(spaceId, installId, { typeClaims: { [type]: 'page' } });
    });
  };

  if (!currentSpace) {
    return <div className="p-6 text-sm text-fg-muted">Select a space to manage types.</div>;
  }

  // Every type this space has: the built-ins plus the ones members named on the
  // draft-context surface. The stored entry wins where both exist — that's the
  // colour this page saved. Without the union a member's type would be
  // invisible here, which is the one place its colour can be changed.
  const byLower = new Map<string, NodeTypeConfig>();
  for (const t of DEFAULT_NODE_TYPES) byLower.set(t.name.toLowerCase(), t);
  for (const t of types) byLower.set(t.name.toLowerCase(), t);
  const listedTypes = Array.from(byLower.values())
    .filter(t => isNodeTypeEnabled(currentSpace.featureConfig ?? null, t.name))
    .sort((a, b) => a.name.localeCompare(b.name));

  // Two different things share this page. A tool type arrived with a tool and
  // disappears with it; a custom type is one a member named on a draft and
  // belongs to nobody but the space. Telling them apart is the difference
  // between "why can't I delete Channel" and "why is Playbook in this list".
  // The Directory is not a tool a type comes from — every type, custom ones
  // included, is browsed there — so the types it owns are headed as what they
  // are: the ones the platform ships, set against the ones a member made.
  const PLATFORM_TYPES = 'Platform types';
  const sectionLabel = (f: (typeof FEATURES)[number]) =>
    f.key === 'directory' ? PLATFORM_TYPES : `${f.label.replace(/s$/, '')} types`;
  const toolLabels = new Map(FEATURES.map(f => [f.key, sectionLabel(f)]));
  // One bucket per tool, in the tool order the sidebar uses — the heading IS the
  // provenance, so a type never repeats its tool's name down the right edge.
  const byTool = new Map<string, NodeTypeConfig[]>();
  const customTypes: NodeTypeConfig[] = [];
  // Search reaches a type's aliases as well as its name: an alias is the word a
  // member actually has in mind ("Founder"), and the type it hangs off
  // ("Person") is what they're looking for. Person's live on the permission
  // snapshot and are edited on Members, so typing one still finds Person here
  // and Person says where it went.
  const term = query.trim().toLowerCase();
  const matches = (type: NodeTypeConfig) => {
    if (!term) return true;
    if (type.name.toLowerCase().includes(term)) return true;
    const named = type.name.toLowerCase() === PERMISSION_TYPE
      ? (data?.aliases ?? [])
      : aliasesForType(aliases, type.name);
    return named.some(a => a.name.toLowerCase().includes(term));
  };
  for (const type of listedTypes) {
    if (!matches(type)) continue;
    const key = nodeTypeToolKey(type.name);
    const label = isSystemNodeType(type.name)
      ? PLATFORM_TYPES
      : key ? toolLabels.get(key) : undefined;
    if (label) byTool.set(label, [...(byTool.get(label) ?? []), type]);
    else customTypes.push(type);
  }
  // FEATURES order, so the sections read down the page the way the tools do in
  // the rail; a label with nothing under it after the search simply isn't drawn.
  const toolSections = FEATURES.map(sectionLabel)
    .filter((label, i, all) => all.indexOf(label) === i)
    .map(label => ({ label, types: byTool.get(label) ?? [] }))
    .filter(section => section.types.length > 0);
  const anyTypes = toolSections.length + customTypes.length > 0;

  // One type at a time: a list where every row can be open at once is a list
  // you scroll rather than one you read.
  const renderRow = (liveType: NodeTypeConfig) => {
    const isPerson = liveType.name.toLowerCase() === PERMISSION_TYPE;
    const noteScoped = liveType.scope === 'note';
    // A built-in is never deletable, whatever scope the space stored it with
    // (removeNodeType asks the registry too) — so the button that would be
    // refused is not offered. `Index` is the one built-in that IS note-scoped.
    const deletable = noteScoped && !DEFAULT_NODE_TYPES.some(
      (t) => t.name.toLowerCase() === liveType.name.trim().toLowerCase(),
    );
    const typeAliases = aliasesForType(aliases, liveType.name);
    const expanded = openName?.toLowerCase() === liveType.name.toLowerCase();
    // Only a member-made type can have a Tool-owned page; pageClaimantsFor
    // answers empty for everything else, so the field stays off those panels
    // rather than promising a '—' that could never become a name.
    const claimants = noteScoped
      ? pageClaimantsFor(currentSpace.installedTools, liveType.name)
      : [];

    return (
      <div key={liveType.name}>
        <TypeRow
          typeName={liveType.name}
          typeColor={liveType.color}
          // Person's preview comes from the live permission snapshot, which
          // already grafts in the built-in Admin; every other type's from the
          // space record it saves to.
          expanded={expanded}
          onOpen={() => {
            setCreatingFor(null);
            setOpenName(expanded ? null : liveType.name);
          }}
          onUpdateColor={color => handleUpdateTypeColor(liveType, color)}
        />
        {expanded && (
          <div className="mb-4">
            <TypeSettings
              typeName={liveType.name}
              typeColor={liveType.color}
              // A built-in's plural is the rule's (lib/types/plural.ts); only a
              // type the space made has a name the rule might get wrong.
              plural={deletable ? (
                <TypePlural
                  typeName={liveType.name}
                  plural={liveType.plural}
                  saving={saving}
                  onSave={next => handleUpdateTypePlural(liveType, next)}
                />
              ) : undefined}
              pageOwner={
                noteScoped ? (
                  <TypePageOwner
                    typeName={liveType.name}
                    claimants={claimants}
                    saving={saving}
                    onChoose={installId =>
                      handleChoosePageOwner(liveType.name, claimants, installId)
                    }
                  />
                ) : undefined
              }
              noteScoped={noteScoped}
              newOpen={creatingFor?.toLowerCase() === liveType.name.toLowerCase()}
              onNewStart={() => setCreatingFor(liveType.name)}
              onNewDone={() => setCreatingFor(null)}
              aliases={typeAliases}
              allAliases={aliases}
              isPerson={isPerson}
              aliasless={isAliaslessNodeType(liveType.name)}
              onAddAlias={handleAddAlias}
              onRemoveAlias={handleRemoveAlias}
              onRenameAlias={handleRenameAlias}
              onUpdateAliasColor={handleUpdateAliasColor}
              onDelete={deletable ? () => setDeleting(liveType) : undefined}
              saving={saving}
            />
          </div>
        )}
      </div>
    );
  };

  return (
    <div className="space-y-5">
      {error && <Alert variant="error" onDismiss={() => setError(null)}>{error}</Alert>}
      {accessError && <Alert variant="error" onDismiss={() => setAccessError(null)}>{accessError}</Alert>}

      {/* The tab bar above already says "Types", so the page starts on the
          search box and then goes tool by tool. A type whose tool is switched
          off isn't offered at all — no point curating aliases for something the
          space can't create.

          Alphabetical within each section: the registry order in
          DEFAULT_NODE_TYPES groups types by what they are (people, then places,
          then containers) and the directory and graph still read it that way. A
          list you scan to find one type wants names in the order you'd look
          them up. */}
      <SearchInput
        value={query}
        onChange={setQuery}
        placeholder="Search types and aliases…"
      />

      {/* One section per tool: the tool's name, a hairline, then its types. */}
      {toolSections.map(({ label, types: sectionTypes }) => (
        <section key={label}>
          <h3 className="border-b border-line pb-1.5 text-xs font-semibold uppercase tracking-wide text-fg-secondary">
            {label}
          </h3>
          <div className="divide-y divide-line-subtle">
            {sectionTypes.map(renderRow)}
          </div>
        </section>
      ))}


      {/* Member-made types, drawn only when there are some. */}
      {customTypes.length > 0 && (
        <section>
          <h3 className="border-b border-line pb-1.5 text-xs font-semibold uppercase tracking-wide text-fg-secondary">
            Custom types
          </h3>
          <div className="divide-y divide-line-subtle">
            {customTypes.map(renderRow)}
          </div>
        </section>
      )}

      {!anyTypes && <p className="text-sm text-fg-muted">No matches.</p>}

      <ConfirmDialog
        open={deleting !== null}
        title={`Delete "${deleting?.name ?? ''}"?`}
        body="Notes keep their type, uncoloured."
        confirmLabel="Delete"
        destructive
        onConfirm={async () => { if (deleting) await handleDeleteType(deleting); }}
        onClose={() => setDeleting(null)}
      />
    </div>
  );
}
