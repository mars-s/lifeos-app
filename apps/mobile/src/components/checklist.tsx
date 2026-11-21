import { GripVertical, Trash2 } from "lucide-react-native";
import { useLayoutEffect, useState } from "react";
import { StyleSheet, TextInput, View } from "react-native";
import { GestureDetector, usePanGesture } from "react-native-gesture-handler";
import Animated, { ReduceMotion, useAnimatedReaction, useAnimatedStyle, useSharedValue, withSpring, withTiming, type SharedValue } from "react-native-reanimated";
import { scheduleOnRN } from "react-native-worklets";
import { isOptimistic } from "@lifeos/backend/client/task-actions";
import type { PlannerTask } from "@lifeos/backend/types";
import { Checkbox } from "@/components/ui/checkbox";
import { haptic } from "@/lib/haptics";
import { useKit } from "@/lib/kit";
import { fonts, usePlanner } from "@/lib/kit-theme";
import { EASE_OUT, FAST_MS, SPRING, SPRING_SETTLE } from "@/lib/motion";
import type { actionsFor } from "@/lib/tasks";
import { useDraftText } from "@/lib/draft-text";

type Actions = ReturnType<typeof actionsFor>;
type Item = PlannerTask["checklist"][number];

type Drag = {
  dragged: SharedValue<number>;
  target: SharedValue<number>;
  dy: SharedValue<number>;
  lifted: SharedValue<number>;
  heights: SharedValue<number[]>;
};

const DELETE_AT = -88;
const SETTLE = { ...SPRING_SETTLE, reduceMotion: ReduceMotion.System };

const snap = () => haptic("snap");
const tick = () => haptic("toggle");

const targetFor = (heights: readonly number[], from: number, dy: number) => {
  "worklet";
  let top = 0;
  for (let index = 0; index < from; index += 1) top += heights[index] ?? 0;
  const centre = top + (heights[from] ?? 0) / 2 + dy;
  let above = 0;
  let edge = 0;
  for (let index = 0; index < heights.length; index += 1) {
    const height = heights[index] ?? 0;
    if (index !== from && edge + height / 2 < centre) above += 1;
    edge += height;
  }
  return above;
};

const restingOffset = (heights: readonly number[], from: number, to: number) => {
  "worklet";
  let offset = 0;
  if (to > from) for (let index = from + 1; index <= to; index += 1) offset += heights[index] ?? 0;
  else for (let index = to; index < from; index += 1) offset -= heights[index] ?? 0;
  return offset;
};

const ChecklistRow = ({ item, index, drag, actions, onMove }: { item: Item; index: number; drag: Drag; actions: Actions; onMove: (from: number, to: number) => void }) => {
  const { colors } = useKit();
  const tones = usePlanner();
  const field = useDraftText(item.title, (title) => (title === "" ? actions.removeItem(item._id) : actions.editItem(item._id, title)));
  const saved = !isOptimistic(item._id);
  const x = useSharedValue(0);

  const remove = () => {
    haptic("drop");
    actions.removeItem(item._id);
  };

  const swipe = usePanGesture({
    enabled: saved,
    activeOffsetX: [-14, 14],
    failOffsetY: [-10, 10],
    onUpdate: (event) => {
      "worklet";
      x.set(Math.min(0, event.translationX));
    },
    onDeactivate: (event) => {
      "worklet";
      const armed = x.get() <= DELETE_AT || (event.velocityX < -800 && x.get() < -24);
      if (armed && !event.canceled) {
        x.set(withTiming(-480, { duration: FAST_MS, easing: EASE_OUT }));
        scheduleOnRN(remove);
      } else x.set(withSpring(0, { ...SETTLE, velocity: event.velocityX }));
    },
  });

  const grip = usePanGesture({
    enabled: saved,
    minDistance: 2,
    onActivate: () => {
      "worklet";
      drag.dragged.set(index);
      drag.target.set(index);
      drag.dy.set(0);
      drag.lifted.set(1);
      scheduleOnRN(snap);
    },
    onUpdate: (event) => {
      "worklet";
      drag.dy.set(event.translationY);
      drag.target.set(targetFor(drag.heights.get(), index, event.translationY));
    },
    onDeactivate: (event) => {
      "worklet";
      const to = drag.target.get();
      drag.lifted.set(0);
      if (event.canceled || to === index) {
        drag.dy.set(withSpring(0, { ...SETTLE, velocity: event.velocityY }));
        drag.target.set(index);
        return;
      }
      drag.dy.set(withSpring(restingOffset(drag.heights.get(), index, to), SETTLE));
      scheduleOnRN(onMove, index, to);
    },
  });

  useAnimatedReaction(
    () => x.get() <= DELETE_AT,
    (armed, before) => {
      if (before !== null && armed !== before) scheduleOnRN(tick);
    },
  );

  const place = useAnimatedStyle(() => {
    const from = drag.dragged.get();
    const to = drag.target.get();
    const height = drag.heights.get()[from] ?? 0;
    if (from === index) {
      return {
        zIndex: 2,
        transform: [{ translateY: drag.dy.get() }, { scale: withTiming(drag.lifted.get() ? 1.03 : 1, { duration: FAST_MS, easing: EASE_OUT }) }],
      };
    }
    if (from < 0) return { zIndex: 0, transform: [{ translateY: 0 }, { scale: 1 }] };
    const shift = from < index && index <= to ? -height : to <= index && index < from ? height : 0;
    return { zIndex: 0, transform: [{ translateY: withSpring(shift, SPRING) }, { scale: 1 }] };
  });
  const lift = useAnimatedStyle(() => ({ opacity: withTiming(drag.dragged.get() === index && drag.lifted.get() ? 1 : 0, { duration: FAST_MS }) }));
  const slide = useAnimatedStyle(() => ({ transform: [{ translateX: x.get() }] }));
  const bin = useAnimatedStyle(() => ({ opacity: x.get() < -4 ? 1 : 0, transform: [{ scale: withTiming(x.get() <= DELETE_AT ? 1.15 : 1, { duration: FAST_MS, easing: EASE_OUT }) }] }));

  return (
    <Animated.View
      style={place}
      onLayout={(event) => {
        const height = event.nativeEvent.layout.height;
        drag.heights.set((current) => {
          if (current[index] === height) return current;
          const next = [...current];
          next[index] = height;
          return next;
        });
      }}
    >
      <Animated.View pointerEvents="none" style={[StyleSheet.absoluteFill, styles.lift, { backgroundColor: colors.popover, borderColor: colors.border }, lift]} />
      <Animated.View pointerEvents="none" style={[styles.bin, { backgroundColor: colors.danger }, bin]}>
        <Trash2 size={18} color={colors.dangerForeground} strokeWidth={2} />
      </Animated.View>
      <GestureDetector gesture={swipe}>
        <Animated.View style={[styles.item, { backgroundColor: colors.popover }, slide]}>
          <Checkbox
            checked={item.done}
            onChange={(done) => {
              haptic(done ? "complete" : "toggle");
              actions.tickItem(item._id, done);
            }}
            size={18}
            accent={colors.accent}
            style={styles.itemCheck}
          />
          <TextInput
            {...field}
            accessibilityLabel={`Checklist Item: ${item.title}`}
            accessibilityHint="Swipe left to delete it"
            accessibilityActions={[{ name: "delete", label: "Delete" }]}
            onAccessibilityAction={(event) => (event.nativeEvent.actionName === "delete" ? remove() : undefined)}
            multiline
            submitBehavior="blurAndSubmit"
            returnKeyType="done"
            style={[styles.itemText, { color: item.done ? tones.faintForeground : colors.foreground }, item.done ? styles.struck : null]}
          />
          <GestureDetector gesture={grip}>
            <View accessibilityLabel={`Reorder ${item.title}`} style={styles.grip}>
              <GripVertical size={16} color={tones.faintForeground} strokeWidth={1.75} />
            </View>
          </GestureDetector>
        </Animated.View>
      </GestureDetector>
    </Animated.View>
  );
};

