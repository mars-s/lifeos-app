import { useLocalSearchParams, useRouter } from "expo-router";
import { Archive, Check, Layers, Moon, Star, type LucideIcon } from "lucide-react-native";
import { useMemo, useState, type ReactNode } from "react";
import { Pressable, ScrollView, StyleSheet, Text, TextInput, View } from "react-native";
import { api } from "@lifeos/backend/api";
import { AREA_COLOURS } from "@lifeos/backend/client/colours";
import { repeatActions } from "@lifeos/backend/client/repeat-actions";
import { NEVER, baseDate, repeatPresets, sameSchedule, scheduleParts } from "@lifeos/backend/client/repeat";
import type { Id } from "@lifeos/backend/dataModel";
import { localIsoDate, type IsoDate } from "@lifeos/backend/date";
import { formatMinutes, parseEstimateText } from "@lifeos/backend/estimate";
import type { PlannerTask } from "@lifeos/backend/types";
import { Calendar } from "@/components/ui/calendar";
import { Toaster } from "@/components/ui/toast";
import { EmptyNote } from "@/components/task-list";
import { change } from "@/lib/change";
import { haptic } from "@/lib/haptics";
import { useKit } from "@/lib/kit";
import { fonts, usePlanner } from "@/lib/kit-theme";
import type { Tool } from "@/lib/route";
import { actionsFor, useTask } from "@/lib/tasks";
import { useLocalDate, useView } from "@/lib/views";

const ESTIMATE_CHIPS = [10, 15, 30, 60, 120] as const;

const TITLES = {
  when: "When",
  deadline: "Deadline",
  estimate: "Estimate",
  labels: "Labels",
  repeat: "Repeat",
} as const satisfies Record<Tool, string>;

type ToolProps = { task: PlannerTask; today: IsoDate; close: () => void };

const dateOf = (iso: string) => {
  const [year = 0, month = 1, day = 1] = iso.split("-").map(Number);
  return new Date(year, month - 1, day);
};

const Choice = ({ icon: Icon, lead, title, detail, selected, tint, onPress }: { icon?: LucideIcon; lead?: ReactNode; title: string; detail?: string; selected?: boolean; tint?: string; onPress: () => void }) => {
  const { colors } = useKit();
  const tones = usePlanner();
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityState={{ selected: selected === true }}
      onPress={onPress}
      style={({ pressed }) => [styles.choice, pressed ? { backgroundColor: tones.surface } : null]}
    >
      {Icon ? <Icon size={20} color={tint ?? colors.mutedForeground} strokeWidth={1.75} {...(tint ? { fill: tint } : {})} /> : null}
      {lead}
      <Text style={[styles.choiceTitle, { color: colors.foreground }]}>{title}</Text>
      {detail ? <Text style={[styles.choiceDetail, { color: tones.faintForeground }]}>{detail}</Text> : null}
      <View style={styles.spacer} />
      {selected ? <Check size={18} color={colors.accent} strokeWidth={2.25} /> : null}
    </Pressable>
  );
};

const WhenTool = ({ task, today, close }: ToolProps) => {
  const { colors } = useKit();
  const actions = actionsFor(task, today);
  const { when } = task;
  const set = (next: PlannerTask["when"]) => {
    haptic("toggle");
    actions.setWhen(next);
    close();
  };
  const isToday = when.kind === "scheduled" && when.date <= today;
  return (
    <>
      <Choice icon={Star} tint={colors.accent} title="Today" selected={isToday && when.kind === "scheduled" && !when.evening} onPress={() => set({ kind: "scheduled", date: today, evening: false })} />
      <Choice icon={Moon} tint={colors.accent} title="This Evening" selected={isToday && when.kind === "scheduled" && when.evening} onPress={() => set({ kind: "scheduled", date: today, evening: true })} />
      <Calendar
        value={when.kind === "scheduled" && when.date > today ? dateOf(when.date) : null}
        onChange={(date) => (date ? set({ kind: "scheduled", date: localIsoDate(date), evening: false }) : undefined)}
        minDate={dateOf(today)}
        weekStartsOn={1}
        locale="en-AU"
        accent={colors.accent}
        showTodayButton={false}
        style={styles.calendar}
      />
      <Choice icon={Layers} title="Anytime" selected={when.kind === "anytime"} onPress={() => set({ kind: "anytime" })} />
      <Choice icon={Archive} title="Someday" selected={when.kind === "someday"} onPress={() => set({ kind: "someday" })} />
    </>
  );
};

