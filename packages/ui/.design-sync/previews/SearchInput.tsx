import { useState } from 'react';
import { SearchInput, Stack } from '@visvine/ui';

export const Default = () => {
  const [q, setQ] = useState('');
  return (
    <div className="w-80">
      <SearchInput value={q} onChange={setQ} placeholder="Search the context…" />
    </div>
  );
};

export const Sizes = () => {
  const [sm, setSm] = useState('');
  const [md, setMd] = useState('');
  const [lg, setLg] = useState('');
  return (
    <div className="w-80">
      <Stack gap={3}>
        <SearchInput size="sm" value={sm} onChange={setSm} placeholder="Filter rows…" />
        <SearchInput size="md" value={md} onChange={setMd} placeholder="Search references…" />
        <SearchInput size="lg" value={lg} onChange={setLg} placeholder="Search the directory…" />
      </Stack>
    </div>
  );
};

export const WithQuery = () => {
  const [q, setQ] = useState('Ana Ruiz');
  return (
    <div className="w-80">
      <SearchInput size="lg" value={q} onChange={setQ} placeholder="Search the directory…" />
    </div>
  );
};

export const Toolbar = () => {
  const [q, setQ] = useState('hubspot');
  return (
    <div className="w-96 border-b border-line-subtle pb-3">
      <div className="flex items-center gap-3">
        <SearchInput size="sm" value={q} onChange={setQ} placeholder="Search connectors…" className="w-56" />
        <span className="text-sm text-fg-muted">3 of 12</span>
      </div>
    </div>
  );
};
