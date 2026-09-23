import { useState } from 'react';
import { Button, Field, Input, SettingsSection, Stack, Toggle } from '@visvine/ui';

export const WithControls = () => {
  const [name, setName] = useState('Growth team');
  return (
    <div className="max-w-xl">
      <SettingsSection title="General" description="Shown on the switcher and the space's overview page.">
        <Stack gap={4}>
          <Field label="Name">
            <Input value={name} onChange={(e) => setName(e.target.value)} />
          </Field>
          <Field label="Handle" hint="Letters, numbers and dashes.">
            <Input defaultValue="growth" />
          </Field>
        </Stack>
      </SettingsSection>
    </div>
  );
};

export const HeaderAction = () => (
  <div className="max-w-xl">
    <SettingsSection flush large title="Active tools" action={<Button variant="brand">Add tool</Button>}>
      <div className="-mt-3 divide-y divide-line-subtle">
        {[
          ['Channels', 'Conversations in rooms and DMs'],
          ['Events', 'Ticketed events with public pages'],
        ].map(([label, description]) => (
          <div key={label} className="flex items-center gap-3.5 py-4">
            <div className="min-w-0 flex-1">
              <div className="truncate text-base font-semibold text-fg">{label}</div>
              <div className="truncate text-sm text-fg-muted">{description}</div>
            </div>
            <Toggle checked onChange={() => {}} aria-label={`Turn off ${label}`} />
          </div>
        ))}
      </div>
    </SettingsSection>
  </div>
);

export const Stacked = () => (
  <div className="max-w-xl space-y-8">
    <SettingsSection title="MCP" description="Connect Claude to this space.">
      <Button variant="brand">Copy URL</Button>
    </SettingsSection>
    <SettingsSection title="Delete account">
      <Button variant="danger">Delete my account</Button>
    </SettingsSection>
  </div>
);
