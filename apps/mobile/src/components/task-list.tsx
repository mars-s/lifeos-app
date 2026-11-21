import { Stack, useFocusEffect, useRouter, type Href } from "expo-router";
import { ChevronRight, Flag } from "lucide-react-native";
import { memo, useCallback, useEffect, useId, useLayoutEffect, useRef, useState, type ComponentRef, type ReactNode } from "react";
import { Pressable, StyleSheet, Text, View } from "react-native";
import Animated, {
  ReduceMotion,
  useAnimatedScrollHandler,
  useAnimatedStyle,
  useSharedValue,
  withSpring,
  withTiming,
  type ILayoutAnimationBuilder,
  type SharedValue,
} from "react-native-reanimated";
import { scheduleOnRN } from "react-native-worklets";
import { api } from "@lifeos/backend/api";
import { dayPlacement } from "@lifeos/backend/client/day-order";
import { isOptimistic } from "@lifeos/backend/client/task-actions";
import { taskAliases } from "@lifeos/backend/client/task-aliases";
import { moveInProject, reorderTask } from "@lifeos/backend/client/updaters";
import type { Id } from "@lifeos/backend/dataModel";
import type { PlannerTask } from "@lifeos/backend/types";
import { Skeleton } from "@/components/ui/skeleton";
import { ProgressRing } from "@/components/progress-ring";
import { TaskRow, type RowHint } from "@/components/task-row";
import { useKit } from "@/lib/kit";
import { fonts, usePlanner } from "@/lib/kit-theme";
import { change } from "@/lib/change";
import { haptic } from "@/lib/haptics";
import { GAP, drag, dropFor, landingOffset, setDropResolver, setMover, shiftFor, type Drop, type Ordering, type Slot } from "@/lib/magic-plus";
import { BASE_MS, EASE_OUT, FAST_MS, SPRING, SPRING_SETTLE } from "@/lib/motion";
import { taskHref } from "@/lib/route";
import { rememberTask } from "@/lib/tasks";

export type ListItem =
  | { kind: "task"; key: string; task: PlannerTask; hint?: RowHint }
  | { kind: "header"; key: string; title: string; detail?: string; lead?: string; colour?: string; slot?: Slot }
  | { kind: "project"; key: string; title: string; href: Href; done: number; total: number; colour?: string }
  | { kind: "area"; key: string; title: string; href: Href; colour: string }
  | { kind: "deadline"; key: string; task: PlannerTask }
  | { kind: "note"; key: string; text: string };

const settle = {
  build: () => (values) => {
    "worklet";
    const timing = { duration: drag.quiet.get() ? 0 : BASE_MS, easing: EASE_OUT, reduceMotion: ReduceMotion.System };
    return {
      initialValues: { originX: values.currentOriginX, originY: values.currentOriginY, width: values.currentWidth, height: values.currentHeight },
      animations: {
        originX: withTiming(values.targetOriginX, timing),
        originY: withTiming(values.targetOriginY, timing),
        width: withTiming(values.targetWidth, timing),
        height: withTiming(values.targetHeight, timing),
      },
    };
  },
} satisfies ILayoutAnimationBuilder;

const LIFT_SCALE = 1.03;

export const taskItems = (tasks: readonly PlannerTask[], hint?: RowHint) =>
  tasks.map((task) => ({ kind: "task", key: task._id, task, ...(hint ? { hint } : {}) }) satisfies ListItem);

const Header = ({ item }: { item: Extract<ListItem, { kind: "header" }> }) => {
  const { colors } = useKit();
  const tones = usePlanner();
  return (
    <View style={styles.header}>
      {item.lead ? <Text style={[styles.lead, { color: colors.foreground }]}>{item.lead}</Text> : null}
      {item.colour ? <View style={[styles.dot, { backgroundColor: item.colour }]} /> : null}
      <Text accessibilityRole="header" style={[styles.headerTitle, { color: colors.foreground }]}>
        {item.title}
      </Text>
      {item.detail ? <Text style={[styles.detail, { color: tones.faintForeground }]}>{item.detail}</Text> : null}
    </View>
  );
};

