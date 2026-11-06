import Ionicons from "@expo/vector-icons/Ionicons";
import { useEffect, useState } from "react";
import { Modal, Pressable, ScrollView, StyleSheet, Switch, Text, TextInput, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import type { SearchFilters } from "@/api/hooks";
import { useTheme } from "./theme";
import { Button } from "./ui";

const TYPES = ["apartment", "house", "villa", "room", "homestay", "cabin", "hotel"] as const;

export function FiltersSheet({ visible, value, onClose, onApply }: { visible: boolean; value: SearchFilters; onClose: () => void; onApply: (f: SearchFilters) => void }) {
  const t = useTheme();
  const insets = useSafeAreaInsets();
  const [d, setD] = useState<SearchFilters>(value);
  useEffect(() => {
    if (visible) setD(value);
  }, [visible, value]);

  const num = (s: string) => {
    const n = Number(s.replace(/[^\d]/g, ""));
    return n > 0 ? n : undefined;
  };

  return (
    <Modal visible={visible} animationType="slide" presentationStyle="pageSheet" onRequestClose={onClose}>
      <View style={{ flex: 1, backgroundColor: t.bg }}>
        <View style={[styles.head, { borderColor: t.border }]}>
          <Pressable onPress={onClose} hitSlop={12} accessibilityLabel="Close">
            <Ionicons name="close" size={24} color={t.text} />
          </Pressable>
          <Text style={{ color: t.text, fontWeight: "800", fontSize: 17 }}>Filters</Text>
          <View style={{ width: 24 }} />
        </View>
        <ScrollView contentContainerStyle={{ padding: 20, gap: 28 }}>
          <View>
            <Text style={[styles.h, { color: t.text }]}>Price per night</Text>
            <View style={{ flexDirection: "row", gap: 12 }}>
              {(["priceMin", "priceMax"] as const).map((k) => (
                <View key={k} style={[styles.input, { borderColor: t.border }]}>
                  <Text style={{ color: t.muted, fontSize: 12 }}>{k === "priceMin" ? "Minimum" : "Maximum"}</Text>
                  <TextInput
                    keyboardType="number-pad"
                    value={d[k] ? `₹${d[k]!.toLocaleString("en-IN")}` : ""}
                    placeholder={k === "priceMin" ? "₹0" : "Any"}
                    placeholderTextColor={t.muted}
                    onChangeText={(s) => setD({ ...d, [k]: num(s) })}
                    style={{ color: t.text, fontSize: 16, paddingVertical: 4 }}
                  />
                </View>
              ))}
            </View>
          </View>

          <View>
            <Text style={[styles.h, { color: t.text }]}>Rooms and beds</Text>
            {(
              [
                ["minBedrooms", "Bedrooms", 1],
                ["minBeds", "Beds", 1],
                ["minBathrooms", "Bathrooms", 1],
              ] as const
            ).map(([k, label, step]) => (
              <View key={k} style={styles.stepRow}>
                <Text style={{ color: t.text, fontSize: 16, flex: 1 }}>{label}</Text>
                <StepBtn icon="remove" disabled={!d[k]} onPress={() => setD({ ...d, [k]: (d[k] ?? 0) - step || undefined })} />
                <Text style={{ color: t.text, width: 48, textAlign: "center" }}>{d[k] ? `${d[k]}+` : "Any"}</Text>
                <StepBtn icon="add" disabled={(d[k] ?? 0) >= 8} onPress={() => setD({ ...d, [k]: (d[k] ?? 0) + step })} />
              </View>
            ))}
          </View>

          <View>
            <Text style={[styles.h, { color: t.text }]}>Property type</Text>
            <View style={{ flexDirection: "row", flexWrap: "wrap", gap: 8 }}>
              {TYPES.map((ty) => {
                const on = d.type?.includes(ty) ?? false;
                return (
                  <Pressable
                    key={ty}
                    onPress={() => setD({ ...d, type: on ? d.type!.filter((x) => x !== ty) : [...(d.type ?? []), ty] })}
                    style={[styles.chip, { borderColor: on ? t.text : t.border, backgroundColor: on ? t.text : "transparent" }]}
                    accessibilityRole="checkbox"
                    accessibilityState={{ checked: on }}
                  >
                    <Text style={{ color: on ? t.bg : t.text, fontWeight: "600", textTransform: "capitalize" }}>{ty}</Text>
                  </Pressable>
                );
              })}
            </View>
          </View>

          <View style={{ flexDirection: "row", alignItems: "center", gap: 12 }}>
            <View style={{ flex: 1 }}>
              <Text style={{ color: t.text, fontSize: 16, fontWeight: "700" }}>Instant Book</Text>
              <Text style={{ color: t.muted, marginTop: 2 }}>Stays you can book without waiting for the host</Text>
            </View>
            <Switch value={!!d.instantBook} onValueChange={(v) => setD({ ...d, instantBook: v || undefined })} />
          </View>
        </ScrollView>
        <View style={[styles.foot, { borderColor: t.border, paddingBottom: insets.bottom + 12 }]}>
          <Text style={{ color: t.text, fontWeight: "700", textDecorationLine: "underline" }} onPress={() => setD({})}>
            Clear all
          </Text>
          <Button title="Show stays" onPress={() => onApply(d)} />
        </View>
      </View>
    </Modal>
  );
}

function StepBtn({ icon, onPress, disabled }: { icon: "add" | "remove"; onPress: () => void; disabled?: boolean }) {
  const t = useTheme();
  return (
    <Pressable onPress={onPress} disabled={disabled} hitSlop={6} style={[styles.step, { borderColor: t.border, opacity: disabled ? 0.35 : 1 }]} accessibilityLabel={icon === "add" ? "Increase" : "Decrease"}>
      <Ionicons name={icon} size={18} color={t.text} />
    </Pressable>
  );
}

const styles = StyleSheet.create({
  head: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", padding: 16, borderBottomWidth: StyleSheet.hairlineWidth },
  h: { fontSize: 18, fontWeight: "800", marginBottom: 12 },
  input: { flex: 1, borderWidth: 1, borderRadius: 12, paddingHorizontal: 12, paddingVertical: 8 },
  stepRow: { flexDirection: "row", alignItems: "center", paddingVertical: 10, gap: 6 },
  step: { width: 34, height: 34, borderRadius: 17, borderWidth: 1, alignItems: "center", justifyContent: "center" },
  chip: { borderWidth: 1, borderRadius: 20, paddingHorizontal: 14, paddingVertical: 8 },
  foot: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", paddingHorizontal: 20, paddingTop: 12, borderTopWidth: StyleSheet.hairlineWidth },
});
