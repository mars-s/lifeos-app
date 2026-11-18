import { useQuery } from "convex/react";
import { Circle, Star } from "lucide-react-native";
import { useState } from "react";
import { ScrollView, StyleSheet, Text, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { api } from "@lifeos/backend/api";
import { localIsoDate } from "@lifeos/backend/date";
import { deserialise } from "@lifeos/backend/result";
import type { TodayTask } from "@lifeos/backend/types";
import { Card, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { ListItem, ListSection } from "@/components/ui/list-item";
import { Skeleton } from "@/components/ui/skeleton";
import { SignOutButton } from "@/components/owner-gate";
import { convex } from "@/lib/convex";
import { useKit } from "@/lib/kit";
import { fonts } from "@/lib/kit-theme";

const greetingFor = (hour: number) =>
  hour < 12 ? "Good morning" : hour < 18 ? "Good afternoon" : "Good evening";

const longDate = (now: Date) =>
  new Intl.DateTimeFormat("en-AU", { weekday: "long", day: "numeric", month: "long" }).format(now);

export const TodayScreen = () => {
  const { colors, text } = useKit();
  const insets = useSafeAreaInsets();
  const [now] = useState(() => new Date());
  return (
    <ScrollView contentContainerStyle={[styles.page, { paddingTop: insets.top + 40 }]}>
      <View style={styles.titleRow}>
        <Star size={24} color={colors.warning} fill={colors.warning} strokeWidth={1.5} />
        <Text style={[text.xxl, styles.title, { color: colors.foreground }]}>Today</Text>
        {convex ? (
          <View style={styles.signOut}>
            <SignOutButton />
          </View>
        ) : null}
      </View>
      <Text style={[text.sm, styles.subtitle, { color: colors.mutedForeground }]}>
        {greetingFor(now.getHours())}, Avi. {longDate(now)}.
      </Text>
      {convex ? <TodayTasks date={localIsoDate(now)} /> : <SetupNotice />}
    </ScrollView>
  );
};

const TodayTasks = ({ date }: { date: string }) => {
  const { colors, text } = useKit();
  const response = useQuery(api.planner.today.get, { date });
  if (response === undefined) return <LoadingRows />;
  const content = deserialise(response).match(
    ({ tasks, evening }) =>
      tasks.length + evening.length === 0 ? (
        <Text style={[text.sm, styles.body, { color: colors.mutedForeground }]}>Nothing in Today. Enjoy the space.</Text>
      ) : (
        <>
          <ListSection>
            {tasks.map((task) => (
              <TaskRow key={task._id} task={task} />
            ))}
          </ListSection>
          {evening.length > 0 ? (
            <ListSection header="This Evening">
              {evening.map((task) => (
                <TaskRow key={task._id} task={task} />
              ))}
            </ListSection>
          ) : null}
        </>
      ),
    (error) => (
      <Text style={[text.sm, styles.body, { color: colors.danger }]}>Could not read the date {error.input}.</Text>
    ),
  );
  return (
    <>
      {content}
      <SyncNote />
    </>
  );
};

const clockTime = (ms: number) =>
  new Intl.DateTimeFormat("en-AU", { hour: "numeric", minute: "2-digit" }).format(new Date(ms));

const SyncNote = () => {
  const { colors, text } = useKit();
  const status = useQuery(api.planner.things.status);
  if (status === undefined || status?.retiredAt !== undefined) return null;
  return (
    <Text style={[text.xs, styles.note, { color: colors.mutedForeground }]}>
      {status ? `Synced from Things at ${clockTime(status.syncedAt)}.` : "Not synced from Things yet."}
    </Text>
  );
};

const TaskRow = ({ task }: { task: TodayTask }) => {
  const { colors } = useKit();
  return (
    <ListItem
      title={task.title}
      value={task.context}
      leading={<Circle size={20} color={colors.mutedForeground} strokeWidth={1.5} />}
      accessibilityLabel={task.context ? `${task.title}, ${task.context}` : task.title}
      chevron={false}
    />
  );
};

const LoadingRows = () => (
  <View style={styles.loading}>
    {[0, 1, 2].map((row) => (
      <Skeleton key={row} height={20} width={row === 1 ? "60%" : "80%"} radius="capsule" />
    ))}
  </View>
);

const SetupNotice = () => (
  <Card variant="outline">
    <CardHeader>
      <CardTitle>Convex is not connected yet</CardTitle>
      <CardDescription>Set EXPO_PUBLIC_CONVEX_URL in apps/mobile/.env.local, then restart Expo.</CardDescription>
    </CardHeader>
  </Card>
);

const styles = StyleSheet.create({
  page: { paddingHorizontal: 20, paddingBottom: 48 },
  titleRow: { flexDirection: "row", alignItems: "center", gap: 10, paddingHorizontal: 4 },
  title: { fontFamily: fonts.semibold },
  signOut: { marginLeft: "auto" },
  subtitle: { fontFamily: fonts.regular, marginTop: 6, marginBottom: 24, paddingHorizontal: 4 },
  body: { fontFamily: fonts.regular, paddingHorizontal: 4 },
  loading: { gap: 18, paddingHorizontal: 4, paddingTop: 8 },
  note: { fontFamily: fonts.regular, marginTop: 32, paddingHorizontal: 4 },
});
