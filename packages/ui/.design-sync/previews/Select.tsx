import { useState } from 'react';
import { Select } from '@visvine/ui';

export const Default = () => {
  const [type, setType] = useState('text');
  return (
    <Select className="w-48" value={type} onChange={(e) => setType(e.target.value)} aria-label="Question type">
      <option value="text">Short answer</option>
      <option value="textarea">Paragraph</option>
      <option value="select">Dropdown</option>
      <option value="email">Email</option>
      <option value="linkedin">LinkedIn</option>
    </Select>
  );
};

export const PlusOnes = () => {
  const [n, setN] = useState('0');
  return (
    <Select className="w-32" value={n} onChange={(e) => setN(e.target.value)} aria-label="Guests">
      <option value="0">Just me</option>
      <option value="1">+1</option>
      <option value="2">+2</option>
    </Select>
  );
};

export const FullWidth = () => (
  <div className="w-80">
    <Select className="w-full" defaultValue="" aria-label="Team">
      <option value="">Select…</option>
      <option value="growth">Growth team</option>
      <option value="product">Product</option>
      <option value="ops">Operations</option>
    </Select>
  </div>
);

export const Disabled = () => (
  <Select className="w-48" disabled defaultValue="agent" aria-label="Page drawn by">
    <option value="agent">Agent page</option>
  </Select>
);
