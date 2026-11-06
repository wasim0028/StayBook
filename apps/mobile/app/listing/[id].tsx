import { Image } from "expo-image";
import { router, useLocalSearchParams } from "expo-router";
import { useMemo, useState } from "react";
import { ActivityIndicator, FlatList, ScrollView, StyleSheet, Text, useWindowDimensions, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { useCalendar, useListing, useListingReviews, useQuote, useSavedIds } from "@/api/hooks";
import { ApiError } from "@/api/client";
import { HostCard } from "@/components/HostCard";
import { PriceBreakdown } from "@/components/PriceBreakdown";
import { HeartButton } from "@/components/HeartButton";
import { MessageButton } from "@/components/MessageButton";
import { ReviewItem } from "@/components/ReviewItem";
import { useAuth } from "@/auth/AuthProvider";
import { DateRangeModal, type Range } from "@/components/DateRangeModal";
import { useTheme } from "@/components/theme";
import { Button, Centered, ErrorView } from "@/components/ui";
import { addDaysISO, formatINR, formatRange, nightsBetween, toISODate } from "@/lib/format";

const POLICY_TEXT: Record<string, string> = {
  FLEXIBLE: "Full refund up to 24 hours before check-in.",
  MODERATE: "Full refund up to 5 days before check-in, 50% after that.",
  STRICT: "50% refund up to 7 days before check-in, no refund after that.",
};

const AVAILABILITY_WINDOW_NIGHTS = 180;

export default function ListingScreen() {
  const t = useTheme();
  const insets = useSafeAreaInsets();
  const { width } = useWindowDimensions();
  const { user, signIn } = useAuth();
  const saved = useSavedIds(!!user);
  const p = useLocalSearchParams<{ id: string; checkIn?: string; checkOut?: string; guests?: string }>();
  const [range, setRange] = useState<Range>({
    checkIn: p.checkIn,
    checkOut: p.checkOut,
    guests: Math.max(1, Number(p.guests ?? 2) || 2),
  });
  const [picker, setPicker] = useState(false);
  const [photoIndex, setPhotoIndex] = useState(0);

  const listing = useListing(p.id);

  // One calendar fetch covers both the date picker (blocked days) and the price of the chosen stay.
  const today = toISODate(new Date());
  const windowEnd = addDaysISO(today, AVAILABILITY_WINDOW_NIGHTS);
  const calendar = useCalendar(p.id, today, windowEnd);

  const unavailable = useMemo(
    () => new Set((calendar.data?.nights ?? []).filter((n) => !n.available).map((n) => n.date)),
    [calendar.data],
  );

  const local = useMemo(() => {
    if (!range.checkIn || !range.checkOut || !calendar.data) return null;
    const nights = nightsBetween(range.checkIn, range.checkOut);
    const byDate = new Map(calendar.data.nights.map((n) => [n.date, n]));
    let total = 0;
    for (let i = 0; i < nights; i++) {
      const n = byDate.get(addDaysISO(range.checkIn, i));
      if (!n) return { nights, total: null, available: true, outsideWindow: true };
      if (!n.available) return { nights, total: null, available: false, outsideWindow: false };
      total += n.pricePaise;
    }
    return { nights, total, available: true, outsideWindow: false };
  }, [range, calendar.data]);
  // The server quote is the source of truth for the price (fees, discounts, GST, stay-length rules).
  const serverQuote = useQuote(p.id, range.checkIn ?? undefined, range.checkOut ?? undefined, range.guests);
  const quoteError = serverQuote.error instanceof ApiError ? serverQuote.error.message : null;
  const quote = local ? { ...local, available: local.available && (serverQuote.data?.available ?? true), total: serverQuote.data?.totalPaise ?? null } : null;

  if (listing.isLoading) {
    return (
      <Centered>
        <ActivityIndicator color={t.muted} />
      </Centered>
    );
  }
  if (listing.isError || !listing.data) {
    return <ErrorView message={(listing.error as Error)?.message ?? "Listing not found"} onRetry={() => listing.refetch()} />;
  }

  const l = listing.data;
  const tooManyGuests = range.guests > l.maxGuests;

  const reserve = async () => {
    if (!user) {
      await signIn();
      return; // the button re-renders as "Reserve" once signed in
    }
    router.push({
      pathname: "/checkout/[id]",
      params: { id: l.id, checkIn: range.checkIn!, checkOut: range.checkOut!, guests: String(range.guests) },
    });
  };

  return (
    <View style={{ flex: 1, backgroundColor: t.bg }}>
      <ScrollView contentContainerStyle={{ paddingBottom: 120 }}>
        <FlatList
          data={l.photoUrls.length ? l.photoUrls : [null]}
          horizontal
          pagingEnabled
          showsHorizontalScrollIndicator={false}
          keyExtractor={(u, i) => u ?? `placeholder-${i}`}
          onMomentumScrollEnd={(e) => setPhotoIndex(Math.round(e.nativeEvent.contentOffset.x / width))}
          renderItem={({ item }) => (
            <Image
              source={item ?? undefined}
              style={{ width, height: width * 0.75, backgroundColor: t.surface }}
              contentFit="cover"
              transition={150}
            />
          )}
        />
        {user?.sub !== l.hostId ? (
          <View style={{ position: "absolute", top: 0, right: 0, width: 60, height: 60 }}>
            <HeartButton id={l.id} saved={saved.has(l.id)} />
          </View>
        ) : null}
        {l.photoUrls.length > 1 ? (
          <Text style={[styles.counter, { color: "#fff" }]}>
            {photoIndex + 1} / {l.photoUrls.length}
          </Text>
        ) : null}

        <View style={styles.body}>
          <Text style={[styles.title, { color: t.text }]}>{l.title}</Text>
          <Text style={{ color: t.muted, marginTop: 4 }}>
            {l.propertyType} in {l.city} · {l.maxGuests} guests · {l.bedrooms} bedrooms · {l.beds} beds · {l.bathrooms} baths
          </Text>
          {l.ratingCount ? (
            <Text style={{ color: t.text, marginTop: 6 }}>
              ★ {l.ratingAvg?.toFixed(2)} · {l.ratingCount} reviews
            </Text>
          ) : null}

          <View style={[styles.divider, { backgroundColor: t.border }]} />
          <Text style={{ color: t.text, lineHeight: 22 }}>{l.description}</Text>

          {l.amenities.length ? (
            <>
              <View style={[styles.divider, { backgroundColor: t.border }]} />
              <Text style={[styles.h2, { color: t.text }]}>What this place offers</Text>
              <View style={styles.chips}>
                {l.amenities.map((a) => (
                  <Text key={a} style={[styles.chip, { color: t.text, borderColor: t.border }]}>
                    {a.replace(/_/g, " ")}
                  </Text>
                ))}
              </View>
            </>
          ) : null}

          {l.host ? (
            <>
              <View style={[styles.divider, { backgroundColor: t.border }]} />
              <HostCard host={l.host} />
            </>
          ) : null}

          <View style={[styles.divider, { backgroundColor: t.border }]} />
          <Text style={[styles.h2, { color: t.text }]}>How booking works</Text>
          <Text style={{ color: t.muted, lineHeight: 20 }}>
            {l.instantBook === false
              ? "Request to book: send the host a short note. You're only charged once they accept (they have 24 hours)."
              : "Instant Book: your booking is confirmed as soon as you pay."}
            {l.minNights && l.minNights > 1 ? ` Minimum stay ${l.minNights} nights.` : ""}
          </Text>

          {serverQuote.data ? (
            <>
              <View style={[styles.divider, { backgroundColor: t.border }]} />
              <Text style={[styles.h2, { color: t.text }]}>Price for your dates</Text>
              <PriceBreakdown p={serverQuote.data} />
            </>
          ) : null}

          <View style={[styles.divider, { backgroundColor: t.border }]} />
          <Text style={[styles.h2, { color: t.text }]}>Cancellation policy</Text>
          <Text style={{ color: t.muted }}>{POLICY_TEXT[l.cancellationPolicy]}</Text>

          <View style={[styles.divider, { backgroundColor: t.border }]} />
          <ListingReviews listingId={l.id} avg={l.ratingAvg} count={l.ratingCount} />

          {user?.sub !== l.hostId ? (
            <>
              <View style={[styles.divider, { backgroundColor: t.border }]} />
              <Text style={[styles.h2, { color: t.text }]}>Questions about this place?</Text>
              <Text style={{ color: t.muted, marginBottom: 12 }}>Message the host before you book.</Text>
              <MessageButton start={{ listingId: l.id }} title="Contact host" />
            </>
          ) : null}
        </View>
      </ScrollView>

      {/* Reserve bar */}
      <View style={[styles.bar, { borderTopColor: t.border, backgroundColor: t.bg, paddingBottom: insets.bottom + 12 }]}>
        <View style={{ flex: 1 }}>
          {quote?.total != null ? (
            <Text style={{ color: t.text, fontWeight: "700", fontSize: 16 }}>
              {formatINR(quote.total)} <Text style={{ fontWeight: "400", color: t.muted }}>for {quote.nights} nights</Text>
            </Text>
          ) : (
            <Text style={{ color: t.text, fontWeight: "700", fontSize: 16 }}>
              {formatINR(l.basePricePaise)} <Text style={{ fontWeight: "400", color: t.muted }}>night</Text>
            </Text>
          )}
          <Text
            style={{ color: quoteError || (quote && !quote.available) ? t.danger : t.muted, textDecorationLine: "underline" }}
            onPress={() => setPicker(true)}
          >
            {quoteError
              ? `${quoteError.charAt(0).toUpperCase()}${quoteError.slice(1)}. Change dates`
              : quote && !quote.available
              ? "Those dates are taken. Change dates"
              : tooManyGuests
                ? `Max ${l.maxGuests} guests`
                : `${formatRange(range.checkIn, range.checkOut)} · ${range.guests} guests`}
          </Text>
        </View>
        {range.checkIn && range.checkOut ? (
          <Button
            title={!user ? "Sign in to book" : l.instantBook === false ? "Request" : "Reserve"}
            disabled={!quote?.available || !!quoteError || tooManyGuests || calendar.isLoading || serverQuote.isLoading}
            onPress={reserve}
          />
        ) : (
          <Button title="Check availability" onPress={() => setPicker(true)} />
        )}
      </View>

      <DateRangeModal
        visible={picker}
        value={range}
        unavailable={unavailable}
        onClose={() => setPicker(false)}
        onApply={(r) => {
          setRange(r);
          setPicker(false);
        }}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  counter: {
    position: "absolute",
    right: 12,
    top: 12,
    backgroundColor: "rgba(0,0,0,0.55)",
    paddingHorizontal: 8,
    paddingVertical: 2,
    borderRadius: 10,
    overflow: "hidden",
    fontSize: 12,
  },
  body: { padding: 20 },
  title: { fontSize: 24, fontWeight: "700" },
  h2: { fontSize: 18, fontWeight: "600", marginBottom: 10 },
  divider: { height: StyleSheet.hairlineWidth, marginVertical: 20 },
  chips: { flexDirection: "row", flexWrap: "wrap", gap: 8 },
  chip: { borderWidth: 1, borderRadius: 16, paddingHorizontal: 12, paddingVertical: 6, textTransform: "capitalize" },
  bar: {
    position: "absolute",
    left: 0,
    right: 0,
    bottom: 0,
    flexDirection: "row",
    alignItems: "center",
    gap: 12,
    paddingHorizontal: 20,
    paddingTop: 12,
    borderTopWidth: StyleSheet.hairlineWidth,
  },
});

function ListingReviews({ listingId, avg, count }: { listingId: string; avg?: number; count?: number }) {
  const t = useTheme();
  const q = useListingReviews(listingId);
  return (
    <View>
      <Text style={[styles.h2, { color: t.text }]}>{count ? `★ ${avg?.toFixed(2)} · ${count} review${count === 1 ? "" : "s"}` : "No reviews yet"}</Text>
      {q.isLoading ? <ActivityIndicator /> : null}
      {!count && !q.isLoading ? <Text style={{ color: t.muted }}>Guests who stay here can leave a review after check-out.</Text> : null}
      <View style={{ gap: 22 }}>
        {(q.data?.items ?? []).slice(0, 6).map((r) => (
          <ReviewItem key={r.bookingId} r={r} />
        ))}
      </View>
    </View>
  );
}
