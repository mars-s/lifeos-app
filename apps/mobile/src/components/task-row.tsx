import { useRouter } from "expo-router";
import { CalendarDays, Check, Flag, ListChecks, Moon, Repeat, Star, StickyNote } from "lucide-react-native";
import { memo } from "react";
import { Pressable, StyleSheet, Text, View } from "react-native";
import { GestureDetector, useCompetingGestures, usePanGesture } from "react-native-gesture-handler";
import Animated, { interpolate, useAnimatedReaction, useAnimatedStyle, useSharedValue, withSpring, withTiming } from "react-native-reanimated";
import { scheduleOnRN } from "react-native-worklets";
import { deadlineMark, relativeDay, shortDay } from "@lifeos/backend/client/dates";
import type { PlannerTask } from "@lifeos/backend/types";
import { FocusTime, openFocusMenu, useTimeShown } from "@/components/focus-time";
import { Checkbox } from "@/components/ui/checkbox";
import { haptic } from "@/lib/haptics";
import { useKit } from "@/lib/kit";
import { drag, dropRow, liftRow, nudgeRow, reorderTarget } from "@/lib/magic-plus";
import { fonts, usePlanner } from "@/lib/kit-theme";
import { EASE_OUT, FAST_MS, SPRING, SPRING_SETTLE } from "@/lib/motion";
import { taskHref, toolHref } from "@/lib/route";
import { actionsFor, completeSoon, isUnsaved, keepOpen, rememberTask, useLingering } from "@/lib/tasks";

const ARM_AT = 76;
const FLICK = 900;
const SLACK = 0.28;
const BOX = 22;
const LIFT_MS = 350;
const HOLD_SLOP = 8;

export type RowHint = "context" | "when" | "none";

const tick = () => haptic("snap");

const pull = (distance: number) => {
  "worklet";
  const past = Math.max(Math.abs(distance) - ARM_AT, 0);
  return Math.sign(distance) * (Math.min(Math.abs(distance), ARM_AT) + past * SLACK);
};

const whenHint = (task: PlannerTask, today: string) => {
  if (task.when.kind !== "scheduled") return undefined;
  if (task.when.date <= today) return task.when.evening ? ("evening" as const) : ("today" as const);
  return relativeDay(task.when.date, today) ?? shortDay(task.when.date);
};

const Meta = ({ task, today, hint }: { task: PlannerTask; today: string; hint: RowHint }) => {
  const { colors } = useKit();
  const tones = usePlanner();
  const when = hint === "when" ? whenHint(task, today) : undefined;
  const done = task.checklist.filter((item) => item.done).length;
  const deadline = task.deadline && task.status.kind === "open" ? deadlineMark(task.deadline, today) : undefined;
  const context = hint === "context" ? task.context : undefined;
  const timeShown = useTimeShown(task);
  const quiet = !when && !context && task.checklist.length === 0 && !timeShown && !deadline && !task.repeat?.active && task.labels.length === 0 && task.notes === "";
  if (quiet) return null;
  return (
    <View style={styles.meta}>
      {when === "today" ? <Star size={12} color={colors.accent} fill={colors.accent} /> : null}
      {when === "evening" ? <Moon size={12} color={colors.accent} fill={colors.accent} /> : null}
      {when && when !== "today" && when !== "evening" ? (
        <View style={styles.pair}>
          <CalendarDays size={12} color={colors.mutedForeground} />
          <Text style={[styles.small, { color: colors.mutedForeground }]}>{when}</Text>
        </View>
      ) : null}
      {context ? (
        <View style={styles.pair}>
          {task.area ? <View style={[styles.dot, { backgroundColor: tones.area[task.area.colour] }]} /> : null}
          <Text numberOfLines={1} style={[styles.small, styles.context, { color: colors.mutedForeground }]}>
            {context}
          </Text>
        </View>
      ) : null}
      <FocusTime task={task} />
      {task.checklist.length > 0 ? (
        <View style={styles.pair}>
          <ListChecks size={12} color={tones.faintForeground} />
          <Text style={[styles.count, { color: colors.mutedForeground }]}>
            {done}/{task.checklist.length}
          </Text>
        </View>
      ) : null}
      {task.repeat?.active ? <Repeat size={12} color={tones.faintForeground} /> : null}
      {task.notes === "" ? null : <StickyNote size={12} color={tones.faintForeground} />}
      {task.labels.map((label) => (
        <View key={label._id} style={styles.pair}>
          <View style={[styles.dot, { backgroundColor: tones.area[label.colour] }]} />
          <Text numberOfLines={1} style={[styles.small, { color: colors.mutedForeground }]}>
            {label.name}
          </Text>
        </View>
      ))}
      {deadline ? (
        <View style={[styles.pair, styles.deadline]}>
          <Flag size={12} color={deadline.overdue ? colors.danger : tones.deadline} fill={deadline.overdue ? colors.danger : tones.deadline} />
          <Text style={[styles.small, { color: deadline.overdue ? colors.danger : tones.deadline }]}>
            {deadline.label} · {deadline.countdown}
          </Text>
        </View>
      ) : null}
    </View>
  );
};

