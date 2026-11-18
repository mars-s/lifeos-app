"use client";

import { AnimatePresence, motion, useReducedMotion } from "motion/react";
import { useEffect, useRef, useState, type ReactNode } from "react";
import { instant, LINGER_MS, springLayout } from "@/lib/motion-tokens";
import { TaskRow, type TaskSummary } from "./task-row";
import { showUndo } from "./undo";

const without = (set: ReadonlySet<string>, id: string) => new Set([...set].filter((entry) => entry !== id));

export const TaskList = ({
  tasks,
  renderEmpty,
  onRemainingChange,
}: {
  tasks: TaskSummary[];
  renderEmpty?: (restore: () => void) => ReactNode;
  onRemainingChange?: (remaining: number) => void;
}) => {
  const reduce = useReducedMotion();
  const [completed, setCompleted] = useState<ReadonlySet<string>>(new Set());
  const [logged, setLogged] = useState<ReadonlySet<string>>(new Set());
  const timers = useRef(new Map<string, ReturnType<typeof setTimeout>>());

  useEffect(() => {
    const pending = timers.current;
    return () => pending.forEach((timer) => clearTimeout(timer));
  }, []);

  const remaining = tasks.length - completed.size;
  useEffect(() => onRemainingChange?.(remaining), [remaining, onRemainingChange]);

  const restore = (id: string) => {
    clearTimeout(timers.current.get(id));
    setCompleted((current) => without(current, id));
    setLogged((current) => without(current, id));
  };

  const complete = (task: TaskSummary) => {
    setCompleted((current) => new Set(current).add(task.id));
    timers.current.set(
      task.id,
      setTimeout(() => setLogged((current) => new Set(current).add(task.id)), LINGER_MS),
    );
    showUndo(`Completed “${task.title}”`, () => restore(task.id));
  };

  const restoreAll = () => {
    setCompleted(new Set());
    setLogged(new Set());
  };

  const visible = tasks.filter((task) => !(logged.has(task.id) && completed.has(task.id)));
  const transition = reduce ? instant : springLayout;

  return (
    <div>
      <ul>
        <AnimatePresence initial={false}>
          {visible.map((task) => (
            <motion.li
              key={task.id}
              initial={{ height: 0, opacity: 0 }}
              animate={{ height: "auto", opacity: 1 }}
              exit={{ height: 0, opacity: 0 }}
              transition={transition}
              className="overflow-hidden"
            >
              <TaskRow
                task={task}
                completed={completed.has(task.id)}
                onCompletedChange={(next) => (next ? complete(task) : restore(task.id))}
              />
            </motion.li>
          ))}
        </AnimatePresence>
      </ul>
      <AnimatePresence initial={false}>
        {visible.length === 0 && renderEmpty && (
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1, transition: { duration: 0.32, delay: 0.2 } }}
            exit={{ opacity: 0, transition: instant }}
          >
            {renderEmpty(restoreAll)}
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
};
