import { TypeSilhouette, Row } from '@visvine/ui';

const TYPES = [
  ['person', 'Person'],
  ['space', 'Space'],
  ['group', 'Section'],
  ['event', 'Event'],
  ['resource', 'Resource'],
  ['connector', 'Connector'],
  ['agent', 'Agent'],
  ['tool', 'Tool'],
  ['model', 'Model'],
  ['custom', 'Custom'],
] as const;

const TYPE_COLOR: Record<string, string> = {
  person: 'var(--vv-color-type-person)',
  space: 'var(--vv-color-type-space)',
  group: 'var(--vv-color-type-section)',
  event: 'var(--vv-color-type-event)',
  resource: 'var(--vv-color-type-resource)',
  connector: 'var(--vv-color-type-connector)',
  agent: 'var(--vv-color-type-agent)',
  tool: 'var(--vv-color-type-tool)',
  model: 'var(--vv-color-type-model)',
  custom: 'var(--vv-color-type-other)',
};

export const SpaceTile = () => (
  <span className="block h-16 w-16 overflow-hidden rounded-xl">
    <TypeSilhouette glyph="space" color="var(--vv-color-type-space)" />
  </span>
);

export const Glyphs = () => (
  <div className="flex w-80 flex-wrap gap-x-2 gap-y-3">
    {TYPES.map(([glyph, label]) => (
      <div key={glyph} className="flex w-14 flex-col items-center gap-1.5">
        <span className="block h-10 w-10 overflow-hidden rounded-lg">
          <TypeSilhouette glyph={glyph} color={TYPE_COLOR[glyph]} />
        </span>
        <span className="text-xs text-fg-muted">{label}</span>
      </div>
    ))}
  </div>
);

export const AccentDefault = () => (
  <Row gap={3}>
    {(['agent', 'connector', 'event', 'resource'] as const).map((g) => (
      <span key={g} className="block h-9 w-9 overflow-hidden rounded-lg">
        <TypeSilhouette glyph={g} />
      </span>
    ))}
  </Row>
);

export const DirectoryRows = () => (
  <div className="w-80 divide-y divide-line-subtle">
    {[
      { glyph: 'agent', name: 'Standup digest', meta: 'Agent · next in 5h' },
      { glyph: 'connector', name: 'HubSpot', meta: 'Connector · signed in' },
      { glyph: 'event', name: 'Founders dinner', meta: 'Event · Thu 12 Oct' },
    ].map((r) => (
      <div key={r.name} className="flex items-center gap-3 py-2.5">
        <span className="block h-9 w-9 flex-none overflow-hidden rounded-xl">
          <TypeSilhouette glyph={r.glyph as 'agent'} color={TYPE_COLOR[r.glyph]} />
        </span>
        <div className="min-w-0 flex-1">
          <div className="truncate text-sm font-semibold text-fg">{r.name}</div>
          <div className="truncate text-xs text-fg-muted">{r.meta}</div>
        </div>
      </div>
    ))}
  </div>
);
