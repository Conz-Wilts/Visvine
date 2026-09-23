import { Button, Row } from '@visvine/ui';

export const Brand = () => <Button variant="brand">Copy URL</Button>;

export const Variants = () => (
  <Row gap={3} wrap>
    <Button variant="brand">Approve</Button>
    <Button variant="neutral">Deny</Button>
    <Button variant="danger">Delete my account</Button>
    <Button variant="danger-text">Disconnect</Button>
    <Button variant="ghost" size="sm">Reload</Button>
  </Row>
);

export const DialogFooter = () => (
  <div className="w-96 border-t border-line-subtle pt-4">
    <Row gap={2} justify="end">
      <Button variant="neutral">Cancel</Button>
      <Button variant="danger">Delete</Button>
    </Row>
  </div>
);

export const States = () => (
  <Row gap={3} wrap>
    <Button variant="brand" loading loadingText="Saving…">Save</Button>
    <Button variant="brand" disabled>Publish</Button>
    <Button variant="neutral" disabled>Cancel</Button>
  </Row>
);
