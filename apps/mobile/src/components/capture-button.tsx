import { GlassView, isGlassEffectAPIAvailable, isLiquidGlassAvailable } from "expo-glass-effect";
import { usePathname, useRouter } from "expo-router";
import { Plus } from "lucide-react-native";
import { useEffect, useRef, useState } from "react";
import { AccessibilityInfo, StyleSheet, View } from "react-native";
import { GestureDetector, useExclusiveGestures, usePanGesture, useTapGesture } from "react-native-gesture-handler";
import Animated, { ReduceMotion, useAnimatedReaction, useAnimatedStyle, useSharedValue, withSpring, withTiming } from "react-native-reanimated";
import { scheduleOnRN } from "react-native-worklets";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { haptic } from "@/lib/haptics";
import { useKit } from "@/lib/kit";
import { drag, dropAt, nearestGap, todaySlot } from "@/lib/magic-plus";
import { EASE_OUT, PRESS_MS, SPRING_SETTLE } from "@/lib/motion";
import { useTactile } from "@/lib/tactile";
import { useLocalDate } from "@/lib/views";

const SIZE = 58;
export const CAPTURE_SIZE = SIZE;
export const TAB_BAR_CLEARANCE = 64;

export const useGlass = () => {
  const [solid, setSolid] = useState(false);
  useEffect(() => {
    void AccessibilityInfo.isReduceTransparencyEnabled().then(setSolid);
    const change = AccessibilityInfo.addEventListener("reduceTransparencyChanged", setSolid);
    return () => change.remove();
  }, []);
  return !solid && isLiquidGlassAvailable() && isGlassEffectAPIAvailable();
};

const CANCEL_REACH = 44;

const snap = () => haptic("snap");

const TODAY_PATH = "/";

const useTapSlot = () => {
  const pathname = usePathname();
  const today = useLocalDate();
  const slot = useRef<string | undefined>(undefined);
  useEffect(() => {
    slot.current = pathname === TODAY_PATH ? JSON.stringify(todaySlot(today)) : undefined;
  }, [pathname, today]);
  return slot;
};

export const CaptureButton = () => {
  const { colors, shadow } = useKit();
  const depth = useTactile();
  const insets = useSafeAreaInsets();
  const router = useRouter();
  const glass = useGlass();
  const pressed = useSharedValue(0);
  const dx = useSharedValue(0);
  const dy = useSharedValue(0);
  const lifted = useSharedValue(0);
  const tapSlot = useTapSlot();

  const capture = () => {
    haptic("toggle");
    const slot = tapSlot.current;
    router.push(slot ? { pathname: "/capture", params: { slot } } : "/capture");
  };

  const place = (gap: number) => {
    const drop = dropAt(gap);
    if (!drop) {
      drag.gap.set(-1);
      return;
    }
    haptic("drop");
    drag.held.set(true);
    router.push({ pathname: "/capture", params: { slot: JSON.stringify(drop) } });
  };

  const tap = useTapGesture({
    onBegin: () => {
      "worklet";
      pressed.set(1);
    },
    onActivate: () => {
      "worklet";
      scheduleOnRN(capture);
    },
    onFinalize: () => {
      "worklet";
      pressed.set(0);
    },
  });

  const pan = usePanGesture({
    minDistance: 8,
    onActivate: () => {
      "worklet";
      lifted.set(1);
      drag.gap.set(-1);
      scheduleOnRN(snap);
    },
    onUpdate: (event) => {
      "worklet";
      dx.set(event.translationX);
      dy.set(event.translationY);
      const near = Math.hypot(event.translationX, event.translationY) < CANCEL_REACH;
      drag.gap.set(near ? -1 : nearestGap(event.absoluteY));
    },
    onDeactivate: (event) => {
      "worklet";
      const gap = drag.gap.get();
      if (gap >= 0 && !event.canceled) scheduleOnRN(place, gap);
      else drag.gap.set(-1);
      lifted.set(0);
      dx.set(withSpring(0, { ...SPRING_SETTLE, velocity: event.velocityX, reduceMotion: ReduceMotion.System }));
      dy.set(withSpring(0, { ...SPRING_SETTLE, velocity: event.velocityY, reduceMotion: ReduceMotion.System }));
    },
  });

  const gesture = useExclusiveGestures(pan, tap);

  useAnimatedReaction(
    () => drag.gap.get(),
    (gap, before) => {
      if (lifted.get() && before !== null && gap !== before && gap >= 0) scheduleOnRN(snap);
    },
  );

  const style = useAnimatedStyle(() => ({
    transform: [
      { translateX: dx.get() },
      { translateY: dy.get() },
      { scale: withTiming(pressed.get() ? 0.94 : lifted.get() ? 1.06 : 1, { duration: PRESS_MS, easing: EASE_OUT }) },
    ],
  }));
  const plus = <Plus size={28} color={colors.accentForeground} strokeWidth={2.25} />;
  return (
    <GestureDetector gesture={gesture}>
      <Animated.View
        accessible
        accessibilityRole="button"
        accessibilityLabel="New Task"
        accessibilityHint="Opens quick capture. Drag it into a list to place the Task there."
        onAccessibilityTap={capture}
        style={[styles.place, { bottom: insets.bottom + TAB_BAR_CLEARANCE }, glass ? null : shadow("lg"), style]}
      >
        {glass ? (
          <GlassView isInteractive glassEffectStyle="regular" tintColor={colors.accent} style={styles.button}>
            {plus}
          </GlassView>
        ) : (
          <View style={[styles.button, depth.raised, { backgroundColor: colors.accent }]}>{plus}</View>
        )}
      </Animated.View>
    </GestureDetector>
  );
};

const styles = StyleSheet.create({
  place: { position: "absolute", right: 20, borderRadius: SIZE / 2 },
  button: { width: SIZE, height: SIZE, borderRadius: SIZE / 2, alignItems: "center", justifyContent: "center" },
});
