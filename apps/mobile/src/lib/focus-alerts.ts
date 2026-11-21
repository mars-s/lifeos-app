import {
  SchedulableTriggerInputTypes,
  cancelScheduledNotificationAsync,
  getPermissionsAsync,
  requestPermissionsAsync,
  scheduleNotificationAsync,
  setNotificationHandler,
} from "expo-notifications";
import { useEffect, useState } from "react";
import { AppState } from "react-native";

export type AlertStatus = "granted" | "denied" | "undetermined";

const TIME_UP = "focus-time-up";

const ignore = () => undefined;

let asking: Promise<unknown> = Promise.resolve();

const statusOf = async () => {
  const permission = await getPermissionsAsync();
  return (permission.granted ? "granted" : permission.canAskAgain ? "undetermined" : "denied") satisfies AlertStatus;
};

export const askForAlerts = () => {
  asking = statusOf()
    .then((status) => (status === "undetermined" ? requestPermissionsAsync({ ios: { allowAlert: true, allowSound: true, allowBadge: false } }) : null))
    .catch(ignore);
  return asking;
};

export const quietInForeground = () =>
  setNotificationHandler({
    handleNotification: () => Promise.resolve({ shouldPlaySound: false, shouldSetBadge: false, shouldShowBanner: false, shouldShowList: true }),
  });

export type TimeUp = { endsAt: number; title: string; body: string };

export const scheduleTimeUp = async (alert: TimeUp | null) => {
  await cancelScheduledNotificationAsync(TIME_UP).catch(ignore);
  if (!alert) return;
  await asking;
  const seconds = Math.round((alert.endsAt - Date.now()) / 1000);
  if (seconds < 1) return;
  await scheduleNotificationAsync({
    identifier: TIME_UP,
    content: { title: alert.title, body: alert.body, sound: "default", interruptionLevel: "active" },
    trigger: { type: SchedulableTriggerInputTypes.TIME_INTERVAL, seconds },
  }).catch(ignore);
};

export const useAlertStatus = () => {
  const [status, setStatus] = useState<AlertStatus | null>(null);
  useEffect(() => {
    const read = () => void statusOf().then(setStatus, ignore);
    read();
    const foreground = AppState.addEventListener("change", read);
    return () => foreground.remove();
  }, []);
  return {
    status,
    ask: () => void askForAlerts().then(() => statusOf().then(setStatus, ignore)),
  };
};
