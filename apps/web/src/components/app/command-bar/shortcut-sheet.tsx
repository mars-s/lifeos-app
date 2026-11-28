"use client";

import { Fragment } from "react";
import { isTauri } from "@tauri-apps/api/core";
import { Kbd, KeyCombo } from "@/components/ui/key-hint";
import { BarDialog } from "./dialog";
import { SHORTCUT_GROUPS } from "./shortcuts";
import { bar } from "./store";

export const ShortcutSheet = () => {
  const surface = isTauri() ? "app" : "browser";
  return (
    <BarDialog title="Keyboard shortcuts" onClose={bar.close} className="top-[max(1rem,10vh)] w-[min(46rem,calc(100vw-2rem))]">
      <div role="region" aria-label="Keyboard shortcuts" tabIndex={0} className="max-h-[80vh] overflow-y-auto overscroll-contain rounded-2xl bg-popover text-foreground shadow-float">
        <div className="flex h-12 items-center justify-between px-5">
          <h2 className="text-heading font-medium">Keyboard shortcuts</h2>
          <Kbd>Esc</Kbd>
        </div>
        <div className="grid gap-x-8 gap-y-5 bg-foreground/[0.03] px-5 pt-4 pb-5 sm:grid-cols-2">
          {SHORTCUT_GROUPS.map((group) => (
            <section key={group.title} aria-label={group.title}>
              <h3 className="pb-1.5 text-small text-faint-foreground">{group.title}</h3>
              <dl>
                {group.shortcuts
                  .filter((shortcut) => !shortcut.only || shortcut.only === surface)
                  .map((shortcut) => (
                    <div key={shortcut.label} className="flex h-8 items-center justify-between gap-4 text-small">
                      <dt className="min-w-0 truncate">{shortcut.label}</dt>
                      <dd className="flex shrink-0 items-center gap-1.5 text-faint-foreground">
                        {shortcut.keys.map((keys, index) => (
                          <Fragment key={keys}>
                            {index > 0 && <span>{shortcut.joiner ?? "or"}</span>}
                            <KeyCombo keys={keys} />
                          </Fragment>
                        ))}
                      </dd>
                    </div>
                  ))}
              </dl>
            </section>
          ))}
        </div>
      </div>
    </BarDialog>
  );
};
