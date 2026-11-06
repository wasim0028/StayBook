import Ionicons from "@expo/vector-icons/Ionicons";
import { useEffect, useState } from "react";
import { Modal, Pressable, ScrollView, StyleSheet, Text, TextInput, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { usePlaces, type Place } from "@/api/hooks";
import { formatRange } from "@/lib/format";
import { DateRangeModal, type Range } from "./DateRangeModal";
import { useTheme } from "./theme";
import { Button } from "./ui";

export type Flex = { kind: "weekend" | "week" | "month"; months: string[] };
export interface SearchState {
  place?: Place;
  range: Range;
  flex?: Flex;
}

const FLEX_LABEL: Record<Flex["kind"], string> = { weekend: "Weekend", week: "Week", month: "Month" };

function nextMonths(n: number): { key: string; label: string }[] {
  const now = new Date();
  return Array.from({ length: n }, (_, i) => {
    const d = new Date(now.getFullYear(), now.getMonth() + i, 1);
    return { key: `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`, label: d.toLocaleString("en-IN", { month: "short", year: "numeric" }) };
  });
}

export function whenLabel(s: SearchState): string {
  if (s.range.checkIn && s.range.checkOut) return formatRange(s.range.checkIn, s.range.checkOut);
  if (s.flex) {
    const months = nextMonths(12).filter((m) => s.flex!.months.includes(m.key)).map((m) => m.label.split(" ")[0]);
    return `A ${FLEX_LABEL[s.flex.kind].toLowerCase()} in ${months.join(", ")}`;
  }
  return "Any week";
}

export function SearchSheet({ visible, value, onClose, onApply }: { visible: boolean; value: SearchState; onClose: () => void; onApply: (s: SearchState) => void }) {
  const t = useTheme();
  const insets = useSafeAreaInsets();
  const [d, setD] = useState<SearchState>(value);
  const [q, setQ] = useState(value.place?.name ?? "");
  const [mode, setMode] = useState<"dates" | "flex">(value.flex ? "flex" : "dates");
  const [dates, setDates] = useState(false);
  const places = usePlaces(q);
  const months = nextMonths(6);

  useEffect(() => {
    if (!visible) return;
    setD(value);
    setQ(value.place?.name ?? "");
    setMode(value.flex ? "flex" : "dates");
  }, [visible, value]);

  const flex: Flex = d.flex ?? { kind: "weekend", months: [months[0]!.key] };
  const setFlex = (f: Flex) => setD({ ...d, flex: f, range: { guests: d.range.guests } });
  const showPlaces = q.trim().length >= 2 && q !== d.place?.name;

  return (
    <Modal visible={visible} animationType="slide" presentationStyle="pageSheet" onRequestClose={onClose}>
      <View style={{ flex: 1, backgroundColor: t.surface }}>
        <View style={styles.head}>
          <Pressable onPress={onClose} hitSlop={12} accessibilityLabel="Close" style={[styles.round, { backgroundColor: t.bg, borderColor: t.border }]}>
            <Ionicons name="close" size={20} color={t.text} />
          </Pressable>
        </View>
        <ScrollView contentContainerStyle={{ padding: 16, gap: 14 }} keyboardShouldPersistTaps="handled">
          <View style={[styles.card, { backgroundColor: t.bg }]}>
            <Text style={[styles.h, { color: t.text }]}>Where to?</Text>
            <View style={[styles.input, { borderColor: t.border }]}>
              <Ionicons name="search" size={18} color={t.muted} />
              <TextInput
                value={q}
                onChangeText={setQ}
                placeholder="Search destinations"
                placeholderTextColor={t.muted}
                style={{ flex: 1, color: t.text, fontSize: 16, paddingVertical: 10 }}
                autoCorrect={false}
                returnKeyType="search"
              />
              {q ? <Ionicons name="close-circle" size={18} color={t.muted} onPress={() => { setQ(""); setD({ ...d, place: undefined }); }} /> : null}
            </View>
            {showPlaces ? (
              <View style={{ marginTop: 6 }}>
                {(places.data?.items ?? []).map((p) => (
                  <Pressable key={`${p.name}-${p.state}`} onPress={() => { setD({ ...d, place: p }); setQ(p.name); }} style={styles.placeRow} accessibilityRole="button">
                    <View style={[styles.pin, { backgroundColor: t.surface }]}>
                      <Ionicons name="location-outline" size={20} color={t.text} />
                    </View>
                    <View style={{ flex: 1 }}>
                      <Text style={{ color: t.text, fontSize: 16 }}>{p.name}</Text>
                      <Text style={{ color: t.muted }}>{p.state}, India</Text>
                    </View>
                  </Pressable>
                ))}
                {places.data && !places.data.items.length ? <Text style={{ color: t.muted, paddingVertical: 10 }}>No places match "{q.trim()}".</Text> : null}
                {places.data?.items.length ? <Text style={{ color: t.muted, fontSize: 11, marginTop: 4 }}>{places.data.attribution}</Text> : null}
              </View>
            ) : null}
          </View>

          <View style={[styles.card, { backgroundColor: t.bg }]}>
            <Text style={[styles.h, { color: t.text }]}>When's your trip?</Text>
            <View style={[styles.seg, { backgroundColor: t.surface }]}>
              {(["dates", "flex"] as const).map((m) => (
                <Pressable key={m} onPress={() => { setMode(m); if (m === "flex") setFlex(flex); else setD({ ...d, flex: undefined }); }} style={[styles.segBtn, mode === m && { backgroundColor: t.bg }]} accessibilityRole="tab" accessibilityState={{ selected: mode === m }}>
                  <Text style={{ color: t.text, fontWeight: "700" }}>{m === "dates" ? "Dates" : "Flexible"}</Text>
                </Pressable>
              ))}
            </View>
            {mode === "dates" ? (
              <Pressable onPress={() => setDates(true)} style={[styles.input, { borderColor: t.border, justifyContent: "space-between" }]}>
                <Text style={{ color: d.range.checkIn ? t.text : t.muted, fontSize: 16, paddingVertical: 10 }}>{d.range.checkIn ? formatRange(d.range.checkIn, d.range.checkOut) : "Add dates"}</Text>
                <Ionicons name="calendar-outline" size={18} color={t.muted} />
              </Pressable>
            ) : (
              <View style={{ gap: 14 }}>
                <Text style={{ color: t.text, fontWeight: "700" }}>Stay for a</Text>
                <View style={{ flexDirection: "row", gap: 8 }}>
                  {(["weekend", "week", "month"] as const).map((k) => (
                    <Chip key={k} on={flex.kind === k} label={FLEX_LABEL[k]} onPress={() => setFlex({ ...flex, kind: k })} />
                  ))}
                </View>
                <Text style={{ color: t.text, fontWeight: "700" }}>Go in (up to 3)</Text>
                <View style={{ flexDirection: "row", flexWrap: "wrap", gap: 8 }}>
                  {months.map((m) => {
                    const on = flex.months.includes(m.key);
                    return (
                      <Chip
                        key={m.key}
                        on={on}
                        label={m.label}
                        onPress={() => {
                          const next = on ? flex.months.filter((x) => x !== m.key) : [...flex.months, m.key].slice(-3);
                          if (next.length) setFlex({ ...flex, months: next.sort() });
                        }}
                      />
                    );
                  })}
                </View>
              </View>
            )}
          </View>

          <View style={[styles.card, { backgroundColor: t.bg, flexDirection: "row", alignItems: "center" }]}>
            <Text style={[styles.h, { color: t.text, flex: 1, marginBottom: 0 }]}>Who's coming?</Text>
            <Pressable disabled={d.range.guests <= 1} onPress={() => setD({ ...d, range: { ...d.range, guests: d.range.guests - 1 } })} style={[styles.round, { borderColor: t.border, opacity: d.range.guests <= 1 ? 0.35 : 1 }]} accessibilityLabel="Fewer guests">
              <Ionicons name="remove" size={18} color={t.text} />
            </Pressable>
            <Text style={{ color: t.text, width: 64, textAlign: "center" }}>{d.range.guests} guest{d.range.guests === 1 ? "" : "s"}</Text>
            <Pressable disabled={d.range.guests >= 16} onPress={() => setD({ ...d, range: { ...d.range, guests: d.range.guests + 1 } })} style={[styles.round, { borderColor: t.border }]} accessibilityLabel="More guests">
              <Ionicons name="add" size={18} color={t.text} />
            </Pressable>
          </View>
        </ScrollView>
        <View style={[styles.foot, { backgroundColor: t.bg, borderColor: t.border, paddingBottom: insets.bottom + 12 }]}>
          <Text style={{ color: t.text, fontWeight: "700", textDecorationLine: "underline" }} onPress={() => { setD({ range: { guests: 1 } }); setQ(""); setMode("dates"); }}>
            Clear all
          </Text>
          <Button title="Search" icon="search" onPress={() => onApply(mode === "flex" ? { ...d, flex } : { ...d, flex: undefined })} />
        </View>
      </View>
      <DateRangeModal visible={dates} value={d.range} onClose={() => setDates(false)} onApply={(r) => { setD({ ...d, range: r, flex: undefined }); setDates(false); }} />
    </Modal>
  );
}

function Chip({ on, label, onPress }: { on: boolean; label: string; onPress: () => void }) {
  const t = useTheme();
  return (
    <Pressable onPress={onPress} style={[styles.chip, { borderColor: on ? t.text : t.border, backgroundColor: on ? t.text : "transparent" }]} accessibilityRole="checkbox" accessibilityState={{ checked: on }}>
      <Text style={{ color: on ? t.bg : t.text, fontWeight: "600" }}>{label}</Text>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  head: { flexDirection: "row", padding: 16 },
  round: { width: 34, height: 34, borderRadius: 17, borderWidth: 1, alignItems: "center", justifyContent: "center" },
  card: { borderRadius: 20, padding: 18, shadowColor: "#000", shadowOpacity: 0.06, shadowRadius: 8, elevation: 2 },
  h: { fontSize: 22, fontWeight: "800", marginBottom: 14 },
  input: { flexDirection: "row", alignItems: "center", gap: 10, borderWidth: 1, borderRadius: 12, paddingHorizontal: 12 },
  placeRow: { flexDirection: "row", alignItems: "center", gap: 12, paddingVertical: 8 },
  pin: { width: 44, height: 44, borderRadius: 10, alignItems: "center", justifyContent: "center" },
  seg: { flexDirection: "row", borderRadius: 24, padding: 4, marginBottom: 14 },
  segBtn: { flex: 1, alignItems: "center", paddingVertical: 8, borderRadius: 20 },
  chip: { borderWidth: 1, borderRadius: 20, paddingHorizontal: 14, paddingVertical: 8 },
  foot: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", paddingHorizontal: 20, paddingTop: 12, borderTopWidth: StyleSheet.hairlineWidth },
});
