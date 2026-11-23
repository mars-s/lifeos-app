import { Minus, Plus, type LucideIcon } from "lucide-react-native";
import { useState, type ReactNode } from "react";
import { Pressable, StyleSheet, Text, View } from "react-native";
import {
  AFTER_UNITS,
  MAX_COUNT,
  NEVER,
  UNITS,
  WEEKDAYS,
  clampEvery,
  defaultEndDate,
  draftFrom,
  firstDate,
  isValidDraft,
  maxEvery,
  repeatDay,
  repeatLabel,
  scheduleFrom,
  scheduleParts,
  type RepeatDraft,
  type RepeatEnd,
  type RepeatMode,
  type Schedule,
} from "@lifeos/backend/client/repeat";
import { localIsoDate, type IsoDate } from "@lifeos/backend/date";
import { Calendar } from "@/components/ui/calendar";
import { SegmentedControl } from "@/components/ui/segmented-control";
import { Button, IconButton } from "@/components/button";
import { haptic } from "@/lib/haptics";
import { alpha, useKit } from "@/lib/kit";
import { useTactile } from "@/lib/tactile";
import { fonts, usePlanner } from "@/lib/kit-theme";

const UNIT_LABELS = { days: "Day", weeks: "Week", months: "Month", years: "Year" } as const;
const AFTER_LABELS = { day: "Day", week: "Week", month: "Month" } as const;
const END_LABELS = { never: "Never", on: "On a date", after: "After" } as const;
const ENDS = ["never", "on", "after"] as const;

const plural = (count: number, one: string) => (count === 1 ? one : `${one}s`);

export const dateOf = (iso: string) => {
  const [year = 0, month = 1, day = 1] = iso.split("-").map(Number);
  return new Date(year, month - 1, day);
};

const isOneOf = <T extends string>(options: readonly T[], value: string): value is T => options.some((option) => option === value);

const Stepper = ({ value, min, max, label, onChange }: { value: number; min: number; max: number; label: string; onChange: (value: number) => void }) => {
  const { colors } = useKit();
  const depth = useTactile();
  const step = (by: number) => {
    const next = Math.min(Math.max(value + by, min), max);
    if (next === value) return;
    haptic("snap");
    onChange(next);
  };
  const button = (by: number, disabled: boolean, icon: LucideIcon, name: string) => (
    <IconButton label={`${name}: ${label}`} variant="raised" size="sm" icon={icon} haptic={null} disabled={disabled} hitSlop={6} onPress={() => step(by)} />
  );
  return (
    <View
      accessible
      accessibilityRole="adjustable"
      accessibilityLabel={label}
      accessibilityValue={{ min, max, now: value }}
      accessibilityActions={[{ name: "increment" }, { name: "decrement" }]}
      onAccessibilityAction={(event) => step(event.nativeEvent.actionName === "increment" ? 1 : -1)}
      style={[styles.stepper, depth.well, { backgroundColor: alpha(colors.foreground, 0.05) }]}
    >
      {button(-1, value <= min, Minus, "Fewer")}
      <Text style={[styles.stepValue, { color: colors.foreground }]}>{value}</Text>
      {button(1, value >= max, Plus, "More")}
    </View>
  );
};

const Line = ({ children }: { children: ReactNode }) => <View style={styles.line}>{children}</View>;

const monthlyOn = (on: RepeatDraft["monthDay"] | RepeatDraft["monthWeekday"]) => {
  const text = scheduleParts({ kind: "months", every: 1, on }).qualifier ?? "";
  return text.charAt(0).toUpperCase() + text.slice(1);
};

