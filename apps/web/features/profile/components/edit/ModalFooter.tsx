import { Button } from '@visvine/ui';

interface ModalFooterProps {
  onCancel: () => void;
  saving: boolean;
}

/**
 * Shared Cancel / Save footer for the profile edit modals. The Save button is
 * type="submit", so it submits the enclosing <form> (which runs the modal's
 * handleSubmit).
 */
export default function ModalFooter({ onCancel, saving }: ModalFooterProps) {
  return (
    <div className="flex justify-end gap-2 pt-2">
      <Button type="button" variant="neutral" onClick={onCancel}>
        Cancel
      </Button>
      <Button type="submit" variant="brand" loading={saving} loadingText="Saving…">
        Save
      </Button>
    </div>
  );
}
