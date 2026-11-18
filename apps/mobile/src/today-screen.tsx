import { useQuery } from "convex/react";
import { Circle, CircleCheck, Star } from "lucide-react-native";
import { useState } from "react";
import { ScrollView, StyleSheet, Text, View } from "react-native";
import { api } from "@lifeos/backend/api";
import { localIsoDate } from "@lifeos/backend/date";
import type { Doc } from "@lifeos/backend/dataModel";
import { deserialise } from "@lifeos/backend/result";
import { fonts, type Palette } from "./theme";

const greetingFor = (hour: number) =>
  hour < 12 ? "Good morning" : hour < 18 ? "Good afternoon" : "Good evening";

const longDate = (now: Date) =>
  new Intl.DateTimeFormat("en-AU", { weekday: "long", day: "numeric", month: "long" }).format(now);

export const TodayScreen = ({ colours, connected }: { colours: Palette; connected: boolean }) => {
  const [now] = useState(() => new Date());
  const styles = makeStyles(colours);
  return (
    <ScrollView contentContainerStyle={styles.page}>
      <View style={styles.titleRow}>
        <Star size={24} color={colours.star} fill={colours.star} strokeWidth={1.5} />
        <Text style={styles.title}>Today</Text>
      </View>
      <Text style={styles.subtitle}>
        {greetingFor(now.getHours())}, Avi. {longDate(now)}.
      </Text>
      {connected ? (
        <TodayTasks date={localIsoDate(now)} colours={colours} />
      ) : (
        <Text style={styles.muted}>Set EXPO_PUBLIC_CONVEX_URL in apps/mobile/.env.local to see your tasks.</Text>
      )}
    </ScrollView>
  );
};

const TodayTasks = ({ date, colours }: { date: string; colours: Palette }) => {
  const styles = makeStyles(colours);
  const response = useQuery(api.today.get, { date });
  if (response === undefined) return <Text style={styles.muted}>Loading…</Text>;
  return deserialise(response).match(
    ({ tasks }) =>
      tasks.length === 0 ? (
        <Text style={styles.muted}>Nothing planned. Enjoy the space.</Text>
      ) : (
        <View>
          {tasks.map((task) => (
            <TaskRow key={task._id} task={task} colours={colours} />
          ))}
        </View>
      ),
    (error) => <Text style={styles.muted}>Could not read the date {error.input}.</Text>,
  );
};

const TaskRow = ({ task, colours }: { task: Doc<"tasks">; colours: Palette }) => {
  const styles = makeStyles(colours);
  const done = task.status === "done";
  const Icon = done ? CircleCheck : Circle;
  return (
    <View style={styles.row}>
      <Icon size={20} color={colours.muted} strokeWidth={1.5} />
      <Text style={[styles.taskTitle, done && styles.done]} numberOfLines={2}>
        {task.title}
      </Text>
      {task.area ? <Text style={styles.area}>{task.area}</Text> : null}
    </View>
  );
};

const makeStyles = (colours: Palette) =>
  StyleSheet.create({
    page: { paddingHorizontal: 24, paddingTop: 72, paddingBottom: 48, gap: 4 },
    titleRow: { flexDirection: "row", alignItems: "center", gap: 10 },
    title: { fontFamily: fonts.semibold, fontSize: 30, letterSpacing: -0.5, color: colours.foreground },
    subtitle: { fontFamily: fonts.regular, fontSize: 14, color: colours.muted, marginTop: 6, marginBottom: 28 },
    muted: { fontFamily: fonts.regular, fontSize: 14, color: colours.muted },
    row: {
      flexDirection: "row",
      alignItems: "center",
      gap: 12,
      paddingVertical: 14,
      borderBottomWidth: StyleSheet.hairlineWidth,
      borderBottomColor: colours.border,
    },
    taskTitle: { flex: 1, fontFamily: fonts.regular, fontSize: 16, color: colours.foreground },
    done: { color: colours.muted, textDecorationLine: "line-through" },
    area: { fontFamily: fonts.regular, fontSize: 12, color: colours.muted },
  });
