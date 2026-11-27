"use client";

import { Brain, PushPin, X } from "@phosphor-icons/react";
import type { OptimisticLocalStore } from "convex/browser";
import { useMutation } from "convex/react";
import type { FunctionReturnType } from "convex/server";
import { useState } from "react";
import { api } from "@lifeos/backend/api";
import type { Id } from "@lifeos/backend/dataModel";
import { showUndo } from "@/components/lifeos/undo";
import { Button, IconButton } from "@/components/ui/action-button";
import { Switch } from "@/components/ui/choice-controls";
import { cn } from "@/lib/utils";
import { useChange } from "../changes";
import { askToConfirm } from "../confirm";
import { useQuietView } from "../hooks";
import { SettingsGroup, SettingsRow } from "./rows";

type View = FunctionReturnType<typeof api.ai.memory.list>;
type Memory = View["memories"][number];

const DOTS = 20;

const withView = (change: (view: View) => View) => (store: OptimisticLocalStore) => {
  const view = store.getQuery(api.ai.memory.list, {});
  if (view) store.setQuery(api.ai.memory.list, {}, change(view));
};

const patchMemory = (memoryId: Id<"memories">, fields: Partial<Memory>) =>
  withView((view) => ({ ...view, memories: view.memories.map((memory) => (memory._id === memoryId ? { ...memory, ...fields } : memory)) }));

const ordered = (memories: readonly Memory[]) => [...memories.filter((memory) => memory.pinned), ...memories.filter((memory) => !memory.pinned)];

const MemoryRow = ({ memory }: { memory: Memory }) => {
  const change = useChange();
  const forget = useMutation(api.ai.memory.forget).withOptimisticUpdate((store, { memoryId }) =>
    withView((view) => ({ ...view, memories: view.memories.filter((entry) => entry._id !== memoryId) }))(store),
  );
  const add = useMutation(api.ai.memory.add);
  const [draft, setDraft] = useState<string | null>(null);
  const save = () => {
    const text = draft?.trim() ?? "";
    setDraft(null);
    if (text === "" || text === memory.text) return;
    void change({ title: "Memory rewritten", mutation: api.ai.memory.edit, args: { memoryId: memory._id, text }, apply: patchMemory(memory._id, { text }), revert: patchMemory(memory._id, { text: memory.text }) });
  };
  return (
    <li className="flex items-start gap-2 px-3.5 py-2.5">
      <div className="min-w-0 flex-1">
        {draft === null ? (
          <button type="button" onClick={() => setDraft(memory.text)} className="w-full rounded-md text-left text-small text-pretty hover:text-foreground">
            {memory.text}
          </button>
        ) : (
          <input
            autoFocus
            name="memory"
            aria-label="Rewrite this memory"
            autoComplete="off"
            value={draft}
            onChange={(event) => setDraft(event.target.value)}
            onBlur={save}
            onKeyDown={(event) => {
              if (event.key === "Enter") save();
              if (event.key === "Escape") setDraft(null);
            }}
            className="w-full rounded-md bg-foreground/[0.05] px-1.5 py-0.5 text-small outline-none focus-visible:shadow-[inset_0_0_0_1.5px] focus-visible:shadow-foreground/25"
          />
        )}
        <p className="text-micro text-faint-foreground">{memory.from}</p>
      </div>
      <IconButton
        icon={PushPin}
        iconWeight={memory.pinned ? "fill" : "bold"}
        label={memory.pinned ? "Unpin" : "Pin, so it is used every time"}
        aria-pressed={memory.pinned}
        className={cn(!memory.pinned && "text-faint-foreground")}
        onClick={() =>
          void change({
            title: memory.pinned ? "Unpinned" : "Pinned",
            mutation: api.ai.memory.pin,
            args: { memoryId: memory._id, pinned: !memory.pinned },
            apply: patchMemory(memory._id, { pinned: !memory.pinned }),
            revert: patchMemory(memory._id, { pinned: memory.pinned }),
          })
        }
      />
      <IconButton
        icon={X}
        iconWeight="bold"
        label="Forget"
        onClick={() =>
          void forget({ memoryId: memory._id }).then((result) => {
            if (result.ok) showUndo("Forgotten", () => void add({ text: result.value.text, kind: result.value.kind }));
          })
        }
      />
    </li>
  );
};

