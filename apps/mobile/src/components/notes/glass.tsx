import { GlassView } from "expo-glass-effect";
import type { ReactNode } from "react";
import { StyleSheet, View, type StyleProp, type ViewStyle } from "react-native";
import Animated from "react-native-reanimated";
import type { SyncStatus } from "@lifeos/notes/client";
import { useGlass } from "@/components/capture-button";
import { useKit } from "@/lib/kit";
import { usePlanner } from "@/lib/kit-theme";

export const Glass = ({ style, children, interactive = false }: { style?: StyleProp<ViewStyle>; children: ReactNode; interactive?: boolean }) => {
  const glass = useGlass();
  const { colors, shadow } = useKit();
  if (glass)
    return (
      <GlassView glassEffectStyle="regular" isInteractive={interactive} style={style}>
        {children}
      </GlassView>
    );
  return <View style={[style, shadow("md"), { backgroundColor: colors.popover, borderColor: colors.border, borderWidth: StyleSheet.hairlineWidth }]}>{children}</View>;
};

const MERGE_DOT = {
  animationName: { from: { opacity: 0.25 }, to: { opacity: 1 } },
  animationDuration: 480,
  animationIterationCount: "infinite",
  animationDirection: "alternate",
  animationTimingFunction: "ease-in-out",
} as const;

export const syncWords = (status: SyncStatus) => {
  switch (status.kind) {
    case "synced":
      return "Synced";
    case "connecting":
      return "Connecting";
    case "offline":
      return status.waiting > 0 ? `Offline. ${status.waiting} ${status.waiting === 1 ? "edit" : "edits"} kept here` : "Offline";
    case "merging":
      return `Merging ${status.edits} ${status.edits === 1 ? "edit" : "edits"}`;
  }
};

export const SyncDot = ({ status }: { status: SyncStatus }) => {
  const { colors } = useKit();
  const tones = usePlanner();
  if (status.kind === "merging")
    return (
      <View accessibilityLabel={syncWords(status)} style={styles.merging}>
        {[0, 160, 320].map((delay) => (
          <Animated.View key={delay} style={[styles.mergeDot, { backgroundColor: colors.accent, animationDelay: delay }, MERGE_DOT]} />
        ))}
      </View>
    );
  return (
    <View accessibilityLabel={syncWords(status)} style={styles.slot}>
      <View
        style={[
          styles.dot,
          status.kind === "synced" ? { backgroundColor: colors.success, opacity: 0.85 } : { borderColor: tones.faintForeground, borderWidth: 1.5 },
        ]}
      />
    </View>
  );
};

const styles = StyleSheet.create({
  slot: { width: 14, height: 14, alignItems: "center", justifyContent: "center" },
  dot: { width: 7, height: 7, borderRadius: 4 },
  merging: { width: 14, height: 14, flexDirection: "row", alignItems: "center", justifyContent: "space-between" },
  mergeDot: { width: 3, height: 3, borderRadius: 2 },
});
