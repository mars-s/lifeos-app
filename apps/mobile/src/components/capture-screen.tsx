import { useLocalSearchParams, useRouter } from "expo-router";
import { ArrowUp, CalendarDays, Flag, Moon, Star } from "lucide-react-native";
import { useEffect, useMemo, useState } from "react";
import { Pressable, StyleSheet, Text, TextInput, View } from "react-native";
import Animated, { useAnimatedStyle, useSharedValue, withSequence, withTiming } from "react-native-reanimated";
import { api } from "@lifeos/backend/api";
import { captureArgs, captureLists, destinationOf, resolveCapture, type CaptureChip, type ResolvedCapture } from "@lifeos/backend/client/capture-model";
import { shortDay, whenLabel } from "@lifeos/backend/client/dates";
import { taskAliases } from "@lifeos/backend/client/task-aliases";
import { both, dropTasks, nothing, patchSidebar, showNewTask } from "@lifeos/backend/client/updaters";
import type { Id } from "@lifeos/backend/dataModel";
import type { IsoDate } from "@lifeos/backend/date";
import { formatMinutes } from "@lifeos/backend/estimate";
import type { PlannerTask } from "@lifeos/backend/types";
import { change } from "@/lib/change";
import { drag, type Drop } from "@/lib/magic-plus";
import { haptic } from "@/lib/haptics";
import { useKit } from "@/lib/kit";
import { fonts, usePlanner } from "@/lib/kit-theme";
import { EASE_OUT } from "@/lib/motion";
import { useLocalDate, useView, valueOf } from "@/lib/views";

const NO_LABELS: never[] = [];
let captured = 0;

type Placement = { parent?: PlannerTask["parent"]; order?: string; slot?: Drop };

const placementOf = (capture: ResolvedCapture, slot: Drop | undefined) => {
  if (!slot) return { capture, placement: {} satisfies Placement };
  const ownWhen = capture.chips.some((chip) => chip.field === "when");
  const ownList = capture.list !== undefined;
  return {
    capture: ownWhen ? capture : { ...capture, when: slot.when },
    placement: (ownList ? {} : { parent: slot.parent, slot, ...(slot.order ? { order: slot.order } : {}) }) satisfies Placement,
  };
};

const draftOf = (capture: ResolvedCapture, key: string, placement: Placement) =>
  ({
    _id: key as Id<"tasks">,
    _creationTime: Date.now(),
    title: capture.title,
    notes: "",
    when: capture.when,
    parent:
      placement.parent ??
      (capture.list?.kind === "area"
        ? { kind: "area", areaId: capture.list.id }
        : capture.list?.kind === "project"
          ? { kind: "project", projectId: capture.list.id }
          : { kind: "loose" }),
    labelIds: capture.labels.map((label) => label._id),
    status: { kind: "open" },
    order: placement.order ?? "~",
    context: placement.slot ? placement.slot.context : capture.list?.title,
    area: placement.slot ? placement.slot.area : capture.list?.area,
    project: placement.slot ? placement.slot.project : capture.list?.kind === "project" ? { _id: capture.list.id, title: capture.list.title } : undefined,
    labels: [...capture.labels],
    checklist: [],
    workBlocks: [],
    focus: { ms: 0, sessions: [] },
    ...(capture.deadline ? { deadline: capture.deadline } : {}),
    ...(capture.estimateMinutes === undefined ? {} : { estimateMinutes: capture.estimateMinutes }),
  }) satisfies PlannerTask;

const uncount = (task: PlannerTask, today: string) =>
  patchSidebar((sidebar) => ({
    ...sidebar,
    counts: {
      inbox: Math.max(sidebar.counts.inbox - (task.when.kind === "inbox" ? 1 : 0), 0),
      today: Math.max(sidebar.counts.today - (task.when.kind === "scheduled" && task.when.date <= today ? 1 : 0), 0),
    },
  }));

