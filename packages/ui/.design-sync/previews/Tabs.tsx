import { useState } from 'react';
import { Stack, Tabs } from '@visvine/ui';

type Filter = 'all' | 'files' | 'links' | 'images';
const FILTERS: { id: Filter; label: string }[] = [
  { id: 'all', label: 'All' },
  { id: 'files', label: 'Files' },
  { id: 'links', label: 'Links' },
  { id: 'images', label: 'Images' },
];

export const Default = () => {
  const [filter, setFilter] = useState<Filter>('all');
  return <Tabs options={FILTERS} value={filter} onChange={setFilter} label="Resources" />;
};

type View = 'grid' | 'context' | 'table' | 'resources';
const VIEWS: { id: View; label: string }[] = [
  { id: 'grid', label: 'Grid' },
  { id: 'context', label: 'Context' },
  { id: 'table', label: 'Table' },
  { id: 'resources', label: 'Resources' },
];

export const Sizes = () => {
  const [sm, setSm] = useState<View>('context');
  const [md, setMd] = useState<View>('table');
  const [lg, setLg] = useState<View>('grid');
  return (
    <Stack gap={3}>
      <Tabs size="sm" options={VIEWS} value={sm} onChange={setSm} label="Small" />
      <Tabs size="md" options={VIEWS} value={md} onChange={setMd} label="Medium" />
      <Tabs size="lg" options={VIEWS} value={lg} onChange={setLg} label="Large" />
    </Stack>
  );
};

type Mode = 'profile' | 'context' | 'raw';
export const ProfileHeader = () => {
  const [mode, setMode] = useState<Mode>('profile');
  return (
    <div className="w-80 border-b border-line-subtle">
      <Tabs
        size="sm"
        value={mode}
        onChange={setMode}
        label="Ana Ruiz"
        options={[
          { id: 'profile', label: 'Profile' },
          { id: 'context', label: 'Context' },
          { id: 'raw', label: 'Raw' },
        ]}
      />
    </div>
  );
};
