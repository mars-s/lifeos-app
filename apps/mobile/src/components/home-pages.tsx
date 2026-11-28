import { Host, Picker, Text } from "@expo/ui/swift-ui";
import { accessibilityLabel, pickerStyle, tag } from "@expo/ui/swift-ui/modifiers";
import { Stack } from "expo-router";
import { TopTabs, type MaterialTopTabBarProps } from "expo-router/js-top-tabs";
import { useHeaderHeight } from "expo-router/react-navigation";
import { Schema } from "effect";
import { Atom } from "effect/reactivity";
import { createContext, use, useEffect, useMemo, useRef, useState } from "react";
import { StyleSheet, View } from "react-native";
import { useReducedMotion } from "react-native-reanimated";
import { prefsRuntime, registry } from "@/lib/atoms";
import { useCounts } from "@/components/tabs-layout";
import { haptic } from "@/lib/haptics";
import { useKit } from "@/lib/kit";
import { LIST_TITLES } from "@/lib/route";
import { setFace, useFace } from "@/lib/timeline";
import { CalendarDays, List } from "lucide-react-native";
import { Pressable } from "react-native";

const KEPT_PAGE = "home-page";
const BAR_GAP = 4;

const keptPageAtom = Atom.kvs({
  runtime: prefsRuntime,
  key: KEPT_PAGE,
  schema: Schema.NullOr(Schema.String),
  defaultValue: () => null,
}).pipe(Atom.keepAlive);

const keptPage = registry.get(keptPageAtom);

const keepPage = (name: string) => registry.set(keptPageAtom, name);

const Shown = createContext({ settle: () => undefined as void, show: (_page: string) => undefined as void });

const PageSwitch = ({ state, navigateToTab }: MaterialTopTabBarProps) => {
  const { colors } = useKit();
  const { settle, show } = use(Shown);
  const settled = useRef(false);
  const inbox = useCounts()?.inbox ?? 0;
  const header = useHeaderHeight();
  const shown = useRef(state.index);
  const restoring = useRef(false);

  useEffect(() => {
    if (settled.current) return;
    settled.current = true;
    const target = state.routes.find((route) => route.name === keptPage);
    if (state.index === 0 && target && target !== state.routes[0]) {
      restoring.current = true;
      navigateToTab(target.key);
    }
    requestAnimationFrame(settle);
  }, [state, navigateToTab, settle]);

  useEffect(() => {
    const route = state.routes[state.index];
    if (route) show(route.name);
  }, [state.index, state.routes, show]);

  useEffect(() => {
    if (shown.current === state.index) return;
    shown.current = state.index;
    if (restoring.current) restoring.current = false;
    else haptic("snap");
    const route = state.routes[state.index];
    if (route) keepPage(route.name);
  }, [state.index, state.routes]);

  return (
    <View style={[styles.bar, { paddingTop: header + BAR_GAP, backgroundColor: colors.background }]}>
      <Host matchContents={{ vertical: true }} style={styles.switch}>
        <Picker
          modifiers={[pickerStyle("segmented"), accessibilityLabel("Today or Inbox")]}
          selection={state.routes[state.index]?.key}
          onSelectionChange={navigateToTab}
        >
          {state.routes.map((route) => (
            <Text key={route.key} modifiers={[tag(route.key)]}>
              {route.name === "inbox" ? (inbox > 0 ? `${LIST_TITLES.inbox} ${inbox}` : LIST_TITLES.inbox) : LIST_TITLES.today}
            </Text>
          ))}
        </Picker>
      </Host>
    </View>
  );
};

const renderSwitch = (props: MaterialTopTabBarProps) => <PageSwitch {...props} />;

const FaceSwitch = () => {
  const { colors } = useKit();
  const face = useFace();
  const Icon = face === "timeline" ? List : CalendarDays;
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={face === "timeline" ? "Show the list" : "Show the timeline"}
      hitSlop={10}
      onPress={() => {
        haptic("toggle");
        setFace(face === "timeline" ? "list" : "timeline");
      }}
      style={styles.faceButton}
    >
      <Icon size={21} color={colors.foreground} strokeWidth={1.75} />
    </Pressable>
  );
};

const faceSwitch = () => <FaceSwitch />;

export const HomePages = () => {
  const { colors } = useKit();
  const reduced = useReducedMotion();
  const [settled, setSettled] = useState(false);
  const [page, setPage] = useState(keptPage);
  const shown = useMemo(() => ({ settle: () => setSettled(true), show: setPage }), []);
  const title = page === "inbox" ? LIST_TITLES.inbox : LIST_TITLES.today;
  return (
    <>
      <Stack.Screen options={{ title, ...(page === "inbox" ? {} : { headerRight: faceSwitch }) }} />
      <Shown value={shown}>
        <TopTabs tabBar={renderSwitch} screenOptions={{ animationEnabled: settled && !reduced, sceneStyle: { backgroundColor: colors.background } }}>
          <TopTabs.Screen name="index" />
          <TopTabs.Screen name="inbox" />
        </TopTabs>
      </Shown>
    </>
  );
};

const styles = StyleSheet.create({
  bar: { paddingHorizontal: 16, paddingBottom: 8 },
  switch: { width: "100%" },
  faceButton: { width: 36, height: 36, alignItems: "center", justifyContent: "center" },
});
