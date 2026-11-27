import { useLocalSearchParams, useRouter } from "expo-router";
import { Plus } from "lucide-react-native";
import { useMemo, useState, type ReactNode } from "react";
import { Pressable, ScrollView, StyleSheet, Text, View } from "react-native";
import { api } from "@lifeos/backend/api";
import type { Id } from "@lifeos/backend/dataModel";
import { projectNote, titleKey } from "@lifeos/notes/markdown";
import { Toaster } from "@/components/ui/toast";
import { SegmentedControl } from "@/components/ui/segmented-control";
import { convex } from "@/lib/convex";
import { useKit } from "@/lib/kit";
import { fonts, usePlanner } from "@/lib/kit-theme";
import { useChips, useDocText, useNoteItems, useSidebar, type NoteItem } from "@/lib/notes/data";
import { newDocId, openNote, textOf } from "@/lib/notes/library";
import { areaHref, noteHref, projectHref, taskHref } from "@/lib/route";
import { useView } from "@/lib/views";

const Row = ({ onPress, children }: { onPress: () => void; children: ReactNode }) => {
  const { dark } = useKit();
  return (
    <Pressable accessibilityRole="button" onPress={onPress} style={({ pressed }) => [styles.row, pressed ? { backgroundColor: dark ? "#ffffff0d" : "#0000000a" } : null]}>
      {children}
    </Pressable>
  );
};

const Empty = ({ children }: { children: string }) => {
  const { colors } = useKit();
  return <Text style={[styles.empty, { color: colors.mutedForeground }]}>{children}</Text>;
};

const Heading = ({ children, count }: { children: string; count: number }) => {
  const { colors } = useKit();
  const tones = usePlanner();
  return (
    <View style={styles.heading}>
      <Text style={[styles.headingText, { color: tones.faintForeground }]}>{children}</Text>
      <Text style={[styles.headingCount, { color: colors.mutedForeground }]}>{count}</Text>
    </View>
  );
};

