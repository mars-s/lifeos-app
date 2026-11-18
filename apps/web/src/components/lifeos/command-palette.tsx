"use client";

import { MagnifyingGlass, type Icon } from "@phosphor-icons/react";
import { useId, useState } from "react";
import { Kbd, KeyCombo } from "@/components/ui/key-hint";
import { cn } from "@/lib/utils";

export type Command = { id: string; group: string; label: string; icon: Icon; keys?: string };

export const CommandPalette = ({
  commands,
  onRun,
  className,
}: {
  commands: Command[];
  onRun: (command: Command) => void;
  className?: string;
}) => {
  const listId = useId();
  const [query, setQuery] = useState("");
  const [activeIndex, setActiveIndex] = useState(0);

  const matches = commands.filter((command) => command.label.toLowerCase().includes(query.trim().toLowerCase()));
  const active = matches[Math.min(activeIndex, matches.length - 1)];
  const groups = [...new Set(matches.map((command) => command.group))];

  const onKeyDown = (event: React.KeyboardEvent) => {
    if (event.key === "ArrowDown" || event.key === "ArrowUp") {
      event.preventDefault();
      const step = event.key === "ArrowDown" ? 1 : -1;
      setActiveIndex((Math.min(activeIndex, matches.length - 1) + step + matches.length) % Math.max(1, matches.length));
    }
    if (event.key === "Enter" && active) onRun(active);
    if (event.key === "Escape") setQuery("");
  };

  return (
    <div className={cn("w-full overflow-hidden rounded-2xl bg-popover shadow-float", className)}>
      <label className="flex h-12 items-center gap-3 px-4">
        <MagnifyingGlass weight="bold" className="size-4 shrink-0 text-muted-foreground" aria-hidden="true" />
        <input
          role="combobox"
          aria-expanded="true"
          aria-controls={listId}
          aria-activedescendant={active ? `${listId}-${active.id}` : undefined}
          aria-label="Search commands"
          name="command"
          autoComplete="off"
          spellCheck={false}
          value={query}
          onChange={(event) => {
            setQuery(event.target.value);
            setActiveIndex(0);
          }}
          onKeyDown={onKeyDown}
          placeholder="Search Tasks, Areas and commands"
          className="min-w-0 flex-1 bg-transparent outline-none placeholder:text-faint-foreground"
        />
        <Kbd>Esc</Kbd>
      </label>
      <div id={listId} role="listbox" aria-label="Commands" className="max-h-72 overflow-y-auto bg-foreground/[0.03] p-1.5">
        {matches.length === 0 && (
          <p className="px-2.5 py-6 text-center text-small text-muted-foreground">
            Nothing matches “{query}”. Press Enter to capture it as a Task.
          </p>
        )}
        {groups.map((group) => (
          <div key={group} role="group" aria-label={group}>
            <p className="px-2.5 pt-2 pb-1 text-small text-faint-foreground">{group}</p>
            {matches
              .filter((command) => command.group === group)
              .map((command) => {
                const isActive = command === active;
                return (
                  <div
                    key={command.id}
                    id={`${listId}-${command.id}`}
                    role="option"
                    aria-selected={isActive}
                    onPointerMove={() => setActiveIndex(matches.indexOf(command))}
                    onClick={() => onRun(command)}
                    className={cn(
                      "flex h-9 cursor-default items-center gap-3 rounded-lg px-2.5 text-small",
                      isActive && "bg-foreground/[0.07]",
                    )}
                  >
                    <command.icon
                      weight="fill"
                      className={cn("size-4 shrink-0", isActive ? "text-brand" : "text-muted-foreground")}
                      aria-hidden="true"
                    />
                    <span className="min-w-0 flex-1 truncate">{command.label}</span>
                    {command.keys && <KeyCombo keys={command.keys} />}
                  </div>
                );
              })}
          </div>
        ))}
      </div>
    </div>
  );
};