const ProjectLink = ({ item }: { item: Extract<ListItem, { kind: "project" }> }) => {
  const { colors } = useKit();
  const tones = usePlanner();
  const router = useRouter();
  return (
      <Pressable accessibilityRole="link" onPress={() => router.push(item.href)} style={({ pressed }) => [styles.project, pressed ? { backgroundColor: tones.surface } : null]}>
        <ProgressRing value={item.total === 0 ? 0 : item.done / item.total} colour={item.colour ?? colors.mutedForeground} />
        <Text numberOfLines={1} style={[styles.projectTitle, { color: colors.foreground }]}>
          {item.title}
        </Text>
        <Text style={[styles.count, { color: tones.faintForeground }]}>
          {item.done}/{item.total}
        </Text>
        <ChevronRight size={16} color={tones.faintForeground} />
      </Pressable>
  );
};

const AreaLink = ({ item }: { item: Extract<ListItem, { kind: "area" }> }) => {
  const { colors } = useKit();
  const tones = usePlanner();
  const router = useRouter();
  return (
    <Pressable accessibilityRole="link" onPress={() => router.push(item.href)} style={({ pressed }) => [styles.project, pressed ? { backgroundColor: tones.surface } : null]}>
      <View style={styles.areaMark}>
        <View style={[styles.areaDot, { backgroundColor: item.colour }]} />
      </View>
      <Text numberOfLines={1} style={[styles.projectTitle, styles.areaTitle, { color: colors.foreground }]}>
        {item.title}
      </Text>
      <ChevronRight size={16} color={tones.faintForeground} />
    </Pressable>
  );
};

const DeadlineRow = ({ task }: { task: PlannerTask }) => {
  const tones = usePlanner();
  const router = useRouter();
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={`Deadline: ${task.title}`}
      onPressIn={() => rememberTask(task)}
      onPress={() => router.push(taskHref(task._id))}
      style={({ pressed }) => [styles.due, pressed ? { backgroundColor: tones.surface } : null]}
    >
      <Flag size={14} color={tones.deadline} fill={tones.deadline} />
      <Text numberOfLines={1} style={[styles.dueTitle, { color: tones.deadline }]}>
        {task.title}
      </Text>
    </Pressable>
  );
};

const Loading = () => (
  <View style={styles.loading}>
    {[0, 1, 2, 3].map((row) => (
      <Skeleton key={row} height={18} width={row % 2 === 1 ? "56%" : "78%"} radius="capsule" />
    ))}
  </View>
);

export const EmptyNote = ({ title, body }: { title: string; body: string }) => {
  const { colors } = useKit();
  const tones = usePlanner();
  return (
    <View style={styles.empty}>
      <Text style={[styles.emptyTitle, { color: colors.mutedForeground }]}>{title}</Text>
      <Text style={[styles.emptyBody, { color: tones.faintForeground }]}>{body}</Text>
    </View>
  );
};

const Shifted = memo(({ host, index, backdrop, children }: { host: string; index: number; backdrop: string; children: ReactNode }) => {
  const style = useAnimatedStyle(() => {
    const mine = drag.host.get() === host;
    const source = mine ? drag.source.get() : -1;
    const quiet = drag.quiet.get();
    const ease = { duration: FAST_MS, easing: EASE_OUT, reduceMotion: ReduceMotion.System };
    if (source === index)
      return {
        transform: [{ translateY: drag.dy.get() + drag.scrollY.get() - drag.startScroll.get() }, { scale: withTiming(LIFT_SCALE, ease) }],
        shadowOpacity: withTiming(0.18, ease),
      };
    const gap = mine ? drag.gap.get() : -1;
    const shift = (source >= 0 ? shiftFor(index) : 0) + (gap >= 0 && index >= gap ? GAP : 0);
    return {
      transform: [
        { translateY: quiet ? shift : withSpring(shift, { ...SPRING, reduceMotion: ReduceMotion.System }) },
        { scale: quiet ? 1 : withTiming(1, ease) },
      ],
      shadowOpacity: quiet ? 0 : withTiming(0, ease),
    };
  });
  return <Animated.View style={[styles.shifted, { backgroundColor: backdrop }, style]}>{children}</Animated.View>;
});