const landing = (capture: ResolvedCapture, placement: Placement, today: string) =>
  placement.slot && capture.when === placement.slot.when ? placement.slot.label : destinationOf(capture.when, capture.list ?? (placement.slot?.context ? { title: placement.slot.context } : undefined), today);

const send = (capture: ResolvedCapture, placement: Placement, today: IsoDate, text: string, reopen: (text: string) => void) => {
  captured += 1;
  const key = `optimistic:task:${captured}`;
  const task = draftOf(capture, key, placement);
  void change({
    title: `Captured to ${landing(capture, placement, today)}`,
    mutation: api.planner.tasks.create,
    args: { ...captureArgs(capture), ...(placement.parent ? { parent: placement.parent } : {}), ...(placement.order ? { order: placement.order } : {}) },
    apply: showNewTask(task, today),
    revert: (store) => both(dropTasks([taskAliases.realId(key)]), uncount(task, today))(store),
    onSaved: ({ taskId }) => {
      taskAliases.set(key, taskId);
      for (const label of capture.freshLabels) {
        void change({ title: `Labelled ${label.name}`, mutation: api.planner.labels.create, args: { ...label, taskId }, apply: nothing, revert: nothing, silent: true });
      }
    },
  }).then((saved) => (saved ? undefined : reopen(text)));
};

const Chip = ({ chip, today, onPress }: { chip: CaptureChip; today: string; onPress: () => void }) => {
  const { colors } = useKit();
  const tones = usePlanner();
  const isToday = chip.field === "when" && chip.when.kind === "scheduled" && chip.when.date <= today;
  const tint = chip.field === "deadline" ? tones.deadline : colors.foreground;
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityHint="Keeps these words in the title instead"
      onPress={onPress}
      style={({ pressed }) => [styles.chip, { backgroundColor: tones.surface, transform: [{ scale: pressed ? 0.97 : 1 }] }]}
    >
      {chip.field === "when" && isToday ? (
        chip.when.kind === "scheduled" && chip.when.evening ? (
          <Moon size={13} color={colors.accent} fill={colors.accent} />
        ) : (
          <Star size={13} color={colors.accent} fill={colors.accent} />
        )
      ) : null}
      {chip.field === "when" && !isToday ? <CalendarDays size={13} color={colors.mutedForeground} /> : null}
      {chip.field === "deadline" ? <Flag size={13} color={tint} fill={tint} /> : null}
      {chip.field === "label" ? <View style={[styles.dot, { backgroundColor: tones.area[chip.colour] }]} /> : null}
      {chip.field === "list" && chip.list.area ? <View style={[styles.dot, { backgroundColor: tones.area[chip.list.area.colour] }]} /> : null}
      <Text style={[chip.field === "estimate" ? styles.chipFigure : styles.chipLabel, { color: tint }]}>
        {chip.field === "when"
          ? whenLabel(chip.when, today)
          : chip.field === "deadline"
            ? shortDay(chip.deadline)
            : chip.field === "estimate"
              ? formatMinutes(chip.minutes)
              : chip.field === "label"
                ? chip.name
                : chip.list.title}
      </Text>
      {chip.field === "label" && chip.fresh ? <Text style={[styles.chipNote, { color: tones.faintForeground }]}>New Label</Text> : null}
    </Pressable>
  );
};

