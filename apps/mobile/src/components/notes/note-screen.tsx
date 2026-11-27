import { Stack, useLocalSearchParams, useRouter } from "expo-router";
import { Check, ChevronLeft, Ellipsis, Link2, ListTodo, Heading2, CornerDownRight } from "lucide-react-native";
import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { ActionSheetIOS, Pressable, StyleSheet, Text, View } from "react-native";
import { KeyboardAvoidingView, KeyboardStickyView } from "react-native-keyboard-controller";
import Animated, { FadeIn, FadeOut, ReduceMotion } from "react-native-reanimated";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { api } from "@lifeos/backend/api";
import type { Id } from "@lifeos/backend/dataModel";
import { nothing } from "@lifeos/backend/client/updaters";
import { projectNote, type FolderRef } from "@lifeos/notes/markdown";
import { Pressed } from "@/components/button";
import { change } from "@/lib/change";
import { convex } from "@/lib/convex";
import { useKit } from "@/lib/kit";
import { fonts } from "@/lib/kit-theme";
import type { EditorHandle } from "@/lib/notes/bridge";
import { noteByTitle, useChips, useDocText, useFolder, useNoteItems, useNoteTitles, useSidebar, useSuggest } from "@/lib/notes/data";
import { ensureDaily, forgetLocal, newDocId, openNote, setFolder, textOf } from "@/lib/notes/library";
import { useNote } from "@/lib/notes/use-note";
import { linksHref, noteHref } from "@/lib/route";
import { useTactile } from "@/lib/tactile";
import { useView } from "@/lib/views";
import { Glass, SyncDot, syncWords } from "./glass";
import { NoteEditorView } from "./note-editor";

const TOP_BAR = 44;

const GlassButton = ({ label, onPress, children }: { label: string; onPress: () => void; children: ReactNode }) => (
  <Pressable accessibilityRole="button" accessibilityLabel={label} hitSlop={6} onPress={onPress}>
    <Glass interactive style={styles.circle}>
      <View style={styles.circleInner}>{children}</View>
    </Glass>
  </Pressable>
);

const ToolButton = ({ label, onPress, children }: { label: string; onPress: () => void; children: ReactNode }) => (
  <Pressed accessibilityLabel={label} haptic="snap" onPress={onPress} style={styles.tool}>
    {children}
  </Pressed>
);

