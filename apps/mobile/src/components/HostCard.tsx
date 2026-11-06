import Ionicons from "@expo/vector-icons/Ionicons";
import { StyleSheet, Text, View } from "react-native";
import type { HostSummary } from "@/api/types";
import { useTheme } from "./theme";

export function HostCard({ host }: { host: HostSummary }) {
  const t = useTheme();
  const since = host.hostingSince ? new Date(host.hostingSince).getFullYear() : null;
  const facts = [
    host.reviews ? `${host.reviews} reviews` : null,
    host.ratingAvg ? `★ ${host.ratingAvg.toFixed(2)}` : null,
    host.responseRatePct != null ? `${host.responseRatePct}% response rate` : null,
    since ? `Hosting since ${since}` : null,
  ].filter(Boolean);
  return (
    <View style={[styles.card, { borderColor: t.border, backgroundColor: t.card }]}>
      <View style={{ flexDirection: "row", alignItems: "center", gap: 14 }}>
        <View style={[styles.avatar, { backgroundColor: t.text }]}>
          <Text style={{ color: t.bg, fontSize: 22, fontWeight: "800" }}>{host.name.charAt(0).toUpperCase()}</Text>
          {host.superhost ? (
            <View style={[styles.medal, { backgroundColor: t.accent, borderColor: t.card }]}>
              <Ionicons name="ribbon" size={12} color="#fff" />
            </View>
          ) : null}
        </View>
        <View style={{ flex: 1 }}>
          <Text style={{ color: t.text, fontSize: 18, fontWeight: "800" }}>Hosted by {host.name}</Text>
          <Text style={{ color: t.muted, marginTop: 2 }}>{host.superhost ? "Superhost" : "Host"}{host.identityVerified ? " · Identity verified" : ""}</Text>
        </View>
      </View>
      {facts.length ? <Text style={{ color: t.text, marginTop: 12 }}>{facts.join(" · ")}</Text> : null}
      {host.superhost ? (
        <Text style={{ color: t.muted, marginTop: 8, lineHeight: 20 }}>
          Superhosts are experienced, highly rated hosts who respond quickly and rarely cancel.
        </Text>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  card: { borderWidth: 1, borderRadius: 16, padding: 16 },
  avatar: { width: 56, height: 56, borderRadius: 28, alignItems: "center", justifyContent: "center" },
  medal: { position: "absolute", right: -2, bottom: -2, width: 22, height: 22, borderRadius: 11, alignItems: "center", justifyContent: "center", borderWidth: 2 },
});
