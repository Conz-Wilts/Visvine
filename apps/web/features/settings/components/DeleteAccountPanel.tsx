'use client';

// Settings → Account. The one destructive action a person can take on their own
// behalf: delete the account *and* the profile behind it.
//
// The profile is called out explicitly in the copy because the two must not come
// apart: leaving the `Person` row standing would outlive the account.
// `lib/account/deleteAccount.ts` erases both, and this panel promises exactly
// what that service does, no more.

import { useState } from 'react';
import { Alert, Button, Input, Modal, SettingsSection } from '@/components/ui';
import { fetchJsonBody } from '@/lib/fetchJson';
import { useSession } from '@/features/auth/lib/auth-client';

const REMOVED = [
  'Your profile — name, photo, bio, contact details and links',
  'Your personal notes and context in every space',
  'Your space memberships, aliases and context access',
  'Your messages, posts, comments and reactions',
  'Your entry in every space directory',
];

export default function DeleteAccountPanel() {
  const { data: session } = useSession();
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
    <SettingsSection
      title="Delete account"
      description="Removes your account and your profile data. This cannot be undone."
    >
      <ul className="mb-4 space-y-1 text-xs text-text-muted">
        {REMOVED.map((item) => (
          <li key={item} className="flex gap-2">
            <span aria-hidden>•</span>
            <span>{item}</span>
          </li>
        ))}
      </ul>
      <p className="mb-4 text-xs text-text-muted">
        Notes other people wrote about you in a space&apos;s shared context stay with that
        space — that text is theirs, not yours. Ask an admin of the space to remove it.
      </p>

      <Button variant="danger" onClick={() => setOpen(true)} disabled={!email}>
        Delete my account
      </Button>

      <Modal open={open} onClose={close} title="Delete account" size="sm">
        <div className="space-y-4">
          <Alert variant="warning">
            This permanently deletes your account and your profile. It cannot be undone, and
            support cannot restore it.
          </Alert>
          <p className="text-sm text-text-secondary">
            Type <span className="font-medium text-text-primary">{email}</span> to confirm.
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
