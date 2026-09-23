import { useState } from 'react';
import { Alert, Button, Row, Stack } from '@visvine/ui';

export const ErrorNotice = () => (
  <div className="w-96">
    <Alert variant="error">Couldn't save the schedule. Try again in a moment.</Alert>
  </div>
);

export const Variants = () => (
  <Stack gap={4} className="w-96">
    <Alert variant="error">HubSpot refused the key: 401 Unauthorized.</Alert>
    <Alert variant="warning">Standup digest has no model to run on.</Alert>
    <Alert variant="info">Listing marked pending</Alert>
    <Alert variant="success">Listed</Alert>
  </Stack>
);

export const Dismissible = () => {
  const [open, setOpen] = useState(true);
  return (
    <div className="w-96">
      {open ? (
        <Alert variant="error" onDismiss={() => setOpen(false)}>
          The type "Investor" already exists in Growth team.
        </Alert>
      ) : (
        <Button variant="ghost" size="sm" onClick={() => setOpen(true)}>Show again</Button>
      )}
    </div>
  );
};

export const InlineInFooter = () => (
  <div className="w-96 border-t border-line-subtle pt-4">
    <Stack gap={3}>
      <Alert variant="error" inline>Type your email to confirm.</Alert>
      <Row gap={2} justify="end">
        <Button variant="neutral">Cancel</Button>
        <Button variant="danger">Delete my account</Button>
      </Row>
    </Stack>
  </div>
);
