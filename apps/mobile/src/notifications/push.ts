import Constants from "expo-constants";
import * as Device from "expo-device";
import * as Notifications from "expo-notifications";
import { router } from "expo-router";
import { useEffect } from "react";
import { Platform } from "react-native";
import { api } from "@/api/client";

// Show message notifications even while the app is open (the in-app badge updates too).
Notifications.setNotificationHandler({
  handleNotification: async () => ({ shouldShowBanner: true, shouldShowList: true, shouldPlaySound: true, shouldSetBadge: true }),
});

/** Asks for permission (once), registers this device with message-svc, and returns the Expo token. */
async function register(): Promise<string | null> {
  if (!Device.isDevice) return null; // simulators can't receive push
  if (Platform.OS === "android") {
    await Notifications.setNotificationChannelAsync("messages", { name: "Messages", importance: Notifications.AndroidImportance.HIGH });
  }
  let { status } = await Notifications.getPermissionsAsync();
  if (status !== "granted") status = (await Notifications.requestPermissionsAsync()).status;
  if (status !== "granted") return null;
  const projectId = (Constants.expoConfig?.extra as { eas?: { projectId?: string } } | undefined)?.eas?.projectId;
  if (!projectId) return null; // set EAS_PROJECT_ID (app.config.ts) to enable push
  const { data: token } = await Notifications.getExpoPushTokenAsync({ projectId });
  await api("/v1/push-tokens", { method: "PUT", auth: true, body: { token, platform: Platform.OS === "ios" ? "ios" : "android" } });
  return token;
}

/** While signed in: keep this device registered, and open the conversation when a notification is tapped. */
export function usePushNotifications(signedIn: boolean) {
  useEffect(() => {
    if (!signedIn) return;
    void register().catch(() => undefined); // push is a convenience; never block the app on it
    const open = (n: Notifications.Notification) => {
      const d = n.request.content.data as { type?: string; threadId?: string };
      if (d?.type === "message" && d.threadId) router.push({ pathname: "/thread/[id]", params: { id: d.threadId } });
    };
    const sub = Notifications.addNotificationResponseReceivedListener((r) => open(r.notification));
    void Notifications.getLastNotificationResponseAsync().then((r) => r && open(r.notification));
    return () => sub.remove();
  }, [signedIn]);
}