const Ghost = ({ host, scroll }: { host: string; scroll: SharedValue<number> }) => {
  const tones = usePlanner();
  const style = useAnimatedStyle(() => {
    const gap = drag.host.get() === host ? drag.gap.get() : -1;
    const top = gap >= 0 ? drag.gapTops.get()[gap] : undefined;
    const shown = top !== undefined && !Number.isNaN(top);
    return {
      opacity: withTiming(shown ? 1 : 0, { duration: FAST_MS, easing: EASE_OUT }),
      transform: [{ translateY: shown ? top - scroll.get() : -GAP * 4 }],
    };
  });
  return (
    <Animated.View pointerEvents="none" style={[styles.ghost, style]}>
      <View style={[styles.ghostRow, { backgroundColor: tones.surface }]}>
        <View style={[styles.ghostBox, { borderColor: tones.faintForeground }]} />
        <Text style={[styles.ghostTitle, { color: tones.faintForeground }]}>New Task</Text>
      </View>
    </Animated.View>
  );
};

const PAD_TOP = 4;

const rowTopsOf = (items: readonly ListItem[], heights: ReadonlyMap<string, number>) => {
  const tops: number[] = [PAD_TOP];
  for (const item of items) {
    const height = heights.get(item.key);
    tops.push(height === undefined ? Number.NaN : (tops.at(-1) ?? Number.NaN) + height);
  }
  return tops;
};

const gapTopsOf = (rowTops: readonly number[], droppable: (gap: number) => boolean) => rowTops.map((top, gap) => (droppable(gap) ? top : Number.NaN));

const homeOf = (parent: PlannerTask["parent"]) => (parent.kind === "project" ? parent.projectId : parent.kind === "area" ? parent.areaId : "loose");

const fits = (task: PlannerTask, drop: Drop | undefined, ordering: Ordering): drop is Drop => {
  if (!drop) return false;
  if (ordering === "day") return drop.when.kind === "scheduled" && drop.day !== undefined;
  return drop.order !== undefined && homeOf(drop.parent) === homeOf(task.parent);
};

const savedIdOf = (id: Id<"tasks">) => {
  const real = taskAliases.realId(id);
  return isOptimistic(real) ? undefined : real;
};

const tasksIn = (items: readonly ListItem[], ids: readonly string[]) => {
  const byId = new Map(items.flatMap((item) => (item.kind === "task" ? [[item.task._id as string, item.task] as const] : [])));
  return ids.flatMap((id) => byId.get(id) ?? []);
};

const moveChange = (items: readonly ListItem[], source: number, target: number, slot: Slot | undefined, ordering: Ordering, today: string) => {
  const item = items[source];
  if (item?.kind !== "task") return undefined;
  const { task } = item;
  const others = items.filter((_item, index) => index !== source);
  const drop = dropFor(others, target, slot, ordering);
  if (!fits(task, drop, ordering)) return undefined;
  if (ordering === "day" && drop.day && drop.when.kind === "scheduled") {
    const from = dropFor(items, source, slot, "day")?.day?.ids ?? [];
    return dayPlacement({
      task,
      from: tasksIn(items, from),
      to: { day: { date: drop.when.date, evening: drop.when.evening }, tasks: tasksIn(items, drop.day.ids) },
      at: drop.day.at,
      today,
      realIdOf: savedIdOf,
    });
  }
  const order = drop.order ?? task.order;
  const sameParent = JSON.stringify(drop.parent) === JSON.stringify(task.parent);
  if (sameParent)
    return { title: "Task moved", mutation: api.planner.tasks.reorder, args: { taskId: task._id, order }, apply: reorderTask(task._id, order), revert: reorderTask(task._id, task.order) };
  const heading = drop.parent.kind === "project" && drop.parent.headingId ? drop.label : "the top";
  return {
    title: `Moved to ${heading}`,
    mutation: api.planner.tasks.move,
    args: { taskId: task._id, parent: drop.parent, order },
    apply: moveInProject({ ...task, parent: drop.parent, order }),
    revert: moveInProject(task),
  };
};

