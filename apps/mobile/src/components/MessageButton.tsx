import { router } from "expo-router";
import { useState } from "react";
import { Alert, type ViewStyle } from "react-native";
import { startThread } from "@/api/hooks";
import { useAuth } from "@/auth/AuthProvider";
import { Button } from "./ui";

export function MessageButton({ start, title, variant = "outline", style }: { start: { listingId: string } | { bookingId: string }; title: string; variant?: "outline" | "primary"; style?: ViewStyle }) {
  const { user, signIn } = useAuth();
  const [busy, setBusy] = useState(false);
  return (
    <Button
      title={title}
      icon="chatbubble-ellipses-outline"
      variant={variant}
      loading={busy}
      style={style}
      onPress={async () => {
        if (!user) return void signIn();
        setBusy(true);
        try {
          const { threadId } = await startThread(start);
          router.push({ pathname: "/thread/[id]", params: { id: threadId } });
        } catch (e) {
          Alert.alert("Couldn't open messages", (e as Error).message);
        } finally {
          setBusy(false);
        }
      }}
    />
  );
}
