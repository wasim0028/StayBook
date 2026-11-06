import { useQueryClient } from "@tanstack/react-query";
import * as Crypto from "expo-crypto";
import { router, useLocalSearchParams } from "expo-router";
import { useEffect, useRef, useState } from "react";
import { ActivityIndicator, ScrollView, StyleSheet, Text, View } from "react-native";
import { ApiError } from "@/api/client";
import { fetchBooking, postMessage, startThread, useCreateBooking, useListing, useQuote } from "@/api/hooks";
import type { CreateBookingResponse } from "@/api/types";
import { useAuth } from "@/auth/AuthProvider";
import { useTheme } from "@/components/theme";
import { PriceBreakdown } from "@/components/PriceBreakdown";
import { Button, Centered, ErrorView, Field, Notice } from "@/components/ui";
import { formatINR, formatRange } from "@/lib/format";
import { isRazorpayAvailable, openCheckout } from "@/payments/razorpay";

type Phase =
  | { kind: "review" }
  | { kind: "paying" }
  | { kind: "confirming" }
  | { kind: "confirmed"; bookingId: string }
  | { kind: "pending"; bookingId: string } // paid, webhook not seen yet
  | { kind: "failed"; message: string };

const POLL_INTERVAL_MS = 2_000;
const POLL_TIMEOUT_MS = 60_000;