const useDropHost = (items: readonly ListItem[], slot: Slot | undefined, ordering: Ordering | undefined, today: string) => {
  const host = useId();
  const focused = useRef(false);
  const heights = useRef(new Map<string, number>());
  const frame = useRef<ComponentRef<typeof View>>(null);
  const frameTop = useRef(0);
  const scroll = useSharedValue(0);
  const tops = useRef<number[]>([]);
  const rowTops = useRef<number[]>([]);
  const queued = useRef(false);
  const latest = useRef({ items, slot, ordering, today });
  const committing = useRef<ReturnType<typeof setTimeout> | null>(null);
  const [lifted, setLifted] = useState<string | null>(null);

  useEffect(() => {
    latest.current = { items, slot, ordering, today };
  }, [items, slot, ordering, today]);

  const publish = useCallback(() => {
    if (!focused.current) return;
    drag.host.set(host);
    drag.frameTop.set(frameTop.current);
    drag.scrollY.set(scroll.get());
    drag.gapTops.set(tops.current);
    drag.rowTops.set(rowTops.current);
  }, [host, scroll]);

  const remeasure = useCallback(() => {
    if (queued.current) return;
    queued.current = true;
    requestAnimationFrame(() => {
      queued.current = false;
      const { items: shown, slot: base, ordering: kind } = latest.current;
      rowTops.current = rowTopsOf(shown, heights.current);
      tops.current = gapTopsOf(rowTops.current, (gap) => dropFor(shown, gap, base, kind ?? "key") !== undefined);
      if (focused.current && drag.source.get() < 0) {
        drag.gapTops.set(tops.current);
        drag.rowTops.set(rowTops.current);
      }
    });
  }, []);

  useEffect(remeasure, [items, slot, ordering, remeasure]);

  const release = useCallback(() => {
    if (committing.current) clearTimeout(committing.current);
    committing.current = null;
    drag.quiet.set(true);
    drag.source.set(-1);
    drag.target.set(-1);
    drag.dy.set(0);
    setLifted(null);
    requestAnimationFrame(() => requestAnimationFrame(() => drag.quiet.set(false)));
    remeasure();
  }, [remeasure]);

  const committed = useRef(items);
  useLayoutEffect(() => {
    if (committed.current === items) return;
    committed.current = items;
    if (committing.current) release();
  }, [items, release]);

  const settleBack = useCallback(() => {
    drag.target.set(drag.source.get());
    drag.dy.set(
      withSpring(0, SPRING_SETTLE, (finished) => {
        "worklet";
        if (finished !== false) {
          drag.source.set(-1);
          drag.target.set(-1);
        }
      }),
    );
    setLifted(null);
  }, []);

  const commit = useCallback(
    (source: number, target: number) => {
      const { items: shown, slot: base, ordering: kind, today: day } = latest.current;
      const move = kind ? moveChange(shown, source, target, base, kind, day) : undefined;
      if (!move) return settleBack();
      drag.quiet.set(true);
      committing.current = setTimeout(release, 400);
      haptic("toggle");
      void change(move as Parameters<typeof change>[0]);
    },
    [release, settleBack],
  );

  useFocusEffect(
    useCallback(() => {
      focused.current = true;
      publish();
      setDropResolver(host, (gap) => dropFor(latest.current.items, gap, latest.current.slot, latest.current.ordering ?? "key"));
      return () => {
        focused.current = false;
        setDropResolver(host, null);
        if (drag.host.get() === host && !drag.held.get()) {
          drag.host.set("");
          drag.gap.set(-1);
          drag.source.set(-1);
        }
      };
    }, [host, publish]),
  );

  useEffect(() => {
    setMover(host, {
      lift: (index) => {
        const { items: shown, slot: base, ordering: kind } = latest.current;
        const item = shown[index];
        if (!kind || item?.kind !== "task") return settleBack();
        drag.host.set(host);
        drag.frameTop.set(frameTop.current);
        drag.scrollY.set(scroll.get());
        drag.startScroll.set(scroll.get());
        drag.gapTops.set(tops.current);
        drag.rowTops.set(rowTops.current);
        drag.size.set((rowTops.current[index + 1] ?? 0) - (rowTops.current[index] ?? 0));
        haptic("lift");
        const others = shown.filter((_item, at) => at !== index);
        drag.allowed.set(others.map((_item, at) => at === index || fits(item.task, dropFor(others, at, base, kind), kind)).concat(index === others.length || fits(item.task, dropFor(others, others.length, base, kind), kind)));
        setLifted(item.key);
      },
      drop: (index, target, canceled) => {
        if (canceled || target === index || target < 0) return settleBack();
        drag.dy.set(
          withTiming(landingOffset(index, target) - (drag.scrollY.get() - drag.startScroll.get()), { duration: FAST_MS, easing: EASE_OUT }, (finished) => {
            "worklet";
            if (finished) scheduleOnRN(commit, index, target);
          }),
        );
      },
      nudge: (index, step) => {
        const { items: shown, slot: base, ordering: kind, today: day } = latest.current;
        let target = index + step;
        while (target >= 0 && target < shown.length && !moveChange(shown, index, target, base, kind ?? "key", day)) target += step;
        const move = kind ? moveChange(shown, index, target, base, kind, day) : undefined;
        if (!move) return haptic("error");
        void change(move as Parameters<typeof change>[0]);
      },
    });
    return () => setMover(host, null);
  }, [host, scroll, commit, settleBack]);

  const onScroll = useAnimatedScrollHandler({
    onScroll: (event) => {
      scroll.set(event.contentOffset.y);
      if (drag.host.get() === host) drag.scrollY.set(event.contentOffset.y);
    },
  });

  const onFrame = () =>
    frame.current?.measureInWindow((_x, y) => {
      frameTop.current = y;
      if (focused.current) drag.frameTop.set(y);
    });

  const onRow = (key: string, height: number) => {
    if (heights.current.get(key) === height) return;
    heights.current.set(key, height);
    remeasure();
  };

  return { host, frame, scroll, onScroll, onFrame, onRow, lifted };
};

