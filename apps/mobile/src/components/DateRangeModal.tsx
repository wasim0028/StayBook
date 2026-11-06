import { useEffect, useMemo, useState } from "react";
import { Modal, Pressable, StyleSheet, Text, View } from "react-native";
import { Calendar, type DateData } from "react-native-calendars";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { addDaysISO, formatRange, nightsBetween, toISODate } from "@/lib/format";
import { useTheme } from "./theme";
import { Button } from "./ui";

const MAX_NIGHTS = 90;

export interface Range {
  checkIn?: string;
  checkOut?: string;
  guests: number;
}

export function DateRangeModal({
  visible,
  value,
  onClose,
  onApply,
  /** Dates that can't be picked (e.g. booked nights on a listing page). */
  unavailable,
}: {
  visible: boolean;
  value: Range;
  onClose: () => void;
  onApply: (r: Range) => void;
  unavailable?: Set<string>;
}) {
  const t = useTheme();
  const insets = useSafeAreaInsets();
  const [draft, setDraft] = useState<Range>(value);
  const today = toISODate(new Date());

  useEffect(() => {
    if (visible) setDraft(value);
  }, [visible, value]);

  const onDay = (d: DateData) => {
    const day = d.dateString;
    if (unavailable?.has(day)) return;
    if (!draft.checkIn || draft.checkOut || day <= draft.checkIn) {
      setDraft({ ...draft, checkIn: day, checkOut: undefined });
      return;
    }
    const n = nightsBetween(draft.checkIn, day);
    // A stay can't span a night that is already taken.
    for (let i = 0; i < n; i++) {
      if (unavailable?.has(addDaysISO(draft.checkIn, i))) {
        setDraft({ ...draft, checkIn: day, checkOut: undefined });
        return;
      }
    }
    if (n <= MAX_NIGHTS) setDraft({ ...draft, checkOut: day });
  };

  const marked = useMemo(() => {
    const m: Record<string, object> = {};
    unavailable?.forEach((d) => (m[d] = { disabled: true, disableTouchEvent: true }));
    if (draft.checkIn) {
      const end = draft.checkOut ?? draft.checkIn;
      const n = Math.max(0, nightsBetween(draft.checkIn, end));
      for (let i = 0; i <= n; i++) {
        const d = addDaysISO(draft.checkIn, i);
        m[d] = { startingDay: i === 0, endingDay: i === n, color: t.accent, textColor: t.accentText };
      }
    }
    return m;
  }, [draft.checkIn, draft.checkOut, unavailable, t]);

  const nights = draft.checkIn && draft.checkOut ? nightsBetween(draft.checkIn, draft.checkOut) : 0;

  return (
    <Modal visible={visible} animationType="slide" presentationStyle="pageSheet" onRequestClose={onClose}>
      <View style={[styles.sheet, { backgroundColor: t.bg, paddingBottom: insets.bottom + 16 }]}>
        <View style={styles.header}>
          <Pressable onPress={onClose} hitSlop={12} accessibilityRole="button">
            <Text style={{ color: t.text, fontSize: 16 }}>Close</Text>
          </Pressable>
          <Text style={[styles.headerTitle, { color: t.text }]}>
            {formatRange(draft.checkIn, draft.checkOut)}
            {nights ? ` · ${nights} night${nights === 1 ? "" : "s"}` : ""}
          </Text>
          <Pressable onPress={() => setDraft({ guests: draft.guests })} hitSlop={12} accessibilityRole="button">
            <Text style={{ color: t.muted, fontSize: 16 }}>Clear</Text>
          </Pressable>
        </View>

        <Calendar
          minDate={today}
          markingType="period"
          markedDates={marked}
          onDayPress={onDay}
          enableSwipeMonths
          theme={{
            calendarBackground: t.bg,
            dayTextColor: t.text,
            monthTextColor: t.text,
            textDisabledColor: t.border,
            arrowColor: t.accent,
            todayTextColor: t.accent,
          }}
        />

        <View style={styles.guests}>
          <Text style={{ color: t.text, fontSize: 16 }}>Guests</Text>
          <View style={styles.stepper}>
            <Button
              title="−"
              variant="secondary"
              disabled={draft.guests <= 1}
              onPress={() => setDraft({ ...draft, guests: draft.guests - 1 })}
            />
            <Text style={{ color: t.text, fontSize: 18, minWidth: 28, textAlign: "center" }}>{draft.guests}</Text>
            <Button
              title="+"
              variant="secondary"
              disabled={draft.guests >= 16}
              onPress={() => setDraft({ ...draft, guests: draft.guests + 1 })}
            />
          </View>
        </View>

        <Button
          title="Apply"
          style={{ marginHorizontal: 16 }}
          disabled={!!draft.checkIn && !draft.checkOut}
          onPress={() => onApply(draft)}
        />
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  sheet: { flex: 1, paddingTop: 12 },
  header: { flexDirection: "row", justifyContent: "space-between", alignItems: "center", padding: 16 },
  headerTitle: { fontSize: 16, fontWeight: "600" },
  guests: { flexDirection: "row", justifyContent: "space-between", alignItems: "center", padding: 16, marginTop: "auto" },
  stepper: { flexDirection: "row", alignItems: "center", gap: 12 },
});