export const LinksSheet = () => {
  const { id } = useLocalSearchParams<{ id: string }>();
  const docId = id ?? "";
  const { colors } = useKit();
  const tones = usePlanner();
  const router = useRouter();
  const [tab, setTab] = useState("from");
  const sidebar = useSidebar();
  const items = useNoteItems(sidebar);
  const text = useDocText(openNote(docId).doc);
  const chips = useChips(text);
  const links = useView(api.notes.notes.links, convex ? { docId } : "skip");
  const projection = useMemo(() => projectNote(text), [text]);
  const chipOf = (entityId: string) => chips.find((chip) => chip.id === entityId);
  const known = new Set(items.map((item) => titleKey(item.title)));
  const missing = projection.noteTitles.filter((title) => !known.has(titleKey(title)));
  const linkedNotes = projection.noteTitles.map((title) => items.find((item) => titleKey(item.title) === titleKey(title))).filter((item): item is NoteItem => item !== undefined);
  const tasks = projection.entities.filter((entity) => entity.table === "tasks");
  const others = projection.entities.filter((entity) => entity.table !== "tasks");
  const linkedFrom = links?.linkedFrom ?? [];

  const goNote = (target: string) => {
    router.dismiss();
    router.push(noteHref(target));
  };
  const goEntity = (table: "tasks" | "projects" | "areas", entityId: string) => {
    router.dismiss();
    router.push(table === "tasks" ? taskHref(entityId as Id<"tasks">) : table === "projects" ? projectHref(entityId as Id<"projects">) : areaHref(entityId as Id<"areas">));
  };
  const create = (title: string) => {
    const created = newDocId();
    const { doc, ready } = openNote(created);
    void ready.then(() => {
      doc.transact(() => textOf(doc).insert(0, `${title}\n`));
      router.dismiss();
      router.push({ pathname: "/notes/[id]", params: { id: created, fresh: "1" } });
    });
  };

  return (
    <View collapsable={false} style={styles.sheet}>
      <View style={styles.head}>
        <Text style={[styles.title, { color: colors.foreground }]}>Links</Text>
      </View>
      <View style={styles.switch}>
        <SegmentedControl
          accessibilityLabel="Which links"
          value={tab}
          onValueChange={setTab}
          options={[
            { value: "from", label: "Linked from" },
            { value: "out", label: "Links out" },
          ]}
        />
      </View>
      <ScrollView contentContainerStyle={styles.list} showsVerticalScrollIndicator={false}>
        {tab === "from" ? (
          <>
            {tasks.length > 0 ? (
              <>
                <Heading count={tasks.length}>Tasks</Heading>
                {tasks.map((task) => (
                  <Row key={task.id} onPress={() => goEntity("tasks", task.id)}>
                    <Text numberOfLines={1} style={[styles.rowTitle, { color: colors.foreground }, chipOf(task.id)?.done ? styles.struck : null]}>
                      {chipOf(task.id)?.title ?? task.alias ?? "Task"}
                    </Text>
                  </Row>
                ))}
              </>
            ) : null}
            <Heading count={linkedFrom.length}>Linked from</Heading>
            {linkedFrom.length === 0 ? <Empty>Nothing links here yet. Type [[ in another note to connect it.</Empty> : null}
            {linkedFrom.map((note) => (
              <Row key={note.docId} onPress={() => goNote(note.docId)}>
                <Text numberOfLines={1} style={[styles.rowTitle, { color: colors.foreground }]}>
                  {note.title}
                </Text>
                {note.excerpt ? (
                  <Text numberOfLines={2} style={[styles.rowMeta, { color: colors.mutedForeground }]}>
                    {note.excerpt}
                  </Text>
                ) : null}
              </Row>
            ))}
          </>
        ) : (
          <>
            <Heading count={linkedNotes.length + others.length + missing.length}>Links out</Heading>
            {linkedNotes.length + others.length + missing.length === 0 ? <Empty>This note does not link anywhere yet.</Empty> : null}
            {linkedNotes.map((note) => (
              <Row key={note.docId} onPress={() => goNote(note.docId)}>
                <Text numberOfLines={1} style={[styles.rowTitle, { color: colors.foreground }]}>
                  {note.title}
                </Text>
              </Row>
            ))}
            {others.map((entity) => {
              const info = chipOf(entity.id);
              return (
                <Row key={entity.id} onPress={() => goEntity(entity.table, entity.id)}>
                  <View style={styles.rowLine}>
                    <View style={[styles.dot, { backgroundColor: info?.colour ? tones.area[info.colour as keyof typeof tones.area] : tones.faintForeground }]} />
                    <Text numberOfLines={1} style={[styles.rowTitle, styles.grow, { color: colors.foreground }]}>
                      {info?.title ?? entity.alias ?? (entity.table === "projects" ? "Project" : "Area")}
                    </Text>
                    <Text style={[styles.rowMeta, { color: tones.faintForeground }]}>{entity.table === "projects" ? "Project" : "Area"}</Text>
                  </View>
                </Row>
              );
            })}
            {missing.map((title) => (
              <Row key={title} onPress={() => create(title)}>
                <View style={styles.rowLine}>
                  <Text numberOfLines={1} style={[styles.rowTitle, styles.grow, styles.dashed, { color: colors.mutedForeground }]}>
                    {title}
                  </Text>
                  <Plus size={14} color={tones.faintForeground} strokeWidth={2.5} />
                  <Text style={[styles.rowMeta, { color: tones.faintForeground }]}>Create</Text>
                </View>
              </Row>
            ))}
          </>
        )}
      </ScrollView>
      <Toaster variant="minimal" position="bottom" safeArea />
    </View>
  );
};

const styles = StyleSheet.create({
  sheet: { flex: 1, paddingTop: 12 },
  head: { paddingHorizontal: 24, paddingTop: 8 },
  title: { fontFamily: fonts.semibold, fontSize: 18 },
  switch: { paddingHorizontal: 16, paddingTop: 12 },
  list: { paddingHorizontal: 12, paddingTop: 12, paddingBottom: 48 },
  heading: { flexDirection: "row", justifyContent: "space-between", paddingHorizontal: 12, paddingVertical: 6 },
  headingText: { fontFamily: fonts.medium, fontSize: 13 },
  headingCount: { fontFamily: fonts.mono, fontSize: 13 },
  row: { paddingVertical: 11, paddingHorizontal: 12, borderRadius: 14, borderCurve: "continuous", gap: 2 },
  rowLine: { flexDirection: "row", alignItems: "center", gap: 10 },
  rowTitle: { fontFamily: fonts.medium, fontSize: 16, lineHeight: 21 },
  rowMeta: { fontFamily: fonts.regular, fontSize: 13, lineHeight: 18 },
  grow: { flex: 1 },
  struck: { textDecorationLine: "line-through", opacity: 0.55 },
  dashed: { textDecorationLine: "underline", textDecorationStyle: "dashed" },
  dot: { width: 8, height: 8, borderRadius: 4 },
  empty: { fontFamily: fonts.regular, fontSize: 14, lineHeight: 20, paddingHorizontal: 12, paddingBottom: 12 },
});
