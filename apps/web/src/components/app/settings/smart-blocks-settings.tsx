"use client";

import { arrayMove } from "@dnd-kit/sortable";
import type { OptimisticLocalStore } from "convex/browser";
import { api } from "@lifeos/backend/api";
import type { Id } from "@lifeos/backend/dataModel";
import { AreaDot } from "@/components/lifeos/area";
import { RankList } from "@/components/lifeos/rank-list";
import { useChange } from "../changes";
import { useQuietView } from "../hooks";
import { SettingsGroup } from "./rows";

type PriorityArea = NonNullable<ReturnType<typeof usePriority>>[number];

const usePriority = () => useQuietView(api.planner.smartBlocks.priority, {});

const putOrder = (areas: readonly PriorityArea[]) => (store: OptimisticLocalStore) => {
  store.setQuery(api.planner.smartBlocks.priority, {}, [...areas]);
  const states = store.getQuery(api.platform.features.list, {});
  if (states)
    store.setQuery(
      api.platform.features.list,
      {},
      states.map((state) => (state.feature === "smartBlocks" ? { ...state, settings: { areaOrder: areas.map((area) => area._id) } } : state)),
    );
};

export const SmartBlocksSettings = () => {
  const areas = usePriority();
  const change = useChange();
  if (!areas) return null;
  const move = (key: string, toIndex: number) => {
    const from = areas.findIndex((area) => area._id === key);
    if (from === -1) return;
    const next = arrayMove([...areas], from, toIndex);
    void change({
      title: `${areas[from]?.title ?? "Area"} is now number ${toIndex + 1}`,
      mutation: api.platform.features.configure,
      args: { choice: { feature: "smartBlocks", settings: { areaOrder: next.map((area) => area._id as Id<"areas">) } } },
      apply: putOrder(next),
      revert: putOrder(areas),
      slot: "smart-blocks:priority",
    });
  };
  return (
    <SettingsGroup
      title="Area priority"
      hint="When a Smart Block has room for only some Tasks, the Area higher up wins. A near Deadline still comes first. Tasks without an Area sit in the middle."
    >
      {areas.length === 0 ? (
        <p className="px-3 py-3 text-small text-muted-foreground">Areas you add show up here.</p>
      ) : (
        <RankList
          label="Area priority"
          items={areas.map((area) => ({
            key: area._id,
            label: area.title,
            content: (
              <>
                <AreaDot colour={area.colour} />
                <span className="truncate">{area.title}</span>
              </>
            ),
          }))}
          onMove={move}
        />
      )}
    </SettingsGroup>
  );
};
