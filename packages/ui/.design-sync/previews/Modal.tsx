import { useState } from 'react';
import { Alert, Avatar, Button, Chip, Input, Modal, Row, Stack } from '@visvine/ui';

export const DeleteAccount = () => {
  const [typed, setTyped] = useState('');
  const email = 'ana.ruiz@growthteam.co';
  return (
    <Modal open onClose={() => {}} title="Delete account" size="sm">
      <div className="space-y-4 p-6">
        <p className="text-sm text-fg-secondary">
          This cannot be undone. Type <span className="font-medium text-fg">{email}</span> to confirm.
        </p>
        <Input
          value={typed}
          onChange={(e) => setTyped(e.target.value)}
          placeholder={email}
          aria-label="Confirm your email address"
        />
        <Row gap={2} justify="end">
          <Button variant="neutral">Cancel</Button>
          <Button variant="danger" disabled={typed !== email}>Delete for ever</Button>
        </Row>
      </div>
    </Modal>
  );
};

export const WithFooter = () => (
  <Modal
    open
    onClose={() => {}}
    title="Rename channel"
    size="md"
    footer={
      <Row gap={2} justify="end" className="border-t border-line-subtle px-6 py-4">
        <Button variant="neutral">Cancel</Button>
        <Button variant="brand">Save</Button>
      </Row>
    }
  >
    <Stack gap={2} className="p-6">
      <label className="text-sm font-medium text-fg" htmlFor="channel-name">Name</label>
      <Input id="channel-name" defaultValue="standup-digest" />
    </Stack>
  </Modal>
);

const MEMBERS = [
  { name: 'Ana Ruiz', role: 'Admin', joined: 'Joined Mar 2026' },
  { name: 'Craig Tan', role: 'Member', joined: 'Joined Apr 2026' },
  { name: 'Priya Nair', role: 'Member', joined: 'Joined Jun 2026' },
  { name: 'Tomás Silva', role: 'Guest', joined: 'Joined Aug 2026' },
];

export const LargeList = () => (
  <Modal
    open
    onClose={() => {}}
    title="Growth team · Members"
    size="lg"
    footer={
      <Row gap={2} justify="end" className="border-t border-line-subtle px-6 py-4">
        <Button variant="brand">Done</Button>
      </Row>
    }
  >
    <div className="divide-y divide-line-subtle px-6">
      {MEMBERS.map((m) => (
        <Row key={m.name} gap={3} className="py-3">
          <Avatar name={m.name} size="sm" />
          <div className="min-w-0 flex-1">
            <div className="truncate text-sm font-semibold text-fg">{m.name}</div>
            <div className="truncate text-xs text-fg-muted">{m.joined}</div>
          </div>
          <Chip tone="muted" size="sm">{m.role}</Chip>
        </Row>
      ))}
    </div>
  </Modal>
);

export const WithError = () => (
  <Modal
    open
    onClose={() => {}}
    title="Disconnect HubSpot"
    size="sm"
    footer={
      <Row gap={2} justify="end" className="border-t border-line-subtle px-6 py-4">
        <Button variant="neutral">Cancel</Button>
        <Button variant="danger" loading loadingText="Disconnecting…">Disconnect</Button>
      </Row>
    }
  >
    <div className="space-y-4 p-6">
      <p className="text-sm text-fg-secondary">
        Agents that declare <span className="font-medium text-fg">hubspot</span> stop reaching it. Its secrets stay.
      </p>
      <Alert variant="error">Standup digest is running on it right now.</Alert>
    </div>
  </Modal>
);
