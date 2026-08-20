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
    <div className="flex justify-end gap-3 pt-2">
      <button type="button" onClick={onCancel} className="px-4 py-2 text-sm font-medium text-brand-grey border border-border-subtle rounded-xl hover:bg-surface-2 transition-colors">
        Cancel
      </button>
      <button type="submit" disabled={saving} className="px-4 py-2 text-sm font-medium text-white bg-brand-black rounded-xl hover:opacity-80 transition-opacity disabled:opacity-50">
        {saving ? 'Saving…' : 'Save'}
      </button>
    </div>
  );
}
