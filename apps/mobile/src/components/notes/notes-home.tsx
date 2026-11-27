import { Stack, useRouter } from "expo-router";
import { CalendarDays, NotebookPen } from "lucide-react-native";
import { useEffect, useMemo, useState, type ReactNode } from "react";
import { Pressable, ScrollView, StyleSheet, Text, View } from "react-native";
import type { SidebarView } from "@lifeos/backend/types";
import { Button } from "@/components/button";
import { haptic } from "@/lib/haptics";
import { useKit } from "@/lib/kit";
import { fonts, usePlanner } from "@/lib/kit-theme";
import { dailyDocId, newDocId, openNote, startLibrary, textOf } from "@/lib/notes/library";
import { useNoteItems, useSidebar, type NoteItem } from "@/lib/notes/data";
import { noteHref } from "@/lib/route";
import { useLocalDate } from "@/lib/views";

const edited = (at: number) => {
  const minutes = Math.round((Date.now() - at) / 60_000);
  if (minutes < 1) return "Just now";
  if (minutes < 60) return `${minutes} min ago`;
  const date = new Date(at);
  if (date.toDateString() === new Date().toDateString()) return date.toLocaleTimeString("en-AU", { hour: "numeric", minute: "2-digit" });
  return date.toLocaleDateString("en-AU", { weekday: "short", day: "numeric", month: "short" });
};

const dayWords = (date: string) => new Date(`${date}T12:00:00`).toLocaleDateString("en-AU", { weekday: "short", day: "numeric", month: "short" });

const placeWords = (item: NoteItem, sidebar: SidebarView | undefined) => {
  if (item.day) return "Journal";
  const area = sidebar?.areas.find((entry) => entry._id === item.areaId);
  const project = area?.projects.find((entry) => entry._id === item.projectId);
  return [area?.title, project?.title].filter(Boolean).join(" › ") || "Unfiled";
};

const Label = ({ children }: { children: ReactNode }) => {
  const { colors } = useKit();
  return <Text style={[styles.label, { color: colors.mutedForeground }]}>{children}</Text>;
};

const Group = ({ children }: { children: ReactNode }) => {
  const tones = usePlanner();
  return <View style={[styles.group, { backgroundColor: tones.surfaceInset }]}>{children}</View>;
};

const NoteRow = ({ item, meta, dot, first, onOpen }: { item: NoteItem; meta: string; dot?: string | undefined; first: boolean; onOpen: (docId: string) => void }) => {
  const { colors, dark } = useKit();
  return (
    <Pressable
      accessibilityRole="button"
      onPress={() => onOpen(item.docId)}
      style={({ pressed }) => [styles.row, !first ? { borderTopColor: colors.border, borderTopWidth: StyleSheet.hairlineWidth } : null, pressed ? { backgroundColor: dark ? "#ffffff0d" : "#0000000a" } : null]}
    >
      <View style={styles.rowTop}>
        <Text numberOfLines={1} style={[styles.rowTitle, { color: colors.foreground }]}>
          {item.title}
        </Text>
        {dot ? <View style={[styles.dot, { backgroundColor: dot }]} /> : null}
      </View>
      <Text numberOfLines={1} style={[styles.rowMeta, { color: colors.mutedForeground }]}>
        {meta}
        {item.excerpt ? ` · ${item.excerpt}` : ""}
      </Text>
    </Pressable>
  );
};

const List = ({ items, sidebar, meta, onOpen }: { items: NoteItem[]; sidebar: SidebarView | undefined; meta: (item: NoteItem) => string; onOpen: (docId: string) => void }) => {
  const tones = usePlanner();
  return (
    <Group>
      {items.map((item, index) => {
        const area = sidebar?.areas.find((entry) => entry._id === item.areaId);
        return <NoteRow key={item.docId} item={item} meta={meta(item)} dot={area ? tones.area[area.colour] : undefined} first={index === 0} onOpen={onOpen} />;
      })}
    </Group>
  );
};