export const Checklist = ({ task, actions }: { task: PlannerTask; actions: Actions }) => {
  const { colors } = useKit();
  const tones = usePlanner();
  const [fresh, setFresh] = useState("");
  const drag = {
    dragged: useSharedValue(-1),
    target: useSharedValue(-1),
    dy: useSharedValue(0),
    lifted: useSharedValue(0),
    heights: useSharedValue<number[]>([]),
  } satisfies Drag;
  const orderKey = task.checklist.map((item) => item._id).join(",");

  useLayoutEffect(() => {
    drag.dragged.set(-1);
    drag.target.set(-1);
    drag.dy.set(0);
    drag.heights.set((current) => current.slice(0, orderKey === "" ? 0 : orderKey.split(",").length));
  }, [orderKey, drag.dragged, drag.target, drag.dy, drag.heights]);

  const move = (from: number, to: number) => {
    const item = task.checklist[from];
    if (!item) return;
    haptic("drop");
    actions.moveItem(item._id, to);
  };

  const add = () => {
    const title = fresh.trim();
    if (title === "") return;
    setFresh("");
    haptic("toggle");
    void actions.addItem(title);
  };

  return (
    <View style={styles.checklist}>
      {task.checklist.map((item, index) => (
        <ChecklistRow key={item._id} item={item} index={index} drag={drag} actions={actions} onMove={move} />
      ))}
      <View style={styles.item}>
        <View style={[styles.itemCheck, styles.itemGhost]}>
          <View style={[styles.ghostBox, { borderColor: tones.faintForeground }]} />
        </View>
        <TextInput
          value={fresh}
          onChangeText={setFresh}
          onSubmitEditing={add}
          onBlur={add}
          submitBehavior="submit"
          returnKeyType="next"
          placeholder="Add a Checklist Item"
          placeholderTextColor={tones.faintForeground}
          accessibilityLabel="Add a Checklist Item"
          style={[styles.itemText, { color: colors.foreground }]}
        />
      </View>
    </View>
  );
};

const styles = StyleSheet.create({
  checklist: { paddingVertical: 4 },
  item: { flexDirection: "row", alignItems: "flex-start", minHeight: 40 },
  itemCheck: { padding: 10, paddingTop: 11 },
  itemGhost: { opacity: 0.6 },
  ghostBox: { width: 18, height: 18, borderRadius: 5, borderWidth: 1.5, borderStyle: "dashed" },
  itemText: { flex: 1, fontFamily: fonts.regular, fontSize: 16, lineHeight: 22, paddingTop: 9, paddingBottom: 9 },
  struck: { textDecorationLine: "line-through" },
  grip: { width: 40, minHeight: 40, alignItems: "center", justifyContent: "center" },
  lift: { borderRadius: 12, borderWidth: StyleSheet.hairlineWidth, shadowColor: "#000", shadowOpacity: 0.12, shadowRadius: 12, shadowOffset: { width: 0, height: 4 } },
  bin: { position: "absolute", right: 0, top: 0, bottom: 0, width: 72, borderRadius: 12, alignItems: "center", justifyContent: "center" },
});
