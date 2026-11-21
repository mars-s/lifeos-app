import { useAuthActions } from "@convex-dev/auth/react";
import { useRouter, type Href } from "expo-router";
import { Archive, BookCheck, CalendarDays, Inbox, Layers, LogOut, Star, type LucideIcon } from "lucide-react-native";
import type { ReactNode } from "react";
import { Alert, Pressable, ScrollView, StyleSheet, Text, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { api } from "@lifeos/backend/api";
import { longDay } from "@lifeos/backend/client/dates";
import type { SidebarView } from "@lifeos/backend/types";
import { LifeosMark } from "@/components/lifeos-mark";
import { ProgressRing } from "@/components/progress-ring";
import { convex } from "@/lib/convex";
import { useKit } from "@/lib/kit";
import { fonts, usePlanner } from "@/lib/kit-theme";
import { LIST_TITLES, areaHref, listHref, projectHref, type ListKind } from "@/lib/route";
import { useLocalDate, useView, valueOf } from "@/lib/views";

const LIST_ICONS = {
  inbox: Inbox,
  today: Star,
  upcoming: CalendarDays,
  anytime: Layers,
  someday: Archive,
  logbook: BookCheck,
} as const satisfies Record<ListKind, LucideIcon>;

const Row = ({ href, leading, title, count, strong }: { href: Href; leading: ReactNode; title: string; count?: number; strong?: boolean }) => {
  const { colors } = useKit();
  const tones = usePlanner();
  const router = useRouter();
  return (
    <Pressable
      accessibilityRole="link"
      accessibilityLabel={count ? `${title}, ${count}` : title}
      onPress={() => router.push(href)}
      style={({ pressed }) => [styles.row, pressed ? { backgroundColor: tones.surface } : null]}
    >
      <View style={styles.leading}>{leading}</View>
      <Text numberOfLines={1} style={[styles.rowTitle, strong ? styles.strong : null, { color: colors.foreground }]}>
        {title}
      </Text>
      {count ? <Text style={[styles.count, { color: colors.mutedForeground }]}>{count}</Text> : null}
    </Pressable>
  );
};

const ListRow = ({ kind, count }: { kind: ListKind; count?: number }) => {
  const { colors } = useKit();
  const Icon = LIST_ICONS[kind];
  const tint = kind === "today" ? colors.accent : colors.mutedForeground;
  return (
    <Row
      href={listHref(kind)}
      leading={<Icon size={22} color={tint} strokeWidth={1.75} {...(kind === "today" ? { fill: tint } : {})} />}
      title={LIST_TITLES[kind]}
      {...(count === undefined ? {} : { count })}
    />
  );
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

const useWarmLists = (today: string) => {
  useView(api.planner.lists.inbox, {});
  useView(api.planner.today.get, { date: today });
  useView(api.planner.lists.anytime, { date: today });
};

const SignOut = () => {
  const tones = usePlanner();
  const { signOut } = useAuthActions();
  const ask = () =>
    Alert.alert("Sign out of LifeOS?", "Your Tasks stay safe. Sign in again any time.", [
      { text: "Cancel", style: "cancel" },
      { text: "Sign out", style: "destructive", onPress: () => void signOut() },
    ]);
  return (
    <Pressable accessibilityRole="button" accessibilityLabel="Sign out" hitSlop={14} onPress={ask} style={({ pressed }) => ({ opacity: pressed ? 0.6 : 1 })}>
      <LogOut size={20} color={tones.faintForeground} strokeWidth={1.75} />
    </Pressable>
  );
};

const Lists = () => {
  const today = useLocalDate();
  const sidebar = valueOf(useView(api.planner.sidebar.get, { date: today }));
  useWarmLists(today);
  return (
    <>
      <View style={styles.group}>
        <ListRow kind="inbox" {...(sidebar ? { count: sidebar.counts.inbox } : {})} />
      </View>
      <View style={styles.group}>
        <ListRow kind="today" {...(sidebar ? { count: sidebar.counts.today } : {})} />
        <ListRow kind="upcoming" />
        <ListRow kind="anytime" />
        <ListRow kind="someday" />
      </View>
      <View style={styles.group}>
        <ListRow kind="logbook" />
      </View>
      {sidebar ? <Containers sidebar={sidebar} /> : null}
    </>
  );
};

export const HomeScreen = () => {
  const { colors } = useKit();
  const tones = usePlanner();
  const insets = useSafeAreaInsets();
  const today = useLocalDate();
  return (
    <ScrollView
      style={{ backgroundColor: colors.background }}
      contentContainerStyle={[styles.page, { paddingTop: insets.top + 12, paddingBottom: insets.bottom + 120 }]}
    >
      <View style={styles.top}>
        <LifeosMark size={26} ink={colors.foreground} quiet={tones.surfaceRaised} />
        <View style={styles.titles}>
          <Text accessibilityRole="header" style={[styles.wordmark, { color: colors.foreground }]}>
            LifeOS
          </Text>
          <Text style={[styles.date, { color: colors.mutedForeground }]}>{longDay(today)}</Text>
        </View>
        {convex ? <SignOut /> : null}
      </View>
      {convex ? (
        <Lists />
      ) : (
        <Text style={[styles.setup, { color: colors.mutedForeground }]}>
          Convex is not connected yet. Set EXPO_PUBLIC_CONVEX_URL in apps/mobile/.env.local, then restart Expo.
        </Text>
      )}
    </ScrollView>
  );
};

const styles = StyleSheet.create({
  page: { paddingHorizontal: 8 },
  top: { flexDirection: "row", alignItems: "center", gap: 12, paddingHorizontal: 12, paddingBottom: 18, paddingTop: 8 },
  titles: { flex: 1 },
  wordmark: { fontFamily: fonts.semibold, fontSize: 22, lineHeight: 26, letterSpacing: -0.5 },
  date: { fontFamily: fonts.regular, fontSize: 13, lineHeight: 18 },
  group: { paddingVertical: 8 },
  row: { flexDirection: "row", alignItems: "center", gap: 14, minHeight: 46, paddingHorizontal: 12, borderRadius: 12 },
  leading: { width: 24, alignItems: "center" },
  rowTitle: { flex: 1, fontFamily: fonts.regular, fontSize: 17, lineHeight: 24, letterSpacing: -0.2 },
  strong: { fontFamily: fonts.semibold },
  count: { fontFamily: fonts.mono, fontSize: 14 },
  areaDot: { width: 12, height: 12, borderRadius: 6 },
  setup: { fontFamily: fonts.regular, fontSize: 14, lineHeight: 20, paddingHorizontal: 12 },
});
