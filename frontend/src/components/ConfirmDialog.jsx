import Modal from './Modal';

/**
 * Styled confirmation dialog to replace window.confirm().
 * Shows an optional error (e.g. a blocked delete) without closing.
 */
export default function ConfirmDialog({
  open, title = 'Are you sure?', message, error,
  confirmLabel = 'Confirm', danger = true, busy = false,
  onConfirm, onCancel,
}) {
  return (
    <Modal open={open} onClose={busy ? undefined : onCancel} title={title} size="sm">
      <div className="space-y-3">
        {message && <p className="text-sm text-slate-600">{message}</p>}
        {error && <div className="text-sm text-red-700 bg-red-50 border border-red-100 rounded px-3 py-2">{error}</div>}
        <div className="flex justify-end gap-2 pt-2">
          <button type="button" onClick={onCancel} disabled={busy} className="btn-secondary">Cancel</button>
          <button
            type="button" onClick={onConfirm} disabled={busy}
            className={`btn-primary ${danger ? '!bg-red-600 hover:!bg-red-700 !border-red-600' : ''}`}
          >
            {busy ? 'Working…' : confirmLabel}
          </button>
        </div>
      </div>
    </Modal>
  );
}
