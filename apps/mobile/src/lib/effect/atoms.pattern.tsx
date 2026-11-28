import { useAtom, useAtomSet, useAtomValue } from "@effect/atom-react";
import { Pressable, Text } from "react-native";
import { faceAtom, selectedCountAtom, toggleSelectedAtom } from "@lifeos/backend/effect/patterns/atoms";

export const SelectionCount = () => {
  const count = useAtomValue(selectedCountAtom);
  return <Text accessibilityRole="text">{count} selected</Text>;
};

export const FaceSwitch = () => {
  const [face, setFace] = useAtom(faceAtom);
  return (
    <Pressable
      accessibilityRole="switch"
      accessibilityState={{ checked: face === "timeline" }}
      onPress={() => setFace(face === "list" ? "timeline" : "list")}
    >
      <Text>{face === "list" ? "List" : "Timeline"}</Text>
    </Pressable>
  );
};

export const SelectRow = ({ taskKey, title }: { taskKey: string; title: string }) => {
  const selected = useAtomValue(toggleSelectedAtom, (keys) => keys.has(taskKey));
  const toggle = useAtomSet(toggleSelectedAtom);
  return (
    <Pressable accessibilityRole="button" accessibilityState={{ selected }} onPress={() => toggle(taskKey)}>
      <Text>{title}</Text>
    </Pressable>
  );
};
