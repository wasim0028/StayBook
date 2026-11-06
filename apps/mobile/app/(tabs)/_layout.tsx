import Ionicons from "@expo/vector-icons/Ionicons";
import { Tabs } from "expo-router";
import { useInboxSummary } from "@/api/hooks";
import { useAuth } from "@/auth/AuthProvider";
import { useTheme } from "@/components/theme";

type IconName = React.ComponentProps<typeof Ionicons>["name"];
const icon = (name: IconName) => ({ color, size }: { color: unknown; size: number }) => <Ionicons name={name} color={color as string} size={size} />;

export default function TabsLayout() {
  const t = useTheme();
  const { user } = useAuth();
  const unread = useInboxSummary(!!user).data?.unread ?? 0;
  return (
    <Tabs
      screenOptions={{
        tabBarActiveTintColor: t.accent,
        tabBarInactiveTintColor: t.muted,
        tabBarStyle: { backgroundColor: t.card, borderTopColor: t.border },
        tabBarLabelStyle: { fontWeight: "600" },
        headerStyle: { backgroundColor: t.bg },
        headerTintColor: t.text,
        headerTitleStyle: { fontWeight: "800" },
        headerShadowVisible: false,
      }}
    >
      <Tabs.Screen name="index" options={{ title: "Explore", headerShown: false, tabBarIcon: icon("search") }} />
      <Tabs.Screen name="wishlist" options={{ title: "Wishlist", tabBarIcon: icon("heart-outline") }} />
      <Tabs.Screen name="trips" options={{ title: "Trips", tabBarIcon: icon("airplane-outline") }} />
      <Tabs.Screen name="inbox" options={{ title: "Inbox", tabBarIcon: icon("chatbubbles-outline"), tabBarBadge: unread ? (unread > 99 ? "99+" : unread) : undefined, tabBarBadgeStyle: { backgroundColor: t.accent, color: t.accentText } }} />
      <Tabs.Screen name="profile" options={{ title: "Profile", tabBarIcon: icon("person-circle-outline") }} />
    </Tabs>
  );
}
