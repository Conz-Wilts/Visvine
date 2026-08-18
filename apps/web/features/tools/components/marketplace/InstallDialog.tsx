'use client';

/**
 * The install decision, on one screen: the slug the Tool will live under, what
 * it needs that this space may not have, which context types it wants to own,
 * and the reach it declares.
 *
 * The checklist is drawn BEFORE anything is written, by running the server's own
 * `computeRequirements` over the same three lists it would use — the space's
 * connectors, node types and agents. That is the only way to answer "will this
 * run whole here?" without installing first, and running the shared pure
 * function (rather than a second copy of the rule) is what stops the preview and
 * the row disagreeing. The server's answer still wins: the POST comes back with
 * the real `requirements`, and anything it decided differently is reported.
 *
 * The type-claim picker previews the same two rules the server applies —
 * built-in pages stay built in, and one install owns a type's page — so an admin
 * is not surprised by a `page` that quietly became a tab. The preview is
 * advisory; `conflicts` and `downgraded` come back on the response and are what
 * gets reported.
 */

import { useEffect, useMemo, useState } from 'react';
import { Chip, Field, Input, Modal } from '@/components/ui';
import Alert from '@/components/ui/Alert';
import Button from '@/components/ui/Button';
import Select from '@/components/ui/Select';
import PerimeterSummary from '@/features/tools/components/PerimeterSummary';
import { fetchSpaceCapabilities, installVersion, type SpaceCapabilities } from '@/features/tools/lib/client';
import { TOOL_NAME_RE } from '@/lib/tools/config';
import { computeRequirements, type ToolRequirements } from '@/lib/tools/requirements';
import type { InstallCreatedResponse, InstallSummary, VersionDetail } from '@/lib/tools/api';
import type { TypeClaimMode, TypeClaims } from '@/lib/tools/installs';
import { DEFAULT_NODE_TYPES, type NodeTypeConfig } from '@/lib/types/context';
import ToolIcon from '@/features/tools/components/toolIcons';
import RequirementsChecklist from './RequirementsChecklist';

export type InstallOutcome = InstallCreatedResponse;

/** Nothing missing — what the checklist shows until the space has answered. */
const NOTHING_MISSING: ToolRequirements = { connectors: [], types: [], agents: [] };

