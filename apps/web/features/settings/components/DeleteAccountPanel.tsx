'use client';

// Settings → General → Delete account. The one destructive action a person can take on their own
// behalf: delete the account *and* the profile behind it.
//
// The profile is called out explicitly in the copy because the two must not come
// apart: leaving the `Person` row standing would outlive the account.
// `lib/account/deleteAccount.ts` erases both, and this panel promises exactly
// what that service does, no more.

import { useState } from 'react';
import { Alert, Button, Input, Modal, SettingsSection } from '@visvine/ui';
import { fetchJsonBody } from '@/lib/fetchJson';
import { useAuth } from '@/features/auth/contexts/AuthContext';

export default function DeleteAccountPanel() {
  const { session } = useAuth();
  const email = session?.user.email ?? null;

  const [open, setOpen] = useState(false);
  const [typed, setTyped] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const matches = !!email && typed.trim().toLowerCase() === email.toLowerCase();

  const close = () => {
    if (busy) return;
    setOpen(false);
    setTyped('');
    setError(null);
  };

  const confirm = async () => {
    if (!matches || busy) return;
    setBusy(true);
    setError(null);
    try {
      await fetchJsonBody('/api/account', 'DELETE', { confirmEmail: typed.trim() });
      // The server already dropped the cookie. A full navigation, not the
      // router: every provider above this point holds a session for a user that
      // no longer exists, so the tree has to be thrown away rather than
      // re-rendered. `replace` so Back can't return to a signed-in-looking page,
      // and an absolute URL because that's the form the lint rule accepts (same
      // as the 401 bail-out in lib/fetchJson.ts).
      window.location.replace(new URL('/', window.location.origin));
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Could not delete the account.');
      setBusy(false);
    }
  };

  return (
    <SettingsSection title="Delete account">
      <Button variant="danger" onClick={() => setOpen(true)} disabled={!email}>
        Delete my account
      </Button>

      <Modal open={open} onClose={close} title="Delete account" size="sm">
        <div className="space-y-4 p-6">
          <p className="text-sm text-fg-secondary">
            This cannot be undone. Type <span className="font-medium text-fg">{email}</span> to confirm.
          </p>
          <Input
            value={typed}
            onChange={(e) => setTyped(e.target.value)}
            placeholder={email ?? ''}
            autoComplete="off"
            aria-label="Confirm your email address"
            disabled={busy}
          />
          {error && <Alert variant="error">{error}</Alert>}
          <div className="flex justify-end gap-2">
            <Button variant="neutral" onClick={close} disabled={busy}>
              Cancel
            </Button>
            <Button
              variant="danger"
              onClick={confirm}
              disabled={!matches}
              loading={busy}
              loadingText="Deleting…"
            >
              Delete for ever
            </Button>
          </div>
        </div>
      </Modal>
    </SettingsSection>
  );
}
