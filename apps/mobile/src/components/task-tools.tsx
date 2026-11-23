import { useLocalSearchParams, useRouter } from "expo-router";
import { Archive, Check, Inbox, Layers, Moon, Search, SkipForward, Sparkles, Star, type LucideIcon } from "lucide-react-native";
import { useMemo, useState, type ReactNode } from "react";
import { Pressable, ScrollView, StyleSheet, Text, TextInput, View } from "react-native";
import { api } from "@lifeos/backend/api";
import { AREA_COLOURS } from "@lifeos/backend/client/colours";
import { repeatActions } from "@lifeos/backend/client/repeat-actions";
import { NEVER, baseDate, isPreset, repeatDay, repeatLabel, repeatPresets, sameSchedule, scheduleParts, type RepeatMode } from "@lifeos/backend/client/repeat";
import { isOptimistic, type MoveTarget } from "@lifeos/backend/client/task-actions";
import { describeSchedule } from "@lifeos/backend/recurrence";
import type { Id } from "@lifeos/backend/dataModel";
import { localIsoDate, type IsoDate } from "@lifeos/backend/date";
import { formatMinutes, parseEstimateText } from "@lifeos/backend/estimate";
import type { PlannerTask, SidebarView, TaskRepeat } from "@lifeos/backend/types";
import { Calendar } from "@/components/ui/calendar";
import { Toaster } from "@/components/ui/toast";
import { EmptyNote } from "@/components/task-list";
import { ProgressRing } from "@/components/progress-ring";
import { RepeatCustom, dateOf } from "@/components/repeat-custom";
import { Button } from "@/components/button";
import { useSmartEstimate, useSteps } from "@/lib/ai";
import { change } from "@/lib/change";
import { haptic } from "@/lib/haptics";
import { useKit } from "@/lib/kit";
import { fonts, usePlanner } from "@/lib/kit-theme";
import type { Tool } from "@/lib/route";
import { actionsFor, turnIntoProject, useTask } from "@/lib/tasks";
import { useLocalDate, useView, valueOf } from "@/lib/views";

const ESTIMATE_CHIPS = [10, 15, 30, 60, 120] as const;

const TITLES = {
  when: "When",
  deadline: "Deadline",
  estimate: "Estimate",
  labels: "Labels",
  repeat: "Repeat",
  move: "Move",
} as const satisfies Record<Tool, string>;

type ToolProps = { task: PlannerTask; today: IsoDate; close: () => void };

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
      <Choice icon={Inbox} title="Inbox" selected={when.kind === "inbox"} onPress={() => set({ kind: "inbox" })} />
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

const percent = new Intl.NumberFormat("en-AU", { style: "percent", maximumFractionDigits: 0 });

const workingDays = (minutes: number, dayMinutes: number) => (minutes >= dayMinutes && minutes % dayMinutes === 0 ? minutes / dayMinutes : undefined);

const daysLabel = (days: number) => (days % 5 === 0 ? (days === 5 ? "1 week" : `${days / 5} weeks`) : days === 1 ? "1 day" : `${days} days`);

