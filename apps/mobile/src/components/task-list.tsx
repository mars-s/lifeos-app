import { Stack, useFocusEffect, useRouter, type Href } from "expo-router";
import { ChevronRight, Flag } from "lucide-react-native";
import { memo, useCallback, useEffect, useId, useRef, type ComponentRef, type ReactNode } from "react";
import { Pressable, StyleSheet, Text, View } from "react-native";
import Animated, {
  LinearTransition,
  ReduceMotion,
  useAnimatedScrollHandler,
  useAnimatedStyle,
  useSharedValue,
  withSpring,
  withTiming,
  type SharedValue,
} from "react-native-reanimated";
import type { PlannerTask } from "@lifeos/backend/types";
import { Skeleton } from "@/components/ui/skeleton";
import { ProgressRing } from "@/components/progress-ring";
import { TaskRow, type RowHint } from "@/components/task-row";
import { useKit } from "@/lib/kit";
import { fonts, usePlanner } from "@/lib/kit-theme";
import { GAP, drag, dropFor, setDropResolver, type Slot } from "@/lib/magic-plus";
import { BASE_MS, EASE_OUT, FAST_MS, SPRING } from "@/lib/motion";
import { taskHref } from "@/lib/route";
import { rememberTask } from "@/lib/tasks";

export type ListItem =
  | { kind: "task"; key: string; task: PlannerTask; hint?: RowHint }
  | { kind: "header"; key: string; title: string; detail?: string; lead?: string; colour?: string; slot?: Slot }
  | { kind: "project"; key: string; title: string; href: Href; done: number; total: number; colour?: string }
  | { kind: "area"; key: string; title: string; href: Href; colour: string }
  | { kind: "deadline"; key: string; task: PlannerTask }
  | { kind: "note"; key: string; text: string };

const settle = LinearTransition.duration(BASE_MS).easing(EASE_OUT);

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

const Shifted = memo(({ host, index, children }: { host: string; index: number; children: ReactNode }) => {
  const style = useAnimatedStyle(() => {
    const gap = drag.host.get() === host ? drag.gap.get() : -1;
    return { transform: [{ translateY: withSpring(gap >= 0 && index >= gap ? GAP : 0, { ...SPRING, reduceMotion: ReduceMotion.System }) }] };
  });
  return <Animated.View style={style}>{children}</Animated.View>;
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

const gapTopsOf = (items: readonly ListItem[], heights: ReadonlyMap<string, number>, droppable: (gap: number) => boolean) => {
  const tops: number[] = [];
  let y = PAD_TOP;
  for (let gap = 0; gap <= items.length; gap += 1) {
    tops.push(droppable(gap) ? y : Number.NaN);
    const height = gap < items.length ? heights.get(items[gap]?.key ?? "") : 0;
    y = height === undefined ? Number.NaN : y + height;
  }
  return tops;
};

const useDropHost = (items: readonly ListItem[], slot: Slot | undefined, tailOnly: boolean) => {
  const host = useId();
  const focused = useRef(false);
  const heights = useRef(new Map<string, number>());
  const frame = useRef<ComponentRef<typeof View>>(null);
  const frameTop = useRef(0);
  const scroll = useSharedValue(0);
  const tops = useRef<number[]>([]);
  const queued = useRef(false);
  const latest = useRef({ items, slot, tailOnly });

  useEffect(() => {
    latest.current = { items, slot, tailOnly };
  }, [items, slot, tailOnly]);

  const publish = useCallback(() => {
    if (!focused.current) return;
    drag.host.set(host);
    drag.frameTop.set(frameTop.current);
    drag.scrollY.set(scroll.get());
    drag.gapTops.set(tops.current);
  }, [host, scroll]);

  const remeasure = useCallback(() => {
    if (queued.current) return;
    queued.current = true;
    requestAnimationFrame(() => {
      queued.current = false;
      const { items: shown, slot: base, tailOnly: tail } = latest.current;
      tops.current = gapTopsOf(shown, heights.current, (gap) => dropFor(shown, gap, base, tail) !== undefined);
      if (focused.current) drag.gapTops.set(tops.current);
    });
  }, []);

  useEffect(remeasure, [items, slot, tailOnly, remeasure]);

  useFocusEffect(
    useCallback(() => {
      focused.current = true;
      publish();
      setDropResolver(host, (gap) => dropFor(latest.current.items, gap, latest.current.slot, latest.current.tailOnly));
      return () => {
        focused.current = false;
        setDropResolver(host, null);
        if (drag.host.get() === host && !drag.held.get()) {
          drag.host.set("");
          drag.gap.set(-1);
        }
      };
    }, [host, publish]),
  );

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

  return { host, frame, scroll, onScroll, onFrame, onRow };
};

export const TaskList = ({
  title,
  items,
  today,
  empty,
  onEndReached,
  onSearch,
  slot,
  tailOnly = false,
}: {
  title: string;
  items: readonly ListItem[] | undefined;
  today: string;
  empty: ReactNode;
  onEndReached?: () => void;
  onSearch?: (query: string) => void;
  slot?: Slot;
  tailOnly?: boolean;
}) => {
  const { colors } = useKit();
  const tones = usePlanner();
  const shown = items ?? NO_ITEMS;
  const { host, frame, scroll, onScroll, onFrame, onRow } = useDropHost(shown, slot, tailOnly);
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
          <Shifted host={host} index={index}>
            <View onLayout={(event) => onRow(item.key, event.nativeEvent.layout.height)}>
              {item.kind === "task" ? (
                <TaskRow task={item.task} today={today} {...(item.hint ? { hint: item.hint } : {})} />
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
