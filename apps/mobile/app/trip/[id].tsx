import Ionicons from "@expo/vector-icons/Ionicons";
import { Image } from "expo-image";
import { router, Stack, useLocalSearchParams } from "expo-router";
import { useEffect, useState } from "react";
import { ActivityIndicator, Alert, ScrollView, StyleSheet, Text, View } from "react-native";
import { useBooking, useBookingReview, useCancelBooking, useCreateReview } from "@/api/hooks";
import { useAuth } from "@/auth/AuthProvider";
import { MessageButton } from "@/components/MessageButton";
import { PriceBreakdown } from "@/components/PriceBreakdown";
import { ReviewItem } from "@/components/ReviewItem";
import { useTheme } from "@/components/theme";
import { Badge, Button, Card, Centered, ErrorView, Field, KeyValue, Notice, Stars } from "@/components/ui";
import { POLICY_COPY, refundLine, reviewWindowOpen, STATUS_UI } from "@/lib/booking-ui";
import { formatDateLong, formatINR, nightsBetween, plural } from "@/lib/format";
import { openCheckout } from "@/payments/razorpay";

function useSecondsLeft(until?: number) {
  const [now, setNow] = useState(() => Math.floor(Date.now() / 1000));
  useEffect(() => {
    if (!until) return;
    const i = setInterval(() => setNow(Math.floor(Date.now() / 1000)), 1000);
    return () => clearInterval(i);
  }, [until]);
  return until ? Math.max(0, until - now) : 0;
}

