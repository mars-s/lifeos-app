import { GlassView } from "expo-glass-effect";
import { useRouter } from "expo-router";
import { Coffee, Pause, Play, SkipForward, type LucideIcon } from "lucide-react-native";
import { Pressable, StyleSheet, Text, View } from "react-native";
import Animated, { FadeIn, FadeOut, ReduceMotion } from "react-native-reanimated";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { viewOf, type ActiveFocus, type FocusActions, type FocusView } from "@lifeos/backend/client/focus";
import { roundOf, POMODOROS_PER_LONG_BREAK } from "@lifeos/backend/focus";
import { CAPTURE_SIZE, TAB_BAR_CLEARANCE, useGlass } from "@/components/capture-button";
import { DotRing, countdown, useFocusTone } from "@/components/focus-time";
import { haptic } from "@/lib/haptics";
import { useKit } from "@/lib/kit";
import { fonts, usePlanner } from "@/lib/kit-theme";
import { useFocus, useFocusNow } from "@/lib/focus";
import { BASE_MS, EASE_OUT, FAST_MS } from "@/lib/motion";

const HEIGHT = 52;
const GAP = 12;

type Primary = { label: string; icon: LucideIcon; run: () => void };

export const primaryFor = (view: FocusView, actions: FocusActions) =>
  (view.status === "paused"
    ? { label: "Resume", icon: Play, run: actions.resume }
    : view.status === "done"
      ? view.phase === "focus"
        ? { label: "Start the break", icon: Coffee, run: actions.advance }
        : { label: "Back to focus", icon: Play, run: actions.advance }
      : view.phase === "break"
        ? { label: "Skip the break", icon: SkipForward, run: actions.advance }
        : { label: "Pause", icon: Pause, run: actions.pause }) satisfies Primary;

export const phaseLine = (active: ActiveFocus, view: FocusView) => {
  if (view.status === "done") return view.phase === "break" ? "Break over" : "Time is up";
  if (view.status === "paused") return "Paused";
  if (view.phase === "break") return view.longBreak ? "Long break" : "Break";
  if (!active.pomodoro) return "Stopwatch";
  return `Round ${roundOf(active.pomodoro)} of ${POMODOROS_PER_LONG_BREAK}`;
};

const PillBody = ({ active, actions }: { active: ActiveFocus; actions: FocusActions }) => {
  const { colors } = useKit();
  const tones = usePlanner();
  const router = useRouter();
  const now = useFocusNow(active.state.kind === "running");
  const view = viewOf(active, now);
  const tone = useFocusTone(view);
  const primary = primaryFor(view, actions);
  const Icon = primary.icon;
  const time = countdown(Math.max(0, view.seconds));
  return (
    <View style={styles.content}>
      <Pressable
        accessibilityRole="button"
        accessibilityLabel={`${view.phase === "break" ? "Break" : "Focus Session"} on ${active.title}, ${time}${view.timed && view.status !== "done" ? " left" : ""}, ${phaseLine(active, view)}`}
        accessibilityHint="Opens Focus"
        onPress={() => {
          haptic("toggle");
          router.push("/focus");
        }}
        style={({ pressed }) => [styles.open, { opacity: pressed ? 0.7 : 1 }]}
      >
        <DotRing ring={view.status === "done" ? 1 : view.ring} fills={!view.timed} size={30} dot={1.6} lit={tone.lit} dim={tone.dim} />
        <View style={styles.words}>
          <Text numberOfLines={1} style={[styles.title, { color: colors.foreground }]}>
            {active.title}
          </Text>
          <Text numberOfLines={1} style={[styles.phase, { color: view.status === "done" ? colors.success : colors.mutedForeground }]}>
            {phaseLine(active, view)}
          </Text>
        </View>
        <Text style={[styles.time, { color: view.status === "paused" ? colors.mutedForeground : colors.foreground }]}>{time}</Text>
      </Pressable>
      <Pressable
        accessibilityRole="button"
        accessibilityLabel={primary.label}
        hitSlop={4}
        onPress={() => {
          haptic("toggle");
          primary.run();
        }}
        style={({ pressed }) => [styles.primary, { backgroundColor: tones.surfaceRaised, transform: [{ scale: pressed ? 0.92 : 1 }] }]}
      >
        <Icon size={17} color={colors.foreground} fill={Icon === Coffee || Icon === SkipForward ? "transparent" : colors.foreground} strokeWidth={2} />
      </Pressable>
    </View>
  );
};

export const FocusPill = () => {
  const { colors, shadow } = useKit();
  const insets = useSafeAreaInsets();
  const glass = useGlass();
  const { active, actions } = useFocus();
  if (!active) return null;
  const place = { bottom: insets.bottom + TAB_BAR_CLEARANCE + (CAPTURE_SIZE - HEIGHT) / 2, right: 20 + CAPTURE_SIZE + GAP };
  return (
    <Animated.View
      entering={FadeIn.duration(BASE_MS).easing(EASE_OUT).reduceMotion(ReduceMotion.Never)}
      exiting={FadeOut.duration(FAST_MS).reduceMotion(ReduceMotion.Never)}
      style={[styles.place, place, glass ? null : shadow("lg")]}
    >
      {glass ? (
        <GlassView glassEffectStyle="regular" style={styles.pill}>
          <PillBody active={active} actions={actions} />
        </GlassView>
      ) : (
        <View style={[styles.pill, { backgroundColor: colors.popover, borderColor: colors.border, borderWidth: StyleSheet.hairlineWidth }]}>
          <PillBody active={active} actions={actions} />
        </View>
      )}
    </Animated.View>
  );
};

const styles = StyleSheet.create({
  place: { position: "absolute", left: 16, borderRadius: HEIGHT / 2 },
  pill: { height: HEIGHT, borderRadius: HEIGHT / 2, overflow: "hidden" },
  content: { flex: 1, flexDirection: "row", alignItems: "center", paddingLeft: 11, paddingRight: 8 },
  open: { flex: 1, flexDirection: "row", alignItems: "center", gap: 10, height: HEIGHT },
  words: { flex: 1, minWidth: 0 },
  title: { fontFamily: fonts.medium, fontSize: 15, lineHeight: 19 },
  phase: { fontFamily: fonts.regular, fontSize: 12, lineHeight: 16 },
  time: { fontFamily: fonts.monoMedium, fontSize: 16, lineHeight: 20, fontVariant: ["tabular-nums"], paddingRight: 8 },
  primary: { width: 36, height: 36, borderRadius: 18, alignItems: "center", justifyContent: "center" },
});
