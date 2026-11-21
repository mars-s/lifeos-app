import { Stack, useRouter, type Href } from "expo-router";
import { ChevronRight, Flag } from "lucide-react-native";
import type { ReactNode } from "react";
import { Pressable, StyleSheet, Text, View } from "react-native";
import Animated, { LinearTransition } from "react-native-reanimated";
import type { PlannerTask } from "@lifeos/backend/types";
import { Skeleton } from "@/components/ui/skeleton";
import { ProgressRing } from "@/components/progress-ring";
import { TaskRow, type RowHint } from "@/components/task-row";
import { useKit } from "@/lib/kit";
import { fonts, usePlanner } from "@/lib/kit-theme";
import { BASE_MS, EASE_OUT } from "@/lib/motion";
import { taskHref } from "@/lib/route";
import { rememberTask } from "@/lib/tasks";

export type ListItem =
  | { kind: "task"; key: string; task: PlannerTask; hint?: RowHint }
  | { kind: "header"; key: string; title: string; detail?: string; lead?: string; colour?: string }
  | { kind: "project"; key: string; title: string; href: Href; done: number; total: number; colour?: string }
  | { kind: "deadline"; key: string; task: PlannerTask }
  | { kind: "note"; key: string; text: string };

const settle = LinearTransition.duration(BASE_MS).easing(EASE_OUT);

export const taskItems = (tasks: readonly PlannerTask[], hint?: RowHint) =>
  tasks.map((task) => ({ kind: "task", key: task._id, task, ...(hint ? { hint } : {}) }) satisfies ListItem);

const Header = ({ item }: { item: Extract<ListItem, { kind: "header" }> }) => {
  const { colors } = useKit();
  const tones = usePlanner();
  return (
    <View style={styles.header}>
      {item.lead ? <Text style={[styles.lead, { color: colors.foreground }]}>{item.lead}</Text> : null}
      {item.colour ? <View style={[styles.dot, { backgroundColor: item.colour }]} /> : null}
      <Text accessibilityRole="header" style={[styles.headerTitle, { color: colors.foreground }]}>
        {item.title}
      </Text>
      {item.detail ? <Text style={[styles.detail, { color: tones.faintForeground }]}>{item.detail}</Text> : null}
    </View>
  );
};

const ProjectLink = ({ item }: { item: Extract<ListItem, { kind: "project" }> }) => {
  const { colors } = useKit();
  const tones = usePlanner();
  const router = useRouter();
  return (
      <Pressable accessibilityRole="link" onPress={() => router.push(item.href)} style={({ pressed }) => [styles.project, pressed ? { backgroundColor: tones.surface } : null]}>
        <ProgressRing value={item.total === 0 ? 0 : item.done / item.total} colour={item.colour ?? colors.mutedForeground} />
        <Text numberOfLines={1} style={[styles.projectTitle, { color: colors.foreground }]}>
          {item.title}
        </Text>
        <Text style={[styles.count, { color: tones.faintForeground }]}>
          {item.done}/{item.total}
        </Text>
        <ChevronRight size={16} color={tones.faintForeground} />
      </Pressable>
  );
};

const DeadlineRow = ({ task }: { task: PlannerTask }) => {
  const tones = usePlanner();
  const router = useRouter();
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={`Deadline: ${task.title}`}
      onPressIn={() => rememberTask(task)}
      onPress={() => router.push(taskHref(task._id))}
      style={({ pressed }) => [styles.due, pressed ? { backgroundColor: tones.surface } : null]}
    >
      <Flag size={14} color={tones.deadline} fill={tones.deadline} />
      <Text numberOfLines={1} style={[styles.dueTitle, { color: tones.deadline }]}>
        {task.title}
      </Text>
    </Pressable>
  );
};

const Loading = () => (
  <View style={styles.loading}>
    {[0, 1, 2, 3].map((row) => (
      <Skeleton key={row} height={18} width={row % 2 === 1 ? "56%" : "78%"} radius="capsule" />
    ))}
  </View>
);