export const TaskList = ({
  title,
  items,
  today,
  empty,
  onEndReached,
  onSearch,
  slot,
  ordering,
}: {
  title: string;
  items: readonly ListItem[] | undefined;
  today: string;
  empty: ReactNode;
  onEndReached?: () => void;
  onSearch?: (query: string) => void;
  slot?: Slot;
  ordering?: Ordering;
}) => {
  const { colors } = useKit();
  const tones = usePlanner();
  const shown = items ?? NO_ITEMS;
  const { host, frame, scroll, onScroll, onFrame, onRow, lifted } = useDropHost(shown, slot, ordering, today);
  return (
    <View ref={frame} onLayout={onFrame} collapsable={false} style={[styles.frame, { backgroundColor: colors.background }]}>
      <Stack.Screen
        options={{
          title,
          ...(onSearch
            ? { headerSearchBarOptions: { placeholder: "Tasks, Projects and Areas", hideWhenScrolling: false, onChangeText: (event) => onSearch(event.nativeEvent.text) } }
            : {}),
        }}
      />
      <Animated.FlatList
        data={shown}
        keyExtractor={(item) => item.key}
        renderItem={({ item, index }) => (
          <Shifted host={host} index={index} backdrop={colors.background}>
            <View onLayout={(event) => onRow(item.key, event.nativeEvent.layout.height)}>
              {item.kind === "task" ? (
                <TaskRow task={item.task} today={today} {...(item.hint ? { hint: item.hint } : {})} {...(ordering ? { host, index } : {})} />
              ) : item.kind === "header" ? (
                <Header item={item} />
              ) : item.kind === "project" ? (
                <ProjectLink item={item} />
              ) : item.kind === "area" ? (
                <AreaLink item={item} />
              ) : item.kind === "deadline" ? (
                <DeadlineRow task={item.task} />
              ) : (
                <Text style={[styles.note, { color: tones.faintForeground }]}>{item.text}</Text>
              )}
            </View>
          </Shifted>
        )}
        onScroll={onScroll}
        scrollEventThrottle={16}
        scrollEnabled={lifted === null}
        extraData={lifted}
        CellRendererComponentStyle={({ item }: { item: ListItem }) => (item.key === lifted ? styles.liftedCell : styles.cell)}
        itemLayoutAnimation={settle}
        contentInsetAdjustmentBehavior="automatic"
        keyboardDismissMode="on-drag"
        ListEmptyComponent={items === undefined ? <Loading /> : <>{empty}</>}
        contentContainerStyle={styles.content}
        keyboardShouldPersistTaps="handled"
        {...(onEndReached ? { onEndReached, onEndReachedThreshold: 0.6 } : {})}
      />
      <Ghost host={host} scroll={scroll} />
    </View>
  );
};

