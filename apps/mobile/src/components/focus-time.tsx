import { Timer } from "lucide-react-native";
import { ActionSheetIOS, StyleSheet, Text, View } from "react-native";
import Svg, { Circle } from "react-native-svg";
import { isFocusingOn, viewOf, wholeMinutes, type ActiveFocus, type FocusView } from "@lifeos/backend/client/focus";
import { formatMinutes } from "@lifeos/backend/estimate";
import type { PlannerTask } from "@lifeos/backend/types";
import { Button } from "@/components/button";
import { haptic } from "@/lib/haptics";
import { useKit } from "@/lib/kit";
import { fonts, usePlanner } from "@/lib/kit-theme";
import { currentFocus, useActualMs, useFocus, useFocusNow, useFocusOn } from "@/lib/focus";

const RING_DOTS = 24;
const METER_UNITS = [15, 30, 60, 120, 240, 480, 1440];

export const countdown = (seconds: number) =>
  `${String(Math.floor(seconds / 60)).padStart(2, "0")}:${String(seconds % 60).padStart(2, "0")}`;

export const DotRing = ({ ring, fills, size, dot, lit, dim }: { ring: number; fills: boolean; size: number; dot: number; lit: string; dim: string }) => {
  const centre = size / 2;
  const radius = centre - dot;
  const on = Math.min(RING_DOTS, Math.max(0, fills ? Math.floor(ring * RING_DOTS) : Math.ceil(ring * RING_DOTS)));
  return (
    <Svg width={size} height={size} accessibilityElementsHidden importantForAccessibility="no-hide-descendants">
      {Array.from({ length: RING_DOTS }, (_, index) => {
        const turn = (index / RING_DOTS) * Math.PI * 2;
        return (
          <Circle
            key={index}
            cx={centre + radius * Math.sin(turn)}
            cy={centre - radius * Math.cos(turn)}
            r={dot}
            fill={index < on ? lit : dim}
          />
        );
      })}
    </Svg>
  );
};

export const useFocusTone = (view: FocusView) => {
  const { colors } = useKit();
  const tones = usePlanner();
  if (view.status === "paused") return { lit: colors.mutedForeground, dim: tones.surfaceRaised };
  if (view.phase === "break" || view.status === "done") return { lit: colors.success, dim: tones.surfaceRaised };
  return { lit: colors.accent, dim: tones.surfaceRaised };
};

export const ActualMeter = ({ actual, estimate, colour, max = 6, dot = 2 }: { actual: number; estimate?: number; colour: string; max?: number; dot?: number }) => {
  const { colors } = useKit();
  const tones = usePlanner();
  const span = Math.max(actual, estimate ?? 0, 1);
  const unit = METER_UNITS.find((minutes) => Math.ceil(span / minutes) <= max) ?? 1440;
  const planned = estimate === undefined ? 0 : Math.max(1, Math.round(estimate / unit));
  const filled = actual <= 0 ? 0 : Math.max(1, Math.round(actual / unit));
  const dots = Math.min(max, Math.max(planned, filled));
  return (
    <View style={[styles.meter, { gap: dot + 1 }]} accessibilityElementsHidden importantForAccessibility="no-hide-descendants">
      {Array.from({ length: dots }, (_, index) => {
        const on = index < filled;
        const over = on && estimate !== undefined && index >= planned;
        return (
          <View
            key={index}
            style={{ width: dot * 2, height: dot * 2, borderRadius: dot, backgroundColor: on ? (over ? colors.danger : colour) : tones.surfaceRaised }}
          />
        );
      })}
    </View>
  );
};

const LiveBadge = ({ active }: { active: ActiveFocus }) => {
  const now = useFocusNow(active.state.kind === "running");
  const view = viewOf(active, now);
  const tone = useFocusTone(view);
  return (
    <View style={styles.pair} accessibilityLabel={view.phase === "break" ? "On a break" : view.status === "paused" ? "Focus Session paused" : "In focus now"}>
      <DotRing ring={view.status === "done" ? 1 : view.ring} fills={!view.timed} size={14} dot={1} lit={tone.lit} dim={tone.dim} />
      <Text style={[styles.figure, { color: tone.lit }]}>{countdown(Math.max(0, view.seconds))}</Text>
    </View>
  );
};

export const useTimeShown = (task: PlannerTask) => {
  const active = useFocusOn(task._id);
  return task.estimateMinutes !== undefined || task.focus.ms > 0 || active !== null;
};

export const FocusTime = ({ task }: { task: PlannerTask }) => {
  const { colors } = useKit();
  const tones = usePlanner();
  const active = useFocusOn(task._id);
  const actual = wholeMinutes(useActualMs(task));
  const estimate = task.estimateMinutes;
  const over = estimate !== undefined && actual > estimate;
  const colour = task.area ? tones.area[task.area.colour] : colors.accent;
  return (
    <>
      {active ? <LiveBadge active={active} /> : null}
      {actual === 0 ? (
        estimate === undefined ? null : (
          <Text style={[styles.chip, { color: colors.mutedForeground, backgroundColor: tones.surface }]}>{formatMinutes(estimate)}</Text>
        )
      ) : (
        <View
          style={styles.pair}
          accessible
          accessibilityLabel={estimate === undefined ? `${formatMinutes(actual)} of focus` : `${formatMinutes(actual)} of focus against an Estimate of ${formatMinutes(estimate)}`}
        >
          <ActualMeter actual={actual} estimate={estimate} colour={colour} />
          <Text style={[styles.figure, { color: over ? colors.danger : colors.mutedForeground }]}>
            {formatMinutes(actual)}
            {estimate === undefined ? null : <Text style={{ color: tones.faintForeground }}>{` / ${formatMinutes(estimate)}`}</Text>}
          </Text>
        </View>
      )}
    </>
  );
};

