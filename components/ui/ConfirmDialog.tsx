"use client";

import React, { useState } from "react";
import { Icon } from "./Icon";
import { Sheet } from "./Sheet";

// Generic confirm modal. When `confirmText` is set, the user must type it
// exactly to enable the confirm button (used for project deletion).
export function ConfirmDialog({
  open,
  title,
  message,
  confirmText,
  confirmLabel = "Confirm",
  cancelLabel = "Cancel",
  danger = false,
  form = false,
  onConfirm,
  onCancel,
}: {
  open: boolean;
  title: string;
  message: React.ReactNode;
  confirmText?: string;
  confirmLabel?: string;
  cancelLabel?: string;
  danger?: boolean;
  /**
   * The message is a set of fields rather than a question. Drops the centred
   * icon and left-aligns the heading — a centred alert glyph above a column of
   * left-aligned labels reads as a warning about the form, not as its title.
   */
  form?: boolean;
  onConfirm: () => void;
  onCancel: () => void;
}) {
  const [typed, setTyped] = useState("");
  const locked = confirmText ? typed !== confirmText : false;

  return (
    <Sheet
      open={open}
      onClose={onCancel}
      size="sm"
      bare
      footer={
        // Stacked on mobile with the confirm on top: on a phone the thumb
        // rests at the bottom of the screen, so the *safe* choice belongs
        // there, nearest the thumb, and the committing one above it.
        <div className="flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">
          <button type="button" className="btn-secondary sm:w-auto" onClick={onCancel}>
            {cancelLabel}
          </button>
          <button
            type="button"
            className={`${danger ? "btn-danger" : "btn-primary"} sm:w-auto`}
            disabled={locked}
            onClick={() => {
              setTyped("");
              onConfirm();
            }}
          >
            {confirmLabel}
          </button>
        </div>
      }
    >
      <div className={`pt-2 sm:pt-4 ${form ? "text-left" : "text-center"}`}>
        {form ? null : (
          <span
            className={`mx-auto mb-3.5 flex h-12 w-12 items-center justify-center rounded-2xl ${
              danger ? "bg-red-50 text-red-600" : "bg-brand-50 text-brand-700"
            }`}
          >
            <Icon name={danger ? "alert" : "info"} size={22} />
          </span>
        )}
        <h3 className="text-lg font-bold tracking-[-0.01em] text-gray-900">{title}</h3>
        <div className={`text-sm leading-relaxed text-gray-600 ${form ? "mt-3" : "mt-2"}`}>
          {message}
        </div>
      </div>

      {confirmText ? (
        <input
          className="input mt-4"
          placeholder={`Type “${confirmText}” to confirm`}
          value={typed}
          onChange={(e) => setTyped(e.target.value)}
          autoComplete="off"
        />
      ) : null}
    </Sheet>
  );
}
