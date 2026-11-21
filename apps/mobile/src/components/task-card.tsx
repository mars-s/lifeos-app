import { useLocalSearchParams, useRouter } from "expo-router";
import { CalendarDays, ChevronRight, Flag, Moon, Repeat, Star, Tag, Timer, Trash2, type LucideIcon } from "lucide-react-native";
import { useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { Pressable, ScrollView, StyleSheet, Text, TextInput, View } from "react-native";
import { api } from "@lifeos/backend/api";
import { deadlineMark, whenLabel } from "@lifeos/backend/client/dates";
import { lowerFirst, repeatLabel } from "@lifeos/backend/client/repeat";
import { quoted } from "@lifeos/backend/client/task-actions";
import { trashingTasks } from "@lifeos/backend/client/updaters";
import type { Id } from "@lifeos/backend/dataModel";
import { formatMinutes } from "@lifeos/backend/estimate";
import type { PlannerTask } from "@lifeos/backend/types";
import { Checkbox } from "@/components/ui/checkbox";
import { Toaster } from "@/components/ui/toast";
import { EmptyNote } from "@/components/task-list";
import { change } from "@/lib/change";
import { haptic } from "@/lib/haptics";
import { useKit } from "@/lib/kit";
import { fonts, usePlanner } from "@/lib/kit-theme";
import { toolHref, type Tool } from "@/lib/route";
import { actionsFor, completeSoon, keepOpen, useLingering, useTask } from "@/lib/tasks";
import { useLocalDate } from "@/lib/views";

type Actions = ReturnType<typeof actionsFor>;
type Item = PlannerTask["checklist"][number];

const useDraftText = (saved: string, commit: (text: string) => void) => {
  const [draft, setDraft] = useState<string | null>(null);
  const latest = useRef({ draft, saved, commit });
  useEffect(() => {
    latest.current = { draft, saved, commit };
  });
  useEffect(
    () => () => {
      const now = latest.current;
      if (now.draft !== null && now.draft.trim() !== now.saved.trim()) now.commit(now.draft.trim());
    },
    [],
  );
  return {
    value: draft ?? saved,
    onChangeText: setDraft,
    onFocus: () => setDraft(saved),
    onBlur: () => {
      if (draft !== null && draft.trim() !== saved.trim()) commit(draft.trim());
      setDraft(null);
    },
  };
};

const ChecklistRow = ({ item, actions }: { item: Item; actions: Actions }) => {
  const { colors } = useKit();
  const tones = usePlanner();
  const field = useDraftText(item.title, (title) => (title === "" ? actions.removeItem(item._id) : actions.editItem(item._id, title)));
  return (
    <View style={styles.item}>
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
        accessibilityLabel="Checklist Item"
        multiline
        submitBehavior="blurAndSubmit"
        returnKeyType="done"
        style={[styles.itemText, { color: item.done ? tones.faintForeground : colors.foreground }, item.done ? styles.struck : null]}
      />
    </View>
  );
};

const Checklist = ({ task, actions }: { task: PlannerTask; actions: Actions }) => {
  const { colors } = useKit();
  const tones = usePlanner();
  const [fresh, setFresh] = useState("");
  const add = () => {
    const title = fresh.trim();
    if (title === "") return;
    setFresh("");
    void actions.addItem(title);
  };
  return (
    <View style={styles.checklist}>
      {task.checklist.map((item) => (
        <ChecklistRow key={item._id} item={item} actions={actions} />
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

const ToolRow = ({ tool, taskId, icon: Icon, label, value, tint, figure }: { tool: Tool; taskId: Id<"tasks">; icon: LucideIcon; label: string; value: ReactNode; tint?: string; figure?: boolean }) => {
  const { colors } = useKit();
  const tones = usePlanner();
  const router = useRouter();
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={label}
      onPress={() => router.push(toolHref(tool, taskId))}
      style={({ pressed }) => [styles.tool, pressed ? { backgroundColor: tones.surface } : null]}
    >
      <Icon size={18} color={tint ?? colors.mutedForeground} strokeWidth={1.75} {...(tint ? { fill: tint } : {})} />
      <Text style={[styles.toolLabel, { color: colors.mutedForeground }]}>{label}</Text>
      <Text numberOfLines={1} style={[figure ? styles.toolFigure : styles.toolValue, { color: tint ?? colors.foreground }]}>
        {value}
      </Text>
      <ChevronRight size={16} color={tones.faintForeground} />
    </Pressable>
  );
};

const whenIcon = (task: PlannerTask, today: string) =>
  task.when.kind === "scheduled" && task.when.date <= today ? (task.when.evening ? Moon : Star) : CalendarDays;

const Card = ({ task, today }: { task: PlannerTask; today: string }) => {
  const { colors } = useKit();
  const tones = usePlanner();
  const router = useRouter();
  const actions = useMemo(() => actionsFor(task, today), [task, today]);
  const lingering = useLingering(task._id);
  const closed = task.status.kind !== "open";
  const title = useDraftText(task.title, (text) => (text === "" ? undefined : actions.rename(text)));
  const notes = useDraftText(task.notes, actions.setNotes);
  const deadline = task.deadline ? deadlineMark(task.deadline, today) : undefined;
  const isToday = task.when.kind === "scheduled" && task.when.date <= today;
  const trash = () => {
    haptic("drop");
    void change({
      title: `Moved ${quoted(task.title)} to Trash`,
      mutation: api.planner.tasks.trash,
      args: { taskId: task._id },
      ...trashingTasks([task._id]),
    });
    router.back();
  };
  const toggle = (checked: boolean) => {
    if (closed) return void actions.reopen();
    if (!checked) return keepOpen(task);
    completeSoon(task);
    router.back();
  };
  return (
    <ScrollView
      contentInsetAdjustmentBehavior="automatic"
      keyboardShouldPersistTaps="handled"
      keyboardDismissMode="interactive"
      contentContainerStyle={styles.card}
      style={{ backgroundColor: colors.popover }}
    >
      <View style={styles.head}>
        <Checkbox checked={closed || lingering} onChange={toggle} size={22} accent={colors.accent} style={styles.headCheck} />
        <TextInput
          {...title}
          accessibilityLabel="Title"
          multiline
          submitBehavior="blurAndSubmit"
          returnKeyType="done"
          placeholder="New Task"
          placeholderTextColor={tones.faintForeground}
          style={[styles.title, { color: closed ? tones.faintForeground : colors.foreground }]}
        />
      </View>
      <TextInput
        {...notes}
        accessibilityLabel="Notes"
        multiline
        placeholder="Notes"
        placeholderTextColor={tones.faintForeground}
        style={[styles.notes, { color: colors.foreground }]}
      />
      <Checklist task={task} actions={actions} />
      <View style={[styles.tools, { backgroundColor: tones.surfaceInset }]}>
        <ToolRow tool="when" taskId={task._id} icon={whenIcon(task, today)} label="When" value={whenLabel(task.when, today)} {...(isToday ? { tint: colors.accent } : {})} />
        <ToolRow
          tool="deadline"
          taskId={task._id}
          icon={Flag}
          label="Deadline"
          value={deadline ? `${deadline.label} · ${deadline.countdown}` : "None"}
          {...(deadline ? { tint: deadline.overdue ? colors.danger : tones.deadline } : {})}
        />
        <ToolRow
          tool="estimate"
          taskId={task._id}
          icon={Timer}
          label="Estimate"
          value={task.estimateMinutes === undefined ? "None" : formatMinutes(task.estimateMinutes)}
          figure={task.estimateMinutes !== undefined}
        />
        <ToolRow tool="labels" taskId={task._id} icon={Tag} label="Labels" value={task.labels.length > 0 ? task.labels.map((label) => label.name).join(", ") : "None"} />
        <ToolRow
          tool="repeat"
          taskId={task._id}
          icon={Repeat}
          label="Repeat"
          value={task.repeat?.active ? lowerFirst(repeatLabel(task.repeat.schedule, task.repeat.end)) : "Never"}
        />
      </View>
      {task.context ? <Text style={[styles.context, { color: tones.faintForeground }]}>In {task.context}</Text> : null}
      <Pressable accessibilityRole="button" onPress={trash} style={({ pressed }) => [styles.trash, { opacity: pressed ? 0.6 : 1 }]}>
        <Trash2 size={16} color={colors.danger} strokeWidth={1.75} />
        <Text style={[styles.trashLabel, { color: colors.danger }]}>Move to Trash</Text>
      </Pressable>
    </ScrollView>
  );
};

export const TaskCardScreen = () => {
  const { id } = useLocalSearchParams<{ id: Id<"tasks"> }>();
  const { colors } = useKit();
  const task = useTask(id);
  const today = useLocalDate();
  return (
    <View collapsable={false} style={[styles.sheet, { backgroundColor: colors.popover }]}>
      {task ? <Card task={task} today={today} /> : <EmptyNote title="This Task is gone" body="It was removed somewhere else." />}
      <Toaster variant="minimal" position="top" offset={18} />
    </View>
  );
};

const styles = StyleSheet.create({
  sheet: { flex: 1 },
  card: { paddingHorizontal: 16, paddingTop: 22, paddingBottom: 48, gap: 6 },
  head: { flexDirection: "row", alignItems: "flex-start" },
  headCheck: { padding: 8, paddingTop: 7 },
  title: { flex: 1, fontFamily: fonts.semibold, fontSize: 20, lineHeight: 26, letterSpacing: -0.4, paddingTop: 4, paddingBottom: 4 },
  notes: { fontFamily: fonts.regular, fontSize: 16, lineHeight: 23, paddingHorizontal: 8, paddingVertical: 6, minHeight: 44 },
  checklist: { paddingVertical: 4 },
  item: { flexDirection: "row", alignItems: "flex-start", minHeight: 40 },
  itemCheck: { padding: 10, paddingTop: 11 },
  itemGhost: { opacity: 0.6 },
  ghostBox: { width: 18, height: 18, borderRadius: 5, borderWidth: 1.5, borderStyle: "dashed" },
  itemText: { flex: 1, fontFamily: fonts.regular, fontSize: 16, lineHeight: 22, paddingTop: 9, paddingBottom: 9 },
  struck: { textDecorationLine: "line-through" },
  tools: { borderRadius: 16, marginTop: 10, overflow: "hidden" },
  tool: { flexDirection: "row", alignItems: "center", gap: 12, minHeight: 50, paddingHorizontal: 14 },
  toolLabel: { fontFamily: fonts.regular, fontSize: 16, lineHeight: 22, width: 84 },
  toolValue: { flex: 1, fontFamily: fonts.medium, fontSize: 16, lineHeight: 22, textAlign: "right" },
  toolFigure: { flex: 1, fontFamily: fonts.monoMedium, fontSize: 15, lineHeight: 22, textAlign: "right" },
  context: { fontFamily: fonts.regular, fontSize: 13, lineHeight: 18, paddingHorizontal: 8, paddingTop: 14 },
  trash: { flexDirection: "row", alignItems: "center", gap: 8, minHeight: 44, paddingHorizontal: 8, marginTop: 6, alignSelf: "flex-start" },
  trashLabel: { fontFamily: fonts.medium, fontSize: 15, lineHeight: 20 },
});
