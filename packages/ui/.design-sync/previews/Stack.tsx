import { Avatar, Button, Chip, Row, Stack } from '@visvine/ui';

const PEOPLE = [
  { name: 'Ana Ruiz', role: 'Head of growth' },
  { name: 'Craig Tan', role: 'Sales lead' },
  { name: 'Priya Nair', role: 'Designer' },
];

export const PeopleList = () => (
  <Stack gap={3} className="w-64">
    {PEOPLE.map((p) => (
      <Row key={p.name} gap={3}>
        <Avatar name={p.name} size="sm" />
        <div className="min-w-0">
          <div className="truncate text-sm font-semibold text-fg">{p.name}</div>
          <div className="truncate text-xs text-fg-muted">{p.role}</div>
        </div>
      </Row>
    ))}
  </Stack>
);

export const GapSteps = () => (
  <Row gap={8} align="start">
    {([1, 3, 6] as const).map((gap) => (
      <Stack key={gap} gap={gap} align="start">
        <span className="text-xs font-semibold text-fg-muted">gap {gap}</span>
        <Chip size="md" color="var(--vv-color-hue-blue)">Person</Chip>
        <Chip size="md" color="var(--vv-color-hue-green)">Space</Chip>
        <Chip size="md" color="var(--vv-color-hue-orange)">Event</Chip>
      </Stack>
    ))}
  </Row>
);

export const Align = () => (
  <Row gap={6} align="start">
    {(['start', 'center', 'end'] as const).map((align) => (
      <Stack key={align} gap={2} align={align} className="w-32 border-l border-line-subtle pl-3">
        <span className="text-xs font-semibold text-fg-muted">{align}</span>
        <Chip size="md" tone="muted">HubSpot</Chip>
        <Chip size="md" tone="muted">Google Calendar</Chip>
        <Chip size="md" tone="muted">Slack</Chip>
      </Stack>
    ))}
  </Row>
);

export const AsList = () => (
  <Stack as="ul" gap={0} className="w-72 divide-y divide-line-subtle">
    {[
      ['Standup digest', 'Daily at 9:00'],
      ['Lead scorer', 'On new person'],
      ['Weekly review', 'Fridays at 16:00'],
    ].map(([name, when]) => (
      <Row as="li" key={name} justify="between" className="py-2.5">
        <span className="text-sm font-semibold text-fg">{name}</span>
        <span className="text-xs text-fg-muted">{when}</span>
      </Row>
    ))}
  </Stack>
);

export const JustifyBetween = () => (
  <Stack gap={4} justify="between" className="h-48 w-64 border border-line-subtle rounded-xl p-4">
    <Stack gap={1}>
      <span className="text-sm font-semibold text-fg">Launch night</span>
      <span className="text-xs text-fg-muted">Oct 14 · 18:30 · Wellington</span>
    </Stack>
    <Button variant="brand">Publish</Button>
  </Stack>
);