export const RepeatCustom = ({ schedule, end, base, today, mode, onCancel, onCommit }: { schedule: Schedule | undefined; end: RepeatEnd; base: IsoDate; today: string; mode: RepeatMode; onCancel: () => void; onCommit: (schedule: Schedule, end: RepeatEnd) => void }) => {
  const { colors } = useKit();
  const tones = usePlanner();
  const [draft, setDraft] = useState(() => ({ ...draftFrom(schedule, end, base, mode), mode }));
  const edit = (patch: Partial<RepeatDraft>) => setDraft((current) => ({ ...current, ...patch }));
  const valid = isValidDraft(draft);
  const unitWord = draft.mode === "afterCompletion" ? plural(draft.afterEvery, draft.afterUnit) : plural(draft.every, draft.unit.slice(0, -1));
  const text = (children: ReactNode, muted = false) => <Text style={[styles.text, { color: muted ? colors.mutedForeground : colors.foreground }]}>{children}</Text>;
  const built = valid ? scheduleFrom(draft) : undefined;
  const first = built && built.kind !== "afterCompletion" ? firstDate(built, base) : null;
  return (
    <View style={styles.custom}>
      <SegmentedControl
        value={draft.mode}
        onValueChange={(next) => (next === "calendar" || next === "afterCompletion" ? edit({ mode: next }) : undefined)}
        options={[
          { value: "calendar", label: "On a schedule" },
          { value: "afterCompletion", label: "After I finish it" },
        ]}
      />
      {draft.mode === "calendar" ? (
        <>
          <SegmentedControl
            size="sm"
            value={draft.unit}
            onValueChange={(unit) => (isOneOf(UNITS, unit) ? setDraft((current) => clampEvery({ ...current, unit })) : undefined)}
            options={UNITS.map((unit) => ({ value: unit, label: UNIT_LABELS[unit] }))}
          />
          <Line>
            {text("Every", true)}
            <Stepper value={draft.every} min={1} max={maxEvery(draft)} label="How often" onChange={(every) => edit({ every })} />
            {text(unitWord)}
          </Line>
          {draft.unit === "weeks" ? (
            <View accessibilityLabel="On these days" style={styles.weekdays}>
              {WEEKDAYS.map(([weekday, name]) => {
                const on = draft.days.includes(weekday);
                return (
                  <Pressable
                    key={weekday}
                    accessibilityRole="checkbox"
                    accessibilityLabel={name}
                    accessibilityState={{ checked: on }}
                    onPress={() => {
                      haptic("toggle");
                      edit({ days: on ? draft.days.filter((day) => day !== weekday) : [...draft.days, weekday] });
                    }}
                    style={({ pressed }) => [styles.weekday, { backgroundColor: on ? colors.accent : tones.surface, transform: [{ scale: pressed ? 0.92 : 1 }] }]}
                  >
                    <Text style={[styles.weekdayLabel, { color: on ? colors.accentForeground : colors.mutedForeground }]}>{name.charAt(0)}</Text>
                  </Pressable>
                );
              })}
            </View>
          ) : null}
          {draft.unit === "months" ? (
            <SegmentedControl
              size="sm"
              value={draft.monthOn}
              onValueChange={(monthOn) => (monthOn === "day" || monthOn === "weekday" ? edit({ monthOn }) : undefined)}
              options={[
                { value: "day", label: monthlyOn(draft.monthDay) },
                { value: "weekday", label: monthlyOn(draft.monthWeekday) },
              ]}
            />
          ) : null}
          {draft.unit === "years" && built ? <Line>{text(scheduleParts(built).qualifier, true)}</Line> : null}
        </>
      ) : (
        <>
          <SegmentedControl
            size="sm"
            value={draft.afterUnit}
            onValueChange={(afterUnit) => (isOneOf(AFTER_UNITS, afterUnit) ? edit({ afterUnit }) : undefined)}
            options={AFTER_UNITS.map((unit) => ({ value: unit, label: AFTER_LABELS[unit] }))}
          />
          <Line>
            <Stepper value={draft.afterEvery} min={1} max={maxEvery(draft)} label="How long after" onChange={(afterEvery) => edit({ afterEvery })} />
            {text(`${unitWord} after I finish it`)}
          </Line>
        </>
      )}
      <View style={[styles.rule, { backgroundColor: colors.border }]} />
      <Text style={[styles.caption, { color: tones.faintForeground }]}>Ends</Text>
      <SegmentedControl
        size="sm"
        value={draft.end.kind}
        onValueChange={(kind) =>
          isOneOf(ENDS, kind) ? edit({ end: kind === "never" ? NEVER : kind === "on" ? { kind, date: defaultEndDate(base) } : { kind, count: 5 } }) : undefined
        }
        options={ENDS.map((kind) => ({ value: kind, label: END_LABELS[kind] }))}
      />
      {draft.end.kind === "on" ? (
        <Calendar
          value={dateOf(draft.end.date)}
          onChange={(date) => (date ? edit({ end: { kind: "on", date: localIsoDate(date) } }) : undefined)}
          minDate={dateOf(today)}
          weekStartsOn={1}
          locale="en-AU"
          accent={colors.accent}
          showTodayButton={false}
        />
      ) : null}
      {draft.end.kind === "after" ? (
        <Line>
          <Stepper value={draft.end.count} min={1} max={MAX_COUNT} label="How many times" onChange={(count) => edit({ end: { kind: "after", count } })} />
          {text(draft.end.count === 1 ? "time" : "times")}
        </Line>
      ) : null}
      <View style={[styles.rule, { backgroundColor: colors.border }]} />
      <Text accessibilityLiveRegion="polite" style={[styles.text, { color: valid ? colors.mutedForeground : colors.danger }]}>
        {built ? (
          <>
            <Text style={{ color: colors.foreground, fontFamily: fonts.medium }}>{repeatLabel(built, draft.end)}</Text>
            {first ? `, starting ${repeatDay(first)}` : ""}
          </>
        ) : (
          "Pick at least one day."
        )}
      </Text>
      <View style={styles.actions}>
        <Button variant="quiet" size="sm" title="Back" onPress={onCancel} />
        <Button
          variant="primary"
          size="sm"
          haptic={null}
          disabled={!built}
          title="Repeat"
          onPress={() => {
            if (!built) return;
            haptic("toggle");
            onCommit(built, draft.end);
          }}
        />
      </View>
    </View>
  );
};

const styles = StyleSheet.create({
  custom: { gap: 12, paddingHorizontal: 8, paddingTop: 4 },
  line: { flexDirection: "row", alignItems: "center", gap: 10, minHeight: 40 },
  text: { fontFamily: fonts.regular, fontSize: 16, lineHeight: 22 },
  caption: { fontFamily: fonts.regular, fontSize: 13, lineHeight: 18 },
  stepper: { flexDirection: "row", alignItems: "center", height: 38, borderRadius: 19, padding: 2 },
  stepButton: { width: 34, height: 34, alignItems: "center", justifyContent: "center" },
  stepValue: { fontFamily: fonts.monoMedium, fontSize: 15, minWidth: 28, textAlign: "center" },
  weekdays: { flexDirection: "row", justifyContent: "space-between" },
  weekday: { width: 40, height: 40, borderRadius: 20, alignItems: "center", justifyContent: "center" },
  weekdayLabel: { fontFamily: fonts.medium, fontSize: 15 },
  rule: { height: StyleSheet.hairlineWidth },
  actions: { flexDirection: "row", justifyContent: "flex-end", gap: 8, paddingTop: 4 },
});
