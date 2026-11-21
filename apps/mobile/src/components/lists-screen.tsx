import { useAuthActions } from "@convex-dev/auth/react";
import { Stack, useRouter, type Href } from "expo-router";
import { Archive, BookCheck, Layers, LogOut, type LucideIcon } from "lucide-react-native";
import type { ReactNode } from "react";
import { Alert, Pressable, ScrollView, StyleSheet, Text, View } from "react-native";
import { api } from "@lifeos/backend/api";
import type { SidebarView } from "@lifeos/backend/types";
import { ProgressRing } from "@/components/progress-ring";
import { convex } from "@/lib/convex";
import { useKit } from "@/lib/kit";
import { fonts, usePlanner } from "@/lib/kit-theme";
import { LIST_TITLES, areaHref, listHref, projectHref, type ListKind } from "@/lib/route";
import { useLocalDate, useView, valueOf } from "@/lib/views";

const LIST_ICONS = {
  anytime: Layers,
  someday: Archive,
  logbook: BookCheck,
} as const satisfies Record<ListKind, LucideIcon>;

const Row = ({ href, leading, title, strong }: { href: Href; leading: ReactNode; title: string; strong?: boolean }) => {
  const { colors } = useKit();
  const tones = usePlanner();
  const router = useRouter();
  return (
    <Pressable accessibilityRole="link" onPress={() => router.push(href)} style={({ pressed }) => [styles.row, pressed ? { backgroundColor: tones.surface } : null]}>
      <View style={styles.leading}>{leading}</View>
      <Text numberOfLines={1} style={[styles.rowTitle, strong ? styles.strong : null, { color: colors.foreground }]}>
        {title}
      </Text>
    </Pressable>
  );
};

const ListRow = ({ kind }: { kind: ListKind }) => {
  const { colors } = useKit();
  const Icon = LIST_ICONS[kind];
  return <Row href={listHref(kind)} leading={<Icon size={22} color={colors.mutedForeground} strokeWidth={1.75} />} title={LIST_TITLES[kind]} />;
};

const ProjectRow = ({ project, colour }: { project: SidebarView["projects"][number]; colour: string }) => (
  <Row
    href={projectHref(project._id)}
    leading={<ProgressRing value={project.progress.total === 0 ? 0 : project.progress.done / project.progress.total} colour={colour} />}
    title={project.title}
  />
);

const Containers = ({ sidebar }: { sidebar: SidebarView }) => {
  const { colors } = useKit();
  const tones = usePlanner();
  return (
    <>
      {sidebar.projects.length > 0 ? (
        <View style={styles.group}>
          {sidebar.projects.map((project) => (
            <ProjectRow key={project._id} project={project} colour={colors.mutedForeground} />
          ))}
        </View>
      ) : null}
      {sidebar.areas.map((area) => (
        <View key={area._id} style={styles.group}>
          <Row href={areaHref(area._id)} leading={<View style={[styles.areaDot, { backgroundColor: tones.area[area.colour] }]} />} title={area.title} strong />
          {area.projects.map((project) => (
            <ProjectRow key={project._id} project={project} colour={tones.area[area.colour]} />
          ))}
        </View>
      ))}
    </>
  );
};

const SignOut = () => {
  const { colors } = useKit();
  const { signOut } = useAuthActions();
  const ask = () =>
    Alert.alert("Sign out of LifeOS?", "Your Tasks stay safe. Sign in again any time.", [
      { text: "Cancel", style: "cancel" },
      { text: "Sign out", style: "destructive", onPress: () => void signOut() },
    ]);
  return (
    <Pressable accessibilityRole="button" accessibilityLabel="Sign out" hitSlop={10} onPress={ask} style={styles.signOut}>
      <LogOut size={20} color={colors.foreground} strokeWidth={1.75} />
    </Pressable>
  );
};

const signOutButton = () => <SignOut />;

const Lists = () => {
  const today = useLocalDate();
  const sidebar = valueOf(useView(api.planner.sidebar.get, { date: today }));
  useView(api.planner.lists.anytime, { date: today });
  return (
    <>
      <View style={styles.group}>
        <ListRow kind="anytime" />
        <ListRow kind="someday" />
        <ListRow kind="logbook" />
      </View>
      {sidebar ? <Containers sidebar={sidebar} /> : null}
    </>
  );
};

export const ListsScreen = () => {
  const { colors } = useKit();
  return (
    <>
      <Stack.Screen options={{ title: "Lists", ...(convex ? { headerRight: signOutButton } : {}) }} />
      <ScrollView contentInsetAdjustmentBehavior="automatic" style={{ backgroundColor: colors.background }} contentContainerStyle={styles.page}>
        {convex ? (
          <Lists />
        ) : (
          <Text style={[styles.setup, { color: colors.mutedForeground }]}>
            Convex is not connected yet. Set EXPO_PUBLIC_CONVEX_URL in apps/mobile/.env.local, then restart Expo.
          </Text>
        )}
      </ScrollView>
    </>
  );
};

const styles = StyleSheet.create({
  page: { paddingHorizontal: 8, paddingBottom: 140 },
  group: { paddingVertical: 8 },
  row: { flexDirection: "row", alignItems: "center", gap: 14, minHeight: 46, paddingHorizontal: 12, borderRadius: 12 },
  leading: { width: 24, alignItems: "center" },
  rowTitle: { flex: 1, fontFamily: fonts.regular, fontSize: 17, lineHeight: 24, letterSpacing: -0.2 },
  strong: { fontFamily: fonts.semibold },
  areaDot: { width: 12, height: 12, borderRadius: 6 },
  signOut: { width: 36, height: 36, alignItems: "center", justifyContent: "center" },
  setup: { fontFamily: fonts.regular, fontSize: 14, lineHeight: 20, paddingHorizontal: 12, paddingTop: 12 },
});
