import { Inter_400Regular, Inter_500Medium, Inter_600SemiBold, useFonts } from "@expo-google-fonts/inter";
import { ConvexProvider, ConvexReactClient } from "convex/react";
import { StatusBar } from "expo-status-bar";
import { useColorScheme, View } from "react-native";
import { TodayScreen } from "./src/today-screen";
import { palette } from "./src/theme";

const convexUrl = process.env.EXPO_PUBLIC_CONVEX_URL;
const convex = convexUrl ? new ConvexReactClient(convexUrl, { unsavedChangesWarning: false }) : null;

export default function App() {
  const scheme = useColorScheme();
  const colours = scheme === "dark" ? palette.dark : palette.light;
  const [fontsLoaded] = useFonts({ Inter_400Regular, Inter_500Medium, Inter_600SemiBold });
  if (!fontsLoaded) return <View style={{ flex: 1, backgroundColor: colours.background }} />;
  const screen = <TodayScreen colours={colours} connected={convex !== null} />;
  return (
    <View style={{ flex: 1, backgroundColor: colours.background }}>
      <StatusBar style={scheme === "dark" ? "light" : "dark"} />
      {convex ? <ConvexProvider client={convex}>{screen}</ConvexProvider> : screen}
    </View>
  );
}
