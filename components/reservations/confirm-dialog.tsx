"use client";

import { useState } from "react";
import { AlertTriangle } from "lucide-react";
import { ModalShell } from "./modal-shell";

type ConfirmDialogProps = {
  open: boolean;
  title: string;
  message: string;
  confirmLabel?: string;
  cancelLabel?: string;
  danger?: boolean;
  onConfirm: () => void | Promise<void>;
  onClose: () => void;
};

/**
 * Confirmation dialog for destructive or irreversible actions (cancelling a
 * reservation, marking a no-show, …). Shows a loading state while the async
 * confirmation runs and only closes when it resolves.
 */
export function ReservationConfirmDialog({
  open,
  title,
  message,
  confirmLabel = "Confirm",
  cancelLabel = "Keep reservation",
  danger = true,
  onConfirm,
  onClose,
}: ConfirmDialogProps) {
  const [busy, setBusy] = useState(false);

  const handleConfirm = async () => {
    setBusy(true);
    try {
      await onConfirm();
    } finally {
      setBusy(false);
    }
  };

  return (
    <ModalShell
      open={open}
      onClose={busy ? () => undefined : onClose}
      title={title}
      size="md"
      footer={
        <>
          <button
            type="button"
            className="btn-ghost"
            onClick={onClose}
            disabled={busy}
          >
            {cancelLabel}
          </button>
          <button
            type="button"
            className={danger ? "res-btn-danger" : "btn-primary"}
            onClick={handleConfirm}
            disabled={busy}
          >
            {busy ? "Working…" : confirmLabel}
          </button>
        </>
      }
    >
      <div className="res-confirm-body">
        <span
          className={`res-confirm-icon ${danger ? "danger" : ""}`}
          aria-hidden="true"
        >
          <AlertTriangle size={20} />
        </span>
        <p>{message}</p>
      </div>
    </ModalShell>
  );
}
