import { Stack, useLocalSearchParams } from "expo-router";
import { useState } from "react";
import { ActivityIndicator, Alert, ScrollView, Text, View } from "react-native";
import { useAnswerRequest, useBooking, useBookingReview, useCancelBooking, useGuestReviews, useReplyToReview, useReviewGuest } from "@/api/hooks";
import { api } from "@/api/client";
import { useQuery } from "@tanstack/react-query";
import { PriceBreakdown } from "@/components/PriceBreakdown";
import { MessageButton } from "@/components/MessageButton";
import { ReviewItem } from "@/components/ReviewItem";
import { useTheme } from "@/components/theme";
import { Badge, Button, Card, Centered, ErrorView, Field, KeyValue, Notice, Stars } from "@/components/ui";
import { POLICY_COPY, STATUS_UI } from "@/lib/booking-ui";
import { formatDateLong, formatINR, nightsBetween, plural } from "@/lib/format";

export default function HostReservation() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const t = useTheme();
  const q = useBooking(id);
  const review = useBookingReview(id);
  const cancel = useCancelBooking(id);
  const reply = useReplyToReview(id);
  const [text, setText] = useState("");
  const answer = useAnswerRequest(id);
  const guestReviews = useGuestReviews(q.data?.guestId);
  const reviewGuest = useReviewGuest(id);
  const mine = useQuery({
    queryKey: ["guest-review-mine", id],
    queryFn: () => api<{ rating: number; comment: string }>(`/v1/reviews/guests/by-booking/${id}`, { auth: true }).catch(() => null),
  });
  const [gRating, setGRating] = useState(0);
  const [gComment, setGComment] = useState("");
  const [declining, setDeclining] = useState(false);
  const [reason, setReason] = useState("");

  if (q.isLoading) return <Centered><ActivityIndicator /></Centered>;
  if (q.isError || !q.data) return <ErrorView message={(q.error as Error)?.message ?? "Not found"} onRetry={() => q.refetch()} />;
  const b = q.data;
  const s = STATUS_UI[b.status];
  const out = Date.parse(`${b.checkOut}T11:00:00+05:30`);
  const releaseAt = new Date(out + 86_400_000);
  const canReviewGuest = mine.isSuccess && !mine.data && ["CONFIRMED", "CHECKED_IN", "COMPLETED"].includes(b.status) && Date.now() >= out && Date.now() <= out + 30 * 86_400_000;
  const gr = guestReviews.data;

  return (
    <>
      <Stack.Screen options={{ title: "Reservation" }} />
      <ScrollView style={{ backgroundColor: t.bg }} contentContainerStyle={{ padding: 16, gap: 16, paddingBottom: 48 }}>
        <View style={{ gap: 6 }}>
          <Badge tone={s.tone} label={s.label} />
          <Text style={{ color: t.text, fontSize: 22, fontWeight: "800" }}>{b.listingTitle}</Text>
          <Text style={{ color: t.muted }}>{formatDateLong(b.checkIn)} → {formatDateLong(b.checkOut)}</Text>
          <Text style={{ color: t.muted }}>{plural(nightsBetween(b.checkIn, b.checkOut), "night")} · {plural(b.guests, "guest")} · {b.cancellationPolicy ? POLICY_COPY[b.cancellationPolicy]?.name : ""} policy</Text>
        </View>

        {b.status === "REQUESTED" ? (
          <Card style={{ gap: 10 }}>
            <Text style={{ color: t.text, fontWeight: "700", fontSize: 17 }}>Booking request</Text>
            {b.requestMessage ? <Text style={{ color: t.text, lineHeight: 20, fontStyle: "italic" }}>“{b.requestMessage}”</Text> : null}
            <Text style={{ color: t.muted }}>
              Respond by {b.holdExpiresAt ? new Date(b.holdExpiresAt * 1000).toLocaleString("en-IN", { dateStyle: "medium", timeStyle: "short", timeZone: "Asia/Kolkata" }) : "24 hours"}. If you accept, the guest has 12 hours to pay. Unanswered requests count against your response rate.
            </Text>
            {answer.isError ? <Notice tone="bad">{(answer.error as Error).message}</Notice> : null}
            {declining ? (
              <>
                <Field label="Reason (shared with the guest)" maxLength={300} value={reason} onChangeText={setReason} placeholder="Optional" />
                <View style={{ flexDirection: "row", gap: 10 }}>
                  <Button variant="outline" title="Back" onPress={() => setDeclining(false)} style={{ flex: 1 }} />
                  <Button title="Decline" loading={answer.isPending} onPress={() => answer.mutate({ kind: "decline", reason: reason.trim() || undefined })} style={{ flex: 1 }} />
                </View>
              </>
            ) : (
              <View style={{ flexDirection: "row", gap: 10 }}>
                <Button variant="outline" title="Decline" onPress={() => setDeclining(true)} style={{ flex: 1 }} />
                <Button title="Accept" loading={answer.isPending} onPress={() => answer.mutate({ kind: "accept" })} style={{ flex: 1 }} />
              </View>
            )}
          </Card>
        ) : null}
        {b.status === "DECLINED" ? <Notice tone="neutral">{b.expiredReason === "REQUEST_NOT_ANSWERED" ? "This request lapsed without a response." : "You declined this request."}</Notice> : null}

        <Card>
          <Text style={{ color: t.text, fontWeight: "700", fontSize: 17, marginBottom: 8 }}>About this guest</Text>
          {gr && gr.ratingCount > 0 ? (
            <View style={{ gap: 10 }}>
              <Text style={{ color: t.text }}>★ {gr.ratingAvg?.toFixed(2)} from {plural(gr.ratingCount, "host review")}</Text>
              {gr.items.slice(0, 3).map((r) => (
                <View key={r.bookingId}>
                  <Text style={{ color: t.text, fontWeight: "600" }}>{r.hostName} · {"★".repeat(r.rating)}</Text>
                  {r.comment ? <Text style={{ color: t.muted, lineHeight: 20 }}>{r.comment}</Text> : null}
                </View>
              ))}
            </View>
          ) : (
            <Text style={{ color: t.muted }}>No reviews from other hosts yet.</Text>
          )}
        </Card>

        {b.status !== "EXPIRED" ? <MessageButton start={{ bookingId: b.bookingId }} title="Message guest" variant={b.status === "REQUESTED" ? "outline" : "primary"} /> : null}

        <Card>
          <Text style={{ color: t.text, fontWeight: "700", fontSize: 17, marginBottom: 8 }}>Earnings</Text>
          {b.price ? <View style={{ marginBottom: 10 }}><PriceBreakdown p={b.price} totalLabel="Guest pays" /></View> : null}
          <KeyValue k={b.status === "REQUESTED" || b.status === "PENDING_PAYMENT" ? "Guest pays" : "Guest paid"} v={formatINR(b.totalPaise)} />
          <KeyValue k="Platform fee" v={`−${formatINR(b.platformFeePaise ?? 0)}`} />
          <View style={{ height: 1, backgroundColor: t.border, marginVertical: 6 }} />
          <KeyValue bold k="Your payout" v={formatINR(b.hostPayoutPaise ?? 0)} />
          {b.status === "CONFIRMED" ? <Text style={{ color: t.muted, marginTop: 8 }}>Released from {releaseAt.toLocaleString("en-IN", { dateStyle: "medium", timeStyle: "short", timeZone: "Asia/Kolkata" })}.</Text> : null}
          {b.status === "CANCELLED" ? <Text style={{ color: t.muted, marginTop: 8 }}>Cancelled by {b.cancelledBy}. {b.refundPaise ? `${formatINR(b.refundPaise)} refunded to the guest.` : "No refund was due."}</Text> : null}
        </Card>

        {review.data ? (
          <Card>
            <Text style={{ color: t.text, fontWeight: "700", fontSize: 17, marginBottom: 10 }}>Guest review</Text>
            <ReviewItem r={review.data} />
            {!review.data.hostReply ? (
              <View style={{ marginTop: 16 }}>
                <Field label="Reply publicly (once)" multiline maxLength={500} value={text} onChangeText={setText} placeholder="Thank the guest, or respond to their feedback." />
                {reply.isError ? <Notice tone="bad">{(reply.error as Error).message}</Notice> : null}
                <Button title="Post reply" disabled={!text.trim()} loading={reply.isPending} onPress={() => reply.mutate(text.trim())} />
              </View>
            ) : null}
          </Card>
        ) : null}

        {mine.data ? (
          <Card>
            <Text style={{ color: t.text, fontWeight: "700", fontSize: 17, marginBottom: 6 }}>Your review of the guest</Text>
            <Text style={{ color: t.text }}>{"★".repeat(mine.data.rating)}</Text>
            {mine.data.comment ? <Text style={{ color: t.muted, marginTop: 4 }}>{mine.data.comment}</Text> : null}
          </Card>
        ) : canReviewGuest ? (
          <Card>
            <Text style={{ color: t.text, fontWeight: "700", fontSize: 17, marginBottom: 6 }}>Review this guest</Text>
            <Text style={{ color: t.muted, marginBottom: 12 }}>Other hosts see this when the guest requests to book.</Text>
            <Stars value={gRating} onChange={setGRating} size={30} />
            <View style={{ height: 12 }} />
            <Field label="Comment" multiline maxLength={1000} value={gComment} onChangeText={setGComment} placeholder="Communication, house rules, cleanliness…" />
            {reviewGuest.isError ? <Notice tone="bad">{(reviewGuest.error as Error).message}</Notice> : null}
            <Button title="Post review" disabled={!gRating} loading={reviewGuest.isPending} onPress={() => reviewGuest.mutate({ rating: gRating, comment: gComment.trim() }, { onSuccess: () => void mine.refetch() })} />
          </Card>
        ) : null}

        {b.status === "CONFIRMED" ? (
          <Card style={{ gap: 10 }}>
            <Text style={{ color: t.text, fontWeight: "700", fontSize: 17 }}>Need to cancel?</Text>
            <Text style={{ color: t.muted, lineHeight: 20 }}>The guest is refunded in full and your payout is reversed. Only possible before check-in.</Text>
            <Button
              variant="outline"
              title="Cancel reservation"
              loading={cancel.isPending}
              onPress={() =>
                Alert.alert("Cancel this reservation?", `The guest gets ${formatINR(b.totalPaise)} back. This can't be undone.`, [
                  { text: "Keep it", style: "cancel" },
                  { text: "Cancel and refund", style: "destructive", onPress: () => cancel.mutate(undefined, { onError: (e) => Alert.alert("Couldn't cancel", (e as Error).message) }) },
                ])
              }
            />
          </Card>
        ) : null}
      </ScrollView>
    </>
  );
}
