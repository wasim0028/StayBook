import { StyleSheet, Text, View } from "react-native";
import type { PriceBreakdown as P } from "@/api/types";
import { formatINR } from "@/lib/format";
import { useTheme } from "./theme";

export function PriceBreakdown({ p, totalLabel = "Total" }: { p: P; totalLabel?: string }) {
  const t = useTheme();
  const Row = ({ k, v, tone }: { k: string; v: string; tone?: "ok" | "bold" }) => (
    <View style={styles.row}>
      <Text style={{ color: tone === "ok" ? t.ok : tone === "bold" ? t.text : t.muted, fontWeight: tone === "bold" ? "700" : "400", flex: 1 }}>{k}</Text>
      <Text style={{ color: tone === "ok" ? t.ok : t.text, fontWeight: tone === "bold" ? "700" : "400" }}>{v}</Text>
    </View>
  );
  return (
    <View style={{ gap: 8 }}>
      <Row k={`${formatINR(Math.round(p.nightlySubtotalPaise / p.nights))} × ${p.nights} night${p.nights === 1 ? "" : "s"}`} v={formatINR(p.nightlySubtotalPaise)} />
      {p.extraGuestPaise > 0 ? <Row k={`Extra guests (${p.extraGuests})`} v={formatINR(p.extraGuestPaise)} /> : null}
      {p.discountPaise > 0 ? <Row k={`${p.discountKind === "monthly" ? "Monthly" : "Weekly"} discount (${p.discountPct}%)`} v={`−${formatINR(p.discountPaise)}`} tone="ok" /> : null}
      {p.cleaningFeePaise > 0 ? <Row k="Cleaning fee" v={formatINR(p.cleaningFeePaise)} /> : null}
      <Row k={`GST (${p.gstRatePct}%)`} v={formatINR(p.gstPaise)} />
      <View style={{ height: StyleSheet.hairlineWidth, backgroundColor: t.border, marginVertical: 2 }} />
      <Row k={totalLabel} v={formatINR(p.totalPaise)} tone="bold" />
    </View>
  );
}

const styles = StyleSheet.create({ row: { flexDirection: "row", justifyContent: "space-between", gap: 12 } });