const DeadlineTool = ({ task, today, close }: ToolProps) => {
  const tones = usePlanner();
  const actions = actionsFor(task, today);
  const set = (deadline: string | null) => {
    haptic("toggle");
    actions.setDeadline(deadline);
    close();
  };
  return (
    <>
      <Calendar
        value={task.deadline ? dateOf(task.deadline) : null}
        onChange={(date) => (date ? set(localIsoDate(date)) : undefined)}
        weekStartsOn={1}
        locale="en-AU"
        accent={tones.deadline}
        showTodayButton={false}
        style={styles.calendar}
      />
      {task.deadline ? <Choice title="No Deadline" onPress={() => set(null)} /> : null}
    </>
  );
};

const EstimateTool = ({ task, today, close }: ToolProps) => {
  const { colors } = useKit();
  const tones = usePlanner();
  const actions = actionsFor(task, today);
  const [typed, setTyped] = useState("");
  const [unreadable, setUnreadable] = useState(false);
  const set = (minutes: number | null) => {
    haptic("toggle");
    void actions.setEstimate(minutes);
    close();
  };
  const submit = () =>
    parseEstimateText(typed).match(set, () => {
      haptic("error");
      setUnreadable(true);
    });
  return (
    <>
      <View style={styles.chips}>
        {ESTIMATE_CHIPS.map((minutes) => {
          const selected = task.estimateMinutes === minutes;
          return (
            <Pressable
              key={minutes}
              accessibilityRole="button"
              accessibilityState={{ selected }}
              accessibilityLabel={`${minutes} minutes`}
              onPress={() => set(minutes)}
              style={({ pressed }) => [
                styles.chip,
                { backgroundColor: selected ? colors.primary : tones.surface, transform: [{ scale: pressed ? 0.97 : 1 }] },
              ]}
            >
              <Text style={[styles.chipFigure, { color: selected ? colors.primaryForeground : colors.foreground }]}>{formatMinutes(minutes)}</Text>
            </Pressable>
          );
        })}
      </View>
      <TextInput
        value={typed}
        onChangeText={(text) => {
          setTyped(text);
          setUnreadable(false);
        }}
        onSubmitEditing={submit}
        returnKeyType="done"
        keyboardType="numbers-and-punctuation"
        placeholder="45, 1h30 or 1:30"
        placeholderTextColor={tones.faintForeground}
        accessibilityLabel="Estimate"
        style={[styles.field, { color: colors.foreground, backgroundColor: tones.surfaceInset }]}
      />
      <Text accessibilityLiveRegion="polite" style={[styles.hint, { color: unreadable ? colors.danger : tones.faintForeground }]}>
        {unreadable ? "That does not read as a time. Try 45, 1h30 or 1:30." : "How long it should take."}
      </Text>
      {task.estimateMinutes === undefined ? null : <Choice title="No Estimate" onPress={() => set(null)} />}
    </>
  );
};

const LabelsTool = ({ task, today }: ToolProps) => {
  const { colors } = useKit();
  const tones = usePlanner();
  const actions = actionsFor(task, today);
  const labels = useView(api.planner.labels.list, {});
  const [fresh, setFresh] = useState("");
  const create = () => {
    const name = fresh.trim();
    if (name === "") return;
    const known = labels?.find((label) => label.name.toLowerCase() === name.toLowerCase());
    setFresh("");
    haptic("toggle");
    if (known) return task.labelIds.includes(known._id) ? undefined : actions.toggleLabel(known);
    const used = new Set(labels?.map((label) => label.colour));
    actions.createLabel(name, AREA_COLOURS.find((colour) => !used.has(colour)) ?? AREA_COLOURS[(labels?.length ?? 0) % AREA_COLOURS.length] ?? "slate");
  };
  return (
    <>
      {labels?.map((label) => (
        <Choice
          key={label._id}
          lead={<View style={[styles.dot, { backgroundColor: tones.area[label.colour] }]} />}
          title={label.name}
          selected={task.labelIds.includes(label._id)}
          onPress={() => {
            haptic("toggle");
            actions.toggleLabel(label);
          }}
        />
      ))}
      <TextInput
        value={fresh}
        onChangeText={setFresh}
        onSubmitEditing={create}
        submitBehavior="submit"
        returnKeyType="done"
        placeholder="New Label"
        placeholderTextColor={tones.faintForeground}
        accessibilityLabel="New Label"
        style={[styles.field, { color: colors.foreground, backgroundColor: tones.surfaceInset }]}
      />
    </>
  );
};

