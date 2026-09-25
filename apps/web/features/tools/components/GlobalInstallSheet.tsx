'use client';

import { useEffect, useState } from 'react';
import { Button, Modal, Select } from '@visvine/ui';
import { defaultBindings, type BindableSpace, type BindingValues } from '@visvine/tool-protocol/bindings';
import { timeAgo } from '@/lib/date';
import { isBuiltInType } from '@/lib/tools/typePages';
import type { ListingAbout } from '@/lib/tools/directory';
import type { InstallTargetSpace } from '@/lib/tools/api';
import { fetchBindable, installToolVersion } from '../lib/client';
import BindingFields from './BindingFields';
import ReachSentences from './ReachSentences';
import ListingSource from './ListingSource';

/** `Acme Sales · verified · reviewed 3d · 12 spaces · MIT` — the facts an admin weighs, joined. */
export function listingFacts(about: Pick<ListingAbout, 'publisher' | 'verified' | 'reviewedAt' | 'installs' | 'license'>): string {
  return [
    about.publisher.name,
    about.verified ? 'verified' : null,
    about.reviewedAt ? `reviewed ${timeAgo(new Date(about.reviewedAt).getTime(), { style: 'short' })}` : null,
    `${about.installs} ${about.installs === 1 ? 'space' : 'spaces'}`,
    about.license,
  ]
    .filter(Boolean)
    .join(' · ');
}

/**
 * Installing a Tool another space published, from Discover. One sheet, and
 * pressing Install is the consent: who published it and how widely it runs,
 * what it can do in words with each binding's picker in its sentence, its
 * settings and its place on the rail — and the source, one press away.
 */
export default function GlobalInstallSheet({
  about,
  spaces,
  onClose,
  onInstalled,
}: {
  about: ListingAbout;
  spaces: InstallTargetSpace[];
  onClose: () => void;
  onInstalled: (message: string) => void;
}) {
  const open = spaces.filter((s) => !s.installed && !s.refusal);
  const [spaceId, setSpaceId] = useState<string>(open[0]?.id ?? '');
  const [space, setSpace] = useState<BindableSpace | null>(null);
  const [bindings, setBindings] = useState<BindingValues>({});
  const [settings, setSettings] = useState<Record<string, unknown>>({});
  const [placement, setPlacement] = useState<'rail' | 'more'>('rail');
  const [claims, setClaims] = useState<Record<string, 'page' | 'tab' | 'none'>>(() =>
    Object.fromEntries(about.surfaces.types.map((t) => [t.type, t.mode])),
  );
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [source, setSource] = useState(false);
  const manifest = about.manifest;
  const hasSlots = Object.keys(manifest.bindings).length > 0;
  const chosen = spaces.find((s) => s.id === spaceId) ?? null;

  useEffect(() => {
    if (!spaceId || !hasSlots) return;
    const ctl = new AbortController();
    setSpace(null);
    fetchBindable(spaceId, ctl.signal)
      .then((found) => {
        setSpace(found);
        // Each slot starts on the Tool's suggestion when this space has it.
        setBindings(defaultBindings(manifest, found));
      })
      .catch(() => {});
    return () => ctl.abort();
  }, [spaceId, hasSlots, manifest]);

  const install = async () => {
    if (!spaceId) return;
    setBusy(true);
    setError(null);
    try {
      const res = await installToolVersion(spaceId, {
        versionId: about.versionId,
        ...(about.surfaces.rail ? { placement } : {}),
        ...(about.surfaces.types.length ? { typeClaims: claims } : {}),
        ...(hasSlots ? { bindings } : {}),
        ...(Object.keys(settings).length ? { settings } : {}),
      });
      const notes = [
        ...res.conflicts.map((c) => `${c.type}'s page is ${c.heldBy}'s`),
        ...(res.install.degraded ? ['it runs degraded until the space has what it names'] : []),
      ];
      onInstalled(`${about.title} installed in ${chosen?.name ?? 'the space'}${notes.length ? ` · ${notes.join(' · ')}` : ''}`);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Could not install');
      setBusy(false);
    }
  };

  if (source) return <ListingSource listingId={about.listingId} title={about.title} onClose={() => setSource(false)} />;

  return (
    <Modal
      onClose={onClose}
      title={`Install ${about.title}`}
      size="md"
      footer={
        <div className="flex items-center justify-between gap-2 px-6 py-3">
          <Button variant="ghost" size="sm" onClick={() => setSource(true)}>
            Source
          </Button>
          <div className="flex items-center gap-2">
            <Button variant="ghost" size="sm" onClick={onClose} disabled={busy}>
              Cancel
            </Button>
            <Button variant="brand" size="sm" onClick={install} loading={busy} loadingText="Installing…" disabled={!spaceId || !!chosen?.refusal}>
              Install
            </Button>
          </div>
        </div>
      }
    >
      <div className="flex flex-col gap-5 px-6 py-4 text-sm">
        <p className="text-fg-muted">{listingFacts(about)}</p>

        <label className="flex items-center justify-between gap-4">
          <span className="text-fg">Space</span>
          <Select className="w-56" value={spaceId} onChange={(e) => setSpaceId(e.target.value)} disabled={busy}>
            {spaces.map((s) => (
              <option key={s.id} value={s.id} disabled={s.installed || !!s.refusal}>
                {s.installed ? `${s.name} · installed` : s.name}
              </option>
            ))}
          </Select>
        </label>
        {chosen?.refusal && <p className="text-danger">{chosen.refusal}</p>}

        <section className="border-t border-line-subtle pt-4">
          <ReachSentences
            manifest={manifest}
            bindings={bindings}
            space={space}
            onBindings={hasSlots ? setBindings : undefined}
            disabled={busy || !spaceId}
          />
        </section>

        {Object.keys(manifest.settings).length > 0 && (
          <section className="border-t border-line-subtle pt-4">
            <BindingFields
              slots={{}}
              settingSpecs={manifest.settings}
              bindings={bindings}
              settings={settings}
              space={space}
              onBindings={setBindings}
              onSettings={setSettings}
              disabled={busy}
            />
          </section>
        )}

        {(about.surfaces.rail || about.surfaces.types.length > 0) && (
          <section className="flex flex-col gap-3 border-t border-line-subtle pt-4">
            {about.surfaces.rail && (
              <label className="flex items-center justify-between gap-4">
                <span className="text-fg">{about.surfaces.rail.label}</span>
                <Select className="w-40" value={placement} onChange={(e) => setPlacement(e.target.value as 'rail' | 'more')}>
                  <option value="rail">On the rail</option>
                  <option value="more">In More</option>
                </Select>
              </label>
            )}
            {about.surfaces.types.map((surface) => (
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
          </section>
        )}

        {error && <p className="text-danger">{error}</p>}
      </div>
    </Modal>
  );
}
