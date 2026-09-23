import { useState } from 'react';
import { Field, Input, Select, Stack, Textarea } from '@visvine/ui';

export const Default = () => {
  const [name, setName] = useState('Growth team');
  return (
    <div className="w-80">
      <Field label="Name">
        <Input value={name} onChange={(e) => setName(e.target.value)} />
      </Field>
    </div>
  );
};

export const WithHint = () => (
  <div className="w-80">
    <Field label="Handle" hint="Letters, numbers and dashes.">
      <Input defaultValue="growth" />
    </Field>
  </div>
);

export const WithError = () => (
  <div className="w-80">
    <Field label="Name" error="A sibling room already has this name.">
      <Input defaultValue="Launch room" />
    </Field>
  </div>
);

export const Form = () => (
  <div className="w-80">
    <Stack gap={4}>
      <Field label="Name">
        <Input defaultValue="Standup digest" />
      </Field>
      <Field label="Description">
        <Textarea rows={3} defaultValue="Every weekday at 9am, a summary of what the Growth team shipped." />
      </Field>
      <Field label="Page drawn by">
        <Select className="w-56" defaultValue="agent">
          <option value="agent">Agent page</option>
          <option value="note">Note</option>
        </Select>
      </Field>
    </Stack>
  </div>
);
