// TUFFUI (https://tuffui.com) · MIT License · Copyright (c) 2026 TUFFUI contributors
// Restyled to the LifeOS tokens. Adds grid items (colour swatches, icons), a
// mixed state for checkable items and a leading node for Area dots.
"use client";

import { CaretRight, Check, Minus, type Icon } from "@phosphor-icons/react";
import { AnimatePresence, motion, useReducedMotion } from "motion/react";
import { ContextMenu as ContextPrimitive, DropdownMenu } from "radix-ui";
import { useState } from "react";
import { EASE_OUT, instant } from "@/lib/motion-tokens";
import { cn } from "@/lib/utils";

const slot = { asChild: true } as const;

type Base = {
  id: string;
  label: React.ReactNode;
  icon?: Icon;
  /** Replaces the icon, for an Area dot or a progress pie. */
  leading?: React.ReactNode;
  /** Draws the icon in the brand colour, for Today. */
  accent?: boolean;
  disabled?: boolean;
};

export type MenuItem =
  | (Base & {
      type?: "item";
      shortcut?: string;
      description?: React.ReactNode;
      destructive?: boolean;
      indent?: boolean;
      onSelect?: () => void;
    })
  | (Base & {
      type: "checkbox";
      checked: boolean | "mixed";
      onCheckedChange: (checked: boolean) => void;
    })
  | {
      type: "grid";
      id: string;
      label: string;
      columns: number;
      value?: string;
      onValueChange: (value: string) => void;
      options: { value: string; label: string; node: React.ReactNode }[];
    }
  | (Base & { type: "submenu"; items: MenuItem[]; groups?: MenuGroup[] });

export type MenuGroup = { id?: string; label?: string; items: MenuItem[] };

type Parts = typeof DropdownMenu;
const contextParts = ContextPrimitive as unknown as Parts;

const surface =
  "z-50 max-h-[min(30rem,var(--radix-context-menu-content-available-height,30rem),var(--radix-dropdown-menu-content-available-height,30rem))] min-w-52 overflow-y-auto overscroll-contain rounded-xl bg-popover p-1 text-foreground shadow-float outline-none select-none";
const row =
  "relative flex h-8 cursor-default items-center gap-2.5 rounded-md px-2 text-small outline-none select-none data-[disabled]:pointer-events-none data-[disabled]:opacity-40 data-[highlighted]:bg-foreground/[0.07] max-md:h-10";

function Glyph({
  icon: IconComponent,
  leading,
  accent,
  destructive,
  reserve,
}: {
  icon?: Icon;
  leading?: React.ReactNode;
  accent?: boolean;
  destructive?: boolean;
  reserve?: boolean;
}) {
  if (leading) return <span className="grid size-4 shrink-0 place-items-center">{leading}</span>;
  if (IconComponent)
    return (
      <IconComponent
        weight="fill"
        aria-hidden="true"
        className={cn("size-4 shrink-0", destructive ? "text-negative" : accent ? "text-brand" : "text-muted-foreground")}
      />
    );
  return reserve ? <span aria-hidden="true" className="size-4 shrink-0" /> : null;
}

const hasIcons = (items: MenuItem[]) => items.some((item) => item.type !== "grid" && (!!item.icon || !!item.leading));

function Items({ parts: P, groups }: { parts: Parts; groups: MenuGroup[] }) {
  return groups
    .filter((group) => group.items.length > 0)
    .map((group, g) => (
      <P.Group key={group.id ?? g} className={cn(g > 0 && "mt-1 border-t border-border pt-1")}>
        {group.label && <P.Label className="px-2 pt-1 pb-0.5 text-micro font-medium text-faint-foreground">{group.label}</P.Label>}
        {group.items.map((item) => (
          <Entry key={item.id} parts={P} item={item} reserve={hasIcons(group.items)} />
        ))}
      </P.Group>
    ));
}

