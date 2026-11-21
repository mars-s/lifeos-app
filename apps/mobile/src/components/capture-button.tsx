import { useRouter } from "expo-router";
import { Plus } from "lucide-react-native";
import { Pressable, StyleSheet } from "react-native";
import Animated, { useAnimatedStyle, useSharedValue, withTiming } from "react-native-reanimated";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { haptic } from "@/lib/haptics";
import { useKit } from "@/lib/kit";
import { EASE_OUT, PRESS_MS } from "@/lib/motion";

const SIZE = 58;

export const CaptureButton = () => {
  const { colors, shadow } = useKit();
  const insets = useSafeAreaInsets();
  const router = useRouter();
  const pressed = useSharedValue(0);
  const style = useAnimatedStyle(() => ({ transform: [{ scale: withTiming(pressed.get() ? 0.94 : 1, { duration: PRESS_MS, easing: EASE_OUT }) }] }));
  return (
    <Animated.View style={[styles.place, { bottom: insets.bottom + 18 }, shadow("lg"), style]}>
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
        style={[styles.button, { backgroundColor: colors.accent }]}
      >
        <Plus size={28} color={colors.accentForeground} strokeWidth={2.25} />
      </Pressable>
    </Animated.View>
  );
};

const styles = StyleSheet.create({
  place: { position: "absolute", right: 20, borderRadius: SIZE / 2 },
  button: { width: SIZE, height: SIZE, borderRadius: SIZE / 2, alignItems: "center", justifyContent: "center" },
});