const NO_ITEMS: readonly ListItem[] = [];

const styles = StyleSheet.create({
  frame: { flex: 1 },
  shifted: { shadowColor: "#000", shadowOffset: { width: 0, height: 8 }, shadowRadius: 18, shadowOpacity: 0 },
  cell: { zIndex: 0 },
  liftedCell: { zIndex: 10 },
  content: { paddingBottom: 160, paddingTop: PAD_TOP },
  ghost: { position: "absolute", top: 0, left: 0, right: 0, height: GAP, paddingHorizontal: 12, justifyContent: "center" },
  ghostRow: { flexDirection: "row", alignItems: "center", gap: 14, height: GAP - 8, paddingHorizontal: 8, borderRadius: 12 },
  ghostBox: { width: 22, height: 22, borderRadius: 6, borderWidth: 1.5 },
  ghostTitle: { fontFamily: fonts.regular, fontSize: 17, lineHeight: 24 },
  header: { flexDirection: "row", alignItems: "baseline", gap: 8, paddingHorizontal: 20, paddingTop: 22, paddingBottom: 6 },
  lead: { fontFamily: fonts.semibold, fontSize: 24, lineHeight: 28, letterSpacing: -0.5, fontVariant: ["tabular-nums"] },
  dot: { width: 9, height: 9, borderRadius: 5, alignSelf: "center" },
  headerTitle: { fontFamily: fonts.semibold, fontSize: 15, lineHeight: 22 },
  detail: { fontFamily: fonts.regular, fontSize: 13, lineHeight: 22 },
  project: { flexDirection: "row", alignItems: "center", gap: 12, paddingHorizontal: 20, minHeight: 48 },
  projectTitle: { flex: 1, fontFamily: fonts.medium, fontSize: 17, lineHeight: 24, letterSpacing: -0.2 },
  areaMark: { width: 22, alignItems: "center" },
  areaDot: { width: 12, height: 12, borderRadius: 6 },
  areaTitle: { fontFamily: fonts.semibold },
  count: { fontFamily: fonts.mono, fontSize: 12 },
  due: { flexDirection: "row", alignItems: "center", gap: 10, minHeight: 44, paddingLeft: 24, paddingRight: 20 },
  dueTitle: { flex: 1, fontFamily: fonts.medium, fontSize: 15, lineHeight: 22 },
  note: { fontFamily: fonts.regular, fontSize: 13, lineHeight: 18, paddingHorizontal: 20, paddingVertical: 10 },
  loading: { gap: 22, paddingHorizontal: 20, paddingTop: 18 },
  empty: { paddingHorizontal: 20, paddingTop: 56, gap: 6, alignItems: "center" },
  emptyTitle: { fontFamily: fonts.medium, fontSize: 17, lineHeight: 24 },
  emptyBody: { fontFamily: fonts.regular, fontSize: 14, lineHeight: 20, textAlign: "center" },
});