const RepeatTool = ({ task, today, close }: ToolProps) => {
  const actions = useMemo(() => repeatActions(change, task, today), [task, today]);
  const current = task.repeat?.active ? task.repeat.schedule : undefined;
  const presets = repeatPresets(baseDate(task.when, today));
  const odd = current && !presets.some((preset) => sameSchedule(preset, current)) ? current : undefined;
  const pick = (run: () => void) => {
    haptic("toggle");
    run();
    close();
  };
  return (
    <>
      <Choice title="Does not repeat" selected={!current} onPress={() => pick(actions.stop)} />
      {[...presets, ...(odd ? [odd] : [])].map((schedule) => {
        const { lead, qualifier } = scheduleParts(schedule);
        return (
          <Choice
            key={JSON.stringify(schedule)}
            title={lead}
            {...(qualifier ? { detail: qualifier } : {})}
            selected={sameSchedule(schedule, current)}
            onPress={() => pick(() => actions.set(schedule, task.repeat?.active ? task.repeat.end : NEVER))}
          />
        );
      })}
    </>
  );
};

const TOOLS = {
  when: WhenTool,
  deadline: DeadlineTool,
  estimate: EstimateTool,
  labels: LabelsTool,
  repeat: RepeatTool,
} as const satisfies Record<Tool, (props: ToolProps) => ReactNode>;

export const TaskToolScreen = () => {
  const { tool, taskId } = useLocalSearchParams<{ tool: Tool; taskId: Id<"tasks"> }>();
  const { colors } = useKit();
  const router = useRouter();
  const today = useLocalDate();
  const task = useTask(taskId);
  const Body = TOOLS[tool];
  return (
    <View collapsable={false} style={[styles.sheet, { backgroundColor: colors.popover }]}>
      <ScrollView keyboardShouldPersistTaps="handled" contentContainerStyle={styles.body}>
        <View style={styles.head}>
          <Text accessibilityRole="header" style={[styles.title, { color: colors.foreground }]}>
            {TITLES[tool]}
          </Text>
          <Pressable accessibilityRole="button" hitSlop={12} onPress={() => router.back()}>
            <Text style={[styles.done, { color: colors.accent }]}>Done</Text>
          </Pressable>
        </View>
        {task ? <Body task={task} today={today as IsoDate} close={() => router.back()} /> : <EmptyNote title="This Task is gone" body="It was removed somewhere else." />}
      </ScrollView>
      <Toaster variant="minimal" position="top" offset={18} />
    </View>
  );
};

const styles = StyleSheet.create({
  sheet: { flex: 1 },
  body: { paddingHorizontal: 12, paddingTop: 18, paddingBottom: 40 },
  head: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", paddingHorizontal: 8, paddingBottom: 10 },
  title: { fontFamily: fonts.semibold, fontSize: 20, lineHeight: 26, letterSpacing: -0.4 },
  done: { fontFamily: fonts.medium, fontSize: 16, lineHeight: 22 },
  choice: { flexDirection: "row", alignItems: "center", gap: 12, minHeight: 48, paddingHorizontal: 8, borderRadius: 12 },
  choiceTitle: { fontFamily: fonts.regular, fontSize: 17, lineHeight: 24, letterSpacing: -0.2 },
  choiceDetail: { fontFamily: fonts.regular, fontSize: 14, lineHeight: 20 },
  spacer: { flex: 1 },
  calendar: { marginVertical: 6 },
  chips: { flexDirection: "row", gap: 8, paddingHorizontal: 8, paddingVertical: 6 },
  chip: { flex: 1, height: 44, borderRadius: 22, alignItems: "center", justifyContent: "center" },
  chipFigure: { fontFamily: fonts.monoMedium, fontSize: 15 },
  field: { fontFamily: fonts.regular, fontSize: 17, height: 48, borderRadius: 12, paddingHorizontal: 14, marginHorizontal: 8, marginTop: 10 },
  hint: { fontFamily: fonts.regular, fontSize: 13, lineHeight: 18, paddingHorizontal: 10, paddingVertical: 8 },
  dot: { width: 10, height: 10, borderRadius: 5, marginHorizontal: 5 },
});
