import { useLocalSearchParams, useRouter } from "expo-router";
import { CalendarDays, ChartPie, ChevronRight, Copy, Flag, FolderInput, Moon, Repeat, Sparkles, Star, Tag, Timer, Trash2, type LucideIcon } from "lucide-react-native";
import { useMemo, type ReactNode } from "react";
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
import { Checklist } from "@/components/checklist";
import { SuggestedSteps } from "@/components/suggested-steps";
import { EmptyNote } from "@/components/task-list";
import { useSmartEstimate, useSteps, type SmartEstimate } from "@/lib/ai";
import { change } from "@/lib/change";
import { haptic } from "@/lib/haptics";
import { useKit } from "@/lib/kit";
import { fonts, usePlanner } from "@/lib/kit-theme";
import { toolHref, type Tool } from "@/lib/route";
import { useDraftText } from "@/lib/draft-text";
import { actionsFor, completeSoon, duplicateTask, isUnsaved, keepOpen, turnIntoProject, useLingering, useTask } from "@/lib/tasks";
import { useLocalDate } from "@/lib/views";

const ToolRow = ({ tool, taskId, icon: Icon, label, value, tint, figure, lead }: { tool: Tool; taskId: Id<"tasks">; icon: LucideIcon; label: string; value: ReactNode; tint?: string; figure?: boolean; lead?: ReactNode }) => {
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
      {lead}
      <Text numberOfLines={1} style={[figure ? styles.toolFigure : styles.toolValue, { color: tint ?? colors.foreground }]}>
        {value}
      </Text>
      <ChevronRight size={16} color={tones.faintForeground} />
    </Pressable>
  );
};

const ActionRow = ({ icon: Icon, label, tint, onPress }: { icon: LucideIcon; label: string; tint?: string; onPress: () => void }) => {
  const { colors } = useKit();
  const tones = usePlanner();
  return (
    <Pressable accessibilityRole="button" onPress={onPress} style={({ pressed }) => [styles.tool, pressed ? { backgroundColor: tones.surface } : null]}>
      <Icon size={18} color={tint ?? colors.mutedForeground} strokeWidth={1.75} />
      <Text style={[styles.actionLabel, { color: tint ?? colors.foreground }]}>{label}</Text>
    </Pressable>
  );
};

const estimateValue = (minutes: number | undefined, smart: SmartEstimate) => {
  if (minutes !== undefined) return { value: formatMinutes(minutes), figure: true, guess: false };
  if (smart.kind === "guesses") return { value: formatMinutes(smart.likely), figure: true, guess: true };
  if (smart.kind === "thinking") return { value: "Guessing…", figure: false, guess: true };
  return { value: "None", figure: false, guess: false };
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
  const smart = useSmartEstimate(task, { ask: true });
  const steps = useSteps(task);
  const estimate = estimateValue(task.estimateMinutes, smart);
  const saved = !isUnsaved(task._id);
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
      {steps.available && steps.view?.kind === "idle" && !closed ? (
        <Pressable accessibilityRole="button" onPress={steps.ask} hitSlop={4} style={({ pressed }) => [styles.ai, { opacity: pressed ? 0.6 : 1 }]}>
          <Sparkles size={15} color={colors.accent} strokeWidth={2} />
          <Text style={[styles.aiLabel, { color: colors.accent }]}>Break into steps</Text>
        </Pressable>
      ) : null}
      <SuggestedSteps steps={steps} />
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
          value={estimate.value}
          figure={estimate.figure}
          {...(estimate.guess ? { tint: tones.faintForeground, lead: smart.kind === "guesses" ? <Sparkles size={13} color={colors.accent} strokeWidth={2} /> : null } : {})}
        />
        <ToolRow tool="labels" taskId={task._id} icon={Tag} label="Labels" value={task.labels.length > 0 ? task.labels.map((label) => label.name).join(", ") : "None"} />
        <ToolRow
          tool="repeat"
          taskId={task._id}
          icon={Repeat}
          label="Repeat"
          value={task.repeat?.active ? lowerFirst(repeatLabel(task.repeat.schedule, task.repeat.end)) : "Never"}
        />
        <ToolRow tool="move" taskId={task._id} icon={FolderInput} label="Move to" value={task.context ?? (task.when.kind === "inbox" ? "Inbox" : "No Area")} />
      </View>
      <View style={[styles.tools, { backgroundColor: tones.surfaceInset }]}>
        {saved ? <ActionRow icon={Copy} label="Duplicate" onPress={() => duplicateTask(task, today)} /> : null}
        {saved && !closed ? <ActionRow icon={ChartPie} label="Convert to Project" onPress={() => turnIntoProject(task, today)} /> : null}
        <ActionRow icon={Trash2} label="Move to Trash" tint={colors.danger} onPress={trash} />
      </View>
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
  ai: { flexDirection: "row", alignItems: "center", gap: 8, minHeight: 40, paddingHorizontal: 10, alignSelf: "flex-start" },
  aiLabel: { fontFamily: fonts.medium, fontSize: 15, lineHeight: 20 },
  actionLabel: { flex: 1, fontFamily: fonts.regular, fontSize: 16, lineHeight: 22 },
  head: { flexDirection: "row", alignItems: "flex-start" },
  headCheck: { padding: 8, paddingTop: 7 },
  title: { flex: 1, fontFamily: fonts.semibold, fontSize: 20, lineHeight: 26, letterSpacing: -0.4, paddingTop: 4, paddingBottom: 4 },
  notes: { fontFamily: fonts.regular, fontSize: 16, lineHeight: 23, paddingHorizontal: 8, paddingVertical: 6, minHeight: 44 },
  tools: { borderRadius: 16, marginTop: 10, overflow: "hidden" },
  tool: { flexDirection: "row", alignItems: "center", gap: 12, minHeight: 50, paddingHorizontal: 14 },
  toolLabel: { fontFamily: fonts.regular, fontSize: 16, lineHeight: 22, width: 84 },
  toolValue: { flex: 1, fontFamily: fonts.medium, fontSize: 16, lineHeight: 22, textAlign: "right" },
  toolFigure: { flex: 1, fontFamily: fonts.monoMedium, fontSize: 15, lineHeight: 22, textAlign: "right" },
});
