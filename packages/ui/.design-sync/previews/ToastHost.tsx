import { Button, Chip, Row, SettingsSection, ToastHost, Toggle, TypeSilhouette } from '@visvine/ui';

// ToastHost is fixed to the viewport's bottom-right, so each story draws the
// screen it lands on: the Console's Connectors section.
const CONNECTORS = [
  { name: 'HubSpot', state: 'Signed in · 3 agents', on: true },
  { name: 'Google Calendar', state: 'Signed in · 1 agent', on: true },
  { name: 'Slack', state: 'Needs sign-in', on: false },
];

const Screen = () => (
  <div className="p-8">
    <SettingsSection flush large title="Connectors" action={<Button variant="brand">Add connector</Button>}>
      <div className="-mt-3 divide-y divide-line-subtle">
        {CONNECTORS.map((c) => (
          <Row key={c.name} gap={3} className="py-3">
            <span className="block h-8 w-8 flex-none overflow-hidden rounded-lg">
              <TypeSilhouette glyph="connector" color="var(--vv-color-type-connector)" />
            </span>
            <div className="min-w-0 flex-1">
              <div className="truncate text-sm font-semibold text-fg">{c.name}</div>
              <div className="truncate text-xs text-fg-muted">{c.state}</div>
            </div>
            {!c.on && <Chip tone="muted" size="sm">Off</Chip>}
            <Toggle checked={c.on} onChange={() => {}} aria-label={`${c.name} on`} />
          </Row>
        ))}
      </div>
    </SettingsSection>
  </div>
);

export const Success = () => (
  <>
    <Screen />
    <ToastHost onDismiss={() => {}} toasts={[{ id: 1, tone: 'success', message: 'Connected Google Calendar.' }]} />
  </>
);

export const ErrorStays = () => (
  <>
    <Screen />
    <ToastHost
      onDismiss={() => {}}
      toasts={[{ id: 1, tone: 'error', message: 'Slack refused the token: 401 Unauthorized.' }]}
    />
  </>
);

export const Stacked = () => (
  <>
    <Screen />
    <ToastHost
      onDismiss={() => {}}
      toasts={[
        { id: 1, tone: 'info', message: 'Standup digest is running.' },
        { id: 2, tone: 'warning', message: 'HubSpot needs signing in again.' },
        { id: 3, tone: 'success', message: 'Installed Lead scorer in Growth team.' },
      ]}
    />
  </>
);