const EstimateTool = ({ task, today, close }: ToolProps) => {
  const { colors } = useKit();
  const tones = usePlanner();
  const actions = actionsFor(task, today);
  const smart = useSmartEstimate(task);
  const steps = useSteps(task);
  const [typed, setTyped] = useState("");
  const [unreadable, setUnreadable] = useState(false);
  const guessed = smart.kind === "guesses" ? smart : undefined;
  const chips: readonly { minutes: number; probability?: number }[] = guessed ? guessed.guesses : smart.kind === "thinking" ? [] : ESTIMATE_CHIPS.map((minutes) => ({ minutes }));
  const big = guessed !== undefined && guessed.likely >= guessed.dayMinutes;
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
        {smart.kind === "thinking"
          ? [0, 1, 2].map((ghost) => <View key={ghost} accessibilityLabel={ghost === 0 ? "Guessing an Estimate" : undefined} style={[styles.chip, { backgroundColor: tones.surface, opacity: 0.6 }]} />)
          : null}
        {chips.map(({ minutes, probability }) => {
          const selected = task.estimateMinutes === minutes;
          const likely = guessed?.likely === minutes;
          const days = guessed ? workingDays(minutes, guessed.dayMinutes) : undefined;
          const label = days === undefined ? formatMinutes(minutes) : daysLabel(days);
          const odds = probability === undefined ? "" : `, ${percent.format(probability)} likely${likely ? ", the best guess" : ""}`;
          return (
            <Pressable
              key={minutes}
              accessibilityRole="button"
              accessibilityState={{ selected }}
              accessibilityLabel={`${label}${odds}`}
              onPress={() => set(selected ? null : minutes)}
              style={({ pressed }) => [
                styles.chip,
                { backgroundColor: selected ? colors.primary : tones.surface, transform: [{ scale: pressed ? 0.97 : 1 }] },
                likely && !selected ? [styles.likely, { borderColor: colors.accent }] : null,
              ]}
            >
              <Text style={[days === undefined ? styles.chipFigure : styles.chipWords, { color: selected ? colors.primaryForeground : colors.foreground }]}>{label}</Text>
              {probability === undefined ? null : (
                <View style={[styles.odds, { backgroundColor: selected ? colors.primaryForeground : tones.surfaceRaised }]}>
                  <View style={[styles.oddsFill, { width: `${Math.max(6, Math.round(probability * 100))}%`, backgroundColor: colors.accent }]} />
                </View>
              )}
              {likely ? <Sparkles size={10} color={colors.accent} strokeWidth={2.5} style={styles.spark} /> : null}
            </Pressable>
          );
        })}
      </View>
      {guessed ? (
        <View style={styles.reason}>
          <Sparkles size={13} color={colors.accent} strokeWidth={2} style={styles.reasonMark} />
          <Text style={[styles.reasonText, { color: colors.mutedForeground }]}>
            {percent.format(guessed.guesses.find((guess) => guess.minutes === guessed.likely)?.probability ?? 0)} likely {formatMinutes(guessed.likely)}. {guessed.reason}
          </Text>
        </View>
      ) : null}
      {smart.kind === "note" ? <Text style={[styles.hint, { color: tones.faintForeground }]}>{smart.note}</Text> : null}
      {big ? (
        <View style={styles.big}>
          <Text style={[styles.hint, { color: colors.mutedForeground }]}>Big one. Split it up?</Text>
          <View style={styles.bigActions}>
            {steps.available ? (
              <Button
                size="sm"
                title="Break into steps"
                onPress={() => {
                  steps.ask();
                  close();
                }}
              />
            ) : null}
            {task.status.kind === "open" ? <Button size="sm" title="Convert to Project" onPress={() => turnIntoProject(task, today)} /> : null}
          </View>
        </View>
      ) : null}
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

const nextLine = (repeat: TaskRepeat) => {
  if (repeat.next.kind === "due") return `Next: ${repeatDay(repeat.next.date)}`;
  if (repeat.next.kind === "waiting" && repeat.schedule.kind === "afterCompletion") return `Next: ${describeSchedule(repeat.schedule, NEVER).replace("after completion", "after you finish this")}`;
  return undefined;
};

const RepeatTool = ({ task, today, close }: ToolProps) => {
  const { colors } = useKit();
  const actions = useMemo(() => repeatActions(change, task, today), [task, today]);
  const [custom, setCustom] = useState<RepeatMode | null>(null);
  const repeat = task.repeat?.active ? task.repeat : undefined;
  const current = repeat?.schedule;
  const end = repeat?.end ?? NEVER;
  const base = baseDate(task.when, today);
  const presets = repeatPresets(base);
  const odd = current && current.kind !== "afterCompletion" && !isPreset(current, base) ? current : undefined;
  const next = repeat && nextLine(repeat);
  const pick = (run: () => void) => {
    haptic("toggle");
    run();
    close();
  };
  const open = (mode: RepeatMode) => {
    haptic("toggle");
    setCustom(mode);
  };
  if (custom) {
    return <RepeatCustom schedule={current} end={end} base={base} today={today} mode={custom} onCancel={() => setCustom(null)} onCommit={(schedule, chosen) => pick(() => actions.set(schedule, chosen))} />;
  }
  return (
    <>
      <Choice title="Does not repeat" selected={!repeat} onPress={() => pick(actions.stop)} />
      {presets.map((schedule) => {
        const { lead, qualifier } = scheduleParts(schedule);
        const on = sameSchedule(schedule, current);
        return <Choice key={JSON.stringify(schedule)} title={lead} {...(qualifier ? { detail: qualifier } : {})} selected={on} onPress={() => (on ? close() : pick(() => actions.set(schedule, end)))} />;
      })}
      <View style={[styles.rule, { backgroundColor: colors.border }]} />
      {odd ? <Choice title={repeatLabel(odd, NEVER)} selected onPress={() => open("calendar")} /> : null}
      <Choice
        title={current?.kind === "afterCompletion" ? repeatLabel(current, NEVER) : "After I finish it…"}
        selected={current?.kind === "afterCompletion"}
        onPress={() => open("afterCompletion")}
      />
      <Choice title="Custom…" onPress={() => open("calendar")} />
      {next ? (
        <View style={[styles.next, { borderTopColor: colors.border }]}>
          <Text numberOfLines={1} style={[styles.nextText, { color: colors.mutedForeground }]}>
            {next}
          </Text>
          {repeat?.next.kind === "due" ? (
            <Button size="sm" title="Skip Next" icon={SkipForward} iconFill haptic={null} disabled={isOptimistic(repeat.ruleId)} onPress={() => pick(actions.skip)} />
          ) : null}
        </View>
      ) : null}
    </>
  );
};

type Area = SidebarView["areas"][number];
type Project = SidebarView["projects"][number];

const areaOf = (area: Area) => ({ _id: area._id, title: area.title, colour: area.colour, icon: area.icon });

const MoveTool = ({ task, today, close }: ToolProps) => {
  const { colors } = useKit();
  const tones = usePlanner();
  const actions = actionsFor(task, today);
  const sidebar = valueOf(useView(api.planner.sidebar.get, { date: today }));
  const [query, setQuery] = useState("");
  const wanted = query.trim().toLowerCase();
  const hit = (title: string) => wanted === "" || title.toLowerCase().includes(wanted);
  const { parent } = task;
  const go = (target: MoveTarget) => {
    haptic("toggle");
    actions.moveTo(target);
    close();
  };
  const projectChoice = (project: Project, area: Area | undefined, indent: boolean) => (
    <Choice
      key={project._id}
      lead={
        <View style={[styles.lead, indent ? styles.indent : null]}>
          <ProgressRing value={project.progress.total === 0 ? 0 : project.progress.done / project.progress.total} colour={area ? tones.area[area.colour] : colors.mutedForeground} />
        </View>
      }
      title={project.title}
      selected={parent.kind === "project" && parent.projectId === project._id}
      onPress={() =>
        isOptimistic(project._id)
          ? undefined
          : go({ parent: { kind: "project", projectId: project._id }, title: project.title, project: { _id: project._id, title: project.title }, ...(area ? { area: areaOf(area) } : {}) })
      }
    />
  );
  const loose = sidebar?.projects.filter((project) => hit(project.title)) ?? [];
  const areas = (sidebar?.areas ?? []).flatMap((area) => {
    const projects = hit(area.title) ? area.projects : area.projects.filter((project) => hit(project.title));
    return hit(area.title) || projects.length > 0 ? [{ area, projects }] : [];
  });
  const none = wanted !== "" && loose.length === 0 && areas.length === 0;
  return (
    <>
      <View style={[styles.search, { backgroundColor: tones.surfaceInset }]}>
        <Search size={17} color={tones.faintForeground} strokeWidth={2} />
        <TextInput
          value={query}
          onChangeText={setQuery}
          placeholder="Search Areas and Projects"
          placeholderTextColor={tones.faintForeground}
          accessibilityLabel="Search Areas and Projects"
          returnKeyType="search"
          autoCorrect={false}
          clearButtonMode="while-editing"
          style={[styles.searchField, { color: colors.foreground }]}
        />
      </View>
      {wanted === "" ? (
        <>
          <Choice
            icon={Inbox}
            title="Inbox"
            selected={task.when.kind === "inbox"}
            onPress={() => {
              haptic("toggle");
              actions.setWhen({ kind: "inbox" });
              close();
            }}
          />
          <Choice icon={Layers} title="No Area or Project" selected={parent.kind === "loose"} onPress={() => go({ parent: { kind: "loose" }, title: "no Area" })} />
        </>
      ) : null}
      {loose.map((project) => projectChoice(project, undefined, false))}
      {areas.map(({ area, projects }) => (
        <View key={area._id}>
          <Choice
            lead={
              <View style={styles.lead}>
                <View style={[styles.dot, { backgroundColor: tones.area[area.colour] }]} />
              </View>
            }
            title={area.title}
            selected={parent.kind === "area" && parent.areaId === area._id}
            onPress={() => (isOptimistic(area._id) ? undefined : go({ parent: { kind: "area", areaId: area._id }, title: area.title, area: areaOf(area) }))}
          />
          {projects.map((project) => projectChoice(project, area, true))}
        </View>
      ))}
      {none ? <Text style={[styles.hint, { color: tones.faintForeground }]}>Nothing called “{query.trim()}”.</Text> : null}
    </>
  );
};

const TOOLS = {
  when: WhenTool,
  deadline: DeadlineTool,
  estimate: EstimateTool,
  labels: LabelsTool,
  repeat: RepeatTool,
  move: MoveTool,
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
  chipWords: { fontFamily: fonts.medium, fontSize: 14 },
  likely: { borderWidth: 1.5, borderStyle: "dashed" },
  odds: { position: "absolute", left: 14, right: 14, bottom: 7, height: 2, borderRadius: 1, overflow: "hidden" },
  oddsFill: { height: 2, borderRadius: 1 },
  spark: { position: "absolute", top: 4, right: 8 },
  reason: { flexDirection: "row", gap: 8, paddingHorizontal: 10, paddingTop: 6 },
  reasonMark: { marginTop: 3 },
  reasonText: { flex: 1, fontFamily: fonts.regular, fontSize: 14, lineHeight: 20 },
  big: { paddingHorizontal: 0, paddingTop: 2 },
  bigActions: { flexDirection: "row", flexWrap: "wrap", gap: 8, paddingHorizontal: 10 },
  rule: { height: StyleSheet.hairlineWidth, marginHorizontal: 8, marginVertical: 6 },
  next: { flexDirection: "row", alignItems: "center", gap: 10, minHeight: 48, paddingHorizontal: 8, marginTop: 6, borderTopWidth: StyleSheet.hairlineWidth },
  nextText: { flex: 1, fontFamily: fonts.regular, fontSize: 15, lineHeight: 20 },
  search: { flexDirection: "row", alignItems: "center", gap: 8, height: 44, borderRadius: 12, paddingHorizontal: 12, marginHorizontal: 8, marginBottom: 6 },
  searchField: { flex: 1, fontFamily: fonts.regular, fontSize: 17, height: 44 },
  lead: { width: 22, alignItems: "center" },
  indent: { marginLeft: 22 },
  field: { fontFamily: fonts.regular, fontSize: 17, height: 48, borderRadius: 12, paddingHorizontal: 14, marginHorizontal: 8, marginTop: 10 },
  hint: { fontFamily: fonts.regular, fontSize: 13, lineHeight: 18, paddingHorizontal: 10, paddingVertical: 8 },
  dot: { width: 10, height: 10, borderRadius: 5, marginHorizontal: 5 },
});
