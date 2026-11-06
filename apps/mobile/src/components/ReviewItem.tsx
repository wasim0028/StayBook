import { StyleSheet, Text, View } from "react-native";
import type { Review } from "@/api/types";
import { timeAgo } from "@/lib/format";
import { useTheme } from "./theme";
import { Stars } from "./ui";

export function ReviewItem({ r }: { r: Review }) {
  const t = useTheme();
  return (
    <View>
      <View style={styles.head}>
        <View style={[styles.avatar, { backgroundColor: t.surface }]}>
          <Text style={{ color: t.text, fontWeight: "700" }}>{r.guestName.charAt(0).toUpperCase()}</Text>
        </View>
        <View>
          <Text style={{ color: t.text, fontWeight: "700" }}>{r.guestName}</Text>
          <View style={styles.meta}>
            <Stars value={r.rating} size={11} />
            <Text style={{ color: t.muted, fontSize: 13 }}>· {timeAgo(r.createdAt)}</Text>
          </View>
        </View>
      </View>
      {r.comment ? <Text style={{ color: t.text, marginTop: 10, lineHeight: 21 }}>{r.comment}</Text> : null}
      {r.hostReply ? (
        <View style={[styles.reply, { backgroundColor: t.surface }]}>
          <Text style={{ color: t.text, fontWeight: "700", marginBottom: 4 }}>Response from host</Text>
          <Text style={{ color: t.text, lineHeight: 20 }}>{r.hostReply}</Text>
        </View>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  head: { flexDirection: "row", alignItems: "center", gap: 10 },
  avatar: { width: 40, height: 40, borderRadius: 20, alignItems: "center", justifyContent: "center" },
  meta: { flexDirection: "row", alignItems: "center", gap: 6, marginTop: 2 },
  reply: { borderRadius: 12, padding: 12, marginTop: 10 },
});
