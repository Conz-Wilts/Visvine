import { Avatar, Button, Chip, Row, Stack } from '@visvine/ui';

export const Chips = () => (
  <Row gap={2}>
    <Chip size="md" color="var(--vv-color-hue-blue)">Person</Chip>
    <Chip size="md" color="var(--vv-color-hue-amber)">customer</Chip>
    <Chip size="md" tone="muted">Growth team</Chip>
  </Row>
);

export const JustifyBetween = () => (
  <Row justify="between" className="w-96 border-b border-line-subtle pb-3">
    <Row gap={3}>
      <Avatar name="Growth team" fallback="space" size="sm" />
      <span className="text-sm font-semibold text-fg">Growth team</span>
    </Row>
    <Button variant="neutral">Open</Button>
  </Row>
);

const TAGS = ['customer', 'investor', 'partner', 'press', 'advisor', 'hiring', 'wellington', 'q3-launch', 'churn-risk'];

export const Wrap = () => (
  <Row gap={1.5} wrap className="w-64">
    {TAGS.map((t) => (
      <Chip key={t} size="sm" tone="muted">{t}</Chip>
    ))}
  </Row>
);

export const AlignSweep = () => (
  <Stack gap={3}>
    {(['start', 'center', 'end', 'baseline'] as const).map((align) => (
      <Row key={align} gap={3} align={align} className="h-16 w-80 rounded-lg border border-line-subtle px-3 py-2">
        <span className="w-16 text-xs font-semibold text-fg-muted">{align}</span>
        <Avatar name="Ana Ruiz" size="md" />
        <span className="text-base font-semibold text-fg">Ana Ruiz</span>
        <span className="text-xs text-fg-muted">Admin</span>
      </Row>
    ))}
  </Stack>
);

export const DialogFooter = () => (
  <Row gap={2} justify="end" className="w-96 border-t border-line-subtle pt-4">
    <Button variant="neutral">Cancel</Button>
    <Button variant="danger">Delete</Button>
  </Row>
);

export const AsList = () => (
  <Row as="ul" gap={4}>
    {['Grid', 'Context', 'Table', 'Resources'].map((tab, i) => (
      <li key={tab} className={i === 2 ? 'text-sm font-semibold text-fg' : 'text-sm text-fg-muted'}>{tab}</li>
    ))}
  </Row>
);