export default function TripScreen() {
  const { id, paid, requested } = useLocalSearchParams<{ id: string; paid?: string; requested?: string }>();
  const t = useTheme();
  const { user } = useAuth();
  const q = useBooking(id);
  const b = q.data;
  const reviewQ = useBookingReview(id, !!b && reviewWindowOpen(b));
  const cancel = useCancelBooking(id);
  const createReview = useCreateReview(id);
  const [rating, setRating] = useState(0);
  const [comment, setComment] = useState("");
  const [payErr, setPayErr] = useState<string>();
  const [paying, setPaying] = useState(false);
  const left = useSecondsLeft(b?.status === "PENDING_PAYMENT" ? b.holdExpiresAt : undefined);

  if (q.isLoading) return <Centered><ActivityIndicator /></Centered>;
  if (q.isError || !b) return <ErrorView message={(q.error as Error)?.message ?? "Booking not found"} onRetry={() => q.refetch()} />;

  const s = STATUS_UI[b.status];
  const nights = nightsBetween(b.checkIn, b.checkOut);
  const policy = b.cancellationPolicy ? POLICY_COPY[b.cancellationPolicy] : undefined;
  const refund = refundLine(b, formatINR);

  function confirmCancel() {
    const pending = b!.status === "PENDING_PAYMENT" || b!.status === "REQUESTED";
    Alert.alert(
      b!.status === "REQUESTED" ? "Withdraw your request?" : pending ? "Release your hold?" : "Cancel this reservation?",
      pending ? "Nothing has been charged. The dates go back on sale." : `${policy ? `${policy.name} policy: ${policy.summary}\n\n` : ""}Your exact refund is shown once it's cancelled. This can't be undone.`,
      [
        { text: "Keep it", style: "cancel" },
        { text: b!.status === "REQUESTED" ? "Withdraw" : pending ? "Release" : "Cancel reservation", style: "destructive", onPress: () => cancel.mutate(undefined, { onError: (e) => Alert.alert("Couldn't cancel", (e as Error).message) }) },
      ],
    );
  }

  async function payNow() {
    if (!b!.payment) return;
    setPaying(true);
    setPayErr(undefined);
    const r = await openCheckout({
      key: b!.payment.keyId,
      order_id: b!.payment.orderId,
      amount: b!.payment.amountPaise,
      currency: "INR",
      name: "StayBook",
      description: b!.listingTitle ?? "Your stay",
      prefill: { email: user?.email },
      theme: { color: t.accent },
    });
    setPaying(false);
    if (r.ok) void q.refetch();
    else if (!r.cancelled) setPayErr(r.message);
  }

  const existing = reviewQ.data;
  const canReview = reviewWindowOpen(b) && reviewQ.isSuccess && !existing;

  return (
    <>
      <Stack.Screen options={{ title: "Trip" }} />
      <ScrollView style={{ backgroundColor: t.bg }} contentContainerStyle={{ paddingBottom: 48 }}>
        <Image source={b.coverPhotoUrl ?? undefined} style={[styles.hero, { backgroundColor: t.surface }]} contentFit="cover" />
        <View style={styles.body}>
          {paid && b.status === "CONFIRMED" ? <Notice tone="ok">You're booked! We've emailed your confirmation.</Notice> : null}
          {b.status === "REQUESTED" ? (
            <Notice tone="info">{`${requested ? "Request sent. " : ""}The host has until ${b.holdExpiresAt ? new Date(b.holdExpiresAt * 1000).toLocaleString("en-IN", { dateStyle: "medium", timeStyle: "short", timeZone: "Asia/Kolkata" }) : "24 hours"} to respond. You won't be charged unless they accept, and these dates are held for you meanwhile.`}</Notice>
          ) : null}
          {b.status === "DECLINED" ? (
            <Notice tone="neutral">{b.expiredReason === "REQUEST_NOT_ANSWERED" ? "The host didn't respond in time, so the request lapsed. You weren't charged." : `The host declined this request${b.declineReason ? `: “${b.declineReason}”` : "."} You weren't charged.`}</Notice>
          ) : null}
          {b.status === "PENDING_PAYMENT" && b.instantBook === false ? <Notice tone="ok">The host accepted your request. Pay below to confirm.</Notice> : null}
          <View style={{ gap: 8 }}>
            <Badge tone={s.tone} label={s.label} />
            <Text style={[styles.h1, { color: t.text }]}>{b.listingTitle ?? "Your stay"}</Text>
            <Text style={{ color: t.accent, fontWeight: "600" }} onPress={() => router.push({ pathname: "/listing/[id]", params: { id: b.listingId } })}>
              View listing
            </Text>
          </View>

          <View style={[styles.dates, { borderColor: t.border, backgroundColor: t.card }]}>
            <View style={[styles.dateCol, { borderRightWidth: 1, borderColor: t.border }]}>
              <Text style={[styles.caps, { color: t.muted }]}>Check-in</Text>
              <Text style={{ color: t.text, fontWeight: "700", marginTop: 4 }}>{formatDateLong(b.checkIn)}</Text>
              <Text style={{ color: t.muted }}>After 2:00 pm</Text>
            </View>
            <View style={styles.dateCol}>
              <Text style={[styles.caps, { color: t.muted }]}>Check-out</Text>
              <Text style={{ color: t.text, fontWeight: "700", marginTop: 4 }}>{formatDateLong(b.checkOut)}</Text>
              <Text style={{ color: t.muted }}>Before 11:00 am</Text>
            </View>
          </View>

          <View style={{ gap: 10 }}>
            <Line icon="people-outline" text={`${plural(b.guests, "guest")} · ${plural(nights, "night")}`} />
            <Line icon="receipt-outline" text={`Booking ${b.bookingId.slice(0, 8).toUpperCase()}`} />
            {policy ? <Line icon="shield-checkmark-outline" text={`${policy.name} cancellation. ${policy.summary}`} /> : null}
          </View>

          {refund ? <Notice tone={b.refundStatus === "FAILED" ? "warn" : "info"}>{refund}</Notice> : null}

          <Card>
            <Text style={[styles.h3, { color: t.text }]}>{b.status === "REQUESTED" || b.status === "DECLINED" ? "Price" : "Payment"}</Text>
            {b.price ? <PriceBreakdown p={b.price} totalLabel={b.status === "PENDING_PAYMENT" || b.status === "REQUESTED" ? "Total due" : b.status === "EXPIRED" || b.status === "DECLINED" ? "Not charged" : "Total paid"} /> : (
              <>
                <KeyValue k={plural(nights, "night")} v={formatINR(b.totalPaise)} />
                <View style={{ height: 1, backgroundColor: t.border, marginVertical: 6 }} />
                <KeyValue bold k={b.status === "PENDING_PAYMENT" ? "Total due" : b.status === "EXPIRED" ? "Not charged" : "Total paid"} v={formatINR(b.totalPaise)} />
              </>
            )}
            {b.refundPaise ? <KeyValue k="Refund" v={`−${formatINR(b.refundPaise)}`} /> : null}
          </Card>

          {b.status === "PENDING_PAYMENT" ? (
            <Card>
              <Text style={[styles.h3, { color: t.text }]}>Finish booking</Text>
              {b.payment && left > 0 ? (
                <>
                  <Text style={{ color: t.muted, marginBottom: 12 }}>
                    {left >= 3600 ? `Pay within ${Math.floor(left / 3600)}h ${Math.floor((left % 3600) / 60)}m to keep these dates.` : `Dates held for ${Math.floor(left / 60)}:${String(left % 60).padStart(2, "0")} more.`}
                  </Text>
                  <Button title={`Pay ${formatINR(b.payment.amountPaise)}`} onPress={() => void payNow()} loading={paying} />
                </>
              ) : (
                <Text style={{ color: t.muted }}>Checking your payment… If you didn't pay, this hold lapses shortly.</Text>
              )}
              {payErr ? <View style={{ marginTop: 12 }}><Notice tone="bad">{payErr}</Notice></View> : null}
            </Card>
          ) : null}

          {existing ? (
            <Card>
              <Text style={[styles.h3, { color: t.text }]}>Your review</Text>
              <ReviewItem r={existing} />
            </Card>
          ) : canReview ? (
            <Card>
              <Text style={[styles.h3, { color: t.text }]}>How was your stay?</Text>
              <Text style={{ color: t.muted, marginBottom: 12 }}>Your review helps other guests and your host.</Text>
              <Stars value={rating} onChange={setRating} size={34} />
              <View style={{ height: 14 }} />
              <Field label="Review" multiline maxLength={1000} value={comment} onChangeText={setComment} placeholder="What did you love? Anything the host could improve?" />
              {createReview.isError ? <Notice tone="bad">{(createReview.error as Error).message}</Notice> : null}
              <Button title="Post review" disabled={!rating} loading={createReview.isPending} onPress={() => createReview.mutate({ rating, comment: comment.trim() })} style={{ marginTop: 8 }} />
            </Card>
          ) : null}

          {b.status !== "EXPIRED" ? <MessageButton start={{ bookingId: b.bookingId }} title="Message host" /> : null}

          {b.status === "CONFIRMED" || b.status === "PENDING_PAYMENT" || b.status === "REQUESTED" ? (
            <Button variant="outline" title={b.status === "REQUESTED" ? "Withdraw request" : b.status === "PENDING_PAYMENT" ? "Release these dates" : "Cancel reservation"} loading={cancel.isPending} onPress={confirmCancel} />
          ) : null}
        </View>
      </ScrollView>
    </>
  );
}

function Line({ icon, text }: { icon: React.ComponentProps<typeof Ionicons>["name"]; text: string }) {
  const t = useTheme();
  return (
    <View style={{ flexDirection: "row", gap: 10, alignItems: "flex-start" }}>
      <Ionicons name={icon} size={20} color={t.muted} />
      <Text style={{ color: t.text, flex: 1, lineHeight: 20 }}>{text}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  hero: { width: "100%", aspectRatio: 16 / 10 },
  body: { padding: 16, gap: 18 },
  h1: { fontSize: 24, fontWeight: "800" },
  h3: { fontSize: 17, fontWeight: "700", marginBottom: 8 },
  caps: { fontSize: 11, fontWeight: "800", letterSpacing: 0.6, textTransform: "uppercase" },
  dates: { flexDirection: "row", borderWidth: 1, borderRadius: 16, overflow: "hidden" },
  dateCol: { flex: 1, padding: 14 },
});
