import { Bell, Plus, Square } from "lucide-react-native";
import { useState } from "react";
import { Linking, Pressable, StyleSheet, Text, TextInput, View } from "react-native";
import { viewOf, type ActiveFocus, type FocusActions } from "@lifeos/backend/client/focus";
import { parseEstimateText } from "@lifeos/backend/estimate";
import { MAX_FOCUS_MINUTES, type FocusPlanChoice } from "@lifeos/backend/focus";
import { phaseLine, primaryFor } from "@/components/focus-pill";
import { DotRing, countdown, useFocusTone } from "@/components/focus-time";
import { Toaster } from "@/components/ui/toast";
import { useAlertStatus } from "@/lib/focus-alerts";
import { haptic } from "@/lib/haptics";
import { useKit } from "@/lib/kit";
import { fonts, usePlanner } from "@/lib/kit-theme";
import { useFocus, useFocusNow } from "@/lib/focus";

const FOCUS_LENGTHS = [15, 25, 45, 50, 90] as const;
const BREAK_LENGTHS = [5, 10, 15] as const;
const LONG_BREAK_LENGTHS = [15, 20, 30] as const;
const DIAL = 196;

const Dial = ({ active, actions }: { active: ActiveFocus; actions: FocusActions }) => {
  const { colors } = useKit();
  const tones = usePlanner();
  const now = useFocusNow(active.state.kind === "running");
  const view = viewOf(active, now);
  const tone = useFocusTone(view);
  const primary = primaryFor(view, actions);
  const Icon = primary.icon;
  const time = countdown(Math.max(0, view.seconds));
  const under = view.status === "done" ? (view.phase === "focus" ? "focused" : "on break") : view.timed ? "left" : "focused";
  return (
    <View style={styles.live}>
      <Text numberOfLines={2} style={[styles.taskTitle, { color: colors.foreground }]}>
        {active.title}
      </Text>
      <Text style={[styles.phase, { color: view.status === "done" ? colors.success : colors.mutedForeground }]}>{phaseLine(active, view)}</Text>
      <View style={styles.dial} accessible accessibilityRole="timer" accessibilityLabel={`${time} ${under}`}>
        <DotRing ring={view.status === "done" ? 1 : view.ring} fills={!view.timed} size={DIAL} dot={4} lit={tone.lit} dim={tone.dim} />
        <View style={styles.dialFace}>
          <Text style={[styles.dialTime, { color: view.status === "paused" ? colors.mutedForeground : colors.foreground }]}>{time}</Text>
          <Text style={[styles.dialUnder, { color: tones.faintForeground }]}>{under}</Text>
        </View>
      </View>
      <View style={styles.controls}>
        <Pressable
          accessibilityRole="button"
          accessibilityLabel={view.phase === "break" ? "End the break" : "Stop the Focus Session"}
          onPress={() => {
            haptic("drop");
            actions.stop();
          }}
          style={({ pressed }) => [styles.round, { backgroundColor: tones.surface, transform: [{ scale: pressed ? 0.94 : 1 }] }]}
        >
          <Square size={18} color={colors.foreground} fill={colors.foreground} />
        </Pressable>
        <Pressable
          accessibilityRole="button"
          accessibilityLabel={primary.label}
          onPress={() => {
            haptic("toggle");
            primary.run();
          }}
          style={({ pressed }) => [styles.main, { backgroundColor: colors.foreground, transform: [{ scale: pressed ? 0.96 : 1 }] }]}
        >
          <Icon size={18} color={colors.background} fill={primary.label === "Pause" || primary.label === "Resume" || primary.label === "Back to focus" ? colors.background : "transparent"} />
          <Text style={[styles.mainLabel, { color: colors.background }]}>{primary.label}</Text>
        </Pressable>
        <Pressable
          accessibilityRole="button"
          accessibilityLabel="Add 5 minutes"
          disabled={!view.timed}
          onPress={() => {
            haptic("toggle");
            actions.extend(5);
          }}
          style={({ pressed }) => [styles.round, { backgroundColor: tones.surface, opacity: view.timed ? 1 : 0.35, transform: [{ scale: pressed ? 0.94 : 1 }] }]}
        >
          <Plus size={14} color={colors.foreground} strokeWidth={2.5} />
          <Text style={[styles.five, { color: colors.foreground }]}>5</Text>
        </Pressable>
      </View>
    </View>
  );
};

