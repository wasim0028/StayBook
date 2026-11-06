import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { Stack } from "expo-router";
import { StatusBar } from "expo-status-bar";
import { useState } from "react";
import { GestureHandlerRootView } from "react-native-gesture-handler";
import { SafeAreaProvider } from "react-native-safe-area-context";
import { ApiError } from "@/api/client";
import { AuthProvider, useAuth } from "@/auth/AuthProvider";
import { usePushNotifications } from "@/notifications/push";
import { useTheme } from "@/components/theme";

export default function RootLayout() {
  const t = useTheme();
  const [queryClient] = useState(
    () =>
      new QueryClient({
        defaultOptions: {
          queries: {
            // Retry network blips and 5xx, never 4xx.
            retry: (count, err) => count < 2 && !(err instanceof ApiError && err.status >= 400 && err.status < 500),
          },
        },
      }),
  );

  return (
    <GestureHandlerRootView style={{ flex: 1 }}>
      <SafeAreaProvider>
        <QueryClientProvider client={queryClient}>
          <AuthProvider>
            <StatusBar style="auto" />
            <PushRegistrar />
            <Stack
              screenOptions={{
                headerTintColor: t.text,
                headerStyle: { backgroundColor: t.bg },
                contentStyle: { backgroundColor: t.bg },
                headerBackButtonDisplayMode: "minimal",
                headerShadowVisible: false,
              }}
            >
              <Stack.Screen name="(tabs)" options={{ headerShown: false }} />
              <Stack.Screen name="listing/[id]" options={{ title: "" }} />
              <Stack.Screen name="checkout/[id]" options={{ title: "Confirm and pay", presentation: "modal" }} />
              <Stack.Screen name="trip/[id]" options={{ title: "Trip" }} />
              <Stack.Screen name="host/reservation/[id]" options={{ title: "Reservation" }} />
              <Stack.Screen name="host/onboarding" options={{ title: "Become a host" }} />
              <Stack.Screen name="hosting" options={{ title: "Hosting" }} />
              <Stack.Screen name="thread/[id]" options={{ title: "" }} />
              <Stack.Screen name="auth/callback" options={{ headerShown: false }} />
              <Stack.Screen name="auth/logout" options={{ headerShown: false }} />
            </Stack>
          </AuthProvider>
        </QueryClientProvider>
      </SafeAreaProvider>
    </GestureHandlerRootView>
  );
}

/** Registers this device for message notifications once the user is signed in. */
function PushRegistrar() {
  const { user } = useAuth();
  usePushNotifications(!!user);
  return null;
}
