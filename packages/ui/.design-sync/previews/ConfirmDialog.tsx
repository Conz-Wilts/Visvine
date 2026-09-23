import { ConfirmDialog } from '@visvine/ui';

export const Destructive = () => (
  <ConfirmDialog
    open
    title="Delete HubSpot?"
    body="Its stored secrets stay."
    confirmLabel="Delete"
    destructive
    onConfirm={() => {}}
    onClose={() => {}}
  />
);

export const TypeToConfirm = () => (
  <ConfirmDialog
    open
    title="Delete Growth team?"
    body="Every note, channel and event in this space goes with it."
    confirmLabel="Delete space"
    confirmText="Growth team"
    destructive
    onConfirm={() => {}}
    onClose={() => {}}
  />
);

export const WithError = () => (
  <ConfirmDialog
    open
    title="Uninstall Standup digest?"
    body="Anything it stored goes with it. Notes it wrote stay."
    confirmLabel="Uninstall"
    error="The tool is still running. Try again when this run finishes."
    onConfirm={() => {}}
    onClose={() => {}}
  />
);
