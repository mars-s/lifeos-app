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
import { CaptureButton, TAB_BAR_CLEARANCE } from "@/components/capture-button";
import { FocusPill } from "@/components/focus-pill";
import { FocusSignals } from "@/components/focus-signals";
import { OwnerGate } from "@/components/owner-gate";
import { Toaster } from "@/components/ui/toast";
import { addMissingArrayMethods } from "@/lib/array-methods";
import { undoLatest } from "@/lib/change";
import { convex, secureStorage } from "@/lib/convex";
import { FocusProvider } from "@/lib/focus";
import { useKit } from "@/lib/kit";
import { AppTheme } from "@/lib/kit-theme";
import { listenForShake } from "@/lib/shake";

addMissingArrayMethods();
void SplashScreen.preventAutoHideAsync();

const OVERLAID = /^\/(task|tool|capture|search|lists\/settings|focus)/;

const Screens = () => {
  const { colors, dark } = useKit();
  const pathname = usePathname();
  const theme = useMemo(() => {
    const base = dark ? DarkTheme : DefaultTheme;
    return { ...base, colors: { ...base.colors, background: colors.background, card: colors.background, text: colors.foreground, primary: colors.accent, border: colors.border } };
  }, [dark, colors]);
  const sheet = { presentation: "formSheet", sheetCornerRadius: 22, contentStyle: { backgroundColor: colors.popover } } as const;
  useEffect(() => listenForShake(undoLatest), []);
  return (
    <ThemeProvider value={theme}>
      <FocusProvider>
        <StatusBar style={dark ? "light" : "dark"} />
        <Stack screenOptions={{ headerShown: false, contentStyle: { backgroundColor: colors.background } }}>
          <Stack.Screen name="(tabs)" />
          <Stack.Screen name="task/[id]" options={{ ...sheet, sheetAllowedDetents: [0.72, 1], sheetGrabberVisible: true }} />
          <Stack.Screen name="tool/[tool]" options={{ ...sheet, sheetAllowedDetents: "fitToContents", sheetGrabberVisible: true }} />
          <Stack.Screen name="capture" options={{ ...sheet, sheetAllowedDetents: "fitToContents" }} />
          <Stack.Screen name="focus" options={{ ...sheet, sheetAllowedDetents: "fitToContents", sheetGrabberVisible: true }} />
        </Stack>
        {convex && !OVERLAID.test(pathname) ? <FocusPill /> : null}
        {convex && !OVERLAID.test(pathname) ? <CaptureButton /> : null}
        {convex ? <FocusSignals /> : null}
        <Toaster variant="minimal" position="bottom" safeArea bottomInset={TAB_BAR_CLEARANCE + 72} />
      </FocusProvider>
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
