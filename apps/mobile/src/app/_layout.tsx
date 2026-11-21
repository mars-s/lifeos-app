import { ConvexAuthProvider } from "@convex-dev/auth/react";
import { GeistMono_400Regular, GeistMono_500Medium } from "@expo-google-fonts/geist-mono";
import { Inter_400Regular, Inter_500Medium, Inter_600SemiBold, useFonts } from "@expo-google-fonts/inter";
import { DarkTheme, DefaultTheme, SplashScreen, Stack, ThemeProvider, usePathname } from "expo-router";
import { StatusBar } from "expo-status-bar";
import { useEffect, useMemo } from "react";
import { StyleSheet } from "react-native";
import { GestureHandlerRootView } from "react-native-gesture-handler";
import { KeyboardProvider } from "react-native-keyboard-controller";
import { api } from "@lifeos/backend/api";
import { CaptureButton } from "@/components/capture-button";
import { OwnerGate } from "@/components/owner-gate";
import { Toaster } from "@/components/ui/toast";
import { addMissingArrayMethods } from "@/lib/array-methods";
import { undoLatest } from "@/lib/change";
import { convex, secureStorage } from "@/lib/convex";
import { useKit } from "@/lib/kit";
import { AppTheme, fonts } from "@/lib/kit-theme";
import { listenForShake } from "@/lib/shake";

addMissingArrayMethods();
void SplashScreen.preventAutoHideAsync();

const OVERLAID = /^\/(task|tool|capture)/;

const Screens = () => {
  const { colors, dark } = useKit();
  const pathname = usePathname();
  const theme = useMemo(() => {
    const base = dark ? DarkTheme : DefaultTheme;
    return { ...base, colors: { ...base.colors, background: colors.background, card: colors.background, text: colors.foreground, primary: colors.accent, border: colors.border } };
  }, [dark, colors]);
  const sheet = { presentation: "formSheet", headerShown: false, sheetCornerRadius: 22, contentStyle: { backgroundColor: colors.popover } } as const;
  useEffect(() => listenForShake(undoLatest), []);
  return (
    <ThemeProvider value={theme}>
      <StatusBar style={dark ? "light" : "dark"} />
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
      >
        <Stack.Screen name="index" options={{ headerShown: false, title: "LifeOS" }} />
        <Stack.Screen name="task/[id]" options={{ ...sheet, sheetAllowedDetents: [0.72, 1], sheetGrabberVisible: true }} />
        <Stack.Screen name="tool/[tool]" options={{ ...sheet, sheetAllowedDetents: "fitToContents", sheetGrabberVisible: true }} />
        <Stack.Screen name="capture" options={{ ...sheet, sheetAllowedDetents: "fitToContents" }} />
      </Stack>
      {convex && !OVERLAID.test(pathname) ? <CaptureButton /> : null}
      <Toaster variant="minimal" position="bottom" safeArea bottomInset={78} />
    </ThemeProvider>
  );
};

export default function RootLayout() {
  const [fontsLoaded] = useFonts({ Inter_400Regular, Inter_500Medium, Inter_600SemiBold, GeistMono_400Regular, GeistMono_500Medium });
  useEffect(() => {
    if (fontsLoaded) void SplashScreen.hideAsync();
  }, [fontsLoaded]);
  if (!fontsLoaded) return null;
  return (
    <GestureHandlerRootView style={styles.root}>
      <KeyboardProvider>
        <AppTheme>
          {convex ? (
            <ConvexAuthProvider
              client={convex}
              storage={secureStorage}
              api={{ refreshSession: api.auth.refreshSession, signOut: api.auth.signOut, isAuthenticated: api.auth.isAuthenticated }}
            >
              <OwnerGate>
                <Screens />
              </OwnerGate>
            </ConvexAuthProvider>
          ) : (
            <Screens />
          )}
        </AppTheme>
      </KeyboardProvider>
    </GestureHandlerRootView>
  );
}

const styles = StyleSheet.create({ root: { flex: 1 } });
