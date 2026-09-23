import { useState } from 'react';
import { Input, Stack } from '@visvine/ui';

export const Default = () => {
  const [name, setName] = useState('Growth team');
  return (
    <div className="w-80">
      <Input value={name} onChange={(e) => setName(e.target.value)} aria-label="Space name" />
    </div>
  );
};

export const Placeholder = () => (
  <div className="w-80">
    <Input placeholder="ana.ruiz@growth.team" type="email" aria-label="Email" />
  </div>
);

export const Kinds = () => (
  <div className="w-80">
    <Stack gap={3}>
      <Input type="text" defaultValue="Standup digest" aria-label="Agent name" />
      <Input type="number" defaultValue={40} min={0} aria-label="Capacity" />
      <Input type="url" defaultValue="https://api.hubapi.com" aria-label="Host" />
    </Stack>
  </div>
);

export const Disabled = () => (
  <div className="w-80">
    <Stack gap={3}>
      <Input disabled defaultValue="growth" aria-label="Handle" />
      <Input readOnly defaultValue="connector:hubspot" aria-label="Node id" />
    </Stack>
  </div>
);
