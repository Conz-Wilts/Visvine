import { useState } from 'react';
import { Chip, Row, Stack } from '@visvine/ui';

export const Solid = () => <Chip color="var(--vv-color-type-person)">Person</Chip>;

export const Tones = () => (
  <Row gap={2} wrap>
    <Chip tone="solid" color="var(--vv-color-type-agent)">Agent</Chip>
    <Chip tone="muted">Draft</Chip>
    <Chip tone="dashed" onClick={() => {}}>+ Add tag</Chip>
  </Row>
);

export const Sizes = () => (
  <Row gap={2} align="center" wrap>
    <Chip size="xs" color="var(--vv-color-type-event)">Event</Chip>
    <Chip size="sm" color="var(--vv-color-type-event)">Event</Chip>
    <Chip size="md" color="var(--vv-color-type-event)">Event</Chip>
    <Chip size="lg" color="var(--vv-color-type-event)">Event</Chip>
    <Chip size="xl" color="var(--vv-color-type-event)">Event</Chip>
  </Row>
);

export const Types = () => (
  <Row gap={2} wrap>
    <Chip color="var(--vv-color-type-person)">Person</Chip>
    <Chip color="var(--vv-color-type-space)">Space</Chip>
    <Chip color="var(--vv-color-type-event)">Event</Chip>
    <Chip color="var(--vv-color-type-connector)">Connector</Chip>
    <Chip color="var(--vv-color-type-agent)">Agent</Chip>
    <Chip color="var(--vv-color-type-resource)">Resource</Chip>
  </Row>
);

export const Removable = () => {
  const [tags, setTags] = useState(['growth', 'partners', 'q3-launch']);
  return (
    <Row gap={2} wrap>
      {tags.map((t) => (
        <Chip
          key={t}
          size="md"
          color="var(--vv-color-hue-teal)"
          onRemove={() => setTags(tags.filter((x) => x !== t))}
          removeLabel={`Remove ${t}`}
        >
          {t}
        </Chip>
      ))}
      <Chip size="md" tone="dashed" onClick={() => setTags(['growth', 'partners', 'q3-launch'])}>
        + Add tag
      </Chip>
    </Row>
  );
};

export const MemberAliases = () => (
  <Stack gap={2}>
    {[
      ['Ana Ruiz', [['Admin', 'var(--vv-color-hue-violet)'], ['Growth', 'var(--vv-color-hue-green)']]],
      ['Craig Tan', [['Member', null], ['Design', 'var(--vv-color-hue-pink)']]],
    ].map(([name, aliases]) => (
      <div key={name as string} className="flex w-72 items-center justify-between border-b border-line-subtle py-2">
        <span className="text-sm text-fg">{name as string}</span>
        <Row gap={1.5}>
          {(aliases as [string, string | null][]).map(([a, c]) => (
            <Chip key={a} color={c}>{a}</Chip>
          ))}
        </Row>
      </div>
    ))}
  </Stack>
);