export const EmptyNote = ({ title, body }: { title: string; body: string }) => {
  const { colors } = useKit();
  const tones = usePlanner();
  return (
    <View style={styles.empty}>
      <Text style={[styles.emptyTitle, { color: colors.mutedForeground }]}>{title}</Text>
      <Text style={[styles.emptyBody, { color: tones.faintForeground }]}>{body}</Text>
    </View>
  );
};

export const TaskList = ({
  title,
  items,
  today,
  empty,
  top,
  onEndReached,
}: {
  title: string;
  items: readonly ListItem[] | undefined;
  today: string;
  empty: ReactNode;
  top?: ReactNode;
  onEndReached?: () => void;
}) => {
  const { colors } = useKit();
  const tones = usePlanner();
  return (
    <>
      <Stack.Screen options={{ title }} />
      <Animated.FlatList
        data={items ?? []}
        keyExtractor={(item) => item.key}
        renderItem={({ item }) =>
          item.kind === "task" ? (
            <TaskRow task={item.task} today={today} {...(item.hint ? { hint: item.hint } : {})} />
          ) : item.kind === "header" ? (
            <Header item={item} />
          ) : item.kind === "project" ? (
            <ProjectLink item={item} />
          ) : item.kind === "deadline" ? (
            <DeadlineRow task={item.task} />
          ) : (
            <Text style={[styles.note, { color: tones.faintForeground }]}>{item.text}</Text>
          )
        }
        itemLayoutAnimation={settle}
        contentInsetAdjustmentBehavior="automatic"
        keyboardDismissMode="on-drag"
        {...(top ? { ListHeaderComponent: <>{top}</> } : {})}
        ListEmptyComponent={items === undefined ? <Loading /> : <>{empty}</>}
        contentContainerStyle={styles.content}
        style={{ backgroundColor: colors.background }}
        {...(onEndReached ? { onEndReached, onEndReachedThreshold: 0.6 } : {})}
      />
    </>
  );
};

const styles = StyleSheet.create({
  content: { paddingBottom: 120, paddingTop: 4 },
  header: { flexDirection: "row", alignItems: "baseline", gap: 8, paddingHorizontal: 20, paddingTop: 22, paddingBottom: 6 },
  lead: { fontFamily: fonts.semibold, fontSize: 24, lineHeight: 28, letterSpacing: -0.5, fontVariant: ["tabular-nums"] },
  dot: { width: 9, height: 9, borderRadius: 5, alignSelf: "center" },
  headerTitle: { fontFamily: fonts.semibold, fontSize: 15, lineHeight: 22 },
  detail: { fontFamily: fonts.regular, fontSize: 13, lineHeight: 22 },
  project: { flexDirection: "row", alignItems: "center", gap: 12, paddingHorizontal: 20, minHeight: 48 },
  projectTitle: { flex: 1, fontFamily: fonts.medium, fontSize: 17, lineHeight: 24, letterSpacing: -0.2 },
  count: { fontFamily: fonts.mono, fontSize: 12 },
  due: { flexDirection: "row", alignItems: "center", gap: 10, minHeight: 44, paddingLeft: 24, paddingRight: 20 },
  dueTitle: { flex: 1, fontFamily: fonts.medium, fontSize: 15, lineHeight: 22 },
  note: { fontFamily: fonts.regular, fontSize: 13, lineHeight: 18, paddingHorizontal: 20, paddingVertical: 10 },
  loading: { gap: 22, paddingHorizontal: 20, paddingTop: 18 },
  empty: { paddingHorizontal: 20, paddingTop: 56, gap: 6, alignItems: "center" },
  emptyTitle: { fontFamily: fonts.medium, fontSize: 17, lineHeight: 24 },
  emptyBody: { fontFamily: fonts.regular, fontSize: 14, lineHeight: 20, textAlign: "center" },
});
