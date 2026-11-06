import { Image } from "expo-image";
import { router } from "expo-router";
import { useState } from "react";
import { Alert, Pressable, RefreshControl, ScrollView, StyleSheet, Text, View } from "react-native";
import { useHostListings, useHostReservations, useMe, useSetPublished } from "@/api/hooks";
import type { Booking, HostListing } from "@/api/types";
import { useAuth } from "@/auth/AuthProvider";
import { useTheme } from "@/components/theme";
import { Badge, Button, Card, Centered, EmptyState, ErrorView, Notice, SectionTitle } from "@/components/ui";
import { STATUS_UI, tripGroup } from "@/lib/booking-ui";
import { formatINR, formatRange, plural, todayISO } from "@/lib/format";
import { openWebEditor, payoutUi } from "@/lib/host";

type Tab = "today" | "listings";

export default function Hosting() {
  const t = useTheme();
  const { user } = useAuth();
  const isHost = !!user?.groups.includes("host");
  const me = useMe(isHost);
  const res = useHostReservations(isHost);
  const listings = useHostListings(isHost);
  const [tab, setTab] = useState<Tab>("today");

  if (!isHost) {
    return (
      <Centered>
        <EmptyState icon="home-outline" title="Host your space" body="Earn from your home, villa or spare room. Set up payouts in about 10 minutes." action={<Button title="Get started" onPress={() => router.push("/host/onboarding")} />} />
      </Centered>
    );
  }
  if (res.isError) return <ErrorView message={(res.error as Error).message} onRetry={() => res.refetch()} />;

  const today = todayISO();
  const upcoming = (res.data?.items ?? []).filter((b) => b.status !== "PENDING_PAYMENT" && b.status !== "REQUESTED" && tripGroup(b, today) === "upcoming").sort((a, b) => a.checkIn.localeCompare(b.checkIn));
  const requests = (res.data?.items ?? []).filter((b) => b.status === "REQUESTED").sort((a, b) => (a.holdExpiresAt ?? 0) - (b.holdExpiresAt ?? 0));
  const month = today.slice(0, 7);
  const earned = (res.data?.items ?? []).filter((b) => ["CONFIRMED", "CHECKED_IN", "COMPLETED"].includes(b.status) && b.checkOut.startsWith(month)).reduce((s, b) => s + (b.hostPayoutPaise ?? 0), 0);
  const all = listings.data?.items ?? [];
  const live = all.filter((l) => l.status === "PUBLISHED").length;
  const payout = me.data?.host ? payoutUi(me.data.host) : null;

  return (
    <ScrollView style={{ backgroundColor: t.bg }} contentContainerStyle={{ padding: 16, gap: 16, paddingBottom: 40 }} refreshControl={<RefreshControl refreshing={res.isRefetching || listings.isRefetching} onRefresh={() => { void res.refetch(); void listings.refetch(); void me.refetch(); }} />}>
      <View style={[styles.seg, { backgroundColor: t.surface }]}>
        {(["today", "listings"] as Tab[]).map((k) => (
          <Pressable key={k} onPress={() => setTab(k)} style={[styles.segBtn, tab === k && { backgroundColor: t.card }]} accessibilityRole="tab" accessibilityState={{ selected: tab === k }}>
            <Text style={{ color: tab === k ? t.text : t.muted, fontWeight: "700" }}>{k === "today" ? "Today" : `Listings (${all.length})`}</Text>
          </Pressable>
        ))}
      </View>

      {payout && me.data?.host?.payoutStatus !== "activated" ? (
        <Pressable onPress={() => router.push("/host/onboarding")}>
          <Card style={{ gap: 6 }}>
            <Badge tone={payout.tone} label={payout.label} />
            <Text style={{ color: t.text, lineHeight: 20 }}>{payout.body}</Text>
          </Card>
        </Pressable>
      ) : null}

      {tab === "today" ? (
        <>
          <View style={styles.stats}>
            <Stat label="Upcoming" value={String(upcoming.length)} />
            <Stat label="This month" value={formatINR(earned)} />
            <Stat label="Live" value={`${live}/${all.length}`} />
          </View>
          {requests.length ? (
            <>
              <SectionTitle>{`Booking requests (${requests.length})`}</SectionTitle>
              <Notice tone="warn">Respond within 24 hours. Unanswered requests lapse and lower your response rate.</Notice>
              {requests.map((b) => <ReservationRow key={b.bookingId} b={b} />)}
            </>
          ) : null}
          <SectionTitle>Upcoming stays</SectionTitle>
          {upcoming.length ? upcoming.map((b) => <ReservationRow key={b.bookingId} b={b} />) : <EmptyState icon="calendar-outline" title="No upcoming stays" body={live ? "Bookings will appear here." : "Publish a listing to start taking bookings."} />}
          {(res.data?.items.length ?? 0) > upcoming.length ? (
            <>
              <SectionTitle>Past and cancelled</SectionTitle>
              {(res.data?.items ?? []).filter((b) => !upcoming.includes(b) && b.status !== "PENDING_PAYMENT" && b.status !== "EXPIRED").slice(0, 10).map((b) => <ReservationRow key={b.bookingId} b={b} />)}
            </>
          ) : null}
        </>
      ) : (
        <>
          <Button title="Create a listing" icon="add" onPress={() => void openWebEditor("/host/listings/new")} />
          {all.length ? all.map((l) => <ListingRow key={l.id} l={l} canPublish={me.data?.host?.payoutStatus === "activated"} />) : <EmptyState icon="home-outline" title="No listings yet" body="Your first listing stays a private draft until you publish it." />}
        </>
      )}
    </ScrollView>
  );
}

