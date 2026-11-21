import { Stack } from "expo-router";
import { useKit } from "@/lib/kit";
import { fonts } from "@/lib/kit-theme";

export const TabStack = () => {
  const { colors } = useKit();
  return (
    <Stack
      screenOptions={{
        headerLargeTitleEnabled: true,
        headerShadowVisible: false,
        headerBackButtonDisplayMode: "minimal",
        headerTintColor: colors.foreground,
        headerTitleStyle: { fontFamily: fonts.semibold },
        headerLargeTitleStyle: { fontFamily: fonts.semibold },
        contentStyle: { backgroundColor: colors.background },
      }}
    />
  );
};
