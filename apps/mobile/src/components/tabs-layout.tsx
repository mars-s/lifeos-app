import { NativeTabs } from "expo-router/native-tabs";
import { api } from "@lifeos/backend/api";
import { convex } from "@/lib/convex";
import { useKit } from "@/lib/kit";
import { useLocalDate, useViewState, valueOf } from "@/lib/views";

const useCounts = () => {
  const today = useLocalDate();
  return valueOf(useViewState(api.planner.sidebar.get, convex ? { date: today } : "skip").value)?.counts;
};

export const TabsLayout = () => {
  const { colors, dark } = useKit();
  const counts = useCounts();
  return (
    <NativeTabs minimizeBehavior="onScrollDown" tintColor={colors.accent} badgeBackgroundColor={dark ? colors.input : colors.mutedForeground}>
      <NativeTabs.Trigger name="(today)">
        <NativeTabs.Trigger.Icon sf={{ default: "star", selected: "star.fill" }} md="star" />
        <NativeTabs.Trigger.Label>Today</NativeTabs.Trigger.Label>
        <NativeTabs.Trigger.Badge hidden={!counts?.today}>{String(counts?.today ?? "")}</NativeTabs.Trigger.Badge>
      </NativeTabs.Trigger>
      <NativeTabs.Trigger name="upcoming">
        <NativeTabs.Trigger.Icon sf="calendar" md="calendar_month" />
        <NativeTabs.Trigger.Label>Upcoming</NativeTabs.Trigger.Label>
      </NativeTabs.Trigger>
      <NativeTabs.Trigger name="inbox">
        <NativeTabs.Trigger.Icon sf={{ default: "tray", selected: "tray.fill" }} md="inbox" />
        <NativeTabs.Trigger.Label>Inbox</NativeTabs.Trigger.Label>
        <NativeTabs.Trigger.Badge hidden={!counts?.inbox}>{String(counts?.inbox ?? "")}</NativeTabs.Trigger.Badge>
      </NativeTabs.Trigger>
      <NativeTabs.Trigger name="lists">
        <NativeTabs.Trigger.Icon sf={{ default: "square.stack", selected: "square.stack.fill" }} md="layers" />
        <NativeTabs.Trigger.Label>Lists</NativeTabs.Trigger.Label>
      </NativeTabs.Trigger>
      <NativeTabs.Trigger name="search" role="search">
        <NativeTabs.Trigger.Icon sf="magnifyingglass" md="search" />
        <NativeTabs.Trigger.Label>Search</NativeTabs.Trigger.Label>
      </NativeTabs.Trigger>
    </NativeTabs>
  );
};