const IndexRow = ({ label, count, embedded, total }: { label: string; count: number; embedded: number; total: number }) => {
  const filled = total === 0 ? 0 : Math.round((embedded / total) * DOTS);
  return (
    <li className="flex items-center gap-3 px-3.5 py-2">
      <span className="min-w-0 flex-1 text-small">{label}</span>
      <span aria-hidden="true" className="flex gap-[3px]">
        {Array.from({ length: DOTS }, (_, index) => (
          <span key={index} className={cn("size-1.5 rounded-full", index < filled ? "bg-foreground/45" : "bg-foreground/[0.11]")} />
        ))}
      </span>
      <span className="w-12 text-right font-mono text-micro text-muted-foreground tabular-nums">{count.toLocaleString("en-AU")}</span>
    </li>
  );
};

export const MemorySettings = () => {
  const view = useQuietView(api.ai.memory.list, {});
  const change = useChange();
  const forgetAll = useMutation(api.ai.memory.forgetAll);
  if (!view) return null;
  const setOn = (on: boolean) =>
    void change({ title: on ? "Memory on" : "Memory off", mutation: api.ai.memory.setOn, args: { on }, apply: withView((current) => ({ ...current, on })), revert: withView((current) => ({ ...current, on: view.on })) });
  return (
    <>
      <SettingsGroup title="Memory" hint="LifeOS AI remembers how you work, so you do not have to say it twice. Each memory is a sentence you can rewrite, pin or forget.">
        <SettingsRow icon={Brain} label="Memory" hint={view.on ? "New memories are saved as they come, each with Undo." : "Off: LifeOS AI neither saves nor reads memories. The rest of AI still works."}>
          <Switch aria-label="Memory" checked={view.on} onCheckedChange={setOn} />
        </SettingsRow>
        {view.memories.length === 0 ? (
          <p className="px-3.5 py-3 text-small text-muted-foreground">Nothing yet. When you tell LifeOS AI how you like to work, it shows here.</p>
        ) : (
          <ul aria-label="Memories">
            {ordered(view.memories).map((memory) => (
              <MemoryRow key={memory._id} memory={memory} />
            ))}
          </ul>
        )}
        {view.memories.length > 0 && (
          <div className="flex justify-end px-3.5 py-2.5">
            <Button
              variant="danger"
              onClick={() =>
                askToConfirm({
                  title: "Forget everything?",
                  body: `All ${view.memories.length} memories are deleted for good. This cannot be undone.`,
                  action: "Forget everything",
                  onConfirm: () => void forgetAll({}),
                })
              }
            >
              Forget everything
            </Button>
          </div>
        )}
      </SettingsGroup>
      <SettingsGroup title="The index" hint="What Cmd+J can find. Notes stay on your devices, and search by words works with AI off. Filled dots have meaning search too.">
        <ul aria-label="Index">
          <IndexRow label="Tasks" count={view.index.task} embedded={view.index.embedded} total={view.index.total} />
          <IndexRow label="Projects" count={view.index.project} embedded={view.index.embedded} total={view.index.total} />
          <IndexRow label="Areas" count={view.index.area} embedded={view.index.embedded} total={view.index.total} />
          <IndexRow label="Memories" count={view.memories.length} embedded={view.memories.length} total={view.memories.length} />
        </ul>
        <span role="status" className="sr-only">
          {view.index.embedded} of {view.index.total}
          {view.index.more ? " or more" : ""} items have meaning search.
        </span>
      </SettingsGroup>
    </>
  );
};