type Place = { host: string; index: number };

const useLift = (task: PlannerTask, place: Place | undefined, onHold: () => void) => {
  const host = place?.host ?? "";
  const index = place?.index ?? -1;
  const mine = () => {
    "worklet";
    return host !== "" && drag.host.get() === host && drag.source.get() === index;
  };
  return usePanGesture({
    enabled: place !== undefined && !isUnsaved(task._id),
    activateAfterLongPress: LIFT_MS,
    onActivate: () => {
      "worklet";
      if (host === "") return;
      drag.host.set(host);
      drag.allowed.set([]);
      drag.size.set(0);
      drag.dy.set(0);
      drag.startScroll.set(drag.scrollY.get());
      drag.target.set(index);
      drag.source.set(index);
      scheduleOnRN(liftRow, host, index);
    },
    onUpdate: (event) => {
      "worklet";
      if (!mine()) return;
      drag.dy.set(event.translationY);
      const target = reorderTarget();
      if (target === drag.target.get()) return;
      drag.target.set(target);
      scheduleOnRN(tick);
    },
    onDeactivate: (event) => {
      "worklet";
      if (!mine()) return;
      const still = Math.abs(event.translationX) < HOLD_SLOP && Math.abs(event.translationY) < HOLD_SLOP;
      scheduleOnRN(dropRow, host, index, still ? index : drag.target.get(), event.canceled);
      if (still && !event.canceled) scheduleOnRN(onHold);
    },
  });
};

