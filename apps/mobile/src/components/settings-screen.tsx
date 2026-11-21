import { useAuthActions } from "@convex-dev/auth/react";
import * as Application from "expo-application";
import { Stack } from "expo-router";
import { Frame, Globe, MapPin, Smartphone, Sparkles, Stamp, type LucideIcon } from "lucide-react-native";
import { Alert, Linking, ScrollView, StyleSheet, View } from "react-native";
import { api } from "@lifeos/backend/api";
import { STATUS_WORDS, switchFeature, type FeatureState } from "@lifeos/backend/client/feature-actions";
import { FEATURES, type FeatureIcon } from "@lifeos/backend/features";
import { ListGroup, ListItem, type ListItemIconProps } from "@/components/ui/list-item";
import { Switch } from "@/components/ui/switch";
import { change } from "@/lib/change";
import { useKit } from "@/lib/kit";
import { forgetSavedViews, useView } from "@/lib/views";

const FEATURE_ICONS = {
  ai: Sparkles,
  mapPin: MapPin,
  stamp: Stamp,
  frame: Frame,
} as const satisfies Record<FeatureIcon, LucideIcon>;

const webUrl = process.env.EXPO_PUBLIC_WEB_URL;

const phoneIcon = ({ color, size }: ListItemIconProps) => <Smartphone size={size} color={color} strokeWidth={1.75} />;
const globeIcon = ({ color, size }: ListItemIconProps) => <Globe size={size} color={color} strokeWidth={1.75} />;

const Account = () => {
  const { signOut } = useAuthActions();
  const login = useView(api.platform.access.account, {})?.login ?? null;
  const ask = () =>
    Alert.alert("Sign out of LifeOS?", "Your Tasks stay safe. Sign in again any time.", [
      { text: "Cancel", style: "cancel" },
      { text: "Sign out", style: "destructive", onPress: () => void signOut().then(forgetSavedViews) },
    ]);
  return (
    <ListGroup header="Account" footer="Only this GitHub account can open this LifeOS.">
      <ListItem
        title={login ? `@${login}` : "GitHub"}
        subtitle="Signed in with GitHub"
        avatar={{ src: login ? `https://github.com/${login}.png?size=96` : undefined, name: login ?? "GitHub" }}
      />
      <ListItem title="Sign out" icon="logout" destructive chevron={false} onPress={ask} />
    </ListGroup>
  );
};

const FeatureRow = ({ state, last }: { state: FeatureState; last: boolean }) => {
  const { colors } = useKit();
  const spec = FEATURES[state.feature];
  const Icon = FEATURE_ICONS[spec.icon];
  const waiting = state.status.kind !== "off" && state.status.kind !== "ready" ? STATUS_WORDS[state.status.kind]() : null;
  return (
    <View style={styles.feature}>
      <View style={[styles.tile, { backgroundColor: colors.secondary }]}>
        <Icon size={17} color={colors.foreground} strokeWidth={1.75} />
      </View>
      <View style={[styles.featureBody, last ? null : { borderBottomColor: colors.border, borderBottomWidth: StyleSheet.hairlineWidth }]}>
        <Switch
          label={spec.title}
          description={waiting ? `${waiting}. ${spec.summary}` : spec.summary}
          value={state.enabled}
          onValueChange={(enabled) => void switchFeature(change, [state], state.feature, enabled)}
        />
      </View>
    </View>
  );
};

const Features = () => {
  const states = useView(api.platform.features.list, {});
  return (
    <ListGroup header="Features" footer="Optional parts of LifeOS. Switching one here switches it on the web and the Mac too. Keys and settings live in the web app.">
      {(states ?? []).map((state, index) => (
        <FeatureRow key={state.feature} state={state} last={index === (states?.length ?? 0) - 1} />
      ))}
    </ListGroup>
  );
};

const About = () => {
  const version = Application.nativeApplicationVersion ?? "Unknown";
  const build = Application.nativeBuildVersion;
  return (
    <ListGroup header="About">
      <ListItem title="Version" icon={phoneIcon} value={build ? `${version} (${build})` : version} />
      <ListItem
        title="LifeOS on the web"
        subtitle={webUrl ? webUrl.replace(/^https?:\/\//, "").replace(/\/$/, "") : "Set EXPO_PUBLIC_WEB_URL to link it"}
        icon={globeIcon}
        disabled={!webUrl}
        onPress={webUrl ? () => void Linking.openURL(webUrl) : undefined}
      />
    </ListGroup>
  );
};

export const SettingsScreen = () => {
  const { colors } = useKit();
  return (
    <>
      <Stack.Screen options={{ title: "Settings" }} />
      <ScrollView contentInsetAdjustmentBehavior="automatic" style={{ backgroundColor: colors.background }} contentContainerStyle={styles.page}>
        <Account />
        <Features />
        <About />
      </ScrollView>
    </>
  );
};

const styles = StyleSheet.create({
  page: { paddingHorizontal: 16, paddingTop: 8, paddingBottom: 140, gap: 28 },
  feature: { flexDirection: "row", alignItems: "flex-start", gap: 12, paddingLeft: 16 },
  tile: { width: 30, height: 30, borderRadius: 8, alignItems: "center", justifyContent: "center", marginTop: 12 },
  featureBody: { flex: 1, paddingVertical: 11, paddingRight: 16 },
});