function SubMenu({ parts: P, item, reserve }: { parts: Parts; item: Extract<MenuItem, { type: "submenu" }>; reserve: boolean }) {
  const [open, setOpen] = useState(false);
  const reduce = useReducedMotion();
  return (
    <P.Sub open={open} onOpenChange={setOpen}>
      <P.SubTrigger disabled={item.disabled} className={cn(row, "data-[state=open]:bg-foreground/[0.07]")}>
        <Glyph icon={item.icon} leading={item.leading} accent={item.accent} reserve={reserve} />
        <span className="min-w-0 flex-1 truncate">{item.label}</span>
        <CaretRight weight="bold" aria-hidden="true" className="size-3 text-faint-foreground" />
      </P.SubTrigger>
      <AnimatePresence>
        {open && (
          <P.Portal forceMount>
            <P.SubContent forceMount sideOffset={6} alignOffset={-4} collisionPadding={8} {...slot}>
              <motion.div
                data-submenu
                initial={{ opacity: 0, scale: reduce ? 1 : 0.97 }}
                animate={{ opacity: 1, scale: 1, transition: reduce ? instant : { duration: 0.15, ease: EASE_OUT } }}
                exit={{ opacity: 0, transition: reduce ? instant : { duration: 0.1, ease: EASE_OUT } }}
                style={{
                  transformOrigin:
                    "var(--radix-dropdown-menu-content-transform-origin, var(--radix-context-menu-content-transform-origin))",
                }}
                className={surface}
              >
                <Items parts={P} groups={item.groups ?? [{ items: item.items }]} />
              </motion.div>
            </P.SubContent>
          </P.Portal>
        )}
      </AnimatePresence>
    </P.Sub>
  );
}

function Entry({ parts: P, item, reserve }: { parts: Parts; item: MenuItem; reserve: boolean }) {
  if (item.type === "checkbox") {
    return (
      <P.CheckboxItem
        className={row}
        checked={item.checked === "mixed" ? "indeterminate" : item.checked}
        onCheckedChange={item.onCheckedChange}
        disabled={item.disabled}
        onSelect={(event) => event.preventDefault()}
      >
        <Glyph icon={item.icon} leading={item.leading} reserve={reserve} />
        <span className="min-w-0 flex-1 truncate">{item.label}</span>
        <P.ItemIndicator>
          {item.checked === "mixed" ? (
            <Minus weight="bold" className="size-3.5 text-muted-foreground" />
          ) : (
            <Check weight="bold" className="size-3.5 text-brand" />
          )}
        </P.ItemIndicator>
      </P.CheckboxItem>
    );
  }
  if (item.type === "grid") {
    return (
      <div
        role="group"
        aria-label={item.label}
        className="grid gap-0.5 p-1"
        style={{ gridTemplateColumns: `repeat(${item.columns}, minmax(0, 1fr))` }}
      >
        {item.options.map((option) => (
          <P.Item
            key={option.value}
            aria-label={option.label}
            title={option.label}
            onSelect={() => item.onValueChange(option.value)}
            className={cn(
              "grid size-8 cursor-default place-items-center rounded-md outline-none data-[highlighted]:bg-foreground/[0.07] max-md:size-10",
              item.value === option.value && "bg-foreground/[0.07]",
            )}
          >
            {option.node}
          </P.Item>
        ))}
      </div>
    );
  }
  if (item.type === "submenu") return <SubMenu parts={P} item={item} reserve={reserve} />;
  return (
    <P.Item
      className={cn(row, item.indent && "pl-7", item.destructive && "text-negative data-[highlighted]:bg-negative/10")}
      disabled={item.disabled}
      onSelect={item.onSelect}
    >
      <Glyph icon={item.icon} leading={item.leading} accent={item.accent} destructive={item.destructive} reserve={reserve} />
      <span className="min-w-0 flex-1">
        <span className="block truncate">{item.label}</span>
        {item.description && <span className="block text-micro text-muted-foreground">{item.description}</span>}
      </span>
      {item.shortcut && <kbd className="font-sans text-micro text-faint-foreground max-md:hidden">{item.shortcut}</kbd>}
    </P.Item>
  );
}

