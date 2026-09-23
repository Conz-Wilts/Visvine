import { useState } from 'react';
import { Row, Stack, Toggle } from '@visvine/ui';

export const Default = () => {
  const [on, setOn] = useState(true);
  return <Toggle checked={on} onChange={setOn} aria-label="Active" />;
};

export const States = () => (
  <Row gap={4}>
    <Toggle checked onChange={() => {}} aria-label="On" />
    <Toggle checked={false} onChange={() => {}} aria-label="Off" />
    <Toggle checked disabled onChange={() => {}} aria-label="On, disabled" />
    <Toggle checked={false} disabled onChange={() => {}} aria-label="Off, disabled" />
  </Row>
);

export const Labeled = () => {
  const [approval, setApproval] = useState(false);
  const [guests, setGuests] = useState(true);
  const [maybe, setMaybe] = useState(true);
  return (
    <Stack gap={3}>
      <Toggle checked={approval} onChange={setApproval} label="Require approval" />
      <Toggle checked={guests} onChange={setGuests} label="Show guest list" />
      <Toggle checked={maybe} onChange={setMaybe} label={'Allow "Maybe"'} />
    </Stack>
  );
};

const TOOLS = [
  ['Channels', 'Conversations in rooms and DMs'],
  ['Events', 'Ticketed events with public pages'],
];

export const ToolRows = () => {
  const [on, setOn] = useState<Record<string, boolean>>({ Channels: true, Events: false });
  return (
    <div className="w-96 divide-y divide-line-subtle">
      {TOOLS.map(([label, description]) => (
        <div key={label} className="flex items-center gap-3.5 py-3">
          <div className="min-w-0 flex-1">
            <div className="truncate text-sm font-semibold text-fg">{label}</div>
            <div className="truncate text-sm text-fg-muted">{description}</div>
          </div>
          <Toggle
            checked={on[label]}
            onChange={(v) => setOn({ ...on, [label]: v })}
            aria-label={label}
          />
        </div>
      ))}
    </div>
  );
};