export default function InstallDialog({
  version,
  spaceId,
  installs,
  nodeTypes,
  onClose,
  onInstalled,
  onError,
}: {
  version: VersionDetail;
  spaceId: string;
  installs: InstallSummary[];
  nodeTypes: NodeTypeConfig[];
  onClose: () => void;
  onInstalled: (outcome: InstallOutcome) => void;
  onError: (message: string) => void;
}) {
  const [slug, setSlug] = useState(version.name);
  const [claims, setClaims] = useState<TypeClaims>(() =>
    Object.fromEntries(version.surfaces.types.map((surface) => [surface.type, surface.mode])),
  );
  const [capabilities, setCapabilities] = useState<SpaceCapabilities | null>(null);
  const [busy, setBusy] = useState(false);
  const [failure, setFailure] = useState<string | null>(null);

  useEffect(() => {
    const controller = new AbortController();
    fetchSpaceCapabilities(spaceId, controller.signal)
      .then((caps) => setCapabilities(caps))
      .catch(() => setCapabilities({ connectors: null, agents: null }));
    return () => controller.abort();
  }, [spaceId]);

  // Node types are on the space DTO the shell already hydrated with, and the
  // built-in defaults are folded in exactly as the server folds them: a tool
  // declaring `person` in a space that never edited its vocabulary must not read
  // as a missing dependency.
  const availableTypes = useMemo(() => {
    const names = new Set<string>();
    for (const type of [...nodeTypes, ...DEFAULT_NODE_TYPES]) {
      if (type?.name?.trim()) names.add(type.name.trim().toLowerCase());
    }
    return [...names];
  }, [nodeTypes]);

  const requirements = useMemo(
    () =>
      capabilities
        ? computeRequirements(version.perimeter, {
            connectors: capabilities.connectors ?? [],
            types: availableTypes,
            agents: capabilities.agents ?? [],
          })
        : NOTHING_MISSING,
    [capabilities, availableTypes, version.perimeter],
  );

  const unchecked = useMemo<Array<keyof ToolRequirements>>(() => {
    if (!capabilities) return ['connectors', 'types', 'agents'];
    const out: Array<keyof ToolRequirements> = [];
    if (capabilities.connectors === null) out.push('connectors');
    if (capabilities.agents === null) out.push('agents');
    return out;
  }, [capabilities]);

  /** Member-invented types (`scope: 'note'`) — the only ones a Tool may page. */
  const customTypes = useMemo(
    () =>
      new Set(
        nodeTypes.filter((type) => type.scope === 'note' && type.name?.trim()).map((type) => type.name.trim().toLowerCase()),
      ),
    [nodeTypes],
  );

  /** type → the slug of the install that already owns its page. */
  const pageOwners = useMemo(() => {
    const out = new Map<string, string>();
    for (const install of installs) {
      for (const [type, mode] of Object.entries(install.typeClaims)) {
        if (mode === 'page' && !out.has(type)) out.set(type, install.slug);
      }
    }
    return out;
  }, [installs]);

  const slugError = slug.trim() && !TOOL_NAME_RE.test(slug.trim().toLowerCase())
    ? 'Lower-case letters, digits and hyphens only (63 max), starting with a letter or digit.'
    : null;
  const takenSlug = installs.some((install) => install.slug === slug.trim().toLowerCase());

  const confirm = async () => {
    setBusy(true);
    setFailure(null);
    try {
      const outcome = await installVersion(spaceId, {
        versionId: version.id,
        slug: slug.trim().toLowerCase() || undefined,
        ...(Object.keys(claims).length > 0 ? { typeClaims: claims } : {}),
      });
      onInstalled(outcome);
    } catch (err) {
      const message = err instanceof Error ? err.message : 'The install did not complete.';
      setFailure(message);
      onError(message);
    } finally {
      setBusy(false);
    }
  };

  return (
    <Modal
      onClose={busy ? () => {} : onClose}
      size="md"
      title={`Install ${version.title}`}
      footer={
        <div className="flex items-center justify-end gap-2 border-t border-border-subtle px-5 py-3">
          <Button variant="ghost" onClick={onClose} disabled={busy}>
            Cancel
          </Button>
          <Button
            variant="brand"
            onClick={confirm}
            loading={busy}
            loadingText="Installing…"
            disabled={busy || slugError !== null}
          >
            Install
          </Button>
        </div>
      }
    >
      <div className="space-y-5 px-5 py-4">
        {failure && <Alert variant="error">{failure}</Alert>}

        <Field
          label="Address"
          hint={
            takenSlug
              ? 'This space already uses that slug — the install will be given the next free one.'
              : `The tool will live at /t/${slug.trim().toLowerCase() || version.name}, and its sidebar row is keyed on it.`
          }
          error={slugError}
        >
          <Input
            value={slug}
            onChange={(event) => setSlug(event.target.value)}
            spellCheck={false}
            autoCapitalize="off"
            className="font-mono"
          />
        </Field>

        <section>
          <h3 className="mb-2 text-xs font-semibold uppercase tracking-wide text-text-muted">Requirements</h3>
          <RequirementsChecklist
            perimeter={version.perimeter}
            requirements={requirements}
            unchecked={unchecked}
          />
        </section>

        {version.surfaces.types.length > 0 && (
          <section>
            <h3 className="mb-2 text-xs font-semibold uppercase tracking-wide text-text-muted">Type pages</h3>
            <p className="mb-2 text-sm text-text-secondary">
              A tool can own the page for a type your members invented, or add a tab beside whatever is
              already there.
            </p>
            <ul className="space-y-2">
              {version.surfaces.types.map((surface) => {
                const type = surface.type;
                const mode = claims[type] ?? surface.mode;
                const builtIn = !customTypes.has(type);
                const heldBy = pageOwners.get(type);
                return (
                  <li key={type} className="flex flex-wrap items-center gap-2">
                    <span className="w-32 shrink-0 truncate font-mono text-[13px] text-text-primary">{type}</span>
                    <Select
                      className="w-40"
                      value={mode}
                      aria-label={`How ${type} is claimed`}
                      onChange={(event) =>
                        setClaims((current) => ({ ...current, [type]: event.target.value as TypeClaimMode }))
                      }
                    >
                      <option value="tab">Add a tab</option>
                      <option value="page">Own the page</option>
                    </Select>
                    {mode === 'page' && builtIn && (
                      <span className="text-xs text-amber-700">
                        Built-in type — this becomes a tab instead.
                      </span>
                    )}
                    {mode === 'page' && !builtIn && heldBy && (
                      <span className="text-xs text-amber-700">
                        Already owned by <span className="font-mono">{heldBy}</span> — the claim will be left
                        unmade.
                      </span>
                    )}
                  </li>
                );
              })}
            </ul>
          </section>
        )}

        <section>
          <h3 className="mb-2 text-xs font-semibold uppercase tracking-wide text-text-muted">Declared reach</h3>
          <PerimeterSummary perimeter={version.perimeter} />
        </section>

        {version.surfaces.rail && (
          <p className="flex flex-wrap items-center gap-x-1 gap-y-1.5 text-sm text-text-muted">
            Adds a sidebar row
            {/* Shown, not described: the admin is about to put this glyph in
                their own chrome, so it belongs in the confirmation. */}
            <span className="shrink-0 text-text-primary">
              <ToolIcon name={version.surfaces.rail.icon} svg={version.iconSvg} />
            </span>
            <Chip tone="muted" size="sm">
              {version.surfaces.rail.label}
            </Chip>
            — reorder or hide it in the console under Tools.
          </p>
        )}
      </div>
    </Modal>
  );
}
