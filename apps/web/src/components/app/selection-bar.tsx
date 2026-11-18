"use client";

import { CheckCircle, DotsThree, Trash, X, type Icon } from "@phosphor-icons/react";
import { AnimatePresence, motion, useReducedMotion } from "motion/react";
import { RollingNumber } from "@/components/ui/rolling-number";
import { instant, springLift } from "@/lib/motion-tokens";
import { openMenuFor } from "./menus";
import { selection, useSelectionSize } from "./selection";
import { useSelectionActions } from "./selection-actions";
import { useShell } from "./shell-context";

const BarButton = ({
  icon: IconComponent,
  label,
  weight = "fill",
  onClick,
}: {
  icon: Icon;
  label: string;
  weight?: "fill" | "bold";
  onClick: (event: React.MouseEvent<HTMLButtonElement>) => void;
}) => (
  <button
    type="button"
    aria-label={label}
    title={label}
    onClick={onClick}
    className="grid size-9 place-items-center rounded-full text-muted-foreground transition-[background-color,color,scale] duration-(--dur-press) ease-out hover:bg-foreground/[0.07] hover:text-foreground active:scale-[0.92]"
  >
    <IconComponent weight={weight} className="size-[18px]" aria-hidden="true" />
  </button>
);

export const SelectionBar = () => {
  const { today, openCard } = useShell();
  const size = useSelectionSize();
  const reduce = useReducedMotion();
  const actions = useSelectionActions(today);
  const shown = size > 1 && !openCard;
  return (
    <div className="pointer-events-none fixed inset-x-0 bottom-0 z-30 flex justify-center pb-[max(1.25rem,env(safe-area-inset-bottom))] md:left-60 lg:left-64">
      <p role="status" className="sr-only">
        {size > 0 ? `${size} ${size === 1 ? "Task" : "Tasks"} selected` : ""}
      </p>
      <AnimatePresence>
        {shown && (
          <motion.div
            data-selection-bar
            role="toolbar"
            aria-label="Selected Tasks"
            initial={{ opacity: 0, y: reduce ? 0 : 16, scale: reduce ? 1 : 0.96 }}
            animate={{ opacity: 1, y: 0, scale: 1, transition: reduce ? instant : springLift }}
            exit={{ opacity: 0, y: reduce ? 0 : 10, transition: reduce ? instant : { duration: 0.14 } }}
            className="pointer-events-auto flex h-12 items-center gap-0.5 rounded-full bg-popover pr-1.5 pl-4 shadow-float"
          >
            <span className="mr-2 flex items-baseline gap-1.5 text-small font-medium">
              <RollingNumber value={size} className="font-mono" />
              selected
            </span>
            <BarButton icon={CheckCircle} label="Complete the selected Tasks" onClick={() => actions.completeSoon(selection.tasks())} />
            <BarButton icon={Trash} label="Move the selected Tasks to Trash" onClick={() => actions.trash(selection.tasks())} />
            <BarButton icon={DotsThree} weight="bold" label="More actions" onClick={(event) => openMenuFor(event.currentTarget)} />
            <span aria-hidden="true" className="mx-1 h-5 w-px bg-border" />
            <BarButton icon={X} weight="bold" label="Clear the selection" onClick={() => selection.clear()} />
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
};
