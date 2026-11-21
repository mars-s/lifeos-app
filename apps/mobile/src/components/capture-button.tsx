import { GlassView, isGlassEffectAPIAvailable, isLiquidGlassAvailable } from "expo-glass-effect";
import { useRouter } from "expo-router";
import { Plus } from "lucide-react-native";
import { useEffect, useState } from "react";
import { AccessibilityInfo, Pressable, StyleSheet, View } from "react-native";
import Animated, { useAnimatedStyle, useSharedValue, withTiming } from "react-native-reanimated";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { haptic } from "@/lib/haptics";
import { useKit } from "@/lib/kit";
import { EASE_OUT, PRESS_MS } from "@/lib/motion";

const SIZE = 58;
export const TAB_BAR_CLEARANCE = 64;

const useGlass = () => {
  const [solid, setSolid] = useState(false);
  useEffect(() => {
    void AccessibilityInfo.isReduceTransparencyEnabled().then(setSolid);
    const change = AccessibilityInfo.addEventListener("reduceTransparencyChanged", setSolid);
    return () => change.remove();
  }, []);
  return !solid && isLiquidGlassAvailable() && isGlassEffectAPIAvailable();
};

export const CaptureButton = () => {
  const { colors, shadow } = useKit();
  const insets = useSafeAreaInsets();
  const router = useRouter();
  const glass = useGlass();
  const pressed = useSharedValue(0);
  const style = useAnimatedStyle(() => ({ transform: [{ scale: withTiming(pressed.get() ? 0.94 : 1, { duration: PRESS_MS, easing: EASE_OUT }) }] }));
  const plus = <Plus size={28} color={colors.accentForeground} strokeWidth={2.25} />;
  return (
    <Animated.View style={[styles.place, { bottom: insets.bottom + TAB_BAR_CLEARANCE }, glass ? null : shadow("lg"), style]}>
      <Pressable
        accessibilityRole="button"
        accessibilityLabel="New Task"
        accessibilityHint="Opens quick capture"
        onPressIn={() => pressed.set(1)}
        onPressOut={() => pressed.set(0)}
        onPress={() => {
          haptic("toggle");
          router.push("/capture");
        }}
      >
        {glass ? (
          <GlassView isInteractive glassEffectStyle="regular" tintColor={colors.accent} style={styles.button}>
            {plus}
          </GlassView>
        ) : (
          <View style={[styles.button, { backgroundColor: colors.accent }]}>{plus}</View>
        )}
      </Pressable>
    </Animated.View>
  );
};

const styles = StyleSheet.create({
  place: { position: "absolute", right: 20, borderRadius: SIZE / 2 },
  button: { width: SIZE, height: SIZE, borderRadius: SIZE / 2, alignItems: "center", justifyContent: "center" },
});
