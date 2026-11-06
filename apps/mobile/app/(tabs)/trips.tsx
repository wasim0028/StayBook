import { Image } from "expo-image";
import { router } from "expo-router";
import { Pressable, SectionList, StyleSheet, Text, View } from "react-native";
import { useTrips } from "@/api/hooks";
import type { Booking } from "@/api/types";
import { useAuth } from "@/auth/AuthProvider";
import { useTheme } from "@/components/theme";
import { Badge, Button, Centered, EmptyState, ErrorView } from "@/components/ui";
import { STATUS_UI, tripGroup, type TripGroup } from "@/lib/booking-ui";
import { formatINR, formatRange, nightsBetween, plural, todayISO } from "@/lib/format";

const TITLES: Record<TripGroup, string> = { upcoming: "Upcoming", past: "Where you've been", cancelled: "Cancelled and expired" };

export default function Trips() {
  const t = useTheme();
  const { user, ready, signIn } = useAuth();
  const trips = useTrips(!!user);

  if (!ready) return <Centered>{null}</Centered>;
  if (!user) {
    return (
      <Centered>
        <EmptyState icon="airplane-outline" title="Your trips live here" body="Sign in to see and manage your bookings." action={<Button title="Sign in" onPress={() => void signIn()} />} />
      </Centered>
    );
  }
  if (trips.isError) return <ErrorView message={(trips.error as Error).message} onRetry={() => trips.refetch()} />;

  const today = todayISO();
  const groups: Record<TripGroup, Booking[]> = { upcoming: [], past: [], cancelled: [] };
  for (const b of trips.data?.items ?? []) groups[tripGroup(b, today)].push(b);
  groups.upcoming.sort((a, b) => a.checkIn.localeCompare(b.checkIn));
  const sections = (Object.keys(TITLES) as TripGroup[]).filter((k) => groups[k].length).map((k) => ({ key: k, title: TITLES[k], data: groups[k] }));

  return (
    <SectionList
      style={{ backgroundColor: t.bg }}
      sections={sections}
      keyExtractor={(b) => b.bookingId}
      refreshing={trips.isRefetching}
      onRefresh={() => trips.refetch()}
      stickySectionHeadersEnabled={false}
      contentContainerStyle={{ padding: 16, flexGrow: 1 }}
      renderSectionHeader={({ section }) => <Text style={[styles.h2, { color: t.text }]}>{section.title}</Text>}
      ItemSeparatorComponent={() => <View style={{ height: 12 }} />}
      renderItem={({ item }) => <TripRow b={item} />}
      ListEmptyComponent={
        trips.isLoading ? undefined : (
          <Centered>
            <EmptyState icon="airplane-outline" title="No trips booked… yet" body="Time to dust off your bags and start planning your next adventure." action={<Button title="Start searching" onPress={() => router.navigate("/")} />} />
          </Centered>
        )
      }
    />
  );
}

function TripRow({ b }: { b: Booking }) {
  const t = useTheme();
  const s = STATUS_UI[b.status];
  return (
    <Pressable
      onPress={() => router.push({ pathname: "/trip/[id]", params: { id: b.bookingId } })}
      style={({ pressed }) => [styles.row, { borderColor: t.border, backgroundColor: t.card, opacity: pressed ? 0.9 : 1 }]}
      accessibilityRole="button"
    >
      <Image source={b.coverPhotoUrl ?? undefined} style={[styles.thumb, { backgroundColor: t.surface }]} contentFit="cover" />
      <View style={{ flex: 1, gap: 3 }}>
        <Text style={{ color: t.text, fontWeight: "700", fontSize: 15 }} numberOfLines={1}>
          {b.listingTitle ?? "Your stay"}
        </Text>
        <Text style={{ color: t.muted }}>
          {formatRange(b.checkIn, b.checkOut)} · {plural(nightsBetween(b.checkIn, b.checkOut), "night")}
        </Text>
        <View style={{ flexDirection: "row", alignItems: "center", justifyContent: "space-between", marginTop: 2 }}>
          <Text style={{ color: t.text, fontWeight: "600" }}>{formatINR(b.totalPaise)}</Text>
          <Badge tone={s.tone} label={s.label} />
        </View>
      </View>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  h2: { fontSize: 19, fontWeight: "700", marginTop: 8, marginBottom: 12 },
  row: { flexDirection: "row", alignItems: "center", gap: 12, borderWidth: 1, borderRadius: 16, padding: 10 },
  thumb: { width: 76, height: 76, borderRadius: 12 },
});