export const NoteScreen = () => {
  const { id, fresh } = useLocalSearchParams<{ id: string; fresh?: string }>();
  const docId = id ?? null;
  const { colors } = useKit();
  const depth = useTactile();
  const insets = useSafeAreaInsets();
  const router = useRouter();
  const note = useNote(docId);
  const text = useDocText(note?.doc);
  const folder = useFolder(note?.doc);
  const chips = useChips(text);
  const sidebar = useSidebar();
  const items = useNoteItems(sidebar);
  const titles = useNoteTitles(items);
  const suggest = useSuggest(items, docId);
  const editor = useRef<EditorHandle>(null);
  const [focused, setFocused] = useState(false);
  const day = docId?.startsWith("day-") ? docId.slice(4) : undefined;
  const title = projectNote(text).title;
  const links = useView(api.notes.notes.links, convex && docId ? { docId } : "skip");

  useEffect(() => {
    if (note?.ready && day) ensureDaily(note.doc, day);
  }, [note?.ready, note?.doc, day]);

  const openTitle = useCallback(
    (wanted: string) => {
      const known = noteByTitle(items, wanted);
      if (known) return router.push(noteHref(known.docId));
      const created = newDocId();
      const { doc, ready } = openNote(created);
      void ready.then(() => {
        doc.transact(() => textOf(doc).insert(0, `${wanted}\n`));
        router.push({ pathname: "/notes/[id]", params: { id: created, fresh: "1" } });
      });
    },
    [items, router],
  );

  const linkCount = useMemo(() => {
    const projection = projectNote(text);
    return projection.noteTitles.length + projection.entities.length + (links?.linkedFrom.length ?? 0);
  }, [text, links]);

  const moveTo = (next: FolderRef | null) => note && setFolder(note.doc, next);

  const chooseFolder = () => {
    const places = [
      { label: "Unfiled", folder: null as FolderRef | null },
      ...(sidebar?.areas ?? []).flatMap((area) => [
        { label: area.title, folder: { table: "areas", id: area._id } as FolderRef | null },
        ...area.projects.map((project) => ({ label: `${area.title} › ${project.title}`, folder: { table: "projects", id: project._id } as FolderRef | null })),
      ]),
    ];
    ActionSheetIOS.showActionSheetWithOptions({ title: "Move to", options: [...places.map((place) => place.label), "Cancel"], cancelButtonIndex: places.length }, (index) => {
      const place = places[index];
      if (place) moveTo(place.folder);
    });
  };

  const trash = () => {
    if (!docId) return;
    const noteId = items.find((item) => item.docId === docId)?.id;
    forgetLocal(docId);
    router.back();
    if (!noteId) return;
    void change({ title: "Note moved to the Trash", mutation: api.notes.notes.trash, args: { noteId: noteId as Id<"notes"> }, apply: nothing, revert: nothing });
  };

  const more = () => {
    const options = ["Move to", "Move to Trash", "Cancel"];
    ActionSheetIOS.showActionSheetWithOptions({ options, destructiveButtonIndex: 1, cancelButtonIndex: 2 }, (index) => {
      if (index === 0) chooseFolder();
      if (index === 1) trash();
    });
  };

  const topPad = insets.top + TOP_BAR + 32;
  return (
    <View style={[styles.page, { backgroundColor: colors.background }]}>
      <Stack.Screen options={{ headerShown: false }} />
      <KeyboardAvoidingView behavior="padding" style={styles.fill}>
        {note?.ready ? (
          <NoteEditorView
            key={note.docId}
            doc={note.doc}
            sync={note.sync}
            chips={chips}
            titles={titles}
            titled={!day}
            placeholder={day ? "Write about the day" : "Start with a title"}
            label={day ? `Journal for ${day}` : title}
            top={topPad}
            bottom={focused ? 120 : insets.bottom + 140}
            autoFocus={fresh === "1"}
            folder={folder && folder.table !== undefined ? (folder as { table: "areas" | "projects"; id: string }) : null}
            suggest={suggest}
            openTitle={openTitle}
            editorRef={editor}
            onFocus={setFocused}
          />
        ) : null}
      </KeyboardAvoidingView>
      <View pointerEvents="box-none" style={[styles.top, { top: insets.top + 6 }]}>
        <GlassButton label="Back to Notes" onPress={() => router.back()}>
          <ChevronLeft size={22} color={colors.foreground} strokeWidth={2.25} />
        </GlassButton>
        <Glass style={styles.pill}>
          <View accessibilityLabel={note ? syncWords(note.status) : "Opening"} style={styles.sync}>
            {note ? <SyncDot status={note.status} /> : null}
          </View>
          <Pressable accessibilityRole="button" accessibilityLabel={`${linkCount} links`} onPress={() => docId && router.push(linksHref(docId))} style={styles.links}>
            <Link2 size={16} color={colors.foreground} strokeWidth={2.25} />
            <Text style={[styles.count, { color: colors.foreground }]}>{linkCount}</Text>
          </Pressable>
          <Pressable accessibilityRole="button" accessibilityLabel="More" onPress={more} style={styles.more}>
            <Ellipsis size={20} color={colors.foreground} strokeWidth={2.25} />
          </Pressable>
        </Glass>
      </View>
      {focused ? (
        <KeyboardStickyView offset={{ closed: 0, opened: 8 }} style={styles.sticky}>
          <Animated.View entering={FadeIn.duration(140).reduceMotion(ReduceMotion.System)} exiting={FadeOut.duration(100).reduceMotion(ReduceMotion.System)} style={styles.bar}>
            <Glass style={styles.tools}>
              <ToolButton label="Link a note" onPress={() => editor.current?.link()}>
                <Text style={[styles.bracket, { color: colors.accent }]}>[[</Text>
              </ToolButton>
              <ToolButton label="To-do" onPress={() => editor.current?.todo()}>
                <ListTodo size={20} color={colors.foreground} strokeWidth={2.25} />
              </ToolButton>
              <ToolButton label="Make Task" onPress={() => editor.current?.makeTask()}>
                <CornerDownRight size={20} color={colors.foreground} strokeWidth={2.25} />
              </ToolButton>
              <ToolButton label="Heading" onPress={() => editor.current?.heading()}>
                <Heading2 size={20} color={colors.foreground} strokeWidth={2.25} />
              </ToolButton>
            </Glass>
            <Pressed accessibilityLabel="Done" haptic="toggle" onPress={() => editor.current?.blur()} style={[styles.done, depth.primary]}>
              <Check size={20} color={depth.primaryInk} strokeWidth={2.5} />
            </Pressed>
          </Animated.View>
        </KeyboardStickyView>
      ) : null}
    </View>
  );
};

const styles = StyleSheet.create({
  page: { flex: 1 },
  fill: { flex: 1 },
  top: { position: "absolute", left: 16, right: 16, flexDirection: "row", justifyContent: "space-between", alignItems: "center" },
  circle: { width: TOP_BAR, height: TOP_BAR, borderRadius: TOP_BAR / 2 },
  circleInner: { flex: 1, alignItems: "center", justifyContent: "center" },
  pill: { height: TOP_BAR, borderRadius: TOP_BAR / 2, flexDirection: "row", alignItems: "center", paddingHorizontal: 6 },
  sync: { width: 26, height: 32, alignItems: "center", justifyContent: "center" },
  links: { height: 32, flexDirection: "row", alignItems: "center", gap: 5, paddingHorizontal: 10 },
  count: { fontFamily: fonts.monoMedium, fontSize: 14 },
  more: { width: 32, height: 32, alignItems: "center", justifyContent: "center" },
  sticky: { position: "absolute", left: 0, right: 0, bottom: 0 },
  bar: { flexDirection: "row", alignItems: "center", gap: 8, paddingHorizontal: 12, paddingBottom: 8 },
  tools: { flex: 1, height: 48, borderRadius: 24, flexDirection: "row", alignItems: "center", justifyContent: "space-between", paddingHorizontal: 8 },
  tool: { width: 48, height: 40, borderRadius: 20, alignItems: "center", justifyContent: "center" },
  bracket: { fontFamily: fonts.monoMedium, fontSize: 16 },
  done: { width: 48, height: 48, borderRadius: 24, alignItems: "center", justifyContent: "center" },
});
