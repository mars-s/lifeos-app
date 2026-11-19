"use client";

import { Dialog } from "radix-ui";
import type { ReactNode, RefObject } from "react";
import { cn } from "@/lib/utils";

export const BarDialog = ({
  title,
  onClose,
  onEscape,
  caretAtEnd,
  className,
  children,
}: {
  title: string;
  onClose: () => void;
  onEscape?: () => boolean;
  caretAtEnd?: RefObject<HTMLInputElement | null>;
  className?: string;
  children: ReactNode;
}) => (
  <Dialog.Root open onOpenChange={(open) => !open && onClose()}>
    <Dialog.Portal>
      <Dialog.Overlay className="fixed inset-0 z-[60] bg-black/15" />
      <Dialog.Content
        aria-describedby={undefined}
        onOpenAutoFocus={(event) => {
          const field = caretAtEnd?.current;
          if (!field) return;
          event.preventDefault();
          field.focus();
          field.setSelectionRange(field.value.length, field.value.length);
        }}
        onEscapeKeyDown={(event) => {
          if (onEscape?.()) event.preventDefault();
        }}
        className={cn(
          "fixed top-[max(1rem,14vh)] left-1/2 z-[61] w-[min(40rem,calc(100vw-2rem))] -translate-x-1/2 outline-none select-none",
          className,
        )}
      >
        <Dialog.Title className="sr-only">{title}</Dialog.Title>
        {children}
      </Dialog.Content>
    </Dialog.Portal>
  </Dialog.Root>
);