const Segment = ({ plan, onChange }: { plan: FocusPlanChoice; onChange: (plan: FocusPlanChoice) => void }) => {
  const { colors } = useKit();
  const tones = usePlanner();
  return (
    <View accessibilityRole="tablist" style={[styles.segment, { backgroundColor: tones.surface }]}>
      {(["open", "pomodoro"] as const).map((mode) => {
        const selected = plan.mode === mode;
        return (
          <Pressable
            key={mode}
            accessibilityRole="tab"
            accessibilityState={{ selected }}
            onPress={() => {
              if (selected) return;
              haptic("snap");
              onChange({ ...plan, mode });
            }}
            style={[styles.segmentItem, selected ? [styles.segmentOn, { backgroundColor: colors.popover }] : null]}
          >
            <Text style={[styles.segmentLabel, { color: selected ? colors.foreground : colors.mutedForeground }]}>{mode === "open" ? "Stopwatch" : "Pomodoro"}</Text>
          </Pressable>
        );
      })}
    </View>
  );
};

const LengthField = ({ label, value, custom, onChange }: { label: string; value: number; custom: boolean; onChange: (minutes: number) => void }) => {
  const { colors } = useKit();
  const tones = usePlanner();
  const [draft, setDraft] = useState<string | null>(null);
  const [refused, setRefused] = useState(false);
  const commit = () => {
    if (draft === null || draft.trim() === "") return setDraft(null);
    const parsed = parseEstimateText(draft.trim());
    if (parsed.isErr() || parsed.value > MAX_FOCUS_MINUTES) {
      haptic("error");
      setRefused(true);
      setDraft(null);
      return;
    }
    setDraft(null);
    setRefused(false);
    if (parsed.value !== value) onChange(parsed.value);
  };
  const on = custom && draft === null;
  return (
    <TextInput
      accessibilityLabel={`${label} length, typed`}
      value={draft ?? (custom ? String(value) : "")}
      onFocus={() => setDraft("")}
      onChangeText={(text) => {
        setDraft(text);
        setRefused(false);
      }}
      onSubmitEditing={commit}
      onBlur={commit}
      placeholder="Other"
      placeholderTextColor={tones.faintForeground}
      autoCorrect={false}
      autoCapitalize="none"
      returnKeyType="done"
      selectTextOnFocus
      style={[
        styles.typed,
        { backgroundColor: on ? colors.accent : tones.surface, color: on ? colors.accentForeground : colors.foreground },
        refused ? { borderColor: colors.danger, borderWidth: 1.5 } : null,
      ]}
    />
  );
};

const Lengths = ({ label, short, lengths, value, onChange }: { label: string; short: string; lengths: readonly number[]; value: number; onChange: (minutes: number) => void }) => {
  const { colors } = useKit();
  const tones = usePlanner();
  return (
    <View style={styles.lengths} accessibilityLabel={`${label} length`}>
      <Text accessibilityLabel={label} style={[styles.lengthLabel, { color: colors.mutedForeground }]}>
        {short}
      </Text>
      <View style={styles.chips}>
        {lengths.map((minutes) => {
          const selected = minutes === value;
          return (
            <Pressable
              key={minutes}
              accessibilityRole="button"
              accessibilityLabel={`${minutes} minutes`}
              accessibilityState={{ selected }}
              onPress={() => {
                if (selected) return;
                haptic("snap");
                onChange(minutes);
              }}
              style={({ pressed }) => [styles.chip, { backgroundColor: selected ? colors.accent : tones.surface, transform: [{ scale: pressed ? 0.95 : 1 }] }]}
            >
              <Text style={[styles.chipText, { color: selected ? colors.accentForeground : colors.foreground }]}>{minutes}</Text>
            </Pressable>
          );
        })}
        <LengthField label={label} value={value} custom={!lengths.includes(value)} onChange={onChange} />
      </View>
    </View>
  );
};

const AlertRow = () => {
  const { colors } = useKit();
  const { status, ask } = useAlertStatus();
  if (status === null || status === "granted") return null;
  const blocked = status === "denied";
  return (
    <View style={styles.alert}>
      <Bell size={16} color={colors.mutedForeground} fill={colors.mutedForeground} />
      <Text style={[styles.alertText, { color: colors.mutedForeground }]}>{blocked ? "Notifications are off for LifeOS." : "Get a notification when time is up"}</Text>
      <Pressable
        accessibilityRole="button"
        onPress={() => (blocked ? void Linking.openSettings() : ask())}
        hitSlop={8}
        style={({ pressed }) => ({ opacity: pressed ? 0.6 : 1 })}
      >
        <Text style={[styles.alertAction, { color: colors.accent }]}>{blocked ? "Open Settings" : "Allow"}</Text>
      </Pressable>
    </View>
  );
};