export const TaskRow = memo(({ task, today, hint = "context", host, index }: { task: PlannerTask; today: string; hint?: RowHint; host?: string; index?: number }) => {
  const { colors } = useKit();
  const tones = usePlanner();
  const router = useRouter();
  const lingering = useLingering(task._id);
  const closed = task.status.kind !== "open";
  const ticked = closed || lingering;
  const x = useSharedValue(0);
  const pressed = useSharedValue(0);

  const complete = () => (closed ? undefined : completeSoon(task));
  const schedule = () => router.push(toolHref("when", task._id));
  const open = () => router.push(taskHref(task._id));
  const toggle = (checked: boolean) => {
    if (closed) return void actionsFor(task, today).reopen();
    if (checked) completeSoon(task);
    else keepOpen(task);
  };

  const pan = usePanGesture({
    enabled: !isUnsaved(task._id),
    activeOffsetX: [-14, 14],
    failOffsetY: [-12, 12],
    onUpdate: (event) => {
      "worklet";
      x.set(pull(event.translationX));
    },
    onDeactivate: (event) => {
      "worklet";
      const flung = Math.abs(event.velocityX) > FLICK && Math.sign(event.velocityX) === Math.sign(x.get()) && Math.abs(x.get()) > 24;
      const armed = Math.abs(x.get()) >= ARM_AT || flung;
      if (armed && !event.canceled) scheduleOnRN(x.get() > 0 ? complete : schedule);
      x.set(withSpring(0, { ...SPRING_SETTLE, velocity: event.velocityX }));
    },
  });

  const place = host !== undefined && index !== undefined ? { host, index } : undefined;
  const menu = () => openFocusMenu(task, () => router.push("/focus"));
  const lift = useLift(task, place, menu);
  const gesture = useCompetingGestures(lift, pan);

  useAnimatedReaction(
    () => Math.abs(x.get()) >= ARM_AT,
    (armed, before) => {
      if (before !== null && armed !== before) scheduleOnRN(tick);
    },
  );

  const rowStyle = useAnimatedStyle(() => ({ transform: [{ translateX: x.get() }, { scale: withTiming(pressed.get() ? 0.985 : 1, { duration: FAST_MS, easing: EASE_OUT }) }] }));
  const doneStyle = useAnimatedStyle(() => ({ opacity: x.get() > 0 ? 1 : 0 }));
  const whenStyle = useAnimatedStyle(() => ({ opacity: x.get() < 0 ? 1 : 0 }));
  const doneIcon = useAnimatedStyle(() => ({
    transform: [{ scale: withSpring(x.get() >= ARM_AT ? 1.15 : interpolate(x.get(), [0, ARM_AT], [0.7, 1], "clamp"), SPRING) }],
  }));
  const whenIcon = useAnimatedStyle(() => ({
    transform: [{ scale: withSpring(x.get() <= -ARM_AT ? 1.15 : interpolate(-x.get(), [0, ARM_AT], [0.7, 1], "clamp"), SPRING) }],
  }));

  return (
    <View style={styles.wrap}>
      <Animated.View style={[styles.under, styles.underLeft, { backgroundColor: colors.success }, doneStyle]}>
        <Animated.View style={doneIcon}>
          <Check size={22} color={colors.background} strokeWidth={2.5} />
        </Animated.View>
      </Animated.View>
      <Animated.View style={[styles.under, styles.underRight, { backgroundColor: colors.accent }, whenStyle]}>
        <Animated.View style={whenIcon}>
          <CalendarDays size={22} color={colors.accentForeground} />
        </Animated.View>
      </Animated.View>
      <GestureDetector gesture={gesture}>
        <Animated.View style={[styles.row, { backgroundColor: colors.background }, rowStyle]}>
          <Checkbox
            checked={ticked}
            onChange={toggle}
            size={BOX}
            accent={colors.accent}
            style={styles.check}
            disabled={isUnsaved(task._id)}
          />
          <Pressable
            accessibilityRole="button"
            accessibilityLabel={task.title}
            accessibilityHint="Opens the Task"
            accessibilityActions={[
              { name: "complete", label: closed ? "Reopen" : "Complete" },
              { name: "schedule", label: "Schedule" },
              ...(place ? [{ name: "moveUp", label: "Move up" }, { name: "moveDown", label: "Move down" }] : []),
            ]}
            onAccessibilityAction={(event) => {
              const action = event.nativeEvent.actionName;
              if (action === "complete") return toggle(true);
              if (action === "schedule") return schedule();
              if (place) nudgeRow(place.host, place.index, action === "moveUp" ? -1 : 1);
            }}
            onPressIn={() => {
              pressed.set(1);
              rememberTask(task);
            }}
            onPressOut={() => pressed.set(0)}
            onPress={open}
            {...(place ? {} : { onLongPress: menu })}
            disabled={isUnsaved(task._id)}
            style={styles.body}
          >
            <Text
              style={[
                styles.title,
                { color: ticked ? tones.faintForeground : colors.foreground },
                ticked ? styles.struck : null,
              ]}
            >
              {task.title}
            </Text>
            <Meta task={task} today={today} hint={hint} />
          </Pressable>
        </Animated.View>
      </GestureDetector>
    </View>
  );
});

TaskRow.displayName = "TaskRow";

const styles = StyleSheet.create({
  wrap: { overflow: "hidden" },
  under: { position: "absolute", top: 0, right: 0, bottom: 0, left: 0, justifyContent: "center", paddingHorizontal: 26 },
  underLeft: { alignItems: "flex-start" },
  underRight: { alignItems: "flex-end" },
  row: { flexDirection: "row", alignItems: "flex-start", paddingLeft: 9, paddingRight: 20, minHeight: 48 },
  check: { padding: 11, paddingTop: 13 },
  body: { flex: 1, paddingVertical: 12, gap: 4 },
  title: { fontFamily: fonts.regular, fontSize: 17, lineHeight: 24, letterSpacing: -0.2 },
  struck: { textDecorationLine: "line-through" },
  meta: { flexDirection: "row", flexWrap: "wrap", alignItems: "center", columnGap: 10, rowGap: 4 },
  pair: { flexDirection: "row", alignItems: "center", gap: 5, flexShrink: 1 },
  deadline: { marginLeft: "auto" },
  dot: { width: 7, height: 7, borderRadius: 4 },
  small: { fontFamily: fonts.regular, fontSize: 13, lineHeight: 18 },
  context: { flexShrink: 1 },
  count: { fontFamily: fonts.mono, fontSize: 12, lineHeight: 18 },
});