function useOpenMotion() {
  const reduce = useReducedMotion();
  const [viaKeyboard, setViaKeyboard] = useState(false);
  const still = viaKeyboard || !!reduce;
  return {
    setViaKeyboard,
    content: (originVar: string) => ({
      initial: { opacity: 0, scale: reduce ? 1 : 0.97 },
      animate: {
        opacity: 1,
        scale: 1,
        transition: still ? instant : { duration: 0.16, ease: EASE_OUT },
      },
      exit: {
        opacity: 0,
        scale: reduce ? 1 : 0.98,
        transition: still ? instant : { duration: 0.1, ease: EASE_OUT },
      },
      style: { transformOrigin: `var(${originVar})` },
    }),
  };
}

export type MenuProps = {
  trigger: React.ReactElement;
  groups: MenuGroup[];
  side?: "top" | "right" | "bottom" | "left";
  align?: "start" | "center" | "end";
  open?: boolean;
  onOpenChange?: (open: boolean) => void;
  className?: string;
};

export function Menu({ trigger, groups, side = "bottom", align = "start", open: openProp, onOpenChange, className }: MenuProps) {
  const [openState, setOpenState] = useState(false);
  const open = openProp ?? openState;
  const setOpen = (next: boolean) => {
    setOpenState(next);
    onOpenChange?.(next);
  };
  const { setViaKeyboard, content } = useOpenMotion();

  return (
    <DropdownMenu.Root open={open} onOpenChange={setOpen}>
      <DropdownMenu.Trigger
        {...slot}
        onPointerDown={() => setViaKeyboard(false)}
        onKeyDown={(event) => {
          if (["Enter", " ", "ArrowDown", "ArrowUp"].includes(event.key)) setViaKeyboard(true);
        }}
      >
        {trigger}
      </DropdownMenu.Trigger>
      <AnimatePresence>
        {open && (
          <DropdownMenu.Portal forceMount>
            <DropdownMenu.Content forceMount {...slot} side={side} align={align} sideOffset={6} collisionPadding={8}>
              <motion.div {...content("--radix-dropdown-menu-content-transform-origin")} className={cn(surface, className)}>
                <Items parts={DropdownMenu} groups={groups} />
              </motion.div>
            </DropdownMenu.Content>
          </DropdownMenu.Portal>
        )}
      </AnimatePresence>
    </DropdownMenu.Root>
  );
}

export type ContextMenuProps = {
  children: React.ReactElement;
  groups: MenuGroup[];
  /** True when the menu was asked for with the keyboard, so it appears at once. */
  viaKeyboard?: boolean;
  onOpenChange?: (open: boolean) => void;
  className?: string;
};

export function ContextMenu({ children, groups, viaKeyboard = false, onOpenChange, className }: ContextMenuProps) {
  const [open, setOpen] = useState(false);
  const reduce = useReducedMotion();
  const still = viaKeyboard || !!reduce;

  return (
    <ContextPrimitive.Root
      onOpenChange={(next) => {
        setOpen(next);
        onOpenChange?.(next);
      }}
    >
      <ContextPrimitive.Trigger {...slot}>{children}</ContextPrimitive.Trigger>
      <AnimatePresence>
        {open && (
          <ContextPrimitive.Portal forceMount>
            <ContextPrimitive.Content forceMount {...slot} collisionPadding={8}>
              <motion.div
                initial={{ opacity: 0, scale: reduce ? 1 : 0.97 }}
                animate={{ opacity: 1, scale: 1, transition: still ? instant : { duration: 0.16, ease: EASE_OUT } }}
                exit={{ opacity: 0, scale: reduce ? 1 : 0.98, transition: still ? instant : { duration: 0.1, ease: EASE_OUT } }}
                style={{ transformOrigin: "var(--radix-context-menu-content-transform-origin)" }}
                className={cn(surface, className)}
              >
                <Items parts={contextParts} groups={groups} />
              </motion.div>
            </ContextPrimitive.Content>
          </ContextPrimitive.Portal>
        )}
      </AnimatePresence>
    </ContextPrimitive.Root>
  );
}
