'use client';

import { useEffect, useMemo, useState } from 'react';
import { Button, Modal, Select } from '@visvine/ui';
import { defaultBindings, resolveReach, type BindableSpace, type BindingValues } from '@visvine/tool-protocol/bindings';
import { isBuiltInType } from '@/lib/tools/typePages';
import type { ToolVersionSummary } from '@/lib/tools/registry';
import { fetchBindable, installToolVersion } from '../lib/client';
import { reachRows } from '../lib/reach';
import BindingFields from './BindingFields';
import PerimeterSummary from './PerimeterSummary';

/**
 * Adding a Tool to the space's shape: where its row goes on the rail, which
 * type pages or tabs it takes, what each binding slot is bound to, its
 * settings, then Install — pressing it is the consent to the reach shown,
 * which is the BOUND reach, re-drawn as a slot changes. Opened from Approvals
 * right after approving, and from a Tool's own tab. Placement afterwards stays
 * in Console → Tools, which drags, locks and tucks rows.
 */
export default function InstallSheet({
  spaceId,
  version,
  onClose,
  onInstalled,
}: {
  spaceId: string;
  version: Pick<ToolVersionSummary, 'id' | 'title' | 'version' | 'surfaces' | 'manifest'>;
  onClose: () => void;
  /** The sentence to show once it is in, naming anything the admin should know. */
  onInstalled: (message: string) => void;
}) {
  const rail = version.surfaces.rail;
  const [placement, setPlacement] = useState<'rail' | 'more'>('rail');
  const [claims, setClaims] = useState<Record<string, 'page' | 'tab' | 'none'>>(() =>
    Object.fromEntries(version.surfaces.types.map((t) => [t.type, t.mode])),
  );
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const manifest = version.manifest;
  const hasSlots = Object.keys(manifest.bindings).length > 0;
  const [space, setSpace] = useState<BindableSpace | null>(null);
  const [bindings, setBindings] = useState<BindingValues>({});
  const [settings, setSettings] = useState<Record<string, unknown>>({});

  useEffect(() => {
    if (!hasSlots) return;
    const ctl = new AbortController();
    fetchBindable(spaceId, ctl.signal)
      .then((found) => {
        setSpace(found);
        // Each slot starts on the Tool's suggestion when this space has it.
        setBindings((chosen) => ({ ...defaultBindings(manifest, found), ...chosen }));
      })
      .catch(() => {});
    return () => ctl.abort();
  }, [spaceId, hasSlots, manifest]);

  const reach = useMemo(() => reachRows(resolveReach(manifest, bindings).reach), [manifest, bindings]);

  const install = async () => {
    setBusy(true);
    setError(null);
    try {
      const res = await installToolVersion(spaceId, {
        versionId: version.id,
        ...(rail ? { placement } : {}),
        ...(version.surfaces.types.length ? { typeClaims: claims } : {}),
        ...(hasSlots ? { bindings } : {}),
        ...(Object.keys(settings).length ? { settings } : {}),
      });
      const notes = [
        ...res.conflicts.map((c) => `${c.type}'s page is ${c.heldBy}'s`),
        ...res.downgraded.map((t) => `${t} is a tab — built-in pages stay built in`),
        ...(res.install.degraded ? ['it runs degraded until the space has what it names'] : []),
      ];
      onInstalled(`${version.title} installed${notes.length ? ` · ${notes.join(' · ')}` : ''}`);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Could not install');
      setBusy(false);
    }
  };

  return (
    <Modal
      onClose={onClose}
      title={`Install ${version.title}`}
      size="sm"
      footer={
        <div className="flex items-center justify-end gap-2 px-6 py-3">
          <Button variant="ghost" size="sm" onClick={onClose} disabled={busy}>
            Cancel
          </Button>
          <Button variant="brand" size="sm" onClick={install} loading={busy} loadingText="Installing…">
            Install
          </Button>
        </div>
      }
    >
      <div className="flex flex-col gap-5 px-6 py-4 text-sm">
        <PerimeterSummary perimeter={reach.perimeter} extra={reach.extra} />

        <BindingFields
          slots={manifest.bindings}
          settingSpecs={manifest.settings}
          bindings={bindings}
          settings={settings}
          space={space}
          onBindings={setBindings}
          onSettings={setSettings}
          disabled={busy}
        />

        {rail && (
          <label className="flex items-center justify-between gap-4">
            <span className="text-fg">{rail.label}</span>
            <Select className="w-40" value={placement} onChange={(e) => setPlacement(e.target.value as 'rail' | 'more')}>
              <option value="rail">On the rail</option>
              <option value="more">In More</option>
            </Select>
          </label>
        )}

        {version.surfaces.types.map((surface) => (
          <label key={surface.type} className="flex items-center justify-between gap-4">
            <span className="text-fg">{surface.type}</span>
            <Select
              className="w-40"
              value={claims[surface.type] ?? surface.mode}
              onChange={(e) => setClaims((c) => ({ ...c, [surface.type]: e.target.value as 'page' | 'tab' | 'none' }))}
            >
              {!isBuiltInType(surface.type) && <option value="page">Its page</option>}
              <option value="tab">A tab</option>
              <option value="none">Neither</option>
            </Select>
          </label>
        ))}

        {error && <p className="text-danger">{error}</p>}
      </div>
    </Modal>
  );
}
