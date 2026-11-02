"use client";

import { useEffect, useRef, type ReactNode } from "react";
import { X } from "lucide-react";

const FOCUSABLE =
  'a[href], button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])';

type ModalShellProps = {
  open: boolean;
  onClose: () => void;
  title: string;
  eyebrow?: string;
  children: ReactNode;
  footer?: ReactNode;
  variant?: "modal" | "drawer";
  size?: "md" | "lg";
};

/**
 * Accessible dialog shell shared by the reservation form, table assignment
 * dialog, confirm dialog and details drawer. Handles Escape-to-close, overlay
 * click, a basic focus trap, body scroll lock and focus restoration.
 */
export function ModalShell({
  open,
  onClose,
  title,
  eyebrow,
  children,
  footer,
  variant = "modal",
  size = "md",
}: ModalShellProps) {
  const panelRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return undefined;

    const previouslyFocused = document.activeElement as HTMLElement | null;
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";

    const raf = requestAnimationFrame(() => {
      const first = panelRef.current?.querySelector<HTMLElement>(FOCUSABLE);
      (first ?? panelRef.current)?.focus();
    });

    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        event.stopPropagation();
        onClose();
        return;
      }
      if (event.key !== "Tab" || !panelRef.current) return;

      const items = Array.from(
        panelRef.current.querySelectorAll<HTMLElement>(FOCUSABLE),
      ).filter((el) => el.offsetParent !== null);
      if (items.length === 0) {
        event.preventDefault();
        return;
      }
      const first = items[0];
      const last = items[items.length - 1];
      const active = document.activeElement as HTMLElement | null;

      if (event.shiftKey) {
        if (active === first || !panelRef.current.contains(active)) {
          event.preventDefault();
          last.focus();
        }
      } else if (active === last) {
        event.preventDefault();
        first.focus();
      }
    };

    document.addEventListener("keydown", onKeyDown, true);
    return () => {
      cancelAnimationFrame(raf);
      document.removeEventListener("keydown", onKeyDown, true);
      document.body.style.overflow = previousOverflow;
      previouslyFocused?.focus?.();
    };
  }, [open, onClose]);

  if (!open) return null;

  const isDrawer = variant === "drawer";

  return (
    <div
      className={isDrawer ? "res-drawer-overlay" : "modal-overlay"}
      onMouseDown={(event) => {
        if (event.target === event.currentTarget) onClose();
      }}
    >
      <div
        ref={panelRef}
        role="dialog"
        aria-modal="true"
        aria-label={title}
        tabIndex={-1}
        className={
          isDrawer
            ? "res-drawer"
            : `modal-content res-modal-content res-modal-${size}`
        }
      >
        <div
          className={isDrawer ? "res-drawer-header" : "modal-header"}
        >
          <div className="res-modal-heading">
            {eyebrow ? <p className="res-modal-eyebrow">{eyebrow}</p> : null}
            <h2>{title}</h2>
          </div>
          <button
            type="button"
            className="modal-close"
            onClick={onClose}
            aria-label="Close dialog"
            title="Close"
          >
            <X size={16} />
          </button>
        </div>
        <div className={isDrawer ? "res-drawer-body" : "modal-body"}>
          {children}
        </div>
        {footer ? (
          <div className={isDrawer ? "res-drawer-footer" : "modal-footer"}>
            {footer}
          </div>
        ) : null}
      </div>
    </div>
  );
}
