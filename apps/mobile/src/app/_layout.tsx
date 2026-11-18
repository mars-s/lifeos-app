import { Inter_400Regular, Inter_500Medium, Inter_600SemiBold, useFonts } from "@expo-google-fonts/inter";
import { ConvexAuthProvider } from "@convex-dev/auth/react";
import { SplashScreen, Stack } from "expo-router";
import { StatusBar } from "expo-status-bar";
import { useEffect } from "react";
import { api } from "@lifeos/backend/api";
import { OwnerGate } from "@/components/owner-gate";
import { convex, secureStorage } from "@/lib/convex";
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
  if (!convex) {
    return (
      <AppTheme>
        <ThemedStack />
      </AppTheme>
    );
  }
  return (
    <ConvexAuthProvider
      client={convex}
      storage={secureStorage}
      api={{
        refreshSession: api.auth.refreshSession,
        signOut: api.auth.signOut,
        isAuthenticated: api.auth.isAuthenticated,
      }}
    >
      <AppTheme>
        <OwnerGate>
          <ThemedStack />
        </OwnerGate>
      </AppTheme>
    </ConvexAuthProvider>
  );
}