export default function Checkout() {
  const t = useTheme();
  const qc = useQueryClient();
  const { user } = useAuth();
  const p = useLocalSearchParams<{ id: string; checkIn: string; checkOut: string; guests: string }>();
  const guests = Number(p.guests) || 1;
  const listing = useListing(p.id);
  const quote = useQuote(p.id, p.checkIn, p.checkOut, guests);
  const createBooking = useCreateBooking();
  const [note, setNote] = useState("");

  const [phase, setPhase] = useState<Phase>({ kind: "review" });
  const [now, setNow] = useState(() => Date.now() / 1000);
  // One idempotency key per checkout screen: retries and double taps can never create two holds.
  const idempotencyKey = useRef(Crypto.randomUUID());
  const booking = useRef<CreateBookingResponse | null>(null);
  const unmounted = useRef(false);
  useEffect(() => () => void (unmounted.current = true), []);

  // Countdown for the 15-minute hold.
  useEffect(() => {
    const id = setInterval(() => setNow(Date.now() / 1000), 1000);
    return () => clearInterval(id);
  }, []);

  const anyTaken = quote.data ? !quote.data.available : false;
  const instant = listing.data?.instantBook !== false;

  async function pollUntilConfirmed(bookingId: string) {
    setPhase({ kind: "confirming" });
    const deadline = Date.now() + POLL_TIMEOUT_MS;
    while (Date.now() < deadline && !unmounted.current) {
      try {
        const b = await fetchBooking(bookingId);
        if (b.status === "CONFIRMED") {
          await qc.invalidateQueries({ queryKey: ["trips"] });
          setPhase({ kind: "confirmed", bookingId });
          return;
        }
        if (b.status === "EXPIRED" || b.status === "CANCELLED") {
          setPhase({ kind: "failed", message: "This hold expired before payment completed. Any charge will be refunded automatically." });
          return;
        }
      } catch {
        /* transient; keep polling */
      }
      await new Promise((r) => setTimeout(r, POLL_INTERVAL_MS));
    }
    setPhase({ kind: "pending", bookingId });
  }

  async function pay() {
    setPhase({ kind: "paying" });
    try {
      // Reuse the hold if the guest is retrying after a failed or cancelled payment.
      booking.current ??= await createBooking.mutateAsync({
        body: { listingId: p.id, checkIn: p.checkIn, checkOut: p.checkOut, guests, ...(note.trim() ? { message: note.trim() } : {}) },
        idempotencyKey: idempotencyKey.current,
      });
      const b = booking.current;
      if (b.status === "REQUESTED" || !b.payment) {
        // Request to book: nothing to pay yet. Put the note in the conversation too.
        if (note.trim()) {
          try {
            const { threadId } = await startThread({ bookingId: b.bookingId });
            await postMessage(threadId, note.trim(), Crypto.randomUUID());
          } catch {
            /* the request carries the note anyway */
          }
        }
        await qc.invalidateQueries({ queryKey: ["trips"] });
        router.replace({ pathname: "/trip/[id]", params: { id: b.bookingId, requested: "1" } });
        return;
      }
      const result = await openCheckout({
        key: b.payment.keyId,
        order_id: b.payment.orderId,
        amount: b.payment.amountPaise,
        currency: "INR",
        name: "StayBook",
        description: listing.data?.title,
        prefill: { email: user?.email },
        theme: { color: t.accent },
      });
      if (result.ok) {
        await pollUntilConfirmed(b.bookingId);
      } else {
        setPhase(result.cancelled ? { kind: "review" } : { kind: "failed", message: result.message });
      }
    } catch (e) {
      const message =
        e instanceof ApiError && e.status === 409
          ? "Someone just booked some of these nights. Please pick other dates."
          : (e as Error).message;
      setPhase({ kind: "failed", message });
    }
  }

  if (listing.isLoading || quote.isLoading) {
    return (
      <Centered>
        <ActivityIndicator color={t.muted} />
      </Centered>
    );
  }
  if (listing.isError || !listing.data) return <ErrorView message="Couldn't load this stay." onRetry={() => listing.refetch()} />;

  if (phase.kind === "confirmed") {
    return (
      <Centered>
        <Text style={[styles.big, { color: t.text }]}>You're booked!</Text>
        <Text style={{ color: t.muted, textAlign: "center", marginVertical: 12 }}>
          {listing.data.title}
          {"\n"}
          {formatRange(p.checkIn, p.checkOut)}. A confirmation is on its way to your email.
        </Text>
        <Button title="View your trip" onPress={() => router.replace({ pathname: "/trip/[id]", params: { id: phase.bookingId, paid: "1" } })} />
      </Centered>
    );
  }

  if (phase.kind === "pending") {
    return (
      <Centered>
        <Text style={[styles.big, { color: t.text }]}>Payment received</Text>
        <Text style={{ color: t.muted, textAlign: "center", marginVertical: 12 }}>
          We're still confirming it with the bank. Your trip will appear in Trips within a few minutes.
        </Text>
        <Button title="View your trip" onPress={() => router.replace({ pathname: "/trip/[id]", params: { id: phase.bookingId } })} />
      </Centered>
    );
  }

  const hold = booking.current;
  const secondsLeft = hold ? Math.max(0, Math.floor(hold.holdExpiresAt - now)) : null;
  const total = hold?.totalPaise ?? quote.data?.totalPaise;
  const quoteError = quote.error instanceof ApiError ? quote.error.message : quote.error ? "Couldn't price these dates." : null;
  const busy = phase.kind === "paying" || phase.kind === "confirming";

  return (
    <ScrollView style={{ backgroundColor: t.bg }} contentContainerStyle={styles.body}>
      <Text style={[styles.title, { color: t.text }]}>{listing.data.title}</Text>
      <Text style={{ color: t.muted }}>{listing.data.city}</Text>

      <View style={[styles.card, { borderColor: t.border }]}>
        <Row label="Dates" value={formatRange(p.checkIn, p.checkOut)} />
        <Row label="Guests" value={String(guests)} />
        <View style={[styles.divider, { backgroundColor: t.border }]} />
        {quote.data ? <PriceBreakdown p={quote.data} totalLabel="Total (INR)" /> : null}
      </View>

      {quoteError ? <View style={{ marginBottom: 12 }}><Notice tone="warn">{quoteError.charAt(0).toUpperCase() + quoteError.slice(1)}.</Notice></View> : null}

      {!instant ? (
        <View style={{ marginBottom: 8 }}>
          <Notice tone="info">{`You won't be charged yet. ${listing.data.host?.name ?? "The host"} has 24 hours to accept; then you pay to confirm.`}</Notice>
          <View style={{ height: 12 }} />
          <Field label={`Message ${listing.data.host?.name ?? "the host"}`} multiline maxLength={1000} value={note} onChangeText={setNote} placeholder="Say who's coming and why you're travelling." hint="At least 10 characters." />
        </View>
      ) : null}

      {secondsLeft != null && secondsLeft > 0 ? (
        <Text style={{ color: t.muted, marginBottom: 12 }}>
          Dates held for {Math.floor(secondsLeft / 60)}:{String(secondsLeft % 60).padStart(2, "0")}
        </Text>
      ) : null}

      {anyTaken ? <Text style={{ color: t.danger, marginBottom: 12 }}>Some of these nights are no longer available.</Text> : null}
      {phase.kind === "failed" ? <Text style={{ color: t.danger, marginBottom: 12 }}>{phase.message}</Text> : null}
      {instant && !isRazorpayAvailable() ? (
        <Text style={{ color: t.muted, marginBottom: 12 }}>Payments need a development or store build of the app (not Expo Go).</Text>
      ) : null}

      <Button
        title={!instant ? "Request to book" : phase.kind === "confirming" ? "Confirming payment…" : total != null ? `Pay ${formatINR(total)}` : "Pay"}
        loading={busy}
        disabled={!!anyTaken || !!quoteError || !user || (secondsLeft === 0 && !!hold) || (!instant && note.trim().length < 10)}
        onPress={pay}
      />
      <Text style={{ color: t.muted, fontSize: 12, marginTop: 12, textAlign: "center" }}>
        Payments are processed securely by Razorpay. You won't be charged if the booking can't be confirmed.
      </Text>
    </ScrollView>
  );
}

function Row({ label, value, bold, muted }: { label: string; value: string; bold?: boolean; muted?: boolean }) {
  const t = useTheme();
  const color = muted ? t.muted : t.text;
  return (
    <View style={styles.row}>
      <Text style={{ color, fontWeight: bold ? "700" : "400" }}>{label}</Text>
      <Text style={{ color, fontWeight: bold ? "700" : "400" }}>{value}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  body: { padding: 20 },
  title: { fontSize: 20, fontWeight: "700" },
  big: { fontSize: 24, fontWeight: "700" },
  card: { borderWidth: 1, borderRadius: 12, padding: 16, marginVertical: 20, gap: 8 },
  row: { flexDirection: "row", justifyContent: "space-between" },
  divider: { height: StyleSheet.hairlineWidth, marginVertical: 4 },
});
