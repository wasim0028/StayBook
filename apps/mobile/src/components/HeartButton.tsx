import Ionicons from "@expo/vector-icons/Ionicons";
import { Pressable, StyleSheet } from "react-native";
import { useToggleWish } from "@/api/hooks";
import { useAuth } from "@/auth/AuthProvider";
import { useTheme } from "./theme";

export function HeartButton({ id, saved, floating = true }: { id: string; saved: boolean; floating?: boolean }) {
  const t = useTheme();
  const { user, signIn } = useAuth();
  const toggle = useToggleWish();
  return (
    <Pressable
      hitSlop={10}
      accessibilityRole="button"
      accessibilityLabel={saved ? "Remove from wishlist" : "Save to wishlist"}
      accessibilityState={{ selected: saved }}
      onPress={() => (user ? toggle.mutate({ id, save: !saved }) : void signIn())}
      style={floating ? styles.floating : undefined}
    >
      <Ionicons name={saved ? "heart" : "heart-outline"} size={floating ? 26 : 24} color={saved ? t.accent : floating ? "#FFFFFF" : t.text} style={floating ? styles.shadow : undefined} />
    </Pressable>
  );
}

const styles = StyleSheet.create({
  floating: { position: "absolute", top: 12, right: 12 },
  shadow: { textShadowColor: "rgba(0,0,0,0.35)", textShadowRadius: 6 },
});
