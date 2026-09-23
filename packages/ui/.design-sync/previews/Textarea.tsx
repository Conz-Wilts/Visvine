import { useState } from 'react';
import { Textarea } from '@visvine/ui';

export const Default = () => {
  const [value, setValue] = useState(
    'The growth team’s shared context: pipeline, partners and the weekly standup digest.',
  );
  return (
    <div className="w-80">
      <Textarea rows={3} value={value} onChange={(e) => setValue(e.target.value)} aria-label="Description" />
    </div>
  );
};

export const Placeholder = () => (
  <div className="w-80">
    <Textarea rows={3} placeholder="Tell Ana why you need access to connectors/hubspot…" aria-label="Message" />
  </div>
);

export const Disabled = () => (
  <div className="w-80">
    <Textarea
      rows={2}
      disabled
      defaultValue="Approved — ships to the Growth team rail on publish."
      aria-label="Note to the author"
    />
  </div>
);
