"use client";

import { AlertDialog } from "radix-ui";
import { useSyncExternalStore } from "react";
import { haptic } from "@/lib/haptics";

type Request = { title: string; body: string; action: string; onConfirm: () => void };

let request: Request | null = null;
const listeners = new Set<() => void>();

const set = (next: Request | null) => {
  request = next;
  listeners.forEach((listener) => listener());
};

const subscribe = (listener: () => void) => {
  listeners.add(listener);
  return () => void listeners.delete(listener);
};

export const askToConfirm = (next: Request) => set(next);

const buttonClass =
  "h-9 rounded-full px-4 text-small font-medium transition-[background-color,scale] duration-(--dur-press) ease-out active:scale-[0.97]";

export const ConfirmHost = () => {
  const current = useSyncExternalStore(subscribe, () => request, () => null);
  return (
    <AlertDialog.Root open={current !== null} onOpenChange={(open) => !open && set(null)}>
      <AlertDialog.Portal>
        <AlertDialog.Overlay className="fixed inset-0 z-[70] bg-black/30 data-[state=closed]:animate-fade-out data-[state=open]:animate-fade-in" />
        <AlertDialog.Content className="fixed top-1/2 left-1/2 z-[71] w-[min(22rem,calc(100vw-2rem))] -translate-x-1/2 -translate-y-1/2 rounded-2xl bg-popover p-5 shadow-float outline-none data-[state=closed]:animate-dialog-out data-[state=open]:animate-dialog-in">
          <AlertDialog.Title className="text-heading font-medium text-balance">{current?.title}</AlertDialog.Title>
          <AlertDialog.Description className="mt-1.5 text-small text-pretty text-muted-foreground">{current?.body}</AlertDialog.Description>
          <div className="mt-5 flex justify-end gap-2">
            <AlertDialog.Cancel className={`${buttonClass} bg-foreground/[0.06] hover:bg-foreground/[0.1]`}>Cancel</AlertDialog.Cancel>
            <AlertDialog.Action
              onClick={() => {
                haptic("drop");
                current?.onConfirm();
              }}
              className={`${buttonClass} bg-negative text-background hover:bg-negative/90`}
            >
              {current?.action}
            </AlertDialog.Action>
          </div>
        </AlertDialog.Content>
      </AlertDialog.Portal>
    </AlertDialog.Root>
  );
};
