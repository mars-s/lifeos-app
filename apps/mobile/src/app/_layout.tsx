import { Inter_400Regular, Inter_500Medium, Inter_600SemiBold, useFonts } from "@expo-google-fonts/inter";
import { ConvexProvider } from "convex/react";
import { SplashScreen, Stack } from "expo-router";
import { StatusBar } from "expo-status-bar";
import { useEffect } from "react";
import { convex } from "@/lib/convex";
import { useKit } from "@/lib/kit";
import { AppTheme } from "@/lib/kit-theme";

void SplashScreen.preventAutoHideAsync();

const ThemedStack = () => {
  const { colors, dark } = useKit();
  return (
    <>
      <StatusBar style={dark ? "light" : "dark"} />
      <Stack screenOptions={{ headerShown: false, contentStyle: { backgroundColor: colors.background } }} />
    </>
  );
};

export default function RootLayout() {
  const [fontsLoaded] = useFonts({ Inter_400Regular, Inter_500Medium, Inter_600SemiBold });
  useEffect(() => {
    if (fontsLoaded) void SplashScreen.hideAsync();
  }, [fontsLoaded]);
  if (!fontsLoaded) return null;
  const app = (
    <AppTheme>
      <ThemedStack />
    </AppTheme>
  );
  return convex ? <ConvexProvider client={convex}>{app}</ConvexProvider> : app;
}