export const NotesHome = () => {
  const { colors } = useKit();
  const tones = usePlanner();
  const router = useRouter();
  const today = useLocalDate();
  const sidebar = useSidebar();
  const items = useNoteItems(sidebar);
  const [query, setQuery] = useState("");
  useEffect(() => void startLibrary(), []);

  const writing = useMemo(() => items.filter((item) => !item.day), [items]);
  const wanted = query.trim().toLowerCase();
  const found = wanted ? writing.filter((item) => `${item.title} ${item.excerpt}`.toLowerCase().includes(wanted)) : [];
  const recent = writing.slice(0, 5);
  const todayItem = items.find((item) => item.docId === dailyDocId(today));
  const unfiled = writing.filter((item) => !item.areaId && !item.projectId);
  const areas = (sidebar?.areas ?? []).map((area) => ({ area, notes: writing.filter((item) => item.areaId === area._id) })).filter((branch) => branch.notes.length > 0);

  const open = (docId: string) => router.push(noteHref(docId));
  const create = (title?: string) => {
    const id = newDocId();
    const { doc, ready } = openNote(id);
    void ready.then(() => {
      if (title) doc.transact(() => textOf(doc).insert(0, `${title}\n`));
      router.push({ pathname: "/notes/[id]", params: { id, fresh: "1" } });
    });
  };

  return (
    <>
      <Stack.Screen
        options={{
          title: "Notes",
          headerSearchBarOptions: { placeholder: "Search notes", hideWhenScrolling: false, onChangeText: (event) => setQuery(event.nativeEvent.text), onCancelButtonPress: () => setQuery("") },
        }}
      />
      <ScrollView contentInsetAdjustmentBehavior="automatic" keyboardDismissMode="on-drag" style={{ backgroundColor: colors.background }} contentContainerStyle={styles.page}>
        {wanted ? (
          found.length > 0 ? (
            <>
              <Label>{found.length === 1 ? "1 note" : `${found.length} notes`}</Label>
              <List items={found} sidebar={sidebar} meta={(item) => placeWords(item, sidebar)} onOpen={open} />
            </>
          ) : (
            <View style={styles.none}>
              <Text style={[styles.noneTitle, { color: colors.foreground }]}>No notes match</Text>
              <Text style={[styles.rowMeta, { color: colors.mutedForeground }]}>Nothing has “{query.trim()}” in its title or text.</Text>
              <View style={styles.noneButton}>
                <Button title={`New note “${query.trim()}”`} icon={NotebookPen} onPress={() => create(query.trim())} />
              </View>
            </View>
          )
        ) : (
          <>
            <Pressable
              accessibilityRole="button"
              onPress={() => open(dailyDocId(today))}
              style={({ pressed }) => [styles.today, { backgroundColor: tones.surfaceInset, transform: [{ scale: pressed ? 0.985 : 1 }] }]}
            >
              <View style={styles.rowTop}>
                <CalendarDays size={18} color={colors.accent} />
                <Text style={[styles.todayTitle, { color: colors.foreground }]}>Today</Text>
                <Text style={[styles.rowMeta, { color: colors.mutedForeground }]}>{dayWords(today)}</Text>
              </View>
              <Text numberOfLines={2} style={[styles.excerpt, { color: colors.mutedForeground }]}>
                {todayItem?.excerpt || "Write about the day"}
              </Text>
            </Pressable>
            {recent.length > 0 ? (
              <>
                <Label>Recent</Label>
                <List items={recent} sidebar={sidebar} meta={(item) => edited(item.editedAt)} onOpen={open} />
              </>
            ) : null}
            {areas.map(({ area, notes }) => (
              <View key={area._id}>
                <View style={styles.areaHead}>
                  <View style={[styles.areaDot, { backgroundColor: tones.area[area.colour] }]} />
                  <Text style={[styles.label, styles.areaTitle, { color: colors.mutedForeground }]}>{area.title}</Text>
                </View>
                <List items={notes} sidebar={sidebar} meta={(item) => (item.projectId ? (area.projects.find((p) => p._id === item.projectId)?.title ?? "") : edited(item.editedAt))} onOpen={open} />
              </View>
            ))}
            {unfiled.length > 0 ? (
              <>
                <Label>Unfiled</Label>
                <List items={unfiled} sidebar={sidebar} meta={(item) => edited(item.editedAt)} onOpen={open} />
              </>
            ) : null}
            {writing.length === 0 ? (
              <View style={styles.none}>
                <Text style={[styles.noneTitle, { color: colors.foreground }]}>No notes yet</Text>
                <Text style={[styles.rowMeta, { color: colors.mutedForeground }]}>Notes save on this phone as you type and sync when you are online.</Text>
              </View>
            ) : null}
          </>
        )}
      </ScrollView>
      <View pointerEvents="box-none" style={styles.fab}>
        <Button
          variant="primary"
          size="lg"
          title="New note"
          icon={NotebookPen}
          onPress={() => {
            haptic("toggle");
            create();
          }}
        />
      </View>
    </>
  );
};

const styles = StyleSheet.create({
  page: { paddingHorizontal: 16, paddingBottom: 190 },
  label: { fontFamily: fonts.medium, fontSize: 13, marginTop: 24, marginBottom: 8, paddingHorizontal: 16 },
  group: { borderRadius: 22, borderCurve: "continuous", overflow: "hidden" },
  row: { paddingVertical: 12, paddingHorizontal: 16, gap: 2 },
  rowTop: { flexDirection: "row", alignItems: "center", gap: 8 },
  rowTitle: { flex: 1, fontFamily: fonts.medium, fontSize: 17, lineHeight: 22 },
  rowMeta: { fontFamily: fonts.regular, fontSize: 14, lineHeight: 19 },
  dot: { width: 8, height: 8, borderRadius: 4 },
  today: { marginTop: 8, padding: 16, borderRadius: 22, borderCurve: "continuous", gap: 6 },
  todayTitle: { flex: 1, fontFamily: fonts.medium, fontSize: 17 },
  excerpt: { fontFamily: fonts.regular, fontSize: 15, lineHeight: 22 },
  areaHead: { flexDirection: "row", alignItems: "center", gap: 8, marginTop: 24, marginBottom: 8, paddingHorizontal: 16 },
  areaDot: { width: 8, height: 8, borderRadius: 4 },
  areaTitle: { marginTop: 0, marginBottom: 0, paddingHorizontal: 0 },
  none: { paddingTop: 48, alignItems: "center", gap: 6, paddingHorizontal: 24 },
  noneTitle: { fontFamily: fonts.medium, fontSize: 17 },
  noneButton: { marginTop: 16 },
  fab: { position: "absolute", left: 16, bottom: 104 },
});