export const planSummary = ({ mode, focusMinutes, breakMinutes }: { mode: string; focusMinutes: number; breakMinutes: number }) =>
  mode === "open" ? "Stopwatch, counting up until you stop" : `Pomodoro, ${focusMinutes} min of focus then a ${breakMinutes} min break`;

export const openFocusMenu = (task: PlannerTask, openSheet: () => void) => {
  if (task.status.kind !== "open") return;
  const { active, plan, actions } = currentFocus();
  const ours = isFocusingOn(active, task._id, Date.now()) ? active : null;
  haptic("toggle");
  if (!ours) {
    ActionSheetIOS.showActionSheetWithOptions(
      { title: task.title, message: planSummary(plan), options: ["Start Focus Session", "Focus Options", "Cancel"], cancelButtonIndex: 2 },
      (index) => {
        if (index === 0) {
          haptic("drop");
          actions.start(task);
        }
        if (index === 1) openSheet();
      },
    );
    return;
  }
  const paused = ours.state.kind === "paused";
  ActionSheetIOS.showActionSheetWithOptions(
    {
      title: task.title,
      options: [paused ? "Resume" : "Pause", "Stop Focus Session", "Focus Options", "Cancel"],
      destructiveButtonIndex: 1,
      cancelButtonIndex: 3,
    },
    (index) => {
      if (index === 0) actions.toggle();
      if (index === 1) actions.stop();
      if (index === 2) openSheet();
    },
  );
};

export const FocusCardSection = ({ task, onOptions }: { task: PlannerTask; onOptions: () => void }) => {
  const { colors } = useKit();
  const tones = usePlanner();
  const { actions } = useFocus();
  const mine = useFocusOn(task._id);
  const ours = mine?.kind === "focus" ? mine : null;
  const actual = wholeMinutes(useActualMs(task));
  const estimate = task.estimateMinutes;
  const over = estimate === undefined ? 0 : actual - estimate;
  const open = task.status.kind === "open";
  const label = !ours ? "Focus" : ours.state.kind === "paused" ? "Resume" : "Pause";
  const colour = task.area ? tones.area[task.area.colour] : colors.accent;
  if (!open && actual === 0) return null;
  return (
    <View style={[styles.section, { backgroundColor: tones.surfaceInset }]}>
      <View style={styles.sectionHead}>
        <Timer size={18} color={ours ? colors.accent : colors.mutedForeground} strokeWidth={1.75} />
        <Text style={[styles.sectionLabel, { color: colors.mutedForeground }]}>Actual</Text>
        <View style={styles.sectionValue} accessible accessibilityLabel={`Actual Time ${formatMinutes(actual)}${estimate === undefined ? "" : ` of ${formatMinutes(estimate)}`}`}>
          <Text style={[styles.bigFigure, { color: over > 0 ? colors.danger : colors.foreground }]}>{formatMinutes(actual)}</Text>
          {estimate === undefined ? null : <Text style={[styles.of, { color: tones.faintForeground }]}>of {formatMinutes(estimate)}</Text>}
        </View>
        {open ? (
          <Button
            title={label}
            size="sm"
            variant={ours ? "primary" : "secondary"}
            accessibilityLabel={ours ? `${label} the Focus Session` : "Start a Focus Session"}
            onPress={() => (ours ? actions.toggle() : actions.start(task))}
            onLongPress={onOptions}
            hitSlop={6}
            style={styles.focusButton}
          />
        ) : null}
      </View>
      {actual > 0 || estimate !== undefined ? (
        <View style={styles.sectionMeter}>
          <ActualMeter actual={actual} estimate={estimate} colour={colour} max={16} dot={3.5} />
          {over > 0 ? <Text style={[styles.over, { color: colors.danger }]}>{formatMinutes(over)} over</Text> : null}
        </View>
      ) : null}
    </View>
  );
};

const styles = StyleSheet.create({
  pair: { flexDirection: "row", alignItems: "center", gap: 5 },
  meter: { flexDirection: "row", alignItems: "center" },
  figure: { fontFamily: fonts.mono, fontSize: 12, lineHeight: 18, fontVariant: ["tabular-nums"] },
  chip: { fontFamily: fonts.mono, fontSize: 12, lineHeight: 18, paddingHorizontal: 6, borderRadius: 6, overflow: "hidden" },
  section: { borderRadius: 16, marginTop: 10, paddingHorizontal: 14, paddingVertical: 8, gap: 6 },
  sectionHead: { flexDirection: "row", alignItems: "center", gap: 12, minHeight: 40 },
  sectionLabel: { fontFamily: fonts.regular, fontSize: 16, lineHeight: 22, width: 84 },
  sectionValue: { flex: 1, flexDirection: "row", alignItems: "baseline", gap: 6 },
  bigFigure: { fontFamily: fonts.monoMedium, fontSize: 15, lineHeight: 22, fontVariant: ["tabular-nums"] },
  of: { fontFamily: fonts.mono, fontSize: 13, lineHeight: 18 },
  focusButton: { minWidth: 76 },
  sectionMeter: { flexDirection: "row", alignItems: "center", gap: 10, paddingLeft: 30, paddingBottom: 6 },
  over: { fontFamily: fonts.mono, fontSize: 12, lineHeight: 18 },
});