function Stat({ label, value }: { label: string; value: string }) {
  const t = useTheme();
  return (
    <View style={[styles.stat, { borderColor: t.border, backgroundColor: t.card }]}>
      <Text style={{ color: t.muted, fontSize: 13, fontWeight: "600" }}>{label}</Text>
      <Text style={{ color: t.text, fontSize: 20, fontWeight: "800", marginTop: 4 }} numberOfLines={1} adjustsFontSizeToFit>
        {value}
      </Text>
    </View>
  );
}

function ReservationRow({ b }: { b: Booking }) {
  const t = useTheme();
  const s = STATUS_UI[b.status];
  return (
    <Pressable onPress={() => router.push({ pathname: "/host/reservation/[id]", params: { id: b.bookingId } })} style={({ pressed }) => [styles.row, { borderColor: t.border, backgroundColor: t.card, opacity: pressed ? 0.9 : 1 }]}>
      <Image source={b.coverPhotoUrl ?? undefined} style={[styles.thumb, { backgroundColor: t.surface }]} contentFit="cover" />
      <View style={{ flex: 1, gap: 2 }}>
        <Text style={{ color: t.text, fontWeight: "700" }} numberOfLines={1}>{b.listingTitle}</Text>
        <Text style={{ color: t.muted }}>{formatRange(b.checkIn, b.checkOut)} · {plural(b.guests, "guest")}</Text>
        <View style={{ flexDirection: "row", justifyContent: "space-between", alignItems: "center", marginTop: 2 }}>
          <Text style={{ color: t.text, fontWeight: "600" }}>{formatINR(b.hostPayoutPaise ?? 0)}</Text>
          <Badge tone={s.tone} label={s.label} />
        </View>
      </View>
    </Pressable>
  );
}

function ListingRow({ l, canPublish }: { l: HostListing; canPublish: boolean }) {
  const t = useTheme();
  const pub = useSetPublished();
  const status = l.status === "PUBLISHED" ? { tone: "ok" as const, label: "Listed" } : l.status === "SUSPENDED" ? { tone: "bad" as const, label: "Suspended" } : { tone: "neutral" as const, label: "Draft" };

  function toggle() {
    const publish = l.status !== "PUBLISHED";
    if (publish && !canPublish) return Alert.alert("Payouts not verified yet", "You can publish once Razorpay activates your payout account.");
    if (publish && l.photos.length < 3) return Alert.alert("Add more photos", "Listings need at least 3 photos before they can be published.", [{ text: "Not now", style: "cancel" }, { text: "Add photos", onPress: () => void openWebEditor(`/host/listings/${l.id}?tab=photos`) }]);
    pub.mutate({ id: l.id, publish }, { onError: (e) => Alert.alert("Couldn't update", (e as Error).message) });
  }

  return (
    <Card style={{ padding: 0, overflow: "hidden" }}>
      <Image source={l.photoUrls[0] ?? undefined} style={{ width: "100%", aspectRatio: 2, backgroundColor: t.surface }} contentFit="cover" />
      <View style={{ padding: 14, gap: 6 }}>
        <View style={{ flexDirection: "row", justifyContent: "space-between", alignItems: "center", gap: 8 }}>
          <Text style={{ color: t.text, fontWeight: "700", fontSize: 16, flex: 1 }} numberOfLines={1}>{l.title}</Text>
          <Badge tone={status.tone} label={status.label} />
        </View>
        <Text style={{ color: t.muted }}>
          {l.city} · {formatINR(l.basePricePaise)} night{l.ratingCount ? ` · ★ ${l.ratingAvg?.toFixed(2)}` : ""}
        </Text>
        <View style={{ flexDirection: "row", gap: 10, marginTop: 6 }}>
          <Button variant="outline" title="Edit" icon="create-outline" style={{ flex: 1, minHeight: 42 }} onPress={() => void openWebEditor(`/host/listings/${l.id}`)} />
          {l.status !== "SUSPENDED" ? <Button variant={l.status === "PUBLISHED" ? "outline" : "primary"} title={l.status === "PUBLISHED" ? "Unlist" : "Publish"} style={{ flex: 1, minHeight: 42 }} loading={pub.isPending} onPress={toggle} /> : null}
        </View>
      </View>
    </Card>
  );
}

const styles = StyleSheet.create({
  seg: { flexDirection: "row", borderRadius: 12, padding: 4 },
  segBtn: { flex: 1, alignItems: "center", paddingVertical: 10, borderRadius: 9 },
  stats: { flexDirection: "row", gap: 10 },
  stat: { flex: 1, borderWidth: 1, borderRadius: 14, padding: 12 },
  row: { flexDirection: "row", alignItems: "center", gap: 12, borderWidth: 1, borderRadius: 16, padding: 10 },
  thumb: { width: 64, height: 64, borderRadius: 10 },
});

