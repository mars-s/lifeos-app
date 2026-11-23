import type { LucideIcon } from "lucide-react-native";
import type { ReactNode } from "react";
import { ActivityIndicator, StyleSheet, Text, type StyleProp, type ViewStyle } from "react-native";
import { GestureDetector, useExclusiveGestures, useLongPressGesture, useTapGesture } from "react-native-gesture-handler";
import Animated, { useAnimatedStyle, useReducedMotion, useSharedValue, withTiming } from "react-native-reanimated";
import { scheduleOnRN } from "react-native-worklets";
import { haptic as play, type Haptic } from "@/lib/haptics";
import { alpha, useKit } from "@/lib/kit";
import { fonts, usePlanner } from "@/lib/kit-theme";
import { EASE_OUT, PRESS_MS } from "@/lib/motion";
import { useTactile } from "@/lib/tactile";

export type ButtonVariant = "primary" | "secondary" | "raised" | "quiet" | "danger";
export type ButtonSize = "sm" | "md" | "lg";

const SIZES = {
  sm: { height: 34, padding: 14, gap: 6, font: 13.5, glyph: 15 },
  md: { height: 44, padding: 18, gap: 8, font: 15, glyph: 17 },
  lg: { height: 56, padding: 26, gap: 9, font: 16.5, glyph: 18 },
} as const satisfies Record<ButtonSize, { height: number; padding: number; gap: number; font: number; glyph: number }>;

const useFace = (variant: ButtonVariant) => {
  const { colors } = useKit();
  const depth = useTactile();
  const tones = usePlanner();
  if (variant === "raised") return { face: [depth.raised, { backgroundColor: tones.surfaceRaised }], ink: colors.foreground };
  if (variant === "primary") return { face: depth.primary, ink: depth.primaryInk };
  if (variant === "secondary") return { face: depth.secondary, ink: colors.foreground };
  if (variant === "danger") return { face: { backgroundColor: alpha(colors.danger, 0.15) }, ink: colors.danger };
  return { face: null, ink: colors.mutedForeground };
};

type PressProps = {
  onPress: () => void;
  onLongPress?: (() => void) | undefined;
  haptic?: Haptic | null | undefined;
  disabled?: boolean | undefined;
  loading?: boolean | undefined;
  accessibilityLabel?: string | undefined;
  accessibilityHint?: string | undefined;
  selected?: boolean | undefined;
  hitSlop?: number | undefined;
  style?: StyleProp<ViewStyle>;
  children: ReactNode;
};

export const Pressed = ({ onPress, onLongPress, haptic = "toggle", disabled, loading, accessibilityLabel, accessibilityHint, selected, hitSlop, style, children }: PressProps) => {
  const reduced = useReducedMotion();
  const pressed = useSharedValue(0);
  const enabled = !disabled && !loading;
  const press = () => {
    if (haptic) play(haptic);
    onPress();
  };
  const hold = () => {
    if (!onLongPress) return;
    play("lift");
    onLongPress();
  };
  const tap = useTapGesture({
    enabled,
    maxDuration: onLongPress ? 450 : 1000,
    hitSlop: hitSlop ?? 0,
    onBegin: () => {
      "worklet";
      pressed.set(1);
    },
    onActivate: () => {
      "worklet";
      scheduleOnRN(press);
    },
    onFinalize: () => {
      "worklet";
      pressed.set(0);
    },
  });
  const long = useLongPressGesture({
    enabled: enabled && onLongPress !== undefined,
    minDuration: 450,
    hitSlop: hitSlop ?? 0,
    onActivate: () => {
      "worklet";
      pressed.set(0);
      scheduleOnRN(hold);
    },
  });
  const gesture = useExclusiveGestures(long, tap);
  const motion = useAnimatedStyle(() => {
    const down = pressed.get() === 1;
    if (reduced) return { opacity: withTiming((disabled ? 0.4 : 1) * (down ? 0.7 : 1), { duration: PRESS_MS }) };
    return {
      transform: [
        { translateY: withTiming(down ? 0.5 : 0, { duration: PRESS_MS, easing: EASE_OUT }) },
        { scale: withTiming(down ? 0.97 : 1, { duration: PRESS_MS, easing: EASE_OUT }) },
      ],
    };
  });
  return (
    <GestureDetector gesture={gesture}>
      <Animated.View
        accessible
        accessibilityRole="button"
        accessibilityLabel={accessibilityLabel}
        accessibilityHint={accessibilityHint}
        accessibilityState={{ disabled: !enabled, busy: loading === true, ...(selected === undefined ? {} : { selected }) }}
        accessibilityActions={onLongPress ? [{ name: "longpress", label: "More" }] : undefined}
        onAccessibilityAction={(event) => (event.nativeEvent.actionName === "longpress" ? hold() : undefined)}
        onAccessibilityTap={enabled ? press : undefined}
        style={[style, disabled ? styles.disabled : null, motion]}
      >
        {children}
      </Animated.View>
    </GestureDetector>
  );
};

type Content = { icon?: LucideIcon | undefined; iconFill?: boolean | undefined; render?: ((ink: string) => ReactNode) | undefined };

type ButtonProps = Omit<PressProps, "children" | "style"> &
  Content & {
    title?: string | undefined;
    variant?: ButtonVariant | undefined;
    size?: ButtonSize | undefined;
    stretch?: boolean | undefined;
    style?: StyleProp<ViewStyle>;
  };

export const Button = ({ title, variant = "secondary", size = "md", icon: Icon, iconFill, render, stretch, style, ...press }: ButtonProps) => {
  const { face, ink } = useFace(variant);
  const s = SIZES[size];
  return (
    <Pressed {...press} accessibilityLabel={press.accessibilityLabel ?? title} style={[styles.base, { height: s.height, paddingHorizontal: s.padding, gap: s.gap }, face, stretch ? styles.stretch : null, style]}>
      {press.loading ? <ActivityIndicator size="small" color={ink} /> : Icon ? <Icon size={s.glyph} color={ink} strokeWidth={2} fill={iconFill ? ink : "transparent"} /> : null}
      {render ? render(ink) : null}
      {title ? (
        <Text numberOfLines={1} style={[styles.title, { fontSize: s.font, color: ink }]}>
          {title}
        </Text>
      ) : null}
    </Pressed>
  );
};

type IconButtonProps = Omit<PressProps, "children" | "style" | "accessibilityLabel"> &
  Content & {
    label: string;
    variant?: ButtonVariant | undefined;
    size?: ButtonSize | undefined;
    style?: StyleProp<ViewStyle>;
  };

export const IconButton = ({ label, variant = "secondary", size = "md", icon: Icon, iconFill, render, style, ...press }: IconButtonProps) => {
  const { face, ink } = useFace(variant);
  const s = SIZES[size];
  return (
    <Pressed {...press} accessibilityLabel={label} style={[styles.base, { width: s.height, height: s.height }, face, style]}>
      {press.loading ? <ActivityIndicator size="small" color={ink} /> : Icon ? <Icon size={s.glyph + 1} color={ink} strokeWidth={2} fill={iconFill ? ink : "transparent"} /> : null}
      {render ? render(ink) : null}
    </Pressed>
  );
};

const styles = StyleSheet.create({
  base: { flexDirection: "row", alignItems: "center", justifyContent: "center", borderRadius: 999, borderCurve: "continuous" },
  stretch: { alignSelf: "stretch" },
  title: { fontFamily: fonts.medium },
  disabled: { opacity: 0.4 },
});
