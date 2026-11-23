import { Sparkles, X } from "lucide-react-native";
import { useEffect, useState } from "react";
import { Pressable, StyleSheet, Text, TextInput, View } from "react-native";
import Animated, { FadeIn, FadeOut, ReduceMotion, useAnimatedStyle, useReducedMotion, useSharedValue, withRepeat, withTiming } from "react-native-reanimated";
import { MODELS, isModelId } from "@lifeos/backend/ai";
import { Button } from "@/components/button";
import { STEPS_FAILED, type Steps } from "@/lib/ai";
import { useKit } from "@/lib/kit";
import { fonts, usePlanner } from "@/lib/kit-theme";
import { FAST_MS } from "@/lib/motion";

type Draft = { key: number; title: string };

const Ghost = ({ width, delay }: { width: `${number}%`; delay: number }) => {
  const tones = usePlanner();
  const reduced = useReducedMotion();
  const glow = useSharedValue(1);
  useEffect(() => {
    if (reduced) return;
    const timer = setTimeout(() => glow.set(withRepeat(withTiming(0.45, { duration: 700, reduceMotion: ReduceMotion.System }), -1, true)), delay);
    return () => clearTimeout(timer);
  }, [glow, delay, reduced]);
  const style = useAnimatedStyle(() => ({ opacity: glow.get() }));
  return <Animated.View style={[styles.ghost, { width, backgroundColor: tones.surfaceRaised }, style]} />;
};

const DraftSteps = ({ steps, project, answeredBy, onAccept, onAgain, onDismiss }: { steps: readonly string[]; project: boolean; answeredBy: string; onAccept: (titles: string[]) => void; onAgain: () => void; onDismiss: () => void }) => {
  const { colors } = useKit();
  const tones = usePlanner();
  const [items, setItems] = useState<Draft[]>(() => steps.map((title, key) => ({ key, title })));
  const titles = items.map((item) => item.title.trim()).filter((title) => title !== "");
  const model = isModelId(answeredBy) ? MODELS[answeredBy].title : answeredBy;
  return (
    <>
      {items.map((item) => (
        <Animated.View key={item.key} exiting={FadeOut.duration(FAST_MS)} style={styles.step}>
          <View style={[styles.proposed, { borderColor: colors.accent }]} />
          <TextInput
            value={item.title}
            onChangeText={(title) => setItems((current) => current.map((entry) => (entry.key === item.key ? { ...entry, title } : entry)))}
            accessibilityLabel="Suggested step"
            multiline
            submitBehavior="blurAndSubmit"
            returnKeyType="done"
            style={[styles.stepText, { color: colors.foreground }]}
          />
          <Pressable
            accessibilityRole="button"
            accessibilityLabel={`Leave out ${item.title}`}
            hitSlop={8}
            onPress={() => setItems((current) => current.filter((entry) => entry.key !== item.key))}
            style={styles.leaveOut}
          >
            <X size={16} color={tones.faintForeground} strokeWidth={2} />
          </Pressable>
        </Animated.View>
      ))}
      {project ? <Text style={[styles.note, { color: colors.mutedForeground }]}>This looks big enough to be a Project. For now, the steps go in the Checklist.</Text> : null}
      <View style={styles.actions}>
        <Button variant="primary" size="sm" disabled={titles.length === 0} title={titles.length === 1 ? "Add 1 step" : `Add ${titles.length} steps`} onPress={() => onAccept(titles)} />
        <Button variant="quiet" size="sm" title="Ask again" onPress={onAgain} />
        <Button variant="quiet" size="sm" title="Dismiss" onPress={onDismiss} />
      </View>
      <Text style={[styles.model, { color: tones.faintForeground }]}>{model}</Text>
    </>
  );
};

export const SuggestedSteps = ({ steps }: { steps: Steps }) => {
  const { colors } = useKit();
  const { view } = steps;
  if (view?.kind !== "thinking" && view?.kind !== "steps" && view?.kind !== "failed") return null;
  return (
    <Animated.View
      entering={FadeIn.duration(FAST_MS)}
      exiting={FadeOut.duration(FAST_MS)}
      accessibilityLabel="Suggested steps"
      style={[styles.panel, { borderColor: colors.accent }]}
    >
      <View style={[StyleSheet.absoluteFill, styles.wash, { backgroundColor: colors.accent }]} />
      <View style={styles.head}>
        <Sparkles size={15} color={colors.accent} strokeWidth={2} />
        <Text accessibilityRole="header" style={[styles.title, { color: colors.foreground }]}>
          Suggested steps
        </Text>
      </View>
      {view.kind === "thinking" ? (
        <View accessibilityLabel="Breaking it into steps" style={styles.ghosts}>
          <Ghost width="72%" delay={0} />
          <Ghost width="56%" delay={160} />
          <Ghost width="64%" delay={320} />
        </View>
      ) : null}
      {view.kind === "failed" ? (
        <>
          <Text accessibilityLiveRegion="polite" style={[styles.note, { color: colors.mutedForeground }]}>
            {STEPS_FAILED[view.error]}
          </Text>
          <View style={styles.actions}>
            <Button size="sm" title="Try again" onPress={steps.again} />
            <Button variant="quiet" size="sm" title="Dismiss" onPress={steps.dismiss} />
          </View>
        </>
      ) : null}
      {view.kind === "steps" ? (
        <DraftSteps key={view.steps.join("\n")} steps={view.steps} project={view.project} answeredBy={view.answeredBy} onAccept={steps.accept} onAgain={steps.again} onDismiss={steps.dismiss} />
      ) : null}
    </Animated.View>
  );
};

const styles = StyleSheet.create({
  panel: { borderRadius: 16, borderWidth: StyleSheet.hairlineWidth, paddingHorizontal: 12, paddingTop: 10, paddingBottom: 12, marginTop: 6, overflow: "hidden" },
  wash: { opacity: 0.06 },
  head: { flexDirection: "row", alignItems: "center", gap: 8, paddingBottom: 6 },
  title: { fontFamily: fonts.medium, fontSize: 15, lineHeight: 20 },
  ghosts: { gap: 8, paddingVertical: 6 },
  ghost: { height: 18, borderRadius: 6 },
  step: { flexDirection: "row", alignItems: "flex-start", minHeight: 40 },
  proposed: { width: 16, height: 16, borderRadius: 8, borderWidth: 1.5, borderStyle: "dashed", marginTop: 11, marginRight: 10, opacity: 0.6 },
  stepText: { flex: 1, fontFamily: fonts.regular, fontSize: 16, lineHeight: 22, paddingTop: 8, paddingBottom: 8 },
  leaveOut: { width: 36, minHeight: 38, alignItems: "center", justifyContent: "center" },
  note: { fontFamily: fonts.regular, fontSize: 14, lineHeight: 20, paddingVertical: 4 },
  actions: { flexDirection: "row", flexWrap: "wrap", gap: 8, paddingTop: 8 },
  model: { fontFamily: fonts.regular, fontSize: 12, lineHeight: 16, paddingTop: 8, textAlign: "right" },
});
