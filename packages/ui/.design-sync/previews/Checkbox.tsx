import { useState } from 'react';
import { Checkbox, Stack } from '@visvine/ui';

export const Labeled = () => {
  const [on, setOn] = useState(true);
  return <Checkbox checked={on} onChange={setOn} label="Required" />;
};

export const States = () => (
  <Stack gap={3}>
    <Checkbox checked={false} onChange={() => {}} label="Unchecked" />
    <Checkbox checked onChange={() => {}} label="Checked" />
    <Checkbox checked={false} indeterminate onChange={() => {}} label="Some selected" />
    <Checkbox checked disabled onChange={() => {}} label="Disabled" />
    <Checkbox checked={false} invalid onChange={() => {}} label="Accept the terms" />
  </Stack>
);

export const Sizes = () => (
  <Stack gap={3}>
    <Checkbox size="sm" checked onChange={() => {}} label="Small" />
    <Checkbox size="md" checked onChange={() => {}} label="Medium" />
  </Stack>
);

const ROOMS = [
  { id: 'design', name: 'Design crit' },
  { id: 'launch', name: 'Launch room' },
  { id: 'partners', name: 'Partners' },
];

export const ShareWithRooms = () => {
  const [picked, setPicked] = useState<Set<string>>(new Set(['design']));
  return (
    <div className="w-72 divide-y divide-line-subtle border-y border-line-subtle">
      {ROOMS.map((room) => (
        <div key={room.id} className="flex items-center justify-between py-2.5">
          <span className="text-sm text-fg">{room.name}</span>
          <Checkbox
            checked={picked.has(room.id)}
            aria-label={`Share with ${room.name}`}
            onChange={(on) => {
              const copy = new Set(picked);
              if (on) copy.add(room.id);
              else copy.delete(room.id);
              setPicked(copy);
            }}
          />
        </div>
      ))}
    </div>
  );
};