export const CaptureScreen = () => {
  const params = useLocalSearchParams<{ text?: string; slot?: string }>();
  const [slot] = useState(() => (params.slot ? (JSON.parse(params.slot) as Drop) : undefined));
  const { colors } = useKit();
  const tones = usePlanner();
  const router = useRouter();
  const today = useLocalDate() as IsoDate;
  const sidebar = valueOf(useView(api.planner.sidebar.get, { date: today }));
  const labels = useView(api.planner.labels.list, {}) ?? NO_LABELS;
  const [text, setText] = useState(params.text ?? "");
  const [ignored, setIgnored] = useState<ReadonlySet<string>>(() => new Set());
  const lists = useMemo(() => captureLists(sidebar), [sidebar]);
  const { capture, placement } = useMemo(() => placementOf(resolveCapture(text, today, ignored, labels, lists), slot), [text, today, ignored, labels, lists, slot]);
  useEffect(
    () => () => {
      drag.held.set(false);
      drag.gap.set(-1);
    },
    [],
  );
  const nudge = useSharedValue(0);
  const shaken = useAnimatedStyle(() => ({ transform: [{ translateX: nudge.get() }] }));
  const ready = capture.title.trim() !== "";

  const save = () => {
    if (!ready) {
      haptic("error");
      nudge.set(withSequence(withTiming(-7, { duration: 60 }), withTiming(6, { duration: 70 }), withTiming(-3, { duration: 70 }), withTiming(0, { duration: 80, easing: EASE_OUT })));
      return;
    }
    haptic("drop");
    send(capture, placement, today, text, (kept) => router.push({ pathname: "/capture", params: { text: kept, ...(params.slot ? { slot: params.slot } : {}) } }));
    router.back();
  };

  return (
    <View collapsable={false} style={[styles.sheet, { backgroundColor: colors.popover }]}>
      <Animated.View style={shaken}>
        <TextInput
          value={text}
          onChangeText={setText}
          onSubmitEditing={save}
          submitBehavior="submit"
          autoFocus
          returnKeyType="done"
          enablesReturnKeyAutomatically
          placeholder="New Task"
          placeholderTextColor={tones.faintForeground}
          accessibilityLabel="New Task"
          style={[styles.input, { color: colors.foreground }]}
        />
      </Animated.View>
      {capture.chips.length > 0 ? (
        <View style={styles.chips}>
          {capture.chips.map((chip) => (
            <Chip
              key={`${chip.field}:${chip.token}`}
              chip={chip}
              today={today}
              onPress={() => setIgnored((current) => new Set([...current, chip.token, ...chip.token.replace(/^!/, "").split(/\s+/)]))}
            />
          ))}
        </View>
      ) : null}
      <View style={styles.foot}>
        <Text style={[styles.lands, { color: colors.mutedForeground }]}>
          {ready ? `Saves to ${landing(capture, placement, today)}` : slot ? `New Task in ${slot.label}` : "tomorrow 30m #label !fri"}
        </Text>
        <Pressable
          accessibilityRole="button"
          accessibilityLabel="Save"
          accessibilityState={{ disabled: !ready }}
          onPress={save}
          style={({ pressed }) => [styles.save, { backgroundColor: ready ? colors.accent : tones.surfaceRaised, transform: [{ scale: pressed ? 0.94 : 1 }] }]}
        >
          <ArrowUp size={20} color={ready ? colors.accentForeground : tones.faintForeground} strokeWidth={2.5} />
        </Pressable>
      </View>
    </View>
  );
};

const styles = StyleSheet.create({
  sheet: { paddingHorizontal: 20, paddingTop: 22, paddingBottom: 14, gap: 12 },
  input: { fontFamily: fonts.medium, fontSize: 20, lineHeight: 26, letterSpacing: -0.4, minHeight: 36, padding: 0 },
  chips: { flexDirection: "row", flexWrap: "wrap", gap: 8 },
  chip: { flexDirection: "row", alignItems: "center", gap: 6, height: 32, paddingHorizontal: 12, borderRadius: 16 },
  chipLabel: { fontFamily: fonts.medium, fontSize: 14, lineHeight: 18 },
  chipFigure: { fontFamily: fonts.monoMedium, fontSize: 13, lineHeight: 18 },
  chipNote: { fontFamily: fonts.regular, fontSize: 12, lineHeight: 18 },
  dot: { width: 8, height: 8, borderRadius: 4 },
  foot: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", minHeight: 44 },
  lands: { fontFamily: fonts.regular, fontSize: 14, lineHeight: 20 },
  save: { width: 40, height: 40, borderRadius: 20, alignItems: "center", justifyContent: "center" },
});
