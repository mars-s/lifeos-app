import { useAuthActions } from "@convex-dev/auth/react";
import { useOauth, useSignInWithGithub } from "@convex-dev/auth/methods/github/react";
import { useConvexAuth } from "convex/react";
import { ConvexError } from "convex/values";
import * as WebBrowser from "expo-web-browser";
import { useState, type ReactNode } from "react";
import { ActivityIndicator, Pressable, StyleSheet, Text, View } from "react-native";
import { api } from "@lifeos/backend/api";
import type { AccessError } from "@lifeos/backend/types";
import { iphoneReturnUrl } from "@/lib/convex";
import { haptic } from "@/lib/haptics";
import { useKit } from "@/lib/kit";
import { fonts } from "@/lib/kit-theme";

const isAccessError = (error: unknown): error is ConvexError<AccessError> =>
  error instanceof ConvexError && typeof error.data === "object" && error.data !== null && "message" in error.data;

const SignInScreen = () => {
  const { colors, text } = useKit();
  const { signIn } = useSignInWithGithub(api.auth);
  const { flowError } = useOauth();
  const [busy, setBusy] = useState(false);
  const [problem, setProblem] = useState<string | null>(null);
  const start = async () => {
    if (!iphoneReturnUrl) return;
    setBusy(true);
    setProblem(null);
    const started = await signIn({ redirectTo: iphoneReturnUrl });
    const session =
      started.status === "redirect"
        ? await WebBrowser.openAuthSessionAsync(started.redirect.toString(), "lifeos://auth")
        : null;
    const code = session?.type === "success" ? new URL(session.url).searchParams.get("code") : null;
    const finished = code ? await signIn({ code }) : null;
    setBusy(false);
    if (finished?.status === "complete" || session?.type === "cancel") return;
    const cause = finished?.status === "error" && finished.userError.error === "OTHER_ERROR" ? finished.userError.cause : null;
    setProblem(isAccessError(cause) ? cause.data.message : "GitHub sign-in did not finish. Try again.");
    haptic("error");
  };
  const shown = problem ?? (flowError ? "GitHub sign-in did not finish. Try again." : null);
  return (
    <View style={[styles.screen, { backgroundColor: colors.background }]}>
      <Text style={[text.xxl, styles.title, { color: colors.foreground }]}>LifeOS</Text>
      <Text style={[text.sm, styles.hint, { color: colors.mutedForeground }]}>
        A calm place to plan the day. Sign in to pick up where you left off.
      </Text>
      <Pressable
        accessibilityRole="button"
        accessibilityState={{ busy }}
        disabled={busy}
        onPress={() => void start()}
        style={({ pressed }) => [
          styles.button,
          { backgroundColor: colors.primary, transform: [{ scale: pressed ? 0.97 : 1 }] },
        ]}
      >
        {busy ? <ActivityIndicator color={colors.primaryForeground} /> : null}
        <Text style={[text.md, styles.buttonLabel, { color: colors.primaryForeground }]}>Sign in with GitHub</Text>
      </Pressable>
      <Text accessibilityLiveRegion="polite" style={[text.sm, styles.hint, { color: colors.danger }]}>
        {shown}
      </Text>
    </View>
  );
};

export const SignOutButton = () => {
  const { colors, text } = useKit();
  const { signOut } = useAuthActions();
  return (
    <Pressable accessibilityRole="button" onPress={() => void signOut()} hitSlop={12}>
      <Text style={[text.sm, { color: colors.mutedForeground, fontFamily: fonts.medium }]}>Sign out</Text>
    </Pressable>
  );
};

export const OwnerGate = ({ children }: { children: ReactNode }) => {
  const { colors } = useKit();
  const { isLoading, isAuthenticated } = useConvexAuth();
  if (isLoading) return <View style={[styles.screen, { backgroundColor: colors.background }]} />;
  return isAuthenticated ? children : <SignInScreen />;
};

const styles = StyleSheet.create({
  screen: { flex: 1, alignItems: "center", justifyContent: "center", gap: 16, paddingHorizontal: 32 },
  title: { fontFamily: fonts.semibold },
  hint: { fontFamily: fonts.regular, textAlign: "center", minHeight: 20 },
  button: {
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
    height: 48,
    paddingHorizontal: 24,
    borderRadius: 999,
    marginTop: 8,
  },
  buttonLabel: { fontFamily: fonts.medium },
});