const Plan = ({ plan, onChange }: { plan: FocusPlanChoice; onChange: (plan: FocusPlanChoice) => void }) => {
  const { colors } = useKit();
  return (
    <View style={styles.plan}>
      <Segment plan={plan} onChange={onChange} />
      {plan.mode === "pomodoro" ? (
        <>
          <Lengths label="Focus" short="Focus" lengths={FOCUS_LENGTHS} value={plan.focusMinutes} onChange={(focusMinutes) => onChange({ ...plan, focusMinutes })} />
          <Lengths label="Break" short="Break" lengths={BREAK_LENGTHS} value={plan.breakMinutes} onChange={(breakMinutes) => onChange({ ...plan, breakMinutes })} />
          <Lengths label="Long break" short="Long" lengths={LONG_BREAK_LENGTHS} value={plan.longBreakMinutes} onChange={(longBreakMinutes) => onChange({ ...plan, longBreakMinutes })} />
          <Text style={[styles.note, { color: colors.mutedForeground }]}>
            Minutes of focus, then a break. Every fourth break is the long one. Type a length like 40 or 1h 30m. Only the focus counts as Actual Time.
          </Text>
          <AlertRow />
        </>
      ) : (
        <Text style={[styles.note, { color: colors.mutedForeground }]}>Counts up until you stop. Every minute counts as Actual Time.</Text>
      )}
    </View>
  );
};

export const FocusSheetScreen = () => {
  const { colors } = useKit();
  const tones = usePlanner();
  const { active, plan, actions } = useFocus();
  return (
    <View collapsable={false} style={[styles.sheet, { backgroundColor: colors.popover }]}>
      {active ? (
        <Dial active={active} actions={actions} />
      ) : (
        <View style={styles.idle}>
          <Text style={[styles.taskTitle, { color: colors.foreground }]}>Focus</Text>
          <Text style={[styles.phase, { color: tones.faintForeground }]}>Press and hold a Task, or open it, to start a Focus Session.</Text>
        </View>
      )}
      <View style={[styles.rule, { backgroundColor: colors.border }]} />
      <Plan plan={plan} onChange={actions.setPlan} />
      <Toaster variant="minimal" position="top" offset={18} />
    </View>
  );
};

const styles = StyleSheet.create({
  sheet: { paddingHorizontal: 20, paddingTop: 26, paddingBottom: 34 },
  live: { alignItems: "center" },
  idle: { gap: 6, paddingBottom: 4 },
  taskTitle: { fontFamily: fonts.semibold, fontSize: 20, lineHeight: 26, letterSpacing: -0.4, textAlign: "center" },
  phase: { fontFamily: fonts.regular, fontSize: 14, lineHeight: 20, marginTop: 2, textAlign: "center" },
  dial: { width: DIAL, height: DIAL, marginTop: 18, alignItems: "center", justifyContent: "center" },
  dialFace: { position: "absolute", alignItems: "center" },
  dialTime: { fontFamily: fonts.monoMedium, fontSize: 44, lineHeight: 52, letterSpacing: -1, fontVariant: ["tabular-nums"] },
  dialUnder: { fontFamily: fonts.regular, fontSize: 13, lineHeight: 18 },
  controls: { flexDirection: "row", alignItems: "center", gap: 14, marginTop: 20 },
  round: { width: 52, height: 52, borderRadius: 26, flexDirection: "row", alignItems: "center", justifyContent: "center", gap: 1 },
  five: { fontFamily: fonts.monoMedium, fontSize: 15, lineHeight: 20 },
  main: { height: 52, minWidth: 152, paddingHorizontal: 22, borderRadius: 26, flexDirection: "row", alignItems: "center", justifyContent: "center", gap: 8 },
  mainLabel: { fontFamily: fonts.semibold, fontSize: 16, lineHeight: 20 },
  rule: { height: StyleSheet.hairlineWidth, marginVertical: 20 },
  plan: { gap: 12 },
  segment: { flexDirection: "row", borderRadius: 10, padding: 2 },
  segmentItem: { flex: 1, height: 34, alignItems: "center", justifyContent: "center", borderRadius: 8 },
  segmentOn: { shadowColor: "#000", shadowOpacity: 0.08, shadowRadius: 3, shadowOffset: { width: 0, height: 1 } },
  segmentLabel: { fontFamily: fonts.medium, fontSize: 14, lineHeight: 18 },
  lengths: { flexDirection: "row", alignItems: "center", gap: 8 },
  lengthLabel: { fontFamily: fonts.regular, fontSize: 14, lineHeight: 18, width: 48 },
  chips: { flex: 1, flexDirection: "row", flexWrap: "wrap", gap: 5 },
  chip: { minWidth: 36, height: 32, paddingHorizontal: 6, borderRadius: 8, alignItems: "center", justifyContent: "center" },
  chipText: { fontFamily: fonts.monoMedium, fontSize: 14, lineHeight: 18 },
  typed: { width: 56, height: 32, borderRadius: 8, textAlign: "center", fontFamily: fonts.monoMedium, fontSize: 14 },
  note: { fontFamily: fonts.regular, fontSize: 13, lineHeight: 19 },
  alert: { flexDirection: "row", alignItems: "center", gap: 8, minHeight: 36 },
  alertText: { flex: 1, fontFamily: fonts.regular, fontSize: 14, lineHeight: 19 },
  alertAction: { fontFamily: fonts.semibold, fontSize: 14, lineHeight: 19 },
});
