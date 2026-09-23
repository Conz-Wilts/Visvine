import { Avatar, Row, Stack } from '@visvine/ui';

const PORTRAIT =
  "data:image/svg+xml;utf8," +
  encodeURIComponent(
    "<svg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 48 48'><rect width='48' height='48' fill='rgb(214 196 176)'/><circle cx='24' cy='19' r='9' fill='rgb(120 86 64)'/><path d='M8 48c0-10 7-16 16-16s16 6 16 16z' fill='rgb(62 92 118)'/></svg>",
  );

export const Person = () => <Avatar name="Ana Ruiz" size="lg" />;

export const Sizes = () => (
  <Row gap={3} align="end">
    <Avatar name="Ana Ruiz" size="xs" />
    <Avatar name="Ana Ruiz" size="chip" />
    <Avatar name="Ana Ruiz" size="sm" />
    <Avatar name="Ana Ruiz" size="md" />
    <Avatar name="Ana Ruiz" size="lg" />
    <Avatar name="Ana Ruiz" size="xl" />
  </Row>
);

export const Fallbacks = () => (
  <Row gap={3} align="center">
    <Avatar name="Craig Mathers" size="lg" fallback="silhouette" />
    <Avatar name="Growth team" size="lg" fallback="initials" />
    <Avatar name="Growth team" size="lg" fallback="space" />
    <Avatar name="Ana Ruiz" size="lg" imageUrl={PORTRAIT} />
  </Row>
);

export const PeopleRows = () => (
  <div className="w-80 divide-y divide-line-subtle">
    {[
      { name: 'Ana Ruiz', role: 'Head of Growth · Admin', img: PORTRAIT },
      { name: 'Craig Mathers', role: 'Partnerships', img: null },
      { name: 'Priya Nair', role: 'Invited · pending', img: null },
    ].map((p) => (
      <div key={p.name} className="flex items-center gap-3 py-2.5">
        <Avatar name={p.name} imageUrl={p.img} size="md" />
        <div className="min-w-0 flex-1">
          <div className="truncate text-sm font-semibold text-fg">{p.name}</div>
          <div className="truncate text-xs text-fg-muted">{p.role}</div>
        </div>
      </div>
    ))}
  </div>
);

export const SpaceSwitcher = () => (
  <Stack gap={1} className="w-64">
    {['Growth team', 'Auckland Founders', 'Design guild'].map((name, i) => (
      <div
        key={name}
        className={`flex items-center gap-2.5 rounded-lg px-2 py-1.5 ${i === 0 ? 'bg-surface-subtle' : ''}`}
      >
        <Avatar name={name} size="sm" fallback={i === 1 ? 'initials' : 'space'} />
        <span className="truncate text-sm font-medium text-fg">{name}</span>
      </div>
    ))}
  </Stack>
);
